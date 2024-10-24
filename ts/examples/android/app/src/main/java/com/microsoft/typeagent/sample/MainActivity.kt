package com.microsoft.typeagent.sample

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.zIndex
import com.microsoft.typeagent.sample.ui.theme.TypeAgentAndroidSampleTheme

class MainActivity : ComponentActivity() {
    @OptIn(ExperimentalMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            TypeAgentAndroidSampleTheme {
                Scaffold(modifier = Modifier.fillMaxSize(),
                        topBar = { TopAppBar(title = { Text("WebView - Test", color = Color.White) }) }, ) {
                    innerPadding ->
                    Browser()
                    Greeting(
                        name = "Android",
                        modifier = Modifier.padding(innerPadding)
                    )
                }
            }
        }
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
@Preview
fun Browser() {
    val url = "http://10.0.2.2:3000"
    var wvv: WebView? = null

    Column() {
        Button(modifier = Modifier.width(75.dp).height(30.dp).zIndex(10000F), onClick = { wvv?.reload()}) { Text(text = "Refresh") }
        AndroidView(factory = {
            //val wv = WebView(it)
            wvv = WebView(it)
            wvv!!.apply {
                settings.javaScriptEnabled = true
                layoutParams = ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
                webViewClient = WebViewClient()
                loadUrl(url)
            }
        }, update = {
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