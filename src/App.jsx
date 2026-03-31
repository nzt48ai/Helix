import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "framer-motion";
import {
  Dna,
  Calculator,
  LineChart,
  FileDown,
  Loader2,
  Undo2,
  Search,
  Plus,
  Sparkles,
  TrendingUp,
  UserRound,
} from "lucide-react";
import {
  COMPOUND_DEFAULTS,
  DASHBOARD_RANGES,
  KELLY_OPTIONS,
  POSITION_DEFAULTS,
  PROFILE_DEFAULTS,
  VIEW_DEFAULTS,
  clearPersistedAppState,
  clearPersistedProfileState,
  persistAppState,
  persistProfileState,
  readStoredProfileState,
  readStoredAppState,
  resolveTabFromHash,
  sanitizeProfileState,
  TAB_KEYS,
  sanitizeCompoundState,
  sanitizePositionState,
  sanitizeViewState,
  updateCompoundStateSafely,
} from "./appState";
import { buildCompoundFrequencySummary, createFallbackDashboardSnapshot, ensureDashboardSnapshot, toSafeLower, toSafeString } from "./downstreamSafety";
import { isDebugModeEnabled } from "./debugRuntime";
import { shouldHandleTabPointerUp } from "./navInteractions";
import { getActiveIndex, getSegmentedIndicatorStyle } from "./motionStability";
import { resolveScreenComponentName, resolveTabRoute, syncTabStateFromHash } from "./tabRouting";
import { getDefaultInstrumentShortcuts, getInstrumentBySymbol, searchInstruments } from "./instruments.js";
import { triggerLightHaptic, triggerMediumHaptic } from "./haptics";
import {
  buildTradeDeduplicationKey,
  detectCsvFormat,
  normalizeCsvRowsToTrades,
  parseCsvText,
} from "./csvImport";

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

const NAV_META = {
  position: { label: "Position", icon: Calculator },
  compound: { label: "Compound", icon: TrendingUp },
  share: { label: "Share", icon: Plus },
  dashboard: { label: "Insights", icon: Dna },
  journal: { label: "Profile", icon: UserRound },
};

const NAV_ITEMS = TAB_KEYS.map((key) => ({ key, ...NAV_META[key] }));

const SPRING = { type: "spring", stiffness: 430, damping: 34, mass: 0.7 };
const IOS_FADE_EASE = [0.22, 1, 0.36, 1];
const SHARE_CARD_TRANSITION = { type: "spring", stiffness: 320, damping: 30, mass: 0.9 };
const FUTURES_PICKER_TRANSITION = { type: "spring", stiffness: 300, damping: 28, mass: 0.95 };
const OVERLAY_FADE_TRANSITION = { duration: 0.18, ease: IOS_FADE_EASE };
const TAB_CONTENT_TRANSITION = { duration: 0.2, ease: IOS_FADE_EASE };
const HERO_NUMBER_TEXT_CLASS =
  "bg-[linear-gradient(110deg,rgba(51,65,85,0.99)_0%,rgba(255,255,255,0.9)_42%,rgba(30,41,59,0.96)_58%,rgba(71,85,105,0.9)_100%)] bg-[length:200%_100%] bg-clip-text font-bold leading-[0.94] tracking-[-0.09em] text-transparent animate-[balanceShimmer_10s_linear_infinite]";
const POSITION_INSTRUMENTS = getDefaultInstrumentShortcuts().map((instrument) => ({
  key: instrument.symbol,
  pointValue: instrument.pointValue ?? 1,
  defaults:
    instrument.symbol === "ES" || instrument.symbol === "MES"
      ? { entry: "5,250.00", stop: "5,245.00", target: "5,260.00" }
      : { entry: "21,500.00", stop: "21,470.00", target: "21,560.00" },
}));
const DASHBOARD_TRADE_TYPE_FILTER_ALL = "all";
const DASHBOARD_TRADE_TYPE_FILTER_LIVE = "live";
const DASHBOARD_TRADE_TYPE_FILTER_PAPER = "paper";

function keepDigitsOnly(value, maxDigits = 12, fallback = "") {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, maxDigits);
  return digits || fallback;
}

function formatNumberString(value) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 12);
  return digits ? Number(digits).toLocaleString("en-US") : "";
}

function parseNumberString(value) {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNullableNumberString(value) {
  const normalized = String(value ?? "").replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizePriceInputString(value, { maxWholeDigits = 7, maxFractionDigits = 2 } = {}) {
  const clean = String(value ?? "").replace(/,/g, "");
  let whole = "";
  let fraction = "";
  let seenDot = false;

  for (const char of clean) {
    if (char >= "0" && char <= "9") {
      if (!seenDot && whole.length < maxWholeDigits) {
        whole += char;
      } else if (seenDot && fraction.length < maxFractionDigits) {
        fraction += char;
      }
    } else if (char === "." && !seenDot) {
      seenDot = true;
    }
  }

  if (seenDot) return `${whole}.${fraction}`;
  return whole;
}

function formatPriceOnBlur(value, decimals = 2) {
  const parsed = parseNullableNumberString(value);
  if (parsed === null) return "";
  return parsed.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatLocalTimeAmPm(value = Date.now()) {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatLocalDateMmDdYy(value = Date.now()) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

function formatTimeInTimeZoneAmPm(value = Date.now(), timeZone = "America/New_York") {
  return new Date(value).toLocaleTimeString("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateInTimeZoneMmDdYy(value = Date.now(), timeZone = "America/New_York") {
  return new Date(value).toLocaleDateString("en-US", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
  });
}

function formatAbbreviatedNumber(value, { suffix = "", prefix = "", threshold = 99999 } = {}) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue)) return `${prefix}0${suffix}`;

  const absolute = Math.abs(safeValue);
  const units = [
    { threshold: 1e15, suffix: "Q" },
    { threshold: 1e12, suffix: "T" },
    { threshold: 1e9, suffix: "B" },
    { threshold: 1e6, suffix: "M" },
    { threshold: 1e3, suffix: "K" },
  ];

  const unit = units.find((item) => absolute >= item.threshold);
  if (!unit || absolute <= threshold) {
    const formattedBase = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(safeValue);
    return `${prefix}${formattedBase}${suffix}`;
  }

  const scaled = safeValue / unit.threshold;
  const scaledAbs = Math.abs(scaled);
  const decimals = scaledAbs >= 100 ? 0 : scaledAbs >= 10 ? 1 : 2;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(scaled);

  return `${prefix}${formatted}${unit.suffix}${suffix}`;
}

function formatCompactCurrency(value) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue)) return formatCurrency(0);
  const absolute = Math.abs(safeValue);
  if (absolute <= 99999) return formatCurrency(safeValue);
  return formatAbbreviatedNumber(safeValue, { prefix: "$", threshold: 99999 });
}

function formatBottomMetricCurrency(value) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue)) return "$0";
  const absolute = Math.abs(safeValue);
  if (absolute < 1000) return formatCurrency(safeValue);
  return formatAbbreviatedNumber(safeValue, { prefix: "$", threshold: 999 });
}

function formatPercent(value, maximumFractionDigits = 0) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(safeValue)}%`;
}

function formatCompactPercent(value, maximumFractionDigits = 1) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue)) return formatPercent(0, maximumFractionDigits);
  const absolute = Math.abs(safeValue);
  if (absolute <= 99999) return formatPercent(safeValue, maximumFractionDigits);
  return formatAbbreviatedNumber(safeValue, { suffix: "%", threshold: 99999 });
}

function formatSecondsLabel(seconds) {
  const safeSeconds = Number(seconds);
  if (!Number.isFinite(safeSeconds) || safeSeconds <= 0) return "0.0s";
  return `${safeSeconds.toFixed(1)}s`;
}

function createTradeId() {
  return `trade-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildStableTradeFingerprint(value) {
  return buildTradeDeduplicationKey(value);
}

function sanitizeTrade(value) {
  if (!value || typeof value !== "object") return null;
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : createTradeId();
  const timestamp = Number(value.timestamp);
  const pnl = Number(value.pnl);
  const instrument = typeof value.instrument === "string" && value.instrument.trim() ? value.instrument.trim() : "MNQ";
  const accountId = typeof value.accountId === "string" && value.accountId.trim() ? value.accountId.trim() : "";
  const rMultiple = value.rMultiple === null || value.rMultiple === undefined || value.rMultiple === "" ? null : Number(value.rMultiple);
  const ruleViolation = typeof value.ruleViolation === "boolean" ? value.ruleViolation : false;
  const ruleViolationReason =
    typeof value.ruleViolationReason === "string" && value.ruleViolationReason.trim() ? value.ruleViolationReason.trim() : null;
  const tradeType = value.tradeType === "paper" ? "paper" : "live";
  const source = typeof value.source === "string" && value.source.trim() ? value.source.trim().toLowerCase() : "manual";
  const importSource = typeof value.importSource === "string" && value.importSource.trim() ? value.importSource.trim().toLowerCase() : null;
  const providerTradeId = typeof value.providerTradeId === "string" && value.providerTradeId.trim() ? value.providerTradeId.trim() : null;
  const side = value.side === "short" ? "short" : value.side === "long" ? "long" : null;
  const entryPrice = Number(value.entryPrice);
  const exitPrice = Number(value.exitPrice);
  const quantity = Number(value.quantity);
  const openedAt = typeof value.openedAt === "string" && value.openedAt.trim() ? value.openedAt.trim() : null;
  const closedAt = typeof value.closedAt === "string" && value.closedAt.trim() ? value.closedAt.trim() : null;
  const commission = Number(value.commission);
  const fees = Number(value.fees);
  const netPnl = Number(value.netPnl);

  if (!Number.isFinite(timestamp) || !Number.isFinite(pnl)) return null;

  return {
    id,
    timestamp,
    pnl,
    instrument,
    accountId,
    rMultiple: Number.isFinite(rMultiple) ? rMultiple : null,
    ruleViolation,
    ruleViolationReason,
    tradeType,
    source,
    importSource,
    providerTradeId,
    side,
    entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
    exitPrice: Number.isFinite(exitPrice) ? exitPrice : null,
    quantity: Number.isFinite(quantity) ? quantity : null,
    openedAt,
    closedAt,
    commission: Number.isFinite(commission) ? commission : 0,
    fees: Number.isFinite(fees) ? fees : 0,
    netPnl: Number.isFinite(netPnl) ? netPnl : pnl,
  };
}

function sanitizeTrades(value) {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeTrade).filter(Boolean);
}

function mergeTradesWithDedupe(existingTrades = [], incomingTrades = []) {
  const normalizedExisting = sanitizeTrades(existingTrades);
  const normalizedIncoming = sanitizeTrades(incomingTrades);
  const deduped = [];
  const seen = new Set();

  [...normalizedExisting, ...normalizedIncoming].forEach((trade) => {
    const key = buildStableTradeFingerprint(trade);
    if (seen.has(key)) return;
    seen.add(key);
    deduped.push(trade);
  });

  return deduped.sort((a, b) => b.timestamp - a.timestamp);
}

function AnimatedFormattedNumber({
  value,
  formatter,
  className = "",
  duration = 0.5,
  debounceMs = 180,
}) {
  const reduceMotion = useReducedMotion();
  const numericValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  const motionValue = useMotionValue(numericValue);
  const [displayValue, setDisplayValue] = useState(() => formatter(numericValue));
  const [targetValue, setTargetValue] = useState(numericValue);

  useEffect(() => {
    setDisplayValue(formatter(motionValue.get()));
  }, [formatter, motionValue]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setTargetValue(numericValue);
    }, debounceMs);
    return () => window.clearTimeout(timeoutId);
  }, [debounceMs, numericValue]);

  useEffect(() => {
    if (reduceMotion) {
      motionValue.set(targetValue);
      setDisplayValue(formatter(targetValue));
      return undefined;
    }

    const controls = animate(motionValue, targetValue, {
      duration,
      ease: "easeOut",
      onUpdate: (latest) => {
        setDisplayValue(formatter(latest));
      },
    });

    return () => {
      controls.stop();
    };
  }, [duration, formatter, motionValue, reduceMotion, targetValue]);

  return <span className={className}>{displayValue}</span>;
}

function derivePositionSetupSnapshot(positionState) {
  const selectedInstrumentFromCatalog = getInstrumentBySymbol(positionState.instrument || "MNQ") || getInstrumentBySymbol("MNQ");
  const selectedShortcutInstrument = POSITION_INSTRUMENTS.find((item) => item.key === (selectedInstrumentFromCatalog?.symbol || "MNQ")) || POSITION_INSTRUMENTS[2];
  const selectedInstrument = {
    key: selectedInstrumentFromCatalog?.symbol || selectedShortcutInstrument.key,
    pointValue: selectedInstrumentFromCatalog?.pointValue ?? selectedShortcutInstrument.pointValue ?? 1,
  };
  const entry = parseNullableNumberString(positionState.entry);
  const stop = parseNullableNumberString(positionState.stop);
  const target = parseNullableNumberString(positionState.target);
  const contracts = Math.max(0, parseNumberString(positionState.contracts || "0"));
  const hasEntry = entry !== null && entry > 0;
  const hasStop = stop !== null && stop > 0;
  const hasTarget = target !== null && target > 0;
  const riskPoints = hasEntry && hasStop ? Math.max(0, Math.abs(entry - stop)) : 0;
  const rewardPoints = hasEntry && hasTarget ? Math.max(0, Math.abs(target - entry)) : 0;
  const rewardRiskRatio = riskPoints > 0 ? rewardPoints / riskPoints : 0;
  const projectedRisk = riskPoints * (selectedInstrument.pointValue || 1) * contracts;
  const projectedReward = rewardPoints * (selectedInstrument.pointValue || 1) * contracts;
  const direction = hasEntry && hasStop && hasTarget
    ? target > entry && stop < entry
      ? "LONG"
      : target < entry && stop > entry
        ? "SHORT"
        : ""
    : "";
  const setupTimestamp =
    typeof positionState.setupTimestamp === "string"
      ? positionState.setupTimestamp.trim()
      : typeof positionState.timestamp === "string"
        ? positionState.timestamp.trim()
        : "";
  const setupContext = typeof positionState.setupContext === "string" ? positionState.setupContext.trim() : "";
  const setupIsComplete =
    Boolean(selectedInstrument?.key) && hasEntry && hasStop && hasTarget && riskPoints > 0 && rewardPoints > 0 && contracts > 0;

  return {
    selectedInstrument,
    entry: hasEntry ? entry : 0,
    stop: hasStop ? stop : 0,
    target: hasTarget ? target : 0,
    contracts,
    riskPoints,
    rewardPoints,
    rewardRiskRatio,
    projectedRisk,
    projectedReward,
    direction,
    setupTimestamp,
    setupContext,
    setupIsComplete,
  };
}

function resolveForecastTargetBalance(goalMode, dollarGoal, percentGoal, startBalance, minimumValidDollarGoal) {
  if (!Number.isFinite(startBalance) || startBalance <= 0) return null;
  if (goalMode === "%") {
    if (!Number.isFinite(percentGoal) || percentGoal <= 0) return null;
    const resolvedPercentTarget = startBalance * (1 + percentGoal / 100);
    return Number.isFinite(resolvedPercentTarget) ? resolvedPercentTarget : null;
  }
  if (!Number.isFinite(dollarGoal) || dollarGoal < minimumValidDollarGoal) return null;
  return dollarGoal;
}

function buildProjectionPathModel({
  projectionTargetBalance,
  startingBalance,
  effectiveGrowthPercentPerPeriod,
  hasSafeScalingInputs,
  balancePerContractTier,
  baseContracts,
  hasSafeGain,
  parsedGainPercent,
  hasSafeWinRate,
  parsedWinRatePercent,
  drawdownExpectedPercent = null,
}) {
  if (!projectionTargetBalance || startingBalance <= 0 || effectiveGrowthPercentPerPeriod <= 0) {
    return {
      points: [],
      periodsEstimate: null,
      sizingMilestones: [],
      confidenceSpread: 0,
      bandUpper: null,
      bandLower: null,
    };
  }

  const points = [startingBalance];
  const sizingMilestones = [];
  let balance = startingBalance;
  let lastContracts = hasSafeScalingInputs && balancePerContractTier ? Math.max(1, Math.floor(balance / balancePerContractTier)) : baseContracts;
  const maxPeriods = 180;

  for (let period = 1; period <= maxPeriods; period += 1) {
    const contracts = hasSafeScalingInputs && balancePerContractTier ? Math.max(1, Math.floor(balance / balancePerContractTier)) : baseContracts;
    const cappedContracts = Math.max(1, Math.min(contracts, baseContracts * 24));
    const sizeMultiplier = hasSafeScalingInputs ? Math.max(1, cappedContracts / Math.max(1, baseContracts)) : 1;
    const periodGrowthRate = Math.max(0.001, (effectiveGrowthPercentPerPeriod / 100) * sizeMultiplier);
    const nextBalance = Math.max(0, balance * (1 + periodGrowthRate));
    const safeNextBalance = Number.isFinite(nextBalance) ? nextBalance : balance;
    points.push(safeNextBalance);
    if (cappedContracts > lastContracts) {
      sizingMilestones.push({ key: `size-${period}-${cappedContracts}`, period, value: safeNextBalance, label: `${cappedContracts} ctr` });
      lastContracts = cappedContracts;
    }
    balance = safeNextBalance;
    if (balance >= projectionTargetBalance) break;
  }

  if (points.length < 2) {
    return { points: [], periodsEstimate: null, sizingMilestones: [], confidenceSpread: 0, bandUpper: null, bandLower: null };
  }

  const periodsEstimate = points.length - 1;
  const baseSpread = 0.06;
  const gainModifier = hasSafeGain ? Math.min(0.1, parsedGainPercent / 200) : 0.04;
  const winRateModifier = hasSafeWinRate ? Math.max(0, (55 - parsedWinRatePercent) / 500) : 0.02;
  const drawdownModifier = Number.isFinite(drawdownExpectedPercent) ? Math.min(0.08, drawdownExpectedPercent / 400) : 0.02;
  const confidenceSpread = Math.min(0.22, Math.max(0.05, baseSpread + gainModifier + winRateModifier + drawdownModifier));
  const bandUpper = points.map((value, index) => {
    const progress = points.length <= 1 ? 0 : index / (points.length - 1);
    const spread = 1 + confidenceSpread * (0.4 + progress * 0.8);
    const upper = value * spread;
    return Number.isFinite(upper) ? upper : value;
  });
  const bandLower = points.map((value, index) => {
    const progress = points.length <= 1 ? 0 : index / (points.length - 1);
    const spread = 1 - confidenceSpread * (0.45 + progress * 0.9);
    const lower = Math.max(0, value * spread);
    return Number.isFinite(lower) ? lower : value;
  });

  return { points, periodsEstimate, sizingMilestones, confidenceSpread, bandUpper, bandLower };
}

function buildSetupPayoffPathModel({
  entry,
  stop,
  target,
  direction,
  contracts,
  riskPoints,
  rewardPoints,
  projectedRisk,
  projectedReward,
}) {
  const hasValidInputs =
    Number.isFinite(entry) &&
    Number.isFinite(stop) &&
    Number.isFinite(target) &&
    Number.isFinite(contracts) &&
    Number.isFinite(riskPoints) &&
    Number.isFinite(rewardPoints) &&
    Number.isFinite(projectedRisk) &&
    Number.isFinite(projectedReward) &&
    contracts > 0 &&
    riskPoints > 0 &&
    rewardPoints > 0 &&
    projectedReward > 0 &&
    (direction === "LONG" || direction === "SHORT");

  if (!hasValidInputs) return { points: [], bandUpper: null, bandLower: null };

  const totalPriceTravel = Math.max(0.0001, Math.abs(target - entry));
  const riskToReward = projectedRisk > 0 ? projectedReward / projectedRisk : rewardPoints / Math.max(0.0001, riskPoints);
  const curveBias = Math.max(0.58, Math.min(1.28, 1.03 - (riskToReward - 1) * 0.14));
  const sampleCount = 46;
  const directionSign = direction === "SHORT" ? -1 : 1;
  const volatilityEnvelope = Math.min(projectedReward * 0.045, projectedRisk * 0.12);
  const points = Array.from({ length: sampleCount }, (_, index) => {
    const progress = index / (sampleCount - 1);
    const easedProgress = 1 - Math.pow(1 - progress, curveBias);
    const priceAtStep = entry + (target - entry) * progress;
    const normalizedTravel = Math.min(1, Math.abs(priceAtStep - entry) / totalPriceTravel);
    const payoffAtStep = easedProgress * normalizedTravel * projectedReward;
    const microWave = Math.sin(progress * Math.PI) * volatilityEnvelope * 0.35;
    return directionSign * Math.max(0, payoffAtStep + microWave * (1 - progress * 0.72));
  });

  points[points.length - 1] = directionSign * projectedReward;

  const confidenceBand = Math.max(projectedReward * 0.08, projectedRisk * 0.14);
  const bandUpper = points.map((value, index) => {
    const progress = index / (points.length - 1);
    return value + confidenceBand * (0.12 + progress * 0.88);
  });
  const bandLower = points.map((value, index) => {
    const progress = index / (points.length - 1);
    return value - confidenceBand * (0.12 + progress * 0.88);
  });

  return { points, bandUpper, bandLower };
}

const SHARE_CARD_EXPORT_WIDTH = 420;
const SHARE_CARD_EXPORT_HEIGHT = Math.round((SHARE_CARD_EXPORT_WIDTH * 16) / 9);

