importScripts("config.js");

const API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

// ── OAuth redirect capture ────────────────────────────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = changeInfo.url || tab.url || "";
  if (!url.startsWith("https://kinetiksoul.com")) return;
  const params = new URL(url).searchParams;
  const authCode = params.get("auth_code");
  if (!authCode) return;
  chrome.tabs.remove(tabId);
  try {
    const res = await fetch(`${API_BASE}/oauth2/access_token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: APP_ID, secret: APP_SECRET, auth_code: authCode, grant_type: "authorization_code" }),
    });
    if (!res.ok) {
      chrome.storage.local.set({ tt_auth_status: `error: HTTP ${res.status}` });
      return;
    }
    const data = await res.json();
    if (data.code === 0) {
      chrome.storage.local.set({ tt_token: data.data.access_token, tt_auth_status: "success" });
    } else {
      chrome.storage.local.set({ tt_auth_status: "error: " + data.message });
    }
  } catch (e) {
    chrome.storage.local.set({ tt_auth_status: "error: " + e.message });
  }
});

// ── API proxy — all fetches go through background to avoid MV3 popup limits ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "API_GET") {
    const { path, token, params } = msg;
    const url = new URL(API_BASE + path);
    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    fetch(url.toString(), { headers: { "Access-Token": token } })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        return r.text();
      })
      .then(text => {
        try {
          const data = JSON.parse(text);
          sendResponse({ ok: true, data });
        } catch {
          sendResponse({ ok: false, error: `Non-JSON (${text.slice(0, 120)})` });
        }
      })
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // keep channel open for async response
  }
});
