// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type SpeechProvider = "azure" | "whisper" | "nemotron";

export type LocalAsrEvent =
    | { type: "result"; sessionId: string; text: string; final: boolean }
    | { type: "error"; sessionId: string; message: string };

export type LocalAsrCommand =
    | { type: "prepare"; cacheDir: string; allowDownload: boolean }
    | { type: "cancelSetup" }
    | { type: "start"; sessionId: string }
    | { type: "append"; sessionId: string; pcm: Uint8Array }
    | { type: "finish"; sessionId: string }
    | { type: "cancel"; sessionId: string };

export type LocalAsrRequest = LocalAsrCommand & { requestId: number };

export type LocalAsrWorkerEvent =
    | LocalAsrEvent
    | { type: "progress"; message: string; percent?: number }
    | { type: "reply"; requestId: number; error?: string };
