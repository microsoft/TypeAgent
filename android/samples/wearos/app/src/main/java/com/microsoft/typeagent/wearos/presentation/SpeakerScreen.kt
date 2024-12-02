// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import android.content.res.Configuration
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.tooling.preview.PreviewParameter
import androidx.compose.ui.tooling.preview.datasource.CollectionPreviewParameterProvider
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.constraintlayout.compose.ConstraintLayout
import androidx.constraintlayout.compose.Dimension
import androidx.wear.compose.material.ExperimentalWearMaterialApi
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.tooling.preview.devices.WearDevices

/**
 * The composable responsible for displaying the main UI.
 *
 * This composable is stateless, and simply displays the state given to it.
 */
@OptIn(ExperimentalWearMaterialApi::class)
@Composable
fun SpeakerScreen(
    playbackState: PlaybackState,
    isPermissionDenied: Boolean,
    recordingProgress: Float,
    onMicClicked: () -> Unit,
    onPlayClicked: () -> Unit,
    onMusicClicked: () -> Unit,
    onSTTClicked: () -> Unit,
    onTakePicClicked: () -> Unit,
    onEmailPicClicked: () -> Unit,
    stt: String
) {
    Scaffold(
        timeText = {
            TimeText()
        }
    ) {
        // Determine the control dashboard state.
        // This converts the main app state into a control dashboard state for rendering
        val controlDashboardUiState = computeControlDashboardUiState(
            playbackState = playbackState,
            isPermissionDenied = isPermissionDenied
        )

        // The progress bar should only be visible when actively recording
        val isProgressVisible =
            when (playbackState) {
                PlaybackState.PlayingMusic,
                PlaybackState.PlayingVoice,
                is PlaybackState.Ready -> false
                PlaybackState.Recording -> true
                else -> false
            }

        // Speech to text
        val isSTTVisible =
            when (playbackState) {
                PlaybackState.PlayingVoice,
                is PlaybackState.PlayingVoice -> true
                else -> false
            }

        // We are using ConstraintLayout here to center the ControlDashboard, and align the progress
        // indicator to it.
        // In general, ConstraintLayout is less necessary for Compose than it was for Views
        ConstraintLayout(
            modifier = Modifier.fillMaxSize()
        ) {
            val (controlDashboard, progressBar, sttText) = createRefs()

            Dashboard(
                dashboardUiState = controlDashboardUiState,
                onMicClicked = onMicClicked,
                onPlayClicked = onPlayClicked,
                onMusicClicked = onMusicClicked,
                onSTTClicked = onSTTClicked,
                onTakePicClicked = onTakePicClicked,
                onEmailPicClicked = onEmailPicClicked,
                modifier = Modifier
                    .constrainAs(controlDashboard) {
                        centerTo(parent)
                    }
            )

            AnimatedVisibility(
                visible = isProgressVisible,
                modifier = Modifier
                    .constrainAs(progressBar) {
                        width = Dimension.fillToConstraints
                        top.linkTo(controlDashboard.bottom, 5.dp)
                        start.linkTo(controlDashboard.start)
                        end.linkTo(controlDashboard.end)
                    }
            ) {
                ProgressBar(
                    progress = recordingProgress
                )
            }

            AnimatedVisibility(
                visible = isSTTVisible,
                modifier = Modifier
                    .constrainAs(sttText) {
                        width = Dimension.fillToConstraints
                        top.linkTo(controlDashboard.bottom)
                        start.linkTo(controlDashboard.start)
                        end.linkTo(controlDashboard.end)
                    }
            ) {
                Text(stt,
                    fontSize = 10.sp,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

private fun computeControlDashboardUiState(
    playbackState: PlaybackState,
    isPermissionDenied: Boolean
): DashboardUiState =
    when (playbackState) {
        PlaybackState.PlayingMusic -> DashboardUiState(
            micState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            playState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            musicState = DashboardUiButtonState(
                expanded = true,
                enabled = true,
                visible = true
            ),
            sttState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            takePicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            emailPicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            )
        )
        PlaybackState.PlayingVoice -> DashboardUiState(
            micState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            playState = DashboardUiButtonState(
                expanded = true,
                enabled = true,
                visible = true
            ),
            musicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            sttState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            takePicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            emailPicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            )
        )
        PlaybackState.Ready -> DashboardUiState(
            micState = DashboardUiButtonState(
                expanded = false,
                enabled = !isPermissionDenied,
                visible = true
            ),
            playState = DashboardUiButtonState(
                expanded = false,
                enabled = true,
                visible = true
            ),
            musicState = DashboardUiButtonState(
                expanded = false,
                enabled = true,
                visible = true
            ),
            sttState = DashboardUiButtonState(
                expanded = false,
                enabled = true,
                visible = true
            ),
            takePicState = DashboardUiButtonState(
                expanded = false,
                enabled = true,
                visible = true
            ),
            emailPicState = DashboardUiButtonState(
                expanded = false,
                enabled = true,
                visible = true
            )
        )
        PlaybackState.Recording -> DashboardUiState(
            micState = DashboardUiButtonState(
                expanded = true,
                enabled = true,
                visible = true
            ),
            playState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            musicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            sttState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            takePicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            emailPicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            )
        )
        PlaybackState.SpeechToText -> DashboardUiState(
            micState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            playState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            musicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            sttState = DashboardUiButtonState(
                expanded = true,
                enabled = true,
                visible = true
            ),
            takePicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            emailPicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            )
        )
        PlaybackState.TakePicture -> DashboardUiState(
            micState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            playState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            musicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            sttState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            takePicState = DashboardUiButtonState(
                expanded = true,
                enabled = true,
                visible = true
            ),
            emailPicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            )
        )
        PlaybackState.EmailPicture -> DashboardUiState(
            micState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            playState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            musicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            sttState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            takePicState = DashboardUiButtonState(
                expanded = false,
                enabled = false,
                visible = false
            ),
            emailPicState = DashboardUiButtonState(
                expanded = true,
                enabled = true,
                visible = true
            )
        )
    }

private class PlaybackStatePreviewProvider : CollectionPreviewParameterProvider<PlaybackState>(
    listOf(
        PlaybackState.Ready,
        PlaybackState.Recording,
        PlaybackState.PlayingVoice,
        PlaybackState.PlayingMusic,
        PlaybackState.SpeechToText,
        PlaybackState.TakePicture,
        PlaybackState.EmailPicture
    )
)

@Preview(
    device = WearDevices.SMALL_ROUND,
    showSystemUi = true,
    widthDp = 200,
    heightDp = 200,
    uiMode = Configuration.UI_MODE_TYPE_WATCH
)
@Composable
fun SpeakerScreenPreview(
    @PreviewParameter(PlaybackStatePreviewProvider::class) playbackState: PlaybackState
) {
    SpeakerScreen(
        playbackState = playbackState,
        isPermissionDenied = true,
        recordingProgress = 0.25f,
        onMicClicked = {},
        onPlayClicked = {},
        onMusicClicked = {},
        onSTTClicked = {},
        onTakePicClicked = {},
        onEmailPicClicked = {},

        "Preview Text!"
    )
}
