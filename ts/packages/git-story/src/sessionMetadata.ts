// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    captureSessionUpdates,
    type SessionCaptureOptions,
} from "./sessionCapture.js";
import {
    byteOffset,
    captureStatePath,
    loadCaptureState,
} from "./sessionCaptureState.js";
import {
    assertSessionSource,
    latestTimestamp,
    normalizeSessionEvents,
    type NormalizedSessionBatch,
    type SessionNormalizationDiagnostic,
} from "./sessionNormalization.js";
import {
    assertRecordBoundary,
    fileIdentity,
    readCompleteRecords,
} from "./sessionTranscript.js";
import type {
    CapturedSessionMetadata,
    NormalizedSessionEvent,
    SessionCaptureCheckpoint,
    SessionWatchRequest,
} from "./sessionWatcher.js";

export type SessionMetadataState = {
    sessionId: string;
    transcriptPath: string;
    generation: string;
    metadata: CapturedSessionMetadata;
};

export type RestoredSessionMetadata = {
    state: SessionMetadataState;
    nextCheckpoint: SessionCaptureCheckpoint;
    diagnostics: SessionNormalizationDiagnostic[];
};

function earlier(
    previous: string | undefined,
    next: string | undefined,
): string | undefined {
    return next !== undefined &&
        (previous === undefined || Date.parse(next) < Date.parse(previous))
        ? next
        : previous;
}

function sessionMetadata(
    event: Extract<NormalizedSessionEvent, { type: "session" }>,
    metadata: CapturedSessionMetadata,
    models: Set<string>,
): void {
    const data = event.details;
    for (const key of ["selectedModel", "previousModel", "newModel"]) {
        const model = data[key];
        if (typeof model === "string") models.add(model);
    }
    if (
        event.eventType !== "session.start" &&
        event.eventType !== "session.resume"
    ) {
        return;
    }
    const client = data.clientName ?? data.producer;
    if (typeof client === "string") metadata.clientName = client;
    const parent =
        data.parentSessionId ?? data.detachedFromSpawningParentSessionId;
    if (typeof parent === "string") metadata.parentSessionId = parent;
    const start =
        typeof data.startTime === "string"
            ? data.startTime
            : event.eventType === "session.start"
              ? event.timestamp
              : undefined;
    const startedAt = earlier(metadata.startedAt, start);
    if (startedAt !== undefined) metadata.startedAt = startedAt;
}

export function collectSessionMetadata(
    request: SessionWatchRequest,
    batch: NormalizedSessionBatch,
    previous?: SessionMetadataState,
): SessionMetadataState {
    assertSessionSource(request, batch.nextCheckpoint);
    if (previous) assertSessionSource(request, previous);
    const retained =
        previous?.generation === batch.generation
            ? previous.metadata
            : undefined;
    const metadata: CapturedSessionMetadata = {
        ...request.metadata,
        ...retained,
        models: [],
    };
    const models = new Set([
        ...request.metadata.models,
        ...(retained?.models ?? []),
    ]);
    const startedAt = earlier(request.metadata.startedAt, retained?.startedAt);
    if (startedAt !== undefined) metadata.startedAt = startedAt;
    const lastEventTimestamp = latestTimestamp(
        latestTimestamp(
            request.metadata.lastEventTimestamp,
            retained?.lastEventTimestamp,
        ),
        batch.lastEventTimestamp,
    );
    if (lastEventTimestamp !== undefined)
        metadata.lastEventTimestamp = lastEventTimestamp;
    for (const event of batch.events) {
        if (event.model !== undefined) models.add(event.model);
        if (event.type === "session") sessionMetadata(event, metadata, models);
    }
    metadata.models = [...models];
    return {
        sessionId: request.sessionId,
        transcriptPath: path.normalize(request.transcriptPath),
        generation: batch.generation,
        metadata,
    };
}

