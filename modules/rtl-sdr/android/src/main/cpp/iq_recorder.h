#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <mutex>
#include <string>
#include <vector>

namespace azimuth {

/**
 * Writes a decimated baseband recording as headerless interleaved signed 8-bit I/Q (".cs8").
 *
 * Input is the dongle's native unsigned 8-bit IQ at 2.304 MS/s. A 129-tap low-pass (125 kHz) and
 * a decimation by 8 bring it to 288 kS/s, which still comfortably contains a 72 kbaud LRPT signal
 * (about 140 kHz wide) and Doppler. Weak satellite signals sit at noise level, so the filtered
 * samples have their DC offset removed (the dongle's centre spur sits right on an LRPT signal tuned to
 * the middle of the band) and are scaled by a slow automatic gain (about 1 s time constant) before rounding to 8 bits;
 * without it the quantisation would remove most of the signal. Decoders such as SatDump apply
 * their own AGC, so a slowly varying overall level is harmless.
 */
/** How [IqRecorder] stores the stream. */
enum class RecordingMode {
  /** 129-tap low-pass, /8 decimation to 288 kS/s, DC blocking and slow level adjustment. Small files. */
  kDecimated,
  /**
   * The dongle's full 2.304 MS/s stream, only converted from unsigned to signed 8-bit. This is what SatDump
   * itself records ("cs8"): every sample, the whole 2.3 MHz of spectrum, nothing filtered or altered.
   */
  kRaw,
};

class IqRecorder {
 public:
  static constexpr int kDecimation = 8;
  static constexpr int kInputRateHz = 2304000;
  static constexpr int kOutputRateHz = kInputRateHz / kDecimation;

  IqRecorder();
  ~IqRecorder();

  IqRecorder(const IqRecorder&) = delete;
  IqRecorder& operator=(const IqRecorder&) = delete;

  /** Creates (truncating) the output file. Returns false and sets lastError() on failure. */
  bool open(const char* path, RecordingMode mode = RecordingMode::kDecimated);

  /** Flushes, syncs and closes. Safe to call when not open. */
  void close();

  bool isOpen() const;

  /**
   * Filters, decimates and appends one block. Returns false if the write failed (for example the
   * storage is full); the file is closed in that case and lastError() holds the errno.
   */
  bool process(const uint8_t* iq, size_t byteCount);

  uint64_t bytesWritten() const;
  uint64_t samplesWritten() const;
  int lastError() const;
  float gain() const;

 private:
  /** Writes out_ and updates the counters and flush schedule. Closes the file and returns false on error. */
  bool writeBlock(size_t bytes, size_t samples);

  mutable std::mutex mutex_;
  std::FILE* file_;
  RecordingMode mode_;
  std::vector<float> taps_;
  std::vector<float> histI_;
  std::vector<float> histQ_;
  std::vector<float> workI_;
  std::vector<float> workQ_;
  std::vector<float> outI_;
  std::vector<float> outQ_;
  std::vector<int8_t> out_;
  size_t phase_;
  float gain_;
  float dcI_;
  float dcQ_;
  uint64_t bytesWritten_;
  uint64_t samplesWritten_;
  uint32_t blocksSinceFlush_;
  int lastError_;
};

}  // namespace azimuth
