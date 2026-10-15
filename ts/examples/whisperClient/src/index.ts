// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getLocalWhisperTranscription } from "@typeagent/common-utils";

class WhisperRecognizer {
    private audioContext: AudioContext | null = null;
    private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
    private analyser: AnalyserNode | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private silenceTimeout: ReturnType<typeof setTimeout> | null = null;
    private recordingId = 0;
    private awaitingResult = false;
    private transcriptionFailed = false;
    private errorCallback: ((error: Error) => void) | undefined;
    private recognizingCallback:
        | ((result: { text: string }) => void)
        | undefined;
    private recognizedCallback:
        | ((result: { text: string }) => void)
        | undefined;
    private audioChunks: Blob[] = [];

    constructor() {
        navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
            this.audioContext = new AudioContext();
            this.mediaStreamSource =
                this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.minDecibels = -100;
            this.mediaStreamSource.connect(this.analyser);

            this.mediaRecorder = new MediaRecorder(stream);
            this.mediaRecorder.ondataavailable = async (e) => {
                const recordingId = this.recordingId;
                if (this.transcriptionFailed) {
                    return;
                }
                this.audioChunks.push(e.data);

                if (
                    this.mediaRecorder!.state === "inactive" ||
                    !this.awaitingResult
                ) {
                    const blob = new Blob(this.audioChunks, {
                        type: "audio/mpeg-3",
                    });
                    try {
                        const text = await this.getTranscription(
                            blob,
                            recordingId,
                        );
                        if (
                            recordingId !== this.recordingId ||
                            this.transcriptionFailed
                        ) {
                            return;
                        }
                        if (this.mediaRecorder!.state === "inactive") {
                            if (this.recognizedCallback) {
                                this.recognizedCallback({ text });
                            }
                        } else {
                            if (this.recognizingCallback) {
                                this.recognizingCallback({ text });
                            }
                        }
                    } catch (error) {
                        if (
                            recordingId !== this.recordingId ||
                            this.transcriptionFailed
                        ) {
                            return;
                        }
                        this.transcriptionFailed = true;
                        if (this.mediaRecorder?.state === "recording") {
                            this.mediaRecorder.stop();
                        }
                        const failure =
                            error instanceof Error
                                ? error
                                : new Error(String(error));
                        console.error("Local transcription failed:", failure);
                        this.errorCallback?.(failure);
                    }
                }
            };
        });
    }

    startRecording() {
        this.recordingId++;
        this.audioChunks = [];
        this.awaitingResult = false;
        this.transcriptionFailed = false;
        if (this.silenceTimeout) {
            clearTimeout(this.silenceTimeout);
            this.silenceTimeout = null;
        }
        this.mediaRecorder?.start(200);
        this.checkForSilence(this.recordingId);
    }

    stopRecording() {
        this.mediaRecorder?.stop();
    }

    onRecognizing(callback: (result: { text: string }) => void) {
        this.recognizingCallback = callback;
    }

    onRecognized(callback: (result: { text: string }) => void) {
        this.recognizedCallback = callback;
    }

    onError(callback: (error: Error) => void) {
        this.errorCallback = callback;
    }

    private async getTranscription(
        blob: Blob,
        recordingId: number,
    ): Promise<string> {
        this.awaitingResult = true;
        try {
            return await getLocalWhisperTranscription(blob);
        } finally {
            if (recordingId === this.recordingId) {
                this.awaitingResult = false;
            }
        }
    }

    private checkForSilence(recordingId: number) {
        if (
            recordingId !== this.recordingId ||
            this.transcriptionFailed ||
            this.mediaRecorder?.state !== "recording"
        ) {
            return;
        }
        const bufferLength = this.analyser!.fftSize;
        const amplitudeArray = new Float32Array(bufferLength || 0);
        const silenceDuration = 1000;
        const silenceThreshold = -50;

        this.analyser!.getFloatTimeDomainData(amplitudeArray);

        const volume = this.getVolume(amplitudeArray);

        if (volume < silenceThreshold) {
            if (!this.silenceTimeout) {
                this.silenceTimeout = setTimeout(() => {
                    if (recordingId !== this.recordingId) {
                        return;
                    }
                    if (this.mediaRecorder?.state === "recording") {
                        this.mediaRecorder.stop();
                    }
                    this.silenceTimeout = null;
                }, silenceDuration);
            }
        } else {
            if (this.silenceTimeout) {
                clearTimeout(this.silenceTimeout);
                this.silenceTimeout = null;
            }
        }

        requestAnimationFrame(() => this.checkForSilence(recordingId));
    }

    private getVolume(amplitudeArray: Float32Array) {
        const values = amplitudeArray.reduce(
            (sum, value) => sum + value * value,
            0,
        );
        const average = Math.sqrt(values / amplitudeArray.length);
        const volume = 20 * Math.log10(average);
        return volume;
    }
}

Object.assign(window, { WhisperRecognizer });
