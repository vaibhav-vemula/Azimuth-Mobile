#include "fm_demod.h"

#include <algorithm>
#include <cmath>

namespace azimuth {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr float kAdcMidpoint = 127.5f;
constexpr float kAdcScale = 1.0f / 127.5f;
constexpr int kChannelTaps = 127;
constexpr int kAudioTaps = 129;
constexpr double kChannelCutoffHz = 110000.0;
constexpr double kAudioCutoffHz = 16000.0;
constexpr float kDeviationHz = 75000.0f;
constexpr float kOutputLevel = 0.8f * 32767.0f;

std::vector<float> designLowPass(int taps, double cutoffHz, double sampleRateHz) {
  std::vector<float> h(taps);
  const double fc = cutoffHz / sampleRateHz;
  const int last = taps - 1;
  double sum = 0.0;
  for (int i = 0; i < taps; ++i) {
    const double x = i - last / 2.0;
    const double sinc = (std::fabs(x) < 1e-12) ? 2.0 * fc : std::sin(2.0 * kPi * fc * x) / (kPi * x);
    const double window = 0.54 - 0.46 * std::cos(2.0 * kPi * i / last);
    h[i] = static_cast<float>(sinc * window);
    sum += h[i];
  }
  for (float& tap : h) tap = static_cast<float>(tap / sum);
  return h;
}

}  // namespace

FmDemodulator::FmDemodulator(float deemphasisSeconds)
    : channelTaps_(designLowPass(kChannelTaps, kChannelCutoffHz, kInputRateHz)),
      audioTaps_(designLowPass(kAudioTaps, kAudioCutoffHz, kQuadratureRateHz)),
      channelHistI_(kChannelTaps - 1, 0.0f),
      channelHistQ_(kChannelTaps - 1, 0.0f),
      audioHist_(kAudioTaps - 1, 0.0f),
      channelPhase_(0),
      audioPhase_(0),
      prevI_(1.0f),
      prevQ_(0.0f),
      deemphasisState_(0.0f),
      deemphasisAlpha_(1.0f - std::exp(-1.0f / (static_cast<float>(kAudioRateHz) * deemphasisSeconds))) {}

void FmDemodulator::reset() {
  std::fill(channelHistI_.begin(), channelHistI_.end(), 0.0f);
  std::fill(channelHistQ_.begin(), channelHistQ_.end(), 0.0f);
  std::fill(audioHist_.begin(), audioHist_.end(), 0.0f);
  channelPhase_ = 0;
  audioPhase_ = 0;
  prevI_ = 1.0f;
  prevQ_ = 0.0f;
  deemphasisState_ = 0.0f;
}

size_t FmDemodulator::process(const uint8_t* iq, size_t byteCount, int16_t* out, size_t maxOut) {
  const size_t n = byteCount / 2;
  if (n == 0) return 0;

  const size_t histLen = channelTaps_.size() - 1;
  workI_.resize(histLen + n);
  workQ_.resize(histLen + n);
  std::copy(channelHistI_.begin(), channelHistI_.end(), workI_.begin());
  std::copy(channelHistQ_.begin(), channelHistQ_.end(), workQ_.begin());
  for (size_t i = 0; i < n; ++i) {
    workI_[histLen + i] = (static_cast<float>(iq[2 * i]) - kAdcMidpoint) * kAdcScale;
    workQ_[histLen + i] = (static_cast<float>(iq[2 * i + 1]) - kAdcMidpoint) * kAdcScale;
  }

  const float discriminatorGain =
      static_cast<float>(kQuadratureRateHz) / (2.0f * static_cast<float>(kPi) * kDeviationHz);
  const size_t channelTaps = channelTaps_.size();
  const float* taps = channelTaps_.data();

  discriminator_.clear();
  size_t m = channelPhase_;
  for (; m < n; m += kChannelDecimation) {
    const float* pi = &workI_[m];
    const float* pq = &workQ_[m];
    float accI = 0.0f;
    float accQ = 0.0f;
    for (size_t k = 0; k < channelTaps; ++k) {
      accI += taps[k] * pi[k];
      accQ += taps[k] * pq[k];
    }
    const float re = accI * prevI_ + accQ * prevQ_;
    const float im = accQ * prevI_ - accI * prevQ_;
    discriminator_.push_back(std::atan2(im, re) * discriminatorGain);
    prevI_ = accI;
    prevQ_ = accQ;
  }
  channelPhase_ = m - n;

  std::copy(workI_.begin() + n, workI_.begin() + n + histLen, channelHistI_.begin());
  std::copy(workQ_.begin() + n, workQ_.begin() + n + histLen, channelHistQ_.begin());

  const size_t audioHistLen = audioTaps_.size() - 1;
  const size_t d = discriminator_.size();
  audioWork_.resize(audioHistLen + d);
  std::copy(audioHist_.begin(), audioHist_.end(), audioWork_.begin());
  std::copy(discriminator_.begin(), discriminator_.end(), audioWork_.begin() + audioHistLen);

  const size_t audioTapCount = audioTaps_.size();
  const float* aTaps = audioTaps_.data();
  size_t written = 0;
  size_t a = audioPhase_;
  for (; a < d; a += kAudioDecimation) {
    const float* p = &audioWork_[a];
    float acc = 0.0f;
    for (size_t k = 0; k < audioTapCount; ++k) acc += aTaps[k] * p[k];

    deemphasisState_ += deemphasisAlpha_ * (acc - deemphasisState_);

    if (written < maxOut) {
      const float scaled = std::min(32767.0f, std::max(-32768.0f, deemphasisState_ * kOutputLevel));
      out[written++] = static_cast<int16_t>(scaled);
    }
  }
  audioPhase_ = a - d;

  std::copy(audioWork_.begin() + d, audioWork_.begin() + d + audioHistLen, audioHist_.begin());
  return written;
}

}  // namespace azimuth
