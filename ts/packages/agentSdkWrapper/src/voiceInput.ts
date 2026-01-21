// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import fetch, { FormData, Blob } from "node-fetch";
import Mic from "mic";
import OpenAI from "openai";
import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";
import {
    AzureTokenScopes,
    createAzureTokenProvider,
    type AuthTokenProvider,
} from "aiclient";
import { AudioCapture } from "./audioCapture.js";

export type TranscriptionProvider =
    | "azure-speech"
    | "openai"
    | "azure-openai"
    | "local";

export interface VoiceInputOptions {
    provider?: TranscriptionProvider;
    whisperServiceUrl?: string;
    openaiApiKey?: string;
    azureOpenAIApiKey?: string;
    azureOpenAIEndpoint?: string;
    azureOpenAIDeploymentName?: string;
    azureSpeechKey?: string;
    azureSpeechRegion?: string;
    azureSpeechEndpoint?: string;
    audioDevice?: string; // Microphone device name or ID
}

/**
 * Voice input handler for recording audio and transcribing
 * Supports Azure Speech Services, OpenAI Whisper API, Azure OpenAI, and local Whisper service
 * Uses Azure Speech SDK for best accuracy or 'mic' package for other providers
 */
export class VoiceInputHandler {
    private provider: TranscriptionProvider;
    private whisperServiceUrl: string;
    private openaiClient: OpenAI | null = null;
    private azureDeploymentName: string = "";
    private azureSpeechConfig: speechSDK.SpeechConfig | null = null;
    private azureSpeechKey: string = "";
    private azureSpeechRegion: string = "";
    private azureSpeechEndpoint: string = "";
    private azureTokenProvider: AuthTokenProvider | null = null;
    private audioDevice: string | undefined;
    private micInstance: any = null;
    private audioChunks: Buffer[] = [];
    private isRecording = false;
    private silenceTimer: NodeJS.Timeout | null = null;
    private silenceThreshold = 2000; // 2 seconds of silence
    private hasDetectedAudio = false; // Track if we've detected any audio yet
    private resolveRecording: ((value: string) => void) | null = null;
    private rejectRecording: ((reason: any) => void) | null = null;

