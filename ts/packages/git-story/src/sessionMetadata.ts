// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import type { SessionCaptureOptions } from "./sessionCapture.js";
import { assertSessionSource } from "./sessionRecord.js";
import { replaySessionUpdates } from "./sessionReplay.js";
import {
    latestTimestamp,
    normalizeSessionEvents,
    type NormalizedSessionBatch,
    type SessionNormalizationDiagnostic,
} from "./sessionNormalization.js";
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
    for (const key of [
        "selectedModel",
        "previousModel",
        "newModel",
        "currentModel",
        "chosenModel",
        "fallbackModel",
        "finalSourceModel",
        "followUpModel",
    ]) {
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

export async function restoreSessionMetadata(
    request: SessionWatchRequest,
    through: SessionCaptureCheckpoint,
    generation: string,
    options: Pick<SessionCaptureOptions, "stateDirectory" | "maxRecords"> = {},
): Promise<RestoredSessionMetadata> {
    const checkpoint = { ...through };
    let state = collectSessionMetadata(request, {
        events: [],
        diagnostics: [],
        generation,
        nextCheckpoint: checkpoint,
    });
    const diagnostics: SessionNormalizationDiagnostic[] = [];
    await replaySessionUpdates(
        request,
        through,
        generation,
        (captured) => {
            const batch = normalizeSessionEvents(request, captured);
            state = collectSessionMetadata(request, batch, state);
            diagnostics.push(...batch.diagnostics);
        },
        options,
    );
    return { state, nextCheckpoint: checkpoint, diagnostics };
}
