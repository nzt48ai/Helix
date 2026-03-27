import test from "node:test";
import assert from "node:assert/strict";
import { shouldHandleTabPointerUp } from "../src/navInteractions.js";

test("bottom nav pointer-up guard only eagerly handles touch-like inputs", () => {
  assert.equal(shouldHandleTabPointerUp("touch"), true);
  assert.equal(shouldHandleTabPointerUp("pen"), true);
  assert.equal(shouldHandleTabPointerUp("mouse"), false);
  assert.equal(shouldHandleTabPointerUp(""), false);
  assert.equal(shouldHandleTabPointerUp(undefined), false);
});