    constructor(options: VoiceInputOptions = {}) {
        // Store audio device preference
        this.audioDevice = options.audioDevice || process.env.AUDIO_DEVICE;

        // Log the selected audio device if specified
        if (this.audioDevice) {
            console.log(`[Voice] Using audio device: ${this.audioDevice}`);
        }

        // Auto-detect provider based on available environment variables
        if (!options.provider) {
            if (
                (process.env.AZURE_SPEECH_KEY || process.env.SPEECH_SDK_KEY) &&
                (process.env.AZURE_SPEECH_REGION ||
                    process.env.SPEECH_SDK_REGION)
            ) {
                this.provider = "azure-speech";
            } else if (
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

        // Initialize Azure Speech SDK if using that provider
        if (this.provider === "azure-speech") {
            const speechKey =
                options.azureSpeechKey ||
                process.env.AZURE_SPEECH_KEY ||
                process.env.SPEECH_SDK_KEY ||
                "";
            const speechRegion =
                options.azureSpeechRegion ||
                process.env.AZURE_SPEECH_REGION ||
                process.env.SPEECH_SDK_REGION ||
                "";
            const speechEndpoint =
                options.azureSpeechEndpoint ||
                process.env.SPEECH_SDK_ENDPOINT ||
                "";

            if (!speechKey || !speechRegion) {
                console.warn(
                    "[Voice] Azure Speech credentials not found, falling back to local Whisper",
                );
                this.provider = "local";
            } else {
                // Store credentials for use in recordWithAzureSpeech
                this.azureSpeechKey = speechKey;
                this.azureSpeechRegion = speechRegion;
                this.azureSpeechEndpoint = speechEndpoint;

                // Handle special case where key is "identity" (managed identity)
                if (speechKey.toLowerCase() === "identity") {
                    // For managed identity, we need to get a token asynchronously
                    // So we'll create the config lazily in recordWithAzureSpeech
                    // Initialize the token provider now
                    this.azureTokenProvider = createAzureTokenProvider(
                        AzureTokenScopes.CogServices,
                    );
                } else {
                    // Regular subscription key - create config now
                    this.azureSpeechConfig =
                        speechSDK.SpeechConfig.fromSubscription(
                            speechKey,
                            speechRegion,
                        );
                    this.azureSpeechConfig.speechRecognitionLanguage = "en-US";
                }
            }
        } else if (this.provider === "openai") {
            // Initialize OpenAI client if using that provider
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
     * Uses Azure Speech SDK for azure-speech provider, or custom silence detection for others
     */
    async recordAndTranscribe(): Promise<string> {
        // Use Azure Speech SDK for azure-speech provider
        if (this.provider === "azure-speech") {
            return this.recordWithAzureSpeech();
        }

        // Use mic package with manual silence detection for other providers
        return new Promise((resolve, reject) => {
            console.log(
                "\n🎤 Recording... (speak now, 2 seconds of silence will end recording)\n",
            );

            this.audioChunks = [];
            this.isRecording = true;
            this.hasDetectedAudio = false;

            // Create mic instance with proper settings for Whisper
            const micOptions: any = {
                rate: "16000", // 16kHz sample rate for Whisper
                channels: "1", // Mono
                debug: false,
                exitOnSilence: 0, // We'll handle silence detection manually
                fileType: "wav",
            };

            // Add device if specified
            if (this.audioDevice) {
                micOptions.device = this.audioDevice;
            }

            this.micInstance = Mic(micOptions);

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
     * Record and transcribe using Azure Speech Services
     * Uses the Speech SDK with PushAudioInputStream for Node.js compatibility
     */
    private async recordWithAzureSpeech(): Promise<string> {
        // If using managed identity, get token and create config first
        if (this.azureSpeechKey.toLowerCase() === "identity") {
            if (!this.azureTokenProvider) {
                throw new Error(
                    "Azure token provider not initialized for managed identity",
                );
            }

            const tokenResult = await this.azureTokenProvider.getAccessToken();
            if (!tokenResult.success) {
                throw new Error(
                    `Failed to get Azure token for managed identity: ${tokenResult.message}`,
                );
            }

            // Create speech config with authorization token
            // Format: aad#endpoint#token
            this.azureSpeechConfig =
                speechSDK.SpeechConfig.fromAuthorizationToken(
                    `aad#${this.azureSpeechEndpoint}#${tokenResult.data}`,
                    this.azureSpeechRegion,
                );
            this.azureSpeechConfig.speechRecognitionLanguage = "en-US";
        }

        return new Promise((resolve, reject) => {
            const deviceMsg = this.audioDevice
                ? ` using device: ${this.audioDevice}`
                : " using default device";
            console.log(`\n🎤 Recording${deviceMsg}... (speak now)\n`);

            // Create push stream for audio input
            // Use 16kHz sample rate, 16-bit, mono PCM format
            const pushStream = speechSDK.AudioInputStream.createPushStream(
                speechSDK.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1),
            );

            // Create audio config from push stream
            const audioConfig =
                speechSDK.AudioConfig.fromStreamInput(pushStream);
            const recognizer = new speechSDK.SpeechRecognizer(
                this.azureSpeechConfig!,
                audioConfig,
            );

            // Create audio capture instance with device selection support
            const audioCapture = new AudioCapture({
                rate: "16000",
                channels: "1",
                device: this.audioDevice || "default",
                debug: false,
            });

            const micInputStream = audioCapture.getAudioStream();
            let audioStarted = false;

            // The mic package outputs raw PCM data (when fileType is 'raw')
            micInputStream.on("data", (data: Buffer) => {
                if (!audioStarted) {
                    audioStarted = true;
                }
                // Create a proper ArrayBuffer from the Buffer
                const arrayBuffer = data.buffer.slice(
                    data.byteOffset,
                    data.byteOffset + data.byteLength,
                );
                pushStream.write(arrayBuffer as ArrayBuffer);
            });

            micInputStream.on("error", (error: Error) => {
                audioCapture.stop();
                pushStream.close();
                recognizer.close();
                reject(error);
            });

            // Show interim results while recognizing
            recognizer.recognizing = (
                _s: any,
                e: speechSDK.SpeechRecognitionEventArgs,
            ) => {
                if (e.result.text) {
                    console.log(`🎙️  Recognizing: ${e.result.text}`);
                }
            };

            // Perform one-shot recognition
            recognizer.recognizeOnceAsync(
                (result: speechSDK.SpeechRecognitionResult) => {
                    // Stop audio capture and close streams
                    audioCapture.stop();
                    pushStream.close();

                    switch (result.reason) {
                        case speechSDK.ResultReason.RecognizedSpeech:
                            // Don't print here - let the CLI handler print it
                            recognizer.close();
                            resolve(result.text);
                            break;
                        case speechSDK.ResultReason.NoMatch:
                            recognizer.close();
                            // Provide more context about why NoMatch occurred
                            if (!audioStarted) {
                                reject(
                                    new Error(
                                        "No audio detected - please check your microphone",
                                    ),
                                );
                            } else {
                                reject(
                                    new Error(
                                        "Speech could not be recognized - please speak more clearly",
                                    ),
                                );
                            }
                            break;
                        case speechSDK.ResultReason.Canceled:
                            const cancellation =
                                speechSDK.CancellationDetails.fromResult(
                                    result,
                                );
                            recognizer.close();
                            if (
                                cancellation.reason ===
                                speechSDK.CancellationReason.Error
                            ) {
                                reject(
                                    new Error(
                                        `Recognition error: ${cancellation.errorDetails} (code:${cancellation.ErrorCode})`,
                                    ),
                                );
                            } else {
                                reject(new Error("Recognition cancelled"));
                            }
                            break;
                        default:
                            recognizer.close();
                            reject(
                                new Error(`Unknown reason: ${result.reason}`),
                            );
                            break;
                    }
                },
                (err: string) => {
                    audioCapture.stop();
                    pushStream.close();
                    recognizer.close();
                    reject(new Error(`Recognition failed: ${err}`));
                },
            );

            // Start recording
            audioCapture.start();
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
        if (this.provider === "azure-speech") {
            // For Azure Speech, check if we have config or token provider (for managed identity)
            return (
                this.azureSpeechConfig !== null ||
                this.azureTokenProvider !== null
            );
        } else if (
            this.provider === "openai" ||
            this.provider === "azure-openai"
        ) {
            // For OpenAI/Azure OpenAI, check if we have a client configured
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

    /**
     * Get information about the current audio setup
     */
    async getAudioDeviceInfo(): Promise<string> {
        if (this.audioDevice) {
            return `Configured device: ${this.audioDevice}`;
        }

        // Try to get default device info
        if (process.platform === "win32") {
            try {
                const { exec } = await import("child_process");
                const { promisify } = await import("util");
                const execAsync = promisify(exec);

                // Get default recording device using PowerShell
                const { stdout } = await execAsync(
                    "powershell -Command \"Get-CimInstance Win32_SoundDevice | Where-Object {$_.Status -eq 'OK'} | Select-Object -First 1 -ExpandProperty Name\"",
                );
                return `Default device: ${stdout.trim() || "Unknown"}`;
            } catch {
                return "Default device: Unable to determine";
            }
        }

        return "Default device";
    }

    /**
     * List available audio input devices
     * Note: This is platform-specific and may require SoX on Windows
     */
    static async listAudioDevices(): Promise<string[]> {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);

        const platform = process.platform;
        const devices: string[] = [];

        try {
            if (platform === "win32") {
                // On Windows, try to use SoX to list devices
                // SoX format: "device_name" (device_id)
                const { stdout } = await execAsync(
                    'sox --show-all-devices 2>&1 || echo ""',
                );
                const lines = stdout.split("\n");
                for (const line of lines) {
                    if (line.includes("(") && line.includes(")")) {
                        devices.push(line.trim());
                    }
                }
            } else if (platform === "darwin") {
                // On macOS, use system_profiler
                const { stdout } = await execAsync(
                    "system_profiler SPAudioDataType 2>/dev/null || echo ''",
                );
                const lines = stdout.split("\n");
                for (const line of lines) {
                    if (line.includes("Input Source:")) {
                        devices.push(line.trim());
                    }
                }
            } else {
                // On Linux, use arecord -L
                const { stdout } = await execAsync(
                    "arecord -L 2>/dev/null || echo ''",
                );
                const lines = stdout.split("\n");
                for (const line of lines) {
                    if (line && !line.startsWith(" ")) {
                        devices.push(line.trim());
                    }
                }
            }
        } catch (error) {
            console.warn("[Voice] Could not list audio devices:", error);
        }

        return devices;
    }
}
