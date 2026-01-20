// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import fetch, { FormData, Blob } from "node-fetch";
import Mic from "mic";
import OpenAI from "openai";

export type TranscriptionProvider = "openai" | "azure-openai" | "local";

export interface VoiceInputOptions {
    provider?: TranscriptionProvider;
    whisperServiceUrl?: string;
    openaiApiKey?: string;
    azureOpenAIApiKey?: string;
    azureOpenAIEndpoint?: string;
    azureOpenAIDeploymentName?: string;
}

/**
 * Voice input handler for recording audio and transcribing
 * Supports OpenAI Whisper API, Azure OpenAI, and local Whisper service
 * Uses the 'mic' package for cross-platform audio recording
 */
export class VoiceInputHandler {
    private provider: TranscriptionProvider;
    private whisperServiceUrl: string;
    private openaiClient: OpenAI | null = null;
    private azureDeploymentName: string = "";
    private micInstance: any = null;
    private audioChunks: Buffer[] = [];
    private isRecording = false;
    private silenceTimer: NodeJS.Timeout | null = null;
    private silenceThreshold = 2000; // 2 seconds of silence
    private hasDetectedAudio = false; // Track if we've detected any audio yet
    private resolveRecording: ((value: string) => void) | null = null;
    private rejectRecording: ((reason: any) => void) | null = null;

    constructor(options: VoiceInputOptions = {}) {
        // Auto-detect provider based on available environment variables
        if (!options.provider) {
            if (
                process.env.AZURE_OPENAI_API_KEY &&
                process.env.AZURE_OPENAI_ENDPOINT
            ) {
                this.provider = "azure-openai";
            } else if (process.env.OPENAI_API_KEY) {
                this.provider = "openai";
            } else {
                this.provider = "local";
            }
        } else {
            this.provider = options.provider;
        }

        this.whisperServiceUrl =
            options.whisperServiceUrl || "http://localhost:8001";

        // Initialize OpenAI client if using that provider
        if (this.provider === "openai") {
            const apiKey =
                options.openaiApiKey || process.env.OPENAI_API_KEY || "";
            if (!apiKey) {
                console.warn(
                    "[Voice] No OpenAI API key found, falling back to local Whisper",
                );
                this.provider = "local";
            } else {
                this.openaiClient = new OpenAI({ apiKey });
            }
        } else if (this.provider === "azure-openai") {
            const apiKey =
                options.azureOpenAIApiKey ||
                process.env.AZURE_OPENAI_API_KEY ||
                "";
            const endpoint =
                options.azureOpenAIEndpoint ||
                process.env.AZURE_OPENAI_ENDPOINT ||
                "";
            this.azureDeploymentName =
                options.azureOpenAIDeploymentName ||
                process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
                "whisper";

            if (!apiKey || !endpoint) {
                console.warn(
                    "[Voice] Azure OpenAI credentials not found, falling back to local Whisper",
                );
                this.provider = "local";
            } else {
                this.openaiClient = new OpenAI({
                    apiKey,
                    baseURL: `${endpoint}/openai/deployments/${this.azureDeploymentName}`,
                    defaultQuery: { "api-version": "2024-02-01" },
                    defaultHeaders: { "api-key": apiKey },
                });
            }
        }
    }

    /**
     * Start recording audio and return transcribed text when silence detected
     * Uses 2 seconds of silence as the end-of-speech threshold
     */
    async recordAndTranscribe(): Promise<string> {
        return new Promise((resolve, reject) => {
            console.log(
                "\n🎤 Recording... (speak now, 2 seconds of silence will end recording)\n",
            );

            this.audioChunks = [];
            this.isRecording = true;
            this.hasDetectedAudio = false;

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
                    // Mark that we've detected audio
                    if (!this.hasDetectedAudio) {
                        this.hasDetectedAudio = true;
                        console.log("🎙️  Audio detected, listening...\n");
                    }

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

            // Don't start silence timer yet - wait for first audio detection
            // This prevents premature timeout before user starts speaking
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
     * Send audio to transcription service (OpenAI, Azure OpenAI, or local Whisper)
     */
    private async transcribe(audioBuffer: Buffer): Promise<string> {
        if (
            (this.provider === "openai" || this.provider === "azure-openai") &&
            this.openaiClient
        ) {
            return this.transcribeWithOpenAI(audioBuffer);
        } else {
            return this.transcribeWithLocalWhisper(audioBuffer);
        }
    }

    /**
     * Transcribe using OpenAI or Azure OpenAI Whisper API
     */
    private async transcribeWithOpenAI(audioBuffer: Buffer): Promise<string> {
        const tempDir = os.tmpdir();
        const tempFile = path.join(tempDir, `voice-${Date.now()}.wav`);

        try {
            // Write WAV header + audio data
            const wavBuffer = this.createWavBuffer(audioBuffer);
            fs.writeFileSync(tempFile, wavBuffer);

            // Use OpenAI API (works for both OpenAI and Azure OpenAI)
            const model =
                this.provider === "azure-openai"
                    ? this.azureDeploymentName
                    : "whisper-1";
            const transcription =
                await this.openaiClient!.audio.transcriptions.create({
                    file: fs.createReadStream(tempFile) as any,
                    model,
                    language: "en", // Optional: specify language for better accuracy
                    response_format: "text",
                });

            return (transcription as string).trim();
        } finally {
            // Cleanup temp file
            if (fs.existsSync(tempFile)) {
                fs.unlinkSync(tempFile);
            }
        }
    }

    /**
     * Transcribe using local Whisper service
     */
    private async transcribeWithLocalWhisper(
        audioBuffer: Buffer,
    ): Promise<string> {
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
     * Check if transcription service is available
     */
    async isWhisperServiceAvailable(): Promise<boolean> {
        if (this.provider === "openai" || this.provider === "azure-openai") {
            // For OpenAI/Azure, just check if we have a client configured
            return this.openaiClient !== null;
        } else {
            // For local service, check if it's running
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
    }

    /**
     * Get the current transcription provider
     */
    getProvider(): TranscriptionProvider {
        return this.provider;
    }

    /**
     * Get recording status
     */
    getIsRecording(): boolean {
        return this.isRecording;
    }
}
