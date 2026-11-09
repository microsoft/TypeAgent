// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import androidx.compose.runtime.Composable
import androidx.wear.compose.material.MaterialTheme

@Composable
fun MainUI(mainState: MainViewModel) {
    MaterialTheme {
        SpeakerScreen(
            onVoiceCommandClicked = mainState::onVoiceCommandClicked,
            promptDeliveryStatus = mainState.promptDeliveryStatus
        )
    }
}
