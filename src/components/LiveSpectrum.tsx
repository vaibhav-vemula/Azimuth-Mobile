import { memo } from 'react';
import { useReceiver } from '../receiver/useReceiver';
import { SpectrumMarker, SpectrumVisualizer } from './SpectrumVisualizer';

const EMPTY_BINS: number[] = new Array(64).fill(0);

interface Props {
  frequencyHz: number;
  sampleRateHz: number;
  isStreaming: boolean;
  markers?: SpectrumMarker[];
  height?: number;
}

/**
 * The only component that listens to the 30 Hz spectrum stream. Keeping that subscription here means a new
 * frame redraws just the bars; the rest of the screen (buttons, text inputs) is not touched.
 */
function LiveSpectrumComponent({ frequencyHz, sampleRateHz, isStreaming, markers, height }: Props) {
  const bins = useReceiver((s) => s.bins);
  return (
    <SpectrumVisualizer
      bins={isStreaming ? bins : EMPTY_BINS}
      frequencyHz={frequencyHz}
      sampleRateHz={sampleRateHz}
      isStreaming={isStreaming}
      markers={markers}
      height={height}
    />
  );
}

export const LiveSpectrum = memo(LiveSpectrumComponent);
