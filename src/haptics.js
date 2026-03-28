const CAPACITOR_HAPTICS_MODULE = "@capacitor/haptics";
const IMPACT_STYLE = {
  light: "LIGHT",
  medium: "MEDIUM",
};

let defaultCapacitorHapticsPromise;

function getNavigator(navigatorOverride) {
  if (navigatorOverride) return navigatorOverride;
  if (typeof globalThis === "undefined") return undefined;
  return globalThis.navigator;
}

function getCapacitor(capacitorOverride) {
  if (capacitorOverride) return capacitorOverride;
  if (typeof globalThis === "undefined") return undefined;
  return globalThis.Capacitor;
}

async function loadCapacitorHaptics(importModule, { cache = true } = {}) {
  if (!cache) {
    return importModule(CAPACITOR_HAPTICS_MODULE).catch(() => null);
  }
  if (!defaultCapacitorHapticsPromise) {
    defaultCapacitorHapticsPromise = importModule(CAPACITOR_HAPTICS_MODULE).catch(() => null);
  }
  return defaultCapacitorHapticsPromise;
}

function getGlobalCapacitorHaptics(capacitorOverride) {
  const capacitor = getCapacitor(capacitorOverride);
  return capacitor?.Plugins?.Haptics;
}

async function runCapacitorHaptic(style, options = {}) {
  const globalPlugin = getGlobalCapacitorHaptics(options.capacitor);
  if (globalPlugin?.impact) {
    await globalPlugin.impact({ style: IMPACT_STYLE[style] ?? IMPACT_STYLE.light });
    return true;
  }

  const hasCustomImporter = typeof options.importModule === "function";
  const importModule = options.importModule ?? ((specifier) => import(/* @vite-ignore */ specifier));
  const hapticsModule = await loadCapacitorHaptics(importModule, { cache: !hasCustomImporter });
  if (!hapticsModule?.Haptics?.impact) return false;

  const resolvedStyle = style === "medium"
    ? hapticsModule.ImpactStyle?.Medium ?? IMPACT_STYLE.medium
    : hapticsModule.ImpactStyle?.Light ?? IMPACT_STYLE.light;

  await hapticsModule.Haptics.impact({ style: resolvedStyle });
  return true;
}

function runVibrateFallback(options = {}) {
  const navigatorRef = getNavigator(options.navigator);
  if (!navigatorRef?.vibrate) return false;
  return navigatorRef.vibrate(10) === true;
}

export function createHapticTrigger(overrides = {}) {
  return (style = "light") => {
    void (async () => {
      try {
        const didRunCapacitor = await runCapacitorHaptic(style, overrides);
        if (didRunCapacitor) return;
      } catch {
        // fall through to vibration fallback
      }

      try {
        runVibrateFallback(overrides);
      } catch {
        // intentionally swallow to avoid impacting interaction handlers
      }
    })();
  };
}

const triggerHaptic = createHapticTrigger();

export function triggerLightHaptic() {
  triggerHaptic("light");
}

export function triggerMediumHaptic() {
  triggerHaptic("medium");
}
