package expo.modules.rtlsdr

/**
 * JNI bridge to the bundled RTL-SDR Blog librtlsdr fork (see src/main/cpp).
 * All functions taking a handle expect a value returned by [nativeOpen]; negative return
 * values are libusb / errno error codes.
 */
internal object RtlSdrNative {
  /** Largest PCM block [nativeReadBlock] can produce; size the audio array to at least this. */
  const val MAX_AUDIO_SAMPLES = 640

  init {
    System.loadLibrary("rtlsdr_jni")
  }

  /** Opens the receiver from a UsbDeviceConnection file descriptor. Returns a small positive handle id, or a negative error. */
  external fun nativeOpen(fd: Int): Long

  external fun nativeClose(handle: Long)

  /** Human readable model, for example "RTL-SDR Blog V4 (R828D)". */
  external fun nativeDescribe(handle: Long): String?

  external fun nativeSetCenterFrequency(handle: Long, frequencyHz: Long): Int

  /** Sets the sample rate (call only while no reader is running). Returns the rate actually applied, or a negative error. */
  external fun nativeSetSampleRate(handle: Long, rateHz: Int): Int

  /** [tenthsDb] < 0 selects the tuner's automatic gain; otherwise the nearest supported gain is applied and returned. */
  external fun nativeSetGain(handle: Long, tenthsDb: Int): Int

  /** Supported tuner gains in tenths of a dB, ascending. */
  external fun nativeGetGains(handle: Long): IntArray?

  external fun nativeSetBiasTee(handle: Long, on: Boolean): Int

  /** Starts writing a decimated .cs8 recording (needs the 2.304 MS/s rate). Returns 0 or a negative errno. */
  external fun nativeStartRecording(handle: Long, path: String): Int

  /** [bytesWritten, samplesWritten, droppedBlocks, lastErrno] for the current or last recording. */
  external fun nativeGetRecordingStats(handle: Long): LongArray?

  /** Closes the recording file and returns its final stats (same layout as [nativeGetRecordingStats]). */
  external fun nativeStopRecording(handle: Long): LongArray?

  /**
   * Starts the background USB reader, which keeps 16 transfers queued so no IQ data is lost while
   * blocks are being processed. Returns 0 or a negative error.
   */
  external fun nativeStartReader(handle: Long): Int

  /** Stops the USB reader; a [nativeReadBlock] waiting on it returns promptly with a negative code. */
  external fun nativeStopReader(handle: Long)

  /**
   * Waits for the next queued 13.3 ms IQ block (requires [nativeStartReader]), then fills [bins] (size >= 64) with 0..1 power bins. When
   * [demodulate] is true it also writes mono 48 kHz FM audio into [audio] (size >= [MAX_AUDIO_SAMPLES]).
   * Returns the number of PCM samples written, or a negative error code.
   */
  external fun nativeReadBlock(
    handle: Long,
    bins: FloatArray,
    /** [rmsOfFullScale, fractionOfSamplesOnTheConverterRails], measured on the raw IQ block. */
    stats: FloatArray,
    floorDb: Float,
    ceilDb: Float,
    audio: ShortArray,
    demodulate: Boolean
  ): Int
}
