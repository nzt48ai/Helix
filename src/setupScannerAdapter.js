import { normalizeDetectedSetup, parseScannedPrice } from "./setupScan";

const CENTER_STRIP_WIDTH_RATIO = 0.2;
const CENTER_STRIP_HEIGHT_RATIO = 0.9;
const MIN_LABEL_PIXEL_COUNT = 140;

let ocrModulePromise = null;
async function getTesseractModule() {
  if (ocrModulePromise) return ocrModulePromise;
  ocrModulePromise = import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js").catch(() => null);
  return ocrModulePromise;
}

function emitScannerEvent(onRuntimeEvent, stage, detail = {}) {
  if (typeof onRuntimeEvent === "function") onRuntimeEvent(stage, detail);
}

function toHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
  }

  return {
    h: h * 60,
    s: max === 0 ? 0 : delta / max,
    v: max,
  };
}

function isLikelyColoredLabelPixel(r, g, b) {
  const { s, v } = toHsv(r, g, b);
  return s > 0.35 && v > 0.32;
}

function extractCenterStripFromImage(image, canvas, context) {
  const w = image.width;
  const h = image.height;
  if (!w || !h) return null;

  const stripWidth = Math.max(48, Math.floor(w * CENTER_STRIP_WIDTH_RATIO));
  const stripHeight = Math.max(64, Math.floor(h * CENTER_STRIP_HEIGHT_RATIO));
  const x = Math.floor((w - stripWidth) / 2);
  const y = Math.floor((h - stripHeight) / 2);

  canvas.width = stripWidth;
  canvas.height = stripHeight;
  context.drawImage(image, x, y, stripWidth, stripHeight, 0, 0, stripWidth, stripHeight);
  return { width: stripWidth, height: stripHeight };
}

function detectLabelBands(imageData, width, height) {
  const rowCounts = new Array(height).fill(0);
  const data = imageData.data;

  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      if (isLikelyColoredLabelPixel(data[idx], data[idx + 1], data[idx + 2])) count += 1;
    }
    rowCounts[y] = count;
  }

  const rowThreshold = Math.max(6, Math.floor(width * 0.06));
  const bands = [];
  let start = null;

  for (let y = 0; y < height; y += 1) {
    if (rowCounts[y] >= rowThreshold) {
      if (start === null) start = y;
      continue;
    }
    if (start !== null) {
      if (y - start >= 8) bands.push({ top: start, bottom: y - 1 });
      start = null;
    }
  }
  if (start !== null && height - start >= 8) bands.push({ top: start, bottom: height - 1 });

  return bands
    .map((band) => {
      let minX = width;
      let maxX = 0;
      let count = 0;

      for (let y = band.top; y <= band.bottom; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = (y * width + x) * 4;
          if (!isLikelyColoredLabelPixel(data[idx], data[idx + 1], data[idx + 2])) continue;
          count += 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }

      if (count < MIN_LABEL_PIXEL_COUNT || maxX - minX < 20) return null;
      const padY = 5;
      const padX = 6;
      return {
        x: Math.max(0, minX - padX),
        y: Math.max(0, band.top - padY),
        width: Math.min(width - Math.max(0, minX - padX), maxX - minX + padX * 2),
        height: Math.min(height - Math.max(0, band.top - padY), band.bottom - band.top + padY * 2),
        centerY: (band.top + band.bottom) / 2,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.centerY - b.centerY)
    .slice(0, 5);
}

function parseLabelType(text) {
  const normalized = text.toLowerCase();
  if (/(entry|ent|buy|sell)/.test(normalized)) return "entry";
  if (/(stop|sl|loss)/.test(normalized)) return "stop";
  if (/(target|tp|take\s*profit|t1|t2|t3)/.test(normalized)) return "target";
  return null;
}

function extractPriceValue(text) {
  const rawMatches = String(text)
    .replace(/\s+/g, " ")
    .match(/[\d][\d,.:]*(?:\.\d+)?/g);
  if (!rawMatches) return null;
  for (const match of rawMatches) {
    const parsed = parseScannedPrice(match);
    if (parsed) return parsed;
  }
  return null;
}

function composeCandidateFromRegions(regions) {
  if (!regions.length) return null;

  const labeled = { entry: null, stop: null, target: null };
  const remaining = [];

  for (const region of regions) {
    if (region.label && region.price && !labeled[region.label]) {
      labeled[region.label] = region.price;
    } else if (region.price) {
      remaining.push(region);
    }
  }

  if (labeled.entry && labeled.stop && labeled.target) return labeled;

  if (!labeled.entry && remaining.length >= 3) {
    const sorted = [...remaining].sort((a, b) => a.centerY - b.centerY).slice(0, 3);
    const top = sorted[0].price;
    const middle = sorted[1].price;
    const bottom = sorted[2].price;
    const direct = { entry: middle, stop: bottom, target: top };
    if (normalizeDetectedSetup(direct)) return direct;
    const inverse = { entry: middle, stop: top, target: bottom };
    return normalizeDetectedSetup(inverse) ? inverse : null;
  }

  if (!labeled.entry && remaining.length > 0) {
    const byDistance = [...remaining].sort((a, b) => Math.abs(a.centerY - 0.5) - Math.abs(b.centerY - 0.5));
    labeled.entry = byDistance[0]?.price || null;
  }

  if (labeled.entry) {
    const unassigned = remaining.map((region) => region.price).filter(Boolean);
    if (!labeled.stop && unassigned.length > 0) labeled.stop = unassigned[0];
    if (!labeled.target && unassigned.length > 1) labeled.target = unassigned[1];
  }

  if (labeled.entry && labeled.stop && labeled.target) {
    return normalizeDetectedSetup(labeled) ? labeled : null;
  }

  return null;
}

async function createOcrWorker() {
  const tesseract = await getTesseractModule();
  if (!tesseract?.createWorker) return null;
  const worker = await tesseract.createWorker("eng", 1, {
    logger: () => {},
  });
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789,:.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -",
  });
  return worker;
}

