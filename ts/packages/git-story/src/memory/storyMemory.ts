// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ConversationMessage,
    createConversationMemory,
} from "@typeagent/conversation-memory";
import { loadConfigSync } from "@typeagent/config";
import fs from "node:fs";
import path from "node:path";
import type {
    CommandRisk,
    GitCommitStory,
    SessionStory,
} from "../gitCommitStory.js";
import { resolveGitDirectory, runGit } from "../git.js";
import { readStory } from "../storyCodec.js";

const MEMORY_FILE = "commit-stories";
const INDEXED_COMMITS_FILE = "indexed-commits.json";

type StoryCommit = {
    sha: string;
    timestamp: string;
    subject: string;
    story: GitCommitStory;
};

// Add each commit once. The sidecar is written only after KnowPro saves it.
export async function syncStoryMemory(repository: string): Promise<{
    indexed: number;
    skipped: number;
}> {
    loadConfigSync();
    const directory = memoryDirectory(repository);
    fs.mkdirSync(directory, { recursive: true });
    const indexedPath = path.join(directory, INDEXED_COMMITS_FILE);
    const indexed = readIndexedCommits(indexedPath);
    const memory = await createConversationMemory(
        { dirPath: directory, baseFileName: MEMORY_FILE },
        false,
    );
    let added = 0;
    let skipped = 0;
    for (const commit of readStoryCommits(repository)) {
        if (indexed.has(commit.sha)) {
            skipped++;
            continue;
        }
        const result = await memory.addMessage(
            new ConversationMessage(
                renderCommit(commit),
                undefined,
                commitTags(commit),
                undefined,
                commit.timestamp,
            ),
            false,
        );
        if (!result.success) throw new Error(result.message);
        indexed.add(commit.sha);
        added++;
    }
    fs.writeFileSync(indexedPath, `${JSON.stringify([...indexed])}\n`);
    return { indexed: added, skipped };
}

export async function askStoryMemory(
    repository: string,
    question: string,
): Promise<string> {
    loadConfigSync();
    const directory = memoryDirectory(repository);
    if (!fs.existsSync(path.join(directory, `${MEMORY_FILE}_data.json`))) {
        throw new Error(
            "Story memory is empty. Run `git story memory sync` first.",
        );
    }
    const memory = await createConversationMemory(
        { dirPath: directory, baseFileName: MEMORY_FILE },
        false,
    );
    const searchResult = await memory.searchByTextSimilarity(question);
    if (!searchResult?.messageMatches?.length) return "No answer found.";
    const result = await memory.getAnswerFromSearchResults(
        searchResult,
        question,
    );
    if (!result.success) throw new Error(result.message);
    return result.data.type === "Answered"
        ? (result.data.answer ?? "No answer found.")
        : (result.data.whyNoAnswer ?? "No answer found.");
}

function memoryDirectory(repository: string): string {
    return path.join(resolveGitDirectory(repository), "story", "memory");
}

function readIndexedCommits(filePath: string): Set<string> {
    if (!fs.existsSync(filePath)) return new Set();
    return new Set(JSON.parse(fs.readFileSync(filePath, "utf8")) as string[]);
}

// NUL separators preserve multiline commit messages without escaping.
function readStoryCommits(repository: string): StoryCommit[] {
    const fields = runGit(repository, [
        "log",
        "-z",
        "--format=%H%x00%aI%x00%s%x00%B",
    ]).split("\0");
    const commits: StoryCommit[] = [];
    for (let index = 0; index + 3 < fields.length; index += 4) {
        const story = readStory(fields[index + 3]);
        if (!story) continue;
        commits.push({
            sha: fields[index],
            timestamp: fields[index + 1],
            subject: fields[index + 2],
            story,
        });
    }
    return commits.reverse();
}

function commitTags(commit: StoryCommit): string[] {
    return [
        `commit:${commit.sha}`,
        ...commit.story.sessions.map(({ session }) => `session:${session}`),
        ...new Set(
            commit.story.sessions.flatMap((session) =>
                session.commands.map(({ risk }) => `risk:${risk}`),
            ),
        ),
    ];
}

function renderCommit(commit: StoryCommit): string {
    return [
        `Commit ${commit.sha}: ${commit.subject}`,
        ...commit.story.sessions.map(renderSession),
        commit.story.humanOnly.length
            ? `Human-only files: ${commit.story.humanOnly.join(", ")}`
            : "",
    ]
        .filter(Boolean)
        .join("\n");
}

function renderSession(session: SessionStory): string {
    const lines = [
        `Session ${session.session}${session.model ? ` (${session.model})` : ""}: ${session.turns} turns`,
        ...session.snippets.map(
            ({ prompt, reply }) => `Prompt: ${prompt}\nReply: ${reply}`,
        ),
        ...session.files.map(
            ({ kind, path, attribution }) => `${kind} ${path} (${attribution})`,
        ),
        ...session.commands.map(
            ({ risk, command }) => `${riskLabel(risk)} command: ${command}`,
        ),
    ];
    return lines.join("\n");
}

function riskLabel(risk: CommandRisk): string {
    return `Risk ${risk}`;
}
