const FUTURES_INSTRUMENT_CATALOG = [
  { symbol: "ES", name: "E-mini S&P 500 Futures", category: "Equity Index", exchange: "CME", keywords: ["sp500", "s&p", "emini"], pointValue: 50 },
  { symbol: "MES", name: "Micro E-mini S&P 500 Futures", category: "Equity Index", exchange: "CME", keywords: ["micro", "sp500", "s&p"], pointValue: 5 },
  { symbol: "NQ", name: "E-mini Nasdaq-100 Futures", category: "Equity Index", exchange: "CME", keywords: ["nasdaq", "ndx", "emini"], pointValue: 20 },
  { symbol: "MNQ", name: "Micro E-mini Nasdaq-100 Futures", category: "Equity Index", exchange: "CME", keywords: ["micro", "nasdaq", "ndx"], pointValue: 2 },
  { symbol: "RTY", name: "E-mini Russell 2000 Futures", category: "Equity Index", exchange: "CME", keywords: ["russell", "small cap"], pointValue: 50 },
  { symbol: "M2K", name: "Micro E-mini Russell 2000 Futures", category: "Equity Index", exchange: "CME", keywords: ["micro", "russell", "small cap"], pointValue: 5 },
  { symbol: "YM", name: "E-mini Dow Jones Futures", category: "Equity Index", exchange: "CBOT", keywords: ["dow", "djia", "emini"], pointValue: 5 },
  { symbol: "MYM", name: "Micro E-mini Dow Jones Futures", category: "Equity Index", exchange: "CBOT", keywords: ["micro", "dow", "djia"], pointValue: 0.5 },

  { symbol: "CL", name: "WTI Crude Oil Futures", category: "Energy", exchange: "NYMEX", keywords: ["crude", "oil", "wti"] },
  { symbol: "MCL", name: "Micro WTI Crude Oil Futures", category: "Energy", exchange: "NYMEX", keywords: ["micro", "crude", "oil", "wti"] },
  { symbol: "NG", name: "Henry Hub Natural Gas Futures", category: "Energy", exchange: "NYMEX", keywords: ["natgas", "gas", "henry hub"] },
  { symbol: "QG", name: "Micro Henry Hub Natural Gas Futures", category: "Energy", exchange: "NYMEX", keywords: ["micro", "natgas", "gas"] },
  { symbol: "RB", name: "RBOB Gasoline Futures", category: "Energy", exchange: "NYMEX", keywords: ["gasoline", "rbob"] },
  { symbol: "HO", name: "NY Harbor ULSD Futures", category: "Energy", exchange: "NYMEX", keywords: ["heating oil", "ulsd", "diesel"] },

  { symbol: "GC", name: "Gold Futures", category: "Metals", exchange: "COMEX", keywords: ["gold", "precious metals"] },
  { symbol: "MGC", name: "Micro Gold Futures", category: "Metals", exchange: "COMEX", keywords: ["micro", "gold"] },
  { symbol: "SI", name: "Silver Futures", category: "Metals", exchange: "COMEX", keywords: ["silver", "precious metals"] },
  { symbol: "SIL", name: "Micro Silver Futures", category: "Metals", exchange: "COMEX", keywords: ["micro", "silver"] },
  { symbol: "HG", name: "Copper Futures", category: "Metals", exchange: "COMEX", keywords: ["copper", "base metals"] },

  { symbol: "6E", name: "Euro FX Futures", category: "FX", exchange: "CME", keywords: ["eurusd", "euro", "fx", "currency"] },
  { symbol: "6B", name: "British Pound Futures", category: "FX", exchange: "CME", keywords: ["gbpusd", "pound", "sterling", "fx", "currency"] },
  { symbol: "6J", name: "Japanese Yen Futures", category: "FX", exchange: "CME", keywords: ["jpy", "yen", "fx", "currency"] },
  { symbol: "6C", name: "Canadian Dollar Futures", category: "FX", exchange: "CME", keywords: ["cad", "loonie", "fx", "currency"] },
  { symbol: "6A", name: "Australian Dollar Futures", category: "FX", exchange: "CME", keywords: ["aud", "aussie", "fx", "currency"] },
  { symbol: "6S", name: "Swiss Franc Futures", category: "FX", exchange: "CME", keywords: ["chf", "swissy", "fx", "currency"] },
  { symbol: "M6E", name: "Micro Euro FX Futures", category: "FX", exchange: "CME", keywords: ["micro", "euro", "eurusd", "fx", "currency"] },

  { symbol: "ZN", name: "10-Year U.S. Treasury Note Futures", category: "Rates", exchange: "CBOT", keywords: ["10y", "us treasury", "note", "rates"] },
  { symbol: "ZB", name: "U.S. Treasury Bond Futures", category: "Rates", exchange: "CBOT", keywords: ["30y", "bond", "us treasury", "rates"] },
  { symbol: "ZF", name: "5-Year U.S. Treasury Note Futures", category: "Rates", exchange: "CBOT", keywords: ["5y", "us treasury", "note", "rates"] },
  { symbol: "ZT", name: "2-Year U.S. Treasury Note Futures", category: "Rates", exchange: "CBOT", keywords: ["2y", "us treasury", "note", "rates"] },

  { symbol: "ZC", name: "Corn Futures", category: "Grains", exchange: "CBOT", keywords: ["corn", "agriculture", "grain"] },
  { symbol: "ZS", name: "Soybean Futures", category: "Grains", exchange: "CBOT", keywords: ["soybean", "agriculture", "grain"] },
  { symbol: "ZW", name: "Wheat Futures", category: "Grains", exchange: "CBOT", keywords: ["wheat", "agriculture", "grain"] },
  { symbol: "ZM", name: "Soybean Meal Futures", category: "Grains", exchange: "CBOT", keywords: ["soybean meal", "agriculture", "grain"] },
  { symbol: "ZL", name: "Soybean Oil Futures", category: "Grains", exchange: "CBOT", keywords: ["soybean oil", "agriculture", "grain"] },

  { symbol: "KC", name: "Coffee Futures", category: "Softs", exchange: "ICE US", keywords: ["coffee", "softs"] },
  { symbol: "SB", name: "Sugar No. 11 Futures", category: "Softs", exchange: "ICE US", keywords: ["sugar", "softs"] },
  { symbol: "CT", name: "Cotton No. 2 Futures", category: "Softs", exchange: "ICE US", keywords: ["cotton", "softs"] },

  { symbol: "LE", name: "Live Cattle Futures", category: "Livestock", exchange: "CME", keywords: ["cattle", "livestock"] },
  { symbol: "HE", name: "Lean Hog Futures", category: "Livestock", exchange: "CME", keywords: ["hog", "hogs", "livestock"] },
];

