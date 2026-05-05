// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PlatformBackend } from "./platform/index.js";
import type { SpawnedRecording } from "./recordingProcess.js";

export type ActiveRecording = {
    spawned: SpawnedRecording;
    // Path under sessionStorage (relative form like "../recordings/foo.mp4").
    storagePath: string;
    // Absolute filesystem path passed to ffmpeg.
    absolutePath: string;
    target: string | undefined;
    startedAtMs: number;
};

export type ScreencaptureActionContext = {
    // null = probed and missing; undefined = not probed yet.
    ffmpegPath: string | null | undefined;
    backend: PlatformBackend | undefined;
    backendError: string | undefined;
    active: ActiveRecording | undefined;
};

export function createInitialContext(): ScreencaptureActionContext {
    return {
        ffmpegPath: undefined,
        backend: undefined,
        backendError: undefined,
        active: undefined,
    };
}
