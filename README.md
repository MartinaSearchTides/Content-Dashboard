# SearchTides Content Dashboard

Dashboard for the content **BTF** pipeline (Lead Value, LV) from SeaTable **HSS**. Data comes only from table **OM**, view **Martina Dashboard View**. Monthly **BTF** targets still come from **QUOTAS** (same month/year rules as the former linkbuilding internal quotas).

## Setup

### Vercel

1. Import the repository in [vercel.com](https://vercel.com) and deploy (default settings are fine).

### Environment variables

| Name | Description |
|------|-------------|
| `OM_API_TOKEN` | SeaTable API token for the **HSS** base (OM + QUOTAS). |

After changing variables, redeploy.

## Data model

### Time filter

- Rows are filtered by **Prod Month** on OM, matching the current month in short form with year (for example `Apr 2026`), same idea as the linkbuilding dashboard’s production month.

### STATUS 1 (BTF)

Only these five values count as **in BTF**; everything else is **outside BTF** (for example negotiation):

- Published  
- Pending  
- Content Requested  
- Ready for Delivery  
- Revisions Requested  

**Produced** = Published + Pending + Ready for Delivery (content done from a delivery perspective).

**Still to produce** = Content Requested + Revisions Requested.

### CM Status (under Content Requested)

When **STATUS 1** is **Content Requested**, the dashboard breaks rows down by **CM Status**:

- Content Requested (literal CM label)  
- Ready for Edits, Editing, Assigned, Revisions Required, Revisions Complete, For Charlotte’s Review (normalized from `For Charlotte's review` if needed)  

Unknown CM Status values roll into **Other CM Status** and trigger API warnings.

### LV (Lead Value)

For **FanDuel**, **FanDuel Casino**, **FanDuel Racing**, **CreditNinja**, and **Greenvelope**, LV is taken from the **LV** column on OM. For all other clients, **one row = 1 LV**.

### QUOTAS

- Monthly LV quota per client from **QUOTAS** (`LV Quota` and emoji-prefixed variants), matched to the **current calendar month** and year.

## Notes

- API responses are cached for about 5 minutes (`s-maxage=300`) to reduce SeaTable rate limits.
- Refresh the page or use **Refresh** to reload.
