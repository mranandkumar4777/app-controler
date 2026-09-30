package com.presenter.remote

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Presenter Remote: a thin native shell around the /remote page that server.js serves.
 * Adds what a browser tab can't: a saved address, screen kept awake, and volume keys
 * for Next / Prev.
 */
class MainActivity : Activity() {
    private val bg = Color.parseColor("#16140F")
    private val gold = Color.parseColor("#C9A227")
    private val dim = Color.parseColor("#A79E8A")
    private lateinit var web: WebView
    private lateinit var panel: LinearLayout
    private lateinit var address: EditText
    private lateinit var error: TextView
    private var onRemote = false
    private var searching = false
    private lateinit var status: TextView
    private lateinit var foundBox: LinearLayout
    private lateinit var searchBtn: Button

    private class Found(val host: String, val port: Int, val name: String)
    private class PairResult(val status: String, val pin: String? = null)

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private val prefs get() = getSharedPreferences("remote", MODE_PRIVATE)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = bg
        window.navigationBarColor = bg
        val match = ViewGroup.LayoutParams.MATCH_PARENT

        web = WebView(this).apply {
            setBackgroundColor(bg)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true // the page remembers the PIN here
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(view: WebView, request: WebResourceRequest, err: WebResourceError) {
                    if (request.isForMainFrame) {
                        showConnect("Couldn't reach that computer. Check you're on the same Wi-Fi and that Presenter is running.", true)
                    }
                }
            }
        }

        fun label(t: String, size: Float, c: Int) = TextView(this).apply {
            text = t; textSize = size; setTextColor(c)
        }
        address = EditText(this).apply {
            hint = "192.168.1.23"
            setHintTextColor(dim)
            setTextColor(Color.WHITE)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            setSingleLine()
            setOnEditorActionListener { _, _, _ -> open(text.toString()); true }
        }
        error = label("", 14f, Color.parseColor("#E0796A")).apply { setPadding(0, dp(14), 0, 0) }
        val connect = Button(this).apply {
            text = "Connect"
            isAllCaps = false
            setTextColor(bg)
            setBackgroundColor(gold)
            setOnClickListener { open(address.text.toString()) }
        }
        status = label("", 16f, Color.WHITE).apply { setPadding(0, dp(8), 0, dp(12)) }
        foundBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        searchBtn = Button(this).apply {
            text = "Search again"
            isAllCaps = false
            visibility = View.GONE
            setOnClickListener { startDiscovery() }
        }
        panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(bg)
            setPadding(dp(28), dp(28), dp(28), dp(28))
            addView(label("Presenter Remote", 24f, Color.WHITE))
            addView(status)
            addView(foundBox)
            addView(searchBtn, LinearLayout.LayoutParams(match, ViewGroup.LayoutParams.WRAP_CONTENT))
            addView(label("Or type the computer's address:", 13f, dim).apply { setPadding(0, dp(28), 0, dp(6)) })
            addView(address)
            addView(connect, LinearLayout.LayoutParams(match, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
            addView(error)
        }

        setContentView(FrameLayout(this).apply {
            setBackgroundColor(bg)
            addView(web, FrameLayout.LayoutParams(match, match))
            addView(panel, FrameLayout.LayoutParams(match, match))
        })

        val fromLink = intent?.data?.toString()
        val saved = prefs.getString("addr", null)
        when {
            fromLink != null -> open(fromLink)
            saved != null -> reconnect(saved)
            else -> showConnect(null, true)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.data?.let { open(it.toString()) }
    }

    private fun showConnect(msg: String?, auto: Boolean) {
        onRemote = false
        web.visibility = View.GONE
        panel.visibility = View.VISIBLE
        error.text = msg ?: ""
        address.setText(prefs.getString("addr", ""))
        if (auto) {
            startDiscovery()
        } else if (!searching) {
            status.text = ""
            searchBtn.visibility = View.VISIBLE
        }
    }

    // ---- automatic connection: find the computer on the Wi-Fi, pair, open the remote ----

    private fun deviceName(): String = "${Build.MANUFACTURER} ${Build.MODEL}".trim()

    private fun deviceId(): String {
        val existing = prefs.getString("id", null)
        if (existing != null) return existing
        val fresh = UUID.randomUUID().toString()
        prefs.edit().putString("id", fresh).apply()
        return fresh
    }

    private fun localPrefixes(): List<String> {
        val out = LinkedHashSet<String>()
        try {
            val nis = NetworkInterface.getNetworkInterfaces() ?: return emptyList()
            for (ni in java.util.Collections.list(nis)) {
                if (!ni.isUp || ni.isLoopback) continue
                for (ia in ni.interfaceAddresses) {
                    val a = ia.address
                    if (a is Inet4Address && a.isSiteLocalAddress) {
                        val ip = a.hostAddress ?: continue
                        out.add(ip.substringBeforeLast('.'))
                    }
                }
            }
        } catch (e: Exception) {
        }
        return out.toList()
    }

    private fun probe(host: String, port: Int, connectMs: Int, readMs: Int): Found? {
        return try {
            val c = URL("http://$host:$port/api/hello").openConnection() as HttpURLConnection
            c.connectTimeout = connectMs
            c.readTimeout = readMs
            c.requestMethod = "GET"
            val body = c.inputStream.bufferedReader().use { it.readText() }
            c.disconnect()
            val j = JSONObject(body)
            if (j.optString("app") == "presenter") Found(host, port, j.optString("name", host)) else null
        } catch (e: Exception) {
            null
        }
    }

    private fun scan(): List<Found> {
        val found = ConcurrentLinkedQueue<Found>()
        val hosts = ArrayList<String>()
        prefs.getString("addr", null)?.substringBefore(':')?.let { hosts.add(it) }
        for (p in localPrefixes()) for (i in 1..254) hosts.add("$p.$i")
        val pool = Executors.newFixedThreadPool(64)
        for (h in hosts.distinct()) {
            pool.execute { probe(h, 8787, 350, 700)?.let { found.add(it) } }
        }
        pool.shutdown()
        pool.awaitTermination(20, TimeUnit.SECONDS)
        return found.toList().distinctBy { it.host }
    }

    private fun pair(f: Found): PairResult {
        return try {
            val c = URL("http://${f.host}:${f.port}/api/pair").openConnection() as HttpURLConnection
            c.connectTimeout = 3000
            c.readTimeout = 75000
            c.requestMethod = "POST"
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            val body = JSONObject().put("device", deviceName()).put("id", deviceId()).toString()
            c.outputStream.use { it.write(body.toByteArray()) }
            val text = c.inputStream.bufferedReader().use { it.readText() }
            c.disconnect()
            val j = JSONObject(text)
            when {
                j.optBoolean("ok") -> PairResult("ok", j.optString("pin"))
                j.optBoolean("needPin") -> PairResult("needpin")
                j.optBoolean("busy") -> PairResult("busy")
                else -> PairResult("denied")
            }
        } catch (e: Exception) {
            PairResult("error")
        }
    }

    private fun startDiscovery() {
        if (searching) return
        searching = true
        status.text = "Looking for Presenter on your Wi-Fi…"
        foundBox.removeAllViews()
        searchBtn.visibility = View.GONE
        thread {
            val list = scan()
            runOnUiThread {
                searching = false
                if (isFinishing || onRemote) return@runOnUiThread
                when {
                    list.isEmpty() -> {
                        status.text = "Couldn't find Presenter. Open it on your computer and make sure both are on the same Wi-Fi."
                        searchBtn.visibility = View.VISIBLE
                    }
                    list.size == 1 -> connectTo(list[0])
                    else -> {
                        status.text = "Choose your computer:"
                        for (f in list) {
                            foundBox.addView(Button(this).apply {
                                text = "${f.name}  (${f.host})"
                                isAllCaps = false
                                setOnClickListener { connectTo(f) }
                            })
                        }
                        searchBtn.visibility = View.VISIBLE
                    }
                }
            }
        }
    }

    private fun connectTo(f: Found) {
        status.text = "Connecting to ${f.name}…\nIf a window appears on your computer, click Allow."
        foundBox.removeAllViews()
        searchBtn.visibility = View.GONE
        thread {
            val r = pair(f)
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                when (r.status) {
                    "ok" -> open("http://${f.host}:${f.port}/remote?pin=${r.pin}")
                    "needpin" -> open("http://${f.host}:${f.port}/remote")
                    "busy" -> {
                        status.text = "Another phone is waiting for approval. Try again in a moment."
                        searchBtn.visibility = View.VISIBLE
                    }
                    "denied" -> {
                        status.text = "The computer didn't allow this phone."
                        searchBtn.visibility = View.VISIBLE
                    }
                    else -> {
                        status.text = "Lost contact with the computer. Try again."
                        searchBtn.visibility = View.VISIBLE
                    }
                }
            }
        }
    }

    /** Re-open the last computer quickly; if it moved or is off, search the Wi-Fi again. */
    private fun reconnect(saved: String) {
        showConnect(null, false)
        status.text = "Connecting…"
        searchBtn.visibility = View.GONE
        val host = saved.substringBefore(':')
        val port = saved.substringAfter(':', "8787").toIntOrNull() ?: 8787
        thread {
            val f = probe(host, port, 1000, 1500)
            runOnUiThread {
                if (isFinishing || onRemote) return@runOnUiThread
                if (f != null) connectTo(f) else startDiscovery()
            }
        }
    }

    private fun showRemote() {
        onRemote = true
        panel.visibility = View.GONE
        web.visibility = View.VISIBLE
    }

    /** Accepts "192.168.1.23", "192.168.1.23:8787" or a full link (with ?pin= from the QR code). */
    private fun open(raw: String) {
        val text = raw.trim()
        val full = if (text.startsWith("http://") || text.startsWith("https://")) text else "http://$text"
        val uri = Uri.parse(full)
        val host = uri.host
        if (text.isEmpty() || host.isNullOrEmpty()) {
            showConnect("That address doesn't look right.", false)
            return
        }
        val port = if (uri.port == -1) 8787 else uri.port
        val base = "${uri.scheme}://$host:$port/remote"
        val pin = uri.getQueryParameter("pin")
        prefs.edit().putString("addr", "$host:$port").apply()
        showRemote()
        web.loadUrl(if (!pin.isNullOrEmpty()) "$base?pin=$pin" else base)
    }

    private fun press(id: String) {
        // Only act when the remote screen is showing (not the PIN screen).
        web.evaluateJavascript(
            "(function(){var s=document.getElementById('remoteScreen');var b=document.getElementById('$id');" +
                "if(s&&!s.classList.contains('hidden')&&b)b.click();})()", null
        )
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        val id = when (keyCode) {
            KeyEvent.KEYCODE_VOLUME_DOWN -> "nextBtn"
            KeyEvent.KEYCODE_VOLUME_UP -> "prevBtn"
            else -> null
        }
        if (onRemote && id != null) {
            if (event.repeatCount == 0) press(id)
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (onRemote) showConnect(null, false) else super.onBackPressed()
    }
}
