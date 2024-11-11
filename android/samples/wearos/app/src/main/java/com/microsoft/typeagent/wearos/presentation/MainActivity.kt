// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.wear.remote.interactions.RemoteActivityHelper
import java.util.Objects
import java.util.concurrent.Executors

/**
 * MainActivty for this application.
 */
class MainActivity : ComponentActivity() {

    private val REQUEST_CODE_SPEECH_INPUT = 1

    /**
     * The speech to text result
     */
    var speechToTextText: String = ""

    /**
     * The speech to text override
     */
    var speechToTextOverride: String by mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MainUI()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)

        if (requestCode == REQUEST_CODE_SPEECH_INPUT) {
            if (resultCode == RESULT_OK && data != null) {

                val res: ArrayList<String> =
                    data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) as ArrayList<String>

                // Do we use a baked in shortcut/text or the one that was recognized?
                if (speechToTextOverride.isNotBlank()) {
                    this.speechToTextText = this.speechToTextOverride
                } else {
                    this.speechToTextText = Objects.requireNonNull(res)[0]
                }

                remoteLaunch()
            }
        }
    }

    private fun remoteLaunch() {

        val remoteActivityHelper = RemoteActivityHelper(this, Executors.newSingleThreadExecutor())

        val result = remoteActivityHelper.startRemoteActivity(
            Intent(Intent.ACTION_VIEW)
                .setData(Uri.parse("typeagent://main?execute=true&prompt=${this.speechToTextText}"))
                .putExtra("prompt", this.speechToTextText)
                .addCategory(Intent.CATEGORY_BROWSABLE),
            null
        )

        println("wearsample $result")
    }
}
