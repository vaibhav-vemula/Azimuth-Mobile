export const SPECTRUM_BIN_COUNT = 64;
/** Horizontal size of the drawing; the SVG scales it to the card width. */
export const SPECTRUM_VIEW_WIDTH = 640;

const SLOT = SPECTRUM_VIEW_WIDTH / SPECTRUM_BIN_COUNT;
const BAR_WIDTH = SLOT - 2;
const MIN_BAR_HEIGHT = 1.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** One SVG path containing a bar per bin, so a whole spectrum frame is a single native element to update. */
export function buildBarsPath(bins: number[], viewHeight: number): string {
  const parts: string[] = [];
  for (let i = 0; i < SPECTRUM_BIN_COUNT; i += 1) {
    const height = Math.max(MIN_BAR_HEIGHT, clamp01(bins[i] ?? 0) * viewHeight);
    const x = (i * SLOT + 1).toFixed(1);
    const top = (viewHeight - height).toFixed(1);
    parts.push(`M${x} ${viewHeight}V${top}h${BAR_WIDTH.toFixed(1)}V${viewHeight}Z`);
  }
  return parts.join('');
}
