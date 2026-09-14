// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import android.content.Intent
import android.net.Uri
import androidx.concurrent.futures.await
import androidx.wear.remote.interactions.RemoteActivityHelper

sealed interface RemotePromptResult {
    data object Sent : RemotePromptResult
    data object PhoneUnreachable : RemotePromptResult
}

class RemotePromptSender(
    private val remoteActivityHelper: RemoteActivityHelper
) {
    suspend fun send(prompt: String): RemotePromptResult {
        val text = prompt.trim()
        if (text.isEmpty()) {
            throw IllegalArgumentException("Prompt is empty")
        }

        val intent = Intent(Intent.ACTION_VIEW)
            .setData(
                Uri.Builder()
                    .scheme(WEAR_LINK_SCHEME)
                    .authority(WEAR_LINK_HOST)
                    .appendQueryParameter(WEAR_EXECUTE_PARAM, "true")
                    .appendQueryParameter(WEAR_PROMPT_PARAM, text)
                    .build()
            )
            .putExtra(WEAR_PROMPT_PARAM, text)
            .addCategory(Intent.CATEGORY_BROWSABLE)

        return try {
            remoteActivityHelper.startRemoteActivity(intent, null).await()
            RemotePromptResult.Sent
        } catch (error: RemoteActivityHelper.RemoteIntentException) {
            RemotePromptResult.PhoneUnreachable
        }
    }

    private companion object {
        const val WEAR_LINK_SCHEME = "typeagentchat"
        const val WEAR_LINK_HOST = "main"
        const val WEAR_PROMPT_PARAM = "prompt"
        const val WEAR_EXECUTE_PARAM = "execute"
    }
}
