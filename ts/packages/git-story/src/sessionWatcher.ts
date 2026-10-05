// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionMetadata } from "./gitCommitStory.js";
import {
    captureSessionUpdates,
    type CapturedSessionUpdates,
    type SessionCaptureOptions,
} from "./sessionCapture.js";
import {
    normalizeSessionEvents,
    type NormalizedSessionBatch,
} from "./sessionNormalization.js";
import {
    collectSessionMetadata,
    restoreSessionMetadata,
    type RestoredSessionMetadata,
    type SessionMetadataState,
} from "./sessionMetadata.js";

export type {
    NormalizedSessionBatch,
    SessionNormalizationDiagnostic,
} from "./sessionNormalization.js";
export type {
    RestoredSessionMetadata,
    SessionMetadataState,
} from "./sessionMetadata.js";

export type {
    CapturedSessionRecord,
    CapturedSessionUpdates,
    SessionCaptureDiagnostic,
    SessionCaptureOptions,
    SessionCaptureSource,
} from "./sessionCapture.js";

export type SessionWatchRequest = {
    projectPath: string;
    sessionId: string;
    transcriptPath: string;
    metadata: CapturedSessionMetadata;
};

// Capture progress only, not acknowledgement of downstream processing.
export type SessionCaptureCheckpoint = {
    sessionId: string;
    transcriptPath: string;
    // Decimal byte offset after the last complete JSONL record, not a line number.
    sourceByteOffset: string;
};

export type NormalizedSessionEvent = {
    // Original source ID when present; otherwise a generated GUID.
    id: string;
    // Native source ID only; omitted when the source event has no ID.
    sourceEventId?: string;
    timestamp?: string;
    model?: string;
    agentId?: string;
} & (
    | {
          type: "message";
          role: "user" | "agent" | "system";
          text: string;
      }
    | {
          type: "tool-start";
          toolCallId: string;
          toolName: string;
          arguments: unknown;
      }
    | {
          type: "tool-complete";
          toolCallId: string;
          success: boolean;
          output?: string;
          // UI detail can be text or structured evidence, not necessarily a diff.
          detailedContent?: unknown;
          error?: Record<string, unknown>;
          // Source-reported edit evidence, not a diff reconstructed from Git.
          // Absence means no recorded diff, not that the tool changed no files.
          diff?: string;
      }
    | {
          type: "session";
          eventType: string;
          details: Record<string, unknown>;
      }
);

export type CapturedSessionMetadata = SessionMetadata & {
    parentSessionId?: string;
    startedAt?: string;
    lastEventTimestamp?: string;
};

export type NormalizedSessionUpdate = {
    projectPath: string;
    sessionId: string;
    events: NormalizedSessionEvent[];
    metadata: CapturedSessionMetadata;
};

export class SessionWatcher {
    async watch(_request: SessionWatchRequest): Promise<void> {
        // Pseudocode:
        // Validate the GHCP session identity and transcript path.
        // Register one watch per project/session and load its last-read checkpoint.
        // Validate the checkpoint's session/transcript and resume byte offset.
        // Restore generated-ID assignments separately from the read checkpoint.
        // Catch up existing records, then schedule processUpdates on source changes.
        // Serialize processing per session; coalesce notifications without losing updates.
        // Resolve when monitoring is established, not when the session ends.
        // Surface setup failures here and later processing failures through daemon reporting.
        throw new Error("SessionWatcher.watch is not implemented");
    }

    async stop(): Promise<void> {
        // Pseudocode:
        // Stop accepting notifications for all sessions watched by this instance.
        // Dispose subscriptions/timers and await in-flight processing.
        // Keep the last-read checkpoints; release readers and session state.
        // Surface shutdown failures; repeated stops should be safe once implemented.
        throw new Error("SessionWatcher.stop is not implemented");
    }

    async processUpdates(
        _request: SessionWatchRequest,
        _checkpoint?: SessionCaptureCheckpoint,
    ): Promise<SessionCaptureCheckpoint> {
        // Pseudocode:
        // captured = await captureUpdates(request, checkpoint).
        // Capture has persisted read progress, independently of ingestion.
        // batch = normalizeEvents(request, captured); surface batch.diagnostics.
        // state = collectMetadata(request, batch, previous generation-bound state).
        // events = batch.events; metadata = state.metadata.
        // approved = await filterForPrivacy({ projectPath, sessionId, events, metadata }).
        // If approved is not null, await publishUpdate(approved).
        // Return captured.nextCheckpoint; it does not certify downstream delivery.
        // Surface processing/delivery errors; recovery after capture requires separate replay.
        // Do not log or publish raw records or pre-filter metadata.
        throw new Error("SessionWatcher.processUpdates is not implemented");
    }

    async captureUpdates(
        request: SessionWatchRequest,
        checkpoint?: SessionCaptureCheckpoint,
        options?: SessionCaptureOptions,
    ): Promise<CapturedSessionUpdates> {
        return captureSessionUpdates(request, checkpoint, options);
    }

    normalizeEvents(
        request: SessionWatchRequest,
        updates: CapturedSessionUpdates,
    ): NormalizedSessionBatch {
        return normalizeSessionEvents(request, updates);
    }

    collectMetadata(
        request: SessionWatchRequest,
        batch: NormalizedSessionBatch,
        previous?: SessionMetadataState,
    ): SessionMetadataState {
        return collectSessionMetadata(request, batch, previous);
    }

    async restoreMetadata(
        request: SessionWatchRequest,
        through: SessionCaptureCheckpoint,
        generation: string,
        options?: Pick<SessionCaptureOptions, "stateDirectory" | "maxRecords">,
    ): Promise<RestoredSessionMetadata> {
        return restoreSessionMetadata(request, through, generation, options);
    }

    async filterForPrivacy(
        _update: NormalizedSessionUpdate,
    ): Promise<NormalizedSessionUpdate | null> {
        // Pseudocode:
        // Connect the separately implemented privacy filter here.
        // Pass all outgoing content: messages, arguments, results, diffs, paths, and metadata.
        // Return the approved/redacted update, or null for deliberate exclusion.
        // Preserve valid references after filtering, without leaking excluded content.
        // If the filter is absent or fails, throw; never pass unfiltered data through.
        throw new Error("SessionWatcher.filterForPrivacy is not implemented");
    }

    async publishUpdate(_update: NormalizedSessionUpdate): Promise<void> {
        // Pseudocode:
        // Deliver only privacy-approved events and metadata to downstream memory ingestion.
        // Use stable session/event IDs for idempotent delivery, including metadata updates.
        // Hand off without waiting for memory extraction or story building.
        // Surface delivery errors; this handoff does not control the read checkpoint.
        // Memory extraction, story preparation, and commit attribution happen downstream.
        throw new Error("SessionWatcher.publishUpdate is not implemented");
    }
}
