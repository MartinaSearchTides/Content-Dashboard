# SearchTides LV Dashboard

Real-time LV dashboard pulling data from three SeaTable bases.

## Setup

### 1. GitHub
Push this folder to a new GitHub repository (can be private).

### 2. Vercel
1. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
2. Select this repository
3. Click **Deploy** (default settings are fine)

### 3. Environment Variables
In Vercel → Project Settings → Environment Variables, add:

| Name | Value |
|------|-------|
|

After adding variables, click **Redeploy**.

### 4. Done
Your dashboard is live at `your-project.vercel.app`

## Data sources
- **HSS base** — internal OM data + QUOTAS (internal quotas per client)
- **LBT base** — external linkbuilders (FanDuel, FanDuel Casino, FanDuel Racing, CreditNinja)
- **CMS Master** — journalists/press links for FanDuel only (filtered by Live Link Date current month)

## Notes
- Company quotas and AS fee per LV are stored in browser localStorage — set them once per month via the "edit" button
- Data refreshes automatically on page load, or manually via the Refresh button
- Vercel caches API responses for 5 minutes to avoid hitting SeaTable rate limits
