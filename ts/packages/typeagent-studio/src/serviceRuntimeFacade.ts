// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RepoRootResolution,
    StudioReplayRequest,
    StudioReplayResult,
    StudioCorpusImportRequest,
    StudioCorpusImportResult,
} from "@typeagent/core/runtime";
import type { CorpusEntry, ExternalSourceSpec } from "@typeagent/core/corpus";
import type { FeedbackRecordInput } from "@typeagent/core/feedback";
import type { SandboxStatus } from "@typeagent/core/sandbox";
import type { StudioServiceConnection } from "./studioServiceConnection.js";

/** The Corpus tree's read+subscribe surface (channel-backed). */
export interface CorpusSource {
    onSandboxChanged(listener: () => void): { dispose(): void };
    getRepoRootInfo(): RepoRootResolution;
    listCorpusAgents(): Promise<string[]>;
    listCorpusEntries(agent: string): Promise<CorpusEntry[]>;
}

/** The health status bar's surface (repo info is local; sandboxes are remote). */
export interface HealthSource {
    onSandboxChanged(listener: () => void): { dispose(): void };
    getRepoRootInfo(): RepoRootResolution;
    listSandboxes(): Promise<SandboxStatus[]>;
}

const NOT_CONNECTED =
    "Studio service is not connected. Open the workspace so Studio can launch it, or run `typeagent-studio serve`.";

/**
 * Backs the extension's corpus / health / feedback / replay surfaces with the
 * shared {@link StudioServiceConnection} to the standalone Studio service — the
 * single live runtime for the workspace (the extension no longer runs its own).
 * `repoRootInfo` is resolved locally from the VS Code workspace (no runtime
 * needed); everything else routes to the service. Reads return empty when
 * momentarily disconnected; mutations reject with a clear message.
 */
export class StudioServiceRuntimeFacade implements CorpusSource, HealthSource {
    constructor(
        private readonly connection: StudioServiceConnection,
        private readonly repoRootInfo: RepoRootResolution,
    ) {}

    private require() {
        const client = this.connection.getClient();
        if (client === undefined) {
            throw new Error(NOT_CONNECTED);
        }
        return client;
    }

    getRepoRootInfo(): RepoRootResolution {
        return this.repoRootInfo;
    }

    onSandboxChanged(listener: () => void): { dispose(): void } {
        return this.connection.onEvent((event) => {
            if (event.type.startsWith("sandbox.")) {
                listener();
            }
        });
    }

    async listSandboxes(): Promise<SandboxStatus[]> {
        return (await this.connection.getClient()?.listSandboxes()) ?? [];
    }

    async listCorpusAgents(): Promise<string[]> {
        return (await this.connection.getClient()?.listCorpusAgents()) ?? [];
    }

    async listCorpusEntries(agent: string): Promise<CorpusEntry[]> {
        return (
            (await this.connection.getClient()?.listCorpusEntries(agent)) ?? []
        );
    }

    async seedInRepoCorpus(
        agent: string,
    ): Promise<{ path: string; created: boolean }> {
        return this.require().seedInRepoCorpus(agent);
    }

    async addExternalCorpusSource(spec: ExternalSourceSpec): Promise<void> {
        return this.require().addExternalCorpusSource(spec);
    }

    async importCorpusFromLogs(
        request: StudioCorpusImportRequest,
    ): Promise<StudioCorpusImportResult> {
        return this.require().importCorpusFromLogs(request);
    }

    async recordFeedback(input: FeedbackRecordInput): Promise<void> {
        return this.require().recordFeedback(input);
    }

    async replayCorpus(
        request: StudioReplayRequest,
    ): Promise<StudioReplayResult> {
        return this.require().replayCorpus(request);
    }
}
