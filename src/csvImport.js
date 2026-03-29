function toSafeString(value) {
  return String(value ?? "").trim();
}

function normalizeHeader(value) {
  return toSafeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseCsvLine(line, delimiter = ",") {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result.map((value) => value.trim());
}

export function parseCsvText(csvText = "") {
  const lines = String(csvText || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (!lines.length) {
    return { headers: [], rows: [] };
  }

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = parseCsvLine(lines[0], delimiter).map((header) => toSafeString(header));
  const rows = lines
    .slice(1)
    .map((line) => {
      const cells = parseCsvLine(line, delimiter);
      const row = {};
      headers.forEach((header, index) => {
        row[header] = toSafeString(cells[index]);
      });
      return row;
    })
    .filter((row) => Object.values(row).some((value) => toSafeString(value)));

  return { headers, rows };
}

function parseNumber(value) {
  const normalized = toSafeString(value)
    .replace(/[$,%\s]/g, "")
    .replace(/\((.*)\)/, "-$1")
    .replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateTime(value) {
  const raw = toSafeString(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  const normalized = raw.replace(/\./g, "/");
  const parsedNormalized = new Date(normalized);
  if (!Number.isNaN(parsedNormalized.getTime())) return parsedNormalized;
  return null;
}

function getField(row, aliases = []) {
  const entries = Object.entries(row || {});
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const entry = entries.find(([key]) => normalizeHeader(key) === normalizedAlias);
    if (entry && toSafeString(entry[1])) return toSafeString(entry[1]);
  }
  return "";
}

const CSV_PRESET_LIBRARY = [
  {
    id: "tradovate-csv-v1",
    label: "Tradovate CSV",
    source: "tradovate",
    version: 1,
    matchHeaders: {
      required: [["symbol", "contract"]],
      strong: ["buy/sell", "net p/l", "closed at", "opened at"],
      optional: ["commission", "fees", "trade id", "quantity", "entry price", "exit price"],
    },
    mapping: {
      symbol: ["symbol", "contract"],
      side: ["buy/sell", "side"],
      entryPrice: ["entry price", "entry"],
      exitPrice: ["exit price", "exit"],
      quantity: ["quantity", "qty", "contracts"],
      openedAt: ["opened at", "entry time", "entry date/time"],
      closedAt: ["closed at", "exit time", "exit date/time", "date/time"],
      pnl: ["net p/l", "p&l", "profit"],
      commission: ["commission", "commissions"],
      fees: ["fees", "exchange fee"],
      providerTradeId: ["trade id", "trade #", "order id", "id"],
    },
    defaults: {
      tradeType: "live",
      importSource: "csv",
    },
  },
  {
    id: "ninjatrader-csv-v1",
    label: "NinjaTrader CSV",
    source: "ninjatrader",
    version: 1,
    matchHeaders: {
      required: [["instrument", "symbol"]],
      strong: ["market pos.", "entry price", "exit price", "entry time", "exit time"],
      optional: ["profit", "commission", "qty", "trade #", "account"],
    },
    mapping: {
      symbol: ["instrument", "symbol"],
      side: ["market pos.", "side", "action"],
      entryPrice: ["entry price", "entry"],
      exitPrice: ["exit price", "exit"],
      quantity: ["qty", "quantity", "contracts"],
      openedAt: ["entry time", "entry date/time", "opened at"],
      closedAt: ["exit time", "exit date/time", "closed at", "date/time"],
      pnl: ["profit", "profit/loss", "pnl"],
      commission: ["commission", "commissions"],
      fees: ["fees", "exchange fee"],
      providerTradeId: ["trade #", "trade id", "id", "order id"],
    },
    defaults: {
      tradeType: "live",
      importSource: "csv",
    },
  },
  {
    id: "tradestation-csv-v1",
    label: "TradeStation CSV",
    source: "tradestation",
    version: 1,
    matchHeaders: {
      required: [["symbol", "market symbol"]],
      strong: ["entry date/time", "exit date/time", "profit/loss"],
      optional: ["trade #", "quantity", "entry price", "exit price", "commission", "fees"],
    },
    mapping: {
      symbol: ["market symbol", "symbol", "instrument"],
      side: ["side", "action"],
      entryPrice: ["entry price", "entry"],
      exitPrice: ["exit price", "exit"],
      quantity: ["quantity", "qty", "contracts"],
      openedAt: ["entry date/time", "entry time", "opened at"],
      closedAt: ["exit date/time", "exit time", "closed at"],
      pnl: ["profit/loss", "net p/l", "p&l", "profit"],
      commission: ["commission", "commissions"],
      fees: ["fees"],
      providerTradeId: ["trade #", "trade id", "id", "order id"],
    },
    defaults: {
      tradeType: "live",
      importSource: "csv",
    },
  },
  {
    id: "generic-futures-csv-v1",
    label: "Generic Futures CSV",
    source: "csv",
    version: 1,
    matchHeaders: {
      required: [["symbol", "instrument", "contract"]],
      strong: ["date", "time", "entry", "exit", "pnl", "profit"],
      optional: ["side", "qty", "quantity", "commission", "fees", "trade id"],
    },
    mapping: {
      symbol: ["symbol", "instrument", "contract", "market symbol"],
      side: ["side", "buy/sell", "market pos.", "action", "direction"],
      entryPrice: ["entry price", "entry", "avg entry", "buy price"],
      exitPrice: ["exit price", "exit", "avg exit", "sell price"],
      quantity: ["qty", "quantity", "contracts"],
      openedAt: ["opened at", "entry date/time", "entry time"],
      closedAt: ["closed at", "exit date/time", "exit time", "date/time", "date"],
      pnl: ["net p/l", "profit/loss", "p&l", "profit", "pnl"],
      commission: ["commission", "commissions"],
      fees: ["fees", "exchange fee"],
      providerTradeId: ["trade #", "trade id", "id", "order id"],
    },
    defaults: {
      tradeType: "live",
      importSource: "csv",
    },
  },
];

const FALLBACK_PRESET_ID = "generic-futures-csv-v1";

function buildPresetAliasMap(preset) {
  return Object.fromEntries(
    Object.entries(preset.mapping || {}).map(([fieldName, aliases]) => [fieldName, Array.isArray(aliases) ? aliases : []])
  );
}

function resolvePresetById(presetId) {
  return CSV_PRESET_LIBRARY.find((item) => item.id === presetId) || CSV_PRESET_LIBRARY[CSV_PRESET_LIBRARY.length - 1];
}

export function getImportPresets() {
  return CSV_PRESET_LIBRARY.map((preset) => ({ id: preset.id, label: preset.label, source: preset.source, version: preset.version }));
}

export function detectCsvFormat(headers = []) {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));

  const scored = CSV_PRESET_LIBRARY.map((preset) => {
    const requiredGroups = preset.matchHeaders?.required || [];
    const strongHeaders = preset.matchHeaders?.strong || [];
    const optionalHeaders = preset.matchHeaders?.optional || [];

    const requiredMatches = requiredGroups.reduce((count, group) => {
      const hasGroup = group.some((alias) => normalizedHeaders.includes(normalizeHeader(alias)));
      return count + (hasGroup ? 1 : 0);
    }, 0);

    const strongMatches = strongHeaders.reduce((count, alias) => count + (normalizedHeaders.includes(normalizeHeader(alias)) ? 1 : 0), 0);
    const optionalMatches = optionalHeaders.reduce((count, alias) => count + (normalizedHeaders.includes(normalizeHeader(alias)) ? 1 : 0), 0);
    const score = requiredMatches * 6 + strongMatches * 2 + optionalMatches;

    return {
      presetId: preset.id,
      label: preset.label,
      source: preset.source,
      score,
      requiredMatches,
      strongMatches,
      optionalMatches,
    };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0] || null;
  const second = scored[1] || null;
  const recommendedPresetId = top && top.score > 0 ? top.presetId : FALLBACK_PRESET_ID;

  let confidence = "low";
  if (top && top.score >= 13 && (!second || top.score - second.score >= 3)) confidence = "high";
  else if (top && top.score >= 8) confidence = "medium";

  return {
    confidence,
    recommendedPresetId,
    candidates: scored.filter((item) => item.score > 0).slice(0, 3),
  };
}

function deriveSideFromRaw(sideRaw) {
  const normalized = toSafeString(sideRaw).toLowerCase();
  if (!normalized) return null;
  if (["buy", "long", "b"].some((value) => normalized === value || normalized.startsWith(`${value} `))) return "long";
  if (["sell", "short", "s"].some((value) => normalized === value || normalized.startsWith(`${value} `))) return "short";
  return null;
}

function buildTradeSignature(value) {
  const symbol = String(value?.instrument || value?.symbol || "").trim().toUpperCase();
  const openedAt = String(value?.openedAt || value?.closedAt || "").trim();
  const entryPrice = Number(value?.entryPrice || 0);
  const exitPrice = Number(value?.exitPrice || 0);
  const quantity = Number(value?.quantity || 0);
  const pnl = Number(value?.netPnl ?? value?.pnl ?? 0);
  return `${symbol}|${openedAt}|${entryPrice}|${exitPrice}|${quantity}|${pnl}`;
}

export function buildTradeDeduplicationKey(trade = {}) {
  const source = toSafeString(trade.source || trade.importSource || "csv").toLowerCase();
  const providerTradeId = toSafeString(trade.providerTradeId || "");
  const stableId = toSafeString(trade.id || "");
  if (source && providerTradeId) return `provider:${source}:${providerTradeId}`;
  if (stableId) return `id:${stableId}`;
  return `signature:${buildTradeSignature(trade)}`;
}

function normalizeCsvRowToTrade(row = {}, preset, index) {
  const mapping = buildPresetAliasMap(preset);
  const symbol = getField(row, mapping.symbol).toUpperCase() || "MNQ";
  const pnl = parseNumber(getField(row, mapping.pnl)) ?? 0;
  const quantity = parseNumber(getField(row, mapping.quantity));
  const entryPrice = parseNumber(getField(row, mapping.entryPrice));
  const exitPrice = parseNumber(getField(row, mapping.exitPrice));
  const commission = parseNumber(getField(row, mapping.commission)) ?? 0;
  const fees = parseNumber(getField(row, mapping.fees)) ?? 0;
  const providerTradeId = getField(row, mapping.providerTradeId) || null;
  const side = deriveSideFromRaw(getField(row, mapping.side));
  const closedAtDate = parseDateTime(getField(row, mapping.closedAt));
  const openedAtDate = parseDateTime(getField(row, mapping.openedAt));
  const timestamp = (closedAtDate || openedAtDate)?.getTime();

  if (!Number.isFinite(timestamp)) return null;

  return {
    id: `${preset.id}-${providerTradeId || index}-${timestamp}`,
    accountId: "",
    source: preset.source || "csv",
    importSource: preset.defaults?.importSource || "csv",
    providerTradeId,
    instrument: symbol,
    symbol,
    side,
    entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
    exitPrice: Number.isFinite(exitPrice) ? exitPrice : null,
    quantity: Number.isFinite(quantity) ? quantity : null,
    openedAt: openedAtDate ? openedAtDate.toISOString() : null,
    closedAt: closedAtDate ? closedAtDate.toISOString() : openedAtDate ? openedAtDate.toISOString() : null,
    timestamp,
    pnl,
    commission,
    fees,
    netPnl: pnl - commission - fees,
    tradeType: preset.defaults?.tradeType === "paper" ? "paper" : "live",
    ruleViolation: false,
    ruleViolationReason: null,
  };
}

export function normalizeCsvRowsToTrades(rows = [], { presetId = FALLBACK_PRESET_ID } = {}) {
  const preset = resolvePresetById(presetId);
  return rows.map((row, index) => normalizeCsvRowToTrade(row, preset, index)).filter(Boolean);
}

export function estimateDuplicateCount(existingTrades = [], incomingTrades = []) {
  const existingKeys = new Set((existingTrades || []).map((trade) => buildTradeDeduplicationKey(trade)));
  return (incomingTrades || []).reduce((count, trade) => {
    const key = buildTradeDeduplicationKey(trade);
    return count + (existingKeys.has(key) ? 1 : 0);
  }, 0);
}
