// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import type {
    CapturedSessionUpdates,
    SessionCaptureSource,
} from "./sessionCapture.js";
import type {
    SessionCaptureCheckpoint,
    SessionWatchRequest,
} from "./sessionWatcher.js";

export function isSessionTimestamp(value: string): boolean {
    return (
        /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) &&
        Number.isFinite(Date.parse(value))
    );
}

export function assertSessionSource(
    request: SessionWatchRequest,
    source: Pick<SessionCaptureCheckpoint, "sessionId" | "transcriptPath">,
): void {
    if (
        source.sessionId !== request.sessionId ||
        source.transcriptPath !== path.normalize(request.transcriptPath)
    ) {
        throw new Error("Session source does not match registration");
    }
}

// Capture assigns missing IDs durably; read-only replay must only look them up.
export function decodeSessionRecord(
    line: Buffer,
    source: SessionCaptureSource,
    resolveGeneratedId: (sourceByteOffset: string) => string,
    updates: CapturedSessionUpdates,
): void {
    let text: string;
    try {
        text = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
        }).decode(line);
    } catch {
        updates.diagnostics.push({ code: "invalid-utf8", source });
        return;
    }
    let payload: unknown;
    try {
        payload = JSON.parse(text);
    } catch {
        updates.diagnostics.push({ code: "invalid-json", source });
        return;
    }
    const sourceEventId =
        typeof payload === "object" &&
        payload !== null &&
        "id" in payload &&
        typeof payload.id === "string"
            ? payload.id
            : undefined;
    const id = sourceEventId ?? resolveGeneratedId(source.sourceByteOffset);
    updates.records.push({
        id,
        ...(sourceEventId !== undefined ? { sourceEventId } : {}),
        source,
        payload,
    });
}
