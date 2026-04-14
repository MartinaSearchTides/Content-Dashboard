const SERVER = "https://seatable.searchtides.com";

const D = "\u{1F539}";

const OM_VIEW = "Martina Dashboard View";

/** STATUS 1 (OM) — BTF only; negotiation etc. excluded. */
const BTF_STATUS = new Set([
  "Published",
  "Pending",
  "Content Requested",
  "Ready for Delivery",
  "Revisions Requested"
]);

/** Produced = Published + Pending + Ready for Delivery (content done). */
const PRODUCED_STATUS = new Set(["Published", "Pending", "Ready for Delivery"]);

const STATUS_CONTENT_REQUESTED = "Content Requested";
const STATUS_REVISIONS_REQUESTED = "Revisions Requested";

/** CM Status breakdown when STATUS 1 = Content Requested. */
const CM_STATUS_CONTENT_REQUESTED = "Content Requested";

const CM_STATUS_DETAIL_ORDER = [
  "Ready for Edits",
  "Editing",
  "Assigned",
  "Revisions Required",
  "Revisions Complete",
  "For Charlotte's Review"
];

const CM_STATUS_KNOWN = new Set([
  CM_STATUS_CONTENT_REQUESTED,
  ...CM_STATUS_DETAIL_ORDER,
  "For Charlotte's review"
]);

/** LV from column LV; everyone else 1 record = 1 LV. */
const LV_COLUMN_CLIENTS = new Set([
  "FanDuel",
  "FanDuel Casino",
  "FanDuel Racing",
  "CreditNinja",
  "Greenvelope"
]);

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

function resolveStatus1(row) {
  const v = row["STATUS 1"];
  const r = resolve(v);
  return r ? String(r).trim() : "";
}

function resolveCmStatus(row) {
  const v = pick(row, D + "CM Status", "CM Status", D + "CM status", "CM status");
  const r = resolve(v);
  if (!r) return "";
  const s = String(r).trim();
  if (s === "For Charlotte's review") return "For Charlotte's Review";
  return s;
}

