import test from "node:test";
import assert from "node:assert/strict";
import { createHapticTrigger } from "../src/haptics.js";

test("uses Capacitor Haptics with LIGHT impact for subtle interactions", async () => {
  const calls = [];
  const trigger = createHapticTrigger({
    importModule: async () => ({
      Haptics: {
        impact: async ({ style }) => {
          calls.push(style);
        },
      },
      ImpactStyle: {
        Light: "LIGHT",
        Medium: "MEDIUM",
      },
    }),
  });

  trigger("light");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, ["LIGHT"]);
});

test("falls back to navigator.vibrate(10) when Capacitor Haptics is unavailable", async () => {
  const vibrateCalls = [];
  const trigger = createHapticTrigger({
    importModule: async () => null,
    navigator: {
      vibrate: (duration) => {
        vibrateCalls.push(duration);
        return true;
      },
    },
  });

  trigger("light");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(vibrateCalls, [10]);
});

