// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import fetch, { FormData, Blob } from "node-fetch";
import Mic from "mic";

/**
 * Voice input handler for recording audio and transcribing via local Whisper service
 * Uses the 'mic' package for better Windows compatibility
 */
export class VoiceInputHandler {
    private whisperServiceUrl: string;
    private micInstance: any = null;
    private audioChunks: Buffer[] = [];
    private isRecording = false;
    private silenceTimer: NodeJS.Timeout | null = null;
    private silenceThreshold = 1000; // 1 second of silence
    private resolveRecording: ((value: string) => void) | null = null;
    private rejectRecording: ((reason: any) => void) | null = null;

    constructor(whisperServiceUrl: string = "http://localhost:8001") {
        this.whisperServiceUrl = whisperServiceUrl;
    }

    /**
     * Start recording audio and return transcribed text when silence detected
     * Uses 1 second of silence as the end-of-speech threshold
     */
    async recordAndTranscribe(): Promise<string> {
        return new Promise((resolve, reject) => {
            console.log(
                "\n🎤 Recording... (speak now, 1 second of silence will end recording)\n",
            );

            this.audioChunks = [];
            this.isRecording = true;

            // Create mic instance with proper settings for Whisper
            this.micInstance = Mic({
                rate: "16000", // 16kHz sample rate for Whisper
                channels: "1", // Mono
                debug: false,
                exitOnSilence: 0, // We'll handle silence detection manually
                fileType: "wav",
            });

            // Get the audio stream
            const micInputStream = this.micInstance.getAudioStream();

            // Handle audio data
            micInputStream.on("data", (data: Buffer) => {
                this.audioChunks.push(data);

                // Reset silence timer on audio activity
                // Simple amplitude detection for silence
                const hasAudio = this.detectAudio(data);

                if (hasAudio) {
                    // Reset silence timer when we detect audio
                    if (this.silenceTimer) {
                        clearTimeout(this.silenceTimer);
                    }
                    this.silenceTimer = setTimeout(() => {
                        // Silence detected
                        console.log("🔇 Silence detected, processing...\n");
                        this.stopMic();
                    }, this.silenceThreshold);
                }
            });

            micInputStream.on("error", (error: Error) => {
                this.isRecording = false;
                if (this.silenceTimer) {
                    clearTimeout(this.silenceTimer);
                }
                reject(error);
            });

            micInputStream.on("silence", () => {
                // This event might not fire on all systems, so we use our own timer
            });

            // Store resolve/reject for later use in stopMic
            this.resolveRecording = resolve;
            this.rejectRecording = reject;

            // Start recording
            this.micInstance.start();

            // Start initial silence timer
            this.silenceTimer = setTimeout(() => {
                console.log("🔇 Silence detected, processing...\n");
                this.stopMic();
            }, this.silenceThreshold + 5000); // Add 5 seconds buffer for initial setup
        });
    }

    /**
     * Simple audio detection based on amplitude
     */
    private detectAudio(buffer: Buffer): boolean {
        // Calculate RMS (root mean square) to detect audio activity
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 2) {
            const sample = buffer.readInt16LE(i);
            sum += sample * sample;
        }
        const rms = Math.sqrt(sum / (buffer.length / 2));

        // Threshold for detecting audio (adjust as needed)
        const threshold = 500;
        return rms > threshold;
    }

    /**
     * Stop the microphone and process the recording
     */
    private async stopMic(): Promise<void> {
        if (this.micInstance) {
            this.micInstance.stop();
        }

        this.isRecording = false;
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
        }

        if (this.audioChunks.length === 0) {
            if (this.resolveRecording) {
                this.resolveRecording("");
            }
            return;
        }

        const audioBuffer = Buffer.concat(this.audioChunks);

        try {
            const text = await this.transcribe(audioBuffer);
            if (this.resolveRecording) {
                this.resolveRecording(text);
            }
        } catch (error) {
            if (this.rejectRecording) {
                this.rejectRecording(error);
            }
        }
    }

    /**
     * Stop recording manually (if user wants to cancel)
     */
    stopRecording(): void {
        if (this.isRecording) {
            this.stopMic();
        }
    }

    /**
     * Send audio to Whisper service for transcription
     */
    private async transcribe(audioBuffer: Buffer): Promise<string> {
        // Save to temp file
        const tempDir = os.tmpdir();
        const tempFile = path.join(tempDir, `voice-${Date.now()}.wav`);

        try {
            // Write WAV header + audio data
            const wavBuffer = this.createWavBuffer(audioBuffer);
            fs.writeFileSync(tempFile, wavBuffer);

            // Create form data with the audio file using node-fetch's FormData
            const formData = new FormData();
            const audioBlob = new Blob([wavBuffer], { type: "audio/wav" });
            formData.set("file", audioBlob, "audio.wav");

            // Send to Whisper service
            const response = await fetch(
                `${this.whisperServiceUrl}/transcribe/`,
                {
                    method: "POST",
                    body: formData,
                },
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(
                    `Whisper service error (${response.status}): ${errorText}`,
                );
            }

            const result = (await response.json()) as {
                transcription?: string;
                error?: string;
            };

            if (result.error) {
                throw new Error(`Transcription error: ${result.error}`);
            }

            return result.transcription?.trim() || "";
        } finally {
            // Cleanup temp file
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        }
    }

    /**
     * Create a proper WAV file buffer from raw PCM data
     */
    private createWavBuffer(pcmBuffer: Buffer): Buffer {
        const sampleRate = 16000;
        const numChannels = 1;
        const bitsPerSample = 16;

        const wavHeader = Buffer.alloc(44);

        // RIFF header
        wavHeader.write("RIFF", 0);
        wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
        wavHeader.write("WAVE", 8);

        // fmt chunk
        wavHeader.write("fmt ", 12);
        wavHeader.writeUInt32LE(16, 16); // fmt chunk size
        wavHeader.writeUInt16LE(1, 20); // audio format (PCM)
        wavHeader.writeUInt16LE(numChannels, 22);
        wavHeader.writeUInt32LE(sampleRate, 24);
        wavHeader.writeUInt32LE(
            sampleRate * numChannels * (bitsPerSample / 8),
            28,
        ); // byte rate
        wavHeader.writeUInt16LE(numChannels * (bitsPerSample / 8), 32); // block align
        wavHeader.writeUInt16LE(bitsPerSample, 34);

        // data chunk
        wavHeader.write("data", 36);
        wavHeader.writeUInt32LE(pcmBuffer.length, 40);

        return Buffer.concat([wavHeader, pcmBuffer]);
    }

    /**
     * Check if Whisper service is running and accessible
     */
    async isWhisperServiceAvailable(): Promise<boolean> {
        try {
            await fetch(this.whisperServiceUrl, {
                method: "GET",
            });
            // Service is available if we get any response (even 404 is ok)
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get recording status
     */
    getIsRecording(): boolean {
        return this.isRecording;
    }
}
