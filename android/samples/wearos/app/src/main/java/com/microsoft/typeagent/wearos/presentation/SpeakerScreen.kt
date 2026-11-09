// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.SpeakerNotes
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ExperimentalWearMaterialApi
import androidx.wear.compose.material.Icon
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.tooling.preview.devices.WearDevices
import com.microsoft.typeagent.wearos.R

/**
 * The composable responsible for displaying the main UI.
 *
 * This composable is stateless, and simply displays the state given to it.
 */
@OptIn(ExperimentalWearMaterialApi::class)
@Composable
fun SpeakerScreen(
    onVoiceCommandClicked: () -> Unit,
    promptDeliveryStatus: String
) {
    Scaffold(
        timeText = {
            TimeText()
        }
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Button(
                onClick = onVoiceCommandClicked,
                modifier = Modifier.size(80.dp)
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.SpeakerNotes,
                    contentDescription = stringResource(R.string.speak_to_typeagent),
                    modifier = Modifier.size(40.dp)
                )
            }

            Text(
                text = stringResource(R.string.speak_to_typeagent),
                modifier = Modifier.padding(top = 8.dp),
                maxLines = 1,
                textAlign = TextAlign.Center
            )

            if (promptDeliveryStatus.isNotBlank()) {
                Text(
                    text = promptDeliveryStatus,
                    modifier = Modifier.padding(top = 8.dp),
                    maxLines = 1,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}

@Preview(
    device = WearDevices.SMALL_ROUND,
    showSystemUi = true,
    widthDp = 200,
    heightDp = 200,
    uiMode = Configuration.UI_MODE_TYPE_WATCH
)
@Composable
fun SpeakerScreenPreview() {
    SpeakerScreen(
        onVoiceCommandClicked = {},
        promptDeliveryStatus = "Handed to phone"
    )
}
