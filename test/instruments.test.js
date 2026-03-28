import test from "node:test";
import assert from "node:assert/strict";

import {
  getDefaultInstrumentShortcuts,
  getInstrumentBySymbol,
  searchInstruments,
  SUPPORTED_INSTRUMENT_SYMBOLS,
} from "../src/instruments.js";

test("getInstrumentBySymbol performs exact symbol lookup case-insensitively", () => {
  assert.equal(getInstrumentBySymbol("es")?.symbol, "ES");
  assert.equal(getInstrumentBySymbol("M6E")?.name, "Micro Euro FX Futures");
  assert.equal(getInstrumentBySymbol("FDAX"), null);
});

test("searchInstruments ranks exact symbol before other matches", () => {
  const results = searchInstruments("MES");
  assert.equal(results[0]?.symbol, "MES");
});

test("searchInstruments supports name and partial matches", () => {
  const nameResults = searchInstruments("nasdaq");
  assert.ok(nameResults.some((instrument) => instrument.symbol === "NQ"));

  const partialSymbolResults = searchInstruments("m");
  assert.ok(partialSymbolResults.length > 0);
  assert.ok(partialSymbolResults.some((instrument) => instrument.symbol === "MES"));
});

test("default shortcuts remain ES, MES, NQ, MNQ", () => {
  const shortcuts = getDefaultInstrumentShortcuts().map((instrument) => instrument.symbol);
  assert.deepEqual(shortcuts, ["ES", "MES", "NQ", "MNQ"]);
});

test("supported instrument symbol list excludes known European futures", () => {
  assert.equal(SUPPORTED_INSTRUMENT_SYMBOLS.includes("FDAX"), false);
  assert.equal(SUPPORTED_INSTRUMENT_SYMBOLS.includes("FESX"), false);
});