async function exportElementAsPng(node, fileName = "helix-share-card.png") {
  if (!node || typeof window === "undefined" || typeof document === "undefined") return false;
  const rect = node.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const serializedNode = new XMLSerializer().serializeToString(node);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${serializedNode}</foreignObject></svg>`;
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    const imageLoaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });
    image.src = svgUrl;
    await imageLoaded;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.drawImage(image, 0, 0, width, height);

    const pngUrl = canvas.toDataURL("image/png");
    const downloadLink = document.createElement("a");
    downloadLink.href = pngUrl;
    downloadLink.download = fileName;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    return true;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function hexToPdfRgb(hex, fallback = [1, 1, 1]) {
  if (typeof hex !== "string") return fallback;
  const normalized = hex.replace("#", "").trim();
  if (!/^[\da-fA-F]{6}$/.test(normalized)) return fallback;
  return [0, 2, 4].map((offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255);
}

function createInsightsPdfReport({
  generatedAt = Date.now(),
  range = "Month",
  tradeTypeFilterLabel = "All Types",
  identity,
  metrics,
  performance,
  calendarSnapshot = [],
  flags = [],
}) {
  const PAGE_WIDTH = 612;
  const PAGE_HEIGHT = 792;
  const MARGIN = 40;
  const bodyWidth = PAGE_WIDTH - MARGIN * 2;
  const tone = {
    bg: hexToPdfRgb("#070B17", [0.03, 0.04, 0.09]),
    card: hexToPdfRgb("#0E152A", [0.06, 0.08, 0.16]),
    cardAlt: hexToPdfRgb("#121D37", [0.07, 0.11, 0.21]),
    border: hexToPdfRgb("#253554", [0.15, 0.2, 0.32]),
    textPrimary: hexToPdfRgb("#E8EEFF", [0.91, 0.93, 1]),
    textMuted: hexToPdfRgb("#8EA0C6", [0.56, 0.63, 0.78]),
    cyan: hexToPdfRgb("#30C9FF", [0.19, 0.78, 1]),
    violet: hexToPdfRgb("#8E7DFF", [0.56, 0.49, 1]),
    orange: hexToPdfRgb("#F6A752", [0.96, 0.66, 0.32]),
  };
  const toRgb = (value = [1, 1, 1]) => value.map((n) => n.toFixed(3)).join(" ");
  const wrapText = (text, maxChars = 72) => {
    const words = String(text ?? "").split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    const lines = [];
    let line = words[0];
    for (let index = 1; index < words.length; index += 1) {
      const next = `${line} ${words[index]}`;
      if (next.length <= maxChars) line = next;
      else {
        lines.push(line);
        line = words[index];
      }
    }
    lines.push(line);
    return lines;
  };

  const contentOps = [];
  const drawRect = (x, yTop, width, height, fillColor = null, strokeColor = null, lineWidth = 1) => {
    const yBottom = yTop - height;
    if (fillColor) contentOps.push(`${toRgb(fillColor)} rg`);
    if (strokeColor) {
      contentOps.push(`${toRgb(strokeColor)} RG`);
      contentOps.push(`${lineWidth.toFixed(2)} w`);
    }
    contentOps.push(`${x.toFixed(2)} ${yBottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`);
    if (fillColor && strokeColor) contentOps.push("B");
    else if (fillColor) contentOps.push("f");
    else contentOps.push("S");
  };
  const drawLine = (x1, y1, x2, y2, strokeColor = tone.border, lineWidth = 1) => {
    contentOps.push(`${toRgb(strokeColor)} RG`);
    contentOps.push(`${lineWidth.toFixed(2)} w`);
    contentOps.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  };
  const drawText = (text, x, y, { font = "F1", size = 10, color = tone.textPrimary } = {}) => {
    contentOps.push("BT");
    contentOps.push(`/${font} ${size} Tf`);
    contentOps.push(`${toRgb(color)} rg`);
    contentOps.push(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`);
    contentOps.push(`(${escapePdfText(text)}) Tj`);
    contentOps.push("ET");
  };
  const drawLabeledValue = (label, value, x, y, width, isAccent = false) => {
    drawText(label, x + 12, y - 18, { font: "F1", size: 8, color: tone.textMuted });
    drawText(value, x + 12, y - 36, { font: "F2", size: 12, color: isAccent ? tone.cyan : tone.textPrimary });
    drawLine(x + 12, y - 43, x + width - 12, y - 43, tone.border, 0.75);
  };

  drawRect(0, PAGE_HEIGHT, PAGE_WIDTH, PAGE_HEIGHT, tone.bg);

  drawRect(MARGIN, PAGE_HEIGHT - MARGIN, bodyWidth, 124, tone.card, tone.border, 1);
  drawRect(MARGIN + bodyWidth - 170, PAGE_HEIGHT - MARGIN - 1, 168, 122, tone.cardAlt);
  drawRect(MARGIN, PAGE_HEIGHT - MARGIN - 92, bodyWidth, 2, tone.border);

  // subtle candlestick motif in header
  drawRect(MARGIN + 20, PAGE_HEIGHT - MARGIN - 14, 3, 26, tone.violet);
  drawRect(MARGIN + 28, PAGE_HEIGHT - MARGIN - 4, 3, 16, tone.cyan);
  drawRect(MARGIN + 36, PAGE_HEIGHT - MARGIN - 10, 3, 22, tone.orange);

  drawText("HELIX", MARGIN + 54, PAGE_HEIGHT - MARGIN - 4, { font: "F2", size: 20, color: tone.textPrimary });
  drawText("INSIGHTS REPORT", MARGIN + 54, PAGE_HEIGHT - MARGIN - 28, { font: "F1", size: 10, color: tone.textMuted });
  drawText(`Generated ${new Date(generatedAt).toLocaleString("en-US")}`, MARGIN + 20, PAGE_HEIGHT - MARGIN - 52, { font: "F1", size: 9, color: tone.textMuted });
  drawText(`Scope ${range}  |  ${tradeTypeFilterLabel}`, MARGIN + 20, PAGE_HEIGHT - MARGIN - 70, { font: "F1", size: 9, color: tone.textMuted });

  drawText("Profile", MARGIN + bodyWidth - 158, PAGE_HEIGHT - MARGIN - 26, { font: "F1", size: 8, color: tone.textMuted });
  drawText(identity?.displayName || "Helix", MARGIN + bodyWidth - 158, PAGE_HEIGHT - MARGIN - 45, { font: "F2", size: 12, color: tone.textPrimary });
  drawText(identity?.showUsername ? identity?.username || "@helixtrader" : "@helixtrader", MARGIN + bodyWidth - 158, PAGE_HEIGHT - MARGIN - 61, { font: "F1", size: 9, color: tone.cyan });
  drawText(identity?.isAnonymous ? "Anonymous mode" : "Local profile", MARGIN + bodyWidth - 158, PAGE_HEIGHT - MARGIN - 77, { font: "F1", size: 8, color: tone.textMuted });

  let yCursor = PAGE_HEIGHT - MARGIN - 142;
  const sectionTitle = (title) => {
    drawText(title.toUpperCase(), MARGIN, yCursor - 2, { font: "F2", size: 11, color: tone.textPrimary });
    drawLine(MARGIN + 138, yCursor + 2, PAGE_WIDTH - MARGIN, yCursor + 2, tone.border, 0.75);
    yCursor -= 12;
  };

  sectionTitle("Summary Metrics");
  const metricBlockWidth = (bodyWidth - 20) / 2;
  const metricRows = [
    ["Total Trades", metrics.totalTrades, "Net P/L", metrics.netPnl, true],
    ["Win Rate", metrics.winRate, "Avg R", metrics.avgR, false],
    ["Best Day", metrics.bestDay, "Worst Day", metrics.worstDay, false],
  ];
  metricRows.forEach(([labelA, valueA, labelB, valueB, accentA], index) => {
    const top = yCursor - index * 52;
    drawRect(MARGIN, top, metricBlockWidth, 46, tone.card, tone.border, 0.8);
    drawRect(MARGIN + metricBlockWidth + 20, top, metricBlockWidth, 46, tone.card, tone.border, 0.8);
    drawLabeledValue(String(labelA), String(valueA), MARGIN, top, metricBlockWidth, accentA);
    drawLabeledValue(String(labelB), String(valueB), MARGIN + metricBlockWidth + 20, top, metricBlockWidth, false);
  });
  yCursor -= 168;

  sectionTitle("Performance");
  const perfCardHeight = 112;
  drawRect(MARGIN, yCursor, bodyWidth, perfCardHeight, tone.card, tone.border, 0.9);
  const perfRows = [
    ["Recent (7D)", performance.recentSummary],
    ["Top Trade", performance.topTrade],
    ["Worst Trade", performance.worstTrade],
    ["Mode Outcome", performance.modeOutcome],
    ["Frequency", performance.frequencySummary],
    ["Contract Summary", performance.contractSummary],
  ];
  perfRows.forEach(([label, value], index) => {
    const rowY = yCursor - 16 - index * 16;
    drawText(label, MARGIN + 14, rowY, { font: "F1", size: 8, color: tone.textMuted });
    drawText(value, MARGIN + 122, rowY, { font: "F1", size: 9, color: tone.textPrimary });
  });
  yCursor -= perfCardHeight + 14;

  sectionTitle("Calendar / Daily Snapshot");
  const lowerCardWidth = (bodyWidth - 16) / 2;
  drawRect(MARGIN, yCursor, lowerCardWidth, 122, tone.card, tone.border, 0.8);
  const calendarRows = calendarSnapshot.length
    ? calendarSnapshot.slice(0, 7).map((item) => `${item.dateLabel}  ${item.netPnlLabel}${item.hasRuleViolation ? " | flag" : ""}`)
    : ["No daily entries for current filter"];
  calendarRows.forEach((line, index) => {
    drawText(line, MARGIN + 12, yCursor - 18 - index * 14, { font: "F1", size: 8.5, color: tone.textPrimary });
  });

  drawText("NOTES / FLAGS", MARGIN + lowerCardWidth + 16, yCursor - 2, { font: "F2", size: 11, color: tone.textPrimary });
  drawRect(MARGIN + lowerCardWidth + 16, yCursor - 8, lowerCardWidth, 114, tone.card, tone.border, 0.8);
  const flagRows = flags.length ? flags.slice(0, 6) : ["No flagged trades in current view"];
  let flagY = yCursor - 18;
  flagRows.forEach((flag, index) => {
    wrapText(`${index + 1}. ${flag}`, 42).slice(0, 2).forEach((line, lineIndex) => {
      drawText(line, MARGIN + lowerCardWidth + 28, flagY - lineIndex * 12, { font: "F1", size: 8, color: tone.textPrimary });
    });
    flagY -= 22;
  });

  drawLine(MARGIN, 34, PAGE_WIDTH - MARGIN, 34, tone.border, 0.75);
  drawText("Helix Insights  |  Premium performance report", MARGIN, 20, { font: "F1", size: 8, color: tone.textMuted });
  drawText(new Date(generatedAt).toLocaleDateString("en-US"), PAGE_WIDTH - MARGIN - 76, 20, { font: "F1", size: 8, color: tone.textMuted });

  const content = contentOps.join("\n");

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogObj = addObject("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesObj = addObject("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  const pageObj = addObject("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>");
  const fontBodyObj = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontStrongObj = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const contentObj = addObject(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  if (!catalogObj || !pagesObj || !pageObj || !fontBodyObj || !fontStrongObj || !contentObj) return null;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function GlassCard({ children, className = "", padded = true, highlight = false, transparent = false }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[28px]",
        !transparent &&
          "border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.24))] shadow-[0_16px_44px_rgba(139,157,193,0.16),0_4px_16px_rgba(166,180,209,0.10),inset_0_1px_0_rgba(255,255,255,0.94)] backdrop-blur-[18px]",
        !transparent && highlight && "bg-[linear-gradient(180deg,rgba(233,241,255,0.68),rgba(255,255,255,0.26))]",
        padded && "p-5",
        className
      )}
    >
      {!transparent ? <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),transparent_36%)]" /> : null}
      <div className="relative">{children}</div>
    </div>
  );
}

function HelixAvatar({ sizeClassName = "h-9 w-9", textClassName = "text-[12px]" }) {
  return (
    <div
      className={cn(
        "grid place-items-center rounded-full border border-blue-100/80 bg-[linear-gradient(180deg,rgba(230,241,255,0.96),rgba(209,230,255,0.92))] font-semibold tracking-[-0.02em] text-blue-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]",
        sizeClassName,
        textClassName
      )}
      aria-label="Helix logo"
    >
      HX
    </div>
  );
}

function IdentityAvatar({ identity }) {
  const initials = (identity?.displayName || identity?.username || "HX")
    .replace(/^@+/, "")
    .trim()
    .slice(0, 2)
    .toUpperCase();
  if (identity?.avatar && /^https?:\/\//i.test(identity.avatar)) {
    return <img src={identity.avatar} alt="Profile avatar" className="h-8 w-8 rounded-full border border-white/75 object-cover" />;
  }
  if (identity?.isAnonymous) return <HelixAvatar sizeClassName="h-8 w-8" textClassName="text-[11px]" />;
  return (
    <div className="grid h-8 w-8 place-items-center rounded-full border border-white/75 bg-white/80 text-[11px] font-semibold text-slate-700">
      {initials || "HX"}
    </div>
  );
}

