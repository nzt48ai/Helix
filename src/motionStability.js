function clampIndex(index, maxIndex) {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(maxIndex, index));
}

export function getActiveIndex(values = [], activeValue) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const nextIndex = values.findIndex((value) => value === activeValue);
  if (nextIndex < 0) return 0;
  return clampIndex(nextIndex, values.length - 1);
}

export function getSegmentedIndicatorStyle(itemCount = 1, activeIndex = 0, gutterPx = 0) {
  const safeItemCount = Math.max(1, Number(itemCount) || 1);
  const safeIndex = clampIndex(Number(activeIndex) || 0, safeItemCount - 1);
  const safeGutter = Math.max(0, Number(gutterPx) || 0);

  return {
    width: `calc((100% - ${safeGutter * (safeItemCount - 1)}px) / ${safeItemCount})`,
    x: `calc(${safeIndex * 100}% + ${safeIndex * safeGutter}px)`,
  };
}