async function recognizeRegionsWithOcr(worker, stripCanvas, regions) {
  if (!worker) return [];
  const output = [];
  for (const region of regions) {
    const boxCanvas = document.createElement("canvas");
    boxCanvas.width = Math.max(1, Math.floor(region.width));
    boxCanvas.height = Math.max(1, Math.floor(region.height));
    const boxContext = boxCanvas.getContext("2d", { willReadFrequently: true });
    boxContext.drawImage(
      stripCanvas,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      boxCanvas.width,
      boxCanvas.height
    );

    const result = await worker.recognize(boxCanvas);
    const text = result?.data?.text || "";
    output.push({
      centerY: region.centerY / stripCanvas.height,
      text,
      label: parseLabelType(text),
      price: extractPriceValue(text),
    });
  }

  return output;
}

function isLikelyMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const touchCapable = typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;
  const ua = String(navigator.userAgent || "").toLowerCase();
  const mobileUa = /android|iphone|ipad|ipod|mobile/.test(ua);
  return touchCapable && mobileUa;
}

async function requestImageFile(onRuntimeEvent) {
  if (typeof document === "undefined" || !document.createElement) return null;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  if (isLikelyMobileDevice()) input.setAttribute("capture", "environment");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  input.style.top = "0";
  document.body.appendChild(input);
  emitScannerEvent(onRuntimeEvent, "file-picker-opened", { mobileCapturePreferred: isLikelyMobileDevice() });
  const file = await new Promise((resolve) => {
    input.addEventListener("change", () => resolve(input.files?.[0] || null), { once: true });
    input.click();
  });
  document.body.removeChild(input);
  return file;
}

async function loadImageFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file);
      return { image: bitmap, cleanup: () => bitmap.close() };
    }
    const img = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = (error) => reject(error);
      node.src = url;
    });
    return { image: img, cleanup: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function runSingleImageScan({ onCandidate, onRuntimeEvent, source }) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const file = await requestImageFile(onRuntimeEvent);
  if (!file) {
    emitScannerEvent(onRuntimeEvent, "timeout/failure reason", { source, reason: "no-image-selected" });
    return { applied: false, source, failureReason: "no-image-selected" };
  }
  emitScannerEvent(onRuntimeEvent, "image-selected", { source, size: file.size, type: file.type || "unknown" });
  const ocrWorker = await createOcrWorker();
  if (ocrWorker) emitScannerEvent(onRuntimeEvent, "OCR init success");
  else emitScannerEvent(onRuntimeEvent, "OCR init failure", { reason: "ocr-worker-unavailable" });

  try {
    const imageAsset = await loadImageFromFile(file);
    try {
      const strip = extractCenterStripFromImage(imageAsset.image, canvas, context);
      if (!strip) {
        emitScannerEvent(onRuntimeEvent, "timeout/failure reason", { source, reason: "image-load-failed" });
        return { applied: false, source, failureReason: "image-load-failed" };
      }
      emitScannerEvent(onRuntimeEvent, "first frame successfully drawn/read", { width: strip.width, height: strip.height });
      const imageData = context.getImageData(0, 0, strip.width, strip.height);
      const regions = detectLabelBands(imageData, strip.width, strip.height);
      emitScannerEvent(onRuntimeEvent, "candidate detection count", { count: regions.length });
      if (regions.length < 3) {
        emitScannerEvent(onRuntimeEvent, "timeout/failure reason", { source, reason: "insufficient-labeled-regions" });
        return { applied: false, source, failureReason: "insufficient-labeled-regions" };
      }
      const ocrRegions = await recognizeRegionsWithOcr(ocrWorker, canvas, regions);
      const candidate = composeCandidateFromRegions(ocrRegions);
      if (candidate && onCandidate(candidate)) {
        return { applied: true, source };
      }
    } finally {
      imageAsset.cleanup?.();
    }
  } finally {
    await ocrWorker?.terminate();
  }

  emitScannerEvent(onRuntimeEvent, "timeout/failure reason", { source, reason: "scan-no-valid-candidate" });
  return { applied: false, source, failureReason: "scan-no-valid-candidate" };
}

function createSetupScannerAdapter() {
  return {
    async start({ onCandidate, onRuntimeEvent }) {
      const source = isLikelyMobileDevice() ? "mobile-photo-picker" : "desktop-image-upload";
      return runSingleImageScan({ onCandidate, onRuntimeEvent, source });
    },
  };
}

export function installSetupScannerAdapter(targetWindow = window) {
  if (!targetWindow) return;
  targetWindow.__HELIX_SETUP_SCANNER__ = createSetupScannerAdapter();
}
