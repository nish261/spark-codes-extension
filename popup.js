// APP_ID is loaded from config.js via popup.html
const API_BASE = "https://business-api.tiktok.com/open_api/v1.3";
const OAUTH_URL = `https://business-api.tiktok.com/portal/auth?app_id=${APP_ID}&state=spark_plugin&redirect_uri=https%3A%2F%2Fkinetiksoul.com`;

const connectBtn    = document.getElementById("connectBtn");
const connectDot    = document.getElementById("connectDot");
const connectLabel  = document.getElementById("connectLabel");
const tokenBadge    = document.getElementById("tokenBadge");
const advInput      = document.getElementById("advertiserId");
const autoDetectBtn = document.getElementById("autoDetectBtn");
const fetchBtn      = document.getElementById("fetchBtn");
const debugBtn      = document.getElementById("debugBtn");
const statusEl      = document.getElementById("status");
const resultsEl     = document.getElementById("results");
const codeListEl    = document.getElementById("codeList");
const countEl       = document.getElementById("resultsCount");
const copyAllBtn    = document.getElementById("copyAll");
const toast         = document.getElementById("toast");

let currentToken = null;
let pollInterval = null;

// ── Init ──────────────────────────────────────────────────────────────────────
chrome.storage.local.get(["tt_token", "tt_advertiser"], (data) => {
  if (data.tt_advertiser) advInput.value = data.tt_advertiser;
  if (data.tt_token) setConnected(data.tt_token);
});

// ── API via background (avoids MV3 popup fetch restrictions) ─────────────────
function apiGet(path, token, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "API_GET", path, token, params }, (resp) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!resp || !resp.ok) { reject(new Error(resp?.error || "Unknown error")); return; }
      const data = resp.data;
      if (data.code !== 0) { reject(new Error(data.message || `API error ${data.code}`)); return; }
      resolve(data);
    });
  });
}

// ── Auto-detect advertiser ID ─────────────────────────────────────────────────
autoDetectBtn.addEventListener("click", async () => {
  autoDetectBtn.textContent = "detecting...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes("tiktok.com")) {
      setStatus("Open TikTok Ads Manager first.", "error"); return;
    }
    const url = new URL(tab.url);
    let id = url.searchParams.get("aadvid") || url.searchParams.get("advertiser_id");
    if (!id) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => new URL(location.href).searchParams.get("aadvid") || new URL(location.href).searchParams.get("advertiser_id") || location.href.match(/[?&\/](\d{15,20})/)?.[1] || null,
      });
      id = results?.[0]?.result;
    }
    if (id) {
      advInput.value = id;
      chrome.storage.local.set({ tt_advertiser: id });
      setStatus(`Detected: ${id}`, "success");
    } else {
      setStatus("Couldn't detect — paste advertiser ID manually.", "error");
    }
  } catch (e) {
    setStatus("Detection failed: " + e.message, "error");
  } finally {
    autoDetectBtn.textContent = "auto-detect";
  }
});

// ── Connect ───────────────────────────────────────────────────────────────────
connectBtn.addEventListener("click", () => {
  if (currentToken) {
    chrome.storage.local.remove(["tt_token", "tt_auth_status"]);
    setDisconnected(); return;
  }
  chrome.tabs.create({ url: OAUTH_URL });
  setConnecting();
  chrome.storage.local.remove("tt_auth_status");
  pollInterval = setInterval(() => {
    chrome.storage.local.get(["tt_token", "tt_auth_status"], (data) => {
      if (data.tt_token) { clearInterval(pollInterval); setConnected(data.tt_token); setStatus("Connected!", "success"); }
      else if (data.tt_auth_status?.startsWith("error")) { clearInterval(pollInterval); setDisconnected(); setStatus(data.tt_auth_status, "error"); }
    });
  }, 800);
  setTimeout(() => { clearInterval(pollInterval); if (!currentToken) setDisconnected(); }, 180000);
});

function setConnected(token) {
  currentToken = token;
  connectBtn.classList.add("connected"); connectBtn.classList.remove("connecting");
  connectDot.style.background = "#00c853";
  connectLabel.textContent = "Connected — click to disconnect";
  tokenBadge.style.display = "block";
}
function setDisconnected() {
  currentToken = null;
  connectBtn.classList.remove("connected", "connecting");
  connectDot.style.background = "#555";
  connectLabel.textContent = "Connect TikTok Account";
  tokenBadge.style.display = "none";
}
function setConnecting() {
  connectBtn.classList.add("connecting"); connectBtn.classList.remove("connected");
  connectDot.style.background = "#ffaa00";
  connectLabel.textContent = "Waiting for authorization...";
}

