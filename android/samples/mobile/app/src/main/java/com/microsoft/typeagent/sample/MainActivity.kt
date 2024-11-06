package com.microsoft.typeagent.sample

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Bundle
import android.speech.RecognizerIntent
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.zIndex
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.microsoft.typeagent.sample.ui.theme.TypeAgentAndroidSampleTheme
import de.andycandy.android.bridge.Bridge
import java.util.Locale

class MainActivity : ComponentActivity() {

    /**
     * Companion object that exposes the current activity so the background
     * service can do stuff on the UI
     */
    companion object {
        /**
         * Used when STT is complete
         */
        private const val SPEECH_TO_TEXT_COMPLETE : Int = 1

        public var currentActivity : MainActivity? = null
    }

    /**
     * Permissions request for speeech reco
     */
    private val MY_PERMISSIONS_STT = 1234

    /**
     * Javascript bridge
     */
    private var jsi: JavaScriptInterface? = null

    /**
     * The webview
     */
    private var wvv: WebView? = null

    @OptIn(ExperimentalMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // request permissions needed to run
        requestPermissions()

        // set a reference to the currently running activity
        currentActivity = this


        enableEdgeToEdge()
        setContent {
            TypeAgentAndroidSampleTheme {
                Scaffold(
                    modifier = Modifier.fillMaxSize(),
                    topBar = { TopAppBar(title = { Text("WebView - Test", color = Color.White) }) },
                ) { innerPadding ->
                    Browser()
                    Greeting(
                        name = "Android",
                        modifier = Modifier.padding(innerPadding)
                    )
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Composable
    @Preview
    fun Browser() {
        val url = "http://10.0.2.2:3000"
        //val url = "http://192.168.1.142:3000/"

        Column() {
            Button(
                modifier = Modifier.width(75.dp).height(30.dp).zIndex(10000F),
                onClick = { wvv?.reload() }) { Text(text = "Refresh") }
            AndroidView(factory = {

                //val wv = WebView(it)
                wvv = WebView(it)
                val bridge = Bridge(applicationContext, wvv!!)
                jsi = JavaScriptInterface(it);
                bridge.addJSInterface(jsi!!)
                wvv!!.apply {
                    // web view settings
                    settings.javaScriptEnabled = true

                    // web view layout
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )

                    // javascript callback
                    addJavascriptInterface(jsi!!, "Android")

                    // url/client
                    webViewClient = object : WebViewClient() {
                        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                            bridge.init()
                        }
                    }

                    loadUrl(url)
                }
            }, update = {
                jsi!!.context = it.context
                it.loadUrl(url)
            }, modifier = Modifier.fillMaxSize())
        }
    }

    @Composable
    fun Greeting(name: String, modifier: Modifier = Modifier) {
        Text(
            text = "Hello $name!",
            modifier = modifier
        )
    }

    @Preview(showBackground = true)
    @Composable
    fun GreetingPreview() {
        TypeAgentAndroidSampleTheme {
            Greeting("Android")
        }
    }

    /**
     * Requests the permissions needed in sequence.
     */
    private fun requestPermissions(): Boolean {
        // Check for valid permissions
        val perms = arrayOf(
            android.Manifest.permission.INTERNET,
            android.Manifest.permission.CAMERA,
            android.Manifest.permission.SET_ALARM,
            android.Manifest.permission.ACCESS_FINE_LOCATION,
            android.Manifest.permission.RECORD_AUDIO,
            android.Manifest.permission.ACCESS_COARSE_LOCATION,
            android.Manifest.permission.POST_NOTIFICATIONS,
            android.Manifest.permission.SEND_SMS
        )

        var permissionsNeeded: Boolean = false

        perms.forEach {
            val granted = ContextCompat.checkSelfPermission(this, it)

            permissionsNeeded = permissionsNeeded || (granted != PackageManager.PERMISSION_GRANTED)
        }

        if (permissionsNeeded) {
            // Permission not granted, ask for them

            if (ActivityCompat.shouldShowRequestPermissionRationale(
                    this,
                    android.Manifest.permission.RECORD_AUDIO
                )
            ) {
                Toast.makeText(
                    this,
                    "Please grant permissions needed for this application otherwise functionality will be limited.",
                    Toast.LENGTH_LONG
                ).show()

                // Give user option to still opt-in the permissions
                ActivityCompat.requestPermissions(
                    this, perms,
                    MY_PERMISSIONS_STT
                )
            } else {
                // Show user dialog to grant permission to record audio
                ActivityCompat.requestPermissions(
                    this, perms,
                    MY_PERMISSIONS_STT
                )
            }
        } else {
            // permissions already granted
            return true
        }

        return false
    }

    /**
     * Launches the recognize speech intent
     */
    public fun speechToText(recoId: Int) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)

        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        )

        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE,
            Locale.getDefault()
        )

        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Ask away...")

        try {
            ActivityCompat.startActivityForResult(
                MainActivity.currentActivity!!,
                intent,
                SPEECH_TO_TEXT_COMPLETE + recoId,
                null
            )
        } catch (e: Exception) {
            Log.e("error", e.toString())
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        // Check which request we're responding to
        if (requestCode >= MainActivity.SPEECH_TO_TEXT_COMPLETE) {
            // Make sure the request was successful
            if (resultCode == Activity.RESULT_OK && data != null) {
                val speech : ArrayList<String>? = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)

                jsi?.recognitionComplete(requestCode - MainActivity.SPEECH_TO_TEXT_COMPLETE, speech.toString())

            } else {
                jsi?.recognitionComplete(requestCode - MainActivity.SPEECH_TO_TEXT_COMPLETE, null)
            }
        }
    }
}