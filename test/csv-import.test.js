import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTradeDeduplicationKey,
  detectCsvFormat,
  estimateDuplicateCount,
  normalizeCsvRowsToTrades,
  parseCsvText,
} from "../src/csvImport.js";

test("detectCsvFormat identifies NinjaTrader style headers", () => {
  const detection = detectCsvFormat([
    "Instrument",
    "Market pos.",
    "Qty",
    "Entry price",
    "Exit price",
    "Profit",
    "Entry time",
    "Exit time",
  ]);

  assert.equal(detection.recommendedPresetId, "ninjatrader-csv-v1");
  assert.equal(detection.confidence, "high");
});

test("parseCsvText parses rows and normalizeCsvRowsToTrades builds trade payload", () => {
  const csv = `Symbol,Exit Date/Time,Profit/Loss,Quantity,Entry Price,Exit Price\nES,2026-02-02 14:30:00,125.50,1,5020.25,5023.00`;
  const parsed = parseCsvText(csv);
  const trades = normalizeCsvRowsToTrades(parsed.rows, { presetId: "tradestation-csv-v1" });

  assert.equal(parsed.rows.length, 1);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].accountId, "");
  assert.equal(trades[0].instrument, "ES");
  assert.equal(trades[0].importSource, "csv");
  assert.equal(trades[0].pnl, 125.5);
  assert.ok(Number.isFinite(trades[0].timestamp));
});

test("low-confidence detection still returns fallback preset", () => {
  const detection = detectCsvFormat(["foo", "bar", "baz"]);
  assert.equal(detection.confidence, "low");
  assert.equal(detection.recommendedPresetId, "generic-futures-csv-v1");
});

test("dedupe key prefers source + providerTradeId and falls back to signature", () => {
  const providerKey = buildTradeDeduplicationKey({ source: "tradovate", providerTradeId: "abc-1", id: "unstable" });
  const signatureKey = buildTradeDeduplicationKey({
    symbol: "MNQ",
    openedAt: "2026-03-01T14:00:00.000Z",
    entryPrice: 21000,
    exitPrice: 21010,
    quantity: 1,
    pnl: 20,
  });

  assert.equal(providerKey, "provider:tradovate:abc-1");
  assert.match(signatureKey, /^signature:/);
});

test("estimateDuplicateCount counts incoming matches against existing trades", () => {
  const existing = [{ source: "csv", providerTradeId: "123" }];
  const incoming = [{ source: "csv", providerTradeId: "123" }, { source: "csv", providerTradeId: "124" }];
  assert.equal(estimateDuplicateCount(existing, incoming), 1);
});
