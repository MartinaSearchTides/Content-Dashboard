const SERVER = "https://seatable.searchtides.com";

/** SeaTable diamond emoji prefix (same pattern as QUOTAS Client column). */
const D = "\u{1F539}";

/** Canonical CM workflow statuses (exact labels). */
const CM_STATUSES = [
  "Content Requested",
  "Assigned",
  "Ready for Delivery",
  "Delivered to BO",
  "Revisions Required",
  "Revisions Complete",
  "Ready for Edits",
  "Editing",
  "For Charlotte's Review"
];

const STATUS_SET = new Set(CM_STATUSES);

/** UI grouping: done (green), in_progress (amber), queue (neutral). */
const CATEGORY_FOR_STATUS = {
  "Content Requested": "queue",
  Assigned: "in_progress",
  "Ready for Delivery": "done",
  "Delivered to BO": "done",
  "Revisions Required": "in_progress",
  "Revisions Complete": "in_progress",
  "Ready for Edits": "in_progress",
  Editing: "in_progress",
  "For Charlotte's Review": "in_progress"
};

const CM_VIEW = "Default View_for dashboard";

async function getAccess(apiToken) {
  const res = await fetch(SERVER + "/api/v2.1/dtable/app-access-token/", {
    headers: { Authorization: "Token " + apiToken, Accept: "application/json" }
  });
  const text = await res.text();
  if (!res.ok) throw new Error("getAccess " + res.status + ": " + text.substring(0, 200));
  return JSON.parse(text);
}

async function listRows(access, tableName, viewName) {
  const base = access.dtable_server.endsWith("/") ? access.dtable_server : access.dtable_server + "/";
  const uuid = access.dtable_uuid;
  const tok = access.access_token;
  let rows = [];
  let start = 0;
  const limit = 1000;

  while (true) {
    let url =
      base +
      "api/v2/dtables/" +
      uuid +
      "/rows/?table_name=" +
      encodeURIComponent(tableName) +
      "&limit=" +
      limit +
      "&start=" +
      start +
      "&convert_keys=true";
    if (viewName && viewName.trim()) url += "&view_name=" + encodeURIComponent(viewName);

    const res = await fetch(url, {
      headers: { Authorization: "Token " + tok, Accept: "application/json" }
    });
    const text = await res.text();
    if (!res.ok) throw new Error("listRows(" + tableName + ") " + res.status + ": " + text.substring(0, 200));

    const batch = (JSON.parse(text).rows || []);
    rows = rows.concat(batch);
    if (batch.length < limit) break;
    start += limit;
  }
  return rows;
}

function resolve(val) {
  if (Array.isArray(val)) val = val[0] || null;
  if (val && typeof val === "object") return val.display_value || val.name || null;
  return val || null;
}

function pick(row, ...keys) {
  for (const k of keys) {
    if (k in row && row[k] != null) return row[k];
  }
  return null;
}

function resolveClient(row) {
  const v = pick(row, "CLIENT*", "Client", D + "Client", "client");
  return resolve(v);
}

function resolveStatus(row) {
  const v = pick(row, D + "C STATUS", "C STATUS", D + "C Status", "C Status");
  return resolve(v);
}

function resolveLinkValue(row) {
  const v = pick(row, D + "Link Value", "Link Value", "LV", D + " LV");
  const n = parseFloat(resolve(v));
  return isNaN(n) ? 0 : n;
}

function monthShort() {
  return new Date().toLocaleString("en-US", { month: "short" });
}

function prodMonth() {
  return new Date().toLocaleString("en-US", { month: "short", year: "numeric" });
}

function currentYear() {
  return new Date().getFullYear();
}

function emptyStatusMap() {
  const o = {};
  for (const s of CM_STATUSES) o[s] = { lv: 0, records: 0 };
  return o;
}

function emptyCategoryMap() {
  return {
    done: { lv: 0, records: 0 },
    in_progress: { lv: 0, records: 0 },
    queue: { lv: 0, records: 0 }
  };
}