// ── Debug: dump raw Smart+ ad fields ─────────────────────────────────────────
debugBtn.addEventListener("click", async () => {
  if (!currentToken) { setStatus("Connect first.", "error"); return; }
  const advId = advInput.value.trim();
  if (!advId) { setStatus("Enter advertiser ID.", "error"); return; }
  setStatus("Fetching raw Smart+ ad data...", "");
  try {
    const data = await apiGet("/smart_plus/ad/get/", currentToken, {
      advertiser_id: advId,
      page: 1,
      page_size: 5,
    });
    const list = data.data?.list || [];
    countEl.textContent = list.length;
    resultsEl.style.display = "block";
    const topKeys = list[0] ? Object.keys(list[0]).join(", ") : "no data";
    const creativeKeys = list[0]?.creative_list?.[0] ? Object.keys(list[0].creative_list[0]).join(", ") : "no creative_list";
    codeListEl.innerHTML = `<div class="code-item"><div class="code-meta" style="word-break:break-all">
      ad keys: ${esc(topKeys)}<br><br>
      creative_list[0] keys: ${esc(creativeKeys)}<br><br>
      ${list.slice(0,3).map(ad => `
        <b>ad:</b> ${esc(ad.ad_name||ad.ad_id)}<br>
        identity_type: ${esc(ad.identity_type||"—")}<br>
        identity_id: ${esc(ad.identity_id||"—")}<br>
        status: ${esc(ad.secondary_status||ad.operation_status||"—")}<br>
        first creative keys: ${esc(Object.keys(ad.creative_list?.[0]||{}).join(", "))}<br>
        first creative_info keys: ${esc(Object.keys(ad.creative_list?.[0]?.creative_info||{}).join(", "))}<br>
        first creative_info: ${esc(JSON.stringify(ad.creative_list?.[0]?.creative_info||{}))}<br>
        first material_operation_status: ${esc(ad.creative_list?.[0]?.material_operation_status||"—")}
      `).join("<br>---<br>")}
    </div></div>`;
    setStatus(`smart_plus/ad/get: ${list.length} ads`, "success");
  } catch(e) { setStatus("Error: " + e.message, "error"); }
});

// ── Fetch spark codes ─────────────────────────────────────────────────────────
fetchBtn.addEventListener("click", async () => {
  if (!currentToken) { setStatus("Connect first.", "error"); return; }
  const advId = advInput.value.trim();
  if (!advId) { setStatus("Enter advertiser ID.", "error"); return; }
  chrome.storage.local.set({ tt_advertiser: advId });
  fetchBtn.disabled = true;
  setStatus("Fetching...", "");
  codeListEl.innerHTML = "";
  resultsEl.style.display = "none";
  try {
    const codes = await fetchSparkCodes(currentToken, advId);
    renderCodes(codes);
    setStatus(codes.length ? `Found ${codes.length} spark code${codes.length > 1 ? "s" : ""}.` : "No spark codes found.", codes.length ? "success" : "");
  } catch (e) {
    setStatus("Error: " + e.message, "error");
  } finally {
    fetchBtn.disabled = false;
  }
});

