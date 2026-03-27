import { resolveTabFromHash } from "./appState.js";

export const SCREEN_COMPONENT_BY_TAB = {
  position: "PositionScreen",
  compound: "CompoundScreen",
  share: "ShareScreen",
  dashboard: "DashboardScreen",
  journal: "JournalScreen",
};

export function resolveTabRoute(hashValue = "") {
  const activeTab = resolveTabFromHash(hashValue);
  return {
    activeTab,
    canonicalHash: `#${activeTab}`,
  };
}

export function syncTabStateFromHash(currentActiveTab, hashValue = "") {
  const { activeTab } = resolveTabRoute(hashValue);
  return currentActiveTab === activeTab ? currentActiveTab : activeTab;
}

export function resolveScreenComponentName(activeTab) {
  return SCREEN_COMPONENT_BY_TAB[activeTab] || SCREEN_COMPONENT_BY_TAB.share;
}
