// APP_ID is loaded from config.js via popup.html
const API_BASE = "https://business-api.tiktok.com/open_api/v1.3";
const OAUTH_URL = `https://business-api.tiktok.com/portal/auth?app_id=${APP_ID}&state=spark_plugin&redirect_uri=https%3A%2F%2Fkinetiksoul.com`;

const connectBtn        = document.getElementById("connectBtn");
const connectDot        = document.getElementById("connectDot");
const connectLabel      = document.getElementById("connectLabel");
const tokenBadge        = document.getElementById("tokenBadge");
const advInput          = document.getElementById("advertiserId");
const autoDetectBtn     = document.getElementById("autoDetectBtn");
const campaignInput     = document.getElementById("campaignId");
const detectCampaignBtn = document.getElementById("detectCampaignBtn");
const fetchBtn          = document.getElementById("fetchBtn");
const statusEl          = document.getElementById("status");
const resultsEl         = document.getElementById("results");
const approvedList      = document.getElementById("approvedList");
const rejectedList      = document.getElementById("rejectedList");
const approvedCount     = document.getElementById("approvedCount");
const rejectedCount     = document.getElementById("rejectedCount");
const copyApproved      = document.getElementById("copyApproved");
const toast             = document.getElementById("toast");

let currentToken = null;
let pollInterval = null;

// ── Init ──────────────────────────────────────────────────────────────────────
chrome.storage.local.get(["tt_token", "tt_advertiser", "tt_campaign"], (data) => {
  if (data.tt_advertiser) advInput.value = data.tt_advertiser;
  if (data.tt_campaign)   campaignInput.value = data.tt_campaign;
  if (data.tt_token) setConnected(data.tt_token);
});

// ── API proxy ─────────────────────────────────────────────────────────────────
function apiGet(path, token, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "API_GET", path, token, params }, (resp) => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      if (!resp || !resp.ok) { reject(new Error(resp?.error || "Unknown error")); return; }
      if (resp.data.code !== 0) { reject(new Error(resp.data.message || `API error ${resp.data.code}`)); return; }
      resolve(resp.data);
    });
  });
}

// ── Auto-detect advertiser ID ─────────────────────────────────────────────────
autoDetectBtn.addEventListener("click", async () => {
  autoDetectBtn.textContent = "detecting...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes("tiktok.com")) { setStatus("Open TikTok Ads Manager first.", "error"); return; }
    const url = new URL(tab.url);
    let id = url.searchParams.get("aadvid") || url.searchParams.get("advertiser_id");
    if (!id) {
      const r = await chrome.scripting.executeScript({ target: { tabId: tab.id },
        func: () => new URL(location.href).searchParams.get("aadvid") || new URL(location.href).searchParams.get("advertiser_id") || null });
      id = r?.[0]?.result;
    }
    if (id) { advInput.value = id; chrome.storage.local.set({ tt_advertiser: id }); setStatus(`Detected: ${id}`, "success"); }
    else setStatus("Couldn't detect — paste manually.", "error");
  } catch (e) { setStatus("Failed: " + e.message, "error"); }
  finally { autoDetectBtn.textContent = "auto-detect"; }
});

// ── Auto-detect campaign ID ───────────────────────────────────────────────────
detectCampaignBtn.addEventListener("click", async () => {
  detectCampaignBtn.textContent = "detecting...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes("tiktok.com")) { setStatus("Open TikTok Ads Manager first.", "error"); return; }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const advertiserIds = new Set((location.href.match(/\d{19}/g) || []));
        const stores = [sessionStorage, localStorage];
        for (const store of stores) {
          for (let i = 0; i < store.length; i++) {
            try {
              const val = store.getItem(store.key(i)) || "";
              const m = val.match(/"campaign_id"\s*:\s*"(\d{15,20})"/);
              if (m && !advertiserIds.has(m[1])) return { id: m[1], src: "storage" };
            } catch {}
          }
        }
        const candidates = new Set();
        document.querySelectorAll("[data-campaign-id],[data-id]").forEach(el => {
          const v = el.dataset.campaignId || el.dataset.id;
          if (v && /^\d{15,20}$/.test(v) && !advertiserIds.has(v)) candidates.add(v);
        });
        const list = [...candidates];
        return list.length === 1 ? { id: list[0], src: "dom" } : { id: null, candidates: list.slice(0, 8) };
      },
    });
    const res = results?.[0]?.result;
    if (res?.id) {
      campaignInput.value = res.id;
      chrome.storage.local.set({ tt_campaign: res.id });
      setStatus(`Campaign detected: ${res.id}`, "success");
    } else if (res?.candidates?.length) {
      setStatus(`Pick your campaign ID: ${res.candidates.join(" · ")}`, "error");
    } else {
      setStatus("Can't auto-detect. Go to Campaigns tab → click your campaign → try again.", "error");
    }
  } catch (e) { setStatus("Failed: " + e.message, "error"); }
  finally { detectCampaignBtn.textContent = "auto-detect"; }
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

// ── Fetch ─────────────────────────────────────────────────────────────────────
fetchBtn.addEventListener("click", async () => {
  if (!currentToken) { setStatus("Connect first.", "error"); return; }
  const advId  = advInput.value.trim();
  const campId = campaignInput.value.trim();
  if (!advId) { setStatus("Enter advertiser ID.", "error"); return; }
  chrome.storage.local.set({ tt_advertiser: advId });
  if (campId) chrome.storage.local.set({ tt_campaign: campId });
  fetchBtn.disabled = true;
  setStatus("Fetching...", "");
  approvedList.innerHTML = ""; rejectedList.innerHTML = "";
  resultsEl.style.display = "none";
  try {
    const creatives = await fetchSparkCreatives(currentToken, advId, campId);
    renderCreatives(creatives);
  } catch (e) {
    setStatus("Error: " + e.message, "error");
  } finally {
    fetchBtn.disabled = false;
  }
});

