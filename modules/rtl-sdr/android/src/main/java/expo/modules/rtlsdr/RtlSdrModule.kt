package expo.modules.rtlsdr

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.MediaStore
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Azimuth RTL-SDR bridge.
 *
 * Android owns USB discovery and permission; the granted [UsbDeviceConnection] file descriptor is
 * handed to the bundled RTL-SDR Blog librtlsdr fork (V4 / R828D HF upconverter aware) through
 * [RtlSdrNative]. A background reader keeps USB transfers queued, the stream thread pulls blocks
 * from it, the native side runs the FFT (and optionally FM demodulation or a baseband recorder),
 * and 64 normalized bins are emitted to JS at up to 30 FPS.
 */
class RtlSdrModule : Module() {
  private val lock = Any()

  private var device: UsbDevice? = null
  private var connection: UsbDeviceConnection? = null
  @Volatile private var nativeHandle: Long = 0L
  private var deviceNameText: String? = null
  private var detachReceiver: BroadcastReceiver? = null

  private var pendingDevice: UsbDevice? = null
  private var pendingConnect: Promise? = null
  private var permissionReceiver: BroadcastReceiver? = null

  private val streaming = AtomicBoolean(false)
  private var streamThread: Thread? = null

  @Volatile private var frequencyHz: Double = DEFAULT_FREQUENCY_HZ
  @Volatile private var sampleRateHz: Int = FM_SAMPLE_RATE_HZ
  @Volatile private var currentStatus: String = STATUS_DISCONNECTED
  @Volatile private var audioEnabled: Boolean = false
  @Volatile private var audioVolume: Float = DEFAULT_VOLUME

  // Recording state (guarded by `lock`, except the volatile flag read by the stream thread).
  @Volatile private var recordingActive: Boolean = false
  private var recordingName: String? = null
  private var recordingDirectory: File? = null
  private var recordingStartedAtMs: Long = 0L
  @Volatile private var recordingMaxDurationMs: Long = 0L
  private var lastRecordingError: Int = 0
  private var lastRecordingSummary: Map<String, Any?>? = null

  override fun definition() = ModuleDefinition {
    Name("rtl-sdr")

    Events(EVENT_SIGNAL_DATA, EVENT_STATUS_CHANGE, EVENT_RECORDING_STATUS)

    AsyncFunction("connect") { promise: Promise ->
      connect(promise)
    }

    AsyncFunction("tune") { targetHz: Double ->
      tune(targetHz)
    }

    AsyncFunction("startStream") {
      startStream()
    }

    AsyncFunction("stopStream") {
      stopStream()
    }

    AsyncFunction("disconnect") {
      disconnect()
    }

    AsyncFunction("setAudioEnabled") { enabled: Boolean ->
      audioEnabled = enabled
    }

    AsyncFunction("setVolume") { volume: Double ->
      audioVolume = volume.toFloat().coerceIn(0f, 1f)
    }

    AsyncFunction("setSampleRate") { rateHz: Int ->
      setSampleRate(rateHz)
    }

    AsyncFunction("setGain") { gainDb: Double? ->
      setGain(gainDb)
    }

    AsyncFunction("getGains") {
      getGains()
    }

    AsyncFunction("setBiasTee") { enabled: Boolean ->
      setBiasTee(enabled)
    }

    AsyncFunction("startRecording") { name: String, label: String, maxDurationMs: Double ->
      startRecording(name, label, maxDurationMs.toLong())
    }

    AsyncFunction("stopRecording") {
      stopRecording()
    }

    AsyncFunction("writeRecordingMetadata") { name: String, json: String ->
      writeRecordingMetadata(name, json)
    }

    AsyncFunction("listRecordings") {
      listRecordings()
    }

    AsyncFunction("deleteRecording") { name: String ->
      deleteRecording(name)
    }

    AsyncFunction("exportRecording") { name: String, promise: Promise ->
      Thread({ exportRecording(name, promise) }, "azimuth-export").start()
    }

    AsyncFunction("getFreeStorageBytes") {
      storageRoot().let { StatFs(it.path).availableBytes }
    }

    OnDestroy {
      releaseAll(emit = false)
    }
  }

