package asia.mit.attendance

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Checks the GitHub "latest release" of this repo, downloads the APK and
 * opens Android's installer. Releases are tagged v1.0.<build number>, and the
 * app's versionCode is that same build number.
 */
class Updater(private val activity: Activity, private val send: (String, String) -> Unit) {

    companion object {
        const val RELEASES = "https://api.github.com/repos/kalpeshkatare010-crypto/MIT-Attendance/releases/latest"
    }

    private var apkUrl: String? = null
    private var downloaded: File? = null
    @Volatile private var busy = false
    private var waitingPermission = false

    private fun currentCode(): Long = try {
        val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
        if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
    } catch (e: Exception) { 0L }

    fun check(manual: Boolean) {
        Thread {
            try {
                val conn = URL(RELEASES).openConnection() as HttpURLConnection
                conn.setRequestProperty("Accept", "application/vnd.github+json")
                conn.connectTimeout = 15000; conn.readTimeout = 15000
                if (conn.responseCode != 200) {
                    if (manual) send("update_none", JSONObject().put("error", "Could not reach the update server (" + conn.responseCode + ").").toString())
                    return@Thread
                }
                val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
                val tag = json.optString("tag_name")
                val code = tag.substringAfterLast('.').toLongOrNull() ?: 0L
                val assets = json.optJSONArray("assets")
                var url: String? = null; var size = 0L
                if (assets != null) for (i in 0 until assets.length()) {
                    val a = assets.getJSONObject(i)
                    if (a.optString("name").endsWith(".apk")) { url = a.optString("browser_download_url"); size = a.optLong("size") }
                }
                if (code > currentCode() && url != null) {
                    apkUrl = url
                    send("update_available", JSONObject()
                        .put("version", tag.removePrefix("v"))
                        .put("size", size)
                        .put("notes", json.optString("body")).toString())
                } else if (manual) {
                    send("update_none", "{}")
                }
            } catch (e: Exception) {
                if (manual) send("update_none", JSONObject().put("error", "No internet connection.").toString())
            }
        }.start()
    }

    fun download() {
        val url = apkUrl ?: return
        if (busy) return
        busy = true
        Thread {
            try {
                val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }
                val out = File(dir, "MIT-Attendance.apk")
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.instanceFollowRedirects = true
                conn.connectTimeout = 20000; conn.readTimeout = 30000
                val total = conn.contentLengthLong
                var read = 0L; var lastPct = -1
                conn.inputStream.use { input ->
                    out.outputStream().use { output ->
                        val buf = ByteArray(32 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            output.write(buf, 0, n)
                            read += n
                            if (total > 0) {
                                val pct = (read * 100 / total).toInt()
                                if (pct != lastPct) { lastPct = pct; send("update_progress", JSONObject().put("pct", pct).toString()) }
                            }
                        }
                    }
                }
                downloaded = out
                busy = false
                activity.runOnUiThread { install() }
            } catch (e: Exception) {
                busy = false
                send("update_failed", JSONObject().put("error", "Download failed. Check your internet and try again.").toString())
            }
        }.start()
    }

    /** Opens Android's installer, asking once for "install unknown apps" permission. */
    fun install() {
        val file = downloaded ?: return
        if (!activity.packageManager.canRequestPackageInstalls()) {
            waitingPermission = true
            send("update_permission", "{}")
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + activity.packageName)))
            return
        }
        val uri = FileProvider.getUriForFile(activity, activity.packageName + ".updates", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        send("update_installing", "{}")
        activity.startActivity(intent)
    }

    /** Called when the user comes back from the permission screen. */
    fun resume() {
        if (waitingPermission && downloaded != null && activity.packageManager.canRequestPackageInstalls()) {
            waitingPermission = false
            install()
        }
    }
}
