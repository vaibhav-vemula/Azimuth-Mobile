package expo.modules.signalscan

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult as BleResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.GnssStatus
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.telephony.CellInfo
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.CellIdentityLte
import android.telephony.CellIdentityNr
import android.telephony.CellSignalStrengthNr
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import java.security.SecureRandom
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads what the phone itself can sense about the radio environment: cellular cells, Wi-Fi and Bluetooth
 * counts and levels, and GNSS signal quality.
 *
 * Privacy: Wi-Fi names, hardware addresses and Bluetooth addresses are never returned to JavaScript. Addresses
 * are used in memory only to avoid counting one device twice, then dropped.
 */
class SignalScanModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is not available")

  @Volatile private var gnss: Map<String, Any?> = emptyMap()
  private var gnssCallback: GnssStatus.Callback? = null
  private var bleBusy = false
  private var lastWifiScanRequestAtMs = 0L
  private var orientationListener: SensorEventListener? = null
  /**
   * A random value chosen for each mapping session. Network and device addresses are mixed with it and shortened before
   * they leave this module, so the app can count how many different ones it has seen without ever holding an address.
   * A new session gets a new value, so the numbers cannot be matched up across sessions.
   */
  @Volatile private var sessionSalt: Long = SecureRandom().nextLong()
  /** The map and the AR view both use the orientation stream; it runs while at least one of them wants it. */
  private var orientationClients = 0

  override fun definition() = ModuleDefinition {
    Name("signal-scan")

    Events(EVENT_ORIENTATION)

    AsyncFunction("getCapabilities") {
      val pm = context.packageManager
      mapOf(
        "telephony" to pm.hasSystemFeature(PackageManager.FEATURE_TELEPHONY),
        "wifi" to pm.hasSystemFeature(PackageManager.FEATURE_WIFI),
        "bluetoothLe" to pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE),
        "sdk" to Build.VERSION.SDK_INT,
        "model" to Build.MODEL
      )
    }

    AsyncFunction("startMapping") {
      sessionSalt = SecureRandom().nextLong()
      MappingService.start(context)
      startGnss()
    }

    AsyncFunction("stopMapping") {
      stopGnss()
      MappingService.stop(context)
    }

    AsyncFunction("scan") { includeBluetooth: Boolean, beaconPrefix: String?, promise: Promise ->
      val cellular = readCellular()
      val wifi = readWifi()
      val gnssSnapshot = gnss
      if (!includeBluetooth) {
        promise.resolve(buildResult(cellular, wifi, null, gnssSnapshot))
      } else {
        scanBluetooth(beaconPrefix) { ble -> promise.resolve(buildResult(cellular, wifi, ble, gnssSnapshot)) }
      }
    }

    /**
     * Streams the phone's orientation as a quaternion, from Android's rotation-vector sensor (accelerometer, gyroscope
     * and magnetometer fused). It maps device axes (x right, y up the screen, z out of the screen) to the earth frame
     * (x east, y north, z up), relative to MAGNETIC north; `declinationDeg` is what to add to get true north. This is
     * what an AR view needs to hold a virtual object still in the world as the phone turns.
     */
    AsyncFunction("startOrientation") { latitude: Double, longitude: Double ->
      startOrientation(latitude, longitude)
    }

    AsyncFunction("stopOrientation") {
      stopOrientation()
    }

    OnDestroy {
      stopOrientation(force = true)
      stopGnss()
    }
  }

  private fun buildResult(
    cellular: Map<String, Any?>,
    wifi: Map<String, Any?>,
    bluetooth: Map<String, Any?>?,
    gnssSnapshot: Map<String, Any?>
  ): Map<String, Any?> = mapOf(
    "atMs" to System.currentTimeMillis(),
    "cellular" to cellular,
    "wifi" to wifi,
    "bluetooth" to bluetooth,
    "gnss" to gnssSnapshot
  )

  /** A short, session-only stand-in for an address: good for counting distinct ones, useless for identifying anything. */
  private fun anonymous(address: String): Int = (address + "#" + sessionSalt).hashCode()

  private fun has(permission: String) =
    ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED

  // ---- Cellular -------------------------------------------------------------------------------------------

  @SuppressLint("MissingPermission")
  private fun readCellular(): Map<String, Any?> {
    if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)) {
      return mapOf("available" to false, "cells" to emptyList<Any>())
    }
    if (!has(android.Manifest.permission.ACCESS_FINE_LOCATION)) {
      return mapOf("available" to false, "reason" to "location-permission", "cells" to emptyList<Any>())
    }
    val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    val infos: List<CellInfo> = try {
      tm.allCellInfo ?: emptyList()
    } catch (e: SecurityException) {
      return mapOf("available" to false, "reason" to "permission", "cells" to emptyList<Any>())
    }

    val cells = infos.mapNotNull { describeCell(it) }
    return mapOf("available" to true, "operator" to tm.networkOperator, "cells" to cells)
  }

  private fun describeCell(info: CellInfo): Map<String, Any?>? {
    val registered = info.isRegistered
    return when (info) {
      is CellInfoLte -> {
        val id: CellIdentityLte = info.cellIdentity
        val s = info.cellSignalStrength
        mapOf(
          "tech" to "lte",
          "registered" to registered,
          "dbm" to s.dbm,
          "level" to s.level,
          "cellId" to id.ci.toString(),
          "channel" to id.earfcn,
          "plmn" to listOfNotNull(id.mccString, id.mncString).joinToString("")
        )
      }
      is CellInfoNr -> {
        val id = info.cellIdentity as CellIdentityNr
        val s = info.cellSignalStrength as CellSignalStrengthNr
        mapOf(
          "tech" to "nr",
          "registered" to registered,
          "dbm" to s.dbm,
          "level" to s.level,
          "cellId" to id.nci.toString(),
          "channel" to id.nrarfcn,
          "plmn" to listOfNotNull(id.mccString, id.mncString).joinToString("")
        )
      }
      is CellInfoWcdma -> mapOf(
        "tech" to "wcdma",
        "registered" to registered,
        "dbm" to info.cellSignalStrength.dbm,
        "level" to info.cellSignalStrength.level,
        "cellId" to info.cellIdentity.cid.toString(),
        "channel" to info.cellIdentity.uarfcn,
        "plmn" to listOfNotNull(info.cellIdentity.mccString, info.cellIdentity.mncString).joinToString("")
      )
      is CellInfoGsm -> mapOf(
        "tech" to "gsm",
        "registered" to registered,
        "dbm" to info.cellSignalStrength.dbm,
        "level" to info.cellSignalStrength.level,
        "cellId" to info.cellIdentity.cid.toString(),
        "channel" to info.cellIdentity.arfcn,
        "plmn" to listOfNotNull(info.cellIdentity.mccString, info.cellIdentity.mncString).joinToString("")
      )
      else -> null
    }
  }

  // ---- Wi-Fi ----------------------------------------------------------------------------------------------

  @SuppressLint("MissingPermission")
  private fun readWifi(): Map<String, Any?> {
    if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI)) {
      return mapOf("available" to false)
    }
    val needsNearby = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
    val allowed = has(android.Manifest.permission.ACCESS_FINE_LOCATION) &&
      (!needsNearby || has(android.Manifest.permission.NEARBY_WIFI_DEVICES))
    if (!allowed) return mapOf("available" to false, "reason" to "permission")

    val wm = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    // Android throttles scans (4 per 2 minutes in the foreground, 1 per 30 minutes in the background).
    // A refused request is not an error: the latest cached results are still read.
    var requested = false
    val now = SystemClock.elapsedRealtime()
    if (now - lastWifiScanRequestAtMs >= MIN_WIFI_SCAN_INTERVAL_MS) {
      lastWifiScanRequestAtMs = now
      @Suppress("DEPRECATION")
      requested = try { wm.startScan() } catch (e: SecurityException) { false }
    }

    val results = try { wm.scanResults } catch (e: SecurityException) { emptyList() }
    val levels = results.map { it.level }.sorted()
    var b24 = 0
    var b5 = 0
    var b6 = 0
    var newestMicros = 0L
    for (r in results) {
      when {
        r.frequency < 3000 -> b24++
        r.frequency < 5925 -> b5++
        else -> b6++
      }
      if (r.timestamp > newestMicros) newestMicros = r.timestamp
    }
    val ageMs = if (newestMicros > 0) SystemClock.elapsedRealtime() - newestMicros / 1000 else null
    val ids = results.mapNotNull { r -> r.BSSID?.let { anonymous(it) } }.distinct()
    return mapOf(
      "available" to true,
      "count" to results.size,
      "strongestDbm" to levels.lastOrNull(),
      "medianDbm" to if (levels.isEmpty()) null else levels[levels.size / 2],
      "band24" to b24,
      "band5" to b5,
      "band6" to b6,
      "ageMs" to ageMs,
      "scanRequested" to requested,
      "ids" to ids
    )
  }

  // ---- Bluetooth LE ---------------------------------------------------------------------------------------

  @SuppressLint("MissingPermission")
  private fun scanBluetooth(beaconPrefix: String?, done: (Map<String, Any?>) -> Unit) {
    val pm = context.packageManager
    if (!pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
      return done(mapOf("available" to false))
    }
    val needed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) android.Manifest.permission.BLUETOOTH_SCAN
    else android.Manifest.permission.ACCESS_FINE_LOCATION
    if (!has(needed)) return done(mapOf("available" to false, "reason" to "permission"))

    val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    val scanner = adapter?.takeIf { it.isEnabled }?.bluetoothLeScanner
      ?: return done(mapOf("available" to false, "reason" to "off"))
    if (bleBusy) return done(mapOf("available" to false, "reason" to "busy"))
    bleBusy = true

    // Addresses are held only to count each device once; they never leave this function.
    val seen = HashMap<String, Int>()
    // A venue's own tag is recognised by the name it advertises. Only whether it was heard, and how strongly,
    // is reported; no address is kept.
    var beaconRssi: Int? = null
    val prefix = beaconPrefix?.trim()?.takeIf { it.isNotEmpty() }
    fun note(r: BleResult) {
      seen[r.device.address] = r.rssi
      if (prefix != null && r.scanRecord?.deviceName?.startsWith(prefix, ignoreCase = true) == true) {
        beaconRssi = maxOf(beaconRssi ?: Int.MIN_VALUE, r.rssi)
      }
    }
    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: BleResult) {
        note(result)
      }

      override fun onBatchScanResults(results: MutableList<BleResult>) {
        for (r in results) note(r)
      }

      override fun onScanFailed(errorCode: Int) {
        // Handled by the timer below, which reports whatever was seen.
      }
    }

    try {
      scanner.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback)
    } catch (e: SecurityException) {
      bleBusy = false
      return done(mapOf("available" to false, "reason" to "permission"))
    }

    main.postDelayed({
      try { scanner.stopScan(callback) } catch (e: Exception) { /* adapter turned off mid-scan */ }
      bleBusy = false
      val levels = seen.values.sorted()
      done(
        mapOf(
          "available" to true,
          "count" to levels.size,
          "strongestDbm" to levels.lastOrNull(),
          "medianDbm" to if (levels.isEmpty()) null else levels[levels.size / 2],
          "beaconSeen" to (beaconRssi != null),
          "beaconRssi" to beaconRssi,
          "ids" to seen.keys.map { anonymous(it) }
        )
      )
    }, BLE_SCAN_MS)
  }

  // ---- GNSS -----------------------------------------------------------------------------------------------

  @SuppressLint("MissingPermission")
  private fun startGnss() {
    if (gnssCallback != null || !has(android.Manifest.permission.ACCESS_FINE_LOCATION)) return
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    val callback = object : GnssStatus.Callback() {
      override fun onSatelliteStatusChanged(status: GnssStatus) {
        var used = 0
        var usedCn0 = 0.0
        var allCn0 = 0.0
        val total = status.satelliteCount
        for (i in 0 until total) {
          val cn0 = status.getCn0DbHz(i).toDouble()
          allCn0 += cn0
          if (status.usedInFix(i)) {
            used++
            usedCn0 += cn0
          }
        }
        gnss = mapOf(
          "available" to true,
          "satellites" to total,
          "used" to used,
          "avgCn0Used" to if (used > 0) usedCn0 / used else null,
          "avgCn0All" to if (total > 0) allCn0 / total else null,
          "atMs" to System.currentTimeMillis()
        )
      }
    }
    try {
      @Suppress("DEPRECATION")
      lm.registerGnssStatusCallback(callback, main)
      gnssCallback = callback
    } catch (e: SecurityException) {
      gnss = mapOf("available" to false, "reason" to "permission")
    }
  }

  private fun stopGnss() {
    val callback = gnssCallback ?: return
    val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    try { lm.unregisterGnssStatusCallback(callback) } catch (e: Exception) { /* already gone */ }
    gnssCallback = null
    gnss = emptyMap()
  }

  private fun startOrientation(latitude: Double, longitude: Double) {
    orientationClients += 1
    if (orientationListener != null) return
    val sensors = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    val rotation = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    if (rotation == null) {
      orientationClients = maxOf(0, orientationClients - 1)
      throw CodedException("NO_ORIENTATION_SENSOR", "This phone has no rotation sensor.", null)
    }

    val declination = try {
      GeomagneticField(latitude.toFloat(), longitude.toFloat(), 0f, System.currentTimeMillis()).declination.toDouble()
    } catch (e: Exception) {
      0.0
    }
    val quaternion = FloatArray(4)
    var lastEmitMs = 0L
    // SensorManager.SENSOR_STATUS_*: 3 high, 2 medium, 1 low, 0 unreliable. Low or unreliable means the compass needs calibrating.
    var status = SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM

    val listener = object : SensorEventListener {
      override fun onSensorChanged(event: SensorEvent) {
        val now = System.currentTimeMillis()
        if (now - lastEmitMs < ORIENTATION_MIN_INTERVAL_MS) return
        lastEmitMs = now
        SensorManager.getQuaternionFromVector(quaternion, event.values)
        val accuracy = if (event.values.size > 4 && event.values[4] >= 0f) event.values[4].toDouble() else null
        sendEvent(
          EVENT_ORIENTATION,
          mapOf(
            "w" to quaternion[0].toDouble(),
            "x" to quaternion[1].toDouble(),
            "y" to quaternion[2].toDouble(),
            "z" to quaternion[3].toDouble(),
            "declinationDeg" to declination,
            "accuracyRad" to accuracy,
            "status" to status
          )
        )
      }

      override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        status = accuracy
      }
    }
    orientationListener = listener
    sensors.registerListener(listener, rotation, SensorManager.SENSOR_DELAY_GAME)
  }

  private fun stopOrientation(force: Boolean = false) {
    orientationClients = if (force) 0 else maxOf(0, orientationClients - 1)
    if (orientationClients > 0) return
    val listener = orientationListener ?: return
    val sensors = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    sensors.unregisterListener(listener)
    orientationListener = null
  }

  companion object {
    private const val EVENT_ORIENTATION = "onOrientation"
    private const val ORIENTATION_MIN_INTERVAL_MS = 16L
    private const val BLE_SCAN_MS = 2000L
    private const val MIN_WIFI_SCAN_INTERVAL_MS = 35_000L
  }
}
