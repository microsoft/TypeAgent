// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.MediaPlayer
import android.speech.RecognizerIntent
import android.util.Log
import androidx.annotation.RequiresPermission
import androidx.compose.foundation.MutatorMutex
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import com.microsoft.typeagent.wearos.R
import java.time.Duration
import java.util.Locale
import kotlin.coroutines.resume
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * State for the MainActivity
 */
class MainViewModel(
    val activity: MainActivity,
    private val requestPermission: () -> Unit
) {
    private val REQUEST_CODE_SPEECH_INPUT = 1

    private val playbackStateMutatorMutex = MutatorMutex()

    var playbackState by mutableStateOf<PlaybackState>(PlaybackState.Ready)
        private set

    var recordingProgress by mutableStateOf(0f)
        private set

    var isPermissionDenied by mutableStateOf(false)
        private set

    var showPermissionRationale by mutableStateOf(false)

    var showSpeakerNotSupported by mutableStateOf(false)

    private val soundRecorder = Recorder(activity, "audio.opus")

    suspend fun onStopped() {
        playbackStateMutatorMutex.mutate {
            playbackState = PlaybackState.Ready
        }
    }

    suspend fun onMicClicked() {
        playbackStateMutatorMutex.mutate {
            when (playbackState) {
                is PlaybackState.Ready,
                PlaybackState.PlayingVoice,
                PlaybackState.PlayingMusic,
                PlaybackState.TakePicture,
                PlaybackState.EmailPicture,
                PlaybackState.SpeechToText ->
                    // If we weren't recording, check our permission to start recording.
                    when {
                        ContextCompat.checkSelfPermission(
                            activity,
                            Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED -> {
                            // We have the permission, we can start recording now
                            playbackState = PlaybackState.Recording
                            record(
                                soundRecorder = soundRecorder,
                                setProgress = { progress ->
                                    recordingProgress = progress
                                }
                            )
                            playbackState = PlaybackState.Ready
                        }
                        activity.shouldShowRequestPermissionRationale(
                            Manifest.permission.RECORD_AUDIO
                        ) -> {
                            // If we should show the rationale prior to requesting the permission,
                            // send that event
                            showPermissionRationale = true
                            playbackState = PlaybackState.Ready
                        }
                        else -> {
                            // Request the permission
                            requestPermission()
                            playbackState = PlaybackState.Ready
                        }
                    }
                // If we were already recording, transition back to ready
                PlaybackState.Recording -> {
                    playbackState = PlaybackState.Ready
                }
            }
        }
    }

    suspend fun onMusicClicked() {
        playbackStateMutatorMutex.mutate {
            when (playbackState) {
                is PlaybackState.Ready,
                PlaybackState.PlayingVoice,
                PlaybackState.Recording,
                PlaybackState.TakePicture,
                PlaybackState.EmailPicture,
                PlaybackState.SpeechToText ->
                    if (speakerIsSupported(activity)) {
                        playbackState = PlaybackState.PlayingMusic
                        playMusic(activity)
                        playbackState = PlaybackState.Ready
                    } else {
                        showSpeakerNotSupported = true
                        playbackState = PlaybackState.Ready
                    }
                // If we were already playing, transition back to ready
                PlaybackState.PlayingMusic -> {
                    playbackState = PlaybackState.Ready
                }
            }
        }
    }

    suspend fun onPlayClicked() {
        playbackStateMutatorMutex.mutate {
            when (playbackState) {
                is PlaybackState.Ready,
                PlaybackState.PlayingMusic,
                PlaybackState.Recording,
                PlaybackState.TakePicture,
                PlaybackState.EmailPicture,
                PlaybackState.SpeechToText -> {
                    if (speakerIsSupported(activity)) {
                        playbackState = PlaybackState.PlayingVoice
                        soundRecorder.play()
                        playbackState = PlaybackState.Ready
                    } else {
                        showSpeakerNotSupported = true
                        playbackState = PlaybackState.Ready
                    }
                }
                // If we were already playing, transition back to ready
                PlaybackState.PlayingVoice -> {
                    playbackState = PlaybackState.Ready
                }
            }
        }
    }

    suspend fun onSTTClicked(reason: String) {
        activity.speechToTextOverride = reason
        playbackStateMutatorMutex.mutate {
            when (playbackState) {
                is PlaybackState.Ready,
                PlaybackState.PlayingMusic,
                PlaybackState.Recording,
                PlaybackState.PlayingVoice,
                PlaybackState.TakePicture,
                PlaybackState.EmailPicture,
                PlaybackState.SpeechToText -> {
                    speechToText()
                }
            }
        }
    }
    private fun speechToText() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)

        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE_MODEL,
            RecognizerIntent.LANGUAGE_MODEL_FREE_FORM
        )

        intent.putExtra(
            RecognizerIntent.EXTRA_LANGUAGE,
            Locale.getDefault()
        )

        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speech to text")

        try {
            ActivityCompat.startActivityForResult(
                activity,
                intent,
                REQUEST_CODE_SPEECH_INPUT,
                null
            )
        } catch (e: Exception) {
            Log.e("viewModel", e.toString())
        }
    }
}

/**
 * The states of the application.
 */
sealed class PlaybackState {
    object Ready : PlaybackState()
    object PlayingVoice : PlaybackState()
    object PlayingMusic : PlaybackState()
    object Recording : PlaybackState()
    object SpeechToText : PlaybackState()
    object TakePicture : PlaybackState()
    object EmailPicture : PlaybackState()
}

/**
 * Tells us if this device can output audio
 */
private fun speakerIsSupported(activity: Activity): Boolean {
    val hasAudioOutput =
        activity.packageManager.hasSystemFeature(PackageManager.FEATURE_AUDIO_OUTPUT)
    val devices = activity.getSystemService<AudioManager>()!!
        .getDevices(AudioManager.GET_DEVICES_OUTPUTS)

    val hasSpeaker = devices.any { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER } &&
            hasAudioOutput

    val hasBTSpeaker = devices.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP }

    return hasSpeaker || hasBTSpeaker
}

/**
 * Plays the embedded mp3 in the application.
 */
private suspend fun playMusic(activity: Activity) {
    val mediaPlayer = MediaPlayer.create(activity, R.raw.synthloop)

    try {
        // Make the asynchronous callback to a suspending coroutine
        suspendCancellableCoroutine<Unit> { cont ->
            mediaPlayer.setOnCompletionListener {
                cont.resume(Unit)
            }
            mediaPlayer.start()
        }
    } finally {
        mediaPlayer.stop()
        mediaPlayer.release()
    }
}

/**
 * Updates the progress state while recording.
 */
@RequiresPermission(Manifest.permission.RECORD_AUDIO)
private suspend fun record(
    soundRecorder: Recorder,
    setProgress: (progress: Float) -> Unit,
    maxRecordingDuration: Duration = Duration.ofSeconds(10),
    numberTicks: Int = 10
) {
    coroutineScope {
        // Kick off a parallel job to record
        val recordingJob = launch { soundRecorder.record() }

        val delayPerTickMs = maxRecordingDuration.toMillis() / numberTicks
        val startTime = System.currentTimeMillis()

        repeat(numberTicks) { index ->
            setProgress(index.toFloat() / numberTicks)
            delay(startTime + delayPerTickMs * (index + 1) - System.currentTimeMillis())
        }
        // Update the progress to be complete
        setProgress(1f)

        // Stop recording
        recordingJob.cancel()
    }
}
