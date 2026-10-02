#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>

namespace azimuth {

/**
 * Mono wideband-FM demodulator for interleaved unsigned 8-bit IQ sampled at 2.4 MS/s.
 *
 * Chain: 127-tap low-pass (110 kHz) and /10 -> quadrature discriminator at 240 kS/s ->
 * 129-tap low-pass (16 kHz, removes the 19 kHz stereo pilot) and /5 -> single-pole de-emphasis
 * -> 16-bit PCM at 48 kHz. State is carried across calls, so blocks may be fed back to back.
 */
class FmDemodulator {
 public:
  static constexpr int kInputRateHz = 2400000;
  static constexpr int kQuadratureRateHz = 240000;
  static constexpr int kAudioRateHz = 48000;
  static constexpr int kChannelDecimation = kInputRateHz / kQuadratureRateHz;
  static constexpr int kAudioDecimation = kQuadratureRateHz / kAudioRateHz;

  /** 75e-6 for North America / South Korea, 50e-6 for most other regions. */
  explicit FmDemodulator(float deemphasisSeconds = 75e-6f);

  void reset();

  /** Returns the number of PCM samples written to [out] (never more than [maxOut]). */
  size_t process(const uint8_t* iq, size_t byteCount, int16_t* out, size_t maxOut);

 private:
  std::vector<float> channelTaps_;
  std::vector<float> audioTaps_;

  std::vector<float> channelHistI_;
  std::vector<float> channelHistQ_;
  std::vector<float> audioHist_;

  std::vector<float> workI_;
  std::vector<float> workQ_;
  std::vector<float> discriminator_;
  std::vector<float> audioWork_;

  size_t channelPhase_;
  size_t audioPhase_;
  float prevI_;
  float prevQ_;
  float deemphasisState_;
  float deemphasisAlpha_;
};

}  // namespace azimuth
