import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_STORAGE_KEY,
  COMPOUND_DEFAULTS,
  POSITION_DEFAULTS,
  VIEW_DEFAULTS,
  clearPersistedAppState,
  persistAppState,
  readStoredAppState,
  resolveTabFromHash,
  sanitizeCompoundState,
  sanitizePositionState,
  sanitizeViewState,
  updateCompoundStateSafely,
} from "../src/appState.js";

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

test("app loads with sane defaults", () => {
  assert.equal(resolveTabFromHash(""), "position");
  assert.deepEqual(sanitizePositionState(readStoredAppState(createStorage())?.positionState), POSITION_DEFAULTS);
  assert.deepEqual(sanitizeCompoundState(readStoredAppState(createStorage())?.compoundState), COMPOUND_DEFAULTS);
  assert.deepEqual(sanitizeViewState(readStoredAppState(createStorage())?.viewState), VIEW_DEFAULTS);
});

test("hash-based tab restore works", () => {
  assert.equal(resolveTabFromHash("#dashboard"), "dashboard");
  assert.equal(resolveTabFromHash("#journal"), "journal");
  assert.equal(resolveTabFromHash("#unknown"), "position");
});

test("localStorage hydration handles invalid persisted data safely", () => {
  const storage = createStorage({ [APP_STORAGE_KEY]: "{bad-json" });
  assert.equal(readStoredAppState(storage), null);
  assert.deepEqual(sanitizePositionState(readStoredAppState(storage)?.positionState), POSITION_DEFAULTS);
});

test("reset preferences clears persisted data and falls back to defaults", () => {
  const storage = createStorage({
    [APP_STORAGE_KEY]: JSON.stringify({
      positionState: { accountBalance: "40,000", instrument: "ES", winRate: 42 },
      viewState: { dashboardRange: "Year" },
    }),
  });

  assert.equal(clearPersistedAppState(storage), true);
  assert.equal(storage.getItem(APP_STORAGE_KEY), null);
  assert.deepEqual(sanitizePositionState(readStoredAppState(storage)?.positionState), POSITION_DEFAULTS);
  assert.deepEqual(sanitizeViewState(readStoredAppState(storage)?.viewState), VIEW_DEFAULTS);
});

test("dashboard range persistence works", () => {
  const storage = createStorage();
  const nextState = {
    positionState: POSITION_DEFAULTS,
    compoundState: COMPOUND_DEFAULTS,
    viewState: { dashboardRange: "Year" },
  };

  assert.equal(persistAppState(nextState, storage), true);
  const restored = readStoredAppState(storage);

  assert.equal(sanitizeViewState(restored?.viewState).dashboardRange, "Year");
});

test("compound updates preserve required fields for cross-tab rendering", () => {
  const updated = updateCompoundStateSafely(COMPOUND_DEFAULTS, (prev) => ({
    projectionGoalDollarInput: "70,000",
    // Regression path: updater returns only one field while the user edits Compound values.
    [prev.projectionGoalDisplayType === "%" ? "projectionGoalPercentInput" : "projectionGoalDollarInput"]: "90,000",
  }));

  assert.equal(updated.projectionGoalDollarInput, "90,000");
  assert.equal(updated.tradeFrequency, COMPOUND_DEFAULTS.tradeFrequency);
  assert.equal(updated.durationUnit, COMPOUND_DEFAULTS.durationUnit);
  assert.equal(typeof updated.projectionMode, "boolean");
});