async function fetchSparkCodes(token, advertiserId) {
  const seen = new Set();
  const codes = [];

  // Strategy 1: pull AUTH_CODE identities directly
  try {
    let page = 1;
    while (true) {
      const data = await apiGet("/identity/get/", token, {
        advertiser_id: advertiserId,
        identity_type: "AUTH_CODE",
        page,
        page_size: 100,
      });
      const items = data.data?.list || [];
      const total = data.data?.page_info?.total_number || 0;
      for (const identity of items) {
        const code = identity.identity_id;
        if (!code || seen.has(code)) continue;
        seen.add(code);
        codes.push({
          spark_code:    code,
          identity_name: identity.display_name || identity.identity_name || "N/A",
          status:        "ACTIVE",
          expire_time:   identity.expire_time || null,
          source:        "identity",
        });
      }
      if (page * 100 >= total || !items.length) break;
      page++;
    }
  } catch (e) {
    console.warn("identity/get failed:", e.message);
  }

  // Strategy 2: scrape codes from ad creatives (covers suspended accounts & non-Smart+ ads)
  try {
    let page = 1;
    while (true) {
      const data = await apiGet("/ad/get/", token, {
        advertiser_id: advertiserId,
        page,
        page_size: 100,
        fields: JSON.stringify(["ad_id", "ad_name", "operation_status", "secondary_status",
                                "identity_type", "identity_id", "tiktok_item_id"]),
      });
      const items = data.data?.list || [];
      const total = data.data?.page_info?.total_number || 0;
      for (const ad of items) {
        const code = ad.identity_id;
        if (!code || ad.identity_type !== "AUTH_CODE" || seen.has(code)) continue;
        seen.add(code);
        const status = (ad.secondary_status || ad.operation_status || "")
          .replace(/^AD_STATUS_/, "").replace(/_/g, " ").trim() || "ACTIVE";
        codes.push({
          spark_code:    code,
          identity_name: ad.ad_name || "N/A",
          status,
          expire_time:   null,
          source:        "ad",
        });
      }
      if (page * 100 >= total || !items.length) break;
      page++;
    }
  } catch (e) {
    console.warn("ad/get failed:", e.message);
  }

  // Strategy 3: Smart+ ad/get — identity_id may live on the ad directly or in creative_list
  try {
    let page = 1;
    while (true) {
      const data = await apiGet("/smart_plus/ad/get/", token, {
        advertiser_id: advertiserId,
        page,
        page_size: 100,
      });
      const items = data.data?.list || [];
      const total = data.data?.page_info?.total_number || 0;
      for (const ad of items) {
        const status = (ad.secondary_status || ad.operation_status || "")
          .replace(/^AD_STATUS_/, "").replace(/_/g, " ").trim() || "ACTIVE";

        // Check ad-level identity_id
        if (ad.identity_id && ad.identity_type === "AUTH_CODE" && !seen.has(ad.identity_id)) {
          seen.add(ad.identity_id);
          codes.push({ spark_code: ad.identity_id, identity_name: ad.ad_name || "N/A", status, expire_time: null, source: "smart+" });
        }

        // Check creative_list items
        for (const c of (ad.creative_list || [])) {
          const code = c.identity_id || c.tiktok_item_id;
          if (!code || seen.has(code)) continue;
          if (c.identity_type && c.identity_type !== "AUTH_CODE") continue;
          seen.add(code);
          codes.push({ spark_code: code, identity_name: ad.ad_name || "N/A", status, expire_time: null, source: "smart+" });
        }
      }
      if (page * 100 >= total || !items.length) break;
      page++;
    }
  } catch (e) {
    console.warn("smart_plus/ad/get failed:", e.message);
  }

  if (!codes.length) {
    throw new Error("No spark codes found across identity/get, ad/get, and smart_plus/ad/get. Click Debug to inspect raw Smart+ ad fields.");
  }

  return codes;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderCodes(codes) {
  codeListEl.innerHTML = "";
  if (!codes.length) { resultsEl.style.display = "none"; return; }
  countEl.textContent = codes.length;
  resultsEl.style.display = "block";
  for (const c of codes) {
    const expire = c.expire_time ? new Date(c.expire_time * 1000).toLocaleDateString() : null;
    const item = document.createElement("div");
    item.className = "code-item";
    item.innerHTML = `
      <div class="code-value">${esc(c.spark_code)}</div>
      <div class="code-meta">
        <span class="badge">${esc(c.status)}</span>
        ${esc(c.identity_name)}${expire ? ` · expires ${expire}` : ""}
      </div>
      <span class="copy-hint">click to copy</span>
      <span class="copy-hint" style="top:auto;bottom:6px;font-size:9px;opacity:.4">${c.source === "ad" ? "from ad" : "identity"}</span>`;
    item.addEventListener("click", () => copyText(c.spark_code));
    codeListEl.appendChild(item);
  }
  copyAllBtn.onclick = () => copyText(codes.map(c => c.spark_code).join("\n"), "All codes copied!");
}

function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "status" + (type ? ` ${type}` : "");
}
function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
let toastTimer;
function copyText(text, msg = "Copied!") {
  navigator.clipboard.writeText(text).then(() => {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 1500);
  });
}
