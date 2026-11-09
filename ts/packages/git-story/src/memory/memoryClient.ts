// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Backend-neutral memory contract. git-story maps a commit story to plain
// records; each backend (KnowPro now, Neumem later) only stores records.
//
//   GitCommitStory --storyRecords()--> MemoryRecord[] --IMemoryClient.add()--> backend
//   { sessions[].summary[] }           { id: "abc123/s1/1", text, tags }       KnowPro | Neumem

import type { GitCommitStory } from "../gitCommitStory.js";
import { KnowProMemoryClient } from "./knowProMemoryClient.js";

// One searchable unit. `id` is deterministic so retries can deduplicate.
export type MemoryRecord = {
    id: string;
    text: string;
    timestamp?: string | undefined;
    tags: string[];
};

export interface IMemoryClient {
    add(records: MemoryRecord[]): Promise<void>;
}

// Backend selection. Add a variant per backend, e.g. { kind: "neumem", ... }.
export type MemoryBackend = { kind: "knowpro"; directory: string };

export async function createMemoryClient(
    backend: MemoryBackend,
): Promise<IMemoryClient> {
    switch (backend.kind) {
        case "knowpro":
            return KnowProMemoryClient.open(backend.directory);
    }
}

// Map each session summary entry to one record tagged with its provenance.
export function storyRecords(
    commitSha: string,
    story: GitCommitStory,
): MemoryRecord[] {
    return story.sessions.flatMap((session) =>
        session.summary.map((summary) => ({
            id: `${commitSha}/${session.sessionId}/${summary.id}`,
            text: summary.text,
            timestamp: summary.timestamp,
            tags: [
                `commit:${commitSha}`,
                `session:${session.sessionId}`,
                ...session.metadata.models.map((model) => `model:${model}`),
            ],
        })),
    );
}
