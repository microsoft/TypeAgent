// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

package com.microsoft.typeagent.wearos.presentation

import android.Manifest
import android.content.Context
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.util.Log
import androidx.annotation.RequiresPermission
import kotlinx.coroutines.ExperimentalCoroutinesApi
import java.io.File
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Records audio from the MIC and plays back the same recorded audio file.
 */
class Recorder(
    private val context: Context,
    private val outputFileName: String
) {

    companion object {
        private const val TAG = "Recorder"
    }

    /**
     * The audio recording
      */
    private val audioFile = File(context.filesDir, outputFileName)

    /**
     * The current audio state
     */
    private var state = State.IDLE

    /**
     * The possible audio states
     */
    private enum class State {
        IDLE, RECORDING, PLAYING
    }

    /**
     * Plays the recording
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    suspend fun play() {
        if (state != State.IDLE) {
            Log.w(TAG, "Not IDLE!")
            return
        }

        // Is there anything to play?
        if (!audioFile.exists()) return

        suspendCancellableCoroutine { cont ->
            state = State.PLAYING

            val mediaPlayer = MediaPlayer().apply {
                setDataSource(audioFile.path)
                setOnInfoListener { mr, what, extra ->
                    println("info: $mr $what $extra")
                    true
                }
                setOnErrorListener { mr, what, extra ->
                    println("error: $mr $what $extra")
                    true
                }
                setOnCompletionListener {
                    reset()
                    release()
                    state = State.IDLE
                    cont.resume(value = Unit, onCancellation = {})
                }
            }

            mediaPlayer.prepare()

            mediaPlayer.start()

            cont.invokeOnCancellation {
                mediaPlayer.stop()
                mediaPlayer.reset()
                mediaPlayer.release()
            }
        }
    }

    /**
     * Records from the mic
     */
    @RequiresPermission(Manifest.permission.RECORD_AUDIO)
    suspend fun record() {
        if (state != State.IDLE) {
            Log.w(TAG, "Not IDLE!")
            return
        }

        suspendCancellableCoroutine<Unit> { cont ->
            @Suppress("DEPRECATION")
            val mediaRecorder = MediaRecorder().apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.OGG)
                setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
                setOutputFile(audioFile.path)
                setOnInfoListener { mr, what, extra ->
                    println("info: $mr $what $extra")
                }
                setOnErrorListener { mr, what, extra ->
                    println("error: $mr $what $extra")
                }
            }

            cont.invokeOnCancellation {
                mediaRecorder.stop()
                state = State.IDLE
            }

            mediaRecorder.prepare()
            mediaRecorder.start()

            state = State.RECORDING
        }
    }
}
