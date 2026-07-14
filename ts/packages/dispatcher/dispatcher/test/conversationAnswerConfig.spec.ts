// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Session } from "../src/context/session.js";
import { createChatHistory } from "../src/context/chatHistory.js";

// Covers the execution config added for the conversation-answer strategy and
// the configurable reasoning history window. Uses a dir-less Session so
// Session.save() is a no-op and nothing touches disk.
describe("execution.conversationAnswer / reasoningHistoryTurns config", () => {
    test("defaults to reasoning-first with a 10-turn history window", async () => {
        const session = await Session.create();
        const execution = session.getConfig().execution;
        expect(execution.conversationAnswer).toBe("reasoning-first");
        expect(execution.reasoningHistoryTurns).toBe(10);
    });

    test("updateConfig round-trips both settings", async () => {
        const session = await Session.create();
        session.updateConfig({
            execution: {
                conversationAnswer: "reasoning-only",
                reasoningHistoryTurns: 3,
            },
        });
        const execution = session.getConfig().execution;
        expect(execution.conversationAnswer).toBe("reasoning-only");
        expect(execution.reasoningHistoryTurns).toBe(3);
    });

    test("persisted settings merge over defaults; untouched fields keep defaults", async () => {
        const session = await Session.create({
            execution: { conversationAnswer: "lookup" },
        });
        const execution = session.getConfig().execution;
        expect(execution.conversationAnswer).toBe("lookup");
        // Not overridden — should still be the default.
        expect(execution.reasoningHistoryTurns).toBe(10);
    });

    test("recordUserMessages defaults to true", async () => {
        const session = await Session.create();
        expect(session.getConfig().execution.recordUserMessages).toBe(true);
    });
});

// getRecentEntries backs the reasoning agent's [Recent conversation context].
// It must surface assistant entries even when no user entry precedes them,
// which is the connected/agent-server case (user turns are not recorded).
describe("ChatHistory.getRecentEntries (reasoning context)", () => {
    test("includes an assistant entry with no preceding user entry (connected mode)", () => {
        const history = createChatHistory(true);
        history.addAssistantEntry("PR list: #2644, #2629", "github-cli", []);
        const recent = history.getRecentEntries(10);
        expect(recent).toHaveLength(1);
        expect(recent[0]).toMatchObject({
            role: "assistant",
            text: "PR list: #2644, #2629",
            source: "github-cli",
        });
        // export() drops the orphan assistant entry — the bug getRecentEntries
        // works around.
        expect(history.export()).toBeUndefined();
    });

    test("returns the last maxCount non-empty entries in chronological order", () => {
        const history = createChatHistory(true);
        history.addUserEntry("what prs are open?");
        history.addAssistantEntry("PR list", "github-cli", []);
        history.addUserEntry("are any of those mine?");
        const recent = history.getRecentEntries(2);
        expect(recent.map((e) => e.role)).toEqual(["assistant", "user"]);
        expect(recent[1].text).toBe("are any of those mine?");
    });

    test("returns [] when history is disabled", () => {
        const history = createChatHistory(false);
        history.addAssistantEntry("ignored", "x", []);
        expect(history.getRecentEntries(5)).toEqual([]);
    });
});

describe("ChatHistory.getEntries (paging for reasoning tools)", () => {
    test("pages entries by absolute index with role and source", () => {
        const history = createChatHistory(true);
        history.addUserEntry("q1");
        history.addAssistantEntry("a1", "github-cli", []);
        history.addUserEntry("q2");
        history.addAssistantEntry("a2", "player", []);
        expect(history.count()).toBe(4);
        expect(history.getEntries(1, 2)).toEqual([
            { index: 1, role: "assistant", text: "a1", source: "github-cli" },
            { index: 2, role: "user", text: "q2" },
        ]);
    });

    test("clamps offset/limit to the available range", () => {
        const history = createChatHistory(true);
        history.addAssistantEntry("only", "x", []);
        expect(history.getEntries(5, 10)).toEqual([]);
        expect(history.getEntries(0, 100)).toHaveLength(1);
    });
});
