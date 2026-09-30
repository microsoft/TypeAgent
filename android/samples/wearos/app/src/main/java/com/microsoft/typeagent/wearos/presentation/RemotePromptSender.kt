// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.concurrent.futures.await
import androidx.wear.remote.interactions.RemoteActivityHelper
import kotlinx.coroutines.CancellationException

sealed interface RemotePromptResult {
    data object HandedToPhone : RemotePromptResult
    data object PhoneUnreachable : RemotePromptResult
    data object PromptTooLong : RemotePromptResult
    data object Failed : RemotePromptResult
}

class RemotePromptSender(
    private val remoteActivityHelper: RemoteActivityHelper
) {
    suspend fun send(prompt: String): RemotePromptResult {
        val text = prompt.trim()
        if (text.isEmpty()) {
            throw IllegalArgumentException("Prompt is empty")
        }
        if (text.length > WEAR_PROMPT_MAX_LENGTH) {
            return RemotePromptResult.PromptTooLong
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
            RemotePromptResult.HandedToPhone
        } catch (_: RemoteActivityHelper.RemoteIntentException) {
            RemotePromptResult.PhoneUnreachable
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            Log.e(TAG, "Could not hand prompt to phone", error)
            RemotePromptResult.Failed
        }
    }

    private companion object {
        const val TAG = "RemotePromptSender"
        // Keep this link contract in sync with mobile-2/WearPromptLink.kt.
        const val WEAR_LINK_SCHEME = "typeagentchat"
        const val WEAR_LINK_HOST = "main"
        const val WEAR_PROMPT_PARAM = "prompt"
        const val WEAR_EXECUTE_PARAM = "execute"
        const val WEAR_PROMPT_MAX_LENGTH = 1_000
    }
}
