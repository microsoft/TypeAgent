// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.dialog.Alert
import androidx.wear.compose.material.dialog.Confirmation
import com.microsoft.typeagent.wearos.R
import kotlinx.coroutines.launch

@Composable
fun MainUI(mainState: MainViewModel) {
    MaterialTheme {
        val scope = rememberCoroutineScope()

        val lifecycleOwner = LocalLifecycleOwner.current

        // Notify the state holder whenever we become stopped to reset the state
        DisposableEffect(mainState, scope, lifecycleOwner) {
            val lifecycleObserver = object : DefaultLifecycleObserver {
                override fun onStop(owner: LifecycleOwner) {
                    super.onStop(owner)
                    scope.launch { mainState.onStopped() }
                }
            }

            lifecycleOwner.lifecycle.addObserver(lifecycleObserver)

            onDispose {
                lifecycleOwner.lifecycle.removeObserver(lifecycleObserver)
            }
        }

        SpeakerScreen(
            playbackState = mainState.playbackState,
            isPermissionDenied = mainState.isPermissionDenied,
            recordingProgress = mainState.recordingProgress,
            onMicClicked = {
                scope.launch {
                    mainState.onMicClicked()
                }
            },
            onPlayClicked = {
                scope.launch {
                    mainState.onPlayClicked()
                }
            },
            onMusicClicked = {
                scope.launch {
                    mainState.onMusicClicked()
                }
            },
            onSTTClicked = {
                scope.launch {
                    mainState.onSTTClicked("")
                }
            },
            onTakePicClicked = {
                scope.launch {
                    mainState.onSTTClicked("take a picture")
                }
            },
            onEmailPicClicked = {
                scope.launch {
                    mainState.onSTTClicked("e-mail Ted that I'm going to be late")
                }
            },
            mainState.promptDeliveryStatus
        )

        if (mainState.showPermissionRationale) {
            Alert(
                title = {
                    Text(text = stringResource(id = R.string.rationale_for_microphone_permission))
                },
                positiveButton = {
                    Button(
                        onClick = {
                            mainState.requestAudioPermission()
                            mainState.showPermissionRationale = false
                        }
                    ) {
                        Text(text = stringResource(id = R.string.ok))
                    }
                },
                negativeButton = {
                    Button(
                        onClick = {
                            mainState.showPermissionRationale = false
                        }
                    ) {
                        Text(text = stringResource(id = R.string.cancel))
                    }
                }
            )
        }

        if (mainState.showSpeakerNotSupported) {
            Confirmation(
                onTimeout = { mainState.showSpeakerNotSupported = false }
            ) {
                Text(text = stringResource(id = R.string.no_speaker_supported))
            }
        }
    }
}
