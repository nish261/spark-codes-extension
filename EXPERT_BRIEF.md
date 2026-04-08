# TikTok API Expert Brief — Smart+ Spark Creative Status

## What we're building
Chrome extension that connects to TikTok Business API and shows which Spark Ad creatives are **approved vs disapproved** for a Lead Gen Smart+ campaign.

---

## What we know so far

### Campaign setup
- Campaign type: **Lead Gen Smart+**
- Creative type: **Spark Ads — "Authorized by video code"**
- `identity_type: "AUTH_CODE"` on all creatives
- Account is currently suspended but creatives/data are still accessible via API

### What `/open_api/v1.3/smart_plus/ad/get/` returns
Each ad has a `creative_list[]`. Each creative looks like:
```json
{
  "ad_material_id": "1861771748125041",
  "material_operation_status": "ENABLE",
  "creative_info": {
    "ad_format": "SINGLE_VIDEO",
    "identity_type": "AUTH_CODE",
    "identity_id": "7564472955620443158",
    "tiktok_item_id": "7625740166115691798"
  }
}
```

Top-level ad fields available: `ad_configuration, ad_name, ad_text_list, adgroup_id, adgroup_name, advertiser_id, campaign_id, campaign_name, create_time, creative_list, modify_time, operation_status, page_list, secondary_status, smart_plus_ad_id`

### What we already ruled out
- **`material_operation_status`** — confirmed this is just ON/OFF (operational toggle), NOT policy review status. Everything returns `ENABLE` even for visually disapproved creatives in Ads Manager.
- **`secondary_status` / `operation_status` at ad level** — returns `ADVERTISER_ACCOUNT_PUNISH` or `AD_STATUS_CAMPAIGN_DISABLE` — these reflect the account/campaign state, not individual creative review status.
- **`identity_id`** — confirmed this is TikTok's internal reference ID, not the original creator-generated spark code string. The original code is one-time-use and not retrievable via API after authorization.

---

## The problem we're stuck on

### Attempt: `/open_api/v1.3/smart_plus/material/review_info/`

We call it like this:
```javascript
await apiGet("/smart_plus/material/review_info/", token, {
  advertiser_id:   "7619696811904729105",
  ad_material_ids: JSON.stringify(["1861771748125041", "1861771748125009", ...]), // array of ad_material_ids from creative_list
});
```

**Result:** The call returns successfully (no error thrown, API returns code 0) but the response has no useful data — `rdata.data?.list` is either empty or undefined. All `review_raw` values come back as `undefined`.

We don't know:
1. Whether `ad_material_ids` is the correct parameter name
2. Whether the parameter expects a JSON-stringified array or a raw array
3. Whether this endpoint requires additional parameters we're missing
4. Whether this is even the right endpoint for per-creative review status

---

## Specific questions

1. **Is `/smart_plus/material/review_info/` the correct endpoint** to get creative-level review status (approved/disapproved/pending) for Smart+ Spark Ad creatives?

2. **What are the exact required parameters?** Specifically:
   - Is the param `ad_material_ids`, `material_ids`, or something else?
   - Does it expect a JSON string, comma-separated string, or repeated param?
   - Any other required params besides `advertiser_id`?

3. **What does the response look like?** Can you share a sample JSON response? Specifically what key holds the review status, and what are the enum values (e.g. `APPROVED`, `REVIEW_PASSED`, `DISAPPROVED`, `PENDING`)?

4. **If that's not the right endpoint** — what IS the correct way to get per-creative approval status for Smart+ campaigns that maps to what Ads Manager shows as approved/disapproved?

5. **Is there a `review_status` or similar field directly on the creative object** from `/smart_plus/ad/get/` that we might be missing — e.g. nested inside `ad_configuration` or `creative_info`?

---

## What we need in the end
For each creative in a Smart+ campaign, we need a reliable boolean: **did this creative pass TikTok policy review?** So we can show:

- ✅ Approved & Delivering
- ❌ Disapproved / Problem + reason

The `ad_material_id` is our join key. We have it for every creative.
