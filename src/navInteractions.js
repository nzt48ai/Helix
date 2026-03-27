const TOUCH_INPUT_TYPES = new Set(["touch", "pen"]);

export function shouldHandleTabPointerUp(pointerType = "") {
  return TOUCH_INPUT_TYPES.has(String(pointerType || "").toLowerCase());
}