const EXCLUDED_EUROPEAN_SYMBOLS = new Set([
  "FDAX",
  "FESX",
  "FGBL",
  "FGBM",
  "FGBS",
  "FGBX",
  "FSTX",
  "FSMI",
]);

const SUPPORTED_INSTRUMENTS = FUTURES_INSTRUMENT_CATALOG.filter((instrument) => !EXCLUDED_EUROPEAN_SYMBOLS.has(instrument.symbol));
const INSTRUMENTS_BY_SYMBOL = new Map(SUPPORTED_INSTRUMENTS.map((instrument) => [instrument.symbol, instrument]));
const DEFAULT_SHORTCUT_SYMBOLS = ["ES", "MES", "NQ", "MNQ"];

function normalizeSymbol(value = "") {
  return String(value).trim().toUpperCase();
}

function normalizeText(value = "") {
  return String(value).trim().toLowerCase();
}

function scoreInstrumentMatch(instrument, normalizedQuery) {
  const normalizedSymbol = instrument.symbol.toLowerCase();
  const normalizedName = instrument.name.toLowerCase();
  const keywords = instrument.keywords || [];

  if (normalizedSymbol === normalizedQuery) return 1;
  if (normalizedSymbol.startsWith(normalizedQuery)) return 2;
  if (normalizedName.startsWith(normalizedQuery)) return 3;
  if (normalizedSymbol.includes(normalizedQuery) || normalizedName.includes(normalizedQuery)) return 4;
  if (keywords.some((keyword) => normalizeText(keyword).includes(normalizedQuery))) return 4;

  return Number.POSITIVE_INFINITY;
}

export function getSupportedInstruments() {
  return [...SUPPORTED_INSTRUMENTS];
}

export function getInstrumentBySymbol(symbol) {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (!normalizedSymbol) return null;
  return INSTRUMENTS_BY_SYMBOL.get(normalizedSymbol) || null;
}

export function searchInstruments(query = "", { limit = 25 } = {}) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [...SUPPORTED_INSTRUMENTS].slice(0, limit);

  return SUPPORTED_INSTRUMENTS
    .map((instrument, index) => ({ instrument, score: scoreInstrumentMatch(instrument, normalizedQuery), index }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.instrument);
}

export function getDefaultInstrumentShortcuts() {
  return DEFAULT_SHORTCUT_SYMBOLS.map((symbol) => INSTRUMENTS_BY_SYMBOL.get(symbol)).filter(Boolean);
}

export const SUPPORTED_INSTRUMENT_SYMBOLS = SUPPORTED_INSTRUMENTS.map((instrument) => instrument.symbol);
