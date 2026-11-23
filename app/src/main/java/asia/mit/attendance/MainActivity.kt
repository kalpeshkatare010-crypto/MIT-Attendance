package asia.mit.attendance

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

/**
 * Two WebViews:
 *  - erpWeb: the real erp.mit.asia site, kept behind the app UI. A small script
 *    (assets/erp_agent.js) fills the login form, spots the OTP step and reads
 *    the attendance cards.
 *  - uiWeb:  the app's own screens (assets/app/index.html).
 */
class MainActivity : Activity() {

    companion object {
        const val ERP_URL = "http://erp.mit.asia/"
        const val ERP_HOST = "erp.mit.asia"
    }

    private lateinit var root: FrameLayout
    private lateinit var erpWeb: WebView
    private lateinit var uiWeb: WebView
    private val main = Handler(Looper.getMainLooper())

    private var agentJs: String = ""
    private var erpShown = false

    // What the agent should do on the ERP page right now.
    private var pendingEmail: String = ""
    private var pendingPassword: String = ""
    private var pendingOtp: String = ""
    private var loginAttempt = 0

    private val updater by lazy { Updater(this) { type, json -> toUi(type, json) } }

    private val prefs: SharedPreferences by lazy {
        getSharedPreferences("app", Context.MODE_PRIVATE)
    }

    private val secure: SharedPreferences by lazy {
        try {
            val key = MasterKey.Builder(this)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                this, "secure", key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e: Exception) {
            // Keystore problems on some phones: fall back to not remembering the password.
            getSharedPreferences("secure_fallback", Context.MODE_PRIVATE)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#053F4D")
        window.navigationBarColor = Color.parseColor("#053F4D")

        agentJs = assets.open("erp_agent.js").bufferedReader().use { it.readText() }

        root = FrameLayout(this)
        setContentView(root)

        CookieManager.getInstance().setAcceptCookie(true)

        // ERP browser (behind the UI).
        erpWeb = WebView(this)
        erpWeb.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(erpWeb, true)
        erpWeb.addJavascriptInterface(AgentBridge(), "MITAgent")
        erpWeb.webChromeClient = WebChromeClient()
        erpWeb.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Let the ERP's login go wherever it needs, over https, or http on the college's own servers.
                return !allowed(request.url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                trail("page " + url)
                injectAgent()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                if (request.isForMainFrame) {
                    trail("error " + error.errorCode + " " + error.description + " " + request.url)
                    toUi("timeout", JSONObject().put("message", error.description.toString()).toString())
                }
            }
        }
        root.addView(erpWeb, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

        // App UI (on top).
        uiWeb = WebView(this)
        uiWeb.setBackgroundColor(Color.parseColor("#053F4D"))
        uiWeb.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = true
        }
        uiWeb.addJavascriptInterface(UiBridge(), "Android")
        uiWeb.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
        }
        root.addView(uiWeb, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        uiWeb.loadUrl("file:///android_asset/app/index.html")
    }

    // ---------- ERP automation ----------

    private fun injectAgent() {
        val cfg = JSONObject()
        cfg.put("email", pendingEmail)
        cfg.put("password", pendingPassword)
        cfg.put("otp", pendingOtp)
        cfg.put("attempt", loginAttempt)
        erpWeb.evaluateJavascript("window.__MIT_CFG=$cfg;$agentJs", null)
    }

    private fun allowed(uri: android.net.Uri): Boolean {
        val host = uri.host ?: return false
        return when (uri.scheme) {
            "https" -> true
            "http" -> host == ERP_HOST || host.endsWith(".mit.asia") || host == "mit.asia"
            else -> false
        }
    }

