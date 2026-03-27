export const APP_STORAGE_KEY = "helix.app.state.v1";

export const POSITION_INSTRUMENT_KEYS = ["NQ", "ES", "MNQ", "MES"];
export const KELLY_OPTIONS = ["Full", "½", "¼", "Off"];
export const DASHBOARD_RANGES = ["Week", "Month", "Quarter", "Year"];

export const POSITION_DEFAULTS = {
  accountBalance: "25,000",
  propMode: false,
  instrument: "MNQ",
  entry: "21,500.00",
  stop: "21,470.00",
  target: "21,560.00",
  winRate: 55,
  kelly: "½",
  contracts: "7",
};

export const COMPOUND_DEFAULTS = {
  projectionMode: true,
  projectionGoalDisplayType: "$",
  projectionGoalDollarInput: "50,000",
  projectionGoalPercentInput: "100",
  manualStartingBalanceInput: "25,000",
  tradeFrequencyValue: "1",
  tradeFrequency: "Per Day",
  gainInput: "8",
  winRateInput: "55",
  durationInput: "6",
  durationUnit: "Months",
};

export const VIEW_DEFAULTS = {
  dashboardRange: "Month",
};

export function resolveTabFromHash(hashValue = "") {
  const trimmedHash = String(hashValue).replace("#", "").trim();
  return ["position", "compound", "share", "dashboard", "journal"].includes(trimmedHash) ? trimmedHash : "position";
}

export function readStoredAppState(storage) {
  const safeStorage = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!safeStorage) return null;
  try {
    const raw = safeStorage.getItem(APP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function sanitizePositionState(value) {
  if (!value || typeof value !== "object") return { ...POSITION_DEFAULTS };
  return {
    accountBalance: typeof value.accountBalance === "string" ? value.accountBalance : POSITION_DEFAULTS.accountBalance,
    propMode: typeof value.propMode === "boolean" ? value.propMode : POSITION_DEFAULTS.propMode,
    instrument: POSITION_INSTRUMENT_KEYS.includes(value.instrument) ? value.instrument : POSITION_DEFAULTS.instrument,
    entry: typeof value.entry === "string" ? value.entry : POSITION_DEFAULTS.entry,
    stop: typeof value.stop === "string" ? value.stop : POSITION_DEFAULTS.stop,
    target: typeof value.target === "string" ? value.target : POSITION_DEFAULTS.target,
    winRate: typeof value.winRate === "number" ? value.winRate : POSITION_DEFAULTS.winRate,
    kelly: KELLY_OPTIONS.includes(value.kelly) ? value.kelly : POSITION_DEFAULTS.kelly,
    contracts: typeof value.contracts === "string" ? value.contracts : POSITION_DEFAULTS.contracts,
  };
}

export function sanitizeCompoundState(value) {
  if (!value || typeof value !== "object") return { ...COMPOUND_DEFAULTS };
  return {
    projectionMode: typeof value.projectionMode === "boolean" ? value.projectionMode : COMPOUND_DEFAULTS.projectionMode,
    projectionGoalDisplayType: value.projectionGoalDisplayType === "%" ? "%" : COMPOUND_DEFAULTS.projectionGoalDisplayType,
    projectionGoalDollarInput:
      typeof value.projectionGoalDollarInput === "string" ? value.projectionGoalDollarInput : COMPOUND_DEFAULTS.projectionGoalDollarInput,
    projectionGoalPercentInput:
      typeof value.projectionGoalPercentInput === "string" ? value.projectionGoalPercentInput : COMPOUND_DEFAULTS.projectionGoalPercentInput,
    manualStartingBalanceInput:
      typeof value.manualStartingBalanceInput === "string" ? value.manualStartingBalanceInput : COMPOUND_DEFAULTS.manualStartingBalanceInput,
    tradeFrequencyValue: typeof value.tradeFrequencyValue === "string" ? value.tradeFrequencyValue : COMPOUND_DEFAULTS.tradeFrequencyValue,
    tradeFrequency: value.tradeFrequency === "Per Week" || value.tradeFrequency === "Per Month" ? value.tradeFrequency : COMPOUND_DEFAULTS.tradeFrequency,
    gainInput: typeof value.gainInput === "string" ? value.gainInput : COMPOUND_DEFAULTS.gainInput,
    winRateInput: typeof value.winRateInput === "string" ? value.winRateInput : COMPOUND_DEFAULTS.winRateInput,
    durationInput: typeof value.durationInput === "string" ? value.durationInput : COMPOUND_DEFAULTS.durationInput,
    durationUnit: value.durationUnit === "Days" || value.durationUnit === "Weeks" ? value.durationUnit : COMPOUND_DEFAULTS.durationUnit,
  };
}

export function updateCompoundStateSafely(previousState, nextValueOrUpdater) {
  const safePrevious = sanitizeCompoundState(previousState);
  const resolvedNext = typeof nextValueOrUpdater === "function" ? nextValueOrUpdater(safePrevious) : nextValueOrUpdater;

  if (!resolvedNext || typeof resolvedNext !== "object") {
    return safePrevious;
  }

  return sanitizeCompoundState({
    ...safePrevious,
    ...resolvedNext,
  });
}

export function sanitizeViewState(value) {
  if (!value || typeof value !== "object") return { ...VIEW_DEFAULTS };
  return {
    dashboardRange: DASHBOARD_RANGES.includes(value.dashboardRange) ? value.dashboardRange : VIEW_DEFAULTS.dashboardRange,
  };
}

export function persistAppState(nextState, storage) {
  const safeStorage = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!safeStorage) return false;
  try {
    safeStorage.setItem(APP_STORAGE_KEY, JSON.stringify(nextState));
    return true;
  } catch {
    return false;
  }
}

export function clearPersistedAppState(storage) {
  const safeStorage = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!safeStorage) return false;
  try {
    safeStorage.removeItem(APP_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
