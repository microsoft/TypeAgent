// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import type {
    CapturedSessionUpdates,
    SessionCaptureOptions,
} from "./sessionCapture.js";
import {
    byteOffset,
    captureStatePath,
    loadCaptureState,
    withCaptureStateLock,
} from "./sessionCaptureState.js";
import { assertSessionSource, decodeSessionRecord } from "./sessionRecord.js";
import {
    assertRecordBoundary,
    completeRecords,
    matchesTranscriptIdentity,
    verifyTranscript,
} from "./sessionTranscript.js";
import type {
    SessionCaptureCheckpoint,
    SessionWatchRequest,
} from "./sessionWatcher.js";

// Batches are provisional until this promise resolves. The caller must keep
// reductions private and discard them on failure, never publish from consume.
export async function replaySessionUpdates(
    request: SessionWatchRequest,
    through: SessionCaptureCheckpoint,
    generation: string,
    consume: (batch: CapturedSessionUpdates) => void,
    options: Pick<SessionCaptureOptions, "stateDirectory" | "maxRecords"> = {},
): Promise<void> {
    assertSessionSource(request, through);
    const end = byteOffset(through.sourceByteOffset);
    const maxRecords = options.maxRecords ?? 1000;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
        throw new Error(
            "Metadata replay maxRecords must be a positive safe integer",
        );
    }
    const stateFile = captureStatePath(
        request.sessionId,
        through.transcriptPath,
        options.stateDirectory,
    );
    await withCaptureStateLock(stateFile, async () => {
        const saved = await loadCaptureState(stateFile);
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
            const stat = await file.stat({ bigint: true });
            if (
                !matchesTranscriptIdentity(
                    stat,
                    saved.fileIdentity,
                    BigInt(saved.observedSize),
                )
            ) {
                throw new Error(
                    "Metadata replay transcript generation does not match",
                );
            }
            await assertRecordBoundary(file, end);
            const emptyBatch = (): CapturedSessionUpdates => ({
                records: [],
                diagnostics: [],
                generation,
                nextCheckpoint: { ...through, sourceByteOffset: "0" },
            });
            const resolveGeneratedId = (offset: string): string => {
                const id = saved.generatedIds[offset];
                if (id === undefined) {
                    throw new Error(
                        "Metadata replay is missing a persisted event ID",
                    );
                }
                return id;
            };
            let batch = emptyBatch();
            let count = 0;
            let next = 0;
            for await (const { line, offset } of completeRecords(
                file,
                0,
                end,
            )) {
                decodeSessionRecord(
                    line,
                    {
                        sessionId: through.sessionId,
                        transcriptPath: through.transcriptPath,
                        generation,
                        sourceByteOffset: String(offset),
                    },
                    resolveGeneratedId,
                    batch,
                );
                next = offset + line.length;
                batch.nextCheckpoint.sourceByteOffset = String(next);
                if (++count === maxRecords) {
                    consume(batch);
                    batch = emptyBatch();
                    count = 0;
                }
            }
            if (next !== end) {
                throw new Error(
                    "Metadata replay did not reach the expected record boundary",
                );
            }
            if (count > 0) consume(batch);
            await verifyTranscript(file, through.transcriptPath, stat);
        } finally {
            await file.close();
        }
    });
}