    private val trailLog = ArrayList<String>()
    private fun trail(line: String) {
        val t = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date())
        trailLog.add("$t $line")
        while (trailLog.size > 40) trailLog.removeAt(0)
    }

    private fun startSync(email: String, password: String) {
        trailLog.clear()
        trail("start, saved email=" + email.isNotEmpty() + ", password=" + password.isNotEmpty())
        pendingEmail = email
        pendingPassword = password
        pendingOtp = ""
        loginAttempt++
        erpWeb.loadUrl(ERP_URL)
    }

    private fun toUi(type: String, payload: String = "null") {
        main.post {
            val safeType = JSONObject.quote(type)
            uiWeb.evaluateJavascript("window.App && App.fromNative($safeType, $payload)", null)
        }
    }

    private fun showErp(show: Boolean) {
        erpShown = show
        uiWeb.visibility = if (show) View.GONE else View.VISIBLE
        if (show) toUi("erp_visible")
    }

    inner class AgentBridge {
        /** Called by erp_agent.js. Only trusts calls while the ERP host is loaded. */
        @JavascriptInterface
        fun post(type: String, json: String) {
            main.post {
                val ok = try { allowed(android.net.Uri.parse(erpWeb.url ?: "")) } catch (e: Exception) { false }
                if (!ok) return@post
                if (type != "debug") trail("agent " + type + " " + json.take(160))
                when (type) {
                    "data" -> {
                        prefs.edit()
                            .putString("cache", json)
                            .putLong("syncedAt", System.currentTimeMillis())
                            .apply()
                        pendingPassword = ""
                        pendingOtp = ""
                        if (erpShown) showErp(false)
                        toUi("data", JSONObject().put("data", JSONObject(json))
                            .put("syncedAt", System.currentTimeMillis()).toString())
                    }
                    "debug" -> prefs.edit().putString("lastPage", json).apply()
                    "status" -> toUi(type, json)
                    else -> toUi(type, if (json.isBlank()) "null" else json)
                }
            }
        }
    }

    // ---------- Bridge for the app UI ----------

    inner class UiBridge {
        @JavascriptInterface
        fun getState(): String {
            val o = JSONObject()
            o.put("email", secure.getString("email", "") ?: "")
            o.put("hasPassword", (secure.getString("password", "") ?: "").isNotEmpty())
            o.put("cache", prefs.getString("cache", "") ?: "")
            o.put("syncedAt", prefs.getLong("syncedAt", 0L))
            o.put("target", prefs.getInt("target", 75))
            o.put("version", try {
                packageManager.getPackageInfo(packageName, 0).versionName
            } catch (e: Exception) { "1.0" })
            return o.toString()
        }

        @JavascriptInterface
        fun login(email: String, password: String, remember: Boolean) {
            main.post {
                secure.edit().putString("email", email).apply()
                if (remember) secure.edit().putString("password", password).apply()
                else secure.edit().remove("password").apply()
                startSync(email, password)
            }
        }

        /** Sync using the saved login, or the existing ERP session. */
        @JavascriptInterface
        fun refresh() {
            main.post {
                startSync(secure.getString("email", "") ?: "", secure.getString("password", "") ?: "")
            }
        }

        @JavascriptInterface
        fun submitOtp(code: String) {
            main.post {
                pendingOtp = code
                injectAgent()
            }
        }

        @JavascriptInterface
        fun setTarget(value: Int) {
            prefs.edit().putInt("target", value).apply()
        }

        @JavascriptInterface
        fun openErp() {
            main.post { showErp(true) }
        }

        @JavascriptInterface
        fun copyReport() {
            main.post {
                val page = prefs.getString("lastPage", "") ?: ""
                val text = "MIT Attendance report\n\nSteps:\n" + trailLog.joinToString("\n") +
                    "\n\nCurrent URL: " + (erpWeb.url ?: "") + "\n\nLast page seen:\n" + page
                val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                cm.setPrimaryClip(ClipData.newPlainText("MIT Attendance report", text))
            }
        }

        @JavascriptInterface
        fun checkUpdate(manual: Boolean) { updater.check(manual) }

        @JavascriptInterface
        fun downloadUpdate() { updater.download() }

        @JavascriptInterface
        fun logout() {
            main.post {
                secure.edit().clear().apply()
                prefs.edit().remove("cache").remove("syncedAt").remove("lastPage").apply()
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
                erpWeb.clearCache(true)
                erpWeb.loadUrl("about:blank")
                pendingEmail = ""; pendingPassword = ""; pendingOtp = ""
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (erpShown) {
            showErp(false)
            return
        }
        uiWeb.evaluateJavascript("window.App ? App.back() : false") { result ->
            if (result != "true") {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (::uiWeb.isInitialized) updater.resume()
    }

    override fun onDestroy() {
        CookieManager.getInstance().flush()
        super.onDestroy()
    }
}
