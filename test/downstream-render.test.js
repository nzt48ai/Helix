import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { sanitizeCompoundState, updateCompoundStateSafely } from "../src/appState.js";
import { buildCompoundFrequencySummary, createFallbackDashboardSnapshot, ensureDashboardSnapshot, toSafeLower } from "../src/downstreamSafety.js";

function renderDashboardSummary(snapshot) {
  return renderToStaticMarkup(
    React.createElement(
      "section",
      null,
      React.createElement("div", null, snapshot.modeLabel),
      React.createElement("div", null, snapshot.modeOutcome),
      React.createElement("div", null, snapshot.frequencySummary),
      React.createElement(
        "ul",
        null,
        snapshot.performanceSeries.map((point, index) => React.createElement("li", { key: `p-${index}` }, String(point))),
      ),
      React.createElement(
        "ul",
        null,
        snapshot.sessionMix.map((height, index) => React.createElement("li", { key: `s-${index}` }, String(height))),
      ),
    ),
  );
}

test("dashboard/share/journal downstream rendering survives malformed compound-derived snapshot values", () => {
  const malformedSnapshot = {
    modeLabel: undefined,
    modeOutcome: Number.NaN,
    frequencySummary: Infinity,
    performanceSeries: null,
    sessionMix: "invalid",
  };

  const safeSnapshot = ensureDashboardSnapshot(malformedSnapshot, createFallbackDashboardSnapshot("$0"));
  const markup = renderDashboardSummary(safeSnapshot);

  assert.match(markup, /Compound/);
  assert.match(markup, /Ending Balance/);
  assert.match(markup, /Per Day/);
});

test("share/journal frequency and duration summaries remain render-safe with malformed compound state", () => {
  const mutatedCompoundStates = [
    { tradeFrequencyValue: undefined, tradeFrequency: undefined, durationInput: undefined, durationUnit: undefined },
    { tradeFrequencyValue: "", tradeFrequency: "", durationInput: "", durationUnit: "" },
    { tradeFrequencyValue: Number.NaN, tradeFrequency: { label: "Per Day" }, durationInput: Infinity, durationUnit: { bad: true } },
  ];

  for (const state of mutatedCompoundStates) {
    const summary = buildCompoundFrequencySummary(state);
    const context = `${state.projectionMode ? "Forecast" : "Compound"}: 1 Per Day for 1 ${toSafeLower(state.durationUnit, "months")}`;
    const markup = renderToStaticMarkup(React.createElement("div", null, `${summary} | ${context}`));

    assert.equal(typeof summary, "string");
    assert.ok(summary.length > 0);
    assert.match(markup, /per day|Per Day/);
  }
});

test("safe compound updater + downstream summary regression: partial updates cannot blank render", () => {
  const startingState = sanitizeCompoundState({
    projectionMode: true,
    projectionGoalDisplayType: "%",
    projectionGoalPercentInput: "100",
    projectionGoalDollarInput: "",
    manualStartingBalanceInput: "25,000",
    tradeFrequencyValue: "1",
    tradeFrequency: "Per Day",
    gainInput: "8",
    winRateInput: "55",
    durationInput: "6",
    durationUnit: "Months",
  });

  const partiallyUpdated = updateCompoundStateSafely(startingState, () => ({ durationUnit: undefined, tradeFrequencyValue: "" }));
  const summary = buildCompoundFrequencySummary(partiallyUpdated);
  const markup = renderToStaticMarkup(React.createElement("div", null, summary));

  assert.equal(partiallyUpdated.durationUnit, "Months");
  assert.match(markup, /Per Day/);
});
