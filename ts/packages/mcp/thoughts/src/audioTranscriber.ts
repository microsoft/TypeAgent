// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";
import {
    AzureTokenScopes,
    createAzureTokenProvider,
} from "aiclient";

export interface TranscribeOptions {
    // Path to the WAV file to transcribe
    wavFilePath: string;
    // Azure Speech key (defaults to AZURE_SPEECH_KEY env var)
    azureSpeechKey?: string;
    // Azure Speech region (defaults to AZURE_SPEECH_REGION env var)
    azureSpeechRegion?: string;
    // Language code (optional, defaults to "en-US")
    language?: string;
}

export interface TranscribeResult {
    // The transcribed text
    text: string;
    // Metadata about the transcription
    metadata?: {
        fileSize: number;
        duration?: number;
    };
}

/**
 * Transcribe a WAV file using Azure Cognitive Services Speech SDK
 */
export async function transcribeWavFile(
    options: TranscribeOptions,
): Promise<TranscribeResult> {
    const {
        wavFilePath,
        azureSpeechKey,
        azureSpeechRegion,
        language = "en-US",
    } = options;

    // Verify file exists
    if (!fs.existsSync(wavFilePath)) {
        throw new Error(`WAV file not found: ${wavFilePath}`);
    }

    // Get file size
    const stats = fs.statSync(wavFilePath);
    const fileSize = stats.size;

    // Get credentials from options or environment
    const speechKey =
        azureSpeechKey ||
        process.env.AZURE_SPEECH_KEY ||
        process.env.SPEECH_SDK_KEY;
    const speechRegion =
        azureSpeechRegion ||
        process.env.AZURE_SPEECH_REGION ||
        process.env.SPEECH_SDK_REGION;
    const speechEndpoint = process.env.SPEECH_SDK_ENDPOINT || "";

    if (!speechKey || !speechRegion) {
        throw new Error(
            "Azure Speech credentials not found. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION environment variables.",
        );
    }

    // Create speech config
    let speechConfig: speechSDK.SpeechConfig;

    // Handle special case where key is "identity" (managed identity)
    if (speechKey.toLowerCase() === "identity") {
        // For managed identity, we need to get a token
        const tokenProvider = createAzureTokenProvider(
            AzureTokenScopes.CogServices,
        );
        const tokenResult = await tokenProvider.getAccessToken();

        if (!tokenResult.success) {
            throw new Error(
                `Failed to get Azure token for managed identity: ${tokenResult.message}`,
            );
        }

        // Create speech config with authorization token
        // Format: aad#endpoint#token
        speechConfig = speechSDK.SpeechConfig.fromAuthorizationToken(
            `aad#${speechEndpoint}#${tokenResult.data}`,
            speechRegion,
        );
    } else {
        // Regular subscription key
        speechConfig = speechSDK.SpeechConfig.fromSubscription(
            speechKey,
            speechRegion,
        );
    }

    speechConfig.speechRecognitionLanguage = language;

    // Create audio config from file
    const audioConfig = speechSDK.AudioConfig.fromWavFileInput(
        fs.readFileSync(wavFilePath),
    );

    // Create speech recognizer
    const recognizer = new speechSDK.SpeechRecognizer(
        speechConfig,
        audioConfig,
    );

    return new Promise((resolve, reject) => {
        const recognizedTexts: string[] = [];
        let totalDuration = 0;
        let hasError = false;

        // Collect recognized text segments
        recognizer.recognized = (_s, e) => {
            if (e.result.reason === speechSDK.ResultReason.RecognizedSpeech) {
                if (e.result.text) {
                    recognizedTexts.push(e.result.text);
                    totalDuration = Math.max(
                        totalDuration,
                        e.result.duration / 10000000,
                    );
                }
            }
        };

        // Handle errors
        recognizer.canceled = (_s, e) => {
            hasError = true;
            recognizer.stopContinuousRecognitionAsync(
                () => {
                    recognizer.close();
                    if (e.reason === speechSDK.CancellationReason.Error) {
                        reject(new Error(`Recognition error: ${e.errorDetails}`));
                    } else {
                        // If cancelled but we have text, that's ok (end of file)
                        if (recognizedTexts.length > 0) {
                            resolve({
                                text: recognizedTexts.join(" ").trim(),
                                metadata: {
                                    fileSize,
                                    duration: totalDuration,
                                },
                            });
                        } else {
                            reject(new Error("Recognition cancelled"));
                        }
                    }
                },
                (err) => {
                    recognizer.close();
                    reject(new Error(`Failed to stop recognition: ${err}`));
                },
            );
        };

        // Handle session stopped (end of audio file)
        recognizer.sessionStopped = (_s, _e) => {
            if (!hasError) {
                recognizer.stopContinuousRecognitionAsync(
                    () => {
                        recognizer.close();
                        if (recognizedTexts.length === 0) {
                            reject(
                                new Error(
                                    "Speech could not be recognized from the audio file",
                                ),
                            );
                        } else {
                            resolve({
                                text: recognizedTexts.join(" ").trim(),
                                metadata: {
                                    fileSize,
                                    duration: totalDuration,
                                },
                            });
                        }
                    },
                    (err) => {
                        recognizer.close();
                        reject(new Error(`Failed to stop recognition: ${err}`));
                    },
                );
            }
        };

        // Start continuous recognition
        recognizer.startContinuousRecognitionAsync(
            () => {
                // Recognition started successfully
            },
            (err) => {
                recognizer.close();
                reject(new Error(`Failed to start recognition: ${err}`));
            },
        );
    });
}