async function replayRecordCount(
    request: SessionWatchRequest,
    through: SessionCaptureCheckpoint,
    generation: string,
    options: Pick<SessionCaptureOptions, "stateDirectory">,
): Promise<number> {
    assertSessionSource(request, through);
    const end = byteOffset(through.sourceByteOffset);
    const saved = await loadCaptureState(
        captureStatePath(
            request.sessionId,
            through.transcriptPath,
            options.stateDirectory,
        ),
    );
    if (
        !saved ||
        saved.generation !== generation ||
        end > byteOffset(saved.checkpoint.sourceByteOffset)
    ) {
        throw new Error(
            "Metadata replay requires a captured generation and boundary",
        );
    }
    assertSessionSource(request, saved.checkpoint);
    const file = await fs.open(through.transcriptPath, "r");
    try {
        await assertRecordBoundary(file, end);
        const stat = await file.stat({ bigint: true });
        if (
            fileIdentity(stat) !== saved.fileIdentity ||
            stat.size < BigInt(saved.observedSize)
        ) {
            throw new Error(
                "Metadata replay transcript generation does not match",
            );
        }
        let count = 0;
        const digest = createHash("sha256");
        // Count the same verified bytes as capture, not an unverified prefix
        // that could change and change back before replay begins.
        await readCompleteRecords(
            file,
            0,
            byteOffset(saved.checkpoint.sourceByteOffset),
            Number.MAX_SAFE_INTEGER,
            (line, offset) => {
                digest.update(line);
                if (offset < end) count++;
            },
        );
        const current = await fs.stat(through.transcriptPath, { bigint: true });
        if (
            digest.digest("hex") !== saved.prefixDigest ||
            fileIdentity(current) !== saved.fileIdentity ||
            current.size < stat.size
        ) {
            throw new Error(
                "Metadata replay transcript generation does not match",
            );
        }
        return count;
    } finally {
        await file.close();
    }
}

export async function restoreSessionMetadata(
    request: SessionWatchRequest,
    through: SessionCaptureCheckpoint,
    generation: string,
    options: Pick<SessionCaptureOptions, "stateDirectory" | "maxRecords"> = {},
): Promise<RestoredSessionMetadata> {
    const maxRecords = options.maxRecords ?? 1000;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
        throw new Error(
            "Metadata replay maxRecords must be a positive safe integer",
        );
    }
    let remaining = await replayRecordCount(
        request,
        through,
        generation,
        options,
    );
    let checkpoint = { ...through, sourceByteOffset: "0" };
    let state = collectSessionMetadata(request, {
        events: [],
        diagnostics: [],
        generation,
        nextCheckpoint: checkpoint,
    });
    const diagnostics: SessionNormalizationDiagnostic[] = [];
    while (remaining > 0) {
        const count = Math.min(maxRecords, remaining);
        // A bounded record count keeps replay from consuming appends beyond through.
        // Capture revalidates the generation after the counting pass and each batch.
        const captured = await captureSessionUpdates(request, checkpoint, {
            ...options,
            maxRecords: count,
            expectedGeneration: generation,
        });
        if (
            byteOffset(captured.nextCheckpoint.sourceByteOffset) <=
                byteOffset(checkpoint.sourceByteOffset) ||
            byteOffset(captured.nextCheckpoint.sourceByteOffset) >
                byteOffset(through.sourceByteOffset)
        ) {
            throw new Error(
                "Metadata replay did not reach the expected record boundary",
            );
        }
        const batch = normalizeSessionEvents(request, captured);
        state = collectSessionMetadata(request, batch, state);
        diagnostics.push(...batch.diagnostics);
        checkpoint = captured.nextCheckpoint;
        remaining -= count;
    }
    if (checkpoint.sourceByteOffset !== through.sourceByteOffset) {
        throw new Error(
            "Metadata replay did not reach the expected record boundary",
        );
    }
    return { state, nextCheckpoint: checkpoint, diagnostics };
}
