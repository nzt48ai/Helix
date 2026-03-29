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
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = toSafeString(cells[index]);
    });
    return row;
  });

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

const PRESET_LIBRARY = [
  {
    id: "tradovate",
    label: "Tradovate CSV",
    source: "tradovate_csv",
    requiredHeaderAliases: [["symbol", "contract"]],
    scoreHeaderAliases: ["buy/sell", "p&l", "net p/l", "closed at", "opened at", "commission", "fees"],
  },
  {
    id: "tradestation",
    label: "TradeStation CSV",
    source: "tradestation_csv",
    requiredHeaderAliases: [["symbol", "market symbol"]],
    scoreHeaderAliases: ["entry date/time", "exit date/time", "profit/loss", "commission", "trade #", "quantity"],
  },
  {
    id: "ninjatrader",
    label: "NinjaTrader CSV",
    source: "ninjatrader_csv",
    requiredHeaderAliases: [["instrument", "symbol"]],
    scoreHeaderAliases: ["market pos.", "entry price", "exit price", "entry time", "exit time", "profit", "account"],
  },
  {
    id: "generic_futures",
    label: "Generic Futures CSV",
    source: "generic_csv",
    requiredHeaderAliases: [["symbol", "instrument", "contract"]],
    scoreHeaderAliases: ["date", "time", "pnl", "profit", "side", "qty", "quantity", "entry", "exit"],
  },
];

export function getImportPresets() {
  return PRESET_LIBRARY.map((preset) => ({ id: preset.id, label: preset.label }));
}

export function detectCsvFormat(headers = []) {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));

  const scored = PRESET_LIBRARY.map((preset) => {
    const requiredMatches = preset.requiredHeaderAliases.reduce((count, group) => {
      const hasGroup = group.some((alias) => normalizedHeaders.includes(normalizeHeader(alias)));
      return count + (hasGroup ? 1 : 0);
    }, 0);

    const scoreMatches = preset.scoreHeaderAliases.reduce((count, alias) => {
      return count + (normalizedHeaders.includes(normalizeHeader(alias)) ? 1 : 0);
    }, 0);

    const score = requiredMatches * 5 + scoreMatches;
    return {
      presetId: preset.id,
      label: preset.label,
      score,
      requiredMatches,
      scoreMatches,
    };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0] || null;
  const second = scored[1] || null;
  const recommendedPresetId = top && top.score > 0 ? top.presetId : "generic_futures";

  let confidence = "low";
  if (top && top.score >= 8 && (!second || top.score - second.score >= 3)) confidence = "high";
  else if (top && top.score >= 5) confidence = "medium";

  return {
    confidence,
    recommendedPresetId,
    candidates: scored.filter((item) => item.score > 0).slice(0, 3),
  };
}

function deriveSideFromRow(row) {
  const sideRaw = getField(row, ["side", "buy/sell", "market pos.", "action", "direction"]).toLowerCase();
  if (["buy", "long", "b"].some((value) => sideRaw.includes(value))) return "long";
  if (["sell", "short", "s"].some((value) => sideRaw.includes(value))) return "short";
  return null;
}

export function normalizeCsvRowsToTrades(rows = [], { presetId = "generic_futures", accountId = "" } = {}) {
  const preset = PRESET_LIBRARY.find((item) => item.id === presetId) || PRESET_LIBRARY[PRESET_LIBRARY.length - 1];

  const normalized = rows
    .map((row, index) => {
      const symbol = getField(row, ["symbol", "instrument", "contract", "market symbol"]).toUpperCase() || "MNQ";
      const pnl = parseNumber(getField(row, ["net p/l", "p&l", "profit/loss", "profit", "pnl"])) ?? 0;
      const quantity = parseNumber(getField(row, ["qty", "quantity", "contracts"]));
      const entryPrice = parseNumber(getField(row, ["entry price", "entry", "avg entry", "buy price"]));
      const exitPrice = parseNumber(getField(row, ["exit price", "exit", "avg exit", "sell price"]));
      const commission = parseNumber(getField(row, ["commission", "commissions"])) ?? 0;
      const fees = parseNumber(getField(row, ["fees", "exchange fee"])) ?? 0;
      const providerTradeId = getField(row, ["trade #", "trade id", "id", "order id"]) || null;
      const side = deriveSideFromRow(row);
      const closeDate = parseDateTime(getField(row, ["closed at", "exit date/time", "exit time", "date/time", "date"]));
      const openDate = parseDateTime(getField(row, ["opened at", "entry date/time", "entry time"]));
      const timestamp = (closeDate || openDate)?.getTime();

      if (!Number.isFinite(timestamp)) return null;

      return {
        id: `${preset.id}-${accountId || "unassigned"}-${providerTradeId || index}-${timestamp}`,
        accountId,
        source: preset.source,
        providerTradeId,
        instrument: symbol,
        side,
        entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
        exitPrice: Number.isFinite(exitPrice) ? exitPrice : null,
        quantity: Number.isFinite(quantity) ? quantity : null,
        openedAt: openDate ? openDate.toISOString() : null,
        closedAt: closeDate ? closeDate.toISOString() : openDate ? openDate.toISOString() : null,
        timestamp,
        pnl,
        commission,
        fees,
        netPnl: pnl - commission - fees,
        tradeType: "live",
      };
    })
    .filter(Boolean);

  return normalized;
}
