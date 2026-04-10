# SearchTides Content Dashboard

Dashboard for article/content pipeline LV (Lead Value) from SeaTable **HSS**: table **CM**, view **Default View_for dashboard**. Internal **BTF** targets come from **QUOTAS** (same rules as the former linkbuilding “Internal” quotas).

## Setup

### Vercel

1. Import the repository in [vercel.com](https://vercel.com) and deploy (default settings are fine).

### Environment variables

| Name | Description |
|------|-------------|
| `OM_API_TOKEN` | SeaTable API token for the **HSS** base (CM + QUOTAS). |

No other tokens are required.

After changing variables, redeploy.

## Data model

- **CM** — only rows whose **DATE REQUESTED** (`YYYY-MM-DD`) falls in the **current calendar month** are included. LV is the sum of **Link Value** only (not other LV columns). **Records** mode uses row counts per bucket. Grouping by client (`CLIENT*` / `Client` variants) and status (`C STATUS`).
- **QUOTAS** — monthly LV quota per client (`LV Quota` / emoji-prefixed variants), current calendar month and year.

Dashboard buckets: **Published** (includes CM statuses Published, Ready for Delivery, Delivered to BO), **Pending**, **Content Requested** (total of the literal Content Requested status plus Assigned, Revisions Required, Revisions Complete, Ready for Edits, Editing, For Charlotte's Review). Unknown C STATUS values roll into **Other / unknown** with API warnings.

## Notes

- API responses are cached for about 5 minutes (`s-maxage=300`) to reduce SeaTable rate limits.
- Refresh the page or use the **Refresh** button to reload.