  // --- connection ---------------------------------------------------------------------------

  private fun connect(promise: Promise) {
    val context = appContext.reactContext
    if (context == null) {
      promise.reject(CodedException(ERR_NO_CONTEXT, "React context is unavailable", null))
      return
    }
    val usbManager = context.getSystemService(Context.USB_SERVICE) as? UsbManager
    if (usbManager == null) {
      promise.reject(CodedException(ERR_NO_USB, "USB host service is unavailable on this device", null))
      return
    }

    synchronized(lock) {
      if (connection != null) {
        promise.resolve(statusPayload())
        return
      }
      if (pendingConnect != null) {
        promise.reject(CodedException(ERR_BUSY, "A connection attempt is already in progress", null))
        return
      }
    }

    val found = usbManager.deviceList.values.firstOrNull { isRtlSdr(it) }
    if (found == null) {
      emitStatus(STATUS_ERROR, null)
      promise.reject(
        CodedException(ERR_NO_DEVICE, "No RTL-SDR receiver found. Check the OTG cable and dongle.", null)
      )
      return
    }

    emitStatus(STATUS_CONNECTING, fallbackLabel(found))

    if (usbManager.hasPermission(found)) {
      openDevice(usbManager, found, promise)
    } else {
      requestPermission(context, usbManager, found, promise)
    }
  }

  private fun requestPermission(
    context: Context,
    usbManager: UsbManager,
    target: UsbDevice,
    promise: Promise
  ) {
    synchronized(lock) {
      pendingDevice = target
      pendingConnect = promise
    }

    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != ACTION_USB_PERMISSION) return
        unregisterQuietly(ctx, this)

        val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
        val waiting: Promise?
        val dev: UsbDevice?
        synchronized(lock) {
          waiting = pendingConnect
          dev = pendingDevice
          pendingConnect = null
          pendingDevice = null
          permissionReceiver = null
        }
        if (waiting == null || dev == null) return

