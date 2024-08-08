// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class WhisperRecognizer {
    private audioContext: AudioContext | null = null;
    private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
    private analyser: AnalyserNode | null = null;
    private mediaRecorder: MediaRecorder | null = null;
    private silenceTimeout: any = null;
    private awaitingResult = false;
    private recognizedFired = false;
    private recognizingCallback:
        | ((result: { text: string }) => void)
        | undefined;
    private recognizedCallback:
        | ((result: { text: string }) => void)
        | undefined;
    private audioChunks: Blob[] = [];

    constructor() {}

    async initialize() {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });

        this.audioContext = new AudioContext();
        this.mediaStreamSource =
            this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.minDecibels = -100;
        this.mediaStreamSource.connect(this.analyser);

        this.mediaRecorder = new MediaRecorder(stream);
        this.mediaRecorder.ondataavailable = async (e) => {
            this.audioChunks.push(e.data);

            if (
                this.mediaRecorder!.state === "inactive" ||
                !this.awaitingResult
            ) {
                const blob = new Blob(this.audioChunks, {
                    type: "audio/mpeg-3",
                });
                const text = await this.getTranscription(blob);
                if (this.mediaRecorder!.state === "inactive") {
                    if (this.recognizedCallback && !this.recognizedFired) {
                        this.recognizedCallback({ text });
                        this.recognizedFired = true;
                    }
                } else {
                    if (this.recognizingCallback) {
                        this.recognizingCallback({ text });
                    }
                }
            }
        };
    }

    startRecording() {
        this.audioChunks = [];
        this.recognizedFired = false;
        this.mediaRecorder?.start(200);
        this.checkForSilence();
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

    private async getTranscription(blob: Blob): Promise<string> {
        this.awaitingResult = true;
        const formData = new FormData();
        formData.append("file", blob);
        const response = await fetch("http://localhost:8001/transcribe", {
            method: "POST",
            body: formData,
        });

        let responseBody = await response.json();
        this.awaitingResult = false;
        return responseBody.transcription;
    }

    private checkForSilence() {
        const bufferLength = this.analyser!.fftSize;
        const amplitudeArray = new Float32Array(bufferLength || 0);
        const silenceDuration = 1000;
        const silenceThreshold = -50;

        this.analyser!.getFloatTimeDomainData(amplitudeArray);

        const volume = this.getVolume(amplitudeArray);

        if (volume < silenceThreshold) {
            if (
                !this.silenceTimeout &&
                this.mediaRecorder!.state !== "inactive"
            ) {
                this.silenceTimeout = setTimeout(() => {
                    this.mediaRecorder?.stop();
                    this.silenceTimeout = null;
                }, silenceDuration);
            }
        } else {
            if (this.silenceTimeout) {
                clearTimeout(this.silenceTimeout);
                this.silenceTimeout = null;
            }
        }

        requestAnimationFrame(() => this.checkForSilence());
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
