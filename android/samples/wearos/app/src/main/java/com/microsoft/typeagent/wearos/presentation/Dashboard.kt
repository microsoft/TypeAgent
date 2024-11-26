// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.SpeakerNotes
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Send
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.constraintlayout.compose.ConstraintLayout
import androidx.constraintlayout.compose.ConstraintSet
import androidx.constraintlayout.compose.Dimension
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.Icon
import com.microsoft.typeagent.wearos.R

/**
 * This component is in charge of rendering the main three buttons, with both their expanded and minimized states.
 * The state of this component is managed by a [DashboardUiState], which includes a
 * [DashboardUiButtonState] for each of the three buttons.
 */
@Composable
fun Dashboard(
    dashboardUiState: DashboardUiState,
    onMicClicked: () -> Unit,
    onPlayClicked: () -> Unit,
    onMusicClicked: () -> Unit,
    onSTTClicked: () -> Unit,
    onTakePicClicked: () -> Unit,
    onEmailPicClicked: () -> Unit,
    modifier: Modifier = Modifier
) {
    val circle = Any()
    val mic = Any()
    val play = Any()
    val music = Any()
    val stt = Any()
    val takePic = Any()
    val emailPic = Any()

    val constraintSet = createConstraintSet(
        dashboardUiState = dashboardUiState,
        circle = circle,
        mic = mic,
        play = play,
        music = music,
        stt = stt,
        takePic = takePic,
        emailPic = emailPic
    )

    ConstraintLayout(
        constraintSet = constraintSet,
        modifier = modifier
    ) {
        Spacer(
            modifier = Modifier.layoutId(circle)
        )

        ControlDashboardButton(
            buttonState = dashboardUiState.micState,
            onClick = onMicClicked,
            layoutId = mic,
            imageVector = Icons.Filled.Mic,
            contentDescription = if (dashboardUiState.micState.expanded) {
                stringResource(id = R.string.stop_recording)
            } else {
                stringResource(id = R.string.record)
            }
        )

        ControlDashboardButton(
            buttonState = dashboardUiState.playState,
            onClick = onPlayClicked,
            layoutId = play,
            imageVector = Icons.Filled.PlayArrow,
            contentDescription = if (dashboardUiState.playState.expanded) {
                stringResource(id = R.string.stop_playing_recording)
            } else {
                stringResource(id = R.string.play_recording)
            }
        )

        ControlDashboardButton(
            buttonState = dashboardUiState.musicState,
            onClick = onMusicClicked,
            layoutId = music,
            imageVector = Icons.Filled.MusicNote,
            contentDescription = if (dashboardUiState.musicState.expanded) {
                stringResource(id = R.string.stop_playing_music)
            } else {
                stringResource(id = R.string.play_music)
            }
        )

        ControlDashboardButton(
            buttonState = dashboardUiState.sttState,
            onClick = onSTTClicked,
            layoutId = stt,
            imageVector = Icons.AutoMirrored.Filled.SpeakerNotes,
            contentDescription = stringResource(id = R.string.speech_to_text_in_progress)
        )

        ControlDashboardButton(
            buttonState = dashboardUiState.takePicState,
            onClick = onTakePicClicked,
            layoutId = takePic,
            imageVector = Icons.Filled.CameraAlt,
            contentDescription = stringResource(id = R.string.take_a_picture)
        )
        ControlDashboardButton(
            buttonState = dashboardUiState.emailPicState,
            onClick = onEmailPicClicked,
            layoutId = emailPic,
            imageVector = Icons.Filled.Send,
            contentDescription = stringResource(id = R.string.email_picture)
        )
    }
}

/**
 * Constructs the [ConstraintSet] for the [dashboardUiState].
 * The parameters [circle], [mic], [play], and [music] are utilized as keys for the constraints.
 */