function SharePortraitCard({
  shareType,
  selectedInstrumentKey,
  directionLabel = "",
  contextLine,
  entryValue,
  stopValue,
  targetValue,
  rewardRiskRatio,
  GIF_PREVIEW_DURATION_SECONDS,
  heroMetric,
  heroMetricAnimatedNumber = null,
  heroMetricFormatter = null,
  secondaryMetrics,
  footerLabel,
  setupMissingMessage = "",
  identity,
  disableMotion = false,
  setupProjectionChart = null,
  setupEntryTimeLabel = "",
}) {
  const reduceMotion = useReducedMotion();
  const normalizedDirection = typeof directionLabel === "string" ? directionLabel.trim().toUpperCase() : "";
  const premiumPillBaseClassName =
    "relative shrink-0 inline-flex items-center justify-center overflow-hidden rounded-full border px-[7px] py-[2px] text-[9px] font-medium uppercase tracking-[0.14em] text-center text-slate-700 shadow-[0_0_0_1px_rgba(148,163,184,0.1),0_2px_5px_rgba(148,163,184,0.1),inset_0_1px_0_rgba(255,255,255,0.72),inset_0_-1px_0_rgba(148,163,184,0.08)] backdrop-blur-[8px] [backdrop-filter:saturate(1.1)_blur(8px)]";
  const premiumPillSheenClassName = "before:pointer-events-none before:absolute before:inset-x-[12%] before:top-[10%] before:h-[36%] before:rounded-full before:bg-[linear-gradient(180deg,rgba(255,255,255,0.5),rgba(255,255,255,0.1))]";
  const premiumPillTactileClassNameByKey = {
    SETUP:
      "rounded-[999px] before:top-[8%] before:h-[34%] before:bg-[linear-gradient(180deg,rgba(255,255,255,0.56),rgba(255,255,255,0.14))] after:pointer-events-none after:absolute after:inset-x-[16%] after:bottom-[9%] after:h-[24%] after:rounded-full after:bg-[linear-gradient(180deg,rgba(16,185,129,0.04),rgba(16,185,129,0.12))] shadow-[0_0_0_1px_rgba(52,211,153,0.13),0_1px_2px_rgba(15,23,42,0.04),0_3px_6px_rgba(16,185,129,0.08),inset_0_1px_0_rgba(255,255,255,0.76),inset_0_-0.6px_0_rgba(16,185,129,0.12)]",
    LONG:
      "rounded-[999px] before:top-[8%] before:h-[34%] before:bg-[linear-gradient(180deg,rgba(255,255,255,0.56),rgba(255,255,255,0.14))] after:pointer-events-none after:absolute after:inset-x-[16%] after:bottom-[9%] after:h-[24%] after:rounded-full after:bg-[linear-gradient(180deg,rgba(16,185,129,0.04),rgba(16,185,129,0.12))] shadow-[0_0_0_1px_rgba(52,211,153,0.13),0_1px_2px_rgba(15,23,42,0.04),0_3px_6px_rgba(16,185,129,0.08),inset_0_1px_0_rgba(255,255,255,0.76),inset_0_-0.6px_0_rgba(16,185,129,0.12)]",
    SHORT:
      "rounded-[999px] before:top-[8%] before:h-[34%] before:bg-[linear-gradient(180deg,rgba(255,255,255,0.56),rgba(255,255,255,0.14))] after:pointer-events-none after:absolute after:inset-x-[16%] after:bottom-[9%] after:h-[24%] after:rounded-full after:bg-[linear-gradient(180deg,rgba(244,63,94,0.04),rgba(244,63,94,0.11))] shadow-[0_0_0_1px_rgba(251,113,133,0.12),0_1px_2px_rgba(15,23,42,0.04),0_3px_6px_rgba(244,63,94,0.08),inset_0_1px_0_rgba(255,255,255,0.76),inset_0_-0.6px_0_rgba(244,63,94,0.12)]",
  };
  const premiumPillToneClassNameByKey = {
    REPLAY:
      "border-amber-200/65 bg-[linear-gradient(180deg,rgba(255,251,235,0.94),rgba(254,243,199,0.78))] text-amber-800 shadow-[0_0_0_1px_rgba(251,191,36,0.1),0_2px_6px_rgba(245,158,11,0.08),inset_0_1px_0_rgba(255,255,255,0.72),inset_0_-1px_0_rgba(245,158,11,0.08)]",
    SETUP:
      "border-emerald-300/65 bg-[linear-gradient(180deg,rgba(236,253,245,0.94),rgba(209,250,229,0.78))] text-emerald-800 shadow-[0_0_0_1px_rgba(52,211,153,0.11),0_2px_6px_rgba(16,185,129,0.08),inset_0_1px_0_rgba(255,255,255,0.72),inset_0_-1px_0_rgba(16,185,129,0.08)]",
    JOURNAL:
      "border-rose-300/65 bg-[linear-gradient(180deg,rgba(255,241,242,0.94),rgba(255,228,230,0.78))] text-rose-800 shadow-[0_0_0_1px_rgba(251,113,133,0.1),0_2px_6px_rgba(244,63,94,0.08),inset_0_1px_0_rgba(255,255,255,0.72),inset_0_-1px_0_rgba(244,63,94,0.08)]",
    LONG:
      "border-emerald-300/65 bg-[linear-gradient(180deg,rgba(236,253,245,0.94),rgba(209,250,229,0.78))] text-emerald-800 shadow-[0_0_0_1px_rgba(52,211,153,0.11),0_2px_6px_rgba(16,185,129,0.08),inset_0_1px_0_rgba(255,255,255,0.72),inset_0_-1px_0_rgba(16,185,129,0.08)]",
    SHORT:
      "border-rose-300/65 bg-[linear-gradient(180deg,rgba(255,241,242,0.94),rgba(255,228,230,0.78))] text-rose-800 shadow-[0_0_0_1px_rgba(251,113,133,0.1),0_2px_6px_rgba(244,63,94,0.08),inset_0_1px_0_rgba(255,255,255,0.72),inset_0_-1px_0_rgba(244,63,94,0.08)]",
  };
  const getPremiumPillClassName = (pillKey) =>
    cn(
      premiumPillBaseClassName,
      premiumPillSheenClassName,
      premiumPillToneClassNameByKey[pillKey],
      premiumPillTactileClassNameByKey[pillKey]
    );
  const directionPillClassName = cn(
    getPremiumPillClassName(normalizedDirection)
  );
  const isJournalCard = shareType === "JOURNAL";
  const hasDirectionalStoryLine = !isJournalCard && (normalizedDirection === "LONG" || normalizedDirection === "SHORT");
  const directionalStoryLine = hasDirectionalStoryLine
    ? `${normalizedDirection} from ${entryValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} → ${targetValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : "";
  const shouldReduce = reduceMotion || disableMotion;
  const shareContentInitial = shouldReduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 8 };
  const shareContentAnimate = shouldReduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 };
  const shareContentExit = shouldReduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: 4 };

  return (
    <div className="relative box-border ml-auto mr-auto w-full max-w-[420px] aspect-[9/16] overflow-hidden rounded-[36px] border border-white/68 bg-[linear-gradient(180deg,rgba(251,253,255,0.985),rgba(242,247,255,0.955))] shadow-[0_18px_44px_rgba(116,137,173,0.16),0_3px_10px_rgba(116,137,173,0.08),inset_0_1px_0_rgba(255,255,255,0.94),inset_0_-1px_0_rgba(148,163,184,0.08)]">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`share-content-${shareType}`}
          className="flex h-full flex-col bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.22)),radial-gradient(circle_at_12%_8%,rgba(68,110,255,0.11),transparent_40%),radial-gradient(circle_at_86%_60%,rgba(45,198,255,0.06),transparent_44%)] px-6 pb-6 pt-6 text-slate-700"
          initial={shareContentInitial}
          animate={shareContentAnimate}
          exit={shareContentExit}
          transition={shouldReduce ? TAB_CONTENT_TRANSITION : SHARE_CARD_TRANSITION}
        >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2.5">
            <div className={getPremiumPillClassName(shareType)}>
              <span className="relative z-10">{shareType}</span>
            </div>
            <div className="min-w-0 text-[19px] font-semibold leading-none tracking-[-0.02em] text-slate-700/90">{selectedInstrumentKey}</div>
          </div>
          {normalizedDirection ? <div className={cn("ml-auto", directionPillClassName)}><span className="relative z-10">{normalizedDirection}</span></div> : null}
        </div>

        <div className="mt-2.5 pl-0.5 text-[12px] leading-[1.3] text-slate-500/90">{contextLine}</div>

        <div className="mt-6 grid w-full grid-cols-3 gap-3.5">
          {[
            { label: "ENTRY", value: entryValue, tone: "text-slate-700" },
            { label: "STOP", value: stopValue, tone: "text-rose-500/90" },
            { label: "TARGET", value: targetValue, tone: "text-emerald-600/90" },
          ].map((item) => (
            <div key={item.label} className="flex min-w-0 flex-col items-center justify-center rounded-[18px] border border-white/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.56),rgba(255,255,255,0.46))] px-[14px] py-[12px] text-center shadow-[0_6px_16px_rgba(148,163,184,0.07),inset_0_1px_0_rgba(255,255,255,0.74)]">
              <div className="text-[9px] uppercase tracking-[0.2em] text-slate-500/80">{item.label}</div>
              <div className={cn("mt-2.5 w-full overflow-hidden text-ellipsis whitespace-nowrap text-[17px] font-semibold tracking-[-0.015em] tabular-nums", item.tone)}>
                {item.value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
            </div>
          ))}
        </div>

        {/* Replay and Journal chart hooks intentionally deferred until their dedicated data sources are defined. */}
        {shareType === "SETUP" && setupProjectionChart?.isReady ? (
          <div className="mt-5">
            <ProjectionChart
              points={setupProjectionChart.points}
              bandUpper={setupProjectionChart.bandUpper}
              bandLower={setupProjectionChart.bandLower}
              projectionMode
              referenceLevels={[
                { key: "entry", label: "Entry", value: entryValue, stroke: "rgba(71,85,105,0.34)" },
                { key: "stop", label: "Stop", value: stopValue, stroke: "rgba(244,63,94,0.34)" },
                { key: "target", label: "Target", value: targetValue, stroke: "rgba(16,185,129,0.34)" },
              ]}
              entryTimeLabel={setupEntryTimeLabel}
              blendBackground
              milestones={[]}
              inspectorEnabled={false}
              hideHeader
              compact
              animatePath
              disableAnimation={shouldReduce}
            />
          </div>
        ) : null}

        <div className="mt-6 min-w-0 text-center">
          <div
            className={cn(
              "mx-auto mt-1 flex min-h-[74px] max-w-full items-center justify-center overflow-hidden px-2 text-ellipsis whitespace-nowrap text-center text-[clamp(34px,11vw,60px)] tabular-nums",
              HERO_NUMBER_TEXT_CLASS
            )}
          >
            {heroMetricAnimatedNumber !== null && typeof heroMetricFormatter === "function" ? (
              <AnimatedFormattedNumber value={heroMetricAnimatedNumber} formatter={heroMetricFormatter} />
            ) : (
              heroMetric
            )}
          </div>
          {hasDirectionalStoryLine ? <div className="mt-3 text-[11px] tracking-[0.01em] text-slate-500/85">{directionalStoryLine}</div> : null}
        </div>

        <div
          className={cn(
            hasDirectionalStoryLine ? "mt-6 grid gap-3.5" : "mt-5 grid gap-3.5",
            secondaryMetrics.length === 3 ? "grid-cols-3" : secondaryMetrics.length === 2 ? "grid-cols-2" : "grid-cols-2"
          )}
        >
          {secondaryMetrics.map((metric) => (
            (() => {
              const isSetupBottomMetric =
                metric.label === "Risk" ||
                metric.label === "R" ||
                metric.label === "Contracts" ||
                metric.label === "Risk Points" ||
                metric.label === "Reward Points";
              return (
            <div
              key={metric.label}
              className={cn(
                "flex min-w-0 h-full flex-col justify-between overflow-hidden rounded-[18px] border border-white/45 bg-white/42 px-[14px] py-[12px] shadow-[0_6px_16px_rgba(148,163,184,0.07),inset_0_1px_0_rgba(255,255,255,0.66)]",
                isSetupBottomMetric ? "items-center" : ""
              )}
            >
              <div
                className={cn(
                  "overflow-hidden text-ellipsis whitespace-nowrap text-[9px] uppercase tracking-[0.16em] text-slate-500/80",
                  isSetupBottomMetric ? "w-full text-center" : "",
                  metric.label === "Contracts" ? "text-[8px] tracking-[0.1em]" : ""
                )}
              >
                {metric.label}
              </div>
              <div className={cn("mt-2.5 overflow-hidden text-ellipsis whitespace-nowrap text-[17px] font-semibold text-slate-700/92 tabular-nums", isSetupBottomMetric ? "w-full text-center" : "")}>
                {metric.animatedNumber !== undefined && typeof metric.formatter === "function" ? (
                  <AnimatedFormattedNumber value={metric.animatedNumber} formatter={metric.formatter} />
                ) : (
                  metric.value
                )}
              </div>
            </div>
              );
            })()
          ))}
        </div>

        {setupMissingMessage ? (
          <div className="mt-3 rounded-[16px] border border-slate-200/80 bg-white/45 px-4 py-2.5 text-center text-[12px] text-slate-500">{setupMissingMessage}</div>
        ) : null}

          <div className="mt-auto pt-3.5">
            <div className="flex items-center justify-center gap-2.5">
              {identity?.showAvatar ? <IdentityAvatar identity={identity} /> : null}
              {identity?.showUsername ? (
                <div className="text-[12px] font-semibold leading-none tracking-[0.01em] text-slate-700/95">{identity.username}</div>
              ) : null}
            </div>
            <div className="mt-1 text-center text-[10px] font-medium uppercase tracking-[0.17em] text-slate-400/75">{footerLabel}</div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function TinyLabel({ children, className = "" }) {
  return <div className={cn("text-[9px] font-medium uppercase tracking-[0.28em] text-slate-500/90", className)}>{children}</div>;
}

function ScreenHeader({ right }) {
  return (
    <div className="relative mb-6 flex items-center justify-center">
      <div className="text-center text-[12px] font-semibold uppercase tracking-[0.28em] text-slate-700">HELIX</div>
      {right ? <div className="absolute right-0">{right}</div> : null}
    </div>
  );
}

function DebugRenderMarker({ markerText, enabled = false }) {
  if (!enabled) return null;
  return (
    <div className="mb-2 inline-flex items-center rounded-full border border-amber-400/70 bg-amber-100/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-amber-900">
      {markerText}
    </div>
  );
}

function DebugModeBanner({ enabled = false }) {
  if (!enabled) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[10000] flex justify-center px-3 pt-2">
      <div className="rounded-full border border-red-300 bg-red-500 px-4 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.2em] text-white shadow-lg">
        DEBUG MODE ACTIVE
      </div>
    </div>
  );
}

function DebugEmptyFallback({ label, enabled = false }) {
  if (!enabled) return null;
  return (
    <GlassCard className="rounded-[24px] border border-amber-300/80 bg-amber-100/70 p-4">
      <div className="text-[14px] font-semibold text-amber-900">{label}</div>
    </GlassCard>
  );
}

function DebugStateInspector({ enabled = false, state }) {
  if (!enabled) return null;
  return (
    <div className="pointer-events-none fixed right-3 top-11 z-[9998] w-[min(92vw,380px)]">
      <div className="pointer-events-auto overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/95 text-slate-100 shadow-2xl">
        <div className="border-b border-slate-700 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em]">Debug Inspector (?debug=1 or #debug)</div>
        <div className="space-y-1.5 border-b border-slate-800 px-3 py-2.5 text-[11px]">
          <div><span className="text-slate-400">activeTab:</span> <span className="font-semibold text-cyan-200">{state.activeTab}</span></div>
          <div><span className="text-slate-400">window.location.hash:</span> <span className="font-semibold text-cyan-200">{state.currentHash || "(empty)"}</span></div>
          <div><span className="text-slate-400">debugMode:</span> <span className="font-semibold text-lime-300">{String(state.debugModeActive)}</span></div>
          <div><span className="text-slate-400">renderedScreenComponent:</span> <span className="font-semibold text-amber-200">{state.renderedScreenComponent}</span></div>
        </div>
        <div className="max-h-[30vh] overflow-auto p-3 text-[11px] leading-relaxed">
          <pre className="whitespace-pre-wrap break-words text-slate-300">{JSON.stringify(state, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}

function TopIconPill({ icon: Icon }) {
  return (
    <div className="rounded-[18px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.22))] p-3 text-slate-500 shadow-[0_10px_24px_rgba(144,162,195,0.12),inset_0_1px_0_rgba(255,255,255,0.94)] backdrop-blur-xl">
      <Icon size={16} />
    </div>
  );
}

function SegmentedControl({ items, value, onChange, onInteraction }) {
  const reduceMotion = useReducedMotion();
  const normalizedItems = items.map((item) => (typeof item === "string" ? { value: item, label: item } : item));
  const activeIndex = getActiveIndex(
    normalizedItems.map((item) => item.value),
    value
  );
  const indicatorStyle = getSegmentedIndicatorStyle(normalizedItems.length, activeIndex);

  return (
    <GlassCard
      className="relative overflow-hidden rounded-[32px] border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.12))] p-[4px] shadow-[0_4px_10px_rgba(120,140,190,0.05),0_1px_4px_rgba(166,180,209,0.03),inset_0_1px_0_rgba(255,255,255,0.84)]"
      padded={false}
    >
      <div className="relative grid gap-1.5" style={{ gridTemplateColumns: `repeat(${normalizedItems.length}, minmax(0, 1fr))` }}>
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 top-0 z-0 rounded-full bg-[linear-gradient(180deg,rgba(241,246,255,1),rgba(223,233,255,0.82))] shadow-[0_14px_30px_rgba(96,135,233,0.26),0_0_14px_rgba(120,150,255,0.22),inset_0_1px_0_rgba(255,255,255,0.98)] ring-1 ring-blue-200/90"
          initial={false}
          animate={indicatorStyle}
          transition={SPRING}
        />
        {normalizedItems.map((item) => {
          const active = item.value === value;
          return (
            <motion.button
              key={item.value}
              type="button"
              onClick={() => {
                onChange(item.value);
                onInteraction?.(item.value);
              }}
              whileTap={reduceMotion ? undefined : { scale: 0.98, opacity: 0.85 }}
              className={cn(
                "relative z-10 flex min-h-[42px] items-center justify-center rounded-full px-4 py-2 text-center text-[13px] font-semibold leading-none tracking-[-0.012em] transition-colors",
                active ? "text-blue-600" : "text-slate-500"
              )}
            >
              <span className="relative z-10">{item.label}</span>
            </motion.button>
          );
        })}
      </div>
    </GlassCard>
  );
}

function PositionInstrumentSelector({
  items,
  value,
  onChange,
  onOpenSearch,
  customInstrument,
  isCustomMode = false,
  onReturnToCompact,
}) {
  const reduceMotion = useReducedMotion();
  const normalizedItems = items.map((item) => (typeof item === "string" ? { value: item, label: item } : item));

  return (
    <AnimatePresence initial={false} mode="wait">
      {isCustomMode ? (
        <motion.div
          key="custom-picker"
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <GlassCard
            className="relative overflow-hidden rounded-[32px] border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.12))] p-[4px] shadow-[0_4px_10px_rgba(120,140,190,0.05),0_1px_4px_rgba(166,180,209,0.03),inset_0_1px_0_rgba(255,255,255,0.84)]"
            padded={false}
          >
            <motion.button
              type="button"
              onClick={onOpenSearch}
              whileTap={reduceMotion ? undefined : { scale: 0.98, opacity: 0.85 }}
              className="grid min-h-[42px] w-full appearance-none grid-cols-[34px_minmax(0,1fr)_34px] items-center rounded-[28px] bg-transparent px-4.5 py-2 text-slate-700"
              aria-label="Open futures instrument picker"
            >
              <span aria-hidden="true" className="inline-flex h-[34px] w-[34px]" />
              <span className="flex min-w-0 items-center justify-center gap-3 text-center">
                <span className="shrink-0 text-[13px] font-semibold leading-none tracking-[0.02em] text-slate-700">{customInstrument?.symbol || value}</span>
                <span className="min-w-0 truncate text-[13px] font-medium leading-none text-slate-500">{customInstrument?.name || "Custom futures instrument"}</span>
              </span>
              <span className="inline-flex h-[34px] w-[34px] items-center justify-center">
                <motion.span
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onReturnToCompact?.();
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    event.stopPropagation();
                    onReturnToCompact?.();
                  }}
                  whileTap={reduceMotion ? undefined : { scale: 0.98, opacity: 0.85 }}
                  className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border border-slate-200/65 bg-white/35 text-slate-400 transition-colors hover:border-slate-300/80 hover:bg-slate-100/70 hover:text-slate-600 active:bg-slate-200/70"
                  aria-label="Return to default instrument shortcuts"
                >
                  <Undo2 size={17} />
                </motion.span>
              </span>
            </motion.button>
          </GlassCard>
        </motion.div>
      ) : (
        <motion.div
          key="compact-picker"
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 10 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <GlassCard
            className="relative overflow-hidden rounded-[32px] border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.12))] p-[4px] shadow-[0_4px_10px_rgba(120,140,190,0.05),0_1px_4px_rgba(166,180,209,0.03),inset_0_1px_0_rgba(255,255,255,0.84)]"
            padded={false}
          >
            <div className="flex items-center gap-1.5">
              <div className="relative grid flex-1 gap-1.5" style={{ gridTemplateColumns: `repeat(${normalizedItems.length}, minmax(0, 1fr))` }}>
                <motion.span
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0 top-0 z-0 rounded-full bg-[linear-gradient(180deg,rgba(241,246,255,1),rgba(223,233,255,0.82))] shadow-[0_14px_30px_rgba(96,135,233,0.26),0_0_14px_rgba(120,150,255,0.22),inset_0_1px_0_rgba(255,255,255,0.98)] ring-1 ring-blue-200/90"
                  initial={false}
                  animate={getSegmentedIndicatorStyle(
                    normalizedItems.length,
                    getActiveIndex(
                      normalizedItems.map((item) => item.value),
                      value
                    )
                  )}
                  transition={SPRING}
                />
                {normalizedItems.map((item) => {
                  const active = item.value === value;
                  return (
                    <motion.button
                      key={item.value}
                      type="button"
                      onClick={() => onChange(item.value)}
                      whileTap={reduceMotion ? undefined : { scale: 0.98, opacity: 0.85 }}
                      className={cn(
                        "relative z-10 flex min-h-[42px] items-center justify-center rounded-full px-4 py-2 text-center text-[13px] font-semibold leading-none tracking-[-0.012em] transition-colors",
                        active ? "text-blue-600" : "text-slate-500"
                      )}
                    >
                      <span className="relative z-10">{item.label}</span>
                    </motion.button>
                  );
                })}
              </div>
              <motion.button
                type="button"
                onClick={onOpenSearch}
                whileTap={reduceMotion ? undefined : { scale: 0.98, opacity: 0.85 }}
                className="relative z-10 flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:text-slate-600"
                aria-label="Search futures instruments"
              >
                <Search size={16} />
              </motion.button>
            </div>
          </GlassCard>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FuturesInstrumentPicker({ open, query, onQueryChange, results, onClose, onSelect }) {
  const reduceMotion = useReducedMotion();
  const pickerInitial = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.985 };
  const pickerAnimate = reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 };
  const pickerExit = reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.99 };

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <div className="fixed inset-0 z-[1200] flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Futures instrument picker">
          <motion.div
            className="absolute inset-0 bg-transparent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={OVERLAY_FADE_TRANSITION}
          />
          <motion.div
            className="relative flex max-h-[min(680px,calc(100dvh-2rem))] w-full max-w-[460px] flex-col overflow-hidden rounded-[28px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,248,255,0.9))] shadow-[0_18px_42px_rgba(120,140,190,0.25)] sm:max-h-[min(720px,calc(100dvh-3rem))]"
            initial={pickerInitial}
            animate={pickerAnimate}
            exit={pickerExit}
            transition={reduceMotion ? TAB_CONTENT_TRANSITION : FUTURES_PICKER_TRANSITION}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200/75 px-4 py-3">
              <div className="text-[13px] font-semibold tracking-[-0.015em] text-slate-700">Futures Instrument Picker</div>
              <motion.button type="button" onClick={onClose} whileTap={reduceMotion ? undefined : { scale: 0.98, opacity: 0.85 }} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close futures picker">
                <X size={16} />
              </motion.button>
            </div>
            <div className="px-4 py-3">
              <input
                type="text"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search by symbol or name"
                className="w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-[14px] font-medium text-slate-700 outline-none ring-blue-200 transition focus:ring-2"
                aria-label="Search futures instruments"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {results.map((instrument) => (
                <motion.button
                  key={instrument.symbol}
                  type="button"
                  onClick={() => onSelect(instrument.symbol)}
                  whileTap={reduceMotion ? undefined : { scale: 0.98, opacity: 0.85 }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-100/70"
                >
                  <span className="w-[44px] shrink-0 text-[13px] font-semibold tracking-[0.02em] text-slate-700">{instrument.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-500">{instrument.name}</span>
                </motion.button>
              ))}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

function BalanceHeroCard({
  label,
  value,
  onChange,
  readOnly = false,
  toggleLabel,
  toggleRightLabel,
  toggleState = false,
  onToggle,
  toggleBadges = null,
  prefix = "$",
  suffix = "",
  fixedFontSize,
}) {
  const reduceMotion = useReducedMotion();
  const computedFontSizeClass = fixedFontSize ? undefined : "text-[clamp(30px,10vw,52px)]";
  const inputValue = value ?? "";
  const displayValue = `${prefix || ""}${inputValue}${suffix || ""}`;
  const inputWidthCh = Math.max(1, String(displayValue).length);

  return (
    <GlassCard
      className="overflow-hidden rounded-[36px] px-7 pb-6 pt-6 ring-1 ring-white/35 shadow-[0_18px_42px_rgba(120,140,190,0.18),0_4px_14px_rgba(150,165,200,0.10),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_-1px_0_rgba(210,220,240,0.55)]"
      highlight
    >
      <div className="pointer-events-none absolute inset-0">
        <div
          className={cn(
            "absolute inset-0",
            toggleState
              ? "bg-[radial-gradient(circle_at_50%_28%,rgba(99,102,241,0.16),rgba(99,102,241,0.08)_32%,transparent_60%)]"
              : "bg-[radial-gradient(circle_at_50%_28%,rgba(148,163,184,0.12),rgba(148,163,184,0.06)_32%,transparent_60%)]"
          )}
        />
        <div className="absolute inset-0 opacity-[0.04] mix-blend-overlay bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.22)_0%,transparent_58%),radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.14)_0%,transparent_42%),radial-gradient(circle_at_80%_70%,rgba(148,163,184,0.08)_0%,transparent_38%)]" />
        <div className="pointer-events-none absolute inset-x-6 top-0 h-14 rounded-b-[32px] bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.06),transparent)] blur-[1px]" />
      </div>

      <div className="relative text-center">
        <TinyLabel className="justify-center">{label}</TinyLabel>
        <div className="mx-auto mt-3 flex min-h-[74px] max-w-full items-center justify-center overflow-hidden px-2 text-center tabular-nums">
          <motion.div
            key={`${prefix}-${suffix}`}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.985 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="inline-flex max-w-full items-baseline justify-center overflow-hidden text-ellipsis whitespace-nowrap"
          >
            <input
              type="text"
              inputMode="numeric"
              value={displayValue}
              readOnly={readOnly}
              onChange={(e) => {
                if (readOnly) return;
                const rawValue = String(e.target.value ?? "");
                const strippedValue = rawValue.replace(/[$%]/g, "");
                onChange?.(strippedValue);
              }}
              style={
                fixedFontSize
                  ? { fontSize: `${fixedFontSize}px`, lineHeight: 1, width: `${inputWidthCh}ch` }
                  : { lineHeight: 1, width: `${inputWidthCh}ch` }
              }
              className={cn(
                "h-full min-w-0 max-w-full p-0 text-center outline-none caret-slate-500",
                computedFontSizeClass,
                HERO_NUMBER_TEXT_CLASS
              )}
              aria-label={label}
            />
          </motion.div>
        </div>

        {onToggle ? (
          <div className="mt-3 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-[3px] text-[9px] font-medium uppercase tracking-[0.22em] text-slate-500/80">
              <motion.button
                type="button"
                onClick={onToggle}
                whileTap={reduceMotion ? undefined : { scale: 0.97 }}
                className="inline-flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/70"
                aria-pressed={toggleState}
              >
                <span className={cn("transition-colors", toggleState ? "text-slate-500/80" : "text-slate-700")}>{toggleLabel === "Prop" ? toggleLabel : toggleLabel || "$"}</span>
                <motion.span
                  className="relative h-[14px] w-[30px] rounded-full"
                  animate={
                    toggleState
                      ? {
                          background: "linear-gradient(180deg,rgba(105,145,236,0.95),rgba(95,131,219,0.92))",
                          boxShadow: "0 0 0 1px rgba(77,116,210,0.12)",
                        }
                      : {
                          background: "rgba(203,213,225,0.45)",
                          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7), 0 0 0 1px rgba(148,163,184,0.25)",
                        }
                  }
                  transition={reduceMotion ? { duration: 0 } : SPRING}
                >
                  <motion.span
                    className="absolute left-[1px] top-[1px] h-[12px] w-[12px] rounded-full bg-[linear-gradient(180deg,#ffffff,#eef2ff)] shadow-[0_1px_4px_rgba(108,125,156,0.25)]"
                    animate={{ x: toggleState ? 16 : 0 }}
                    transition={reduceMotion ? { duration: 0 } : SPRING}
                  />
                </motion.span>
                {toggleLabel === "Prop" ? null : <span className={cn("transition-colors", toggleState ? "text-slate-700" : "text-slate-500/80")}>{toggleRightLabel || "%"}</span>}
              </motion.button>
              {toggleBadges}
            </div>
          </div>
        ) : null}
      </div>
    </GlassCard>
  );
}

function ProjectionChart({
  points,
  bandUpper,
  bandLower,
  projectionMode,
  milestones = [],
  inspectorEnabled = false,
  inspectorGoalValue = null,
  inspectorTradeUnitLabel = "",
  inspectorPositionSizes = [],
  hideHeader = false,
  compact = false,
  animatePath = false,
  disableAnimation = false,
  referenceLevels = [],
  entryTimeLabel = "",
  blendBackground = false,
}) {
  const reduceMotion = useReducedMotion();
  const chartVisualId = useId();
  const width = 320;
  const height = compact ? 118 : 150;
  const [activeIndex, setActiveIndex] = useState(null);
  const allValues = [...points, ...(bandUpper || []), ...(bandLower || [])];
  const max = Math.max(...allValues, 1);
  const min = Math.min(...allValues, 0);
  const yFor = (value) => height - ((value - min) / Math.max(max - min, 1)) * height;
  const pathFor = (series) =>
    series
      .map((value, i) => {
        const x = series.length <= 1 ? 0 : (i / (series.length - 1)) * width;
        return `${i === 0 ? "M" : "L"}${x},${yFor(value)}`;
      })
      .join(" ");
  const smoothPathFor = (series) => {
    if (!series.length) return "";
    if (series.length < 3) return pathFor(series);
    const coordinates = series.map((value, i) => ({
      x: series.length <= 1 ? 0 : (i / (series.length - 1)) * width,
      y: yFor(value),
    }));
    let path = `M${coordinates[0].x},${coordinates[0].y}`;
    for (let i = 0; i < coordinates.length - 1; i += 1) {
      const prev = coordinates[Math.max(0, i - 1)];
      const current = coordinates[i];
      const next = coordinates[i + 1];
      const afterNext = coordinates[Math.min(coordinates.length - 1, i + 2)];
      const smoothness = 0.2;
      const cp1x = current.x + ((next.x - prev.x) * smoothness) / 2;
      const cp1y = current.y + ((next.y - prev.y) * smoothness) / 2;
      const cp2x = next.x - ((afterNext.x - current.x) * smoothness) / 2;
      const cp2y = next.y - ((afterNext.y - current.y) * smoothness) / 2;
      path += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${next.x},${next.y}`;
    }
    return path;
  };

  const bandPath =
    projectionMode && bandUpper && bandLower
      ? `${pathFor(bandUpper)} ${bandLower
          .slice()
          .reverse()
          .map((value, i) => {
            const index = bandLower.length - 1 - i;
            const x = bandLower.length <= 1 ? 0 : (index / (bandLower.length - 1)) * width;
            return `L${x},${yFor(value)}`;
          })
          .join(" ")} Z`
      : "";

  const activePoint =
    inspectorEnabled && activeIndex !== null && activeIndex >= 0 && activeIndex < points.length
      ? {
          index: activeIndex,
          value: points[activeIndex],
          x: points.length <= 1 ? 0 : (activeIndex / (points.length - 1)) * width,
          y: yFor(points[activeIndex]),
        }
      : null;

  const activeMilestone = activePoint ? milestones.find((milestone) => Math.abs(milestone.x - activePoint.x) <= 12) : null;
  const activeRemaining = activePoint && inspectorGoalValue && Number.isFinite(inspectorGoalValue) ? Math.max(0, inspectorGoalValue - activePoint.value) : null;
  const activePositionSize = activePoint && inspectorPositionSizes[activePoint.index] ? inspectorPositionSizes[activePoint.index] : null;

  const handlePointerMove = (event) => {
    if (!inspectorEnabled || points.length < 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const touchClientX =
      event.touches && event.touches.length > 0 && typeof event.touches[0]?.clientX === "number"
        ? event.touches[0].clientX
        : null;
    const clientX = typeof event.clientX === "number" ? event.clientX : touchClientX;
    if (clientX === null) return;
    const relativeX = ((clientX - rect.left) / rect.width) * width;
    const clampedX = Math.max(0, Math.min(width, relativeX));
    const index = Math.round((clampedX / width) * (points.length - 1));
    setActiveIndex(Math.max(0, Math.min(points.length - 1, index)));
  };
  const shouldAnimatePath = animatePath && !disableAnimation && !reduceMotion;
  const chartDrawEase = [0.22, 1, 0.36, 1];
  const glowDrawTransition = shouldAnimatePath ? { duration: 1.85, ease: chartDrawEase } : { duration: 0 };
  const lineDrawTransition = shouldAnimatePath ? { duration: 1.72, ease: chartDrawEase, delay: 0.04 } : { duration: 0 };
  const markerRevealTransition = shouldAnimatePath ? { duration: 0.5, ease: chartDrawEase, delay: 0.2 } : { duration: 0 };
  const linePath = smoothPathFor(points);
  const gradientId = `projection-line-gradient-${chartVisualId}`;
  const glowId = `projection-line-glow-${chartVisualId}`;
  const entryPoint = points.length > 0 ? { x: 0, y: yFor(points[0]) } : null;
  const endPoint = points.length > 1 ? { x: width, y: yFor(points[points.length - 1]) } : null;
  const referenceLevelValues = referenceLevels.map((level) => Number(level?.value)).filter((value) => Number.isFinite(value));
  const referenceLevelMin = referenceLevelValues.length ? Math.min(...referenceLevelValues) : null;
  const referenceLevelMax = referenceLevelValues.length ? Math.max(...referenceLevelValues) : null;
  const hasReferenceDomain = referenceLevelMin !== null && referenceLevelMax !== null;
  const referenceRange = hasReferenceDomain ? Math.max(referenceLevelMax - referenceLevelMin, 1) : 1;
  const yForReferenceLevel = (value) => {
    if (!Number.isFinite(value) || !hasReferenceDomain) return null;
    return height - ((value - referenceLevelMin) / referenceRange) * height;
  };
  const isMinimalShareCardChart = compact && hideHeader && blendBackground;

  return (
    <GlassCard transparent={blendBackground} className={cn("rounded-[28px] p-4 sm:rounded-[30px]", compact && "rounded-[24px] p-3")}>
      {!hideHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <TinyLabel>{projectionMode ? "Projection" : "Growth Chart"}</TinyLabel>
            <div className="mt-1 text-[17px] font-semibold tracking-[-0.03em] text-slate-700 sm:text-[18px]">
              {projectionMode ? "Projected balance path" : "Compounded growth path"}
            </div>
          </div>
        </div>
      ) : null}
      <div
        className={cn(
          "overflow-hidden rounded-[24px] border border-blue-100/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.20),rgba(255,255,255,0.08))] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),inset_0_-8px_16px_rgba(148,163,184,0.04)]",
          hideHeader ? "mt-0" : "mt-4",
          compact && "rounded-[20px] border-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.24),rgba(255,255,255,0.14))] p-2.5 shadow-[0_8px_18px_rgba(148,163,184,0.06),inset_0_1px_0_rgba(255,255,255,0.62)]",
          blendBackground && "border border-slate-200/30 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.03))] shadow-[inset_0_1px_0_rgba(255,255,255,0.44)]",
          blendBackground && compact && "rounded-[18px] border-slate-200/24 p-2"
        )}
      >
        <div
          className="relative"
          onMouseMove={inspectorEnabled ? handlePointerMove : undefined}
          onMouseLeave={() => setActiveIndex(null)}
          onTouchStart={inspectorEnabled ? handlePointerMove : undefined}
          onTouchMove={inspectorEnabled ? handlePointerMove : undefined}
          onTouchEnd={() => setActiveIndex(null)}
        >
          <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="rgba(56,189,248,0.92)" />
                <stop offset="52%" stopColor="rgba(59,130,246,0.95)" />
                <stop offset="100%" stopColor="rgba(124,98,246,0.93)" />
              </linearGradient>
              <filter id={glowId} x="-20%" y="-40%" width="140%" height="180%">
                <feGaussianBlur stdDeviation="2" />
              </filter>
            </defs>
            {!isMinimalShareCardChart
              ? [0.32, 0.68].map((ratio) => (
                  <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
                ))
              : null}
            {referenceLevels.map((level) => {
              const y = yForReferenceLevel(Number(level?.value));
              if (y === null) return null;
              return (
                <g key={level.key || level.label}>
                  <line x1="0" x2={width} y1={y} y2={y} stroke={level.stroke || "rgba(100,116,139,0.24)"} strokeWidth="0.9" strokeDasharray="2 5" />
                  <circle cx={width - 2.5} cy={y} r="1.6" fill={level.stroke || "rgba(100,116,139,0.34)"} />
                </g>
              );
            })}
            {projectionMode && bandPath && !isMinimalShareCardChart ? <path d={bandPath} fill="rgba(96,165,250,0.06)" /> : null}
            {projectionMode && bandLower && !isMinimalShareCardChart ? <path d={pathFor(bandLower)} fill="none" stroke="rgba(148,163,184,0.16)" strokeWidth="1" strokeDasharray="3 5" /> : null}
            {projectionMode && bandUpper && !isMinimalShareCardChart ? <path d={pathFor(bandUpper)} fill="none" stroke="rgba(96,165,250,0.18)" strokeWidth="1" strokeDasharray="3 5" /> : null}
            <motion.path
              d={linePath}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="7"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.3"
              filter={`url(#${glowId})`}
              initial={shouldAnimatePath ? { pathLength: 0, opacity: 0.14 } : false}
              animate={shouldAnimatePath ? { pathLength: 1, opacity: 0.3 } : { pathLength: 1, opacity: 0.3 }}
              transition={glowDrawTransition}
            />
            <motion.path
              d={linePath}
              fill="none"
              stroke={`url(#${gradientId})`}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={shouldAnimatePath ? { pathLength: 0, opacity: 0.82 } : false}
              animate={shouldAnimatePath ? { pathLength: 1, opacity: 0.98 } : { pathLength: 1, opacity: 0.98 }}
              transition={lineDrawTransition}
            />
            {entryPoint ? (
              <motion.g
                initial={shouldAnimatePath ? { opacity: 0, scale: 0.96 } : false}
                animate={shouldAnimatePath ? { opacity: 1, scale: 1 } : { opacity: 1, scale: 1 }}
                transition={markerRevealTransition}
                style={{ transformOrigin: `${entryPoint.x}px ${entryPoint.y}px` }}
              >
                <circle cx={entryPoint.x} cy={entryPoint.y} r="2.8" fill="rgba(56,189,248,0.26)" />
                <circle cx={entryPoint.x} cy={entryPoint.y} r="1.65" fill="rgba(255,255,255,0.98)" stroke="rgba(56,189,248,0.62)" strokeWidth="0.9" />
                {entryTimeLabel ? (
                  <g>
                    <line x1={entryPoint.x + 5} x2={entryPoint.x + 5} y1={Math.max(0, entryPoint.y - 14)} y2={Math.max(0, entryPoint.y - 5)} stroke="rgba(71,85,105,0.4)" strokeWidth="1" />
                    <text x={entryPoint.x + 8} y={Math.max(10, entryPoint.y - 16)} textAnchor="start" fontSize="7.2" fontWeight="600" fill="rgba(71,85,105,0.78)">
                      {entryTimeLabel}
                    </text>
                  </g>
                ) : null}
              </motion.g>
            ) : null}
            {endPoint ? (
              <motion.g
                initial={shouldAnimatePath ? { opacity: 0, scale: 0.95 } : false}
                animate={shouldAnimatePath ? { opacity: 1, scale: 1 } : { opacity: 1, scale: 1 }}
                transition={markerRevealTransition}
                style={{ transformOrigin: `${endPoint.x}px ${endPoint.y}px` }}
              >
                <circle cx={endPoint.x} cy={endPoint.y} r="3.4" fill="rgba(99,102,241,0.2)" />
                <circle cx={endPoint.x} cy={endPoint.y} r="2" fill="rgba(255,255,255,0.98)" stroke="rgba(99,102,241,0.7)" strokeWidth="1" />
              </motion.g>
            ) : null}
            {activePoint ? (
              <g>
                <line x1={activePoint.x} x2={activePoint.x} y1="0" y2={height} stroke="rgba(59,130,246,0.25)" strokeWidth="1.5" strokeDasharray="4 4" />
                <circle cx={activePoint.x} cy={activePoint.y} r="4.5" fill="rgba(59,130,246,0.98)" stroke="rgba(255,255,255,0.96)" strokeWidth="2" />
              </g>
            ) : null}
            {milestones.map((milestone) => {
              const x = Math.max(0, Math.min(width, milestone.x));
              const y = Math.max(0, Math.min(height, yFor(milestone.value)));
              return (
                <g key={milestone.key}>
                  <circle
                    cx={x}
                    cy={y}
                    r={milestone.isGoal ? 4.5 : 3.5}
                    fill={milestone.isGoal ? "rgba(37,99,235,0.98)" : "rgba(255,255,255,0.98)"}
                    stroke={milestone.isGoal ? "rgba(191,219,254,1)" : "rgba(96,165,250,0.9)"}
                    strokeWidth="2"
                  />
                  {milestone.label ? (
                    <text x={x} y={Math.max(12, y - 10)} textAnchor="middle" fontSize="8" fontWeight="600" fill="rgba(71,85,105,0.88)">
                      {milestone.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {activePoint ? (
            <div
              className="pointer-events-none absolute top-2 z-10 max-w-[162px] rounded-[18px] border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,248,255,0.84))] px-3 py-2 text-[11px] text-slate-600 shadow-[0_10px_24px_rgba(118,138,183,0.14),inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-[18px]"
              style={{ left: `${Math.max(8, Math.min(width - 144, activePoint.x - 58))}px` }}
            >
              <div className="font-semibold tracking-[-0.01em] text-slate-700">{inspectorTradeUnitLabel ? `${inspectorTradeUnitLabel} ${activePoint.index + 1}` : `Period ${activePoint.index + 1}`}</div>
              <div className="mt-1">Balance: {formatCurrency(activePoint.value)}</div>
              {activePositionSize ? <div>Position Size: {activePositionSize}</div> : null}
              {activeRemaining !== null ? <div>Distance to Goal: {formatCurrency(activeRemaining)}</div> : null}
              {activeMilestone?.label ? <div className="mt-1 text-blue-600/90">{activeMilestone.isGoal ? "Goal milestone" : activeMilestone.label}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </GlassCard>
  );
}

function MetricRowCard({ label, value, tone = "default", animatedNumber = null, formatter = null }) {
  const shouldAnimateValue = animatedNumber !== null && typeof formatter === "function";
  return (
    <GlassCard className="rounded-[22px] border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.10))] px-3 py-[18px] shadow-[0_6px_18px_rgba(145,160,190,0.06),inset_0_1px_0_rgba(255,255,255,0.68)]">
      <TinyLabel className="text-center text-slate-500/80">{label}</TinyLabel>
      <div
        className={cn(
          "mt-2.5 text-center text-[16px] font-semibold tracking-[-0.04em]",
          tone === "positive" && "text-emerald-500/90",
          tone === "negative" && "text-rose-500/85",
          tone === "default" && "text-slate-600"
        )}
      >
        {shouldAnimateValue ? <AnimatedFormattedNumber value={animatedNumber} formatter={formatter} /> : value}
      </div>
    </GlassCard>
  );
}

function CompoundFieldGroup({ label, rightLabel, children, className = "" }) {
  return (
    <div className={cn("space-y-2 self-start", className)}>
      <div className="flex min-h-[10px] items-center justify-between gap-2 px-1">
        <TinyLabel>{label}</TinyLabel>
        {rightLabel ? <TinyLabel>{rightLabel}</TinyLabel> : <span className="min-h-[10px]" />}
      </div>
      {children}
    </div>
  );
}

function CompoundInputShell({ children, className = "" }) {
  return (
    <div className="group relative">
      <div className="pointer-events-none absolute -inset-[1px] rounded-[23px] bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.52),transparent_62%),linear-gradient(180deg,rgba(126,164,255,0.20),rgba(255,255,255,0.04))] opacity-100 blur-[7px] transition-all duration-200 group-focus-within:blur-[11px]" />
      <div className="pointer-events-none absolute inset-0 rounded-[22px] bg-[linear-gradient(180deg,rgba(255,255,255,0.34),rgba(255,255,255,0.12))] opacity-90 transition-opacity duration-200 group-focus-within:opacity-100" />
      <GlassCard
        className={cn(
          "relative flex h-[52px] min-h-[52px] items-center rounded-[22px] border border-white/85 bg-[linear-gradient(180deg,rgba(255,255,255,0.76),rgba(248,251,255,0.50))] px-4 shadow-[0_14px_30px_rgba(139,157,193,0.12),0_3px_10px_rgba(166,180,209,0.07),0_0_0_1px_rgba(255,255,255,0.56),0_0_18px_rgba(126,164,255,0.10),inset_0_1px_0_rgba(255,255,255,0.99),inset_0_-1px_0_rgba(214,223,242,0.38)] ring-1 ring-slate-200/55 transition-all duration-200 group-focus-within:border-blue-200/90 group-focus-within:ring-[rgba(96,165,250,0.58)] group-focus-within:shadow-[0_18px_36px_rgba(120,150,210,0.20),0_8px_18px_rgba(120,150,210,0.12),0_0_0_1px_rgba(191,219,254,0.46),0_0_24px_rgba(96,165,250,0.16),inset_0_1px_0_rgba(255,255,255,0.99),inset_0_-1px_0_rgba(191,219,254,0.18)] sm:px-[18px]",
          className
        )}
        padded={false}
      >
        <div className="flex h-[52px] min-h-[52px] w-full items-center">{children}</div>
      </GlassCard>
      <div className="pointer-events-none absolute inset-0 rounded-[22px] ring-2 ring-blue-300/12 transition-all duration-200 group-focus-within:ring-blue-300/38" />
    </div>
  );
}

function PositionScreen({ positionState, setPositionState, profileState, debugEnabled = false }) {
  const reduceMotion = useReducedMotion();
  const lastManualContractsRef = useRef("1");
  const hasMountedContractsEffectRef = useRef(false);
  const lastDefaultInstrumentRef = useRef(POSITION_INSTRUMENTS[2]?.key || "MNQ");
  const [activePriceField, setActivePriceField] = useState(null);
  const [instrumentPickerOpen, setInstrumentPickerOpen] = useState(false);
  const [instrumentQuery, setInstrumentQuery] = useState("");
  const [priceDrafts, setPriceDrafts] = useState(() => ({
    entry: sanitizePriceInputString(positionState.entry),
    stop: sanitizePriceInputString(positionState.stop),
    target: sanitizePriceInputString(positionState.target),
  }));
  const instrument = positionState.instrument || "MNQ";
  const entry = positionState.entry ?? "";
  const stop = positionState.stop ?? "";
  const target = positionState.target ?? "";
  const winRate = positionState.winRate ?? 55;
  const kelly = positionState.kelly || "½";

  const selectedInstrumentFromCatalog = getInstrumentBySymbol(instrument) || getInstrumentBySymbol("MNQ");
  const isDefaultInstrument = POSITION_INSTRUMENTS.some((item) => item.key === instrument);
  const selectedShortcutInstrument = POSITION_INSTRUMENTS.find((item) => item.key === instrument) || POSITION_INSTRUMENTS[2];
  const pointValue = selectedInstrumentFromCatalog?.pointValue ?? selectedShortcutInstrument.pointValue ?? 1;
  const fallbackValue = "—";
  const positionSetupSnapshot = derivePositionSetupSnapshot(positionState);
  const effectiveAccountBalanceValue = positionState.accountBalance;
  const isAccountBalanceReadOnly = false;
  const parsedAccountBalance = parseNullableNumberString(effectiveAccountBalanceValue);
  const accountBalance = parsedAccountBalance !== null ? Math.max(0, parsedAccountBalance) : 0;
  const entryPrice = positionSetupSnapshot.entry;
  const stopPrice = positionSetupSnapshot.stop;
  const riskPoints = positionSetupSnapshot.riskPoints;
  const rewardPoints = positionSetupSnapshot.rewardPoints;
  const rewardRiskRatio = positionSetupSnapshot.rewardRiskRatio;
  const riskPerContract = riskPoints * pointValue;

  const winProbability = Math.max(0, Math.min(1, winRate / 100));
  const lossProbability = 1 - winProbability;
  const rawKellyFraction = rewardRiskRatio > 0 ? winProbability - lossProbability / rewardRiskRatio : 0;
  const clampedKellyFraction = Math.max(0, Math.min(1, Number.isFinite(rawKellyFraction) ? rawKellyFraction : 0));
  const kellyPercent = clampedKellyFraction * 100;

  const isKellyManual = kelly === "Off";
  const kellyModeMultiplier = kelly === "Full" ? 1 : kelly === "½" ? 0.5 : kelly === "¼" ? 0.25 : 0;
  const appliedKellyFraction = isKellyManual ? 0 : Math.max(0, clampedKellyFraction * kellyModeMultiplier);
  const riskBudget = accountBalance > 0 ? accountBalance * appliedKellyFraction : 0;

  const sizingReady = accountBalance > 0 && entryPrice > 0 && stopPrice > 0 && riskPerContract > 0;
  const rawSuggestedContracts = sizingReady && Number.isFinite(riskBudget) ? Math.floor(riskBudget / riskPerContract) : 0;
  const autoSuggestedContracts = Number.isFinite(rawSuggestedContracts) ? Math.max(0, rawSuggestedContracts) : 0;
  const manualContractsInput = positionState.contracts ?? "";
  const manualContractCount = Math.max(0, parseNumberString(manualContractsInput || "0"));
  const activeContractCount = isKellyManual ? manualContractCount : autoSuggestedContracts;
  const suggestedContractsDisplay = isKellyManual ? manualContractsInput : String(activeContractCount);

  const potentialRisk = activeContractCount * riskPerContract;
  const potentialReturn = activeContractCount * rewardPoints * pointValue;

  useEffect(() => {
    if (!hasMountedContractsEffectRef.current) {
      hasMountedContractsEffectRef.current = true;
      return;
    }

    if (!isKellyManual) {
      const nextContracts = String(autoSuggestedContracts);
      if ((positionState.contracts || "") !== nextContracts) {
        setPositionState((prev) => ({ ...prev, contracts: nextContracts }));
      }
    }
  }, [isKellyManual, autoSuggestedContracts, positionState.contracts, setPositionState]);

  const setField = (key, value) => setPositionState((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    setPriceDrafts((prev) => {
      const next = { ...prev };
      let changed = false;
      const syncField = (key, sourceValue) => {
        if (activePriceField === key) return;
        const sanitized = sanitizePriceInputString(sourceValue);
        if (next[key] !== sanitized) {
          next[key] = sanitized;
          changed = true;
        }
      };
      syncField("entry", entry);
      syncField("stop", stop);
      syncField("target", target);
      return changed ? next : prev;
    });
  }, [activePriceField, entry, stop, target]);

  const handleInstrumentChange = (nextInstrument) => {
    let didChange = false;
    setPositionState((prev) => {
      if (prev.instrument === nextInstrument) return prev;
      didChange = true;
      const selected = POSITION_INSTRUMENTS.find((item) => item.key === nextInstrument) || POSITION_INSTRUMENTS[2];
      const defaults = selected.defaults || POSITION_INSTRUMENTS[2].defaults;
      return {
        ...prev,
        instrument: nextInstrument,
        entry: defaults.entry,
        stop: defaults.stop,
        target: defaults.target,
      };
    });

    if (didChange) triggerLightHaptic();
  };

  const handleTogglePropMode = () => {
    setField("propMode", !positionState.propMode);
    triggerLightHaptic();
  };

  useEffect(() => {
    if (!isDefaultInstrument) return;
    lastDefaultInstrumentRef.current = instrument;
  }, [instrument, isDefaultInstrument]);

  const handleManualContractsChange = (raw) => {
    const rawDigits = keepDigitsOnly(raw, 3, "");
    const nextValue = rawDigits.length > 1 ? rawDigits.replace(/^0+/, "") || "" : rawDigits;
    if (nextValue !== "") lastManualContractsRef.current = nextValue;
    setField("contracts", nextValue);
  };

  const handlePriceFocus = (key) => {
    setActivePriceField(key);
    setPriceDrafts((prev) => ({
      ...prev,
      [key]: sanitizePriceInputString(positionState[key]),
    }));
  };

  const handlePriceChange = (key, raw) => {
    const nextRaw = sanitizePriceInputString(raw);
    setPriceDrafts((prev) => ({ ...prev, [key]: nextRaw }));
    setField(key, nextRaw);
  };

  const handlePriceBlur = (key) => {
    const formatted = formatPriceOnBlur(priceDrafts[key], 2);
    setField(key, formatted);
    setPriceDrafts((prev) => ({ ...prev, [key]: sanitizePriceInputString(formatted) }));
    setActivePriceField((prev) => (prev === key ? null : prev));
  };

  const resolvePriceValue = (key, persistedValue) => (activePriceField === key ? priceDrafts[key] : persistedValue);
  const pickerResults = useMemo(() => {
    const defaultShortcutSymbols = new Set(POSITION_INSTRUMENTS.map((item) => item.key));
    return searchInstruments(instrumentQuery, { limit: 120 }).filter((instrumentOption) => !defaultShortcutSymbols.has(instrumentOption.symbol) && instrumentOption.category !== "Rates");
  }, [instrumentQuery]);

  return (
    <div className="space-y-4 pb-4">
      <DebugRenderMarker enabled={debugEnabled} markerText="POSITION SCREEN" />
      <ScreenHeader />
      <PositionInstrumentSelector
        items={POSITION_INSTRUMENTS.map((item) => item.key)}
        value={instrument}
        onChange={handleInstrumentChange}
        onOpenSearch={() => {
          triggerLightHaptic();
          setInstrumentPickerOpen(true);
        }}
        customInstrument={selectedInstrumentFromCatalog}
        isCustomMode={!isDefaultInstrument}
        onReturnToCompact={() => handleInstrumentChange(lastDefaultInstrumentRef.current || POSITION_INSTRUMENTS[0].key)}
      />
      <FuturesInstrumentPicker
        open={instrumentPickerOpen}
        query={instrumentQuery}
        onQueryChange={setInstrumentQuery}
        results={pickerResults}
        onClose={() => setInstrumentPickerOpen(false)}
        onSelect={(symbol) => {
          handleInstrumentChange(symbol);
          setInstrumentPickerOpen(false);
        }}
      />
      <BalanceHeroCard
        label="Account Balance"
        fixedFontSize={52}
        value={effectiveAccountBalanceValue}
        readOnly={isAccountBalanceReadOnly}
        onChange={(raw) => {
          if (isAccountBalanceReadOnly) return;
          setField("accountBalance", formatNumberString(raw));
        }}
        toggleLabel="Prop"
        toggleState={positionState.propMode}
        onToggle={handleTogglePropMode}
        toggleBadges={null}
      />

      <div className="grid grid-cols-3 gap-2.5 opacity-[0.96]">
        <GlassCard className="rounded-[22px] border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.10))] px-3 py-[14px] shadow-[0_6px_18px_rgba(145,160,190,0.06),inset_0_1px_0_rgba(255,255,255,0.68)]">
          <TinyLabel className="text-center text-slate-500/80">Entry</TinyLabel>
          <input
            type="text"
            inputMode="decimal"
            value={resolvePriceValue("entry", entry)}
            onFocus={() => handlePriceFocus("entry")}
            onChange={(e) => handlePriceChange("entry", e.target.value)}
            onBlur={() => handlePriceBlur("entry")}
            className="mt-2.5 w-full bg-transparent text-center text-[16px] font-semibold tracking-[-0.04em] text-slate-600 outline-none"
          />
        </GlassCard>
        <GlassCard className="rounded-[22px] border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.10))] px-3 py-[14px] shadow-[0_6px_18px_rgba(145,160,190,0.06),inset_0_1px_0_rgba(255,255,255,0.68)]">
          <TinyLabel className="text-center text-slate-500/80">Stop</TinyLabel>
          <input
            type="text"
            inputMode="decimal"
            value={resolvePriceValue("stop", stop)}
            onFocus={() => handlePriceFocus("stop")}
            onChange={(e) => handlePriceChange("stop", e.target.value)}
            onBlur={() => handlePriceBlur("stop")}
            className="mt-2.5 w-full bg-transparent text-center text-[16px] font-semibold tracking-[-0.04em] text-rose-500/85 outline-none"
          />
        </GlassCard>
        <GlassCard className="rounded-[22px] border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.10))] px-3 py-[14px] shadow-[0_6px_18px_rgba(145,160,190,0.06),inset_0_1px_0_rgba(255,255,255,0.68)]">
          <TinyLabel className="text-center text-slate-500/80">Target</TinyLabel>
          <input
            type="text"
            inputMode="decimal"
            value={resolvePriceValue("target", target)}
            onFocus={() => handlePriceFocus("target")}
            onChange={(e) => handlePriceChange("target", e.target.value)}
            onBlur={() => handlePriceBlur("target")}
            className="mt-2.5 w-full bg-transparent text-center text-[16px] font-semibold tracking-[-0.04em] text-emerald-500/90 outline-none"
          />
        </GlassCard>
      </div>

      <GlassCard className="overflow-visible rounded-[24px] px-5 py-2.5">
        <div className="flex items-center gap-3">
          <div className="min-w-[42px]"><TinyLabel className="whitespace-nowrap">WIN %</TinyLabel></div>
          <div className="relative flex-1 overflow-visible rounded-full py-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.22)_45%,rgba(255,255,255,0)_100%)] opacity-60 blur-[0.5px]" style={{ width: "36px", transform: `translateX(calc(${winRate}% - 18px))`, transition: "transform 120ms cubic-bezier(0.22,1,0.36,1)" }} />
            <input type="range" min="0" max="100" step="1" value={winRate} onChange={(e) => setField("winRate", Number(e.target.value))} className="slider-premium w-full cursor-pointer appearance-none bg-transparent" aria-label="Win Rate" />
          </div>
          <div className="min-w-[44px] text-right text-[17px] font-semibold tracking-[-0.04em] text-slate-700">
            <motion.div key={`win-rate-${winRate}`} initial={reduceMotion ? false : { opacity: 0.55, y: 2, scale: 0.992, filter: "blur(0.8px)" }} animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }} transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 28, mass: 0.42 }}>
              {winRate}%
            </motion.div>
          </div>
        </div>
      </GlassCard>

      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <TinyLabel>Kelly</TinyLabel>
          <div className="text-[9px] font-medium uppercase tracking-[0.28em] text-slate-500/90 text-right">{rewardRiskRatio > 0 ? formatPercent(kellyPercent, 1) : fallbackValue}</div>
        </div>
        <SegmentedControl items={KELLY_OPTIONS} value={kelly} onChange={(value) => setField("kelly", value)} />
      </div>

      <GlassCard className="rounded-[30px] px-5 pb-5 pt-6 sm:px-6 sm:pt-7" highlight>
        <TinyLabel className="text-center">{isKellyManual ? "Manual Position" : "Suggested Position"}</TinyLabel>
        <div className="mt-4 text-center">
          <div className="flex min-h-[88px] items-center justify-center px-2 overflow-visible">
            <motion.div key={isKellyManual ? "manual-contracts-input" : suggestedContractsDisplay} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={reduceMotion ? { duration: 0 } : SPRING} className="w-full">
              {isKellyManual ? (
                <input
                  type="text"
                  inputMode="numeric"
                  value={suggestedContractsDisplay}
                  onChange={(e) => handleManualContractsChange(e.target.value)}
                  className="w-full bg-[linear-gradient(180deg,#5A81D9_0%,#6F91E6_44%,#B69357_100%)] bg-clip-text text-center text-[78px] font-semibold leading-[0.92] tracking-[-0.075em] text-transparent outline-none"
                />
              ) : (
                <div className="w-full bg-[linear-gradient(180deg,#5A81D9_0%,#6F91E6_44%,#B69357_100%)] bg-clip-text text-center text-[78px] font-semibold leading-[0.92] tracking-[-0.075em] text-transparent">
                  <AnimatedFormattedNumber value={autoSuggestedContracts} formatter={(value) => Math.max(0, Math.floor(value)).toLocaleString("en-US")} />
                </div>
              )}
            </motion.div>
          </div>
          <div className="mt-1.5 text-[16px] font-medium tracking-[-0.02em] text-slate-500">contracts</div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          <MetricRowCard label="Risk" value={formatCurrency(potentialRisk)} animatedNumber={potentialRisk} formatter={formatCurrency} tone="negative" />
          <MetricRowCard label="Return" value={formatCurrency(potentialReturn)} animatedNumber={potentialReturn} formatter={formatCurrency} tone="positive" />
          <MetricRowCard label="R" value={`${rewardRiskRatio.toFixed(1)}R`} animatedNumber={rewardRiskRatio} formatter={(value) => `${value.toFixed(1)}R`} />
        </div>
      </GlassCard>
    </div>
  );
}

function CompoundScreen({ positionState, compoundState, setCompoundState, debugEnabled = false }) {
  const reduceMotion = useReducedMotion();
  const projectionMode = compoundState.projectionMode;
  const projectionGoalDisplayType = compoundState.projectionGoalDisplayType;
  const projectionGoalDollarInput = compoundState.projectionGoalDollarInput;
  const projectionGoalPercentInput = compoundState.projectionGoalPercentInput;
  const projectionGoalDisplayInput = projectionGoalDisplayType === "%" ? projectionGoalPercentInput : projectionGoalDollarInput;
  const manualStartingBalanceInput = compoundState.manualStartingBalanceInput;
  const tradeFrequencyValue = compoundState.tradeFrequencyValue;
  const tradeFrequency = compoundState.tradeFrequency;
  const gainInput = compoundState.gainInput;
  const winRateInput = compoundState.winRateInput;
  const durationInput = compoundState.durationInput;
  const durationUnit = compoundState.durationUnit;

  const setProjectionMode = (value) => setCompoundState((prev) => ({ ...prev, projectionMode: value }));
  const setProjectionGoalDisplayType = (value) =>
    setCompoundState((prev) => ({
      ...prev,
      projectionGoalDisplayType: typeof value === "function" ? value(prev.projectionGoalDisplayType) : value,
    }));
  const setProjectionGoalDisplayInput = (value) =>
    setCompoundState((prev) => ({
      ...prev,
      [prev.projectionGoalDisplayType === "%" ? "projectionGoalPercentInput" : "projectionGoalDollarInput"]: value,
    }));
  const setManualStartingBalanceInput = (value) => setCompoundState((prev) => ({ ...prev, manualStartingBalanceInput: value }));
  const setTradeFrequencyValue = (value) => setCompoundState((prev) => ({ ...prev, tradeFrequencyValue: value }));
  const setTradeFrequency = (value) => setCompoundState((prev) => ({ ...prev, tradeFrequency: value }));
  const setGainInput = (value) => setCompoundState((prev) => ({ ...prev, gainInput: value }));
  const setWinRateInput = (value) => setCompoundState((prev) => ({ ...prev, winRateInput: value }));
  const setDurationInput = (value) => setCompoundState((prev) => ({ ...prev, durationInput: value }));
  const setDurationUnit = (value) => setCompoundState((prev) => ({ ...prev, durationUnit: value }));

  const modeItems = [
    { value: "On", label: "Forecast" },
    { value: "Off", label: "Compound" },
  ];
  const frequencyItems = [
    { value: "Per Day", label: "Day" },
    { value: "Per Week", label: "Week" },
    { value: "Per Month", label: "Month" },
  ];
  const durationItems = ["Days", "Weeks", "Months"];
  const fallbackValue = "—";

  const sanitizeEditableIntegerInput = (raw, maxDigits = 3) => {
    const digits = String(raw ?? "").replace(/[^0-9]/g, "").slice(0, maxDigits);
    if (!digits) return "";
    return digits.length > 1 ? digits.replace(/^0+/, "") || "" : digits;
  };

  const sanitizePercentInput = (raw, maxDigits = 3) => {
    const clean = String(raw ?? "").replace(/[^0-9.]/g, "");
    const numeric = parseNumberString(clean);
    if (!clean.trim()) return "";
    return String(Math.max(0, Math.min(999, numeric))).slice(0, maxDigits);
  };

  const startingBalance = Math.max(0, parseNumberString(positionState.accountBalance || "50,000"));
  const manualStartingBalance = Math.max(0, parseNumberString(manualStartingBalanceInput || "0"));
  const minimumDollarGoal = startingBalance > 0 ? startingBalance + 1 : 1;
  const rawDollarGoalNumeric = Math.max(0, parseNumberString(projectionGoalDollarInput || "0"));
  const rawPercentGoalNumeric = Math.max(0, parseNumberString(projectionGoalPercentInput || "0"));
  const activeGoalNumeric = projectionGoalDisplayType === "%" ? rawPercentGoalNumeric : rawDollarGoalNumeric;
  const projectionDollarGoalWarningActive =
    projectionGoalDisplayType === "$" &&
    String(projectionGoalDollarInput || "").trim() !== "" &&
    rawDollarGoalNumeric > 0 &&
    rawDollarGoalNumeric < minimumDollarGoal;
  const parsedTradeFrequencyValue = Math.max(0, parseNumberString(tradeFrequencyValue || "0"));
  const safeTradeFrequencyValue = Math.max(1, parsedTradeFrequencyValue || 1);
  const parsedGainPercent = Math.max(0, parseNumberString(gainInput || "0"));
  const parsedWinRatePercent = Math.max(0, Math.min(100, parseNumberString(winRateInput || "0")));
  const parsedDurationValue = Math.max(0, parseNumberString(durationInput || "0"));

  const projectionUsesPercent = projectionGoalDisplayType === "%";
  const projectionGoalHasValue = activeGoalNumeric > 0;
  const projectionFrequencyHasValue = parsedTradeFrequencyValue > 0;
  const hasSafeGain = parsedGainPercent > 0;
  const hasSafeWinRate = parsedWinRatePercent > 0;

  const effectiveGrowthPercentPerPeriod = hasSafeGain
    ? Math.max(0.1, parsedGainPercent * (hasSafeWinRate ? 0.5 + parsedWinRatePercent / 200 : 1) * safeTradeFrequencyValue)
    : 0;

  const projectionTargetBalance = resolveForecastTargetBalance(
    projectionGoalDisplayType,
    rawDollarGoalNumeric,
    rawPercentGoalNumeric,
    startingBalance,
    minimumDollarGoal
  );

  const baseContracts = Math.max(1, parseNumberString(positionState.contracts || "1"));
  const selectedInstrument = POSITION_INSTRUMENTS.find((item) => item.key === (positionState.instrument || "MNQ")) || POSITION_INSTRUMENTS[2];
  const hasSafeScalingInputs = startingBalance > 0 && baseContracts > 0 && !!selectedInstrument;
  const balancePerContractTier = hasSafeScalingInputs ? Math.max(1, startingBalance / baseContracts) : null;

  const projectionPathModel = useMemo(
    () =>
      buildProjectionPathModel({
        projectionTargetBalance,
        startingBalance,
        effectiveGrowthPercentPerPeriod,
        hasSafeScalingInputs,
        balancePerContractTier,
        baseContracts,
        hasSafeGain,
        parsedGainPercent,
        hasSafeWinRate,
        parsedWinRatePercent,
      }),
    [
      projectionTargetBalance,
      startingBalance,
      effectiveGrowthPercentPerPeriod,
      hasSafeScalingInputs,
      balancePerContractTier,
      baseContracts,
      hasSafeGain,
      parsedGainPercent,
      hasSafeWinRate,
      parsedWinRatePercent,
    ]
  );

  const projectionChartPoints = projectionPathModel.points.length >= 2 ? projectionPathModel.points : [];
  const projectionChartReady = projectionChartPoints.length >= 2;
  const projectionPeriodsEstimate = projectionPathModel.periodsEstimate;
  const projectionTradeUnitLabel = tradeFrequency === "Per Day" ? "Day" : tradeFrequency === "Per Week" ? "Week" : "Month";
  const projectionUnitLabel = tradeFrequency === "Per Day"
    ? projectionPeriodsEstimate === 1
      ? "day"
      : "days"
    : tradeFrequency === "Per Week"
      ? projectionPeriodsEstimate === 1
        ? "week"
        : "weeks"
      : projectionPeriodsEstimate === 1
        ? "month"
        : "months";
  const projectionEstimatePrimary = projectionPeriodsEstimate
    ? `${projectionPeriodsEstimate} ${projectionUnitLabel}`
    : projectionDollarGoalWarningActive
      ? "Goal above start"
      : "Enter valid goal and frequency";

  const projectionDrawdownMetrics = useMemo(() => {
    const safeGain = Math.max(0, parsedGainPercent || 0);
    const safeWinRate = hasSafeWinRate ? parsedWinRatePercent : 50;
    const safePeriods = projectionPeriodsEstimate && Number.isFinite(projectionPeriodsEstimate) ? Math.max(1, projectionPeriodsEstimate) : 0;
    const safeTradeCount = Math.max(1, safeTradeFrequencyValue || 1);
    if (!projectionTargetBalance || !projectionGoalHasValue || !projectionFrequencyHasValue || safeGain <= 0) {
      return { expected: fallbackValue, worst: fallbackValue, streak: fallbackValue };
    }
    const lossFactor = Math.max(0.2, (100 - safeWinRate) / 100);
    const expectedDrawdown = Math.min(85, Math.max(3, Math.round(safeGain * (1.2 + lossFactor * 2.2) + safeTradeCount * 0.6)));
    const worstCaseDrawdown = Math.min(95, Math.max(expectedDrawdown + 4, Math.round(expectedDrawdown * 1.65 + Math.min(12, safePeriods * 0.18))));
    const averageLosingStreak = Math.min(18, Math.max(1, Math.round((100 - safeWinRate) / 12 + safeTradeCount / 2 + Math.min(4, safePeriods / 10))));
    return {
      expected: formatPercent(expectedDrawdown),
      worst: formatPercent(worstCaseDrawdown),
      streak: `${averageLosingStreak} trades`,
    };
  }, [parsedGainPercent, parsedWinRatePercent, hasSafeWinRate, projectionPeriodsEstimate, safeTradeFrequencyValue, projectionGoalHasValue, projectionFrequencyHasValue, projectionTargetBalance]);

  const projectionBandUpper = projectionPathModel.bandUpper;
  const projectionBandLower = projectionPathModel.bandLower;

  const projectionPositionSizeSeries = useMemo(() => {
    if (projectionChartPoints.length < 2) return [];
    return projectionChartPoints.map((value) => {
      if (!hasSafeScalingInputs || !balancePerContractTier) return `${baseContracts} ctr`;
      const contracts = Math.max(1, Math.min(Math.floor(value / balancePerContractTier), baseContracts * 24));
      return `${contracts} ctr`;
    });
  }, [projectionChartPoints, hasSafeScalingInputs, balancePerContractTier, baseContracts]);

  const projectionMilestones = useMemo(() => {
    if (!projectionChartReady || !projectionTargetBalance || startingBalance <= 0) return [];
    const safeTarget = Math.max(startingBalance, projectionTargetBalance);
    const sizeMilestones = projectionPathModel.sizingMilestones.map((milestone) => ({
      key: milestone.key,
      x: projectionChartPoints.length <= 1 ? 0 : (milestone.period / Math.max(1, projectionChartPoints.length - 1)) * 320,
      value: milestone.value,
      label: milestone.label,
      isGoal: false,
    }));
    if (sizeMilestones.length > 0) {
      return [
        { key: "start-balance", x: 0, value: startingBalance, label: "Start", isGoal: false },
        ...sizeMilestones.slice(0, 4),
        { key: "goal-balance", x: 320, value: safeTarget, label: "Goal", isGoal: true },
      ];
    }
    const span = safeTarget - startingBalance;
    if (span <= 0) return [];
    const compactCurrency = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
      notation: "compact",
    });
    return [0, 0.25, 0.5, 0.75, 1].map((ratio, index) => ({
      key: `milestone-${index}`,
      x: ratio * 320,
      value: startingBalance + span * ratio,
      label: index === 0 ? "Start" : index === 4 ? "Goal" : compactCurrency.format(startingBalance + span * ratio),
      isGoal: index === 4,
    }));
  }, [projectionChartReady, projectionTargetBalance, startingBalance, projectionPathModel.sizingMilestones, projectionChartPoints.length]);

  const projectionEstimatedGoalDate = useMemo(() => {
    if (!projectionPeriodsEstimate || !Number.isFinite(projectionPeriodsEstimate)) return null;
    const periods = Math.max(1, Math.round(projectionPeriodsEstimate));
    const baseDate = new Date();
    const formatFullGoalDate = (date) => {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
      return date.toLocaleDateString("en-US", {
        weekday: "short",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    };

    if (tradeFrequency === "Per Day") {
      const date = new Date(baseDate);
      let added = 0;
      while (added < periods) {
        date.setDate(date.getDate() + 1);
        const day = date.getDay();
        if (day !== 0 && day !== 6) added += 1;
      }
      return formatFullGoalDate(date);
    }

    if (tradeFrequency === "Per Week") {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + periods * 7);
      return formatFullGoalDate(date);
    }

    const date = new Date(baseDate);
    date.setMonth(date.getMonth() + periods);
    return formatFullGoalDate(date);
  }, [projectionPeriodsEstimate, tradeFrequency]);

  const projectionEstimatedGoalDateLabel = projectionEstimatedGoalDate ? `Estimated Goal Date: ${projectionEstimatedGoalDate}` : "Goal date unavailable";
  const projectionGoalSummaryValue = projectionUsesPercent ? formatPercent(rawPercentGoalNumeric) : formatCurrency(rawDollarGoalNumeric);

  const normalCompoundingIntervals = useMemo(() => {
    const durationValue = Math.max(0, parsedDurationValue);
    const frequencyValue = Math.max(0, parsedTradeFrequencyValue);
    if (durationValue <= 0 || frequencyValue <= 0) return 0;
    const durationInDays = durationUnit === "Days" ? durationValue : durationUnit === "Weeks" ? durationValue * 7 : durationValue * 30;
    const frequencyPerDay = tradeFrequency === "Per Day" ? frequencyValue : tradeFrequency === "Per Week" ? frequencyValue / 7 : frequencyValue / 30;
    const intervals = durationInDays * frequencyPerDay;
    return Number.isFinite(intervals) ? Math.max(0, Math.floor(intervals)) : 0;
  }, [parsedDurationValue, durationUnit, parsedTradeFrequencyValue, tradeFrequency]);

  const normalEffectiveGrowthRate = useMemo(() => {
    const gainRate = Math.max(0, parsedGainPercent) / 100;
    if (gainRate <= 0) return 0;
    const hasValidWinRate = Number.isFinite(parsedWinRatePercent) && parsedWinRatePercent > 0 && parsedWinRatePercent <= 100;
    const winRateModifier = hasValidWinRate ? 0.5 + parsedWinRatePercent / 200 : 1;
    return gainRate * winRateModifier;
  }, [parsedGainPercent, parsedWinRatePercent]);

  const normalLine = useMemo(() => {
    if (manualStartingBalance <= 0 || normalCompoundingIntervals <= 0 || normalEffectiveGrowthRate <= 0) {
      return manualStartingBalance > 0 ? [manualStartingBalance] : [0];
    }
    const arr = [manualStartingBalance];
    for (let i = 1; i <= normalCompoundingIntervals; i += 1) {
      const prev = arr[i - 1];
      const nextValue = prev * (1 + normalEffectiveGrowthRate);
      arr.push(Number.isFinite(nextValue) ? nextValue : prev);
    }
    return arr;
  }, [manualStartingBalance, normalCompoundingIntervals, normalEffectiveGrowthRate]);

  const normalEndingBalance = normalLine[normalLine.length - 1] || manualStartingBalance || 0;
  const normalProfit = normalEndingBalance - (manualStartingBalance || 0);
  const normalReturnPercent = manualStartingBalance > 0 ? ((normalEndingBalance - manualStartingBalance) / manualStartingBalance) * 100 : 0;
  const normalChartReady = normalLine.length >= 2 && normalEndingBalance > 0;
  const normalFlowSummary = parsedDurationValue > 0 && safeTradeFrequencyValue > 0
    ? `${safeTradeFrequencyValue} ${tradeFrequency} • ${parsedDurationValue} ${durationUnit}`
    : "Manual compound calculator";

  const supportingStats = projectionMode
    ? [
        { label: "Goal", value: projectionGoalHasValue ? projectionGoalSummaryValue : fallbackValue, tone: "positive" },
        { label: "Start", value: startingBalance > 0 ? formatCurrency(startingBalance) : fallbackValue },
        { label: "Periods", value: projectionPeriodsEstimate ? String(projectionPeriodsEstimate) : fallbackValue },
      ]
    : [
        { label: "Profit", value: formatCompactCurrency(normalProfit), tone: normalProfit >= 0 ? "positive" : "negative" },
        { label: "Return", value: formatCompactPercent(normalReturnPercent, 1), tone: normalReturnPercent >= 0 ? "positive" : "negative" },
        { label: "Duration", value: parsedDurationValue > 0 ? `${parsedDurationValue} ${durationUnit}` : fallbackValue },
      ];

  return (
    <div className="space-y-4 pb-4 sm:space-y-5">
      <DebugRenderMarker enabled={debugEnabled} markerText="COMPOUND SCREEN" />
      <ScreenHeader right={<TopIconPill icon={Sparkles} />} />
      <div className="px-1">
        <SegmentedControl items={modeItems} value={projectionMode ? "On" : "Off"} onChange={(value) => setProjectionMode(value === "On")} />
      </div>

      {projectionMode ? (
        <>
          <div className="space-y-3 sm:space-y-4">
            <BalanceHeroCard
              label="Goal"
              fixedFontSize={52}
              value={projectionGoalDisplayInput}
              onChange={(raw) => {
                const cleaned = String(raw ?? "").replace(/[$%]/g, "");
                if (projectionGoalDisplayType === "%") {
                  setProjectionGoalDisplayInput(sanitizePercentInput(cleaned));
                  return;
                }
                if (!cleaned.trim()) {
                  setProjectionGoalDisplayInput("");
                  return;
                }
                setProjectionGoalDisplayInput(formatNumberString(cleaned));
              }}
              toggleLabel="$"
              toggleRightLabel="%"
              toggleState={projectionGoalDisplayType === "%"}
              onToggle={() => setProjectionGoalDisplayType((prev) => (prev === "$" ? "%" : "$"))}
              prefix={projectionGoalDisplayType === "$" && projectionGoalDisplayInput !== "" ? "$" : ""}
              suffix={projectionGoalDisplayType === "%" && projectionGoalDisplayInput !== "" ? "%" : ""}
            />

            {projectionDollarGoalWarningActive ? (
              <GlassCard className="rounded-[24px] border-amber-200/55 bg-[linear-gradient(180deg,rgba(255,248,236,0.72),rgba(255,255,255,0.28))] px-4 py-3 sm:px-5" padded={false}>
                <div className="px-4 py-3">
                  <TinyLabel className="text-amber-700/80">Goal Guidance</TinyLabel>
                  <div className="mt-1 text-[15px] font-semibold tracking-[-0.02em] text-slate-700">Set a balance target above your starting balance.</div>
                  <div className="mt-1 text-[12px] font-medium tracking-[-0.01em] text-slate-500/90">Minimum target: {formatCurrency(minimumDollarGoal)}</div>
                </div>
              </GlassCard>
            ) : null}

            <div className="px-1">
              <div className="flex w-full items-center justify-between gap-3 rounded-[20px] border border-white/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.30),rgba(255,255,255,0.16))] px-4 py-3 shadow-[0_8px_18px_rgba(145,160,190,0.08),inset_0_1px_0_rgba(255,255,255,0.78)] backdrop-blur-[14px]">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/90 shadow-[0_0_0_4px_rgba(74,222,128,0.12)]" />
                  <span className="text-[9px] font-medium uppercase tracking-[0.24em] text-slate-500/80">Start</span>
                </div>
                <div className="min-w-0 flex-1 text-center text-[15px] font-semibold tracking-[-0.03em] text-slate-700">
                  {startingBalance > 0 ? formatCurrency(startingBalance) : fallbackValue}
                </div>
                <div className="shrink-0 text-[9px] font-medium uppercase tracking-[0.18em] text-slate-400/80">Account</div>
              </div>
            </div>

            <GlassCard className="rounded-[30px] p-4 sm:p-5">
              <CompoundFieldGroup label="Trade Frequency" className="space-y-2.5">
                <div className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4">
                  <CompoundInputShell className="px-3 sm:px-3.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={tradeFrequencyValue}
                      onChange={(e) => setTradeFrequencyValue(sanitizeEditableIntegerInput(e.target.value, 3))}
                      className="h-full min-h-[52px] w-full bg-transparent px-1 text-center text-[20px] font-semibold leading-none tracking-[-0.04em] text-slate-700 outline-none placeholder:text-slate-400/70"
                    />
                  </CompoundInputShell>
                  <div className="min-w-0 self-start">
                    <SegmentedControl items={frequencyItems} value={tradeFrequency} onChange={setTradeFrequency} />
                  </div>
                </div>
              </CompoundFieldGroup>
            </GlassCard>
          </div>

          <GlassCard className="overflow-visible rounded-[32px] px-5 pb-4.5 pt-5.5 sm:px-6 sm:pb-5 sm:pt-6" highlight>
            <TinyLabel className="text-center">Expected Time to Hit Goal</TinyLabel>
            <div className="mt-3 min-w-0 overflow-visible text-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  className="min-w-0 overflow-visible"
                  key={projectionEstimatePrimary}
                  initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.985 }}
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 1.015 }}
                  transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 235, damping: 24, mass: 0.74 }}
                >
                  <div className="mx-auto flex w-full min-w-0 max-w-none items-center justify-center px-1 sm:px-2">
                    <span className="block w-full min-w-0 overflow-visible whitespace-nowrap bg-[linear-gradient(180deg,#5A81D9_0%,#6F91E6_44%,#B69357_100%)] bg-clip-text text-center text-[42px] font-semibold leading-[1.02] tracking-[-0.05em] text-transparent sm:text-[54px]">
                      {projectionEstimatePrimary}
                    </span>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className="mt-4 rounded-[24px] border border-white/42 bg-[linear-gradient(180deg,rgba(255,255,255,0.16),rgba(255,255,255,0.08))] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] sm:px-5 sm:py-5">
              <div className="text-center text-[11px] font-medium tracking-[-0.01em] text-slate-500/82">{projectionEstimatedGoalDateLabel}</div>
              <div className="mt-5 flex justify-center">
                <div className="grid w-full max-w-[320px] grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4">
                  <GlassCard className="rounded-[22px] border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.10))] px-4 py-5 shadow-[0_6px_18px_rgba(145,160,190,0.06),inset_0_1px_0_rgba(255,255,255,0.68)]" padded={false}>
                    <div className="flex min-h-[70px] flex-col items-center justify-center px-1 text-center">
                      <TinyLabel className="text-center text-slate-500/78">Goal</TinyLabel>
                      <div className="mt-3 text-[16px] font-semibold tracking-[-0.04em] text-emerald-500/90">{projectionGoalHasValue ? projectionGoalSummaryValue : fallbackValue}</div>
                    </div>
                  </GlassCard>
                  <GlassCard className="rounded-[22px] border-white/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.22),rgba(255,255,255,0.10))] px-4 py-5 shadow-[0_6px_18px_rgba(145,160,190,0.06),inset_0_1px_0_rgba(255,255,255,0.68)]" padded={false}>
                    <div className="flex min-h-[70px] flex-col items-center justify-center px-1 text-center">
                      <TinyLabel className="text-center text-slate-500/78">Start</TinyLabel>
                      <div className="mt-3 text-[16px] font-semibold tracking-[-0.04em] text-slate-600">{startingBalance > 0 ? formatCurrency(startingBalance) : fallbackValue}</div>
                    </div>
                  </GlassCard>
                </div>
              </div>
            </div>
          </GlassCard>

          {projectionChartReady ? (
            <ProjectionChart
              points={projectionChartPoints}
              bandUpper={projectionBandUpper}
              bandLower={projectionBandLower}
              projectionMode
              milestones={projectionMilestones}
              inspectorEnabled={projectionChartReady}
              inspectorGoalValue={projectionTargetBalance}
              inspectorTradeUnitLabel={projectionTradeUnitLabel}
              inspectorPositionSizes={projectionPositionSizeSeries}
            />
          ) : (
            <GlassCard className="rounded-[28px] p-4 sm:rounded-[30px]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <TinyLabel>Projection</TinyLabel>
                  <div className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-slate-700">Projected balance path</div>
                </div>
              </div>
              <div className="mt-4 flex h-[186px] items-center justify-center overflow-hidden rounded-[24px] border border-blue-100/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.28),rgba(255,255,255,0.12))] p-3 text-center text-[13px] font-medium text-slate-500">
                Enter valid goal to preview projection
              </div>
            </GlassCard>
          )}

          <GlassCard className="rounded-[28px] p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <TinyLabel>Drawdown Analysis</TinyLabel>
                <div className="mt-1 text-[16px] font-semibold tracking-[-0.03em] text-slate-700">Baseline downside profile</div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <MetricRowCard label="Expected Max DD" value={projectionDrawdownMetrics.expected} tone="negative" />
              <MetricRowCard label="Worst Case DD" value={projectionDrawdownMetrics.worst} tone="negative" />
              <MetricRowCard label="Avg Losing Streak" value={projectionDrawdownMetrics.streak} />
            </div>
          </GlassCard>
        </>
      ) : (
        <>
          <BalanceHeroCard label="Starting Balance" fixedFontSize={52} value={manualStartingBalanceInput} onChange={(raw) => setManualStartingBalanceInput(formatNumberString(raw))} prefix="$" suffix="" />

          <GlassCard className="rounded-[30px] p-4 sm:p-5">
            <CompoundFieldGroup label="Trade Frequency">
              <div className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4">
                <CompoundInputShell className="px-3 sm:px-3.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={tradeFrequencyValue}
                    onChange={(e) => setTradeFrequencyValue(sanitizeEditableIntegerInput(e.target.value, 3))}
                    className="h-full min-h-[52px] w-full bg-transparent px-1 text-center text-[20px] font-semibold leading-none tracking-[-0.04em] text-slate-700 outline-none placeholder:text-slate-400/70"
                  />
                </CompoundInputShell>
                <div className="min-w-0 self-start">
                  <SegmentedControl items={frequencyItems} value={tradeFrequency} onChange={setTradeFrequency} />
                </div>
              </div>
            </CompoundFieldGroup>
          </GlassCard>

          <GlassCard className="rounded-[30px] p-4 sm:p-5">
            <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 sm:gap-4">
              <CompoundFieldGroup label="Gain %">
                <CompoundInputShell>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={gainInput}
                    onChange={(e) => setGainInput(sanitizePercentInput(e.target.value))}
                    className="h-full min-h-[52px] w-full bg-transparent px-1 text-center text-[20px] font-semibold leading-none tracking-[-0.04em] text-slate-700 outline-none placeholder:text-slate-400/70"
                  />
                </CompoundInputShell>
              </CompoundFieldGroup>
              <CompoundFieldGroup
                label={
                  <div className="flex items-center gap-2.5">
                    <span>Win %</span>
                    <span className="text-[10px] font-medium tracking-[0.02em] text-slate-400/90 normal-case">Optional</span>
                  </div>
                }
              >
                <CompoundInputShell>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={winRateInput}
                    onChange={(e) => setWinRateInput(sanitizePercentInput(e.target.value))}
                    className="h-full min-h-[52px] w-full bg-transparent px-1 text-center text-[20px] font-semibold leading-none tracking-[-0.04em] text-slate-700 outline-none placeholder:text-slate-400/70"
                  />
                </CompoundInputShell>
              </CompoundFieldGroup>
            </div>
          </GlassCard>

          <GlassCard className="rounded-[30px] p-4 sm:p-5">
            <CompoundFieldGroup label="Duration" className="space-y-2.5" rightLabel={parsedDurationValue > 0 ? `${parsedDurationValue} ${durationUnit}` : fallbackValue}>
              <div className="grid grid-cols-1 items-start gap-3.5 sm:grid-cols-[88px_minmax(0,1fr)] sm:gap-4">
                <CompoundInputShell className="px-3 sm:px-3.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={durationInput}
                    onChange={(e) => setDurationInput(sanitizeEditableIntegerInput(e.target.value, 3))}
                    className="h-full min-h-[52px] w-full bg-transparent px-1 text-center text-[20px] font-semibold leading-none tracking-[-0.04em] text-slate-700 outline-none placeholder:text-slate-400/70"
                  />
                </CompoundInputShell>
                <div className="min-w-0 self-start">
                  <SegmentedControl items={durationItems} value={durationUnit} onChange={setDurationUnit} />
                </div>
              </div>
            </CompoundFieldGroup>
          </GlassCard>

          <GlassCard className="rounded-[30px] px-5 pb-5 pt-6 sm:px-6 sm:pt-7" highlight>
            <TinyLabel className="text-center">Ending Balance</TinyLabel>
            <div className="mt-4 min-w-0 text-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key="normal-result"
                  className="min-w-0 overflow-visible"
                  initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.985 }}
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 1.015 }}
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="mx-auto flex w-full min-w-0 max-w-none items-center justify-center px-1 sm:px-2">
                    <span className="block w-full min-w-0 overflow-visible whitespace-nowrap bg-[linear-gradient(180deg,#5A81D9_0%,#6F91E6_44%,#B69357_100%)] bg-clip-text text-center text-[42px] font-semibold leading-[1.02] tracking-[-0.05em] text-transparent sm:text-[52px]">
                      {Number.isFinite(normalEndingBalance) && normalEndingBalance > 0 ? formatCompactCurrency(normalEndingBalance) : fallbackValue}
                    </span>
                  </div>
                </motion.div>
              </AnimatePresence>
              <div className="mt-1.5 text-[16px] font-medium tracking-[-0.02em] text-slate-500">
                {normalCompoundingIntervals > 0 ? `${normalCompoundingIntervals} compounding intervals` : "Enter valid inputs"}
              </div>
              <div className="mt-2 text-[12px] font-medium tracking-[-0.01em] text-slate-500/85">{normalFlowSummary}</div>
            </div>
          </GlassCard>

          {normalChartReady ? (
            <ProjectionChart points={normalLine} bandUpper={null} bandLower={null} projectionMode={false} milestones={[]} inspectorEnabled={false} inspectorGoalValue={null} />
          ) : (
            <GlassCard className="rounded-[28px] p-4 sm:rounded-[30px]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <TinyLabel>Growth Chart</TinyLabel>
                  <div className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-slate-700">Compounded growth path</div>
                </div>
              </div>
              <div className="mt-4 flex h-[186px] items-center justify-center overflow-hidden rounded-[24px] border border-blue-100/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.28),rgba(255,255,255,0.12))] p-3 text-center text-[13px] font-medium text-slate-500">
                Enter starting balance, gain, frequency, and duration
              </div>
            </GlassCard>
          )}
        </>
      )}

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {supportingStats.map((item) => (
          <MetricRowCard key={item.label} label={item.label} value={item.value} tone={item.tone || "default"} />
        ))}
      </div>
    </div>
  );
}

