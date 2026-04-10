const SERVER = "https://seatable.searchtides.com";

/** SeaTable diamond emoji prefix (same pattern as QUOTAS Client column). */
const D = "\u{1F539}";

/** Published: CM rows counted like linkbuilding "Published" + delivered states. */
const STATUS_PUBLISHED = new Set(["Published", "Ready for Delivery", "Delivered to BO"]);

const STATUS_PENDING = new Set(["Pending"]);

/** Literal queue row + pipeline under Content Requested (detail excludes the umbrella label in API order). */
const CR_LITERAL = "Content Requested";

const CONTENT_REQUESTED_DETAIL = [
  "Assigned",
  "Revisions Required",
  "Revisions Complete",
  "Ready for Edits",
  "Editing",
  "For Charlotte's Review"
];

const ALL_KNOWN_STATUS = new Set([
  ...STATUS_PUBLISHED,
  ...STATUS_PENDING,
  CR_LITERAL,
  ...CONTENT_REQUESTED_DETAIL
]);

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
  const v = pick(
    row,
    "CLIENT*",
    D + "CLIENT*",
    "Client",
    D + "Client",
    "client",
    "Brand",
    D + "Brand",
    "Customer",
    D + "Customer",
    "Project"
  );
  const out = resolve(v);
  if (out) return out;
  for (const k of Object.keys(row)) {
    if (/status/i.test(k)) continue;
    const kn = String(k);
    if (/client/i.test(kn) || /brand/i.test(kn) || /^customer$/i.test(kn.trim())) {
      const r = resolve(row[k]);
      if (r) return r;
    }
  }
  return null;
}

function resolveStatus(row) {
  const v = pick(row, D + "C STATUS", "C STATUS", D + "C Status", "C Status");
  return resolve(v);
}

