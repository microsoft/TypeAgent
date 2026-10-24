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
    private stream?: MediaStream;
    private disposed = false;
    private animationFrame?: number;
    private httpController?: AbortController;
    private errorCallback: (message: string) => void = (message) =>
        console.error(message);

    constructor() {}

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
        this.mediaRecorder.ondataavailable = async (e) => {
            if (this.disposed) return;
            this.audioChunks.push(e.data);

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
                let text: string;
                try {
                    text = await this.getTranscription(blob, controller.signal);
                } catch (error) {
                    if (!controller.signal.aborted) {
                        this.errorCallback(
                            error instanceof Error
                                ? error.message
                                : String(error),
                        );
                    }
                    return;
                }
                if (controller.signal.aborted || this.disposed) return;
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
        if (this.disposed || this.mediaRecorder?.state !== "inactive") return;
        this.audioChunks = [];
        this.recognizedFired = false;
        this.mediaRecorder?.start(200);
        this.checkForSilence();
    }

    stopRecording() {
        if (this.mediaRecorder?.state === "recording")
            this.mediaRecorder.stop();
    }

    onError(callback: (message: string) => void) {
        this.errorCallback = callback;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.httpController?.abort();
        this.stopRecording();
        if (this.animationFrame !== undefined)
            cancelAnimationFrame(this.animationFrame);
        if (this.silenceTimeout !== null) clearTimeout(this.silenceTimeout);
        this.stream?.getTracks().forEach((track) => track.stop());
        this.mediaStreamSource?.disconnect();
        this.analyser?.disconnect();
        if (this.audioContext?.state !== "closed") {
            void this.audioContext
                ?.close()
                .catch((error: unknown) =>
                    this.errorCallback(
                        error instanceof Error ? error.message : String(error),
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
        this.awaitingResult = true;
        const formData = new FormData();
        formData.append("file", blob);
        const response = await fetch("http://localhost:8001/transcribe", {
            method: "POST",
            body: formData,
            signal,
        });
        if (!response.ok)
            throw new Error(`Whisper returned HTTP ${response.status}.`);

        const responseBody = await response.json();
        this.awaitingResult = false;
        if (typeof responseBody.transcription !== "string")
            throw new Error("Whisper returned an invalid transcript.");
        return responseBody.transcription;
    }

    private checkForSilence() {
        if (this.disposed || this.mediaRecorder?.state !== "recording") return;
        const bufferLength = this.analyser!.fftSize;
        const amplitudeArray = new Float32Array(bufferLength || 0);
        const silenceDuration = 1000;
        const silenceThreshold = -50;

        this.analyser!.getFloatTimeDomainData(amplitudeArray);

        const volume = this.getVolume(amplitudeArray);

        if (volume < silenceThreshold) {
            if (!this.silenceTimeout) {
                this.silenceTimeout = setTimeout(() => {
                    this.stopRecording();
                    this.silenceTimeout = null;
                }, silenceDuration);
            }
        } else {
            if (this.silenceTimeout) {
                clearTimeout(this.silenceTimeout);
                this.silenceTimeout = null;
            }
        }

        this.animationFrame = requestAnimationFrame(() =>
            this.checkForSilence(),
        );
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
