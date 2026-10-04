package expo.modules.signalscan

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Keeps the process alive while a mapping session is on, and shows the user that logging is happening.
 * Android requires this notification for location access to continue with the screen off.
 */
class MappingService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    ensureChannel()
    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    if (wakeLock == null) {
      val power = getSystemService(Context.POWER_SERVICE) as PowerManager
      wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "azimuth:mapping").apply {
        setReferenceCounted(false)
        acquire(MAX_WAKE_LOCK_MS)
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Mapping session", NotificationManager.IMPORTANCE_LOW).apply {
          description = "Shown while Azimuth is mapping signals around you"
          setShowBadge(false)
        }
      )
    }
  }

  private fun buildNotification(): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = launch?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    return builder
      .setContentTitle("Azimuth is mapping")
      .setContentText("Logging signal strength and counts around you. Open the app to stop.")
      .setSmallIcon(R.drawable.ic_stat_mapping)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(Notification.CATEGORY_SERVICE)
      .apply { if (contentIntent != null) setContentIntent(contentIntent) }
      .build()
  }

  companion object {
    private const val CHANNEL_ID = "azimuth_mapping"
    private const val NOTIFICATION_ID = 4102
    private const val MAX_WAKE_LOCK_MS = 4L * 60L * 60L * 1000L

    fun start(context: Context) {
      val intent = Intent(context, MappingService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, MappingService::class.java))
    }
  }
}
