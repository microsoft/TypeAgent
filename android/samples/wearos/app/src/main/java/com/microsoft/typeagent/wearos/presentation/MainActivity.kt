// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.microsoft.typeagent.wearos.R
import java.util.Locale
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private var speechToTextOverride = ""

    private val requestAudioPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    private val recognizeSpeech = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode != Activity.RESULT_OK) {
            speechToTextOverride = ""
            return@registerForActivityResult
        }

        val recognizedText = speechToTextOverride.ifBlank {
            result.data
                ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
                ?.firstOrNull()
                .orEmpty()
        }
        speechToTextOverride = ""
        if (recognizedText.isBlank()) {
            return@registerForActivityResult
        }

        lifecycleScope.launch {
            mainState.onSpeechRecognized(recognizedText)
        }
    }

    private lateinit var mainState: MainViewModel

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val remoteActivityHelper = RemoteActivityHelper(
            this,
            ContextCompat.getMainExecutor(this)
        )
        mainState = MainViewModel(
            activity = this,
            requestPermission = {
                requestAudioPermission.launch(Manifest.permission.RECORD_AUDIO)
            },
            requestSpeechRecognition = { overrideText ->
                speechToTextOverride = overrideText
                try {
                    recognizeSpeech.launch(
                        Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                            putExtra(
                                RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                                RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
                            )
                            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                            putExtra(
                                RecognizerIntent.EXTRA_PROMPT,
                                getString(R.string.speech_to_text_prompt)
                            )
                        }
                    )
                } catch (_: ActivityNotFoundException) {
                    speechToTextOverride = ""
                    mainState.onSpeechRecognitionUnavailable()
                }
            },
            remotePromptSender = RemotePromptSender(remoteActivityHelper)
        )

        setContent {
            MainUI(mainState)
        }
    }
}
