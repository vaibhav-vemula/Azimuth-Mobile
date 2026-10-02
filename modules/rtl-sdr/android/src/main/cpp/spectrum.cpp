#include "spectrum.h"

#include <algorithm>
#include <cmath>

namespace azimuth {

namespace {
constexpr float kPi = 3.14159265358979323846f;
constexpr float kAdcMidpoint = 127.5f;
constexpr float kAdcScale = 1.0f / 127.5f;
constexpr float kPowerEpsilon = 1e-12f;
}  // namespace

SpectrumAnalyzer::SpectrumAnalyzer()
    : window_(kFftSize),
      cosTable_(kFftSize / 2),
      sinTable_(kFftSize / 2),
      bitReverse_(kFftSize),
      re_(kFftSize),
      im_(kFftSize),
      psd_(kFftSize),
      windowSum_(0.0f) {
  for (int i = 0; i < kFftSize; ++i) {
    window_[i] = 0.5f - 0.5f * std::cos(2.0f * kPi * i / (kFftSize - 1));
    windowSum_ += window_[i];
  }

  for (int i = 0; i < kFftSize / 2; ++i) {
    const float angle = -2.0f * kPi * i / kFftSize;
    cosTable_[i] = std::cos(angle);
    sinTable_[i] = std::sin(angle);
  }

  int bits = 0;
  while ((1 << bits) < kFftSize) ++bits;
  for (int i = 0; i < kFftSize; ++i) {
    int reversed = 0;
    for (int b = 0; b < bits; ++b) {
      if (i & (1 << b)) reversed |= 1 << (bits - 1 - b);
    }
    bitReverse_[i] = static_cast<uint16_t>(reversed);
  }
}

void SpectrumAnalyzer::fft(float* re, float* im) const {
  for (int i = 0; i < kFftSize; ++i) {
    const int j = bitReverse_[i];
    if (j > i) {
      std::swap(re[i], re[j]);
      std::swap(im[i], im[j]);
    }
  }

  for (int size = 2; size <= kFftSize; size <<= 1) {
    const int half = size >> 1;
    const int step = kFftSize / size;
    for (int start = 0; start < kFftSize; start += size) {
      for (int k = 0; k < half; ++k) {
        const float wr = cosTable_[k * step];
        const float wi = sinTable_[k * step];
        const int a = start + k;
        const int b = a + half;
        const float tr = re[b] * wr - im[b] * wi;
        const float ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
}

bool SpectrumAnalyzer::process(const uint8_t* iq, size_t byteCount, float floorDb, float ceilDb,
                               float* out) {
  const size_t segmentBytes = static_cast<size_t>(kFftSize) * 2;
  const size_t segments = byteCount / segmentBytes;
  if (segments == 0) return false;

  std::fill(psd_.begin(), psd_.end(), 0.0f);

  for (size_t s = 0; s < segments; ++s) {
    const uint8_t* src = iq + s * segmentBytes;
    for (int i = 0; i < kFftSize; ++i) {
      re_[i] = (static_cast<float>(src[2 * i]) - kAdcMidpoint) * kAdcScale * window_[i];
      im_[i] = (static_cast<float>(src[2 * i + 1]) - kAdcMidpoint) * kAdcScale * window_[i];
    }
    fft(re_.data(), im_.data());
    for (int k = 0; k < kFftSize; ++k) {
      const int shifted = (k + kFftSize / 2) & (kFftSize - 1);
      psd_[shifted] += re_[k] * re_[k] + im_[k] * im_[k];
    }
  }

  const float scale = 1.0f / (static_cast<float>(segments) * windowSum_ * windowSum_);
  for (int k = 0; k < kFftSize; ++k) psd_[k] *= scale;

  const int dc = kFftSize / 2;
  const float left = psd_[dc - 2];
  const float right = psd_[dc + 2];
  psd_[dc - 1] = left + (right - left) * 0.25f;
  psd_[dc] = left + (right - left) * 0.5f;
  psd_[dc + 1] = left + (right - left) * 0.75f;

  const float range = std::max(1.0f, ceilDb - floorDb);
  for (int o = 0; o < kOutputBins; ++o) {
    float sum = 0.0f;
    const int base = o * kBinsPerOutput;
    for (int k = 0; k < kBinsPerOutput; ++k) sum += psd_[base + k];
    const float mean = sum / kBinsPerOutput;
    const float db = 10.0f * std::log10(mean + kPowerEpsilon);
    out[o] = std::min(1.0f, std::max(0.0f, (db - floorDb) / range));
  }
  return true;
}

}  // namespace azimuth
