// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as speechSDK from "microsoft-cognitiveservices-speech-sdk";

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

    if (!speechKey || !speechRegion) {
        throw new Error(
            "Azure Speech credentials not found. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION environment variables.",
        );
    }

    // Create speech config
    const speechConfig = speechSDK.SpeechConfig.fromSubscription(
        speechKey,
        speechRegion,
    );
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
        recognizer.recognizeOnceAsync(
            (result: speechSDK.SpeechRecognitionResult) => {
                recognizer.close();

                switch (result.reason) {
                    case speechSDK.ResultReason.RecognizedSpeech:
                        resolve({
                            text: result.text.trim(),
                            metadata: {
                                fileSize,
                                duration: result.duration / 10000000, // Convert from 100ns units to seconds
                            },
                        });
                        break;
                    case speechSDK.ResultReason.NoMatch:
                        reject(
                            new Error(
                                "Speech could not be recognized from the audio file",
                            ),
                        );
                        break;
                    case speechSDK.ResultReason.Canceled:
                        const cancellation =
                            speechSDK.CancellationDetails.fromResult(result);
                        if (
                            cancellation.reason ===
                            speechSDK.CancellationReason.Error
                        ) {
                            reject(
                                new Error(
                                    `Recognition error: ${cancellation.errorDetails}`,
                                ),
                            );
                        } else {
                            reject(new Error("Recognition cancelled"));
                        }
                        break;
                    default:
                        reject(new Error(`Unknown reason: ${result.reason}`));
                        break;
                }
            },
            (err: string) => {
                recognizer.close();
                reject(new Error(`Recognition failed: ${err}`));
            },
        );
    });
}