// ── Core fetch logic ──────────────────────────────────────────────────────────
async function fetchSparkCreatives(token, advertiserId, campaignId = "") {
  // Step 1: get all Smart+ ads, collect unique AUTH_CODE creatives keyed by ad_material_id
  const creativeMap = new Map(); // key: ad_material_id
  let page = 1;
  while (true) {
    const params = { advertiser_id: advertiserId, page, page_size: 100 };
    const data = await apiGet("/smart_plus/ad/get/", token, params);
    const items = data.data?.list || [];
    const total = data.data?.page_info?.total_number || 0;
    for (const ad of items) {
      if (campaignId && String(ad.campaign_id) !== String(campaignId)) continue;
      for (const c of (ad.creative_list || [])) {
        const info = c.creative_info || {};
        if (info.identity_type !== "AUTH_CODE" || !info.tiktok_item_id) continue;
        if (!c.ad_material_id || creativeMap.has(c.ad_material_id)) continue;
        creativeMap.set(c.ad_material_id, {
          ad_material_id: c.ad_material_id,
          identity_id:    info.identity_id,
          tiktok_item_id: info.tiktok_item_id,
          ad_name:        ad.ad_name || "",
        });
      }
    }
    if (page * 100 >= total || !items.length) break;
    page++;
  }

  if (!creativeMap.size) throw new Error("No Spark creatives found for this account/campaign.");

  // Step 2: get real review status from /smart_plus/material/review_info/
  const materialIds = [...creativeMap.keys()];
  const reviewMap = new Map(); // ad_material_id → review status string
  try {
    const rdata = await apiGet("/smart_plus/material/review_info/", token, {
      advertiser_id:   advertiserId,
      ad_material_ids: JSON.stringify(materialIds),
    });
    for (const item of (rdata.data?.list || [])) {
      const id     = item.ad_material_id;
      const status = item.review_status || item.material_review_status || item.status || "";
      if (id) reviewMap.set(id, status);
    }
  } catch (e) {
    console.error("material/review_info FAILED:", e.message, e);
  }

  // Step 3: get video metadata + build final list
  const results = [];
  for (const [matId, creative] of creativeMap) {
    let videoUrl = `https://www.tiktok.com/video/${creative.tiktok_item_id}`;
    let creator  = creative.ad_name || "Unknown";
    let thumb    = null;
    try {
      const vdata = await apiGet("/identity/video/info/", token, {
        advertiser_id: advertiserId,
        identity_type: "AUTH_CODE",
        identity_id:   creative.identity_id,
        item_id:       creative.tiktok_item_id,
      });
      const v = vdata.data?.video_info || vdata.data || {};
      if (v.share_url)   videoUrl = v.share_url;
      if (v.author_name) creator  = v.author_name;
      if (v.cover_image) thumb    = v.cover_image;
    } catch {}

    const reviewRaw = reviewMap.get(matId);
    const apiError  = reviewMap.get("__error__");
    console.log({ ad_material_id: matId, review_raw: reviewRaw, api_error: apiError });
    const approved = false;
    const reason = apiError ? `review_info error: ${apiError}` : JSON.stringify(reviewRaw ?? "no_review_data");
    results.push({ ...creative, videoUrl, creator, thumb, approved, reason, reviewStatus: reviewRaw });
  }

  return results;
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderCreatives(creatives) {
  approvedList.innerHTML = ""; rejectedList.innerHTML = "";
  const approved = creatives.filter(c => c.approved);
  const rejected = creatives.filter(c => !c.approved);
  approvedCount.textContent = approved.length;
  rejectedCount.textContent = rejected.length;

  approved.forEach(c => approvedList.appendChild(makeItem(c)));
  rejected.forEach(c => rejectedList.appendChild(makeItem(c)));

  copyApproved.onclick = () => copyText(approved.map(c => c.videoUrl).join("\n"), "Links copied!");
  resultsEl.style.display = "block";
  setStatus(`${approved.length} approved · ${rejected.length} disapproved`, approved.length ? "success" : "");
}

function makeItem(c) {
  const div = document.createElement("div");
  div.className = `creative-item ${c.approved ? "approved" : "rejected"}`;
  div.innerHTML = `
    ${c.thumb ? `<img class="creative-thumb" src="${esc(c.thumb)}" />` : `<div class="creative-thumb"></div>`}
    <div class="creative-info">
      <div class="creative-creator">${esc(c.creator)}</div>
      ${c.reason ? `<div class="creative-reason">${esc(c.reason.replace(/^AD_STATUS_/, "").replace(/_/g," "))}</div>` : ""}
    </div>
    <div class="creative-actions">
      <a class="link-btn" href="${esc(c.videoUrl)}" target="_blank">View</a>
      <button class="link-btn" data-url="${esc(c.videoUrl)}">Copy link</button>
    </div>`;
  div.querySelector("[data-url]").addEventListener("click", (e) => copyText(e.target.dataset.url));
  return div;
}

function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "status" + (type ? ` ${type}` : "");
}
function esc(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
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
