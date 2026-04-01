const PRICE_PATTERN = /^\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$/;

function stripPriceCandidate(raw) {
  return String(raw ?? "").trim().replace(/[^\d,.:]/g, "");
}

export function parseScannedPrice(raw) {
  const candidate = stripPriceCandidate(raw);
  if (!candidate || candidate.includes(":")) return null;
  if (!PRICE_PATTERN.test(candidate)) return null;
  const numeric = Number(candidate.replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return candidate;
}

export function normalizeDetectedSetup(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const entry = parseScannedPrice(candidate.entry);
  const stop = parseScannedPrice(candidate.stop);
  const target = parseScannedPrice(candidate.target);
  if (!entry || !stop || !target) return null;
  const entryValue = Number(entry.replace(/,/g, ""));
  const stopValue = Number(stop.replace(/,/g, ""));
  const targetValue = Number(target.replace(/,/g, ""));
  const isLong = stopValue < entryValue && targetValue > entryValue;
  const isShort = stopValue > entryValue && targetValue < entryValue;
  if (!isLong && !isShort) return null;
  return {
    entry,
    stop,
    target,
    direction: isLong ? "long" : "short",
  };
}

export function hasStableDetections(history, candidate, requiredFrames = 3) {
  const normalized = normalizeDetectedSetup(candidate);
  if (!normalized) return null;
  const nextHistory = [...history, normalized].slice(-requiredFrames);
  const stable =
    nextHistory.length === requiredFrames &&
    nextHistory.every(
      (item) =>
        item.entry === normalized.entry &&
        item.stop === normalized.stop &&
        item.target === normalized.target
    );
  return {
    nextHistory,
    stable: stable ? normalized : null,
  };
}