function resolveLinkValue(row) {
  const v = pick(row, D + "Link Value", "Link Value", D + " Link Value");
  const n = parseFloat(String(resolve(v)).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Parse YYYY-MM-DD (or ISO start) or numeric date from SeaTable; compare in calendar Y/M (local). */
function parseYmd(cellVal) {
  if (cellVal == null || cellVal === "") return null;
  const resolved = resolve(cellVal);
  if (resolved == null || resolved === "") return null;
  if (typeof resolved === "number" && !isNaN(resolved)) {
    const d = new Date(resolved);
    if (isNaN(d.getTime())) return null;
    return { y: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
  const s = String(resolved).trim().substring(0, 10);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) return null;
  return { y: +m[1], month: +m[2], day: +m[3] };
}

function filterCmRowsByRequestedMonth(rows, year, month, warnings) {
  const out = [];
  let skippedNoDate = 0;
  for (const row of rows) {
    const raw = pick(row, D + "DATE REQUESTED", "DATE REQUESTED", D + "Date Requested", "Date Requested");
    const ymd = parseYmd(raw);
    if (!ymd) {
      skippedNoDate += 1;
      continue;
    }
    if (ymd.y !== year || ymd.month !== month) continue;
    out.push(row);
  }
  if (skippedNoDate > 0) {
    warnings.push({
      type: "cm_missing_date_requested",
      message:
        skippedNoDate +
        " CM row(s) skipped: DATE REQUESTED missing or not parseable as YYYY-MM-DD."
    });
  }
  return out;
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

function currentMonthNum() {
  return new Date().getMonth() + 1;
}

function metricZero() {
  return { lv: 0, records: 0 };
}

function addMetric(m, lv) {
  m.lv = roundLv(m.lv + lv);
  m.records += 1;
}

function emptyClientBuckets() {
  const cr_detail = {};
  for (const s of CONTENT_REQUESTED_DETAIL) cr_detail[s] = metricZero();
  return {
    published: metricZero(),
    pending: metricZero(),
    content_requested: metricZero(),
    cr_literal: metricZero(),
    cr_detail,
    other: metricZero()
  };
}

function roundLv(x) {
  return Math.round(x * 100) / 100;
}

function addRowToBuckets(b, status, lv) {
  if (STATUS_PUBLISHED.has(status)) {
    addMetric(b.published, lv);
    return;
  }
  if (STATUS_PENDING.has(status)) {
    addMetric(b.pending, lv);
    return;
  }
  if (status === CR_LITERAL) {
    addMetric(b.cr_literal, lv);
    addMetric(b.content_requested, lv);
    return;
  }
  if (CONTENT_REQUESTED_DETAIL.includes(status)) {
    addMetric(b.cr_detail[status], lv);
    addMetric(b.content_requested, lv);
    return;
  }
  addMetric(b.other, lv);
}

function mergeMetric(into, from) {
  into.lv = roundLv(into.lv + from.lv);
  into.records += from.records;
}

function mergeBuckets(into, from) {
  mergeMetric(into.published, from.published);
  mergeMetric(into.pending, from.pending);
  mergeMetric(into.content_requested, from.content_requested);
  mergeMetric(into.cr_literal, from.cr_literal);
  mergeMetric(into.other, from.other);
  for (const s of CONTENT_REQUESTED_DETAIL) {
    mergeMetric(into.cr_detail[s], from.cr_detail[s]);
  }
}

function sumClassifiedLv(b) {
  return roundLv(b.published.lv + b.pending.lv + b.content_requested.lv + b.other.lv);
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
    const CAL_M = currentMonthNum();

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

    const cmRowsMonth = filterCmRowsByRequestedMonth(cmRows, CY, CAL_M, warnings);

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

    for (const row of cmRowsMonth) {
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
        byClient[client] = emptyClientBuckets();
      }

      if (status && !ALL_KNOWN_STATUS.has(status)) {
        unknownStatusCounts[status] = (unknownStatusCounts[status] || 0) + 1;
      }

      addRowToBuckets(byClient[client], status, lv);
    }

    if (skippedNoClient > 0) {
      warnings.push({
        type: "missing_client",
        message: skippedNoClient + " CM row(s) skipped: missing client/project column."
      });
    }
    if (cmRowsMonth.length > 0 && skippedNoClient === cmRowsMonth.length) {
      const sample = cmRowsMonth[0];
      warnings.push({
        type: "client_column_mismatch",
        message:
          "No CM row resolved a client. Sample column keys: " +
          Object.keys(sample)
            .slice(0, 45)
            .map(k => JSON.stringify(k))
            .join(", ")
      });
    }

    for (const k of Object.keys(unknownStatusCounts)) {
      warnings.push({
        type: "unknown_status",
        message: "Unknown C STATUS value: " + JSON.stringify(k) + " (" + unknownStatusCounts[k] + " rows)."
      });
    }

    const allClients = [...new Set([...Object.keys(byClient), ...Object.keys(quotas)])].sort();

    const globalBuckets = emptyClientBuckets();
    let globalTotalRecords = 0;

    const clients = allClients.map(name => {
      const b = byClient[name] || emptyClientBuckets();
      mergeBuckets(globalBuckets, b);
      globalTotalRecords += b.published.records + b.pending.records + b.content_requested.records + b.other.records;

      const quota = quotas[name] || 0;
      const rowOut = {
        client: name,
        quota,
        published: b.published,
        pending: b.pending,
        content_requested: b.content_requested,
        cr_literal: b.cr_literal,
        cr_detail: b.cr_detail,
        other: b.other
      };

      return rowOut;
    });

    const recomputedLv = sumClassifiedLv(globalBuckets);
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

    const totQuota = allClients.reduce((s, n) => s + (quotas[n] || 0), 0);
    const quotaAttainmentPct =
      totQuota > 0 ? Math.round((globalBuckets.published.lv / totQuota) * 100) : 0;

    return res.status(200).json({
      ok: true,
      generated: new Date().toISOString(),
      prod_month: PM,
      warnings,
      content_requested_detail_order: CONTENT_REQUESTED_DETAIL,
      global: {
        published: globalBuckets.published,
        pending: globalBuckets.pending,
        content_requested: globalBuckets.content_requested,
        cr_literal: globalBuckets.cr_literal,
        cr_detail: globalBuckets.cr_detail,
        other: globalBuckets.other,
        total_quota: roundLv(totQuota),
        quota_attainment_pct: quotaAttainmentPct,
        total_records: globalTotalRecords
      },
      debug: {
        cm_rows_fetched: cmRows.length,
        cm_rows_date_requested_month: cmRowsMonth.length,
        date_requested_filter_ym: CY + "-" + String(CAL_M).padStart(2, "0"),
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