function roundLv(x) {
  return Math.round(x * 100) / 100;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=60");

  const HSS_TOKEN = (process.env.OM_API_TOKEN || "").trim();
  if (!HSS_TOKEN) {
    return res.status(500).json({ ok: false, error: "Missing env var: OM_API_TOKEN" });
  }

  try {
    const PM = prodMonth();
    const MS = monthShort();
    const CY = currentYear();

    const hssAccess = await getAccess(HSS_TOKEN);
    if (!hssAccess.dtable_server || !hssAccess.dtable_uuid || !hssAccess.access_token) {
      return res.status(500).json({
        ok: false,
        error: "Invalid SeaTable token response: missing dtable_server, dtable_uuid, or access_token."
      });
    }

    const warnings = [];

    let quotaRows;
    try {
      quotaRows = await listRows(hssAccess, "QUOTAS", "");
    } catch (e) {
      throw new Error("QUOTAS table fetch failed: " + e.message);
    }

    let cmRows;
    let cmViewUsed = CM_VIEW;
    try {
      cmRows = await listRows(hssAccess, "CM", CM_VIEW);
    } catch (cmErr) {
      try {
        cmRows = await listRows(hssAccess, "CM", "");
        cmViewUsed = "";
        warnings.push({
          type: "cm_view_fallback",
          message:
            "CM view \"" +
            CM_VIEW +
            "\" failed: " +
            cmErr.message +
            " Using all CM rows (no view filter)."
        });
      } catch (cmErr2) {
        throw new Error(
          "CM table failed with view: " +
            cmErr.message +
            " | without view: " +
            cmErr2.message
        );
      }
    }

    const quotas = {};
    for (const row of quotaRows) {
      const client = resolve(row[D + "Client"] || row["Client"]);
      const monthVal = row[D + "Month"] || row["Month"] || "";
      const yearVal = row[D + "Year"] || row["Year"] || "";
      const quotaVal = row[D + " LV Quota"] || row["LV Quota"] || 0;
      if (!client || !monthVal) continue;
      const mOk = monthVal.trim().toLowerCase() === MS.toLowerCase();
      const yOk = yearVal ? String(yearVal).trim() === String(CY) : true;
      if (mOk && yOk) quotas[client] = parseFloat(quotaVal) || 0;
    }

    const byClient = {};
    const unknownStatusCounts = {};
    let skippedNoClient = 0;

    let cmLvSumCheck = 0;

    for (const row of cmRows) {
      const client = resolveClient(row);
      const statusRaw = resolveStatus(row);
      const status = statusRaw ? String(statusRaw).trim() : "";
      const lv = resolveLinkValue(row);

      if (!client) {
        skippedNoClient += 1;
        continue;
      }

      cmLvSumCheck += lv;

      if (!byClient[client]) {
        byClient[client] = {
          by_status: emptyStatusMap(),
          by_category: emptyCategoryMap(),
          total_lv: 0,
          total_records: 0,
          done_lv: 0
        };
      }

      const st = byClient[client].by_status;
      const cat = byClient[client].by_category;

      if (!STATUS_SET.has(status)) {
        unknownStatusCounts[status || "(empty)"] = (unknownStatusCounts[status || "(empty)"] || 0) + 1;
        if (!st._other) st._other = { lv: 0, records: 0 };
        st._other.lv = roundLv(st._other.lv + lv);
        st._other.records += 1;
        byClient[client].total_lv = roundLv(byClient[client].total_lv + lv);
        byClient[client].total_records += 1;
        continue;
      }

      st[status].lv = roundLv(st[status].lv + lv);
      st[status].records += 1;

      const ckey = CATEGORY_FOR_STATUS[status] || "in_progress";
      cat[ckey].lv = roundLv(cat[ckey].lv + lv);
      cat[ckey].records += 1;

      byClient[client].total_lv = roundLv(byClient[client].total_lv + lv);
      byClient[client].total_records += 1;
      if (ckey === "done") {
        byClient[client].done_lv = roundLv(byClient[client].done_lv + lv);
      }
    }

    if (skippedNoClient > 0) {
      warnings.push({
        type: "missing_client",
        message: skippedNoClient + " CM row(s) skipped: missing client/project column."
      });
    }

    for (const k of Object.keys(unknownStatusCounts)) {
      warnings.push({
        type: "unknown_status",
        message: "Unknown C STATUS value: " + JSON.stringify(k) + " (" + unknownStatusCounts[k] + " rows)."
      });
    }

    const allClients = [...new Set([...Object.keys(byClient), ...Object.keys(quotas)])].sort();

    const globalByStatus = emptyStatusMap();
    const globalByCategory = emptyCategoryMap();
    let globalTotalLv = 0;
    let globalTotalRecords = 0;

    const clients = allClients.map(name => {
      const b = byClient[name] || {
        by_status: emptyStatusMap(),
        by_category: emptyCategoryMap(),
        total_lv: 0,
        total_records: 0,
        done_lv: 0
      };

      for (const s of CM_STATUSES) {
        globalByStatus[s].lv = roundLv(globalByStatus[s].lv + b.by_status[s].lv);
        globalByStatus[s].records += b.by_status[s].records;
      }
      for (const ck of ["done", "in_progress", "queue"]) {
        globalByCategory[ck].lv = roundLv(globalByCategory[ck].lv + b.by_category[ck].lv);
        globalByCategory[ck].records += b.by_category[ck].records;
      }
      globalTotalLv = roundLv(globalTotalLv + b.total_lv);
      globalTotalRecords += b.total_records;

      const quota = quotas[name] || 0;
      const rowOut = {
        client: name,
        quota,
        total_lv: b.total_lv,
        total_records: b.total_records,
        done_lv: b.done_lv,
        by_status: b.by_status,
        by_category: b.by_category
      };

      if (b.by_status._other) {
        rowOut.by_status_other = b.by_status._other;
      }

      return rowOut;
    });

    let recomputedLv = 0;
    for (const s of CM_STATUSES) recomputedLv = roundLv(recomputedLv + globalByStatus[s].lv);
    if (Object.keys(unknownStatusCounts).length) {
      for (const name of allClients) {
        const o = byClient[name]?.by_status?._other;
        if (o) recomputedLv = roundLv(recomputedLv + o.lv);
      }
    }

    if (Math.abs(recomputedLv - cmLvSumCheck) > 0.01) {
      warnings.push({
        type: "lv_sum_mismatch",
        message:
          "Aggregated LV (" +
          recomputedLv +
          ") differs from row sum (" +
          roundLv(cmLvSumCheck) +
          "); check rounding or skipped rows."
      });
    }

    const bottleneck = {
      ready_for_edits: { lv: 0, records: 0 },
      content_requested: { lv: 0, records: 0 }
    };
    for (const c of clients) {
      const st = c.by_status;
      bottleneck.ready_for_edits.lv = roundLv(bottleneck.ready_for_edits.lv + (st["Ready for Edits"]?.lv || 0));
      bottleneck.ready_for_edits.records += st["Ready for Edits"]?.records || 0;
      bottleneck.content_requested.lv = roundLv(bottleneck.content_requested.lv + (st["Content Requested"]?.lv || 0));
      bottleneck.content_requested.records += st["Content Requested"]?.records || 0;
    }

    const totQuota = allClients.reduce((s, n) => s + (quotas[n] || 0), 0);
    const quotaAttainmentPct = totQuota > 0 ? Math.round((globalTotalLv / totQuota) * 100) : 0;

    return res.status(200).json({
      ok: true,
      generated: new Date().toISOString(),
      prod_month: PM,
      warnings,
      status_order: CM_STATUSES,
      categories: {
        done: ["Ready for Delivery", "Delivered to BO"],
        in_progress: [
          "Assigned",
          "Revisions Required",
          "Revisions Complete",
          "Ready for Edits",
          "Editing",
          "For Charlotte's Review"
        ],
        queue: ["Content Requested"]
      },
      global: {
        total_lv: roundLv(globalTotalLv),
        total_records: globalTotalRecords,
        total_quota: roundLv(totQuota),
        quota_attainment_pct: quotaAttainmentPct,
        by_status: globalByStatus,
        by_category: globalByCategory,
        bottleneck
      },
      debug: {
        cm_rows: cmRows.length,
        cm_view: cmViewUsed || "(all rows)",
        quotas_loaded: Object.keys(quotas).length,
        clients: allClients.length
      },
      clients
    });
  } catch (err) {
    console.error("Dashboard API error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
