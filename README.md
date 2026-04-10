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

- **CM** — only rows whose **DATE REQUESTED** (`YYYY-MM-DD`) falls in the **current calendar month** are included. LV from **Link Value**. Clients from `CLIENT*` / `Client` (and fallbacks).
- **QUOTAS** — monthly LV quota per client (`LV Quota` / emoji-prefixed variants), current calendar month and year.

**Link formula** drives **Published**, **Pending**, and **Content Requested** LV totals (those three labels only). **C STATUS** fills the breakdown under Content Requested when Link formula is Content Requested. Unexpected Link formula goes to **Other (Link formula)**; unexpected C STATUS in that case to **Other C STATUS (in CR)**.

**Content signals** (global counts, not LV): rows with **C STATUS** = Content Requested (and subset with non-empty **Topic Suggestions**); rows with **C STATUS** = Ready for Edits.

## Notes

- API responses are cached for about 5 minutes (`s-maxage=300`) to reduce SeaTable rate limits.
- Refresh the page or use the **Refresh** button to reload.
