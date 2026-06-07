// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readTestFile } from "test-lib";
import {
    parseClaudeSessionTranscript,
    parseCopilotSessionTranscript,
} from "../src/aiSessionImport.js";

describe("aiSessionImport.offline", () => {
    test("parseClaudeSessionTranscript (defaults)", () => {
        const text = readTestFile("./test/data/claudeSession.jsonl");
        const { messages, participants, title } =
            parseClaudeSessionTranscript(text);

        // 3 assistant + 2 user turns; the tool_result-only user turn and all
        // non-conversational events (queue-operation, ai-title) are skipped.
        expect(messages).toHaveLength(5);
        expect(participants).toEqual(new Set(["user", "Claude"]));

        // Title is extracted and attached as a topic on the first message.
        expect(title).toEqual("Build project");
        expect(messages[0].knowledge?.topics).toContain("Build project");

        // user turn (content as block array)
        const first = messages[0];
        expect(first.metadata.source).toEqual("user");
        expect(first.metadata.dest).toEqual(["Claude"]);
        expect(first.textChunks.join("")).toContain("Build the TypeAgent");
        expect(first.timestamp).toEqual("2026-05-04T02:51:05.001Z");
        expect(first.tags).toContain("claude-code");

        // assistant turn: reasoning ("thinking") excluded by default
        const second = messages[1];
        expect(second.metadata.source).toEqual("Claude");
        expect(second.metadata.dest).toEqual(["user"]);
        expect(second.textChunks.join("")).toEqual(
            "I'll run the build command from the ts directory.",
        );
        expect(second.textChunks.join("")).not.toContain(
            "The user wants to build",
        );
        expect(second.tags).toContain("claude-opus-4-6");

        // user turn where content is a plain string
        expect(messages[2].metadata.source).toEqual("user");
        expect(messages[2].textChunks.join("")).toContain(
            "Now run the unit tests",
        );

        // assistant turn with only a tool_use block: tool details excluded by
        // default, but a marker is kept and the tool name is tagged.
        const toolTurn = messages[3];
        expect(toolTurn.metadata.source).toEqual("Claude");
        expect(toolTurn.textChunks.join("")).toEqual("Invoked tool: Bash.");
        expect(toolTurn.tags).toContain("tool:Bash");
        expect(toolTurn.textChunks.join("")).not.toContain("pnpm test");

        expect(messages[4].textChunks.join("")).toContain("tests passed");
    });

    test("parseClaudeSessionTranscript (includeReasoning)", () => {
        const text = readTestFile("./test/data/claudeSession.jsonl");
        const { messages } = parseClaudeSessionTranscript(text, {
            includeReasoning: true,
        });
        const assistant = messages[1].textChunks.join("");
        expect(assistant).toContain("[reasoning]");
        expect(assistant).toContain("The user wants to build the project.");
        expect(assistant).toContain("run the build command");
    });

    test("parseClaudeSessionTranscript (includeToolCalls)", () => {
        const text = readTestFile("./test/data/claudeSession.jsonl");
        const { messages } = parseClaudeSessionTranscript(text, {
            includeToolCalls: true,
        });
        const toolTurn = messages[3].textChunks.join("");
        expect(toolTurn).toContain("[tool calls]");
        expect(toolTurn).toContain("Bash");
        expect(toolTurn).toContain('"command":"pnpm test"');
        // The tool name is still tagged.
        expect(messages[3].tags).toContain("tool:Bash");
    });

    test("parseCopilotSessionTranscript (defaults)", () => {
        const text = readTestFile("./test/data/copilotSession.jsonl");
        const { messages, participants, title } =
            parseCopilotSessionTranscript(text);

        // 2 user + 2 assistant messages; session.start, turn_start/end and
        // tool.execution_* events are skipped. Copilot has no session title.
        expect(messages).toHaveLength(4);
        expect(participants).toEqual(new Set(["user", "GitHub Copilot"]));
        expect(title).toBeUndefined();

        const first = messages[0];
        expect(first.metadata.source).toEqual("user");
        expect(first.metadata.dest).toEqual(["GitHub Copilot"]);
        expect(first.textChunks.join("")).toContain(
            "Explain the repository structure",
        );
        expect(first.timestamp).toEqual("2026-05-16T04:00:10.000Z");

        // assistant message with content + a tool request; reasoning excluded
        const second = messages[1];
        expect(second.metadata.source).toEqual("GitHub Copilot");
        expect(second.metadata.dest).toEqual(["user"]);
        expect(second.textChunks.join("")).toEqual(
            "Here is an overview of the workspace structure.",
        );
        expect(second.textChunks.join("")).not.toContain("search the codebase");
        expect(second.tags).toContain("tool:semantic_search");
        expect(second.tags).toContain("github-copilot");

        // assistant message with empty content but a tool request -> marker
        const toolTurn = messages[2];
        expect(toolTurn.metadata.source).toEqual("GitHub Copilot");
        expect(toolTurn.textChunks.join("")).toEqual(
            "Invoked tool: read_file.",
        );
        expect(toolTurn.tags).toContain("tool:read_file");

        expect(messages[3].metadata.source).toEqual("user");
        expect(messages[3].textChunks.join("")).toContain("that is helpful");
    });

    test("parseCopilotSessionTranscript (includeReasoning + includeToolCalls)", () => {
        const text = readTestFile("./test/data/copilotSession.jsonl");
        const { messages } = parseCopilotSessionTranscript(text, {
            includeReasoning: true,
            includeToolCalls: true,
        });
        const second = messages[1].textChunks.join("");
        expect(second).toContain("Let me search the codebase.");
        expect(second).toContain("Here is an overview");
        expect(second).toContain("[tool calls]");
        expect(second).toContain("semantic_search");

        // Empty-content tool turn now renders reasoning + tool call details.
        const third = messages[2].textChunks.join("");
        expect(third).toContain("Now read the package file.");
        expect(third).toContain("read_file");
    });

    test("malformed lines are skipped", () => {
        const jsonl = [
            '{"type":"user","message":{"role":"user","content":"hello"},"timestamp":"2026-01-01T00:00:00.000Z"}',
            "this is not json",
            "",
            '{"type":"assistant","message":{"role":"assistant","model":"claude-opus-4-6","content":[{"type":"text","text":"hi there"}]},"timestamp":"2026-01-01T00:00:01.000Z"}',
        ].join("\n");
        const { messages } = parseClaudeSessionTranscript(jsonl);
        expect(messages).toHaveLength(2);
        expect(messages[0].textChunks.join("")).toEqual("hello");
        expect(messages[1].textChunks.join("")).toEqual("hi there");
    });

    test("empty transcript yields no messages", () => {
        const claude = parseClaudeSessionTranscript("");
        expect(claude.messages).toHaveLength(0);
        const copilot = parseCopilotSessionTranscript("");
        expect(copilot.messages).toHaveLength(0);
    });
});
