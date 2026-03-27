import test from "node:test";
import assert from "node:assert/strict";
import { getActiveIndex, getSegmentedIndicatorStyle } from "../src/motionStability.js";

test("getActiveIndex returns deterministic, clamped indexes", () => {
  assert.equal(getActiveIndex(["a", "b", "c"], "b"), 1);
  assert.equal(getActiveIndex(["a", "b", "c"], "missing"), 0);
  assert.equal(getActiveIndex([], "a"), 0);
});

test("getSegmentedIndicatorStyle computes stable spring target positions", () => {
  assert.deepEqual(getSegmentedIndicatorStyle(5, 2, 1), {
    width: "calc((100% - 4px) / 5)",
    x: "calc(200% + 2px)",
  });
  assert.deepEqual(getSegmentedIndicatorStyle(0, 99, -4), {
    width: "calc((100% - 0px) / 1)",
    x: "calc(0% + 0px)",
  });
});
