// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getLocalWhisperTranscription } from "@typeagent/common-utils";

export class WhisperRecognizer {
    private audioContext: AudioContext | null = null;
    private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
    private analyser: AnalyserNode | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private silenceTimeout: ReturnType<typeof setTimeout> | null = null;
    private recordingId = 0;
    private awaitingResult = false;
    private recognizedFired = false;
    private transcriptionFailed = false;
    private errorCallback: (error: Error) => void = (error) =>
        console.error(error);
    private recognizingCallback:
        | ((result: { text: string }) => void)
        | undefined;
    private recognizedCallback:
        | ((result: { text: string }) => void)
        | undefined;
    private audioChunks: Blob[] = [];
    private stream?: MediaStream;
    private disposed = false;
    private animationFrame?: number;
    private httpController?: AbortController;

    async initialize() {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });
        this.stream = stream;
        if (this.disposed) {
            stream.getTracks().forEach((track) => track.stop());
            return;
        }

        this.audioContext = new AudioContext();
        this.mediaStreamSource =
            this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.minDecibels = -100;
        this.mediaStreamSource.connect(this.analyser);

        this.mediaRecorder = new MediaRecorder(stream);
        this.mediaRecorder.ondataavailable = async (event) => {
            if (this.disposed || this.transcriptionFailed) return;
            const recordingId = this.recordingId;
            this.audioChunks.push(event.data);

            if (
                this.mediaRecorder!.state === "inactive" ||
                !this.awaitingResult
            ) {
                const blob = new Blob(this.audioChunks, {
                    type: "audio/mpeg-3",
                });
                this.httpController?.abort();
                const controller = new AbortController();
                this.httpController = controller;
                this.awaitingResult = true;

                try {
                    const text = await this.getTranscription(
                        blob,
                        controller.signal,
                    );
                    if (
                        controller.signal.aborted ||
                        this.disposed ||
                        recordingId !== this.recordingId ||
                        this.transcriptionFailed
                    ) {
                        return;
                    }
                    if (this.mediaRecorder!.state === "inactive") {
                        if (this.recognizedCallback && !this.recognizedFired) {
                            this.recognizedFired = true;
                            this.recognizedCallback({ text });
                        }
                    } else {
                        this.recognizingCallback?.({ text });
                    }
                } catch (error) {
                    if (
                        controller.signal.aborted ||
                        this.disposed ||
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
                    this.errorCallback(failure);
                } finally {
                    if (this.httpController === controller) {
                        this.httpController = undefined;
                        this.awaitingResult = false;
                    }
                }
            }
        };
    }

    startRecording() {
        if (this.disposed || this.mediaRecorder?.state !== "inactive") return;
        this.recordingId++;
        this.httpController?.abort();
        this.httpController = undefined;
        this.audioChunks = [];
        this.awaitingResult = false;
        this.recognizedFired = false;
        this.transcriptionFailed = false;
        if (this.silenceTimeout !== null) {
            clearTimeout(this.silenceTimeout);
            this.silenceTimeout = null;
        }
        this.mediaRecorder.start(200);
        this.checkForSilence(this.recordingId);
    }

    stopRecording() {
        if (this.mediaRecorder?.state === "recording") {
            this.mediaRecorder.stop();
        }
    }

    onError(callback: (error: Error) => void) {
        this.errorCallback = callback;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.httpController?.abort();
        this.stopRecording();
        if (this.animationFrame !== undefined) {
            cancelAnimationFrame(this.animationFrame);
        }
        if (this.silenceTimeout !== null) clearTimeout(this.silenceTimeout);
        this.stream?.getTracks().forEach((track) => track.stop());
        this.mediaStreamSource?.disconnect();
        this.analyser?.disconnect();
        if (this.audioContext?.state !== "closed") {
            void this.audioContext
                ?.close()
                .catch((error: unknown) =>
                    this.errorCallback(
                        error instanceof Error
                            ? error
                            : new Error(String(error)),
                    ),
                );
        }
    }

    onRecognizing(callback: (result: { text: string }) => void) {
        this.recognizingCallback = callback;
    }

    onRecognized(callback: (result: { text: string }) => void) {
        this.recognizedCallback = callback;
    }

    private async getTranscription(
        blob: Blob,
        signal: AbortSignal,
    ): Promise<string> {
        return getLocalWhisperTranscription(blob, signal);
    }

    private checkForSilence(recordingId: number) {
        if (
            this.disposed ||
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
            if (this.silenceTimeout === null) {
                const timeout = setTimeout(() => {
                    if (this.silenceTimeout !== timeout) return;
                    this.silenceTimeout = null;
                    if (
                        recordingId === this.recordingId &&
                        this.mediaRecorder?.state === "recording"
                    ) {
                        this.mediaRecorder.stop();
                    }
                }, silenceDuration);
                this.silenceTimeout = timeout;
            }
        } else if (this.silenceTimeout !== null) {
            clearTimeout(this.silenceTimeout);
            this.silenceTimeout = null;
        }

        this.animationFrame = requestAnimationFrame(() => {
            if (recordingId === this.recordingId) {
                this.checkForSilence(recordingId);
            }
        });
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