function DashboardScreen({
  dashboardSnapshot,
  range,
  onRangeChange,
  trades = [],
  tradeTypeFilter = DASHBOARD_TRADE_TYPE_FILTER_ALL,
  onTradeTypeFilterChange,
  onImportCsvTrades,
  shareIdentity,
  debugEnabled = false,
}) {
  const fallbackSnapshot = createFallbackDashboardSnapshot(formatCurrency(0));
  const activeSnapshot = ensureDashboardSnapshot(dashboardSnapshot?.byRange?.[range] || dashboardSnapshot?.byRange?.Month, fallbackSnapshot);
  const performanceSeries = activeSnapshot.performanceSeries;
  const sessionMix = activeSnapshot.sessionMix;
  const [selectedCalendarDateKey, setSelectedCalendarDateKey] = useState(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const csvInputRef = useRef(null);
  const [csvImportState, setCsvImportState] = useState({
    step: "upload",
    files: [],
    summary: null,
    isImporting: false,
    error: "",
  });

  const normalizedTrades = useMemo(
    () =>
      trades.map((trade) => ({
        ...trade,
        tradeType: trade.tradeType === DASHBOARD_TRADE_TYPE_FILTER_PAPER ? DASHBOARD_TRADE_TYPE_FILTER_PAPER : DASHBOARD_TRADE_TYPE_FILTER_LIVE,
        ruleViolation: Boolean(trade.ruleViolation),
        ruleViolationReason:
          typeof trade.ruleViolationReason === "string" && trade.ruleViolationReason.trim() ? trade.ruleViolationReason.trim() : null,
        rMultiple: Number.isFinite(Number(trade.rMultiple)) ? Number(trade.rMultiple) : null,
      })),
    [trades]
  );
  const filteredTrades = useMemo(
    () => normalizedTrades.filter((trade) => (tradeTypeFilter === DASHBOARD_TRADE_TYPE_FILTER_ALL ? true : trade.tradeType === tradeTypeFilter)),
    [normalizedTrades, tradeTypeFilter]
  );
  const filteredTradeStats = useMemo(() => {
    const totalTrades = filteredTrades.length;
    const wins = filteredTrades.filter((trade) => trade.pnl > 0).length;
    const netPnl = filteredTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    return {
      totalTrades,
      wins,
      netPnl,
      winRate,
    };
  }, [filteredTrades]);
  const filteredDays = useMemo(
    () =>
      Array.from(
        filteredTrades.reduce((acc, trade) => {
          const dateKey = new Date(trade.timestamp).toISOString().slice(0, 10);
          const previous = acc.get(dateKey) || 0;
          acc.set(dateKey, previous + trade.pnl);
          return acc;
        }, new Map()).entries()
      ),
    [filteredTrades]
  );
  const derivedSummaryMetrics = useMemo(() => {
    const rValues = filteredTrades.map((trade) => Number(trade.rMultiple)).filter((value) => Number.isFinite(value));
    const averageR = rValues.length ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : 0;
    const bestDay = filteredDays.reduce((best, day) => (day[1] > best[1] ? day : best), ["", Number.NEGATIVE_INFINITY]);
    const worstDay = filteredDays.reduce((worst, day) => (day[1] < worst[1] ? day : worst), ["", Number.POSITIVE_INFINITY]);
    return {
      averageR,
      bestDay,
      worstDay,
    };
  }, [filteredDays, filteredTrades]);
  const groupedTradesByDay = useMemo(() => {
    return filteredTrades
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .reduce((acc, trade) => {
        const dateKey = new Date(trade.timestamp).toISOString().slice(0, 10);
        const dateBucket = acc.get(dateKey) || [];
        acc.set(dateKey, [...dateBucket, trade]);
        return acc;
      }, new Map());
  }, [filteredTrades]);
  const calendarDailyTotals = useMemo(
    () =>
      filteredTrades.reduce((acc, trade) => {
        const dateKey = new Date(trade.timestamp).toISOString().slice(0, 10);
        const previous = acc.get(dateKey) || { netPnl: 0, hasRuleViolation: false };
        acc.set(dateKey, {
          netPnl: previous.netPnl + trade.pnl,
          hasRuleViolation: previous.hasRuleViolation || Boolean(trade.ruleViolation),
        });
        return acc;
      }, new Map()),
    [filteredTrades]
  );
  const recent7DaySummary = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const tradesInRange = filteredTrades.filter((trade) => Number(trade.timestamp) >= sevenDaysAgo);
    const netPnl = tradesInRange.reduce((sum, trade) => sum + trade.pnl, 0);
    return {
      tradeCount: tradesInRange.length,
      netPnl,
    };
  }, [filteredTrades]);
  const topTrade = useMemo(
    () => filteredTrades.reduce((best, trade) => (!best || trade.pnl > best.pnl ? trade : best), null),
    [filteredTrades]
  );
  const worstTrade = useMemo(
    () => filteredTrades.reduce((worst, trade) => (!worst || trade.pnl < worst.pnl ? trade : worst), null),
    [filteredTrades]
  );
  const last14DateKeys = useMemo(() => {
    const keys = [];
    for (let index = 13; index >= 0; index -= 1) {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - index);
      keys.push(date.toISOString().slice(0, 10));
    }
    return keys;
  }, []);
  const dayDetailGroups = useMemo(() => {
    if (!selectedCalendarDateKey) return [];
    const dayTrades = groupedTradesByDay.get(selectedCalendarDateKey);
    if (!dayTrades?.length) return [];
    const totalPnl = dayTrades.reduce((sum, trade) => sum + trade.pnl, 0);
    const totalR = dayTrades.reduce((sum, trade) => sum + (Number.isFinite(Number(trade.rMultiple)) ? Number(trade.rMultiple) : 0), 0);
    const violatingTrades = dayTrades.filter((trade) => trade.ruleViolation);
    return [{
      accountKey: "all-trades",
      accountName: "All Trades",
      totalPnl,
      totalR,
      tradeCount: dayTrades.length,
      hasRuleViolation: violatingTrades.length > 0,
      violationReasonSummary: Array.from(new Set(violatingTrades.map((trade) => trade.ruleViolationReason).filter(Boolean))).join("; ") || null,
    }];
  }, [groupedTradesByDay, selectedCalendarDateKey]);
  const tradeTypeFilterLabel =
    tradeTypeFilter === DASHBOARD_TRADE_TYPE_FILTER_LIVE
      ? "Live"
      : tradeTypeFilter === DASHBOARD_TRADE_TYPE_FILTER_PAPER
        ? "Paper"
        : "All Types";
  const handleExportPdf = useCallback(async () => {
    if (isGeneratingPdf) return;
    setPdfError("");
    setIsGeneratingPdf(true);
    try {
      const fallbackDay = ["", 0];
      const bestDay = Number.isFinite(derivedSummaryMetrics.bestDay[1]) ? derivedSummaryMetrics.bestDay : fallbackDay;
      const worstDay = Number.isFinite(derivedSummaryMetrics.worstDay[1]) ? derivedSummaryMetrics.worstDay : fallbackDay;
      const calendarSnapshot = last14DateKeys
        .map((dateKey) => ({
          dateKey,
          dateLabel: new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          netPnl: calendarDailyTotals.get(dateKey)?.netPnl || 0,
          netPnlLabel: formatCompactCurrency(calendarDailyTotals.get(dateKey)?.netPnl || 0),
          hasRuleViolation: Boolean(calendarDailyTotals.get(dateKey)?.hasRuleViolation),
        }))
        .filter((item) => item.netPnl !== 0 || item.hasRuleViolation);
      const ruleFlags = filteredTrades
        .filter((trade) => trade.ruleViolation)
        .slice(0, 12)
        .map((trade) => `${formatLocalDateMmDdYy(trade.timestamp)} ${trade.instrument}: ${trade.ruleViolationReason || "Rule violation detected"}`);

      const pdfBlob = createInsightsPdfReport({
        generatedAt: Date.now(),
        range,
        tradeTypeFilterLabel,
        identity: shareIdentity?.isAnonymous
          ? { isAnonymous: true, showUsername: true, username: "@helixtrader", displayName: "Helix" }
          : shareIdentity,
        metrics: {
          totalTrades: String(filteredTradeStats.totalTrades),
          netPnl: formatCompactCurrency(filteredTradeStats.netPnl),
          winRate: formatPercent(filteredTradeStats.winRate),
          avgR: `${derivedSummaryMetrics.averageR.toFixed(2)}R`,
          bestDay: bestDay[0] ? `${new Date(`${bestDay[0]}T00:00:00`).toLocaleDateString("en-US")} (${formatCompactCurrency(bestDay[1])})` : "—",
          worstDay: worstDay[0] ? `${new Date(`${worstDay[0]}T00:00:00`).toLocaleDateString("en-US")} (${formatCompactCurrency(worstDay[1])})` : "—",
        },
        performance: {
          recentSummary: `${recent7DaySummary.tradeCount} trades · ${formatCompactCurrency(recent7DaySummary.netPnl)}`,
          topTrade: topTrade
            ? `${topTrade.instrument} · ${formatCompactCurrency(topTrade.pnl)} · ${formatLocalDateMmDdYy(topTrade.timestamp)}`
            : "—",
          worstTrade: worstTrade
            ? `${worstTrade.instrument} · ${formatCompactCurrency(worstTrade.pnl)} · ${formatLocalDateMmDdYy(worstTrade.timestamp)}`
            : "—",
          modeOutcome: toSafeString(activeSnapshot.modeOutcome, "—"),
          frequencySummary: toSafeString(activeSnapshot.frequencySummary, "—"),
          contractSummary: toSafeString(activeSnapshot.contractSummary, "—"),
        },
        calendarSnapshot,
        flags: ruleFlags,
      });
      if (!pdfBlob) throw new Error("PDF creation failed");
      const today = new Date().toISOString().slice(0, 10);
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const downloadLink = document.createElement("a");
      downloadLink.href = pdfUrl;
      downloadLink.download = `helix-insights-report-${today}.pdf`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(pdfUrl);
    } catch (error) {
      setPdfError("Could not generate PDF report right now.");
    } finally {
      setIsGeneratingPdf(false);
    }
  }, [
    activeSnapshot.contractSummary,
    activeSnapshot.frequencySummary,
    activeSnapshot.modeOutcome,
    calendarDailyTotals,
    derivedSummaryMetrics.averageR,
    derivedSummaryMetrics.bestDay,
    derivedSummaryMetrics.worstDay,
    filteredTradeStats.netPnl,
    filteredTradeStats.totalTrades,
    filteredTradeStats.winRate,
    filteredTrades,
    isGeneratingPdf,
    last14DateKeys,
    range,
    recent7DaySummary.netPnl,
    recent7DaySummary.tradeCount,
    shareIdentity,
    topTrade,
    tradeTypeFilterLabel,
    worstTrade,
  ]);

  const buildBatchPreview = useCallback(
    (fileEntries) => {
      const runningKeys = new Set(sanitizeTrades(trades).map((trade) => buildStableTradeFingerprint(trade)));
      const nextFiles = fileEntries.map((entry) => {
        const previewTrades = normalizeCsvRowsToTrades(entry.rows, { presetId: entry.selectedPresetId });
        let duplicateEstimate = 0;
        previewTrades.forEach((trade) => {
          const key = buildStableTradeFingerprint(trade);
          if (runningKeys.has(key)) {
            duplicateEstimate += 1;
            return;
          }
          runningKeys.add(key);
        });
        return {
          ...entry,
          previewTrades,
          summary: {
            rowCount: entry.rows.length,
            parsedCount: previewTrades.length,
            totalPnl: previewTrades.reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0),
            duplicateEstimate,
          },
        };
      });
      const combinedSummary = nextFiles.reduce(
        (acc, entry) => {
          acc.filesCount += 1;
          acc.rowsFound += entry.summary?.rowCount || 0;
          acc.validRows += entry.summary?.parsedCount || 0;
          acc.totalPnl += entry.summary?.totalPnl || 0;
          acc.duplicateEstimate += entry.summary?.duplicateEstimate || 0;
          return acc;
        },
        { filesCount: 0, rowsFound: 0, validRows: 0, totalPnl: 0, duplicateEstimate: 0 }
      );
      return { nextFiles, combinedSummary };
    },
    [trades]
  );

  const openCsvImportPicker = useCallback(() => {
    csvInputRef.current?.click();
  }, []);

  const handleCsvFileSelection = useCallback(async (event) => {
    const selectedFiles = Array.from(event?.target?.files || []);
    if (!selectedFiles.length) return;
    try {
      const parsedFiles = [];
      for (const file of selectedFiles) {
        const text = await file.text();
        const parsed = parseCsvText(text);
        if (!parsed.headers.length || !parsed.rows.length) continue;
        const detection = detectCsvFormat(parsed.headers);
        const fallbackPresetId = "generic-futures-csv-v1";
        parsedFiles.push({
          id: `${file.name}-${file.lastModified}-${file.size}`,
          fileName: file.name,
          rows: parsed.rows,
          detection,
          presetOptions: detection.candidates || [],
          selectedPresetId: detection.confidence === "low" ? fallbackPresetId : detection.recommendedPresetId || fallbackPresetId,
          needsChoice: detection.confidence === "medium",
        });
      }
      if (!parsedFiles.length) {
        setCsvImportState((prev) => ({ ...prev, step: "upload", files: [], summary: null, error: "CSV file appears empty." }));
        return;
      }
      const { nextFiles, combinedSummary } = buildBatchPreview(parsedFiles);
      setCsvImportState({
        step: nextFiles.some((entry) => entry.needsChoice) ? "detect" : "preview",
        files: nextFiles,
        summary: combinedSummary,
        isImporting: false,
        error: "",
      });
    } catch (error) {
      setCsvImportState((prev) => ({ ...prev, error: error?.message || "Unable to read CSV file." }));
    } finally {
      if (event?.target) event.target.value = "";
    }
  }, [buildBatchPreview]);

  const chooseDetectedPresetForFile = useCallback(
    (fileId, presetId) => {
      setCsvImportState((prev) => {
        const next = prev.files.map((entry) =>
          entry.id === fileId ? { ...entry, selectedPresetId: presetId || "generic-futures-csv-v1", needsChoice: false } : entry
        );
        const { nextFiles, combinedSummary } = buildBatchPreview(next);
        return {
          ...prev,
          files: nextFiles,
          summary: combinedSummary,
          step: nextFiles.some((entry) => entry.needsChoice) ? "detect" : "preview",
        };
      });
    },
    [buildBatchPreview]
  );

  const commitCsvImport = useCallback(async () => {
    if (typeof onImportCsvTrades !== "function" || !csvImportState.files.length) return;
    const previewTrades = csvImportState.files.flatMap((entry) => entry.previewTrades || []);
    if (!previewTrades.length) return;
    setCsvImportState((prev) => ({ ...prev, isImporting: true, error: "" }));
    try {
      const result = await onImportCsvTrades({ trades: previewTrades });
      setCsvImportState((prev) => ({
        ...prev,
        step: "summary",
        isImporting: false,
        summary: {
          ...(prev.summary || {}),
          importedTrades: Number(result?.importedCount || 0),
          duplicatesSkipped: Number(result?.dedupedCount || 0),
          invalidRows: Math.max(0, Number((prev.summary?.rowsFound || 0) - (prev.summary?.validRows || 0))),
        },
      }));
    } catch (error) {
      setCsvImportState((prev) => ({ ...prev, isImporting: false, error: error?.message || "Import failed." }));
    }
  }, [csvImportState.files, onImportCsvTrades]);

  const hasTrades = filteredTrades.length > 0;

  const width = 320;
  const lineHeight = 132;
  const lineMax = Math.max(...performanceSeries, 100);
  const lineMin = Math.min(...performanceSeries, 0);
  const linePath = performanceSeries
    .map((value, index) => {
      const x = performanceSeries.length <= 1 ? 0 : (index / (performanceSeries.length - 1)) * width;
      const y = lineHeight - ((value - lineMin) / Math.max(lineMax - lineMin, 1)) * lineHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const hasMeaningfulContent = performanceSeries.length > 0 && sessionMix.length > 0 && Boolean(activeSnapshot.accountBalance);
  return (
    <div className="space-y-4 pb-4">
      <DebugRenderMarker enabled={debugEnabled} markerText="DASHBOARD SCREEN" />
      {!hasMeaningfulContent ? <DebugEmptyFallback enabled={debugEnabled} label="Dashboard rendered empty" /> : null}
      <ScreenHeader
        right={(
          <div className="flex items-center gap-2">
            <TopIconPill icon={LineChart} />
            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isGeneratingPdf}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[14px] border border-white/70 bg-white/70 px-3 py-2 text-[11px] font-semibold tracking-[-0.01em] text-slate-700 shadow-[0_8px_20px_rgba(148,163,184,0.2)]",
                isGeneratingPdf ? "cursor-not-allowed opacity-70" : "hover:bg-white"
              )}
            >
              {isGeneratingPdf ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
              {isGeneratingPdf ? "Generating…" : "Export PDF"}
            </button>
            <button
              type="button"
              onClick={openCsvImportPicker}
              className="inline-flex items-center gap-1.5 rounded-[14px] border border-white/70 bg-white/70 px-3 py-2 text-[11px] font-semibold tracking-[-0.01em] text-slate-700 shadow-[0_8px_20px_rgba(148,163,184,0.2)] hover:bg-white"
            >
              Import CSV
            </button>
            <input ref={csvInputRef} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={handleCsvFileSelection} />
          </div>
        )}
      />
      {pdfError ? <div className="mt-[-14px] text-right text-[11px] text-rose-500">{pdfError}</div> : null}
      <SegmentedControl items={DASHBOARD_RANGES} value={range} onChange={onRangeChange} />
      <GlassCard className="rounded-[28px] p-4 sm:rounded-[30px]">
        <div className="mt-1 text-[16px] font-semibold tracking-[-0.02em] text-slate-700">Insights filters</div>
        <div className="mt-3">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Trade type</div>
            <SegmentedControl
              items={[
                { value: DASHBOARD_TRADE_TYPE_FILTER_ALL, label: "All Types" },
                { value: DASHBOARD_TRADE_TYPE_FILTER_LIVE, label: "Live" },
                { value: DASHBOARD_TRADE_TYPE_FILTER_PAPER, label: "Paper" },
              ]}
              value={tradeTypeFilter}
              onChange={onTradeTypeFilterChange}
            />
          </div>
        </div>
      </GlassCard>
      {!hasTrades ? (
        <GlassCard className="flex min-h-[220px] items-center justify-center rounded-[30px] p-8">
          <div className="text-center">
            <div className="text-[24px] font-semibold tracking-[-0.03em] text-slate-700">No trades yet</div>
            <div className="mt-2 text-[13px] text-slate-500">Import trades to generate insights</div>
            <button
              type="button"
              onClick={openCsvImportPicker}
              className="mt-6 inline-flex rounded-[14px] border border-white/75 bg-white/75 px-4 py-2 text-[12px] font-semibold text-slate-700 shadow-[0_10px_24px_rgba(148,163,184,0.2)] hover:bg-white"
            >
              Import CSV
            </button>
          </div>
        </GlassCard>
      ) : null}
      {csvImportState.files.length ? (
        <GlassCard className="rounded-[28px] p-4 sm:rounded-[30px]">
          <TinyLabel>CSV import</TinyLabel>
          <div className="mt-1 text-[14px] font-semibold tracking-[-0.02em] text-slate-700">
            {csvImportState.summary?.filesCount || csvImportState.files.length} file{(csvImportState.summary?.filesCount || csvImportState.files.length) === 1 ? "" : "s"} selected
          </div>
          {csvImportState.step === "detect" ? (
            <div className="mt-3 space-y-2">
              {csvImportState.files.filter((entry) => entry.needsChoice).map((entry) => (
                <div key={entry.id} className="rounded-[12px] border border-white/70 bg-white/50 p-2.5 text-[11px] text-slate-600">
                  <div className="font-semibold text-slate-700">{entry.fileName}</div>
                  <div className="mt-1 text-[10px] text-slate-500">Choose detected format</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(entry.presetOptions.length ? entry.presetOptions : [{ presetId: "generic-futures-csv-v1", label: "Generic Futures CSV" }]).map((option) => (
                      <button
                        key={option.presetId}
                        type="button"
                        onClick={() => chooseDetectedPresetForFile(entry.id, option.presetId)}
                        className="rounded-[10px] border border-white/70 bg-white/70 px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-white"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-2 text-[11px] text-slate-500">
            Rows found {csvImportState.summary?.rowsFound || 0} · Valid rows {csvImportState.summary?.validRows || 0} · Duplicates estimate {csvImportState.summary?.duplicateEstimate || 0}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">Net P/L preview {formatCompactCurrency(csvImportState.summary?.totalPnl || 0)}</div>
          <button
            type="button"
            onClick={commitCsvImport}
            disabled={csvImportState.isImporting || csvImportState.step === "detect"}
            className="mt-3 rounded-[10px] border border-blue-200/80 bg-blue-50/80 px-2.5 py-1 text-[11px] font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {csvImportState.isImporting ? "Importing…" : "Confirm import"}
          </button>
          {csvImportState.step === "summary" ? (
            <div className="mt-2 text-[11px] text-slate-500">
              Files imported {csvImportState.summary?.filesCount || 0} · Rows found {csvImportState.summary?.rowsFound || 0} · Valid rows {csvImportState.summary?.validRows || 0} · Imported trades {csvImportState.summary?.importedTrades || 0} · Duplicates skipped {csvImportState.summary?.duplicatesSkipped || 0} · Invalid/skipped rows {csvImportState.summary?.invalidRows || 0}
            </div>
          ) : null}
          {csvImportState.error ? <div className="mt-2 text-[11px] text-rose-500">{csvImportState.error}</div> : null}
        </GlassCard>
      ) : null}
      {hasTrades ? (
        <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MetricRowCard label="Account Balance" value={activeSnapshot.accountBalance} />
        <MetricRowCard label="Win Rate" value={activeSnapshot.winRate} tone={activeSnapshot.winRateTone} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricRowCard label="Trades" value={String(filteredTradeStats.totalTrades)} />
        <MetricRowCard label="Win Rate (Filtered)" value={formatPercent(filteredTradeStats.winRate)} />
        <MetricRowCard label="Net P/L (Filtered)" value={formatCompactCurrency(filteredTradeStats.netPnl)} tone={filteredTradeStats.netPnl >= 0 ? "positive" : "negative"} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MetricRowCard label="Instrument" value={activeSnapshot.instrument} />
        <MetricRowCard label="Contracts" value={activeSnapshot.contracts} />
      </div>
      <GlassCard className="rounded-[28px] p-4 sm:rounded-[30px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <TinyLabel>Performance Path</TinyLabel>
            <div className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-slate-700">{activeSnapshot.performanceTitle}</div>
          </div>
          <div className="text-right">
            <TinyLabel>Range</TinyLabel>
            <div className="mt-1 text-[13px] font-semibold tracking-[-0.02em] text-slate-600">{range}</div>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-[24px] border border-blue-100/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.28),rgba(255,255,255,0.12))] p-3">
          <svg width="100%" viewBox={`0 0 ${width} ${lineHeight}`}>
            {[0.2, 0.4, 0.6, 0.8].map((ratio) => (
              <line key={ratio} x1="0" x2={width} y1={lineHeight * ratio} y2={lineHeight * ratio} stroke="rgba(148,163,184,0.22)" strokeWidth="1" />
            ))}
            <path d={linePath} fill="none" stroke="rgba(59,130,246,0.96)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </GlassCard>
      <GlassCard className="rounded-[28px] p-4 sm:rounded-[30px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <TinyLabel>Session Mix</TinyLabel>
            <div className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-slate-700">Position sizing cadence</div>
          </div>
          <div className="text-right">
            <TinyLabel>Mode</TinyLabel>
            <div className="mt-1 text-[13px] font-semibold tracking-[-0.02em] text-slate-600">{toSafeString(activeSnapshot.modeLabel, fallbackSnapshot.modeLabel)}</div>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-[24px] border border-blue-100/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.24),rgba(255,255,255,0.10))] p-3">
          <div className="flex h-[120px] items-end justify-between gap-2">
            {sessionMix.map((height, index) => (
              <div key={index} className="flex-1 rounded-t-[12px] bg-[linear-gradient(180deg,rgba(136,173,255,0.72),rgba(255,255,255,0.22))]" style={{ height: `${height}%` }} />
            ))}
          </div>
        </div>
      </GlassCard>
      <GlassCard className="rounded-[30px] p-5">
        <TinyLabel>Trade Feed</TinyLabel>
        <div className="mt-3 space-y-2.5">
          {groupedTradesByDay.size ? (
            Array.from(groupedTradesByDay.entries())
              .sort((a, b) => b[0].localeCompare(a[0]))
              .slice(0, 12)
              .map(([dateKey, dayTrades]) => (
                <div key={dateKey} className="space-y-2.5">
                  <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-slate-500">{new Date(`${dateKey}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" })}</div>
                  {dayTrades.map((trade) => (
                          <div key={trade.id} className="rounded-[18px] bg-white/28 px-4 py-3 text-[13px] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-semibold text-slate-700">{trade.instrument}</div>
                              <div className={cn("font-semibold", trade.pnl >= 0 ? "text-emerald-600" : "text-rose-500")}>
                                {trade.pnl >= 0 ? "+" : "-"}
                                {formatCompactCurrency(Math.abs(trade.pnl))}
                              </div>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                              <span>{formatLocalDateMmDdYy(trade.timestamp)} · {formatLocalTimeAmPm(trade.timestamp)}</span>
                              <span>{trade.tradeType === DASHBOARD_TRADE_TYPE_FILTER_PAPER ? "Paper" : "Live"}</span>
                            </div>
                            {trade.ruleViolation ? (
                              <div className="mt-1.5 rounded-[10px] border border-amber-200/80 bg-amber-100/60 px-2 py-1 text-[11px] font-semibold text-amber-700">
                                ⚠ {trade.ruleViolationReason || "Rule violation detected"}
                              </div>
                            ) : null}
                          </div>
                        ))}
                </div>
              ))
          ) : (
            <div className="rounded-[18px] bg-white/28 px-4 py-3 text-[13px] text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
              No trades for this filter yet.
            </div>
          )}
        </div>
      </GlassCard>
      <GlassCard className="rounded-[30px] p-5">
        <TinyLabel>Calendar</TinyLabel>
        <div className="mt-2 text-[16px] font-semibold tracking-[-0.02em] text-slate-700">Last 14 days</div>
        <div className="mt-3 grid grid-cols-7 gap-2">
          {last14DateKeys.map((dateKey) => {
            const dailySummary = calendarDailyTotals.get(dateKey);
            const levelClass = dailySummary?.hasRuleViolation
              ? "bg-amber-300/70"
              : (dailySummary?.netPnl || 0) > 0
                ? "bg-emerald-400/55"
                : (dailySummary?.netPnl || 0) < 0
                  ? "bg-rose-400/55"
                  : "bg-white/45";
            return (
              <button
                type="button"
                onClick={() => setSelectedCalendarDateKey(dateKey)}
                key={dateKey}
                className={cn(
                  "relative rounded-[10px] border border-white/65 px-1.5 py-2 text-center text-[10px] font-semibold text-slate-600",
                  levelClass,
                  selectedCalendarDateKey === dateKey ? "ring-1 ring-blue-300" : ""
                )}
              >
                {dailySummary?.hasRuleViolation ? <span className="absolute right-1 top-0.5 text-[11px] leading-none">⚠</span> : null}
                {Number(dateKey.slice(-2))}
              </button>
            );
          })}
        </div>
      </GlassCard>
      {selectedCalendarDateKey ? (
        <GlassCard className="rounded-[30px] p-5">
          <TinyLabel>Day Details</TinyLabel>
          <div className="mt-2 text-[16px] font-semibold tracking-[-0.02em] text-slate-700">
            {new Date(`${selectedCalendarDateKey}T00:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </div>
          <div className="mt-3 space-y-2.5">
            {dayDetailGroups.length ? (
              dayDetailGroups.map((group) => (
                <div key={group.accountKey} className="rounded-[18px] bg-white/28 px-4 py-3 text-[13px] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-slate-700">{group.accountName}</div>
                    {group.hasRuleViolation ? <div className="text-[12px] font-semibold text-amber-600">⚠ Violation</div> : null}
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-2 text-[12px] text-slate-500">
                    <div>Total P/L: {formatCompactCurrency(group.totalPnl)}</div>
                    <div>Total R: {group.totalR.toFixed(2)}R</div>
                    <div>Trades: {group.tradeCount}</div>
                  </div>
                  {group.violationReasonSummary ? <div className="mt-1 text-[12px] font-medium text-amber-700">Reason: {group.violationReasonSummary}</div> : null}
                </div>
              ))
            ) : (
              <div className="rounded-[18px] bg-white/28 px-4 py-3 text-[13px] text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                No trades for this day.
              </div>
            )}
          </div>
        </GlassCard>
      ) : null}
      <GlassCard className="rounded-[30px] p-5">
        <TinyLabel>Read-only Summary</TinyLabel>
        <div className="mt-4 space-y-3">
          {[activeSnapshot.modeOutcome, activeSnapshot.frequencySummary, activeSnapshot.contractSummary].map((note) => (
            <div key={note} className="rounded-[20px] bg-white/28 px-4 py-3 text-[13px] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
              {toSafeString(note, "—")}
            </div>
          ))}
        </div>
      </GlassCard>
        </>
      ) : null}
    </div>
  );
}

function ShareScreen({ positionState, compoundState, dashboardSnapshot, shareIdentity, debugEnabled = false }) {
  const positionSetupSnapshot = derivePositionSetupSnapshot(positionState);
  const {
    selectedInstrument,
    entry,
    stop,
    target,
    contracts,
    riskPoints,
    rewardPoints,
    rewardRiskRatio,
    projectedRisk,
    projectedReward,
    direction,
    setupIsComplete,
  } = positionSetupSnapshot;
  const winRate = Math.max(0, Math.min(100, Number(positionState.winRate) || 0));
  const replayResult = projectedReward - projectedRisk;
  const replayResultPoints = rewardPoints - riskPoints;

  const dashboardMonthSnapshot = ensureDashboardSnapshot(
    dashboardSnapshot?.byRange?.Month || dashboardSnapshot?.byRange?.Week,
    createFallbackDashboardSnapshot(formatCurrency(0))
  );
  const compoundModeLabel = compoundState.projectionMode ? "Forecast" : "Compound";
  const frequencySummary = buildCompoundFrequencySummary(compoundState);
  const [shareType, setShareType] = useState("SETUP");

  const handleShareTypeChange = useCallback((nextShareType) => {
    setShareType(nextShareType);
    triggerLightHaptic();
  }, []);
  const [displayMode, setDisplayMode] = useState("dollar");
  const [journalPeriod, setJournalPeriod] = useState("Month");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [setupCardTimeMs, setSetupCardTimeMs] = useState(() => Date.now());
  const shareCardExportRef = useRef(null);
  const GIF_PREVIEW_DURATION_SECONDS = 5.8;

  useEffect(() => {
    if (shareType !== "SETUP") return undefined;
    setSetupCardTimeMs(Date.now());
    const intervalId = window.setInterval(() => {
      setSetupCardTimeMs(Date.now());
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [shareType]);

  const handleShareExport = useCallback(async () => {
    if (!shareCardExportRef.current || isExporting) return;
    triggerMediumHaptic();
    setIsExporting(true);
    setExportError("");
    try {
      if (shareType === "SETUP") {
        setSetupCardTimeMs(Date.now());
        await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      const didExport = await exportElementAsPng(shareCardExportRef.current, "helix-share-card.png");
      if (!didExport) setExportError("Unable to export share card on this device/browser.");
    } catch {
      setExportError("Unable to export share card on this device/browser.");
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, shareType]);

  const contextLine = useMemo(() => {
    if (shareType === "SETUP") {
      return `Called at ${formatTimeInTimeZoneAmPm(setupCardTimeMs, "America/New_York")} ET (${formatDateInTimeZoneMmDdYy(setupCardTimeMs, "America/New_York")})`;
    }
    if (shareType === "REPLAY") {
      return "Replay timestamp · 9:41 AM EST";
    }
    if (shareType === "JOURNAL") {
      return `${journalPeriod} performance period`;
    }
    return "Current Position tab setup";
  }, [journalPeriod, setupCardTimeMs, shareType]);
  const setupEntryTimeLabel = useMemo(() => {
    if (shareType !== "SETUP") return "";
    return formatTimeInTimeZoneAmPm(setupCardTimeMs, "America/New_York");
  }, [setupCardTimeMs, shareType]);

  const heroMetric = useMemo(() => {
    if (shareType === "REPLAY") {
      if (displayMode === "points") return `${replayResultPoints >= 0 ? "+" : ""}${replayResultPoints.toFixed(1)} pts`;
      return `${replayResult >= 0 ? "+" : "-"}${formatCompactCurrency(Math.abs(replayResult))}`;
    }
    if (shareType === "JOURNAL") {
      if (displayMode === "points") return `${rewardRiskRatio.toFixed(1)}R`;
      return dashboardMonthSnapshot.modeOutcome;
    }
    if (displayMode === "points") return `${rewardRiskRatio.toFixed(1)}R`;
    return formatCompactCurrency(projectedReward);
  }, [dashboardMonthSnapshot.modeOutcome, displayMode, projectedReward, replayResult, replayResultPoints, rewardRiskRatio, shareType]);
  const heroMetricAnimation = useMemo(() => {
    if (shareType === "REPLAY") {
      if (displayMode === "points") {
        return { value: replayResultPoints, formatter: (numericValue) => `${numericValue >= 0 ? "+" : ""}${numericValue.toFixed(1)} pts` };
      }
      return { value: replayResult, formatter: (numericValue) => `${numericValue >= 0 ? "+" : "-"}${formatCompactCurrency(Math.abs(numericValue))}` };
    }
    if (shareType === "JOURNAL") {
      if (displayMode === "points") {
        return { value: rewardRiskRatio, formatter: (numericValue) => `${numericValue.toFixed(1)}R` };
      }
      return null;
    }
    if (displayMode === "points") {
      return { value: rewardRiskRatio, formatter: (numericValue) => `${numericValue.toFixed(1)}R` };
    }
    return { value: projectedReward, formatter: (numericValue) => formatCompactCurrency(numericValue) };
  }, [displayMode, projectedReward, replayResult, replayResultPoints, rewardRiskRatio, shareType]);

  const secondaryMetrics = useMemo(() => {
    if (shareType === "SETUP") {
      if (displayMode === "points") {
        return [
          { label: "Risk Points", value: riskPoints.toFixed(1), animatedNumber: riskPoints, formatter: (numericValue) => numericValue.toFixed(1) },
          { label: "Reward Points", value: rewardPoints.toFixed(1), animatedNumber: rewardPoints, formatter: (numericValue) => numericValue.toFixed(1) },
        ];
      }
      return [
        { label: "Risk", value: formatBottomMetricCurrency(projectedRisk), animatedNumber: projectedRisk, formatter: (numericValue) => formatBottomMetricCurrency(numericValue) },
        { label: "R", value: `${rewardRiskRatio.toFixed(1)}R`, animatedNumber: rewardRiskRatio, formatter: (numericValue) => `${numericValue.toFixed(1)}R` },
      ];
    }
    if (shareType === "REPLAY") {
      if (displayMode === "points") {
        return [
          { label: "Result Points", value: `${replayResultPoints >= 0 ? "+" : ""}${replayResultPoints.toFixed(1)}`, animatedNumber: replayResultPoints, formatter: (numericValue) => `${numericValue >= 0 ? "+" : ""}${numericValue.toFixed(1)}` },
          { label: "R Multiple", value: `${rewardRiskRatio.toFixed(1)}R`, animatedNumber: rewardRiskRatio, formatter: (numericValue) => `${numericValue.toFixed(1)}R` },
          { label: "Duration", value: formatSecondsLabel(GIF_PREVIEW_DURATION_SECONDS) },
        ];
      }
      return [
        { label: "Result", value: `${replayResult >= 0 ? "+" : "-"}${formatCompactCurrency(Math.abs(replayResult))}`, animatedNumber: replayResult, formatter: (numericValue) => `${numericValue >= 0 ? "+" : "-"}${formatCompactCurrency(Math.abs(numericValue))}` },
        { label: "R Multiple", value: `${rewardRiskRatio.toFixed(1)}R`, animatedNumber: rewardRiskRatio, formatter: (numericValue) => `${numericValue.toFixed(1)}R` },
        { label: "Duration", value: formatSecondsLabel(GIF_PREVIEW_DURATION_SECONDS) },
      ];
    }
    if (displayMode === "points") {
      return [
        { label: "Trades", value: "48" },
        { label: "Win Rate", value: formatPercent(winRate) },
        { label: "Average R", value: `${rewardRiskRatio.toFixed(1)}R`, animatedNumber: rewardRiskRatio, formatter: (numericValue) => `${numericValue.toFixed(1)}R` },
        { label: "Net Result", value: `${rewardRiskRatio.toFixed(1)}R`, animatedNumber: rewardRiskRatio, formatter: (numericValue) => `${numericValue.toFixed(1)}R` },
      ];
    }
    return [
      { label: "Trades", value: "48" },
      { label: "Win Rate", value: formatPercent(winRate) },
      { label: "Average R", value: `${rewardRiskRatio.toFixed(1)}R`, animatedNumber: rewardRiskRatio, formatter: (numericValue) => `${numericValue.toFixed(1)}R` },
      { label: "Net Result", value: dashboardMonthSnapshot.modeOutcome },
    ];
  }, [
    shareType,
    displayMode,
    riskPoints,
    rewardPoints,
    projectedRisk,
    projectedReward,
    contracts,
    replayResultPoints,
    rewardRiskRatio,
    replayResult,
    winRate,
    dashboardMonthSnapshot.modeOutcome,
    GIF_PREVIEW_DURATION_SECONDS,
  ]);

  const footerLabel = shareType === "JOURNAL" ? "Tracked with HELIX" : "Calculated with HELIX";
  const isSetupCard = shareType === "SETUP";
  const setupDirectionLabel = direction;
  const setupMissingMessage = isSetupCard && !setupIsComplete ? "Missing setup values on Position tab." : "";
  const setupCardInstrumentLabel = isSetupCard && !setupIsComplete ? "—" : selectedInstrument.key;
  const setupCardEntry = isSetupCard && !setupIsComplete ? 0 : entry;
  const setupCardStop = isSetupCard && !setupIsComplete ? 0 : stop;
  const setupCardTarget = isSetupCard && !setupIsComplete ? 0 : target;
  const shareDisabled = isExporting || (isSetupCard && !setupIsComplete);
  const setupProjectionChart = useMemo(() => {
    if (!isSetupCard || !setupIsComplete) return { isReady: false, points: [], bandUpper: null, bandLower: null };
    const pathModel = buildSetupPayoffPathModel({
      entry,
      stop,
      target,
      direction,
      contracts,
      riskPoints,
      rewardPoints,
      projectedRisk,
      projectedReward,
    });
    return {
      isReady: pathModel.points.length >= 2,
      points: pathModel.points,
      bandUpper: pathModel.bandUpper,
      bandLower: pathModel.bandLower,
    };
  }, [
    contracts,
    direction,
    entry,
    isSetupCard,
    projectedReward,
    projectedRisk,
    rewardPoints,
    riskPoints,
    setupIsComplete,
    stop,
    target,
  ]);

  return (
    <div className="space-y-4 pb-4">
      <DebugRenderMarker enabled={debugEnabled} markerText="SHARE SCREEN" />
      <ScreenHeader right={<TopIconPill icon={Sparkles} />} />

      <div className="mt-4 space-y-3">
        <SegmentedControl items={["SETUP", "REPLAY", "JOURNAL"]} value={shareType} onChange={handleShareTypeChange} />
        {shareType === "JOURNAL" ? <SegmentedControl items={["Week", "Month", "Quarter"]} value={journalPeriod} onChange={setJournalPeriod} /> : null}
        <div className="mx-auto w-full max-w-[420px] shrink-0">
          <SharePortraitCard
            shareType={shareType}
            selectedInstrumentKey={setupCardInstrumentLabel}
            directionLabel={setupDirectionLabel}
            contextLine={contextLine}
            entryValue={setupCardEntry}
            stopValue={setupCardStop}
            targetValue={setupCardTarget}
            rewardRiskRatio={rewardRiskRatio}
            GIF_PREVIEW_DURATION_SECONDS={GIF_PREVIEW_DURATION_SECONDS}
            heroMetric={heroMetric}
            heroMetricAnimatedNumber={heroMetricAnimation?.value ?? null}
            heroMetricFormatter={heroMetricAnimation?.formatter ?? null}
            secondaryMetrics={secondaryMetrics}
            footerLabel={footerLabel}
            setupMissingMessage={setupMissingMessage}
            identity={shareIdentity}
            disableMotion={false}
            setupProjectionChart={setupProjectionChart}
            setupEntryTimeLabel={setupEntryTimeLabel}
          />
        </div>
        <SegmentedControl
          items={[
            { value: "dollar", label: "$" },
            { value: "points", label: "Points" },
          ]}
          value={displayMode}
          onChange={setDisplayMode}
        />
        <motion.button
          type="button"
          onClick={handleShareExport}
          disabled={shareDisabled}
          whileTap={shareDisabled ? undefined : { scale: 0.98, opacity: 0.85 }}
          className={cn(
            "w-full rounded-[18px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.24))] px-4 py-3 text-[14px] font-semibold text-slate-700 shadow-[0_10px_22px_rgba(125,145,182,0.12),inset_0_1px_0_rgba(255,255,255,0.96)]",
            shareDisabled && "cursor-not-allowed opacity-60"
          )}
        >
          {isExporting ? "Exporting..." : "Share"}
        </motion.button>
        {exportError ? <div className="text-[12px] text-rose-500">{exportError}</div> : null}
      </div>


      <div className="pointer-events-none fixed -left-[99999px] top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
        <div ref={shareCardExportRef} style={{ width: `${SHARE_CARD_EXPORT_WIDTH}px`, height: `${SHARE_CARD_EXPORT_HEIGHT}px` }}>
          <SharePortraitCard
            shareType={shareType}
            selectedInstrumentKey={setupCardInstrumentLabel}
            directionLabel={setupDirectionLabel}
            contextLine={contextLine}
            entryValue={setupCardEntry}
            stopValue={setupCardStop}
            targetValue={setupCardTarget}
            rewardRiskRatio={rewardRiskRatio}
            GIF_PREVIEW_DURATION_SECONDS={GIF_PREVIEW_DURATION_SECONDS}
            heroMetric={heroMetric}
            heroMetricAnimatedNumber={heroMetricAnimation?.value ?? null}
            heroMetricFormatter={heroMetricAnimation?.formatter ?? null}
            secondaryMetrics={secondaryMetrics}
            footerLabel={footerLabel}
            setupMissingMessage={setupMissingMessage}
            identity={shareIdentity}
            disableMotion
            setupProjectionChart={setupProjectionChart}
            setupEntryTimeLabel={setupEntryTimeLabel}
          />
        </div>
      </div>
    </div>
  );
}

function JournalScreen({
  profileState,
  onProfileStateChange,
  onResetPreferences,
  debugEnabled = false,
}) {
  const profileInitials = useMemo(() => {
    const source = profileState.displayName || profileState.username || "HX";
    return source
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "HX";
  }, [profileState.displayName, profileState.username]);

  const updateField = useCallback(
    (key, value) => {
      onProfileStateChange((prev) => sanitizeProfileState({ ...prev, [key]: value }));
    },
    [onProfileStateChange]
  );

  const updateShareSetting = useCallback(
    (key, checked) => {
      onProfileStateChange((prev) =>
        sanitizeProfileState({
          ...prev,
          shareSettings: {
            ...prev.shareSettings,
            [key]: checked,
          },
        })
      );
    },
    [onProfileStateChange]
  );


  return (
    <div className="space-y-4 pb-4">
      <DebugRenderMarker enabled={debugEnabled} markerText="JOURNAL SCREEN" />
      <ScreenHeader right={<TopIconPill icon={UserRound} />} />
      <GlassCard className="rounded-[30px] p-5">
        <TinyLabel>Profile</TinyLabel>
        <div className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-slate-700">Your profile</div>
        <div className="mt-4 flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/70 bg-white/50 text-[20px] font-semibold text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]">
            {profileInitials}
          </div>
          <div className="text-[12px] text-slate-500">
            Avatar placeholder for this first pass.
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Display name</div>
            <input
              type="text"
              value={profileState.displayName}
              onChange={(event) => updateField("displayName", event.target.value)}
              className="w-full rounded-[16px] border border-white/75 bg-white/50 px-3 py-2.5 text-[14px] font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] outline-none placeholder:text-slate-400 focus:border-blue-200"
              placeholder="Your name"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Username</div>
            <div className="flex items-center rounded-[16px] border border-white/75 bg-white/50 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
              <span className="pr-1 text-[14px] font-semibold text-slate-500">@</span>
              <input
                type="text"
                value={profileState.username}
                onChange={(event) => updateField("username", event.target.value.replace(/^@+/, ""))}
                className="w-full bg-transparent text-[14px] font-medium text-slate-700 outline-none placeholder:text-slate-400"
                placeholder="username"
              />
            </div>
          </label>
        </div>
      </GlassCard>

      <GlassCard className="rounded-[30px] p-5">
        <TinyLabel>Theme settings</TinyLabel>
        <div className="mt-2 text-[16px] font-semibold tracking-[-0.02em] text-slate-700">Appearance</div>
        <div className="mt-3">
          <SegmentedControl
            items={[
              { value: "light", label: "Light mode" },
              { value: "dark", label: "Dark mode" },
            ]}
            value={profileState.theme}
            onChange={(theme) => updateField("theme", theme)}
          />
        </div>
      </GlassCard>

      <GlassCard className="rounded-[30px] p-5">
        <TinyLabel>Share identity settings</TinyLabel>
        <div className="mt-3 space-y-3">
          {[
            { key: "showAvatar", label: "Show avatar on share cards" },
            { key: "showUsername", label: "Show @username on share cards" },
          ].map((item) => (
            <label key={item.key} className="flex items-center justify-between gap-3 rounded-[16px] border border-white/65 bg-white/35 px-3 py-2.5">
              <span className="text-[13px] font-medium text-slate-600">{item.label}</span>
              <input
                type="checkbox"
                checked={profileState.shareSettings[item.key]}
                onChange={(event) => updateShareSetting(item.key, event.target.checked)}
                className="h-4 w-4 accent-blue-500"
              />
            </label>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="rounded-[30px] p-5">
        <TinyLabel>Preferences</TinyLabel>
        <div className="mt-2 text-[16px] font-semibold tracking-[-0.02em] text-slate-700">Reset local data</div>
        <div className="mt-1 text-[13px] text-slate-500">Clear saved app state and profile settings.</div>
        <button
          type="button"
          onClick={onResetPreferences}
          className="mt-3 w-full rounded-[18px] border border-white/70 bg-white/36 px-4 py-2.5 text-[13px] font-semibold text-slate-600 shadow-[0_8px_20px_rgba(140,158,194,0.10),inset_0_1px_0_rgba(255,255,255,0.94)] transition-colors hover:bg-white/46"
        >
          Reset preferences
        </button>
      </GlassCard>
    </div>
  );
}

function BottomNav({ activeTab, onTabChange }) {
  const reduceMotion = useReducedMotion();
  const skipClickAfterPointerUpRef = useRef(false);
  const activeIndex = getActiveIndex(
    NAV_ITEMS.map((item) => item.key),
    activeTab
  );
  const indicatorStyle = getSegmentedIndicatorStyle(NAV_ITEMS.length, activeIndex, 1);

  const triggerTabChange = useCallback(
    (nextTab) => {
      onTabChange(nextTab);
    },
    [onTabChange]
  );

  const handleTabPointerUp = useCallback(
    (event, nextTab) => {
      if (!shouldHandleTabPointerUp(event.pointerType)) return;
      skipClickAfterPointerUpRef.current = true;
      triggerTabChange(nextTab);
    },
    [triggerTabChange]
  );

  const handleTabClick = useCallback(
    (nextTab) => {
      if (skipClickAfterPointerUpRef.current) {
        skipClickAfterPointerUpRef.current = false;
        return;
      }
      triggerTabChange(nextTab);
    },
    [triggerTabChange]
  );

  return (
    <div className="absolute inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-20">
      <GlassCard className="rounded-full border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(245,248,255,0.58))] p-1.5 shadow-[0_22px_44px_rgba(118,138,183,0.18),0_8px_18px_rgba(118,138,183,0.10),inset_0_1px_0_rgba(255,255,255,0.98),inset_0_-1px_0_rgba(214,223,242,0.72)] backdrop-blur-[30px] [backdrop-filter:saturate(1.45)_blur(30px)]" padded={false}>
        <div className="pointer-events-none absolute inset-0 rounded-full opacity-[0.55] [backdrop-filter:saturate(1.65)_blur(38px)]" />
        <div className="pointer-events-none absolute inset-[1px] rounded-full bg-[linear-gradient(180deg,rgba(250,252,255,0.22),rgba(250,252,255,0.10)_50%,rgba(246,249,255,0.16))] [backdrop-filter:saturate(1.28)_blur(18px)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.24),rgba(255,255,255,0.10)_42%,rgba(255,255,255,0.06))]" />
        <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.95),transparent)] opacity-95" />
        <div className="relative grid grid-cols-5 gap-1.5">
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-[2px] top-[2px] z-0 rounded-full bg-[linear-gradient(180deg,rgba(244,248,255,0.98)_0%,rgba(232,240,255,0.94)_46%,rgba(222,233,255,0.9)_100%)] shadow-[0_11px_24px_rgba(96,135,233,0.2),0_1px_2px_rgba(96,135,233,0.1),inset_0_1px_0_rgba(255,255,255,0.98),inset_0_-1px_0_rgba(162,189,248,0.52),0_0_14px_rgba(120,150,255,0.14)] ring-1 ring-blue-200/90"
            initial={false}
            animate={indicatorStyle}
            transition={SPRING}
          />
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
            const active = activeTab === key;
            return (
              <motion.button
                key={key}
                whileTap={reduceMotion ? undefined : { scale: 0.97 }}
                onPointerUp={(event) => handleTabPointerUp(event, key)}
                onClick={() => handleTabClick(key)}
                type="button"
                className={cn(
                  "relative z-10 flex min-h-[42px] touch-manipulation flex-col items-center justify-center rounded-full px-2 py-2.5 text-center transition-colors duration-200 focus:outline-none",
                  active ? "text-blue-600" : "text-slate-400/58 hover:text-slate-500/80"
                )}
              >
                <Icon className="relative z-10" size={17} strokeWidth={2.1} />
                <span className={cn("relative z-10 mt-1 flex min-h-[10px] w-full items-center justify-center text-center font-semibold leading-[1] tracking-[-0.01em] opacity-[0.96]", key === "share" ? "text-[10px]" : "text-[8px]")}>{label}</span>
              </motion.button>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}

export default function App() {
  const reduceMotion = useReducedMotion();
  const [debugEnabled] = useState(() => (typeof window !== "undefined" ? isDebugModeEnabled(window.location.search, window.location.hash) : false));
  const [activeTab, setActiveTab] = useState(() => {
    if (typeof window === "undefined") return "position";
    return resolveTabRoute(window.location.hash).activeTab;
  });
  const [positionState, setPositionState] = useState(() => sanitizePositionState(readStoredAppState()?.positionState));
  const [compoundState, setCompoundState] = useState(() => sanitizeCompoundState(readStoredAppState()?.compoundState));
  const [viewState, setViewState] = useState(() => sanitizeViewState(readStoredAppState()?.viewState));
  const [profileState, setProfileState] = useState(() => sanitizeProfileState(readStoredProfileState()));
  const [trades, setTrades] = useState(() => sanitizeTrades(readStoredAppState()?.trades));
  const evaluatedTrades = trades;
  const safeCompoundState = useMemo(() => sanitizeCompoundState(compoundState), [compoundState]);
  const anonymousShareIdentity = useMemo(
    () => ({
      isAnonymous: true,
      showAvatar: true,
      showUsername: true,
      username: "@helixtrader",
      displayName: "Helix",
      avatar: "",
    }),
    []
  );
  const shareIdentity = useMemo(() => {
    const normalizedUsername = String(profileState.username || "").replace(/^@+/, "").trim();
    const hasLocalIdentity = Boolean(normalizedUsername || profileState.displayName || profileState.avatar);
    if (!hasLocalIdentity) return anonymousShareIdentity;
    return {
      isAnonymous: false,
      showAvatar: Boolean(profileState.shareSettings?.showAvatar),
      showUsername: Boolean(profileState.shareSettings?.showUsername),
      username: `@${normalizedUsername || "helixtrader"}`,
      displayName: profileState.displayName || normalizedUsername || "Helix Trader",
      avatar: profileState.avatar || "",
    };
  }, [anonymousShareIdentity, profileState.avatar, profileState.displayName, profileState.shareSettings, profileState.username]);
  const setCompoundStateSafe = useCallback((nextValueOrUpdater) => {
    setCompoundState((previousState) => updateCompoundStateSafely(previousState, nextValueOrUpdater));
  }, []);


  const resetPreferences = () => {
    if (typeof window !== "undefined") {
      const shouldReset = window.confirm("Reset saved preferences and restore defaults?");
      if (!shouldReset) return;
    }

    clearPersistedAppState();
    clearPersistedProfileState();

    setPositionState({ ...POSITION_DEFAULTS });
    setCompoundState({ ...COMPOUND_DEFAULTS });
    setViewState({ ...VIEW_DEFAULTS });
    setProfileState({ ...PROFILE_DEFAULTS, shareSettings: { ...PROFILE_DEFAULTS.shareSettings } });
    setTrades([]);
  };

  const importCsvTrades = useCallback(
    async ({ trades: incomingTrades }) => {
      if (!Array.isArray(incomingTrades) || !incomingTrades.length) {
        return { importedCount: 0, dedupedCount: 0 };
      }
      try {
        const existingTrades = sanitizeTrades(trades);
        const existingKeySet = new Set(existingTrades.map((trade) => buildStableTradeFingerprint(trade)));
        const normalizedIncoming = sanitizeTrades(incomingTrades.map((trade) => ({ ...trade, accountId: "" })));
        const dedupedIncoming = normalizedIncoming.filter((trade) => !existingKeySet.has(buildStableTradeFingerprint(trade)));
        const mergedTrades = mergeTradesWithDedupe(existingTrades, dedupedIncoming);
        setTrades(mergedTrades);

        return {
          importedCount: dedupedIncoming.length,
          dedupedCount: Math.max(0, normalizedIncoming.length - dedupedIncoming.length),
        };
      } catch (error) {
        throw error;
      }
    },
    [trades]
  );

  const csvTrades = useMemo(
    () => trades.filter((trade) => String(trade?.source || "").toLowerCase() === "csv" || String(trade?.importSource || "").toLowerCase() === "csv"),
    [trades]
  );

  const dashboardSnapshot = useMemo(() => {
    const accountBalanceNumber = Math.max(0, parseNumberString(positionState.accountBalance || "0"));
    const instrument = positionState.instrument || "MNQ";
    const winRate = Math.max(0, Math.min(100, Number(positionState.winRate) || 0));
    const selectedInstrument = POSITION_INSTRUMENTS.find((item) => item.key === instrument) || POSITION_INSTRUMENTS[2];
    const entryPrice = parseNumberString(positionState.entry || "0");
    const stopPrice = parseNumberString(positionState.stop || "0");
    const targetPrice = parseNumberString(positionState.target || "0");
    const rewardPoints = Math.max(0, Math.abs(targetPrice - entryPrice));
    const riskPoints = Math.max(0, Math.abs(entryPrice - stopPrice));
    const rewardRiskRatio = riskPoints > 0 ? rewardPoints / riskPoints : 0;
    const winProbability = winRate / 100;
    const lossProbability = 1 - winProbability;
    const rawKellyFraction = rewardRiskRatio > 0 ? winProbability - lossProbability / rewardRiskRatio : 0;
    const clampedKellyFraction = Math.max(0, Math.min(1, Number.isFinite(rawKellyFraction) ? rawKellyFraction : 0));
    const kellyMultiplier = positionState.kelly === "Full" ? 1 : positionState.kelly === "½" ? 0.5 : positionState.kelly === "¼" ? 0.25 : 0;
    const riskBudget = accountBalanceNumber * clampedKellyFraction * kellyMultiplier;
    const riskPerContract = riskPoints * (selectedInstrument.pointValue || 1);
    const autoSuggestedContracts = riskPerContract > 0 ? Math.max(0, Math.floor(riskBudget / riskPerContract)) : 0;
    const manualContracts = Math.max(0, parseNumberString(positionState.contracts || "0"));
    const isManualContracts = positionState.kelly === "Off";
    const activeContracts = isManualContracts ? manualContracts : autoSuggestedContracts;

    const projectionMode = safeCompoundState.projectionMode;
    const startingBalance = Math.max(0, parseNumberString(positionState.accountBalance || "0"));
    const projectionDollarGoal = Math.max(0, parseNumberString(safeCompoundState.projectionGoalDollarInput || "0"));
    const projectionPercentGoal = Math.max(0, parseNumberString(safeCompoundState.projectionGoalPercentInput || "0"));
    const projectionGoalValue = safeCompoundState.projectionGoalDisplayType === "%"
      ? startingBalance * (1 + projectionPercentGoal / 100)
      : projectionDollarGoal;
    const manualStartingBalance = Math.max(0, parseNumberString(safeCompoundState.manualStartingBalanceInput || "0"));
    const frequencyValue = Math.max(1, parseNumberString(safeCompoundState.tradeFrequencyValue || "1"));
    const durationValue = Math.max(0, parseNumberString(safeCompoundState.durationInput || "0"));
    const gainRate = Math.max(0, parseNumberString(safeCompoundState.gainInput || "0")) / 100;
    const parsedWinRateInput = Math.max(0, Math.min(100, parseNumberString(safeCompoundState.winRateInput || "0")));
    const winRateModifier = parsedWinRateInput > 0 ? 0.5 + parsedWinRateInput / 200 : 1;
    const effectiveGrowth = gainRate * winRateModifier;
    const durationInDays =
      safeCompoundState.durationUnit === "Days" ? durationValue : safeCompoundState.durationUnit === "Weeks" ? durationValue * 7 : durationValue * 30;
    const frequencyPerDay =
      safeCompoundState.tradeFrequency === "Per Day" ? frequencyValue : safeCompoundState.tradeFrequency === "Per Week" ? frequencyValue / 7 : frequencyValue / 30;
    const intervals = Math.max(0, Math.floor(durationInDays * frequencyPerDay));
    let endingBalance = manualStartingBalance || 0;
    if (endingBalance > 0 && intervals > 0 && effectiveGrowth > 0) {
      for (let i = 0; i < intervals; i += 1) endingBalance *= 1 + effectiveGrowth;
    }

    const modeLabel = projectionMode ? "Forecast" : "Compound";
    const performanceTitle = projectionMode ? "Projection curve overview" : "Compounding curve overview";
    const contractsLabel = isManualContracts ? `${manualContracts || 0} manual` : `${autoSuggestedContracts} suggested`;
    const rangeDaysMap = { Week: 7, Month: 30, Quarter: 90, Year: 365 };
    const rangeSeriesPoints = { Week: 7, Month: 8, Quarter: 9, Year: 12 };

    const byRange = Object.entries(rangeDaysMap).reduce((acc, [rangeKey, days]) => {
      const rangeIntervals = Math.max(0, Math.floor(days * frequencyPerDay));
      const growthFactor = effectiveGrowth > 0 && rangeIntervals > 0 ? (1 + effectiveGrowth) ** rangeIntervals : 1;
      const baseBalance = projectionMode ? accountBalanceNumber : manualStartingBalance || accountBalanceNumber;
      const modeledBalance = Math.max(0, baseBalance * growthFactor);
      const modeledOutcome = projectionMode
        ? `Projected Goal: ${modeledBalance > 0 ? formatCompactCurrency(modeledBalance) : "—"}`
        : `Ending Balance: ${modeledBalance > 0 ? formatCompactCurrency(modeledBalance) : "—"}`;

      const seriesLength = rangeSeriesPoints[rangeKey] || 7;
      const seriesGrowthStep = Math.max(0, growthFactor - 1) / Math.max(1, seriesLength - 1);
      const performanceSeries = Array.from({ length: seriesLength }, (_, index) => {
        const curve = 1 + seriesGrowthStep * index;
        return Math.max(12, Math.min(98, Math.round(26 + curve * 18 + index * 3)));
      });
      const sessionMix = Array.from({ length: seriesLength }, (_, index) => {
        const center = 46 + Math.min(36, activeContracts * 3);
        return Math.max(18, Math.min(92, center + (index % 2 === 0 ? -10 : 8) + index));
      });

      acc[rangeKey] = {
        accountBalance: formatCurrency(modeledBalance),
        // Dashboard data does not include time-stamped trade logs yet, so these metrics remain constant across ranges.
        winRate: formatPercent(winRate),
        winRateTone: winRate >= 55 ? "positive" : "default",
        instrument,
        contracts: contractsLabel,
        modeLabel,
        performanceTitle,
        modeOutcome: modeledOutcome,
        frequencySummary: `${frequencyValue} ${safeCompoundState.tradeFrequency} • ${rangeKey}`,
        contractSummary: `Position sizing: ${activeContracts} contract${activeContracts === 1 ? "" : "s"} on ${instrument}.`,
        performanceSeries,
        sessionMix,
      };

      return acc;
    }, {});

    return { byRange };
  }, [positionState, safeCompoundState]);

  const hashValue = typeof window !== "undefined" ? window.location.hash : "";
  const resolvedTabFromHashValue = resolveTabFromHash(hashValue);
  const activeDashboardSnapshot = ensureDashboardSnapshot(
    dashboardSnapshot?.byRange?.[viewState.dashboardRange] || dashboardSnapshot?.byRange?.Month,
    createFallbackDashboardSnapshot(formatCurrency(0))
  );
  const shareJournalDerivedSummary = {
    instrument: positionState.instrument,
    contracts: positionState.contracts,
    winRate: positionState.winRate,
    kelly: positionState.kelly,
    compoundMode: safeCompoundState.projectionMode ? "Forecast" : "Compound",
    frequencySummary: buildCompoundFrequencySummary(safeCompoundState),
    duration: `${safeCompoundState.durationInput} ${safeCompoundState.durationUnit}`,
    gainInput: safeCompoundState.gainInput,
    compoundWinRateInput: safeCompoundState.winRateInput,
  };

  const syncActiveTabFromLocationHash = useCallback(() => {
    if (typeof window === "undefined") return;
    setActiveTab((prev) => syncTabStateFromHash(prev, window.location.hash));
  }, []);

  const handleTabChange = useCallback((nextTab) => {
    const { activeTab: resolvedTab, canonicalHash } = resolveTabRoute(`#${nextTab}`);

    if (typeof window !== "undefined" && window.location.hash !== canonicalHash) {
      window.history.replaceState(null, "", canonicalHash);
    }

    setActiveTab((prev) => (prev === resolvedTab ? prev : resolvedTab));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    syncActiveTabFromLocationHash();
    window.addEventListener("hashchange", syncActiveTabFromLocationHash);
    window.addEventListener("popstate", syncActiveTabFromLocationHash);

    return () => {
      window.removeEventListener("hashchange", syncActiveTabFromLocationHash);
      window.removeEventListener("popstate", syncActiveTabFromLocationHash);
    };
  }, [syncActiveTabFromLocationHash]);

  useEffect(() => {
    if (trades.length !== evaluatedTrades.length) {
      setTrades(evaluatedTrades);
      return;
    }
    const changed = trades.some((trade, index) => {
      const evaluatedTrade = evaluatedTrades[index];
      if (!evaluatedTrade) return false;
      return (
        Boolean(trade.ruleViolation) !== Boolean(evaluatedTrade.ruleViolation) ||
        (trade.ruleViolationReason || null) !== (evaluatedTrade.ruleViolationReason || null)
      );
    });
    if (!changed) return;
    setTrades(evaluatedTrades);
  }, [evaluatedTrades, trades]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    persistAppState({
      positionState,
      compoundState: safeCompoundState,
      viewState,
      trades: evaluatedTrades,
    });
  }, [evaluatedTrades, positionState, safeCompoundState, viewState]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    persistProfileState(profileState);
  }, [profileState]);

  const screen =
    activeTab === "position" ? (
      <PositionScreen positionState={positionState} setPositionState={setPositionState} profileState={profileState} debugEnabled={debugEnabled} />
    ) : activeTab === "compound" ? (
      <CompoundScreen positionState={positionState} compoundState={safeCompoundState} setCompoundState={setCompoundStateSafe} debugEnabled={debugEnabled} />
    ) : activeTab === "dashboard" ? (
      <DashboardScreen
        dashboardSnapshot={dashboardSnapshot}
        range={viewState.dashboardRange}
        onRangeChange={(dashboardRange) => setViewState((prev) => ({ ...prev, dashboardRange }))}
        trades={csvTrades}
        tradeTypeFilter={viewState.dashboardTradeTypeFilter}
        onTradeTypeFilterChange={(dashboardTradeTypeFilter) => setViewState((prev) => ({ ...prev, dashboardTradeTypeFilter }))}
        onImportCsvTrades={importCsvTrades}
        shareIdentity={shareIdentity}
        debugEnabled={debugEnabled}
      />
    ) : activeTab === "journal" ? (
      <JournalScreen
        profileState={profileState}
        onProfileStateChange={setProfileState}
        onResetPreferences={resetPreferences}
        debugEnabled={debugEnabled}
      />
    ) : (
      <ShareScreen
        positionState={positionState}
        compoundState={safeCompoundState}
        dashboardSnapshot={dashboardSnapshot}
        shareIdentity={shareIdentity}
        debugEnabled={debugEnabled}
      />
    );

  const renderedScreenName = resolveScreenComponentName(activeTab);

  const debugInspectorState = {
    activeTab,
    currentHash: hashValue || "",
    debugModeActive: debugEnabled,
    resolvedTabFromHash: resolvedTabFromHashValue,
    renderedScreenComponent: renderedScreenName,
    sanitizedCompoundState: safeCompoundState,
    dashboardSnapshotSummary: {
      selectedRange: viewState.dashboardRange,
      modeLabel: activeDashboardSnapshot.modeLabel,
      modeOutcome: activeDashboardSnapshot.modeOutcome,
      accountBalance: activeDashboardSnapshot.accountBalance,
      frequencySummary: activeDashboardSnapshot.frequencySummary,
      contractSummary: activeDashboardSnapshot.contractSummary,
      performanceSeriesPoints: activeDashboardSnapshot.performanceSeries?.length || 0,
      sessionMixPoints: activeDashboardSnapshot.sessionMix?.length || 0,
    },
    shareJournalDerivedSummaryInputs: shareJournalDerivedSummary,
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(204,221,255,0.96),_rgba(236,241,250,0.98)_38%,_rgba(243,241,237,0.98)_76%)] text-slate-700">
      <DebugModeBanner enabled={debugEnabled} />
      <DebugStateInspector enabled={debugEnabled} state={debugInspectorState} />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-10%] top-[6%] h-[420px] w-[420px] rounded-full bg-blue-200/24 blur-3xl" />
        <div className="absolute bottom-[-16%] right-[-8%] h-[380px] w-[380px] rounded-full bg-amber-100/22 blur-3xl" />
      </div>
      <div className="mx-auto flex min-h-screen w-full items-center justify-center px-0 py-0 sm:max-w-[430px] sm:px-4 sm:py-4">
        <div className="relative h-[100dvh] w-full overflow-hidden rounded-none border-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.30),rgba(255,255,255,0.18))] shadow-none backdrop-blur-[26px] sm:h-[calc(100dvh-2rem)] sm:max-h-[812px] sm:rounded-[40px] sm:border sm:border-blue-100/40 sm:shadow-[0_24px_90px_rgba(126,148,188,0.28),0_10px_30px_rgba(172,188,220,0.14),inset_0_1px_0_rgba(255,255,255,0.92)]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.02))]" />
          <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(circle_at_top,rgba(110,152,255,0.18),transparent_70%)]" />
          <div className="absolute left-1/2 top-2 hidden h-1.5 w-28 -translate-x-1/2 rounded-full bg-slate-300/45 sm:block" />
          <main className="relative h-full overflow-y-auto px-4 pb-[calc(7rem+env(safe-area-inset-bottom,0px))] pt-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeTab}
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 10, scale: 0.995 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -10, scale: 0.995 }}
                transition={TAB_CONTENT_TRANSITION}
              >
                {screen}
              </motion.div>
            </AnimatePresence>
          </main>
          <BottomNav activeTab={activeTab} onTabChange={handleTabChange} />
        </div>
      </div>

      <style>{`
        .slider-premium::-webkit-slider-runnable-track { height: 10px; border-radius: 999px; background: linear-gradient(90deg, rgba(96,137,232,0.92), rgba(147,189,255,0.72)); }
        .slider-premium::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; margin-top: -6px; width: 22px; height: 22px; border-radius: 999px; background: linear-gradient(180deg, rgba(255,255,255,1), rgba(238,244,255,0.96)); border: 1px solid rgba(190,205,240,0.95); }
        .slider-premium::-moz-range-track { height: 10px; border-radius: 999px; background: linear-gradient(90deg, rgba(96,137,232,0.92), rgba(147,189,255,0.72)); }
        .slider-premium::-moz-range-thumb { width: 22px; height: 22px; border-radius: 999px; background: linear-gradient(180deg, rgba(255,255,255,1), rgba(238,244,255,0.96)); border: 1px solid rgba(190,205,240,0.95); }
        @keyframes balanceShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      `}</style>
    </div>
  );
}
