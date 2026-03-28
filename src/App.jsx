import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Calculator,
  ChartColumn,
  LineChart,
  LayoutGrid,
  Search,
  Plus,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import {
  COMPOUND_DEFAULTS,
  DASHBOARD_RANGES,
  KELLY_OPTIONS,
  POSITION_DEFAULTS,
  VIEW_DEFAULTS,
  clearPersistedAppState,
  persistAppState,
  readStoredAppState,
  resolveTabFromHash,
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

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

const NAV_META = {
  position: { label: "Position", icon: Calculator },
  compound: { label: "Compound", icon: TrendingUp },
  share: { label: "Share", icon: Plus },
  dashboard: { label: "Dashboard", icon: ChartColumn },
  journal: { label: "Journal", icon: BookOpen },
};

const NAV_ITEMS = TAB_KEYS.map((key) => ({ key, ...NAV_META[key] }));

const SPRING = { type: "spring", stiffness: 430, damping: 34, mass: 0.7 };
const HERO_NUMBER_TEXT_CLASS =
  "bg-[linear-gradient(110deg,rgba(71,85,105,0.98)_0%,rgba(255,255,255,0.9)_45%,rgba(51,65,85,0.92)_60%,rgba(100,116,139,0.86)_100%)] bg-[length:200%_100%] bg-clip-text font-semibold leading-[1] tracking-[-0.08em] text-transparent animate-[balanceShimmer_10s_linear_infinite]";
const POSITION_INSTRUMENTS = getDefaultInstrumentShortcuts().map((instrument) => ({
  key: instrument.symbol,
  pointValue: instrument.pointValue ?? 1,
  defaults:
    instrument.symbol === "ES" || instrument.symbol === "MES"
      ? { entry: "5,250.00", stop: "5,245.00", target: "5,260.00" }
      : { entry: "21,500.00", stop: "21,470.00", target: "21,560.00" },
}));

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

function GlassCard({ children, className = "", padded = true, highlight = false }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[28px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.24))] shadow-[0_16px_44px_rgba(139,157,193,0.16),0_4px_16px_rgba(166,180,209,0.10),inset_0_1px_0_rgba(255,255,255,0.94)] backdrop-blur-[18px]",
        highlight && "bg-[linear-gradient(180deg,rgba(233,241,255,0.68),rgba(255,255,255,0.26))]",
        padded && "p-5",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),transparent_36%)]" />
      <div className="relative">{children}</div>
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
  visualPanelHeight,
  replayPathLabel,
  rewardRiskRatio,
  isJournalCard,
  isReplayCard,
  replayPathCurve,
  GIF_PREVIEW_DURATION_SECONDS,
  heroMetric,
  secondaryMetrics,
  footerLabel,
  setupMissingMessage = "",
}) {
  const normalizedDirection = typeof directionLabel === "string" ? directionLabel.trim().toUpperCase() : "";
  const directionPillClassName = cn(
    "shrink-0 inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]",
    normalizedDirection === "LONG" && "bg-emerald-400/15 text-emerald-700",
    normalizedDirection === "SHORT" && "bg-rose-400/15 text-rose-700"
  );
  const chartTargetY = 22;
  const chartEntryY = 50;
  const chartStopY = 78;
  const chartPathStartX = 26;
  const chartPathEndX = 74;
  const zoneLines = [
    { label: "TARGET", y: chartTargetY, tone: "rgba(16,185,129,0.38)", value: targetValue },
    { label: "ENTRY", y: chartEntryY, tone: "rgba(71,85,105,0.32)", value: entryValue },
    { label: "STOP", y: chartStopY, tone: "rgba(244,63,94,0.36)", value: stopValue },
  ];
  const formatLevelValue = (value) =>
    Number(value || 0).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  const setupProjectedCurve = `M ${chartPathStartX} ${chartEntryY} C 35 ${chartEntryY - 1.5}, 45 ${chartEntryY - 12}, 55 ${chartEntryY - 16} C 63 ${chartEntryY - 20}, 69 ${chartTargetY + 2}, ${chartPathEndX} ${chartTargetY}`;
  const truePathCurve = isReplayCard
    ? replayPathCurve
    : setupProjectedCurve;
  const replayMarkerKeyframes = { cx: [26, 34, 46, 56, 66, 74], cy: [50, 48, 58, 44, 34, 24] };
  const setupMarkerPosition = { cx: chartPathEndX, cy: chartTargetY };
  const journalCurve = "M 26 70 C 34 67, 40 60, 46 56 C 52 52, 57 57, 62 48 C 66 41, 70 33, 74 26";
  const chartModeLabel = shareType === "SETUP" ? "PROJECTED PATH" : shareType === "REPLAY" ? "TRUE PATH" : "EQUITY CURVE";
  const pathEase = [0.23, 1, 0.32, 1];
  const hasDirectionalStoryLine = !isJournalCard && (normalizedDirection === "LONG" || normalizedDirection === "SHORT");
  const directionalStoryLine = hasDirectionalStoryLine
    ? `${normalizedDirection} from ${entryValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} → ${targetValue.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : "";

  return (
    <div className="relative box-border ml-auto mr-auto w-full max-w-[420px] aspect-[9/16] overflow-hidden rounded-[36px] border border-white/55 bg-[linear-gradient(180deg,rgba(249,251,255,0.98),rgba(236,243,255,0.94))] shadow-[0_26px_65px_rgba(125,145,182,0.26),inset_0_1px_0_rgba(255,255,255,0.92)]">
      <div className="flex h-full flex-col bg-[radial-gradient(circle_at_12%_8%,rgba(68,110,255,0.20),transparent_38%),radial-gradient(circle_at_86%_60%,rgba(45,198,255,0.12),transparent_42%)] px-6 pb-6 pt-6 text-slate-700">
        <div className="flex items-center justify-between gap-3">
          <div className="shrink-0 inline-flex items-center rounded-full bg-emerald-400/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700">
            {shareType}
          </div>
          <div className="min-w-0 flex-1 text-center text-[22px] font-semibold tracking-[-0.03em] text-slate-700">{selectedInstrumentKey}</div>
          {normalizedDirection ? <div className={directionPillClassName}>{normalizedDirection}</div> : null}
        </div>

        <div className="mt-3 text-[13px] text-slate-500">{contextLine}</div>

        <div className="mt-6 grid w-full grid-cols-3 gap-4">
          {[
            { label: "ENTRY", value: entryValue, tone: "text-slate-700" },
            { label: "STOP", value: stopValue, tone: "text-rose-400" },
            { label: "TARGET", value: targetValue, tone: "text-emerald-500" },
          ].map((item) => (
            <div key={item.label} className="min-w-0 rounded-[20px] border border-white/55 bg-white/46 p-4 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.54)] flex flex-col items-center justify-center">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{item.label}</div>
              <div className={cn("mt-3 w-full overflow-hidden text-ellipsis whitespace-nowrap text-[16px] font-semibold tracking-[-0.02em] tabular-nums", item.tone)}>
                {item.value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
              </div>
            </div>
          ))}
        </div>

        <div
          className="mt-6 w-full min-w-0 box-border overflow-hidden rounded-[28px] border border-white/55 bg-[linear-gradient(180deg,rgba(255,255,255,0.78),rgba(243,248,255,0.52))] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(136,156,191,0.12)]"
          style={{ height: `${visualPanelHeight}px` }}
        >
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <div className="min-w-0 truncate text-[19px] font-semibold uppercase tracking-[0.12em] text-slate-600">{chartModeLabel}</div>
            <div className="shrink-0 whitespace-nowrap text-[22px] font-semibold tabular-nums text-cyan-700">{rewardRiskRatio.toFixed(1)}R</div>
          </div>
          <svg viewBox="0 0 100 100" className="h-[calc(100%-52px)] w-full rounded-[20px]">
            <defs>
              <linearGradient id="share-chart-bg" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="rgba(255,255,255,0.65)" />
                <stop offset="100%" stopColor="rgba(241,246,255,0.34)" />
              </linearGradient>
              <radialGradient id="share-chart-focus" cx="50%" cy="52%" r="46%">
                <stop offset="0%" stopColor="rgba(116,152,255,0.10)" />
                <stop offset="100%" stopColor="rgba(116,152,255,0)" />
              </radialGradient>
              <linearGradient id="share-chart-path" x1="22%" y1="16%" x2="84%" y2="82%">
                <stop offset="0%" stopColor="#8B7CFF" />
                <stop offset="52%" stopColor="#5B8CFF" />
                <stop offset="100%" stopColor="#4FD9FF" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="100" height="100" rx="20" fill="url(#share-chart-bg)" />
            <rect x="0" y="0" width="100" height="100" rx="20" fill="url(#share-chart-focus)" />
            {zoneLines.map((zone) => (
              <g key={zone.label}>
                <line x1="20" x2="80" y1={zone.y} y2={zone.y} stroke={zone.tone} strokeWidth="0.9" />
                <text x="2" y={zone.y + 1.5} fill={zone.tone} fontSize="5.2" letterSpacing="0.68" fontWeight="600">
                  {zone.label}
                </text>
                <text
                  x="98"
                  y={zone.y + 1.6}
                  fill={zone.tone}
                  fontSize="6.4"
                  textAnchor="end"
                  fontWeight="600"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {formatLevelValue(zone.value)}
                </text>
              </g>
            ))}
            {isJournalCard ? (
              <motion.path
                d={journalCurve}
                fill="none"
                stroke="url(#share-chart-path)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 5.8, ease: pathEase, repeat: Infinity, repeatDelay: 0.35 }}
              />
            ) : (
              <>
                <motion.path
                  d={truePathCurve}
                  fill="none"
                  stroke="url(#share-chart-path)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 5.8, ease: pathEase, repeat: isReplayCard ? Infinity : 0, repeatDelay: 0.35 }}
                />
                {!isReplayCard ? (
                  <path
                    d={`M ${chartPathEndX} ${chartTargetY} C 77 ${chartTargetY - 1}, 79 ${chartTargetY - 0.4}, 81 ${chartTargetY - 0.2}`}
                    fill="none"
                    stroke="url(#share-chart-path)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray="1.6 2.2"
                    opacity="0.6"
                  />
                ) : null}
                <motion.circle
                  cx={isReplayCard ? 26 : setupMarkerPosition.cx}
                  cy={isReplayCard ? 50 : setupMarkerPosition.cy}
                  r="2.1"
                  fill="rgba(237,248,255,0.96)"
                  stroke="rgba(126,211,252,0.96)"
                  strokeWidth="0.9"
                  animate={isReplayCard ? replayMarkerKeyframes : undefined}
                  transition={{ duration: 5.8, ease: pathEase, repeat: isReplayCard ? Infinity : 0, repeatDelay: 0.35 }}
                />
                <circle
                  cx={isReplayCard ? 26 : setupMarkerPosition.cx}
                  cy={isReplayCard ? 50 : setupMarkerPosition.cy}
                  r="3.2"
                  fill="none"
                  stroke="rgba(125,211,252,0.35)"
                  strokeWidth="0.75"
                />
              </>
            )}
            {isJournalCard ? (
              <>
                <circle cx="74" cy="26" r="2.1" fill="rgba(237,248,255,0.96)" stroke="rgba(126,211,252,0.96)" strokeWidth="0.9" />
                <circle cx="74" cy="26" r="3.2" fill="none" stroke="rgba(125,211,252,0.35)" strokeWidth="0.75" />
              </>
            ) : null}
          </svg>
        </div>

        <div className="mt-6 min-w-0 text-center">
          <div
            className={cn(
              "mx-auto mt-3 flex min-h-[74px] max-w-full items-center justify-center overflow-hidden px-2 text-ellipsis whitespace-nowrap text-center text-[clamp(30px,10vw,52px)] tabular-nums",
              HERO_NUMBER_TEXT_CLASS
            )}
          >
            {heroMetric}
          </div>
          {hasDirectionalStoryLine ? <div className="mt-3 text-[12px] text-slate-500">{directionalStoryLine}</div> : null}
        </div>

        <div
          className={cn(
            hasDirectionalStoryLine ? "mt-4 grid gap-4" : "mt-3 grid gap-4",
            secondaryMetrics.length === 3 ? "grid-cols-3" : secondaryMetrics.length === 2 ? "grid-cols-2" : "grid-cols-2"
          )}
        >
          {secondaryMetrics.map((metric) => (
            <div key={metric.label} className="min-w-0 overflow-hidden rounded-[20px] border border-white/50 bg-white/42 p-4">
              <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[10px] uppercase tracking-[0.14em] text-slate-500">{metric.label}</div>
              <div className="mt-3 overflow-hidden text-ellipsis whitespace-nowrap text-[18px] font-semibold tabular-nums">{metric.value}</div>
            </div>
          ))}
        </div>

        {setupMissingMessage ? (
          <div className="mt-3 rounded-[16px] border border-slate-200/80 bg-white/45 px-4 py-2.5 text-center text-[12px] text-slate-500">{setupMissingMessage}</div>
        ) : null}

        <div className="mt-auto pt-4 text-center text-[11px] uppercase tracking-[0.2em] text-slate-400">{footerLabel}</div>
      </div>
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

function SegmentedControl({ items, value, onChange }) {
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
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              className={cn(
                "relative z-10 flex min-h-[42px] items-center justify-center rounded-full px-4 py-2 text-center text-[13px] font-semibold leading-none tracking-[-0.012em] transition-colors",
                active ? "text-blue-600" : "text-slate-500"
              )}
            >
              <span className="relative z-10">{item.label}</span>
            </button>
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
            <button
              type="button"
              onClick={onOpenSearch}
              className="flex min-h-[42px] w-full items-center justify-between gap-3 rounded-[28px] px-4.5 py-2 text-left text-slate-700"
              aria-label="Open futures instrument picker"
            >
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className="shrink-0 text-[13px] font-semibold leading-none tracking-[0.02em] text-slate-700">{customInstrument?.symbol || value}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-none text-slate-500">{customInstrument?.name || "Custom futures instrument"}</span>
              </span>
              <span className="shrink-0">
                <span
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
                  className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border border-slate-200/65 bg-white/35 text-slate-400 transition-colors hover:border-slate-300/80 hover:bg-slate-100/70 hover:text-slate-600 active:bg-slate-200/70"
                  aria-label="Return to compact favorite instruments"
                >
                  <LayoutGrid size={17} />
                </span>
              </span>
            </button>
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
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => onChange(item.value)}
                      className={cn(
                        "relative z-10 flex min-h-[42px] items-center justify-center rounded-full px-4 py-2 text-center text-[13px] font-semibold leading-none tracking-[-0.012em] transition-colors",
                        active ? "text-blue-600" : "text-slate-500"
                      )}
                    >
                      <span className="relative z-10">{item.label}</span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={onOpenSearch}
                className="relative z-10 flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:text-slate-600"
                aria-label="Search futures instruments"
              >
                <Search size={16} />
              </button>
            </div>
          </GlassCard>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FuturesInstrumentPicker({ open, query, onQueryChange, results, onClose, onSelect }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-slate-900/30 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Futures instrument picker">
      <div className="w-full max-w-[460px] overflow-hidden rounded-[28px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(245,248,255,0.9))] shadow-[0_18px_42px_rgba(120,140,190,0.25)]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200/75 px-4 py-3">
          <div className="text-[13px] font-semibold tracking-[-0.015em] text-slate-700">Futures Instrument Picker</div>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close futures picker">
            <X size={16} />
          </button>
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
        <div className="max-h-[52vh] overflow-y-auto px-2 pb-2">
          {results.map((instrument) => (
            <button
              key={instrument.symbol}
              type="button"
              onClick={() => onSelect(instrument.symbol)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-100/70"
            >
              <span className="w-[44px] shrink-0 text-[13px] font-semibold tracking-[0.02em] text-slate-700">{instrument.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-500">{instrument.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BalanceHeroCard({
  label,
  value,
  onChange,
  toggleLabel,
  toggleRightLabel,
  toggleState = false,
  onToggle,
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
              onChange={(e) => {
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
}) {
  const width = 320;
  const height = 150;
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

  return (
    <GlassCard className="rounded-[28px] p-4 sm:rounded-[30px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <TinyLabel>{projectionMode ? "Projection" : "Growth Chart"}</TinyLabel>
          <div className="mt-1 text-[17px] font-semibold tracking-[-0.03em] text-slate-700 sm:text-[18px]">
            {projectionMode ? "Projected balance path" : "Compounded growth path"}
          </div>
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-[24px] border border-blue-100/45 bg-[linear-gradient(180deg,rgba(255,255,255,0.28),rgba(255,255,255,0.12))] p-3">
        <div
          className="relative"
          onMouseMove={inspectorEnabled ? handlePointerMove : undefined}
          onMouseLeave={() => setActiveIndex(null)}
          onTouchStart={inspectorEnabled ? handlePointerMove : undefined}
          onTouchMove={inspectorEnabled ? handlePointerMove : undefined}
          onTouchEnd={() => setActiveIndex(null)}
        >
          <svg width="100%" viewBox={`0 0 ${width} ${height}`}>
            {[0.2, 0.4, 0.6, 0.8].map((ratio) => (
              <line key={ratio} x1="0" x2={width} y1={height * ratio} y2={height * ratio} stroke="rgba(148,163,184,0.22)" strokeWidth="1" />
            ))}
            {projectionMode && bandPath ? <path d={bandPath} fill="rgba(96,165,250,0.16)" /> : null}
            {projectionMode && bandLower ? <path d={pathFor(bandLower)} fill="none" stroke="rgba(148,163,184,0.35)" strokeWidth="1.5" strokeDasharray="4 4" /> : null}
            {projectionMode && bandUpper ? <path d={pathFor(bandUpper)} fill="none" stroke="rgba(96,165,250,0.45)" strokeWidth="1.5" strokeDasharray="4 4" /> : null}
            <path d={pathFor(points)} fill="none" stroke="rgba(59,130,246,0.96)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
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

function MetricRowCard({ label, value, tone = "default" }) {
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
        {value}
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

function PositionScreen({ positionState, setPositionState, debugEnabled = false }) {
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
  const parsedAccountBalance = parseNullableNumberString(positionState.accountBalance);
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
    setPositionState((prev) => {
      if (prev.instrument === nextInstrument) return prev;
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
  const pickerResults = useMemo(() => searchInstruments(instrumentQuery, { limit: 120 }), [instrumentQuery]);

  return (
    <div className="space-y-4 pb-4">
      <DebugRenderMarker enabled={debugEnabled} markerText="POSITION SCREEN" />
      <ScreenHeader />
      <PositionInstrumentSelector
        items={POSITION_INSTRUMENTS.map((item) => item.key)}
        value={instrument}
        onChange={handleInstrumentChange}
        onOpenSearch={() => setInstrumentPickerOpen(true)}
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
      <BalanceHeroCard label="Account Balance" value={positionState.accountBalance} onChange={(raw) => setField("accountBalance", formatNumberString(raw))} toggleLabel="Prop" toggleState={positionState.propMode} onToggle={() => setField("propMode", !positionState.propMode)} />

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
              <input
                type="text"
                inputMode="numeric"
                value={suggestedContractsDisplay}
                onChange={isKellyManual ? (e) => handleManualContractsChange(e.target.value) : undefined}
                readOnly={!isKellyManual}
                className="w-full bg-[linear-gradient(180deg,#5A81D9_0%,#6F91E6_44%,#B69357_100%)] bg-clip-text text-center text-[78px] font-semibold leading-[0.92] tracking-[-0.075em] text-transparent outline-none"
              />
            </motion.div>
          </div>
          <div className="mt-1.5 text-[16px] font-medium tracking-[-0.02em] text-slate-500">contracts</div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2.5">
          <MetricRowCard label="Risk" value={formatCurrency(potentialRisk)} tone="negative" />
          <MetricRowCard label="Return" value={formatCurrency(potentialReturn)} tone="positive" />
          <MetricRowCard label="R" value={`${rewardRiskRatio.toFixed(1)}R`} />
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

  const startingBalance = Math.max(0, parseNumberString(positionState.accountBalance || "25,000"));
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

  const resolveForecastTargetBalance = (goalMode, dollarGoal, percentGoal, startBalance, minimumValidDollarGoal) => {
    if (!Number.isFinite(startBalance) || startBalance <= 0) return null;
    if (goalMode === "%") {
      if (!Number.isFinite(percentGoal) || percentGoal <= 0) return null;
      const resolvedPercentTarget = startBalance * (1 + percentGoal / 100);
      return Number.isFinite(resolvedPercentTarget) ? resolvedPercentTarget : null;
    }
    if (!Number.isFinite(dollarGoal) || dollarGoal < minimumValidDollarGoal) return null;
    return dollarGoal;
  };

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

  const scaledProjectionData = useMemo(() => {
    if (!projectionTargetBalance || startingBalance <= 0 || effectiveGrowthPercentPerPeriod <= 0) {
      return { points: [], periodsEstimate: null, sizingMilestones: [] };
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
      if (balance >= projectionTargetBalance) {
        return { points, periodsEstimate: period, sizingMilestones };
      }
    }
    return { points, periodsEstimate: null, sizingMilestones };
  }, [projectionTargetBalance, startingBalance, effectiveGrowthPercentPerPeriod, hasSafeScalingInputs, balancePerContractTier, baseContracts]);

  const projectionChartPoints = scaledProjectionData.points.length >= 2 ? scaledProjectionData.points : [];
  const projectionChartReady = projectionChartPoints.length >= 2;
  const projectionPeriodsEstimate = scaledProjectionData.periodsEstimate;
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

  const projectionConfidenceSpread = useMemo(() => {
    if (!projectionChartReady) return 0;
    const baseSpread = 0.06;
    const gainModifier = hasSafeGain ? Math.min(0.1, parsedGainPercent / 200) : 0.04;
    const winRateModifier = hasSafeWinRate ? Math.max(0, (55 - parsedWinRatePercent) / 500) : 0.02;
    const drawdownModifier = projectionDrawdownMetrics.expected !== fallbackValue ? Math.min(0.08, parseNumberString(projectionDrawdownMetrics.expected) / 400) : 0.02;
    return Math.min(0.22, Math.max(0.05, baseSpread + gainModifier + winRateModifier + drawdownModifier));
  }, [projectionChartReady, hasSafeGain, parsedGainPercent, hasSafeWinRate, parsedWinRatePercent, projectionDrawdownMetrics.expected]);

  const projectionBandUpper = useMemo(() => {
    if (!projectionChartReady) return null;
    return projectionChartPoints.map((value, index) => {
      const progress = projectionChartPoints.length <= 1 ? 0 : index / (projectionChartPoints.length - 1);
      const spread = 1 + projectionConfidenceSpread * (0.4 + progress * 0.8);
      const upper = value * spread;
      return Number.isFinite(upper) ? upper : value;
    });
  }, [projectionChartReady, projectionChartPoints, projectionConfidenceSpread]);

  const projectionBandLower = useMemo(() => {
    if (!projectionChartReady) return null;
    return projectionChartPoints.map((value, index) => {
      const progress = projectionChartPoints.length <= 1 ? 0 : index / (projectionChartPoints.length - 1);
      const spread = 1 - projectionConfidenceSpread * (0.45 + progress * 0.9);
      const lower = Math.max(0, value * spread);
      return Number.isFinite(lower) ? lower : value;
    });
  }, [projectionChartReady, projectionChartPoints, projectionConfidenceSpread]);

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
    const sizeMilestones = scaledProjectionData.sizingMilestones.map((milestone) => ({
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
  }, [projectionChartReady, projectionTargetBalance, startingBalance, scaledProjectionData.sizingMilestones, projectionChartPoints.length]);

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

function DashboardScreen({ dashboardSnapshot, range, onRangeChange, debugEnabled = false }) {
  const fallbackSnapshot = createFallbackDashboardSnapshot(formatCurrency(0));
  const activeSnapshot = ensureDashboardSnapshot(dashboardSnapshot?.byRange?.[range] || dashboardSnapshot?.byRange?.Month, fallbackSnapshot);
  const performanceSeries = activeSnapshot.performanceSeries;
  const sessionMix = activeSnapshot.sessionMix;
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
      <ScreenHeader right={<TopIconPill icon={LineChart} />} />
      <SegmentedControl items={DASHBOARD_RANGES} value={range} onChange={onRangeChange} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MetricRowCard label="Account Balance" value={activeSnapshot.accountBalance} />
        <MetricRowCard label="Win Rate" value={activeSnapshot.winRate} tone={activeSnapshot.winRateTone} />
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
        <TinyLabel>Read-only Summary</TinyLabel>
        <div className="mt-4 space-y-3">
          {[activeSnapshot.modeOutcome, activeSnapshot.frequencySummary, activeSnapshot.contractSummary].map((note) => (
            <div key={note} className="rounded-[20px] bg-white/28 px-4 py-3 text-[13px] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
              {toSafeString(note, "—")}
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

function ShareScreen({ positionState, compoundState, dashboardSnapshot, debugEnabled = false }) {
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
  const [displayMode, setDisplayMode] = useState("dollar");
  const [journalPeriod, setJournalPeriod] = useState("Month");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [setupCardTimeMs, setSetupCardTimeMs] = useState(() => Date.now());
  const shareCardExportRef = useRef(null);
  const GIF_PREVIEW_DURATION_SECONDS = 5.8;
  const hasReplayTruePath = riskPoints > 0 && rewardPoints > 0;
  const replayPathLabel = hasReplayTruePath ? "True Path" : "Replay Path";
  const replayPathCurve = hasReplayTruePath
    ? "M 26 50 C 32 48, 37 60, 44 58 C 50 55, 53 43, 60 40 C 66 37, 70 30, 74 24"
    : "M 26 50 C 33 52, 38 60, 45 56 C 51 53, 54 45, 61 44 C 66 43, 70 34, 74 30";

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
      return `Called at ${formatLocalTimeAmPm(setupCardTimeMs)} (${formatLocalDateMmDdYy(setupCardTimeMs)})`;
    }
    if (shareType === "REPLAY") {
      return "Replay timestamp · 9:41 AM EST";
    }
    if (shareType === "JOURNAL") {
      return `${journalPeriod} performance period`;
    }
    return "Current Position tab setup";
  }, [journalPeriod, setupCardTimeMs, shareType]);

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

  const secondaryMetrics = useMemo(() => {
    if (shareType === "SETUP") {
      if (displayMode === "points") {
        return [
          { label: "Risk Points", value: riskPoints.toFixed(1) },
          { label: "Reward Points", value: rewardPoints.toFixed(1) },
        ];
      }
      return [
        { label: "Risk", value: formatCompactCurrency(projectedRisk) },
        { label: "Reward", value: formatCompactCurrency(projectedReward) },
        { label: "Contracts", value: contracts.toLocaleString("en-US") },
      ];
    }
    if (shareType === "REPLAY") {
      if (displayMode === "points") {
        return [
          { label: "Result Points", value: `${replayResultPoints >= 0 ? "+" : ""}${replayResultPoints.toFixed(1)}` },
          { label: "R Multiple", value: `${rewardRiskRatio.toFixed(1)}R` },
          { label: "Duration", value: formatSecondsLabel(GIF_PREVIEW_DURATION_SECONDS) },
        ];
      }
      return [
        { label: "Result", value: `${replayResult >= 0 ? "+" : "-"}${formatCompactCurrency(Math.abs(replayResult))}` },
        { label: "R Multiple", value: `${rewardRiskRatio.toFixed(1)}R` },
        { label: "Duration", value: formatSecondsLabel(GIF_PREVIEW_DURATION_SECONDS) },
      ];
    }
    if (displayMode === "points") {
      return [
        { label: "Trades", value: "48" },
        { label: "Win Rate", value: formatPercent(winRate) },
        { label: "Average R", value: `${rewardRiskRatio.toFixed(1)}R` },
        { label: "Net Result", value: `${rewardRiskRatio.toFixed(1)}R` },
      ];
    }
    return [
      { label: "Trades", value: "48" },
      { label: "Win Rate", value: formatPercent(winRate) },
      { label: "Average R", value: `${rewardRiskRatio.toFixed(1)}R` },
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

  const visualPanelHeight = shareType === "JOURNAL" ? 312 : 358;
  const isReplayCard = shareType === "REPLAY";
  const isJournalCard = shareType === "JOURNAL";
  const footerLabel = shareType === "JOURNAL" ? "Tracked with HELIX" : "Calculated with HELIX";
  const isSetupCard = shareType === "SETUP";
  const setupDirectionLabel = direction;
  const setupMissingMessage = isSetupCard && !setupIsComplete ? "Missing setup values on Position tab." : "";
  const setupCardInstrumentLabel = isSetupCard && !setupIsComplete ? "—" : selectedInstrument.key;
  const setupCardEntry = isSetupCard && !setupIsComplete ? 0 : entry;
  const setupCardStop = isSetupCard && !setupIsComplete ? 0 : stop;
  const setupCardTarget = isSetupCard && !setupIsComplete ? 0 : target;
  const shareDisabled = isExporting || (isSetupCard && !setupIsComplete);

  return (
    <div className="space-y-4 pb-4">
      <DebugRenderMarker enabled={debugEnabled} markerText="SHARE SCREEN" />
      <ScreenHeader right={<TopIconPill icon={Sparkles} />} />

      <div className="mt-4 space-y-3">
        <SegmentedControl items={["SETUP", "REPLAY", "JOURNAL"]} value={shareType} onChange={setShareType} />
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
            visualPanelHeight={visualPanelHeight}
            replayPathLabel={replayPathLabel}
            rewardRiskRatio={rewardRiskRatio}
            isJournalCard={isJournalCard}
            isReplayCard={isReplayCard}
            replayPathCurve={replayPathCurve}
            GIF_PREVIEW_DURATION_SECONDS={GIF_PREVIEW_DURATION_SECONDS}
            heroMetric={heroMetric}
            secondaryMetrics={secondaryMetrics}
            footerLabel={footerLabel}
            setupMissingMessage={setupMissingMessage}
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
        <button
          type="button"
          onClick={handleShareExport}
          disabled={shareDisabled}
          className={cn(
            "w-full rounded-[18px] border border-white/75 bg-[linear-gradient(180deg,rgba(255,255,255,0.42),rgba(255,255,255,0.24))] px-4 py-3 text-[14px] font-semibold text-slate-700 shadow-[0_10px_22px_rgba(125,145,182,0.12),inset_0_1px_0_rgba(255,255,255,0.96)]",
            shareDisabled && "cursor-not-allowed opacity-60"
          )}
        >
          {isExporting ? "Exporting..." : "Share"}
        </button>
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
            visualPanelHeight={visualPanelHeight}
            replayPathLabel={replayPathLabel}
            rewardRiskRatio={rewardRiskRatio}
            isJournalCard={isJournalCard}
            isReplayCard={isReplayCard}
            replayPathCurve={replayPathCurve}
            GIF_PREVIEW_DURATION_SECONDS={GIF_PREVIEW_DURATION_SECONDS}
            heroMetric={heroMetric}
            secondaryMetrics={secondaryMetrics}
            footerLabel={footerLabel}
            setupMissingMessage={setupMissingMessage}
          />
        </div>
      </div>
    </div>
  );
}

function JournalScreen({ positionState, compoundState, onResetPreferences, debugEnabled = false }) {
  const selectedInstrument = POSITION_INSTRUMENTS.find((item) => item.key === (positionState.instrument || "MNQ")) || POSITION_INSTRUMENTS[2];
  const instrument = selectedInstrument.key;
  const entry = parseNumberString(positionState.entry || "0");
  const stop = parseNumberString(positionState.stop || "0");
  const target = parseNumberString(positionState.target || "0");
  const winRate = Math.max(0, Math.min(100, Number(positionState.winRate) || 0));
  const contracts = Math.max(0, parseNumberString(positionState.contracts || "0"));
  const kellyMode = positionState.kelly || "Off";
  const riskPoints = Math.max(0, Math.abs(entry - stop));
  const rewardPoints = Math.max(0, Math.abs(target - entry));
  const rewardRiskRatio = riskPoints > 0 ? rewardPoints / riskPoints : 0;
  const riskPerContract = riskPoints * (selectedInstrument.pointValue || 1);
  const projectedRisk = riskPerContract * contracts;
  const projectedReturn = rewardPoints * (selectedInstrument.pointValue || 1) * contracts;

  const frequencyValue = Math.max(1, parseNumberString(compoundState.tradeFrequencyValue || "1"));
  const tradeFrequency = compoundState.tradeFrequency || "Per Day";
  const durationValue = Math.max(1, parseNumberString(compoundState.durationInput || "1"));
  const durationUnit = toSafeString(compoundState.durationUnit, "Months") || "Months";
  const projectionMode = compoundState.projectionMode ? "Forecast" : "Compound";
  const projectionWinRate = Math.max(0, Math.min(100, parseNumberString(compoundState.winRateInput || "0")));
  const projectionGain = Math.max(0, parseNumberString(compoundState.gainInput || "0"));

  const projectedTrades = useMemo(() => {
    if (tradeFrequency === "Per Day") return frequencyValue * durationValue;
    if (tradeFrequency === "Per Week") {
      const weeks = durationUnit === "Days" ? durationValue / 7 : durationUnit === "Weeks" ? durationValue : durationValue * 4;
      return Math.max(1, Math.round(weeks * frequencyValue));
    }
    const months = durationUnit === "Days" ? durationValue / 30 : durationUnit === "Weeks" ? durationValue / 4 : durationValue;
    return Math.max(1, Math.round(months * frequencyValue));
  }, [tradeFrequency, frequencyValue, durationValue, durationUnit]);

  const outlookTone = projectedReturn >= projectedRisk ? "text-emerald-600/90" : "text-rose-500/90";
  const outcomeContext = `${projectionMode}: ${frequencyValue} ${tradeFrequency} for ${durationValue} ${toSafeLower(durationUnit, "months")}`;
  const hasMeaningfulContent = Boolean(instrument) && Boolean(outcomeContext) && Number.isFinite(projectedTrades);

  return (
    <div className="space-y-4 pb-4">
      <DebugRenderMarker enabled={debugEnabled} markerText="JOURNAL SCREEN" />
      {!hasMeaningfulContent ? <DebugEmptyFallback enabled={debugEnabled} label="Journal rendered empty" /> : null}
      <ScreenHeader right={<TopIconPill icon={BookOpen} />} />
      <GlassCard className="rounded-[30px] p-5">
        <TinyLabel>Journal</TinyLabel>
        <div className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-slate-700">Trade setup snapshot</div>
        <div className="mt-1 text-[13px] text-slate-500">Read-only entries generated from current Position + Compound state.</div>
      </GlassCard>

      <GlassCard className="rounded-[30px] p-5">
        <TinyLabel>Current Entry</TinyLabel>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-[20px] bg-white/28 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500/85">Instrument</div>
            <div className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-700">{instrument}</div>
          </div>
          <div className="rounded-[20px] bg-white/28 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500/85">Contracts</div>
            <div className="mt-1 text-[17px] font-semibold tracking-[-0.02em] text-slate-700">{contracts}</div>
          </div>
          <div className="rounded-[20px] bg-white/28 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500/85">Entry / Stop / Target</div>
            <div className="mt-1 text-[14px] font-semibold tracking-[-0.02em] text-slate-700">
              {`${entry.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${stop.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / ${target.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </div>
          </div>
          <div className="rounded-[20px] bg-white/28 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500/85">Win Rate / Kelly</div>
            <div className="mt-1 text-[14px] font-semibold tracking-[-0.02em] text-slate-700">{`${formatPercent(winRate)} • ${kellyMode}`}</div>
          </div>
        </div>
      </GlassCard>

      <GlassCard className="rounded-[30px] p-5">
        <TinyLabel>Projected Outcome Context</TinyLabel>
        <div className="mt-3 space-y-2">
          <div className={cn("text-[16px] font-semibold tracking-[-0.02em]", outlookTone)}>
            {`Projected R:R ${rewardRiskRatio > 0 ? `${rewardRiskRatio.toFixed(1)}R` : "—"} • ${formatCurrency(projectedReturn)} vs ${formatCurrency(projectedRisk)}`}
          </div>
          <div className="text-[13px] text-slate-600">{outcomeContext}</div>
          <div className="text-[13px] text-slate-500">{`Compound assumptions: ${formatPercent(projectionWinRate)} win rate, ${formatPercent(projectionGain)} gain input, ~${projectedTrades} modeled trades.`}</div>
          {/* Heuristic note: there is no persisted historical trade log yet, so journal rows are synthesized from current app state and modeled projection assumptions only. */}
          <div className="rounded-[18px] bg-white/24 px-3 py-2 text-[12px] text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.68)]">
            Entries are read-only and reflect the current setup, not executed historical fills.
          </div>
        </div>
      </GlassCard>

      <GlassCard className="rounded-[30px] p-5">
        <TinyLabel>Preferences</TinyLabel>
        <div className="mt-2 text-[16px] font-semibold tracking-[-0.02em] text-slate-700">Reset local data</div>
        <div className="mt-1 text-[13px] text-slate-500">Clear saved app state and return to default values.</div>
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
  const safeCompoundState = useMemo(() => sanitizeCompoundState(compoundState), [compoundState]);
  const setCompoundStateSafe = useCallback((nextValueOrUpdater) => {
    setCompoundState((previousState) => updateCompoundStateSafely(previousState, nextValueOrUpdater));
  }, []);

  const resetPreferences = () => {
    if (typeof window !== "undefined") {
      const shouldReset = window.confirm("Reset saved preferences and restore defaults?");
      if (!shouldReset) return;
    }

    clearPersistedAppState();

    setPositionState({ ...POSITION_DEFAULTS });
    setCompoundState({ ...COMPOUND_DEFAULTS });
    setViewState({ ...VIEW_DEFAULTS });
  };

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
    if (typeof window === "undefined") return;
    persistAppState({
      positionState,
      compoundState: safeCompoundState,
      viewState,
    });
  }, [positionState, safeCompoundState, viewState]);

  const screen =
    activeTab === "position" ? (
      <PositionScreen positionState={positionState} setPositionState={setPositionState} debugEnabled={debugEnabled} />
    ) : activeTab === "compound" ? (
      <CompoundScreen positionState={positionState} compoundState={safeCompoundState} setCompoundState={setCompoundStateSafe} debugEnabled={debugEnabled} />
    ) : activeTab === "dashboard" ? (
      <DashboardScreen
        dashboardSnapshot={dashboardSnapshot}
        range={viewState.dashboardRange}
        onRangeChange={(dashboardRange) => setViewState((prev) => ({ ...prev, dashboardRange }))}
        debugEnabled={debugEnabled}
      />
    ) : activeTab === "journal" ? (
      <JournalScreen positionState={positionState} compoundState={safeCompoundState} onResetPreferences={resetPreferences} debugEnabled={debugEnabled} />
    ) : (
      <ShareScreen positionState={positionState} compoundState={safeCompoundState} dashboardSnapshot={dashboardSnapshot} debugEnabled={debugEnabled} />
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
                initial={reduceMotion ? false : { opacity: 0, y: 8, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4, filter: "blur(3px)" }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
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
