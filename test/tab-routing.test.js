import test from "node:test";
import assert from "node:assert/strict";
import { resolveTabRoute, resolveScreenComponentName, syncTabStateFromHash } from "../src/tabRouting.js";

test("tab routing keeps activeTab and resolved hash synchronized", () => {
  const staleState = syncTabStateFromHash("dashboard", "#journal");
  assert.equal(staleState, "journal");

  const route = resolveTabRoute("#journal");
  assert.equal(route.activeTab, "journal");
  assert.equal(route.canonicalHash, "#journal");
});

test("screen resolution always matches selected tab", () => {
  assert.equal(resolveScreenComponentName("position"), "PositionScreen");
  assert.equal(resolveScreenComponentName("compound"), "CompoundScreen");
  assert.equal(resolveScreenComponentName("dashboard"), "DashboardScreen");
  assert.equal(resolveScreenComponentName("journal"), "JournalScreen");
  assert.equal(resolveScreenComponentName("share"), "ShareScreen");
});

test("tab route canonicalizes unknown hash values to the default tab", () => {
  const route = resolveTabRoute("#unknown");
  assert.equal(route.activeTab, "position");
  assert.equal(route.canonicalHash, "#position");
});
