#include "iq_recorder.h"

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <unistd.h>

namespace azimuth {

namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr int kTapCount = 129;
constexpr double kCutoffHz = 125000.0;
constexpr float kAdcMidpoint = 127.5f;
constexpr float kAdcScale = 1.0f / 127.5f;
constexpr float kInitialGain = 8.0f;
constexpr float kMinGain = 1.0f;
constexpr float kMaxGain = 256.0f;
// Target RMS of the written samples in 8-bit counts: leaves ~5x headroom before clipping.
constexpr float kTargetRmsCounts = 24.0f;
// One block is ~14 ms; alpha of 0.014 gives a gain time constant of about one second.
constexpr float kGainSmoothing = 0.014f;
// Single-pole DC blocker, about 300 Hz corner at 288 kS/s. An LRPT signal is ~115 kHz wide, so this removes
// well under 1% of its power while flattening the receiver's centre spike.
constexpr float kDcBlockAlpha = 0.00654f;
constexpr uint32_t kFlushEveryBlocks = 16;
constexpr size_t kFileBufferBytes = 256 * 1024;

}  // namespace

IqRecorder::IqRecorder()
    : file_(nullptr),
      taps_(kTapCount),
      histI_(kTapCount - 1, 0.0f),
      histQ_(kTapCount - 1, 0.0f),
      phase_(0),
      gain_(kInitialGain),
      dcI_(0.0f),
      dcQ_(0.0f),
      bytesWritten_(0),
      samplesWritten_(0),
      blocksSinceFlush_(0),
      lastError_(0) {
  const double fc = kCutoffHz / kInputRateHz;
  const int last = kTapCount - 1;
  double sum = 0.0;
  for (int i = 0; i < kTapCount; ++i) {
    const double x = i - last / 2.0;
    const double sinc = (std::fabs(x) < 1e-12) ? 2.0 * fc : std::sin(2.0 * kPi * fc * x) / (kPi * x);
    const double window = 0.54 - 0.46 * std::cos(2.0 * kPi * i / last);
    taps_[i] = static_cast<float>(sinc * window);
    sum += taps_[i];
  }
  for (float& tap : taps_) tap = static_cast<float>(tap / sum);
}

IqRecorder::~IqRecorder() { close(); }

bool IqRecorder::open(const char* path) {
  std::lock_guard<std::mutex> guard(mutex_);
  if (file_ != nullptr) {
    std::fclose(file_);
    file_ = nullptr;
  }

  file_ = std::fopen(path, "wb");
  if (file_ == nullptr) {
    lastError_ = errno;
    return false;
  }
  std::setvbuf(file_, nullptr, _IOFBF, kFileBufferBytes);

  std::fill(histI_.begin(), histI_.end(), 0.0f);
  std::fill(histQ_.begin(), histQ_.end(), 0.0f);
  phase_ = 0;
  gain_ = kInitialGain;
  dcI_ = 0.0f;
  dcQ_ = 0.0f;
  bytesWritten_ = 0;
  samplesWritten_ = 0;
  blocksSinceFlush_ = 0;
  lastError_ = 0;
  return true;
}

void IqRecorder::close() {
  std::lock_guard<std::mutex> guard(mutex_);
  if (file_ == nullptr) return;
  std::fflush(file_);
  fsync(fileno(file_));
  std::fclose(file_);
  file_ = nullptr;
}

bool IqRecorder::isOpen() const {
  std::lock_guard<std::mutex> guard(mutex_);
  return file_ != nullptr;
}

bool IqRecorder::process(const uint8_t* iq, size_t byteCount) {
  std::lock_guard<std::mutex> guard(mutex_);
  if (file_ == nullptr) return false;

  const size_t n = byteCount / 2;
  if (n == 0) return true;

  const size_t histLen = taps_.size() - 1;
  workI_.resize(histLen + n);
  workQ_.resize(histLen + n);
  std::copy(histI_.begin(), histI_.end(), workI_.begin());
  std::copy(histQ_.begin(), histQ_.end(), workQ_.begin());
  for (size_t i = 0; i < n; ++i) {
    workI_[histLen + i] = (static_cast<float>(iq[2 * i]) - kAdcMidpoint) * kAdcScale;
    workQ_[histLen + i] = (static_cast<float>(iq[2 * i + 1]) - kAdcMidpoint) * kAdcScale;
  }

  outI_.clear();
  outQ_.clear();
  const float* taps = taps_.data();
  const size_t tapCount = taps_.size();
  size_t m = phase_;
  for (; m < n; m += kDecimation) {
    const float* pi = &workI_[m];
    const float* pq = &workQ_[m];
    float accI = 0.0f;
    float accQ = 0.0f;
    for (size_t k = 0; k < tapCount; ++k) {
      accI += taps[k] * pi[k];
      accQ += taps[k] * pq[k];
    }
    dcI_ += kDcBlockAlpha * (accI - dcI_);
    dcQ_ += kDcBlockAlpha * (accQ - dcQ_);
    outI_.push_back(accI - dcI_);
    outQ_.push_back(accQ - dcQ_);
  }
  phase_ = m - n;

  std::copy(workI_.begin() + n, workI_.begin() + n + histLen, histI_.begin());
  std::copy(workQ_.begin() + n, workQ_.begin() + n + histLen, histQ_.begin());

  const size_t count = outI_.size();
  if (count == 0) return true;

  out_.resize(count * 2);
  const float scale = gain_ * 127.0f;
  double energy = 0.0;
  for (size_t i = 0; i < count; ++i) {
    energy += static_cast<double>(outI_[i]) * outI_[i] + static_cast<double>(outQ_[i]) * outQ_[i];
    const float i8 = std::min(127.0f, std::max(-127.0f, std::nearbyint(outI_[i] * scale)));
    const float q8 = std::min(127.0f, std::max(-127.0f, std::nearbyint(outQ_[i] * scale)));
    out_[2 * i] = static_cast<int8_t>(i8);
    out_[2 * i + 1] = static_cast<int8_t>(q8);
  }

  // Per-component RMS of the (pre-gain) block drives the slow gain adaptation.
  const float rms = static_cast<float>(std::sqrt(energy / (2.0 * static_cast<double>(count))));
  if (rms > 1e-7f) {
    const float desired = std::min(kMaxGain, std::max(kMinGain, (kTargetRmsCounts / 127.0f) / rms));
    gain_ += (desired - gain_) * kGainSmoothing;
  }

  const size_t bytes = out_.size();
  if (std::fwrite(out_.data(), 1, bytes, file_) != bytes) {
    lastError_ = errno != 0 ? errno : EIO;
    std::fclose(file_);
    file_ = nullptr;
    return false;
  }
  bytesWritten_ += bytes;
  samplesWritten_ += count;

  if (++blocksSinceFlush_ >= kFlushEveryBlocks) {
    blocksSinceFlush_ = 0;
    if (std::fflush(file_) != 0) {
      lastError_ = errno != 0 ? errno : EIO;
      std::fclose(file_);
      file_ = nullptr;
      return false;
    }
  }
  return true;
}

uint64_t IqRecorder::bytesWritten() const {
  std::lock_guard<std::mutex> guard(mutex_);
  return bytesWritten_;
}

uint64_t IqRecorder::samplesWritten() const {
  std::lock_guard<std::mutex> guard(mutex_);
  return samplesWritten_;
}

int IqRecorder::lastError() const {
  std::lock_guard<std::mutex> guard(mutex_);
  return lastError_;
}

float IqRecorder::gain() const {
  std::lock_guard<std::mutex> guard(mutex_);
  return gain_;
}

}  // namespace azimuth
