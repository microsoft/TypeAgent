// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.ManagedActivityResultLauncher
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts.RequestPermission
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.platform.LocalContext
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
fun MainUI() {
    MaterialTheme {
        lateinit var permissionsLauncher: ManagedActivityResultLauncher<String, Boolean>

        val context = LocalContext.current
        val activity = context.findActivity()
        val scope = rememberCoroutineScope()

        val mainState = remember(activity) {
            MainViewModel(
                activity = activity as MainActivity,
                requestPermission = {
                    permissionsLauncher.launch(Manifest.permission.RECORD_AUDIO)
                }
            )
        }

        permissionsLauncher = rememberLauncherForActivityResult(RequestPermission()) {
            // We ignore the direct result here, since we're going to check anyway.
            scope.launch {
                //mainState.permissionResultReturned()
            }
        }

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
            (mainState.activity as MainActivity).speechToTextText
        )

        if (mainState.showPermissionRationale) {
            Alert(
                title = {
                    Text(text = stringResource(id = R.string.rationale_for_microphone_permission))
                },
                positiveButton = {
                    Button(
                        onClick = {
                            permissionsLauncher.launch(Manifest.permission.RECORD_AUDIO)
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

/**
 * Find the closest Activity in a given Context.
 */
private tailrec fun Context.findActivity(): Activity =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> throw IllegalStateException(
            "findActivity() should be called in the context of an Activity"
        )
    }
