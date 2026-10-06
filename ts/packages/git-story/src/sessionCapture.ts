// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    byteOffset,
    captureStatePath,
    loadCaptureState,
    saveCaptureState,
    withCaptureStateLock,
    type CaptureState,
} from "./sessionCaptureState.js";
import {
    assertRecordBoundary,
    fileIdentity,
    readCompleteRecords,
    matchesTranscriptIdentity,
    verifyTranscript,
} from "./sessionTranscript.js";
import { decodeSessionRecord } from "./sessionRecord.js";
import type {
    SessionCaptureCheckpoint,
    SessionWatchRequest,
} from "./sessionWatcher.js";

export type SessionCaptureSource = {
    sessionId: string;
    transcriptPath: string;
    generation: string;
    // Start of this record, unlike the checkpoint's end-of-record offset.
    sourceByteOffset: string;
};

export type CapturedSessionRecord = {
    id: string;
    // Present only for a native string ID, preserved verbatim (even empty).
    sourceEventId?: string;
    source: SessionCaptureSource;
    // Parsed original JSON, never augmented with the assigned ID.
    payload: unknown;
};

export type SessionCaptureDiagnostic = {
    code: "invalid-json" | "invalid-utf8" | "source-reset";
    source: SessionCaptureSource;
};

export type CapturedSessionUpdates = {
    records: CapturedSessionRecord[];
    diagnostics: SessionCaptureDiagnostic[];
    generation: string;
    nextCheckpoint: SessionCaptureCheckpoint;
};

export type SessionCaptureOptions = {
    stateDirectory?: string;
    // Complete records, including malformed ones; default 1000.
    maxRecords?: number;
    // Required with an explicit nonzero checkpoint to disambiguate generations.
    expectedGeneration?: string;
};

function validateCheckpoint(
    checkpoint: SessionCaptureCheckpoint,
    sessionId: string,
    transcriptPath: string,
): number {
    if (
        checkpoint.sessionId !== sessionId ||
        checkpoint.transcriptPath !== transcriptPath
    ) {
        throw new Error(
            "Capture checkpoint does not match the session/transcript",
        );
    }
    return byteOffset(checkpoint.sourceByteOffset);
}

function replayOffset(
    checkpoint: SessionCaptureCheckpoint | undefined,
    saved: CaptureState | undefined,
    reset: boolean,
    expectedGeneration: string | undefined,
): number | undefined {
    if (
        expectedGeneration !== undefined &&
        (expectedGeneration !== saved?.generation || reset)
    ) {
        throw new Error("Capture transcript generation does not match");
    }
    const offset = checkpoint
        ? byteOffset(checkpoint.sourceByteOffset)
        : undefined;
    if (
        offset &&
        (!saved ||
            reset ||
            offset > byteOffset(saved.checkpoint.sourceByteOffset))
    ) {
        throw new Error("Cannot apply an unverified capture checkpoint");
    }
    return offset;
}

async function capture(
    request: SessionWatchRequest,
    checkpoint: SessionCaptureCheckpoint | undefined,
    options: SessionCaptureOptions,
    stateFile: string,
    maxRecords: number,
): Promise<CapturedSessionUpdates> {
    const { sessionId, transcriptPath } = request;
    const saved = await loadCaptureState(stateFile);
    if (saved) validateCheckpoint(saved.checkpoint, sessionId, transcriptPath);
    const file = await fs.open(transcriptPath, "r");
    try {
        const stat = await file.stat({ bigint: true });
        const size = Number(stat.size);
        if (!stat.isFile() || !Number.isSafeInteger(size)) {
            throw new Error(
                "Capture requires a regular file with a safe byte size",
            );
        }
        const identity = fileIdentity(stat);
        const savedEnd = saved
            ? byteOffset(saved.checkpoint.sourceByteOffset)
            : 0;
        const reset =
            saved !== undefined &&
            !matchesTranscriptIdentity(
                stat,
                saved.fileIdentity,
                BigInt(saved.observedSize),
            );
        const explicitOffset = replayOffset(
            checkpoint,
            saved,
            reset,
            options.expectedGeneration,
        );
        const previous = reset ? undefined : saved;
        const start = explicitOffset ?? (previous ? savedEnd : 0);
        await assertRecordBoundary(file, start);
        const generation = previous?.generation ?? randomUUID();
        const generatedIds = previous?.generatedIds ?? {};
        const checkpointAt = (offset: number): SessionCaptureCheckpoint => ({
            sessionId,
            transcriptPath,
            sourceByteOffset: String(offset),
        });
        const sourceAt = (offset: number): SessionCaptureSource => ({
            ...checkpointAt(offset),
            generation,
        });
        const updates: CapturedSessionUpdates = {
            records: [],
            diagnostics: reset
                ? [{ code: "source-reset", source: sourceAt(0) }]
                : [],
            generation,
            nextCheckpoint: checkpointAt(start),
        };
        const previousEnd = previous ? savedEnd : 0;
        const next = await readCompleteRecords(
            file,
            start,
            size,
            maxRecords,
            (line, offset) => {
                decodeSessionRecord(
                    line,
                    sourceAt(offset),
                    (key) => (generatedIds[key] ??= randomUUID()),
                    updates,
                );
            },
        );
        const highWater = Math.max(previousEnd, next);
        await verifyTranscript(file, transcriptPath, stat);
        const state: CaptureState = {
            version: 1,
            checkpoint: checkpointAt(highWater),
            generation,
            fileIdentity: identity,
            observedSize: size,
            generatedIds,
        };
        await saveCaptureState(stateFile, state);
        updates.nextCheckpoint = checkpointAt(next);
        return updates;
    } finally {
        await file.close();
    }
}

// Persists capture progress before returning, independently of downstream delivery.
// Explicit replay does not move the saved high-water checkpoint backwards.
export async function captureSessionUpdates(
    request: SessionWatchRequest,
    checkpoint?: SessionCaptureCheckpoint,
    options: SessionCaptureOptions = {},
): Promise<CapturedSessionUpdates> {
    if (!request.sessionId || !path.isAbsolute(request.transcriptPath)) {
        throw new Error(
            "Capture requires a session ID and absolute transcript path",
        );
    }
    const transcriptPath = path.normalize(request.transcriptPath);
    const maxRecords = options.maxRecords ?? 1000;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
        throw new Error("Capture maxRecords must be a positive safe integer");
    }
    if (checkpoint) {
        const offset = validateCheckpoint(
            checkpoint,
            request.sessionId,
            transcriptPath,
        );
        if (offset !== 0 && options.expectedGeneration === undefined) {
            throw new Error(
                "Nonzero capture checkpoints require expectedGeneration",
            );
        }
    }
    const stateFile = captureStatePath(
        request.sessionId,
        transcriptPath,
        options.stateDirectory,
    );
    return withCaptureStateLock(stateFile, () =>
        capture(
            { ...request, transcriptPath },
            checkpoint,
            options,
            stateFile,
            maxRecords,
        ),
    );
}
