import test from "node:test";
import assert from "node:assert/strict";
import { detectCsvFormat, normalizeCsvRowsToTrades, parseCsvText } from "../src/csvImport.js";

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

  assert.equal(detection.recommendedPresetId, "ninjatrader");
  assert.equal(detection.confidence, "high");
});

test("parseCsvText parses rows and normalizeCsvRowsToTrades builds trade payload", () => {
  const csv = `Symbol,Exit Date/Time,Profit/Loss,Quantity,Entry Price,Exit Price\nES,2026-02-02 14:30:00,125.50,1,5020.25,5023.00`;
  const parsed = parseCsvText(csv);
  const trades = normalizeCsvRowsToTrades(parsed.rows, { presetId: "tradestation", accountId: "acct-1" });

  assert.equal(parsed.rows.length, 1);
  assert.equal(trades.length, 1);
  assert.equal(trades[0].accountId, "acct-1");
  assert.equal(trades[0].instrument, "ES");
  assert.equal(trades[0].pnl, 125.5);
  assert.ok(Number.isFinite(trades[0].timestamp));
});

test("low-confidence detection still returns fallback preset", () => {
  const detection = detectCsvFormat(["foo", "bar", "baz"]);
  assert.equal(detection.confidence, "low");
  assert.equal(detection.recommendedPresetId, "generic_futures");
});
