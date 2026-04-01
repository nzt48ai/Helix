import test from "node:test";
import assert from "node:assert/strict";
import { hasStableDetections, normalizeDetectedSetup, parseScannedPrice } from "../src/setupScan.js";

test("parseScannedPrice supports comma and arbitrary decimal precision", () => {
  assert.equal(parseScannedPrice("23815"), "23815");
  assert.equal(parseScannedPrice("23,815"), "23,815");
  assert.equal(parseScannedPrice("23,815.5"), "23,815.5");
  assert.equal(parseScannedPrice("23,815.5000"), "23,815.5000");
});

test("parseScannedPrice rejects timer-like values", () => {
  assert.equal(parseScannedPrice("23:15"), null);
});

test("normalizeDetectedSetup requires coherent long or short structure", () => {
  assert.deepEqual(normalizeDetectedSetup({ entry: "100", stop: "95", target: "112" })?.direction, "long");
  assert.deepEqual(normalizeDetectedSetup({ entry: "100", stop: "105", target: "92" })?.direction, "short");
  assert.equal(normalizeDetectedSetup({ entry: "100", stop: "98", target: "96" }), null);
});

test("hasStableDetections only resolves after required matching frames", () => {
  const first = hasStableDetections([], { entry: "100", stop: "95", target: "110" }, 3);
  assert.equal(first?.stable, null);
  const second = hasStableDetections(first.nextHistory, { entry: "100", stop: "95", target: "110" }, 3);
  assert.equal(second?.stable, null);
  const third = hasStableDetections(second.nextHistory, { entry: "100", stop: "95", target: "110" }, 3);
  assert.ok(third?.stable);
});

