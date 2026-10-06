// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { deserialize, serialize } from "node:v8";
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

// What a client hook sends. A client that knows its transcript (VS Code
// passes `transcript_path`) sends it; otherwise the daemon derives it from
// metadata.clientName, so hooks need no client storage layout.
export type SessionRegistration = Omit<
    SessionWatchRequest,
    "transcriptPath"
> & {
    transcriptPath?: string | undefined;
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
    parentId?: string;
    parentToolCallId?: string;
    parentAgentTaskId?: string;
    messageId?: string;
    originatingMessageId?: string;
    interactionId?: string;
    turnId?: string;
    requestId?: string;
} & (
    | {
          type: "message";
          role: "user" | "agent" | "system";
          text: string;
          attachments?: unknown[];
          toolRequests?: unknown;
          citations?: unknown;
      }
    | {
          type: "tool-start";
          toolCallId: string;
          toolName: string;
          arguments: unknown;
          // External requests and user-requested tools can precede execution_start.
          eventType?: string;
          providerId?: string | null;
          workingDirectory?: string;
          mcpServerName?: string;
          mcpToolName?: string;
      }
    | {
          type: "tool-complete";
          toolCallId: string;
          success: boolean;
          output?: string;
          // UI detail can be text or structured evidence, not necessarily a diff.
          detailedContent?: unknown;
          // Native content blocks and verbatim MCP JSON, independent of UI detail.
          contents?: unknown;
          structuredContent?: unknown;
          citableSources?: unknown;
          resultMcpMeta?: unknown;
          mcpMeta?: unknown;
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

export type SessionPrivacyFilter = (
    update: NormalizedSessionUpdate,
) => NormalizedSessionUpdate | null | Promise<NormalizedSessionUpdate | null>;

// Resolve after accepting the approved update, not after memory extraction.
export type ApprovedUpdateDestination = (
    update: NormalizedSessionUpdate,
) => void | Promise<void>;

export type SessionWatcherDependencies = {
    privacyFilter?: SessionPrivacyFilter;
    approvedUpdateDestination?: ApprovedUpdateDestination;
};

const approvalBrand = Symbol("ApprovedSessionUpdate");

// An opaque handle, valid only on the watcher that issued it.
export type ApprovedSessionUpdate = {
    readonly [approvalBrand]: true;
};

function snapshotUpdate(
    update: NormalizedSessionUpdate,
): NormalizedSessionUpdate {
    try {
        // Unlike structuredClone, serialization rejects shared-memory buffers.
        return deserialize(serialize(update)) as NormalizedSessionUpdate;
    } catch {
        // Clone errors can contain raw content; do not retain a cause.
        throw new Error("SessionWatcher update snapshot failed");
    }
}

export class SessionWatcher {
    readonly #privacyFilter: SessionPrivacyFilter | undefined;
    readonly #approvedUpdateDestination: ApprovedUpdateDestination | undefined;
    readonly #approvedUpdates = new WeakMap<
        ApprovedSessionUpdate,
        NormalizedSessionUpdate
    >();

    constructor({
        privacyFilter,
        approvedUpdateDestination,
    }: SessionWatcherDependencies = {}) {
        this.#privacyFilter = privacyFilter;
        this.#approvedUpdateDestination = approvedUpdateDestination;
    }

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
        update: NormalizedSessionUpdate,
    ): Promise<ApprovedSessionUpdate | null> {
        if (this.#privacyFilter === undefined) {
            throw new Error("SessionWatcher privacy filter is not configured");
        }
        const input = snapshotUpdate(update);
        let result: NormalizedSessionUpdate | null;
        try {
            result = await this.#privacyFilter(input);
        } catch {
            // Dependency errors can contain raw content; do not retain a cause.
            throw new Error("SessionWatcher privacy filtering failed");
        }
        if (result === null) {
            return null;
        }
        const approved = snapshotUpdate(result);
        if (
            approved === undefined ||
            typeof approved !== "object" ||
            typeof approved.projectPath !== "string" ||
            typeof approved.sessionId !== "string" ||
            !Array.isArray(approved.events) ||
            approved.metadata === null ||
            typeof approved.metadata !== "object" ||
            typeof approved.metadata.clientName !== "string" ||
            !Array.isArray(approved.metadata.models)
        ) {
            throw new Error(
                "SessionWatcher privacy filter returned an invalid update",
            );
        }
        const handle: ApprovedSessionUpdate = Object.freeze({
            [approvalBrand]: true,
        });
        this.#approvedUpdates.set(handle, approved);
        return handle;
    }

    async publishUpdate(update: ApprovedSessionUpdate): Promise<void> {
        const approved = this.#approvedUpdates.get(update);
        if (approved === undefined) {
            throw new Error(
                "SessionWatcher update is not approved by this watcher",
            );
        }
        if (this.#approvedUpdateDestination === undefined) {
            throw new Error(
                "SessionWatcher approved-update destination is not configured",
            );
        }
        const delivery = snapshotUpdate(approved);
        try {
            await this.#approvedUpdateDestination(delivery);
        } catch {
            throw new Error("SessionWatcher approved-update delivery failed");
        }
    }
}
