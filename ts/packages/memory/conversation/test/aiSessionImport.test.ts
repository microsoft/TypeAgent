// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describeIf, getAbsolutePath, hasTestKeys } from "test-lib";
import {
    importClaudeSession,
    importClaudeSessionsFromDir,
    importCopilotSession,
} from "../src/aiSessionImport.js";
import { ConversationMemory } from "../src/conversationMemory.js";
import { verifyConversationBasic } from "./verify.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function collectTags(memory: ConversationMemory) {
    const tags = new Set<string>();
    for (const message of memory.messages.getAll()) {
        for (const tag of message.tags) {
            if (typeof tag === "string") {
                tags.add(tag);
            }
        }
    }
    return tags;
}

describeIf(
    "aiSessionImport.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 5 * 60 * 1000;

        test(
            "importClaudeSession",
            async () => {
                const memory = await importClaudeSession(
                    getAbsolutePath("./test/data/claudeSession.jsonl"),
                    { name: "claudeTest" },
                );
                expect(memory.nameTag).toEqual("claudeTest");
                expect(memory.tags).toContain("claude-code");
                // The session title is captured as a conversation tag.
                expect(memory.tags).toContain("Build project");
                verifyConversationBasic(memory, 5);

                // "Claude" participates as an entity extracted from metadata.
                const entities = await memory.searchEntities("Claude");
                expect(entities).toBeDefined();
            },
            testTimeout,
        );

        test(
            "importCopilotSession",
            async () => {
                const memory = await importCopilotSession(
                    getAbsolutePath("./test/data/copilotSession.jsonl"),
                    { name: "copilotTest" },
                );
                expect(memory.nameTag).toEqual("copilotTest");
                expect(memory.tags).toContain("github-copilot");
                verifyConversationBasic(memory, 4);
            },
            testTimeout,
        );

        test(
            "importClaudeSession.noIndex",
            async () => {
                const memory = await importClaudeSession(
                    getAbsolutePath("./test/data/claudeSession.jsonl"),
                    { name: "claudeNoIndex", buildIndex: false },
                );
                expect(memory.messages.length).toEqual(5);
                expect(memory.semanticRefs.length).toEqual(0);
            },
            testTimeout,
        );

        test(
            "importClaudeSessionsFromDir (batch, no index)",
            async () => {
                const memory = await importClaudeSessionsFromDir(
                    getAbsolutePath("./test/data/claudeSessions"),
                    { name: "batch", buildIndex: false },
                );
                // Two files, two messages each.
                expect(memory.messages.length).toEqual(4);

                // Each message is tagged with its source session.
                const tags = collectTags(memory);
                expect(tags).toContain("session:sessionA");
                expect(tags).toContain("session:sessionB");

                // Per-session titles are captured as conversation tags.
                expect(memory.tags).toContain("Session A");
                expect(memory.tags).toContain("Session B");
            },
            testTimeout,
        );

        test(
            "importClaudeSessionsFromDir (recursive)",
            async () => {
                // Build a nested tree: one transcript at the root, one in a
                // subdirectory, from the existing flat fixtures.
                const root = fs.mkdtempSync(
                    path.join(os.tmpdir(), "aiSessions-"),
                );
                try {
                    fs.copyFileSync(
                        getAbsolutePath(
                            "./test/data/claudeSessions/sessionA.jsonl",
                        ),
                        path.join(root, "sessionA.jsonl"),
                    );
                    const subDir = path.join(root, "projB");
                    fs.mkdirSync(subDir);
                    fs.copyFileSync(
                        getAbsolutePath(
                            "./test/data/claudeSessions/sessionB.jsonl",
                        ),
                        path.join(subDir, "sessionB.jsonl"),
                    );

                    // Non-recursive only sees the root file.
                    const flat = await importClaudeSessionsFromDir(root, {
                        buildIndex: false,
                    });
                    expect(flat.messages.length).toEqual(2);

                    // Recursive picks up the nested file too.
                    const recursed = await importClaudeSessionsFromDir(root, {
                        buildIndex: false,
                        recurse: true,
                    });
                    expect(recursed.messages.length).toEqual(4);

                    // Nested transcripts are tagged with their relative path.
                    const tags = collectTags(recursed);
                    expect(tags).toContain("session:sessionA");
                    expect(tags).toContain("session:projB/sessionB");
                } finally {
                    fs.rmSync(root, { recursive: true, force: true });
                }
            },
            testTimeout,
        );
    },
);
