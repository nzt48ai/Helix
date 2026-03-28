import { SUPPORTED_INSTRUMENT_SYMBOLS } from "./instruments.js";

export const APP_STORAGE_KEY = "helix.app.state.v1";
export const PROFILE_STORAGE_KEY = "helix.profile.settings.v1";

export const POSITION_INSTRUMENT_KEYS = SUPPORTED_INSTRUMENT_SYMBOLS;
export const KELLY_OPTIONS = ["Full", "½", "¼", "Off"];
export const DASHBOARD_RANGES = ["Week", "Month", "Quarter", "Year"];
export const TAB_KEYS = ["position", "compound", "share", "dashboard", "journal"];

export const POSITION_DEFAULTS = {
  accountBalance: "50,000",
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
  dashboardAccountFilterMode: "all",
  dashboardSelectedAccountIds: [],
  dashboardIncludeUnassigned: true,
  dashboardTradeTypeFilter: "all",
};

export const PROFILE_DEFAULTS = {
  displayName: "",
  username: "",
  avatar: "",
  theme: "light",
  shareSettings: {
    showAvatar: true,
    showUsername: true,
    showAccountName: true,
  },
  accounts: [],
};

const PROFILE_ACCOUNT_TYPES = new Set(["personal", "prop", "sim", "paper", "helixtrade"]);
const PROP_ACCOUNT_STATUSES = new Set(["active", "breached", "passed", "funded"]);

function sanitizeProfileAccount(value) {
  if (!value || typeof value !== "object") return null;

  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const type = typeof value.type === "string" ? value.type.trim().toLowerCase() : "";
  const startingBalance = Number(value.startingBalance);
  const currentBalance = Number(value.currentBalance);

  if (!id || !name || !PROFILE_ACCOUNT_TYPES.has(type)) return null;
  if (!Number.isFinite(startingBalance) || !Number.isFinite(currentBalance)) return null;

  const baseAccount = {
    id,
    name,
    type,
    startingBalance,
    currentBalance,
    brokerName: typeof value.brokerName === "string" && value.brokerName.trim() ? value.brokerName.trim() : null,
    connectionMethod: typeof value.connectionMethod === "string" && value.connectionMethod.trim() ? value.connectionMethod.trim() : null,
    linkedSource: typeof value.linkedSource === "string" && value.linkedSource.trim() ? value.linkedSource.trim() : null,
    isHelixLinked: typeof value.isHelixLinked === "boolean" ? value.isHelixLinked : false,
  };

  if (type !== "prop") {
    return {
      ...baseAccount,
      firmName: null,
      dailyLossLimit: null,
      maxDrawdown: null,
      profitTarget: null,
      status: null,
    };
  }

  const firmNameRaw = typeof value.firmName === "string" ? value.firmName.trim() : "";
  const dailyLossLimit = Number(value.dailyLossLimit);
  const maxDrawdown = Number(value.maxDrawdown);
  const profitTarget = Number(value.profitTarget);
  const statusRaw = typeof value.status === "string" ? value.status.trim().toLowerCase() : "";

  return {
    ...baseAccount,
    firmName: firmNameRaw || null,
    dailyLossLimit: Number.isFinite(dailyLossLimit) ? dailyLossLimit : null,
    maxDrawdown: Number.isFinite(maxDrawdown) ? maxDrawdown : null,
    profitTarget: Number.isFinite(profitTarget) ? profitTarget : null,
    status: PROP_ACCOUNT_STATUSES.has(statusRaw) ? statusRaw : "active",
  };
}

export function resolveTabFromHash(hashValue = "") {
  const trimmedHash = String(hashValue).replace(/^#/, "").trim().toLowerCase();
  if (!trimmedHash) return "position";

  const firstToken = trimmedHash.split(/[&|,;\s]+/).find(Boolean) || "";

  if (TAB_KEYS.includes(firstToken)) return firstToken;
  return TAB_KEYS.includes(trimmedHash) ? trimmedHash : "position";
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

export function readStoredProfileState(storage) {
  const safeStorage = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!safeStorage) return null;
  try {
    const raw = safeStorage.getItem(PROFILE_STORAGE_KEY);
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
  const legacyAccountFilter = typeof value.dashboardAccountFilter === "string" ? value.dashboardAccountFilter : null;
  const dashboardAccountFilterMode =
    value.dashboardAccountFilterMode === "custom" || value.dashboardAccountFilterMode === "all"
      ? value.dashboardAccountFilterMode
      : legacyAccountFilter === "all" || !legacyAccountFilter
        ? "all"
        : "custom";
  const dashboardSelectedAccountIds = Array.isArray(value.dashboardSelectedAccountIds)
    ? value.dashboardSelectedAccountIds.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
    : legacyAccountFilter && legacyAccountFilter !== "all" && legacyAccountFilter !== "unassigned"
      ? [legacyAccountFilter]
      : [];
  const dashboardIncludeUnassigned =
    typeof value.dashboardIncludeUnassigned === "boolean"
      ? value.dashboardIncludeUnassigned
      : legacyAccountFilter === "unassigned"
        ? true
        : VIEW_DEFAULTS.dashboardIncludeUnassigned;
  const dashboardTradeTypeFilter =
    value.dashboardTradeTypeFilter === "live" || value.dashboardTradeTypeFilter === "paper" || value.dashboardTradeTypeFilter === "all"
      ? value.dashboardTradeTypeFilter
      : VIEW_DEFAULTS.dashboardTradeTypeFilter;
  return {
    dashboardRange: DASHBOARD_RANGES.includes(value.dashboardRange) ? value.dashboardRange : VIEW_DEFAULTS.dashboardRange,
    dashboardAccountFilterMode,
    dashboardSelectedAccountIds,
    dashboardIncludeUnassigned,
    dashboardTradeTypeFilter,
  };
}

export function sanitizeProfileState(value) {
  if (!value || typeof value !== "object") return { ...PROFILE_DEFAULTS, shareSettings: { ...PROFILE_DEFAULTS.shareSettings } };
  const shareSettings = value.shareSettings && typeof value.shareSettings === "object" ? value.shareSettings : {};
  const accounts = Array.isArray(value.accounts) ? value.accounts.map(sanitizeProfileAccount).filter(Boolean) : PROFILE_DEFAULTS.accounts;
  return {
    displayName: typeof value.displayName === "string" ? value.displayName : PROFILE_DEFAULTS.displayName,
    username: typeof value.username === "string" ? value.username.replace(/^@+/, "") : PROFILE_DEFAULTS.username,
    avatar: typeof value.avatar === "string" ? value.avatar : PROFILE_DEFAULTS.avatar,
    theme: value.theme === "dark" ? "dark" : PROFILE_DEFAULTS.theme,
    shareSettings: {
      showAvatar: typeof shareSettings.showAvatar === "boolean" ? shareSettings.showAvatar : PROFILE_DEFAULTS.shareSettings.showAvatar,
      showUsername: typeof shareSettings.showUsername === "boolean" ? shareSettings.showUsername : PROFILE_DEFAULTS.shareSettings.showUsername,
      showAccountName: typeof shareSettings.showAccountName === "boolean" ? shareSettings.showAccountName : PROFILE_DEFAULTS.shareSettings.showAccountName,
    },
    accounts,
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

export function persistProfileState(nextState, storage) {
  const safeStorage = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!safeStorage) return false;
  try {
    safeStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(nextState));
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

export function clearPersistedProfileState(storage) {
  const safeStorage = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
  if (!safeStorage) return false;
  try {
    safeStorage.removeItem(PROFILE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
