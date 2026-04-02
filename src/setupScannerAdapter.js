import { normalizeDetectedSetup, parseScannedPrice } from "./setupScan";

const FRAME_INTERVAL_MS = 260;
const MAX_SCAN_TIME_MS = 18000;
const CENTER_STRIP_WIDTH_RATIO = 0.2;
const CENTER_STRIP_HEIGHT_RATIO = 0.9;
const MIN_LABEL_PIXEL_COUNT = 140;

function getMediaDevices() {
  return typeof navigator !== "undefined" ? navigator.mediaDevices : null;
}

function hasNativeBridge() {
  const bridge =
    window.__HELIX_NATIVE_SETUP_SCANNER__ ||
    window.HelixNativeSetupScanner ||
    window.helixNativeSetupScanner ||
    window.__HELIX_BRIDGE__?.setupScanner;
  return bridge && typeof bridge.start === "function" ? bridge : null;
}

function canUseCameraScan() {
  const devices = getMediaDevices();
  return !!devices && typeof devices.getUserMedia === "function";
}

function canUseDisplayCapture() {
  const devices = getMediaDevices();
  return !!devices && typeof devices.getDisplayMedia === "function";
}

let ocrModulePromise = null;
async function getTesseractModule() {
  if (ocrModulePromise) return ocrModulePromise;
  ocrModulePromise = import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js").catch(() => null);
  return ocrModulePromise;
}

function createVideoElement(stream) {
  const video = document.createElement("video");
  video.setAttribute("playsinline", "true");
  video.muted = true;
  video.srcObject = stream;
  return video;
}

function stopStream(stream) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
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

function extractCenterStripFrame(video, canvas, context) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  const stripWidth = Math.max(48, Math.floor(w * CENTER_STRIP_WIDTH_RATIO));
  const stripHeight = Math.max(64, Math.floor(h * CENTER_STRIP_HEIGHT_RATIO));
  const x = Math.floor((w - stripWidth) / 2);
  const y = Math.floor((h - stripHeight) / 2);

  canvas.width = stripWidth;
  canvas.height = stripHeight;
  context.drawImage(video, x, y, stripWidth, stripHeight, 0, 0, stripWidth, stripHeight);
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

async function runBrowserStreamScan({ stream, onCandidate }) {
  const video = createVideoElement(stream);
  await video.play();

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const deadline = Date.now() + MAX_SCAN_TIME_MS;
  const ocrWorker = await createOcrWorker();

  try {
    while (Date.now() < deadline) {
      const strip = extractCenterStripFrame(video, canvas, context);
      if (strip) {
        const imageData = context.getImageData(0, 0, strip.width, strip.height);
        const regions = detectLabelBands(imageData, strip.width, strip.height);
        if (regions.length >= 3) {
          const ocrRegions = await recognizeRegionsWithOcr(ocrWorker, canvas, regions);
          const candidate = composeCandidateFromRegions(ocrRegions);
          if (candidate && onCandidate(candidate)) {
            return { applied: true, source: "browser" };
          }
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, FRAME_INTERVAL_MS));
    }
  } finally {
    await ocrWorker?.terminate();
    video.pause();
    video.srcObject = null;
  }

  return { applied: false, source: "browser" };
}

async function tryBrowserCameraPath(options) {
  const devices = getMediaDevices();
  if (!devices) return null;

  const stream = await devices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
    audio: false,
  });

  try {
    return await runBrowserStreamScan({ stream, onCandidate: options.onCandidate });
  } finally {
    stopStream(stream);
  }
}

async function tryDisplayCapturePath(options) {
  const devices = getMediaDevices();
  if (!devices) return null;

  const stream = await devices.getDisplayMedia({
    video: {
      displaySurface: "browser",
      logicalSurface: true,
      cursor: "never",
    },
    audio: false,
  });

  try {
    return await runBrowserStreamScan({ stream, onCandidate: options.onCandidate });
  } finally {
    stopStream(stream);
  }
}

function createSetupScannerAdapter() {
  return {
    async start({ onCandidate }) {
      const bridge = hasNativeBridge();
      if (bridge) {
        const result = await bridge.start({ region: "center-strip", onCandidate });
        return result && typeof result === "object" ? result : { applied: false, source: "native" };
      }

      if (canUseCameraScan()) {
        try {
          const cameraResult = await tryBrowserCameraPath({ onCandidate });
          if (cameraResult?.applied) return cameraResult;
        } catch {
          // Fall through to screen capture.
        }
      }

      if (canUseDisplayCapture()) {
        try {
          const captureResult = await tryDisplayCapturePath({ onCandidate });
          if (captureResult?.applied) return captureResult;
        } catch {
          // Fall through to graceful failure.
        }
      }

      return { applied: false, source: "none" };
    },
  };
}

export function installSetupScannerAdapter(targetWindow = window) {
  if (!targetWindow) return;
  targetWindow.__HELIX_SETUP_SCANNER__ = createSetupScannerAdapter();
}
