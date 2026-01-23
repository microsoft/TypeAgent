// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import OpenAI from "openai";

export interface TranscribeOptions {
    // Path to the WAV file to transcribe
    wavFilePath: string;
    // OpenAI API key (defaults to OPENAI_API_KEY env var)
    apiKey?: string;
    // Model to use (defaults to "whisper-1")
    model?: string;
    // Language code (optional, e.g., "en")
    language?: string;
}

export interface TranscribeResult {
    // The transcribed text
    text: string;
    // Metadata about the transcription
    metadata?: {
        fileSize: number;
        model: string;
    };
}

/**
 * Transcribe a WAV file using OpenAI's Whisper API
 */
export async function transcribeWavFile(
    options: TranscribeOptions,
): Promise<TranscribeResult> {
    const { wavFilePath, apiKey, model = "whisper-1", language } = options;

    // Verify file exists
    if (!fs.existsSync(wavFilePath)) {
        throw new Error(`WAV file not found: ${wavFilePath}`);
    }

    // Get file size
    const stats = fs.statSync(wavFilePath);
    const fileSize = stats.size;

    // Initialize OpenAI client
    const openai = new OpenAI({
        apiKey: apiKey || process.env.OPENAI_API_KEY,
    });

    // Transcribe the audio file
    const transcriptionOptions: any = {
        file: fs.createReadStream(wavFilePath),
        model,
        response_format: "text",
    };

    if (language) {
        transcriptionOptions.language = language;
    }

    const transcription = await openai.audio.transcriptions.create(
        transcriptionOptions,
    );

    // When response_format is "text", the transcription is a string
    const text =
        typeof transcription === "string" ? transcription : transcription.text;

    return {
        text: text.trim(),
        metadata: {
            fileSize,
            model,
        },
    };
}
