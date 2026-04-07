# TikTok Spark Codes Chrome Extension

A Chrome extension that connects to the TikTok Marketing API via OAuth and fetches Spark Ad authorization codes from your ad accounts — specifically built for **Smart+ campaigns**.

---

## What It Does (Working)

### OAuth Flow
- Click "Connect TikTok Account" → opens TikTok OAuth in a new tab
- TikTok redirects to `https://kinetiksoul.com?auth_code=XXX`
- Background service worker (`background.js`) intercepts the redirect before the 404 loads, closes the tab, exchanges the `auth_code` for an `access_token` via the TikTok API
- Token is saved to `chrome.storage.local` — persists across sessions
- Polling detects the token and updates the UI automatically

### Advertiser ID Detection
- "Auto-detect" button reads the `aadvid` query param from the current TikTok Ads Manager tab URL
- Falls back to running a content script on the page to find the advertiser ID

### Spark Code Fetching
- Calls `GET /open_api/v1.3/smart_plus/ad/get/` with the advertiser ID
- Paginates through all Smart+ ads (100 per page)
- Each Smart+ ad has a `creative_list[]` array — each item has an `identity_id`
- Deduplicates by `identity_id` across all ads/pages
- Displays unique spark codes in the popup with status + creator name
- Click any code to copy it, or "Copy all codes" to grab everything

### Architecture
- **`background.js`** — handles OAuth redirect capture + all API fetch calls (proxied via `chrome.runtime.sendMessage` to avoid MV3 popup fetch restrictions)
- **`popup.js`** — UI logic, sends messages to background for all API calls
- **`popup.html`** — dark-themed UI
- **`manifest.json`** — MV3, permissions: `storage`, `tabs`, `activeTab`, `scripting`

---

## What We Discovered Along the Way

### Why `/ad/get/` Didn't Work
Initially used `GET /open_api/v1.3/ad/get/` with `identity_id` in the fields. For Smart+ campaigns, `identity_id` at the top level of the ad object is the **same for every ad** (the advertiser-level identity), not the per-creative spark code. The `creative_list` field is **not valid** on `/ad/get/` — TikTok rejects it.

### Smart+ Has Its Own Endpoint
`GET /open_api/v1.3/smart_plus/ad/get/` returns ads with a proper `creative_list[]` array. Each item in `creative_list` has its own `identity_id` — these are the actual per-creative spark codes. This is confirmed by debug output showing different `identity_id` values across different Smart+ ads.

### Identity Endpoint Returned Nothing
`GET /open_api/v1.3/identity/get/?identity_type=AUTH_CODE` — tried this first. Returns 0 results for suspended accounts. Not reliable.

### What the Debug Showed
Running the debug button on 5 Smart+ ads revealed:
```
Ad 1 → creative_list[].identity_id: 7564348129115489302 (×18 repeats)
Ad 2 → creative_list[].identity_id: 7564472955620443158 (×17 repeats)
Ad 3 → creative_list[].identity_id: 7564472955620443158 (×15 repeats)
...
```
So the deduplication correctly surfaces **2 unique spark codes** across all ads in this account for this campaign structure.

---

## What Still Needs to Be Done

### The Core Problem: Missing Post IDs

In the TikTok Ads Manager UI, under **Campaigns → Insights → Creative Assets**, there is a table showing:

| Creative Asset | Identity | Post ID | Source |
|---|---|---|---|
| Like bro! 😭 | Sarah♥ | 7625675059591941... | TikTok creator... |
| Like bro! 😭 | Sarah♥ | 7625750373638147... | TikTok creator... |

There are **15 unique rows** (15 unique videos/Post IDs), each authorized by a creator's spark code. This is what we actually want to fetch — the per-video Post IDs, not just the creator-level identity_id.

### What We Know About the Right Endpoint

The SDK documents `GET /open_api/v1.3/smart_plus/material_report/overview/` which corresponds to this exact UI page.

**Required params:**
- `advertiser_id` (string, required)
- `dimensions` (list, required, min 2 items)
- `start_date` (string, YYYY-MM-DD format, required unless `query_lifetime=true`)
- `end_date` (string, YYYY-MM-DD format, required unless `query_lifetime=true`)

**Valid dimension values** (discovered via API error):
```
ad_text_entity_id, adgroup_id, advertiser_id, call_to_action_entity_id,
campaign_id, interactive_add_on_entity_id, main_material_id, smart_plus_ad_id
```

**The blocker:** `tiktok_item_id` and `identity_id` are NOT valid dimension values. So we can't directly request Post ID or creator identity as dimensions. The `main_material_id` is TikTok's internal material ID — it is **unknown whether this maps to the Post ID** shown in the UI.

### What Needs to Be Figured Out

1. **Does `main_material_id` = Post ID?**
   - Try calling `material_report/overview/` with `dimensions: ["main_material_id", "smart_plus_ad_id"]` + date range
   - Check if the `main_material_id` values in the response match the Post IDs visible in the Creative Assets UI table

2. **What metrics are available?**
   - The `metrics` param is optional — unknown which metric names expose identity/creator info
   - Need to test with common metrics: `spend`, `impressions`, `clicks`, `identity_id`, `tiktok_item_id`
   - May need to inspect the full response shape

3. **Is there a separate material list endpoint?**
   - `GET /open_api/v1.3/smart_plus/material/review_info/` exists in the SDK — may return material IDs + review status + associated post IDs
   - Worth trying with just `advertiser_id` and `smart_plus_ad_ids`

4. **Mapping material_id → tiktok_item_id**
   - Even if `main_material_id` ≠ Post ID directly, there may be a lookup endpoint that resolves material IDs to TikTok Post IDs
   - Check `identity/video/info/` endpoint: `GET /open_api/v1.3/identity/video/info/` takes `identity_id` + `item_id` — could be used to validate/look up specific Post IDs if we know the identity

5. **The actual spark code structure**
   - A "spark code" in TikTok's terminology = a creator generates a code → advertiser enters it → gets `AUTH_CODE` identity (`identity_id`) + access to specific videos (`tiktok_item_id`)
   - We have the `identity_id` (creator auth) — we need the `tiktok_item_id` (specific post) for each creative
   - These likely live in the material report response, just under a different field name

---

## API Credentials

```
App ID:     7622963840885030913
App Secret: cddbb9c8d2ee557a7bebae5a472f953b7bbada81
OAuth URL:  https://business-api.tiktok.com/portal/auth?app_id=7622963840885030913&state=spark_plugin&redirect_uri=https%3A%2F%2Fkinetiksoul.com
```

---

## How to Load the Extension

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select this folder
4. Click the extension icon in your toolbar

---

## How to Use

1. Click **Connect TikTok Account** — authorizes via OAuth
2. Click **auto-detect** (while on TikTok Ads Manager) to fill in Advertiser ID, or paste it manually
3. Click **Fetch Spark Codes** — returns all unique spark codes found in Smart+ campaigns
4. Click any code to copy, or **Copy all codes** for bulk copy

---

## SDK Reference

- Official TikTok Business API SDK: https://github.com/tiktok/tiktok-business-api-sdk
- Identity API docs: `python_sdk/docs/IdentityApi.md`
- Reporting API (Smart+ material report): `python_sdk/business_api_client/api/reporting_api.py`
- Smart+ creative structure: `python_sdk/docs/SmartPlusAdCreateBodyCreativeInfo.md`