function rawOmLv(row) {
  const v = row["LV"];
  const r = resolve(v);
  const n = parseFloat(String(r != null ? r : "").replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function rowLvUnit(client, rawLv) {
  if (LV_COLUMN_CLIENTS.has(client)) {
    return roundLv(rawLv);
  }
  return 1;
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

function metricZero() {
  return { lv: 0, records: 0 };
}

function addMetric(m, lv) {
  m.lv = roundLv(m.lv + lv);
  m.records += 1;
}

function emptyClientBuckets() {
  const cm_detail = {};
  for (const s of CM_STATUS_DETAIL_ORDER) cm_detail[s] = metricZero();
  return {
    published: metricZero(),
    pending: metricZero(),
    content_requested: metricZero(),
    ready_for_delivery: metricZero(),
    revisions_requested: metricZero(),
    cm_cr_literal: metricZero(),
    cm_detail,
    cm_other: metricZero(),
    outside_btf: metricZero()
  };
}

function roundLv(x) {
  return Math.round(x * 100) / 100;
}

function addOmRow(b, status1, cmStatus, lv) {
  const s1 = status1 || "";
  const cm = cmStatus || "";

  if (!BTF_STATUS.has(s1)) {
    addMetric(b.outside_btf, lv);
    return;
  }

  switch (s1) {
    case "Published":
      addMetric(b.published, lv);
      break;
    case "Pending":
      addMetric(b.pending, lv);
      break;
    case "Ready for Delivery":
      addMetric(b.ready_for_delivery, lv);
      break;
    case "Revisions Requested":
      addMetric(b.revisions_requested, lv);
      break;
    case STATUS_CONTENT_REQUESTED:
      addMetric(b.content_requested, lv);
      if (cm === CM_STATUS_CONTENT_REQUESTED || cm === "Content Requested") {
        addMetric(b.cm_cr_literal, lv);
      } else if (CM_STATUS_DETAIL_ORDER.includes(cm)) {
        addMetric(b.cm_detail[cm], lv);
      } else if (cm) {
        addMetric(b.cm_other, lv);
      } else {
        addMetric(b.cm_other, lv);
      }
      break;
    default:
      addMetric(b.outside_btf, lv);
  }
}

function mergeMetric(into, from) {
  into.lv = roundLv(into.lv + from.lv);
  into.records += from.records;
}

function mergeBuckets(into, from) {
  mergeMetric(into.published, from.published);
  mergeMetric(into.pending, from.pending);
  mergeMetric(into.content_requested, from.content_requested);
  mergeMetric(into.ready_for_delivery, from.ready_for_delivery);
  mergeMetric(into.revisions_requested, from.revisions_requested);
  mergeMetric(into.cm_cr_literal, from.cm_cr_literal);
  mergeMetric(into.cm_other, from.cm_other);
  mergeMetric(into.outside_btf, from.outside_btf);
  for (const s of CM_STATUS_DETAIL_ORDER) {
    mergeMetric(into.cm_detail[s], from.cm_detail[s]);
  }
}

function derivedProduced(b) {
  return {
    lv: roundLv(b.published.lv + b.pending.lv + b.ready_for_delivery.lv),
    records: b.published.records + b.pending.records + b.ready_for_delivery.records
  };
}

function derivedStillToProduce(b) {
  return {
    lv: roundLv(b.content_requested.lv + b.revisions_requested.lv),
    records: b.content_requested.records + b.revisions_requested.records
  };
}

function btfTotal(b) {
  return roundLv(
    b.published.lv +
      b.pending.lv +
      b.content_requested.lv +
      b.ready_for_delivery.lv +
      b.revisions_requested.lv );
}

function sumAllBucketsLv(b) {
  let s = btfTotal(b) + b.outside_btf.lv;
  return roundLv(s);
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

    let omRows;
    try {
      omRows = await listRows(hssAccess, "OM", OM_VIEW);
    } catch (e) {
      throw new Error("OM table fetch failed: " + e.message);
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
    /** cm label -> { total, byClient: { [clientName]: rowCount } } */
    const unknownCm = {};
    let skippedNoClient = 0;
    let lvSumCheck = 0;

    for (const row of omRows) {
      const pm = (row["Prod Month"] || "").trim();
      if (pm !== PM) continue;

      const client = resolveClient(row);
      const s1 = resolveStatus1(row);
      const cm = resolveCmStatus(row);
      const rawLv = rawOmLv(row);
      const lv = rowLvUnit(client, rawLv);

      if (!client) {
        skippedNoClient += 1;
        continue;
      }

      lvSumCheck += lv;

      if (!byClient[client]) {
        byClient[client] = emptyClientBuckets();
      }

      if (s1 === STATUS_CONTENT_REQUESTED && cm && !CM_STATUS_KNOWN.has(cm)) {
        if (!unknownCm[cm]) unknownCm[cm] = { total: 0, byClient: {} };
        unknownCm[cm].total += 1;
        unknownCm[cm].byClient[client] = (unknownCm[cm].byClient[client] || 0) + 1;
      }

      addOmRow(byClient[client], s1, cm, lv);
    }

    if (skippedNoClient > 0) {
      warnings.push({
        type: "missing_client",
        message: skippedNoClient + " OM row(s) skipped: missing client column."
      });
    }

    for (const k of Object.keys(unknownCm).sort()) {
      const u = unknownCm[k];
      const clientParts = Object.keys(u.byClient)
        .sort()
        .map(cn => cn + " (" + u.byClient[cn] + ")");
      warnings.push({
        type: "unknown_cm_status",
        message:
          "Unknown CM Status under Content Requested: " +
          JSON.stringify(k) +
          " (" +
          u.total +
          " rows; " +
          clientParts.join(", ") +
          ")."
      });
    }

    const allClients = [...new Set([...Object.keys(byClient), ...Object.keys(quotas)])].sort();

    const globalBuckets = emptyClientBuckets();
    let globalRecords = 0;

    const clients = allClients.map(name => {
      const b = byClient[name] || emptyClientBuckets();
      mergeBuckets(globalBuckets, b);
      globalRecords +=
        b.published.records +
        b.pending.records +
        b.content_requested.records +
        b.ready_for_delivery.records +
        b.revisions_requested.records +
        b.outside_btf.records;

      const quota = quotas[name] || 0;
      const produced = derivedProduced(b);
      const still = derivedStillToProduce(b);
      const btfRec =
        b.published.records +
        b.pending.records +
        b.content_requested.records +
        b.ready_for_delivery.records +
        b.revisions_requested.records;

      return {
        client: name,
        quota,
        published: b.published,
        pending: b.pending,
        ready_for_delivery: b.ready_for_delivery,
        content_requested: b.content_requested,
        revisions_requested: b.revisions_requested,
        produced,
        still_to_produce: still,
        btf_total: { lv: btfTotal(b), records: btfRec },
        cm_cr_literal: b.cm_cr_literal,
        cm_detail: b.cm_detail,
        cm_other: b.cm_other
      };
    });

    const recomputed = sumAllBucketsLv(globalBuckets);
    if (Math.abs(recomputed - lvSumCheck) > 0.01) {
      warnings.push({
        type: "lv_sum_mismatch",
        message:
          "Aggregated LV (" + recomputed + ") differs from row sum (" + roundLv(lvSumCheck) + ")."
      });
    }

    const totQuota = allClients.reduce((s, n) => s + (quotas[n] || 0), 0);
    const gProd = derivedProduced(globalBuckets);
    const quotaAttainmentPct = totQuota > 0 ? Math.round((gProd.lv / totQuota) * 100) : 0;

    const gBtfRec =
      globalBuckets.published.records +
      globalBuckets.pending.records +
      globalBuckets.content_requested.records +
      globalBuckets.ready_for_delivery.records +
      globalBuckets.revisions_requested.records;

    return res.status(200).json({
      ok: true,
      generated: new Date().toISOString(),
      prod_month: PM,
      warnings,
      cm_status_detail_order: CM_STATUS_DETAIL_ORDER,
      lv_column_clients: [...LV_COLUMN_CLIENTS],
      global: {
        published: globalBuckets.published,
        pending: globalBuckets.pending,
        ready_for_delivery: globalBuckets.ready_for_delivery,
        content_requested: globalBuckets.content_requested,
        revisions_requested: globalBuckets.revisions_requested,
        produced: derivedProduced(globalBuckets),
        still_to_produce: derivedStillToProduce(globalBuckets),
        cm_cr_literal: globalBuckets.cm_cr_literal,
        cm_detail: globalBuckets.cm_detail,
        cm_other: globalBuckets.cm_other,
        btf_total: { lv: btfTotal(globalBuckets), records: gBtfRec },
        total_quota: roundLv(totQuota),
        quota_attainment_pct: quotaAttainmentPct,
        total_records: globalRecords
      },
      debug: {
        om_rows_in_month: omRows.filter(r => (r["Prod Month"] || "").trim() === PM).length,
        om_view: OM_VIEW,
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
