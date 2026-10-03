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
    // Decimal byte offset after the last complete JSONL record, not a line number.
    sourceByteOffset: string;
};

export type CapturedSessionUpdates = {
    records: unknown[];
    nextCheckpoint: SessionCaptureCheckpoint;
};

export type NormalizedSessionEvent = {
    // Original source ID when present; otherwise a generated GUID.
    id: string;
    // Native source ID only; omitted when the source event has no ID.
    sourceEventId?: string;
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
        // Validate sessionId/transcriptPath; seek to sourceByteOffset.
        // Detect transcript replacement/truncation before trusting the saved offset.
        // Read complete GHCP JSONL records; leave a partially written tail unread.
        // For ID-less records, assign a GUID once and retain it with the captured record.
        // Persist mappings for all assigned GUIDs, keyed by session/transcript generation/record offset.
        // Save assignments before advancing the checkpoint; reuse them when rereading records.
        // Reconcile replaced/truncated transcripts separately; generated IDs cannot detect changes.
        // Return the session, transcript path, and byte offset after the last complete record.
        // With no complete new events, retain the checkpoint (byte offset zero at the start).
        // The caller persists read progress; do not wait for downstream processing.
        // Surface malformed complete records and unsupported formats explicitly.
        throw new Error("SessionWatcher.captureUpdates is not implemented");
    }

    normalizeEvents(
        _request: SessionWatchRequest,
        _updates: CapturedSessionUpdates,
    ): NormalizedSessionEvent[] {
        // Pseudocode:
        // Validate GHCP payloads and map messages, tools, and session lifecycle records.
        // Map the source's assistant message role to agent in the normalized format.
        // Normalize each source event independently; preserve a native ID as sourceEventId.
        // With a native ID, set id = sourceEventId; do not require GUID format.
        // Without a native ID, omit sourceEventId and set id to the GUID assigned during capture.
        // Keep the assigned GUID separate from the original record's native ID.
        // Distinct ID-less records get distinct GUIDs, even if their content is identical.
        // Reuse persisted assignments on retries/replay instead of generating new GUIDs.
        // All events belong to the parent update's sessionId.
        // Scope event IDs by update.sessionId.
        // Preserve toolCallId to associate starts/results, including across update batches.
        // CLI apply_patch: retain the completion's reported diff and success separately.
        // Preserve script commands/results even when no diff is present.
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
