// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { SessionMetadata } from "./gitCommitStory.js";

export type SessionWatchRequest = {
    projectPath: string;
    sessionId: string;
    transcriptPath: string;
    metadata: SessionMetadata;
};

// Capture progress only, not acknowledgement of downstream processing.
export type SessionCaptureCheckpoint = {
    sessionId: string;
    transcriptPath: string;
    // Null until a complete event has been read.
    lastReadEventId: string | null;
    // Adapter-specific resume position after the last complete event.
    sourcePosition: string;
};

export type CapturedSessionUpdates = {
    records: unknown[];
    nextCheckpoint: SessionCaptureCheckpoint;
};

export type NormalizedSessionEvent = {
    sourceEventId: string;
    timestamp?: string;
    model?: string;
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
        // Validate the session/transcript identity and select its source adapter.
        // Register one watch per project/session and load its last-read checkpoint.
        // Verify the checkpoint's session, transcript, and event before resuming.
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
        // Persist captured.nextCheckpoint as read progress, independently of ingestion.
        // events = normalizeEvents(request, captured).
        // metadata = collectMetadata(request, events, previous session metadata).
        // approved = await filterForPrivacy({ projectPath, sessionId, events, metadata }).
        // If approved is not null, await publishUpdate(approved).
        // Return captured.nextCheckpoint; it does not certify downstream delivery.
        // Surface processing/delivery errors; recovery after capture requires separate replay.
        // Do not log or publish raw records or pre-filter metadata.
        throw new Error("SessionWatcher.processUpdates is not implemented");
    }

    async captureUpdates(
        _request: SessionWatchRequest,
        _checkpoint?: SessionCaptureCheckpoint,
    ): Promise<CapturedSessionUpdates> {
        // Pseudocode:
        // Validate sessionId/transcriptPath and resume after lastReadEventId.
        // Use sourcePosition for efficient seeking, verifying it against the saved event.
        // CLI: consume complete JSONL records; leave a partially written tail unread.
        // VS Code: reconstruct transcript state from its source-specific update format.
        // Detect replacement/truncation and reconcile stable IDs rather than skipping data.
        // Return the session, transcript path, last complete event ID, and resume position.
        // With no complete new events, retain the checkpoint (null event ID at the start).
        // The caller persists read progress; do not wait for downstream processing.
        // Surface malformed complete records and unsupported formats explicitly.
        throw new Error("SessionWatcher.captureUpdates is not implemented");
    }

    normalizeEvents(
        _request: SessionWatchRequest,
        _updates: CapturedSessionUpdates,
    ): NormalizedSessionEvent[] {
        // Pseudocode:
        // Validate source payloads and map messages, tools, and session lifecycle records.
        // Map the source's assistant message role to agent in the normalized format.
        // Normalize each source event independently, preserving its ID as sourceEventId.
        // All events belong to the parent update's sessionId.
        // Identify events by (update.sessionId, event.sourceEventId).
        // If native IDs are absent, persist a stable source-record identity for retries.
        // Preserve toolCallId to associate starts/results, including across update batches.
        // CLI apply_patch: retain the completion's reported diff and success separately.
        // Preserve script commands/results even when no diff is present.
        // VS Code edit groups need adapter-specific handling; do not invent tool-call links.
        // Diagnose unsupported records; ignore only explicitly recognized non-content records.
        // Do not infer intent, extract memories, or assign events to commits.
        throw new Error("SessionWatcher.normalizeEvents is not implemented");
    }

    collectMetadata(
        _request: SessionWatchRequest,
        _events: NormalizedSessionEvent[],
        _previous?: CapturedSessionMetadata,
    ): CapturedSessionMetadata {
        // Pseudocode:
        // Merge request metadata, previous observations, and explicit source metadata.
        // Collect client name, distinct models, session times, and parent/subagent linkage.
        // Preserve missing values as unknown; do not infer authorship or commit ownership.
        // Keep metadata associated with this session, not a presumed candidate commit.
        // Return it for privacy filtering together with the normalized events.
        throw new Error("SessionWatcher.collectMetadata is not implemented");
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
