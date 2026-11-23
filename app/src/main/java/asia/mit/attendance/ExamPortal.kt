package asia.mit.attendance

import android.annotation.SuppressLint
import android.app.Activity
import android.content.SharedPreferences
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject

/**
 * Hidden browser for the exam cell portal (mitaexamcell.in).
 * The PRN / hall ticket number is both the username and the password.
 * assets/exam_agent.js logs in, opens the results page and reads it.
 */
@SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
class ExamPortal(
    private val activity: Activity,
    root: FrameLayout,
    private val secure: SharedPreferences,
    private val prefs: SharedPreferences,
    private val send: (String, String) -> Unit
) {
    companion object {
        const val URL = "https://mitaexamcell.in/"
        fun isExamHost(uri: Uri): Boolean {
            val host = uri.host ?: return false
            return host == "mitaexamcell.in" || host.endsWith(".mitaexamcell.in")
        }
    }

    private val web = WebView(activity)
    private val agentJs = activity.assets.open("exam_agent.js").bufferedReader().use { it.readText() }
    private var prn = ""
    private var attempt = 0
    private val log = ArrayList<String>()

    init {
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.addJavascriptInterface(Bridge(), "MITExam")
        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                return !(u.scheme == "https" || (u.scheme == "http" && isExamHost(u)))
            }

            override fun onPageFinished(view: WebView, url: String) {
                trail("page $url")
                inject()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                if (request.isForMainFrame) {
                    trail("error " + error.errorCode + " " + error.description)
                    send("exam_failed", JSONObject().put("message", "Could not open the exam portal: " + error.description).toString())
                }
            }
        }
        // Behind everything; the app UI covers it.
        root.addView(web, 0, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    }

    private fun trail(line: String) {
        val t = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date())
        log.add("$t $line")
        while (log.size > 40) log.removeAt(0)
    }

    private fun inject() {
        val cfg = JSONObject().put("prn", prn).put("attempt", attempt)
        web.evaluateJavascript("window.__EXAM_CFG=$cfg;$agentJs", null)
    }

    fun savedPrn(): String = secure.getString("prn", "") ?: ""

    fun sync(newPrn: String?) {
        if (newPrn != null) secure.edit().putString("prn", newPrn.trim()).apply()
        prn = savedPrn()
        if (prn.isEmpty()) { send("exam_need_prn", "{}"); return }
        attempt++
        log.clear()
        trail("start exam sync")
        web.loadUrl(URL)
    }

    fun disconnect() {
        secure.edit().remove("prn").apply()
        prefs.edit().remove("exam_cache").remove("exam_syncedAt").remove("exam_lastPage").apply()
        web.loadUrl("about:blank")
    }

    fun report(): String =
        "Exam portal report\n\nSteps:\n" + log.joinToString("\n") +
            "\n\nCurrent URL: " + (web.url ?: "") +
            "\n\nLast page seen:\n" + (prefs.getString("exam_lastPage", "") ?: "")

    inner class Bridge {
        @JavascriptInterface
        fun post(type: String, json: String) {
            activity.runOnUiThread {
                val ok = try { isExamHost(Uri.parse(web.url ?: "")) } catch (e: Exception) { false }
                if (!ok) return@runOnUiThread
                if (type != "debug") trail("agent " + type + " " + json.take(160))
                when (type) {
                    "debug" -> prefs.edit().putString("exam_lastPage", json).apply()
                    "exam_data" -> {
                        val now = System.currentTimeMillis()
                        prefs.edit().putString("exam_cache", json).putLong("exam_syncedAt", now).apply()
                        send("exam_data", JSONObject().put("data", JSONObject(json)).put("syncedAt", now).toString())
                    }
                    else -> send(type, if (json.isBlank()) "null" else json)
                }
            }
        }
    }
}