@Composable
private fun createConstraintSet(
    dashboardUiState: DashboardUiState,
    circle: Any,
    mic: Any,
    play: Any,
    music: Any,
    stt: Any,
    takePic: Any,
    emailPic: Any
): ConstraintSet {
    val iconCircleRadius = 60.dp
    val iconMinimizedSize = 54.dp
    val iconExpandedSize = 136.dp

    val micSize by animateDpAsState(
        targetValue = if (dashboardUiState.micState.expanded) {
            iconExpandedSize
        } else {
            iconMinimizedSize
        }, label = ""
    )
    val micRadius by animateDpAsState(
        targetValue = if (dashboardUiState.micState.expanded) 0.dp else iconCircleRadius,
        label = ""
    )

    val playSize by animateDpAsState(
        targetValue = if (dashboardUiState.playState.expanded) {
            iconExpandedSize
        } else {
            iconMinimizedSize
        }, label = ""
    )
    val playRadius by animateDpAsState(
        targetValue = if (dashboardUiState.playState.expanded) 0.dp else iconCircleRadius,
        label = ""
    )

    val musicSize by animateDpAsState(
        targetValue = if (dashboardUiState.musicState.expanded) {
            iconExpandedSize
        } else {
            iconMinimizedSize
        }, label = ""
    )
    val musicRadius by animateDpAsState(
        targetValue = if (dashboardUiState.musicState.expanded) 0.dp else iconCircleRadius,
        label = ""
    )

    val sttSize by animateDpAsState(
        targetValue = if (dashboardUiState.sttState.expanded) {
            iconExpandedSize - 10.dp
        } else {
            iconMinimizedSize
        }, label = ""
    )
    val sttRadius by animateDpAsState(
        targetValue = if (dashboardUiState.sttState.expanded) 0.dp else iconCircleRadius,
        label = ""
    )

    val takePicSize by animateDpAsState(
        targetValue = if (dashboardUiState.takePicState.expanded) {
            iconExpandedSize - 10.dp
        } else {
            iconMinimizedSize
        }, label = ""
    )
    val takePicRadius by animateDpAsState(
        targetValue = if (dashboardUiState.takePicState.expanded) 0.dp else iconCircleRadius,
        label = ""
    )

    val emailPicSize by animateDpAsState(
        targetValue = if (dashboardUiState.emailPicState.expanded) {
            iconExpandedSize - 10.dp
        } else {
            iconMinimizedSize
        }, label = ""
    )
    val emailPicRadius by animateDpAsState(
        targetValue = if (dashboardUiState.emailPicState.expanded) 0.dp else iconCircleRadius,
        label = ""
    )

    return ConstraintSet {
        val circleRef = createRefFor(circle)
        val micRef = createRefFor(mic)
        val playRef = createRefFor(play)
        val musicRef = createRefFor(music)
        val sttRef = createRefFor(stt)
        val takePicRef = createRefFor(takePic)
        val emailPicRef = createRefFor(emailPic)
        val startAngle: Float = 20F
        val angle: Float = 360F / 5F

        constrain(circleRef) { centerTo(parent) }
        constrain(micRef) {
            width = Dimension.value(micSize)
            height = Dimension.value(micSize)
            circular(circleRef, 0f, 0.dp)
        }
        constrain(playRef) {
            width = Dimension.value(playSize)
            height = Dimension.value(playSize)
            circular(circleRef, startAngle, playRadius)
        }
        constrain(musicRef) {
            width = Dimension.value(musicSize)
            height = Dimension.value(musicSize)
            circular(circleRef, startAngle + angle, musicRadius)
        }
        constrain(sttRef) {
            width = Dimension.value(sttSize)
            height = Dimension.value(sttSize)
            circular(circleRef, startAngle + 2 * angle, sttRadius)
        }
        constrain(takePicRef) {
            width = Dimension.value(takePicSize)
            height = Dimension.value(takePicSize)
            circular(circleRef, startAngle + 3 * angle, takePicRadius)
        }
        constrain(emailPicRef) {
            width = Dimension.value(emailPicSize)
            height = Dimension.value(emailPicSize)
            circular(circleRef, startAngle + 4 * angle, emailPicRadius)
        }
    }
}

/**
 * Represents a single button on the control dashboard
 */
@Composable
private fun ControlDashboardButton(
    buttonState: DashboardUiButtonState,
    onClick: () -> Unit,
    layoutId: Any,
    imageVector: ImageVector,
    contentDescription: String
) {
    val iconPadding = 8.dp
    val alpha by animateFloatAsState(
        targetValue = if (buttonState.visible) 1f else 0f, label = ""
    )

    Button(
        modifier = Modifier
            .fillMaxSize()
            .alpha(alpha)
            .layoutId(layoutId),
        enabled = buttonState.enabled && buttonState.visible,
        onClick = onClick
    ) {
        Icon(
            imageVector = imageVector,
            contentDescription = contentDescription,
            modifier = Modifier
                .fillMaxSize()
                .padding(iconPadding)
        )
    }
}

/**
 * Represents the state for a single [ControlDashboardButton].
 */
data class DashboardUiButtonState(
    val expanded: Boolean,
    val enabled: Boolean,
    val visible: Boolean
)

/**
 *  [Dashboard] state.
 */
data class DashboardUiState(
    val micState: DashboardUiButtonState,
    val playState: DashboardUiButtonState,
    val musicState: DashboardUiButtonState,
    val sttState: DashboardUiButtonState,
    val takePicState: DashboardUiButtonState,
    val emailPicState: DashboardUiButtonState
) {
    init {
        // Ensure that only one button is expanded at any given time
        require(
            listOf(
                micState.expanded,
                playState.expanded,
                musicState.expanded,
                sttState.expanded,
                takePicState.expanded,
                emailPicState.expanded
            ).count { it } <= 1
        )
    }
}
