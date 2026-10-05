// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.microsoft.typeagent.wearos.R

/**
 * State for the MainActivity
 */
class MainViewModel(
    private val activity: MainActivity,
    private val requestSpeechRecognition: () -> Unit,
    private val remotePromptSender: RemotePromptSender
) {
    var promptDeliveryStatus by mutableStateOf("")
        private set

    fun onVoiceCommandClicked() {
        requestSpeechRecognition()
    }

    suspend fun onSpeechRecognized(text: String) {
        promptDeliveryStatus = activity.getString(R.string.prompt_sending)
        promptDeliveryStatus = when (remotePromptSender.send(text)) {
            RemotePromptResult.HandedToPhone ->
                activity.getString(R.string.prompt_handed_to_phone)
            RemotePromptResult.PhoneUnreachable ->
                activity.getString(R.string.phone_unavailable)
            RemotePromptResult.PromptTooLong ->
                activity.getString(R.string.prompt_too_long)
            RemotePromptResult.Failed ->
                activity.getString(R.string.prompt_send_failed)
        }
    }

    fun onSpeechRecognitionUnavailable() {
        promptDeliveryStatus =
            activity.getString(R.string.speech_recognition_unavailable)
    }
}
