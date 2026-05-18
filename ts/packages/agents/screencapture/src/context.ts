// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChoiceManager } from "@typeagent/agent-sdk/helpers/action";
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
    // Manages yes/no choice callbacks for the setup prompt. Required for the
    // createYesNoChoiceResult / handleChoice pattern.
    choiceManager: ChoiceManager;
    // Mutex on the install pipeline. The dispatcher's setup re-entrancy guard
    // only covers the synchronous setup() call; the actual install runs later
    // via the choice card's callback, which is a separate context. Two
    // clients each clicking "Yes" on their own setup cards would otherwise
    // run winget / apt-get install in parallel (potential lock contention or
    // duplicate UAC prompts).
    installInProgress: boolean;
};

export function createInitialContext(): ScreencaptureActionContext {
    return {
        ffmpegPath: undefined,
        backend: undefined,
        backendError: undefined,
        active: undefined,
        choiceManager: new ChoiceManager(),
        installInProgress: false,
    };
}
