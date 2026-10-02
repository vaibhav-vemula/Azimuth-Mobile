#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace azimuth {

/**
 * Converts interleaved unsigned 8-bit IQ (the RTL2832U wire format) into a fixed number of
 * normalized power bins.
 *
 * Pipeline: Hann window -> 1024-point complex FFT -> |X|^2 averaged over every full segment in
 * the block -> fftshift (DC in the centre, lowest frequency first) -> DC-spike suppression ->
 * grouping into kOutputBins -> dBFS -> clamp to [floorDb, ceilDb] -> scaled to 0..1.
 *
 * Power is normalized so that a full-scale complex tone reads 0 dBFS in its peak bin.
 */
class SpectrumAnalyzer {
 public:
  static constexpr int kFftSize = 1024;
  static constexpr int kOutputBins = 64;
  static constexpr int kBinsPerOutput = kFftSize / kOutputBins;

  SpectrumAnalyzer();

  /** Returns false when byteCount does not contain at least one full FFT segment. */
  bool process(const uint8_t* iq, size_t byteCount, float floorDb, float ceilDb, float* out);

 private:
  void fft(float* re, float* im) const;

  std::vector<float> window_;
  std::vector<float> cosTable_;
  std::vector<float> sinTable_;
  std::vector<uint16_t> bitReverse_;
  std::vector<float> re_;
  std::vector<float> im_;
  std::vector<float> psd_;
  float windowSum_;
};

}  // namespace azimuth