        if (granted) {
          Thread({ openDevice(usbManager, dev, waiting) }, "azimuth-rtlsdr-open").start()
        } else {
          emitStatus(STATUS_ERROR, fallbackLabel(dev))
          waiting.reject(CodedException(ERR_PERMISSION, "USB permission was denied", null))
        }
      }
    }

    synchronized(lock) { permissionReceiver = receiver }
    registerReceiverCompat(context, receiver, IntentFilter(ACTION_USB_PERMISSION))

    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
    val permissionIntent = PendingIntent.getBroadcast(
      context,
      0,
      Intent(ACTION_USB_PERMISSION).setPackage(context.packageName),
      flags
    )
    usbManager.requestPermission(target, permissionIntent)
  }

  private fun openDevice(usbManager: UsbManager, target: UsbDevice, promise: Promise) {
    val conn = usbManager.openDevice(target)
    if (conn == null) {
      emitStatus(STATUS_ERROR, fallbackLabel(target))
      promise.reject(CodedException(ERR_OPEN_FAILED, "Unable to open the USB device", null))
      return
    }

    val handle = RtlSdrNative.nativeOpen(conn.fileDescriptor)
    if (handle <= 0L) {
      conn.close()
      emitStatus(STATUS_ERROR, fallbackLabel(target))
      promise.reject(
        CodedException(ERR_OPEN_FAILED, "RTL-SDR initialisation failed (driver code $handle)", null)
      )
      return
    }

    val label = RtlSdrNative.nativeDescribe(handle) ?: fallbackLabel(target)
    synchronized(lock) {
      device = target
      connection = conn
      nativeHandle = handle
      deviceNameText = label
    }
    frequencyHz = DEFAULT_FREQUENCY_HZ
    sampleRateHz = FM_SAMPLE_RATE_HZ
    registerDetachReceiver(target)

    emitStatus(STATUS_CONNECTED, label)
    promise.resolve(statusPayload())
  }

  private fun registerDetachReceiver(target: UsbDevice) {
    val context = appContext.reactContext ?: return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action != UsbManager.ACTION_USB_DEVICE_DETACHED) return
        val removed: UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
        } else {
          @Suppress("DEPRECATION")
          intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
        }
        if (removed != null && removed.deviceName == target.deviceName) {
          Thread({ releaseAll(emit = true) }, "azimuth-rtlsdr-detach").start()
        }
      }
    }
    synchronized(lock) { detachReceiver = receiver }
    registerReceiverCompat(context, receiver, IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED))
  }

  // --- tuner controls -----------------------------------------------------------------------

  private fun requireHandle(): Long {
    val handle = nativeHandle
    if (handle == 0L) {
      throw CodedException(ERR_NOT_CONNECTED, "Connect to a receiver first", null)
    }
    return handle
  }

  private fun tune(targetHz: Double) {
    if (targetHz.isNaN() || targetHz < MIN_FREQUENCY_HZ || targetHz > MAX_FREQUENCY_HZ) {
      throw CodedException(
        ERR_FREQUENCY,
        "Frequency must be between ${MIN_FREQUENCY_HZ / 1e6} and ${MAX_FREQUENCY_HZ / 1e6} MHz",
        null
      )
    }

    val result = RtlSdrNative.nativeSetCenterFrequency(requireHandle(), Math.round(targetHz))
    if (result < 0) {
      throw CodedException(ERR_TUNE_FAILED, "Tuner rejected the frequency (driver code $result)", null)
    }

    frequencyHz = targetHz
    emitStatus(currentStatus, deviceNameText)
  }

  private fun setSampleRate(rateHz: Int) {
    if (rateHz != FM_SAMPLE_RATE_HZ && rateHz != SATELLITE_SAMPLE_RATE_HZ) {
      throw CodedException(ERR_SAMPLE_RATE, "Unsupported sample rate $rateHz", null)
    }
    if (streaming.get()) {
      throw CodedException(ERR_BUSY, "Stop the stream before changing the sample rate", null)
    }
    val applied = RtlSdrNative.nativeSetSampleRate(requireHandle(), rateHz)
    if (applied < 0) {
      throw CodedException(ERR_SAMPLE_RATE, "Unable to set the sample rate (driver code $applied)", null)
    }
    sampleRateHz = applied
    emitStatus(currentStatus, deviceNameText)
  }

  /** null selects automatic gain; otherwise the nearest supported gain is applied and returned in dB. */
  private fun setGain(gainDb: Double?): Double? {
    val tenths = if (gainDb == null) -1 else Math.round(gainDb * 10.0).toInt().coerceAtLeast(0)
    val result = RtlSdrNative.nativeSetGain(requireHandle(), tenths)
    if (result < 0) {
      throw CodedException(ERR_GAIN, "Unable to set the gain (driver code $result)", null)
    }
    return if (gainDb == null) null else result / 10.0
  }

  private fun getGains(): List<Double> =
    RtlSdrNative.nativeGetGains(requireHandle())?.map { it / 10.0 } ?: emptyList()

  private fun setBiasTee(enabled: Boolean) {
    val result = RtlSdrNative.nativeSetBiasTee(requireHandle(), enabled)
    if (result < 0) {
      throw CodedException(ERR_BIAS_TEE, "Unable to switch the bias tee (driver code $result)", null)
    }
  }

  // --- streaming ----------------------------------------------------------------------------

  private fun startStream() {
    synchronized(lock) {
      if (nativeHandle == 0L) {
        throw CodedException(ERR_NOT_CONNECTED, "Connect to a receiver before streaming", null)
      }
      if (streaming.get()) return

      val started = RtlSdrNative.nativeStartReader(nativeHandle)
      if (started < 0) {
        throw CodedException(ERR_STREAM_FAILED, "Unable to start USB streaming (driver code $started)", null)
      }
      streaming.set(true)
      streamThread = Thread({ streamLoop() }, "azimuth-rtlsdr-stream").apply {
        isDaemon = true
        start()
      }
    }
    emitStatus(STATUS_STREAMING, deviceNameText)
  }

  private fun stopStream() {
    // A recording cannot outlive its stream.
    finishRecording()
    val wasStreaming = stopStreamThread()
    if (wasStreaming && synchronized(lock) { nativeHandle != 0L }) {
      emitStatus(STATUS_CONNECTED, deviceNameText)
    }
  }

  private fun disconnect() {
    releaseAll(emit = true)
  }

  private fun stopStreamThread(): Boolean {
    val thread: Thread?
    val wasStreaming: Boolean
    val handle: Long
    synchronized(lock) {
      wasStreaming = streaming.getAndSet(false)
      thread = streamThread
      streamThread = null
      handle = nativeHandle
    }
    if (wasStreaming && handle != 0L) {
      RtlSdrNative.nativeStopReader(handle)
    }
    if (thread != null && thread !== Thread.currentThread()) {
      try {
        thread.join(STREAM_JOIN_TIMEOUT_MS)
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      }
    }
    return wasStreaming
  }

  private fun releaseAll(emit: Boolean) {
    finishRecording()
    stopStreamThread()

    val context = appContext.reactContext
    val conn: UsbDeviceConnection?
    val handle: Long
    val detach: BroadcastReceiver?
    val permission: BroadcastReceiver?
    val waiting: Promise?
    synchronized(lock) {
      conn = connection
      handle = nativeHandle
      detach = detachReceiver
      permission = permissionReceiver
      waiting = pendingConnect
      connection = null
      nativeHandle = 0L
      device = null
      deviceNameText = null
      detachReceiver = null
      permissionReceiver = null
      pendingConnect = null
      pendingDevice = null
    }

    if (context != null) {
      detach?.let { unregisterQuietly(context, it) }
      permission?.let { unregisterQuietly(context, it) }
    }
    waiting?.reject(CodedException(ERR_BUSY, "Connection attempt cancelled", null))

    if (handle != 0L) {
      RtlSdrNative.nativeSetBiasTee(handle, false)
      RtlSdrNative.nativeClose(handle)
    }
    conn?.close()
    sampleRateHz = FM_SAMPLE_RATE_HZ

    if (emit) {
      emitStatus(STATUS_DISCONNECTED, null)
    } else {
      currentStatus = STATUS_DISCONNECTED
    }
  }

  private fun streamLoop() {
    val bins = FloatArray(BIN_COUNT)
    val pcm = ShortArray(RtlSdrNative.MAX_AUDIO_SAMPLES)
    val frameNanos = 1_000_000_000L / TARGET_FPS
    var lastEmit = 0L
    var lastRecordingEmit = 0L

    var track: AudioTrack? = null
    var trackStarted = false
    var prebufferedBlocks = 0
    var appliedVolume = -1f

    try {
      while (streaming.get()) {
        // FM demodulation is only valid at the 2.4 MS/s rate.
        val wantAudio = audioEnabled && sampleRateHz == FM_SAMPLE_RATE_HZ
        if (wantAudio && track == null) {
          track = createAudioTrack()
          trackStarted = false
          prebufferedBlocks = 0
          appliedVolume = -1f
          if (track == null) audioEnabled = false
        } else if (!wantAudio && track != null) {
          releaseAudioTrack(track)
          track = null
        }

        val handle = nativeHandle
        if (!streaming.get() || handle == 0L) {
          return
        }
        val result = RtlSdrNative.nativeReadBlock(
          handle, bins, DISPLAY_FLOOR_DB, DISPLAY_CEIL_DB, pcm, track != null
        )

        if (result < 0) {
          if (streaming.get()) {
            Log.e(TAG, "IQ read failed with driver code $result")
            releaseAudioTrack(track)
            track = null
            releaseAll(emit = false)
            emitStatus(STATUS_ERROR, null)
          }
          return
        }

        val activeTrack = track
        if (activeTrack != null && result > 0) {
          val volume = audioVolume
          if (volume != appliedVolume) {
            activeTrack.setVolume(volume)
            appliedVolume = volume
          }
          // Non-blocking so a slow audio device can never stall USB reads (which would drop IQ).
          activeTrack.write(pcm, 0, result, AudioTrack.WRITE_NON_BLOCKING)
          if (!trackStarted && ++prebufferedBlocks >= AUDIO_PREBUFFER_BLOCKS) {
            activeTrack.play()
            trackStarted = true
          }
        }

        val now = System.nanoTime()
        if (now - lastEmit >= frameNanos) {
          lastEmit = now
          sendEvent(EVENT_SIGNAL_DATA, mapOf("bins" to bins.toList()))
        }

        if (recordingActive && now - lastRecordingEmit >= RECORDING_EVENT_INTERVAL_NANOS) {
          lastRecordingEmit = now
          val healthy = reportRecordingProgress()
          val limit = recordingMaxDurationMs
          val expired = limit > 0 && System.currentTimeMillis() - recordingStartedAtMs >= limit
          if (!healthy || expired) {
            // Either the recorder stopped itself (storage full or write error; the event carries the
            // error) or the pass-length safety limit was reached.
            finishRecording()
          }
        }
      }
    } finally {
      releaseAudioTrack(track)
    }
  }

  // --- recording ----------------------------------------------------------------------------

  private fun storageRoot(): File {
    val context = appContext.reactContext ?: throw CodedException(ERR_NO_CONTEXT, "React context is unavailable", null)
    val base = context.getExternalFilesDir(null) ?: context.filesDir
    return File(base, "captures").apply { mkdirs() }
  }

  private fun recordingDir(name: String): File {
    if (!SAFE_NAME.matches(name)) {
      throw CodedException(ERR_BAD_NAME, "Invalid recording name", null)
    }
    return File(storageRoot(), name)
  }

  private fun startRecording(name: String, label: String, maxDurationMs: Long): Map<String, Any?> {
    val handle = requireHandle()
    if (sampleRateHz != SATELLITE_SAMPLE_RATE_HZ) {
      throw CodedException(ERR_SAMPLE_RATE, "Switch the receiver to satellite mode (2.304 MS/s) before recording", null)
    }
    if (!streaming.get()) {
      throw CodedException(ERR_NOT_CONNECTED, "Start the stream before recording", null)
    }

    val directory = recordingDir(name)
    synchronized(lock) {
      if (recordingActive) throw CodedException(ERR_BUSY, "A recording is already running", null)
      if (!directory.exists() && !directory.mkdirs()) {
        throw CodedException(ERR_STORAGE, "Unable to create ${directory.path}", null)
      }
    }

    val context = appContext.reactContext ?: throw CodedException(ERR_NO_CONTEXT, "React context is unavailable", null)
    RecordingService.start(context, label)

    val dataFile = File(directory, DATA_FILE_NAME)
    val result = RtlSdrNative.nativeStartRecording(handle, dataFile.path)
    if (result < 0) {
      RecordingService.stop(context)
      throw CodedException(ERR_STORAGE, "Unable to open the recording file (error $result)", null)
    }

    synchronized(lock) {
      recordingName = name
      recordingDirectory = directory
      recordingStartedAtMs = System.currentTimeMillis()
      recordingMaxDurationMs = maxDurationMs
      lastRecordingError = 0
      lastRecordingSummary = null
      recordingActive = true
    }
    reportRecordingProgress()

    return mapOf(
      "directory" to directory.path,
      "dataPath" to dataFile.path,
      "metadataPath" to File(directory, METADATA_FILE_NAME).path
    )
  }

  /** Emits a progress event. Returns false when the native recorder has reported a write error. */
  private fun reportRecordingProgress(): Boolean {
    val handle = nativeHandle
    if (handle == 0L) return false
    val stats = RtlSdrNative.nativeGetRecordingStats(handle) ?: return false
    val errno = stats[3].toInt()
    sendEvent(
      EVENT_RECORDING_STATUS,
      mapOf(
        "active" to (recordingActive && errno == 0),
        "name" to recordingName,
        "bytes" to stats[0],
        "samples" to stats[1],
        "droppedBlocks" to stats[2],
        "elapsedMs" to (System.currentTimeMillis() - recordingStartedAtMs),
        "error" to if (errno != 0) "Recording stopped: storage error ($errno)" else null
      )
    )
    if (errno != 0) lastRecordingError = errno
    return errno == 0
  }

  private fun finishRecording(): Map<String, Any?> {
    val name: String?
    val directory: File?
    val startedAt: Long
    val wasActive: Boolean
    synchronized(lock) {
      wasActive = recordingActive
      name = recordingName
      directory = recordingDirectory
      startedAt = recordingStartedAtMs
      recordingActive = false
      recordingName = null
      recordingDirectory = null
    }
    if (!wasActive) {
      // Already finished natively (safety limit or write error): hand back the final stats saved then.
      return lastRecordingSummary ?: mapOf("active" to false)
    }

    val handle = nativeHandle
    val stats = if (handle != 0L) RtlSdrNative.nativeStopRecording(handle) else null
    appContext.reactContext?.let { RecordingService.stop(it) }

    val errno = stats?.get(3)?.toInt() ?: lastRecordingError
    val summary = mapOf(
      "active" to false,
      "name" to name,
      "directory" to directory?.path,
      "bytes" to (stats?.get(0) ?: 0L),
      "samples" to (stats?.get(1) ?: 0L),
      "droppedBlocks" to (stats?.get(2) ?: 0L),
      "elapsedMs" to (System.currentTimeMillis() - startedAt),
      "error" to if (errno != 0) "Recording stopped: storage error ($errno)" else null
    )
    lastRecordingSummary = summary
    sendEvent(EVENT_RECORDING_STATUS, summary)
    return summary
  }

  private fun stopRecording(): Map<String, Any?> = finishRecording()

  private fun writeRecordingMetadata(name: String, json: String) {
    val directory = recordingDir(name)
    if (!directory.isDirectory) throw CodedException(ERR_STORAGE, "Recording not found", null)
    val temp = File(directory, "$METADATA_FILE_NAME.tmp")
    temp.writeText(json, Charsets.UTF_8)
    val target = File(directory, METADATA_FILE_NAME)
    if (!temp.renameTo(target)) {
      target.writeText(json, Charsets.UTF_8)
      temp.delete()
    }
  }

  private fun listRecordings(): List<Map<String, Any?>> {
    val directories = storageRoot().listFiles { f -> f.isDirectory } ?: return emptyList()
    return directories
      .sortedByDescending { it.lastModified() }
      .map { dir ->
        val data = File(dir, DATA_FILE_NAME)
        val meta = File(dir, METADATA_FILE_NAME)
        val images = File(dir, "images").listFiles { f -> f.isFile && f.name.endsWith(".png", true) }
        mapOf(
          "name" to dir.name,
          "directory" to dir.path,
          "dataBytes" to (if (data.exists()) data.length() else 0L),
          "metadata" to (if (meta.exists() && meta.length() < MAX_METADATA_BYTES) meta.readText(Charsets.UTF_8) else null),
          "modifiedMs" to dir.lastModified(),
          "imagePaths" to (images?.sortedBy { it.name }?.map { it.path } ?: emptyList<String>()),
          "active" to (recordingActive && recordingName == dir.name)
        )
      }
  }

  private fun deleteRecording(name: String) {
    val directory = recordingDir(name)
    if (recordingActive && recordingName == name) {
      throw CodedException(ERR_BUSY, "Stop the recording before deleting it", null)
    }
    if (directory.exists() && !directory.deleteRecursively()) {
      throw CodedException(ERR_STORAGE, "Unable to delete ${directory.path}", null)
    }
  }

  /** Copies a recording into Downloads/Azimuth/<name> so it can be reached from a computer or file manager. */
  private fun exportRecording(name: String, promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        throw CodedException(ERR_UNSUPPORTED, "Export needs Android 10 or newer; use Share instead", null)
      }
      val context = appContext.reactContext ?: throw CodedException(ERR_NO_CONTEXT, "React context is unavailable", null)
      val directory = recordingDir(name)
      if (!directory.isDirectory) throw CodedException(ERR_STORAGE, "Recording not found", null)

      val files = directory.walkTopDown().filter { it.isFile && !it.name.endsWith(".tmp") }.toList()
      val resolver = context.contentResolver
      for (file in files) {
        val relative = file.parentFile?.relativeTo(directory)?.path?.takeIf { it.isNotEmpty() }
        val relativePath = listOfNotNull(Environment.DIRECTORY_DOWNLOADS, "Azimuth", name, relative).joinToString("/")
        val values = ContentValues().apply {
          put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
          put(MediaStore.MediaColumns.MIME_TYPE, mimeTypeFor(file))
          put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
        }
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
          ?: throw CodedException(ERR_STORAGE, "Unable to create ${file.name} in Downloads", null)
        resolver.openOutputStream(uri)?.use { output ->
          file.inputStream().use { input -> input.copyTo(output, 1 shl 20) }
        } ?: throw CodedException(ERR_STORAGE, "Unable to write ${file.name} to Downloads", null)
      }
      promise.resolve("${Environment.DIRECTORY_DOWNLOADS}/Azimuth/$name")
    } catch (e: CodedException) {
      promise.reject(e)
    } catch (e: Exception) {
      promise.reject(CodedException(ERR_STORAGE, e.message ?: "Export failed", e))
    }
  }

  private fun mimeTypeFor(file: File): String = when {
    file.name.endsWith(".png", true) -> "image/png"
    file.name.endsWith(".sigmf-meta", true) || file.name.endsWith(".json", true) -> "application/json"
    else -> "application/octet-stream"
  }

  // --- audio --------------------------------------------------------------------------------

  private fun createAudioTrack(): AudioTrack? {
    return try {
      val minBytes = AudioTrack.getMinBufferSize(
        AUDIO_SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT
      )
      if (minBytes <= 0) return null

      val track = AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
            .build()
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setSampleRate(AUDIO_SAMPLE_RATE)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()
        )
        .setBufferSizeInBytes(maxOf(minBytes, AUDIO_BUFFER_BYTES))
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()

      if (track.state != AudioTrack.STATE_INITIALIZED) {
        track.release()
        null
      } else {
        track
      }
    } catch (e: Exception) {
      Log.e(TAG, "Unable to create AudioTrack", e)
      null
    }
  }

  private fun releaseAudioTrack(track: AudioTrack?) {
    if (track == null) return
    try {
      track.pause()
      track.flush()
    } catch (_: IllegalStateException) {
    }
    track.release()
  }

  // --- helpers ------------------------------------------------------------------------------

  private fun isRtlSdr(candidate: UsbDevice): Boolean = when (candidate.vendorId) {
    VENDOR_ID_REALTEK -> candidate.productId in REALTEK_RTL_PRODUCT_IDS
    VENDOR_ID_TERRATEC -> true
    else -> false
  }

  private fun fallbackLabel(target: UsbDevice): String =
    target.productName?.takeIf { it.isNotBlank() } ?: target.deviceName

  private fun statusPayload(): Map<String, Any?> = mapOf(
    "status" to currentStatus,
    "deviceName" to deviceNameText,
    "frequency" to frequencyHz,
    "sampleRate" to sampleRateHz
  )

  private fun emitStatus(status: String, deviceName: String?) {
    currentStatus = status
    sendEvent(
      EVENT_STATUS_CHANGE,
      mapOf(
        "status" to status,
        "deviceName" to deviceName,
        "frequency" to frequencyHz,
        "sampleRate" to sampleRateHz
      )
    )
  }

  private fun registerReceiverCompat(context: Context, receiver: BroadcastReceiver, filter: IntentFilter) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter)
    }
  }

  private fun unregisterQuietly(context: Context, receiver: BroadcastReceiver) {
    try {
      context.unregisterReceiver(receiver)
    } catch (_: IllegalArgumentException) {
    }
  }

  companion object {
    private const val TAG = "RtlSdrModule"

    private const val EVENT_SIGNAL_DATA = "onSignalData"
    private const val EVENT_STATUS_CHANGE = "onStatusChange"
    private const val EVENT_RECORDING_STATUS = "onRecordingStatus"

    private const val STATUS_DISCONNECTED = "disconnected"
    private const val STATUS_CONNECTING = "connecting"
    private const val STATUS_CONNECTED = "connected"
    private const val STATUS_STREAMING = "streaming"
    private const val STATUS_ERROR = "error"

    private const val ACTION_USB_PERMISSION = "expo.modules.rtlsdr.USB_PERMISSION"

    private const val VENDOR_ID_REALTEK = 0x0BDA
    private const val VENDOR_ID_TERRATEC = 0x0245
    private val REALTEK_RTL_PRODUCT_IDS = setOf(0x2832, 0x2838)

    private const val DEFAULT_FREQUENCY_HZ = 100_000_000.0
    private const val MIN_FREQUENCY_HZ = 500_000.0
    private const val MAX_FREQUENCY_HZ = 1_766_000_000.0

    private const val FM_SAMPLE_RATE_HZ = 2_400_000
    private const val SATELLITE_SAMPLE_RATE_HZ = 2_304_000

    private const val BIN_COUNT = 64
    private const val TARGET_FPS = 30
    private const val STREAM_JOIN_TIMEOUT_MS = 3_000L
    private const val RECORDING_EVENT_INTERVAL_NANOS = 500_000_000L

    private const val AUDIO_SAMPLE_RATE = 48_000
    private const val AUDIO_BUFFER_BYTES = 48_000 * 2 / 8
    private const val AUDIO_PREBUFFER_BLOCKS = 3
    private const val DEFAULT_VOLUME = 0.8f

    /** dBFS range mapped onto 0..1 bar height; adjust to taste for your antenna / gain. */
    private const val DISPLAY_FLOOR_DB = -70f
    private const val DISPLAY_CEIL_DB = -20f

    private const val DATA_FILE_NAME = "baseband.cs8"
    private const val METADATA_FILE_NAME = "baseband.sigmf-meta"
    private const val MAX_METADATA_BYTES = 512L * 1024L
    private val SAFE_NAME = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")

    private const val ERR_NO_CONTEXT = "ERR_RTLSDR_NO_CONTEXT"
    private const val ERR_NO_USB = "ERR_RTLSDR_NO_USB"
    private const val ERR_NO_DEVICE = "ERR_RTLSDR_NO_DEVICE"
    private const val ERR_PERMISSION = "ERR_RTLSDR_PERMISSION"
    private const val ERR_OPEN_FAILED = "ERR_RTLSDR_OPEN_FAILED"
    private const val ERR_NOT_CONNECTED = "ERR_RTLSDR_NOT_CONNECTED"
    private const val ERR_FREQUENCY = "ERR_RTLSDR_FREQUENCY"
    private const val ERR_TUNE_FAILED = "ERR_RTLSDR_TUNE_FAILED"
    private const val ERR_STREAM_FAILED = "ERR_RTLSDR_STREAM_FAILED"
    private const val ERR_SAMPLE_RATE = "ERR_RTLSDR_SAMPLE_RATE"
    private const val ERR_GAIN = "ERR_RTLSDR_GAIN"
    private const val ERR_BIAS_TEE = "ERR_RTLSDR_BIAS_TEE"
    private const val ERR_STORAGE = "ERR_RTLSDR_STORAGE"
    private const val ERR_BAD_NAME = "ERR_RTLSDR_BAD_NAME"
    private const val ERR_UNSUPPORTED = "ERR_RTLSDR_UNSUPPORTED"
    private const val ERR_BUSY = "ERR_RTLSDR_BUSY"
  }
}
