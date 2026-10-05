// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { GitCommitStory } from "./gitCommitStory.js";

export const MAXIMUM_STORY_BYTES = 16 * 1024;
const STORY_BLOCK_PATTERN = /(?:\n\n)?~~~story v2\r?\n[^]*?\r?\n~~~/g;
const STORY_TRAILER_PATTERN = /^Story-Session:.*(?:\r?\n|$)/gm;

function section(story: GitCommitStory): string {
    const trailers = story.sessions
        .map(({ session }) => `Story-Session: ${session}`)
        .join("\n");
    return [`~~~story v2\n${JSON.stringify(story)}\n~~~`, trailers]
        .filter(Boolean)
        .join("\n\n");
}

function bytes(story: GitCommitStory): number {
    return Buffer.byteLength(section(story), "utf8");
}

// Keep elevated-risk commands while dropping optional context to meet Git's cap.
function fit(story: GitCommitStory): GitCommitStory {
    const value = structuredClone(story);
    if (bytes(value) <= MAXIMUM_STORY_BYTES) return value;
    for (const session of value.sessions) session.snippets = [];
    while (bytes(value) > MAXIMUM_STORY_BYTES) {
        let removed = false;
        for (const session of [...value.sessions].reverse()) {
            let index = -1;
            for (
                let candidate = session.commands.length - 1;
                candidate >= 0;
                candidate--
            ) {
                if (session.commands[candidate].risk === "run") {
                    index = candidate;
                    break;
                }
            }
            if (index < 0) continue;
            session.commands.splice(index, 1);
            removed = true;
            if (bytes(value) <= MAXIMUM_STORY_BYTES) break;
        }
        if (!removed) break;
    }
    if (bytes(value) > MAXIMUM_STORY_BYTES) {
        throw new Error(
            "Story exceeds 16 KB after removable content was dropped.",
        );
    }
    return value;
}

export function writeStory(message: string, story: GitCommitStory): string {
    const clean = message
        .replace(STORY_BLOCK_PATTERN, "")
        .replace(STORY_TRAILER_PATTERN, "")
        .replace(/\n{3,}/g, "\n\n")
        .trimEnd();
    return `${[clean, section(fit(story))].filter(Boolean).join("\n\n")}\n`;
}

export function readStory(message: string): GitCommitStory | undefined {
    const match = /~~~story v2\r?\n([^]*?)\r?\n~~~/.exec(message);
    if (!match) return undefined;
    const value = JSON.parse(match[1]) as GitCommitStory;
    if (
        value.version !== 2 ||
        !Array.isArray(value.sessions) ||
        !Array.isArray(value.humanOnly)
    ) {
        throw new Error("Commit story block has an invalid v2 payload.");
    }
    for (const session of value.sessions) session.uncommitted ??= [];
    return value;
}
