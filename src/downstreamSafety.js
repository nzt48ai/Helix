import { COMPOUND_DEFAULTS } from "./appState.js";

export function toSafeString(value, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function toSafeLower(value, fallback = "") {
  return toSafeString(value, fallback).toLowerCase();
}

export function buildCompoundFrequencySummary(compoundState) {
  const safeCompound = compoundState && typeof compoundState === "object" ? compoundState : {};
  const frequencyValue = toSafeString(safeCompound.tradeFrequencyValue, COMPOUND_DEFAULTS.tradeFrequencyValue) || COMPOUND_DEFAULTS.tradeFrequencyValue;
  const tradeFrequency = toSafeString(safeCompound.tradeFrequency, COMPOUND_DEFAULTS.tradeFrequency) || COMPOUND_DEFAULTS.tradeFrequency;
  const durationValue = toSafeString(safeCompound.durationInput, COMPOUND_DEFAULTS.durationInput) || COMPOUND_DEFAULTS.durationInput;
  const durationUnitLower = toSafeLower(safeCompound.durationUnit, COMPOUND_DEFAULTS.durationUnit).trim() || COMPOUND_DEFAULTS.durationUnit.toLowerCase();
  return `${frequencyValue} ${tradeFrequency} • ${durationValue} ${durationUnitLower}`;
}

export function createFallbackDashboardSnapshot(accountBalanceLabel) {
  return {
    accountBalance: accountBalanceLabel,
    winRate: "0%",
    winRateTone: "default",
    instrument: "MNQ",
    contracts: "0",
    modeLabel: "Compound",
    performanceTitle: "Compounding curve overview",
    modeOutcome: "Ending Balance: —",
    frequencySummary: "1 Per Day • Month",
    contractSummary: "Position sizing: 0 contracts on MNQ.",
    performanceSeries: [26, 30, 36, 41, 46, 52, 58, 64],
    sessionMix: [32, 44, 38, 52, 46, 58, 54, 64],
  };
}

export function ensureDashboardSnapshot(value, fallbackSnapshot) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...fallbackSnapshot,
    ...source,
    accountBalance: toSafeString(source.accountBalance, fallbackSnapshot.accountBalance),
    winRate: toSafeString(source.winRate, fallbackSnapshot.winRate),
    instrument: toSafeString(source.instrument, fallbackSnapshot.instrument),
    contracts: toSafeString(source.contracts, fallbackSnapshot.contracts),
    modeLabel: toSafeString(source.modeLabel, fallbackSnapshot.modeLabel),
    performanceTitle: toSafeString(source.performanceTitle, fallbackSnapshot.performanceTitle),
    modeOutcome: toSafeString(source.modeOutcome, fallbackSnapshot.modeOutcome),
    frequencySummary: toSafeString(source.frequencySummary, fallbackSnapshot.frequencySummary),
    contractSummary: toSafeString(source.contractSummary, fallbackSnapshot.contractSummary),
    performanceSeries:
      Array.isArray(source.performanceSeries) && source.performanceSeries.length > 0
        ? source.performanceSeries
        : fallbackSnapshot.performanceSeries,
    sessionMix: Array.isArray(source.sessionMix) && source.sessionMix.length > 0 ? source.sessionMix : fallbackSnapshot.sessionMix,
  };
}
