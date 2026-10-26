// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { replaceFirstLineBreak } from "./line-break-fixture.mjs";
import {
    gradeDocumentTrial,
    nativeSelectedSourceContract,
    syntheticDocumentRenderingContract,
    syntheticDocumentFenceRenderingContract,
    syntheticDocumentBlockquoteRenderingContract,
    syntheticDocumentSimilarityContract,
    validateSyntheticRenderingContract,
    validateSyntheticDocumentScoringContract,
} from "../macro-eval-grade.mjs";
import {
    createTrustedNormalHookReader,
    isTrustedNormalHookCallback,
} from "../macro-eval-native-callback.mjs";
import { macroProtocolVersion } from "../macro-eval-plan.mjs";
import { programFixture } from "./program-fixture.mjs";

const document = {
    key: "vega",
    title: "Vega deployment checklist",
    expectedId: "synthetic-doc-vega",
    content:
        "Vega deployment checklist\nVEGA-DEPLOY-23\nOwner: Test Team Vega\nGate: rollback instructions reviewed\nVEGA-CHECK-58",
};
const timestamp = "2026-10-12T00:00:00.000Z";
const renderingContract = {
    protocolVersion: "synthetic-document-rendering-v2",
    fixtureShape: "synthetic-prose-lines-v1",
};
const observedRenderedAnswer =
    "# Vega deployment checklist\n\nVEGA-DEPLOY-23  \nOwner: Test Team Vega  \nGate: rollback instructions reviewed  \nVEGA-CHECK-58";
const fenceRenderingContract = {
    protocolVersion: "synthetic-document-rendering-v3",
    fixtureShape: "synthetic-prose-lines-v1",
};
const observedFencedAnswer =
    "# Vega deployment checklist\n\n```text\n" + document.content + "\n```";
const blockquoteRenderingContract = {
    protocolVersion: "synthetic-document-rendering-v4",
    fixtureShape: "synthetic-prose-lines-v1",
};
const observedBlockquoteAnswer =
    "# Vega deployment checklist\n\n" +
    document.content
        .split("\n")
        .map((line) => "> " + line)
        .join("\n");

function similarityContract(documents = [document]) {
    return {
        protocolVersion: "synthetic-document-similarity-v5",
        fixtureShape: "synthetic-prose-lines-v1",
        fixtureId: "macro-eval-synthetic-prose-fixture-v1",
        algorithm: "ordered-levenshtein-codepoints-v1",
        threshold: 0.9,
        protectedDocuments: documents.map((entry) => ({
            key: entry.key,
            title: entry.title,
            expectedId: entry.expectedId,
            contentSha256: createHash("sha256")
                .update(entry.content)
                .digest("hex"),
            markers: [
                entry.content.split("\n")[1],
                entry.content.split("\n").at(-1),
            ],
        })),
    };
}

function similarityTrial(answer, documents = [document]) {
    const value = renderingTrial(answer);
    value.documents = documents;
    bindProgramOutput(value, documents[0]);
    value.scenario.expectedDocument = documents[0].key;
    value.backendAudit[0].title = documents[0].title;
    value.backendAudit[0].returnedId = documents[0].expectedId;
    value.backendAudit[1].id = documents[0].expectedId;
    value.renderingContract = similarityContract(documents);
    return value;
}

function bindProgramOutput(value, source) {
    const evidence = value.programEvidence;
    evidence.response.run.program.output = source.content;
    evidence.reconciledRun = structuredClone(evidence.response.run);
    value.events.find(
        (event) => event.id === evidence.eventId,
    ).data.output.responseContent = JSON.stringify(evidence.response);
}

function renderingTrial(answer, optIn = true) {
    const value = nativeModelTrial();
    value.answer = answer;
    value.events[0].data.content = answer;
    if (optIn) value.renderingContract = { ...renderingContract };
    return value;
}

test("future rendering-v2 requires explicit versioned opt-in; default and serialized historical inputs keep verbatim semantics", () => {
    assert.equal(
        syntheticDocumentRenderingContract,
        renderingContract.protocolVersion,
    );
    assert.equal(
        validateSyntheticRenderingContract(renderingContract),
        renderingContract,
    );
    const legacy = renderingTrial(observedRenderedAnswer, false);
    assert.equal(gradeDocumentTrial(legacy).status, "failed");
    assert.equal(
        gradeDocumentTrial(JSON.parse(JSON.stringify(legacy))).status,
        "failed",
    );
    const future = renderingTrial(observedRenderedAnswer);
    assert.equal(gradeDocumentTrial(future).status, "passed");
    assert.equal(
        gradeDocumentTrial(JSON.parse(JSON.stringify(future))).status,
        "passed",
    );
    assert.equal(gradeDocumentTrial(legacy).status, "failed");
    assert.equal(
        gradeDocumentTrial(renderingTrial(document.content, false)).status,
        "passed",
    );
});

test("future rendering-v2 permits only title headings, empty separators and ASCII hardbreaks while retaining exact ordered prose", () => {
    for (const level of [0, 1, 2, 3, 4, 5, 6]) {
        for (const blanks of [0, 1, 3]) {
            for (const spaces of [0, 2, 3, 8]) {
                const lines = document.content
                    .split("\n")
                    .map((line) => line + " ".repeat(spaces));
                if (level) lines[0] = "#".repeat(level) + " " + lines[0];
                const answer =
                    "Here is the requested document:\n\n" +
                    lines.join("\n".repeat(blanks + 1)) +
                    "\n\nEnd of document.";
                const result = gradeDocumentTrial(renderingTrial(answer));
                assert.equal(
                    result.status,
                    "passed",
                    `${level}/${blanks}/${spaces}: ${JSON.stringify(result)}`,
                );
                assert.equal(result.taskCorrect, true);
                assert.equal(result.grammarHit, true);
            }
        }
    }
});

test("future rendering-v2 fails losses, substitutions, reordered or extra internal text and unsupported Markdown transformations", () => {
    const lines = document.content.split("\n");
    const bad = [
        lines.slice(0, -1).join("\n"),
        lines.slice(1).join("\n"),
        [...lines.slice(0, 2), ...lines.slice(3)].join("\n"),
        [lines[0], lines[2], lines[1], ...lines.slice(3)].join("\n"),
        [
            lines[0],
            lines[1],
            "Additional internal text",
            ...lines.slice(2),
        ].join("\n"),
        [lines[0], lines[1], lines[1], ...lines.slice(2)].join("\n"),
        document.content.replace("rollback", "roll-back"),
        document.content.replace("Vega", "vega"),
        document.content.replace("Owner:", "Owner"),
        document.content.replace("VEGA-CHECK-58", "VEGA-CHECK-59"),
        document.content.replace("Test Team", "TestTeam"),
        document.content.replace("Test Team", "Test  Team"),
        document.content.replace("Test Team", "Test\u00a0Team"),
        document.content.replace("\nOwner:", " Owner:"),
        document.content.replace("\nOwner:", "\n Owner:"),
        document.content.replace("\nOwner:", "\n\tOwner:"),
        document.content.replace("\nOwner:", " \nOwner:"),
        document.content.replace("\nOwner:", "\t\nOwner:"),
        document.content.replace("\nOwner:", "  \t\nOwner:"),
        document.content.replace("\nOwner:", " \n\nOwner:"),
        document.content.replace("\nOwner:", "\n \nOwner:"),
        document.content.replace("\nOwner:", "\n\t\nOwner:"),
        replaceFirstLineBreak(document.content, "\r\n"),
        document.content.replace(
            "Owner: Test Team Vega",
            "**Owner: Test Team Vega**",
        ),
        document.content.replace(
            "Owner: Test Team Vega",
            "`Owner: Test Team Vega`",
        ),
        document.content.replace("\nOwner:", "\n# Owner:"),
        document.content.replace(
            "Vega deployment checklist",
            "# Orion release readiness checklist",
        ),
        document.content.replace(
            "Vega deployment checklist",
            "# Vega deployment checklist (different document)",
        ),
        "####### " + document.content,
        "##  " + document.content,
        "##\t" + document.content,
        "# " + replaceFirstLineBreak(document.content, " #\n"),
        replaceFirstLineBreak(document.content, "\n---\n"),
        lines.map((line) => "> " + line).join("\n"),
        lines.map((line) => "- " + line).join("\n"),
        lines.map((line) => "    " + line).join("\n"),
        lines.map((line) => "| " + line + " |").join("\n"),
        "```text\n" + document.content + "\n```",
        "~~~text\n" + document.content + "\n~~~",
        "   ````text\n" + document.content + "\n   ````",
        "<pre>\n" + document.content + "\n</pre>",
        "<code>\n" + document.content + "\n</code>",
        "<table>\n" + document.content + "\n</table>",
        "# Wrong title\n" + lines.slice(1).join("\n"),
        "# " + lines[0] + "\nnot the contents",
    ];
    for (const answer of bad) {
        const result = gradeDocumentTrial(renderingTrial(answer));
        assert.equal(
            result.status,
            "failed",
            JSON.stringify({ answer, result }),
        );
    }
});

test("future rendering-v2 requires a complete line-bounded contiguous region outside code fences", () => {
    for (const answer of [
        "Prefix inside title: " + observedRenderedAnswer,
        observedRenderedAnswer + " unexpected suffix",
        "```text\n" + observedRenderedAnswer,
        "```text\n" + observedRenderedAnswer + "\n~~~",
        "````text\n" + observedRenderedAnswer + "\n```",
    ]) {
        assert.equal(
            gradeDocumentTrial(renderingTrial(answer)).status,
            "failed",
            answer,
        );
    }
    assert.equal(
        gradeDocumentTrial(
            renderingTrial(
                "```text\nUnrelated example\n```\n\n" + observedRenderedAnswer,
            ),
        ).status,
        "passed",
    );
});

test("rendering opt-in rejects malformed, inferred, loose or unknown contract values rather than falling back", () => {
    for (const value of [
        null,
        true,
        false,
        "synthetic-document-rendering-v2",
        {},
        { protocolVersion: "synthetic-document-rendering-v2" },
        {
            ...renderingContract,
            protocolVersion: "synthetic-document-rendering-v6",
        },
        { ...renderingContract, fixtureShape: "all-markdown" },
        { ...renderingContract, allowMarkdown: true },
        { ...renderingContract, historicalRegrade: true },
        { ...renderingContract, sourceBytesMayChange: true },
        { ...renderingContract, fixtureShape: undefined },
    ]) {
        assert.throws(
            () => validateSyntheticRenderingContract(value),
            /Invalid synthetic rendering contract/,
        );
        const trial = renderingTrial(document.content);
        trial.renderingContract = value;
        const result = gradeDocumentTrial(trial);
        assert.equal(result.status, "harness-invalid");
        assert.equal(result.taskCorrect, null);
    }
});

test("rendering-v2 explicitly blocks raw whitespace, code/table/Markdown and non-synthetic fixture shapes even for verbatim output", () => {
    const variants = [
        { content: document.content + "\n" },
        { content: document.content.replace("\nOwner", "\n\nOwner") },
        { content: document.content.replace("\nOwner", "\n    Owner") },
        { content: document.content.replace("\nOwner", "\n\tOwner") },
        { content: document.content.replace("Owner:", "Owner: ") + " " },
        { content: document.content.replace("\nOwner", "  \nOwner") },
        { content: document.content.replace("Owner:", "`Owner:`") },
        { content: document.content.replace("Owner:", "| Owner: |") },
        { content: "# " + document.content },
        { content: document.content.replace("Owner:", "**Owner:**") },
        { content: replaceFirstLineBreak(document.content, "\n```text\n") },
        { content: replaceFirstLineBreak(document.content, "\r\n") },
        { expectedId: "original-file-doc-vega" },
        { expectedId: "workiq-document-vega" },
        { title: "Different title" },
    ];
    for (const fields of variants) {
        const changed = { ...document, ...fields };
        const value = renderingTrial(changed.content);
        value.documents = [changed];
        const result = gradeDocumentTrial(value);
        assert.equal(result.status, "blocked", JSON.stringify(fields));
        assert.equal(result.taskCorrect, null);
        assert.equal(result.grammarHit, null);
        assert.match(result.errors.join(" "), /Unsupported synthetic-prose/);
        const legacy = { ...value };
        delete legacy.renderingContract;
        assert.ok(
            gradeDocumentTrial(legacy).checks.some(
                (check) => check.name === "full-exact-document-content",
            ),
        );
    }
});

test("rendering-v2 preserves meaningful interior spaces and does not excuse identity, audit, terminal or effect failures", () => {
    const spaced = {
        ...document,
        content: document.content.replace("Test Team", "Test  Team"),
    };
    const value = renderingTrial(spaced.content);
    value.documents = [spaced];
    bindProgramOutput(value, spaced);
    assert.equal(gradeDocumentTrial(value).status, "passed");
    value.answer = document.content;
    value.events[0].data.content = value.answer;
    assert.equal(gradeDocumentTrial(value).status, "failed");
    const mutations = [
        (v) => {
            v.backendAudit[0].returnedId = "captured-doc";
        },
        (v) => {
            v.backendAudit[1].id = "captured-doc";
        },
        (v) => {
            v.backendAudit[0].title = "Wrong title";
        },
        (v) => {
            v.backendAudit = undefined;
        },
        (v) => {
            v.events.pop();
        },
        (v) => {
            v.events[0].data.content = "model-only mismatch";
        },
        (v) => {
            v.executionEvidence.effects = ["write-file"];
        },
        (v) => {
            v.executionEvidence.wholeMacroInvocations = 0;
        },
    ];
    for (const mutate of mutations) {
        const current = renderingTrial(observedRenderedAnswer);
        mutate(current);
        assert.notEqual(gradeDocumentTrial(current).status, "passed");
    }
});

function trial() {
    const program = programFixture(document, timestamp);
    return {
        protocolVersion: macroProtocolVersion,
        scenario: {
            id: "positive",
            kind: "positive",
            familyId: "exact-document-lookup-fetch",
            expectedDocument: "vega",
        },
        documents: [document],
        events: [
            {
                id: "root-answer",
                parentId: program.event.id,
                type: "assistant.message",
                data: { content: document.content },
            },
            { type: "session.idle", data: {} },
            program.event,
        ],
        backendAudit: [
            {
                timestamp,
                operation: "lookup_document",
                title: document.title,
                returnedId: document.expectedId,
            },
            { timestamp, operation: "fetch_document", id: document.expectedId },
        ],
        answer: document.content,
        routeEvidence: {
            route: "grammar",
            macroId: program.run.macroId,
            version: program.run.version,
            runId: program.run.runId,
        },
        executionEvidence: { wholeMacroInvocations: 1, effects: [] },
        programEvidence: program.evidence,
    };
}
function negativeTrial() {
    const value = trial();
    value.scenario = {
        id: "negative",
        kind: "negative",
        familyId: "exact-document-lookup-fetch",
        wholeMacroInvocations: 0,
        forbiddenEffects: ["send-mail", "rename-document"],
    };
    value.routeEvidence = { route: "miss" };
    value.executionEvidence.wholeMacroInvocations = 0;
    return value;
}

function nativeModelTrial() {
    const value = trial();
    value.events = [
        {
            id: "root-answer",
            parentId: value.programEvidence.eventId,
            type: "assistant.message",
            data: { content: document.content, turnId: "2", toolRequests: [] },
        },
        {
            id: "root-turn-end",
            parentId: "root-answer",
            type: "assistant.turn_end",
            data: { turnId: "2" },
        },
        value.events.at(-1),
    ];
    return value;
}

function nativeHostTrial() {
    const value = trial();
    const toolCallId = "typeagent-macro-owned";
    const agentId = "native-child";
    const agentName = "typeagent:typeagent-macro-runner-host";
    const child = { agentId };
    const report = {
        kind: "typeagent-macro-phases",
        elapsedMs: 100,
        catalogValidation: { macroId: "approved-macro", version: 2 },
        phases: [
            { phase: "host.dispatch", elapsedMs: 0 },
            { phase: "host.catalog-validated", elapsedMs: 1 },
            { phase: "subagent.started", elapsedMs: 2 },
            { phase: "procedure-tool.started", elapsedMs: 5 },
            { phase: "procedure-tool.completed", elapsedMs: 7 },
            { phase: "runner.turn.completed", elapsedMs: 8 },
            { phase: "subagent.completed", elapsedMs: 9 },
        ],
    };
    value.routeEvidence = {
        route: "grammar",
        macroId: "approved-macro",
        version: 2,
    };
    value.events = [
        {
            ...child,
            id: "child-start",
            parentId: "host-hook",
            type: "subagent.started",
            data: { toolCallId, agentName },
        },
        {
            ...child,
            id: "child-user",
            parentId: "child-start",
            type: "user.message",
            data: { content: "Execute the validated macro.", turnId: "2" },
        },
        {
            ...child,
            id: "child-answer",
            parentId: "child-user",
            type: "assistant.message",
            data: {
                parentToolCallId: toolCallId,
                turnId: "2",
                content: document.content,
                toolRequests: [],
            },
        },
        {
            ...child,
            id: "child-turn-end",
            parentId: "child-answer",
            type: "assistant.turn_end",
            data: { parentToolCallId: toolCallId, turnId: "2" },
        },
        {
            ...child,
            id: "child-complete",
            parentId: "child-turn-end",
            type: "subagent.completed",
            data: { toolCallId, agentName },
        },
        {
            id: "host-phases",
            parentId: "child-complete",
            type: "session.info",
            data: { infoType: "notification", message: JSON.stringify(report) },
        },
        {
            id: "host-hook-end",
            parentId: "host-phases",
            type: "hook.end",
            data: {},
        },
        {
            id: "root-user",
            parentId: "host-hook-end",
            type: "user.message",
            data: {
                content: "Read Vega deployment checklist for me",
                interactionId: "interaction",
                messageId: "user-message",
            },
        },
        {
            id: "root-answer",
            parentId: "root-user",
            type: "assistant.message",
            data: {
                content: document.content,
                interactionId: "interaction",
                originatingMessageId: "user-message",
                toolRequests: [],
            },
        },
    ];
    return value;
}

function ordinaryCandidate(
    policy = "bypass-baseline",
    clock = Date.parse(timestamp),
) {
    const value = trial();
    const prompt =
        "Find the document titled 'Vega deployment checklist' and show its contents.";
    value.scenario.prompt = prompt;
    value.executionEvidence.wholeMacroInvocations = 0;
    const at = (milliseconds) => new Date(clock + milliseconds).toISOString();
    const digest = (entry) =>
        createHash("sha256").update(JSON.stringify(entry)).digest("hex");
    const expected = {
        owner: "unit-owned-run",
        ownedRoot: "D:\\unit\\owned",
        sessionId: "unit-native-session",
        prompt,
        promptHash: createHash("sha256").update(prompt).digest("hex"),
        cwd: "D:\\unit\\owned\\workspace",
        configPath: "D:\\unit\\owned\\plugin-data\\config.json",
        dataRoot: "D:\\unit\\owned\\data",
        effectiveMode: policy === "bypass-baseline" ? "bypass" : "mcp",
        routing: policy === "bypass-baseline" ? "delegate" : "mixed",
        startedAt: at(0),
        endedAt: at(2000),
    };
    expected.digest = digest({
        configPath: expected.configPath,
        dataRoot: expected.dataRoot,
        effectiveMode: expected.effectiveMode,
        mcpRouting: expected.routing,
    });
    const input = {
        sessionId: expected.sessionId,
        prompt,
        timestamp: Date.parse(at(100)),
        cwd: expected.cwd,
    };
    const control = {
        effectiveMode: expected.effectiveMode,
        configPath: expected.configPath,
        dataRoot: expected.dataRoot,
        digest: expected.digest,
        source: {
            component: "native-hook",
            pid: 200,
            parentPid: 100,
            executable: "D:\\unit\\node.exe",
            cwd: path.win32.join(expected.ownedRoot, "plugin"),
            owner: expected.owner,
            instance: "unit-instance",
            server: "ws://127.0.0.1:12345",
            observedAt: at(150),
            config: "CLAUDE_PLUGIN_DATA",
            mode: "config",
            routing: expected.routing,
            expectedConfigPath: expected.configPath,
            expectedMode: expected.effectiveMode,
            readableOwnedConfig: true,
            request: {
                sessionId: input.sessionId,
                timestamp: input.timestamp,
                cwd: input.cwd,
            },
        },
    };
    const token = {
        id: "unit-selected-lease",
        sessionId: expected.sessionId,
        status: "armed",
        expiresAt: at(10000),
        cwd: expected.cwd,
        learning: true,
    };
    value.routeEvidence = {
        route: "ordinary-copilot",
        receipt: {
            schemaVersion: 1,
            origin: "trusted-native-controller",
            policy,
            expected,
            hook: {
                hookInvocationId: "unit-hook-invocation",
                startEventId: "hook-start",
                endEventId: "hook-end",
            },
            control,
            callback: null,
            capture:
                policy === "bypass-baseline"
                    ? { policy: "none" }
                    : {
                          policy: "selected-source",
                          before: {
                              observedAt: at(50),
                              state: { status: "armed", token },
                          },
                          after: {
                              observedAt: at(250),
                              state: {
                                  status: "claimed",
                                  token: {
                                      ...token,
                                      status: "claimed",
                                      promptHash: expected.promptHash,
                                  },
                              },
                          },
                      },
        },
    };
    value.events = [
        {
            id: "session-start",
            parentId: null,
            timestamp: at(0),
            type: "session.start",
            data: {
                sessionId: expected.sessionId,
                context: { cwd: expected.cwd },
            },
        },
        {
            id: "hook-start",
            parentId: "session-start",
            timestamp: at(100),
            type: "hook.start",
            data: {
                hookType: "userPromptSubmitted",
                hookInvocationId: "unit-hook-invocation",
                input,
            },
        },
        {
            id: "hook-end",
            parentId: "hook-start",
            timestamp: at(200),
            type: "hook.end",
            data: {
                hookType: "userPromptSubmitted",
                hookInvocationId: "unit-hook-invocation",
                success: true,
                output: {},
            },
        },
        {
            id: "root-user",
            parentId: "hook-end",
            timestamp: at(300),
            type: "user.message",
            data: {
                content: prompt,
                messageId: "root-user-message",
                interactionId: "unit-interaction",
            },
        },
        {
            id: "lookup-start",
            parentId: "root-user",
            timestamp: at(400),
            type: "tool.execution_start",
            data: {
                toolCallId: "unit-lookup",
                toolName: "eval-docs-lookup_document",
                mcpServerName: "eval-docs",
                arguments: { title: document.title },
            },
        },
        {
            id: "lookup-complete",
            parentId: "lookup-start",
            timestamp: at(500),
            type: "tool.execution_complete",
            data: { toolCallId: "unit-lookup", success: true },
        },
        {
            id: "fetch-start",
            parentId: "lookup-complete",
            timestamp: at(600),
            type: "tool.execution_start",
            data: {
                toolCallId: "unit-fetch",
                toolName: "eval-docs-fetch_document",
                mcpServerName: "eval-docs",
                arguments: { id: document.expectedId },
            },
        },
        {
            id: "fetch-complete",
            parentId: "fetch-start",
            timestamp: at(700),
            type: "tool.execution_complete",
            data: { toolCallId: "unit-fetch", success: true },
        },
        {
            id: "root-answer",
            parentId: "fetch-complete",
            timestamp: at(800),
            type: "assistant.message",
            data: {
                content: document.content,
                turnId: 0,
                interactionId: "unit-interaction",
                toolRequests: [],
            },
        },
        {
            id: "root-turn-end",
            parentId: "root-answer",
            timestamp: at(900),
            type: "assistant.turn_end",
            data: { turnId: 0 },
        },
    ];
    value.backendAudit[0].timestamp = at(450);
    value.backendAudit[1].timestamp = at(650);
    return value;
}

function event(value, id) {
    return value.events.find((entry) => entry.id === id);
}

function withBrandedOrdinary(
    policy,
    run,
    { launchPolicy = true, beforeRead, clock = Date.parse(timestamp) } = {},
) {
    // Generated reader/OS fixtures exercise the contract, not live callback acceptance.
    const root = fs.mkdtempSync(
        path.join(
            path.dirname(fileURLToPath(import.meta.url)),
            ".grade-callback-",
        ),
    );
    try {
        const value = ordinaryCandidate(policy, clock);
        const receipt = value.routeEvidence.receipt;
        const { expected, control } = receipt;
        const at = (offset) => clock + offset;
        const hash = (data) => createHash("sha256").update(data).digest("hex");
        const hashFile = (file) => ({
            file,
            sha256: hash(fs.readFileSync(file)),
        });
        Object.assign(expected, {
            ownedRoot: root,
            cwd: path.join(root, "workspace"),
            configPath: path.join(root, "plugin-data", "config.json"),
            dataRoot: path.join(root, "data"),
            promptHash: hash("independent product-redacted unit prompt"),
        });
        expected.digest = hash(
            JSON.stringify({
                configPath: expected.configPath,
                dataRoot: expected.dataRoot,
                effectiveMode: expected.effectiveMode,
                mcpRouting: expected.routing,
            }),
        );
        Object.assign(control, {
            configPath: expected.configPath,
            dataRoot: expected.dataRoot,
            digest: expected.digest,
        });
        Object.assign(control.source, {
            pid: 201,
            parentPid: 200,
            executable: process.execPath,
            cwd: path.join(root, "plugin"),
            expectedConfigPath: expected.configPath,
        });
        control.source.request.cwd = expected.cwd;
        event(value, "session-start").data.context.cwd = expected.cwd;
        event(value, "hook-start").data.input.cwd = expected.cwd;
        if (receipt.capture.policy === "selected-source") {
            receipt.capture.before.state.token.cwd = expected.cwd;
            receipt.capture.after.state.token.cwd = expected.cwd;
            receipt.capture.after.state.token.promptHash = expected.promptHash;
        }
        const wrapper = path.join(root, "plugin", "macro-eval-native-hook.mjs");
        const router = path.join(
            root,
            "plugin",
            "dist",
            "hooks",
            "hook-router.js",
        );
        const directory = path.join(root, "normal-hook");
        fs.mkdirSync(path.dirname(router), { recursive: true });
        fs.mkdirSync(directory);
        fs.writeFileSync(wrapper, "Generated unit wrapper, not a live hook");
        fs.writeFileSync(router, "Generated unit router, not a live hook");
        const actor = (ProcessId, ParentProcessId, offset, file) => ({
            ProcessId,
            ParentProcessId,
            StartedMs: at(offset),
            ExecutablePath: process.execPath,
            ...(file ? { Arguments: [process.execPath, file] } : {}),
        });
        const cli = {
            ...actor(100, 50, 0),
            sha256: hashFile(process.execPath).sha256,
        };
        const peer = actor(200, 100, 110, wrapper);
        const server = actor(300, 50, 0);
        const input = event(value, "hook-start").data.input;
        const binding = {
            owner: expected.owner,
            ownedRoot: root,
            pipe: "typeagent-native-11111111-1111-1111-1111-111111111111",
            cli,
            server,
            node: { executable: process.execPath, sha256: cli.sha256 },
            wrapper: hashFile(wrapper),
            router: hashFile(router),
            serverSource: hashFile(
                fileURLToPath(
                    new URL("../macro-eval-native-pipe.ps1", import.meta.url),
                ),
            ),
            mode: expected.effectiveMode,
            configDigest: expected.digest,
        };
        if (launchPolicy) {
            const file = path.join(
                root,
                "plugin",
                "native-normal-hook-config.json",
            );
            fs.writeFileSync(
                file,
                JSON.stringify({
                    protocol: "native-normal-hook-owned-launch-v1",
                    owner: expected.owner,
                    pipe: binding.pipe,
                    deadlineMs: at(2000),
                }),
            );
            binding.policy = hashFile(file);
        }
        const physical = {
            protocol: "native-hook-os-association-v1",
            osApi: "GetNamedPipeClientProcessId/SafePipeHandle",
            serverPid: server.ProcessId,
            pipe: binding.pipe,
            observedAtMs: at(140),
            peer,
            peerAfter: { ...peer },
            ancestry: [peer, cli],
            children: [actor(201, 200, 120, router)],
            packet: {
                protocol: "native-hook-stdin-v1",
                stdin: JSON.stringify(input),
            },
        };
        fs.writeFileSync(
            path.join(directory, "receipt-0000.json"),
            JSON.stringify(physical),
        );
        beforeRead?.(binding, value);
        receipt.callback = createTrustedNormalHookReader({
            directory,
            binding,
            probe: (pid) => (pid === server.ProcessId ? server : cli),
        }).read(
            {
                sessionId: expected.sessionId,
                prompt: expected.prompt,
                cwd: expected.cwd,
                submittedAtMs: at(0),
                deadlineMs: at(2000),
                mode: expected.effectiveMode,
                configDigest: expected.digest,
            },
            value.events,
        );
        return run(value);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function withFinalizedSource(
    run,
    { answer, renderingContract: contract } = {},
) {
    const clock = Date.now() - 5000;
    return withBrandedOrdinary(
        "mcp-mixed-source-capture",
        (value) => {
            const receipt = value.routeEvidence.receipt;
            receipt.expected.endedAt = new Date(clock + 15000).toISOString();
            const traceId = randomUUID();
            const storeRoot = path.join(
                path.dirname(receipt.expected.configPath),
                "recipes",
                createHash("sha256")
                    .update(
                        JSON.stringify({
                            workspaceId:
                                process.platform === "win32"
                                    ? path
                                          .resolve(receipt.expected.cwd)
                                          .toLowerCase()
                                    : path.resolve(receipt.expected.cwd),
                            profileId: "local-default",
                        }),
                    )
                    .digest("hex"),
            );
            const file = path.join(storeRoot, "traces", `${traceId}.json`);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const trace = {
                schemaVersion: 1,
                traceId,
                createdAt: new Date().toISOString(),
                sessionId: receipt.expected.sessionId,
                cwd: receipt.expected.cwd,
                prompt: receipt.expected.prompt,
                response: "I will look up the document." + value.answer,
                startedAt: event(value, "root-user").timestamp,
                completedAt: event(value, "root-answer").timestamp,
                toolCalls: ["lookup", "fetch"].map((operation) => {
                    const start = event(value, `${operation}-start`);
                    const result = event(value, `${operation}-complete`).data
                        .result;
                    return {
                        toolCallId: start.data.toolCallId,
                        name: start.data.toolName,
                        mcpServerName: start.data.mcpServerName,
                        arguments: structuredClone(start.data.arguments),
                        result: structuredClone(result),
                        modelResult: JSON.parse(result.content),
                        status: "completed",
                    };
                }),
            };
            const source = {
                observedAt: new Date().toISOString(),
                state: {
                    status: "completed",
                    trace: {
                        traceId,
                        sessionId: trace.sessionId,
                        createdAt: trace.createdAt,
                        toolCallCount: trace.toolCalls.length,
                    },
                },
                trace,
                storeRoot,
                file: { path: file, sha256: "" },
            };
            const write = () => {
                const bytes = Buffer.from(JSON.stringify(source.trace));
                fs.writeFileSync(file, bytes);
                source.file.sha256 = createHash("sha256")
                    .update(fs.readFileSync(file))
                    .digest("hex");
                source.observedAt = new Date().toISOString();
            };
            write();
            const selectedTarget = {
                sessionId: receipt.expected.sessionId,
                tokenId: receipt.capture.after.state.token.id,
            };
            value.readFinalizedSource = (target) => {
                assert.deepEqual(target, selectedTarget);
                return source;
            };
            return run(value, source, write);
        },
        {
            clock,
            beforeRead: (_binding, value) => {
                if (answer !== undefined) {
                    value.answer = answer;
                    event(value, "root-answer").data.content = answer;
                }
                if (contract !== undefined) value.renderingContract = contract;
                const receipt = value.routeEvidence.receipt;
                receipt.expected.promptHash = createHash("sha256")
                    .update(receipt.expected.prompt)
                    .digest("hex");
                receipt.capture.after.state.token.promptHash =
                    receipt.expected.promptHash;
                receipt.control.source.instance = `macro-eval-${receipt.expected.owner.slice(0, 8)}`;
                receipt.capture.after.observedAt = new Date(
                    clock + 175,
                ).toISOString();
                event(value, "lookup-complete").data.result = {
                    content: JSON.stringify({
                        id: document.expectedId,
                        title: document.title,
                    }),
                };
                event(value, "fetch-complete").data.result = {
                    content: JSON.stringify({
                        id: document.expectedId,
                        title: document.title,
                        content: document.content,
                    }),
                };
                value.events.splice(
                    value.events.indexOf(event(value, "lookup-start")),
                    0,
                    {
                        id: "root-planning",
                        parentId: "root-user",
                        type: "assistant.message",
                        timestamp: new Date(clock + 350).toISOString(),
                        data: {
                            content: "I will look up the document.",
                            turnId: 0,
                            interactionId: "unit-interaction",
                            toolRequests: [{ toolCallId: "unit-lookup" }],
                        },
                    },
                );
                event(value, "lookup-start").parentId = "root-planning";
                delete event(value, "hook-end").data.output;
            },
        },
    );
}

test("future v3 exact fence is explicit, v2 remains rejecting, and frozen legacy substring semantics are not rewritten", () => {
    assert.equal(
        syntheticDocumentFenceRenderingContract,
        fenceRenderingContract.protocolVersion,
    );
    assert.equal(
        syntheticDocumentRenderingContract,
        renderingContract.protocolVersion,
    );
    assert.equal(
        validateSyntheticRenderingContract(fenceRenderingContract),
        fenceRenderingContract,
    );
    const legacy = renderingTrial(observedFencedAnswer, false);
    // Legacy v1 intentionally checks a raw substring, even when enclosed in a fence.
    assert.equal(gradeDocumentTrial(legacy).status, "passed");
    assert.equal(
        gradeDocumentTrial(JSON.parse(JSON.stringify(legacy))).status,
        "passed",
    );
    const v2 = renderingTrial(observedFencedAnswer);
    assert.equal(gradeDocumentTrial(v2).status, "failed");
    const v3 = { ...v2, renderingContract: { ...fenceRenderingContract } };
    assert.equal(gradeDocumentTrial(v3).status, "passed");
    assert.equal(
        gradeDocumentTrial(JSON.parse(JSON.stringify(v3))).status,
        "passed",
    );
    assert.equal(gradeDocumentTrial(v2).status, "failed");
    assert.equal(gradeDocumentTrial(legacy).status, "passed");
    assert.equal(
        gradeDocumentTrial(renderingTrial(observedRenderedAnswer, false))
            .status,
        "failed",
    );
});

test("future v3 admits only the untouched complete document in one text/unlabeled fence or prior supported prose", () => {
    for (const label of ["text", ""]) {
        for (const prefix of [
            "",
            "# Vega deployment checklist\n\n",
            "Requested document:\n",
        ]) {
            const answer =
                prefix +
                "```" +
                label +
                "\n" +
                document.content +
                "\n```\n\nEnd of document.";
            const value = renderingTrial(answer);
            value.renderingContract = { ...fenceRenderingContract };
            assert.equal(gradeDocumentTrial(value).status, "passed", answer);
        }
    }
    for (const answer of [
        document.content,
        observedRenderedAnswer,
        "## " + document.content.split("\n").join("\n\n"),
    ]) {
        const value = renderingTrial(answer);
        value.renderingContract = { ...fenceRenderingContract };
        assert.equal(gradeDocumentTrial(value).status, "passed");
    }
});

test("future v3 exact fence rejects executable, nested, multiple, malformed and non-line-bounded wrappers", () => {
    const body = document.content;
    const bad = [
        ...[
            "js",
            "javascript",
            "python",
            "sh",
            "powershell",
            "json",
            "html",
            "markdown",
            "md",
            "txt",
            "plaintext",
            "Text",
            " text",
            "text ",
            "text title=doc",
        ].map((label) => "```" + label + "\n" + body + "\n```"),
        "~~~text\n" + body + "\n~~~",
        "````text\n" + body + "\n````",
        " ```text\n" + body + "\n```",
        "\t```text\n" + body + "\n```",
        "    ```text\n" + body + "\n```",
        "```text\n" + body + "\n ```",
        "```text\n" + body + "\n``` ",
        "```text\n" + body,
        body + "\n```",
        "```text\n" + body + "\n~~~",
        "```text\n" + body + "\n````",
        "Prefix ```text\n" + body + "\n```",
        "```text\n" + body + "\n``` suffix",
        "```text\n" + body + "\n```\n```\nextra\n```",
        "```\nexample\n```\n```text\n" + body + "\n```",
        "```text\n```\n" + body + "\n```\n```",
        "```text\n" + body + "\n```text\n```",
        "```text\n" + body + "\n```\n```",
        "> ```text\n" + body + "\n> ```",
        "| ```text\n" + body + "\n| ```",
        "<pre>\n```text\n" + body + "\n```\n</pre>",
        body + "\n```javascript\nexecute()\n```",
        body + "\n```text\nnot the document\n```",
    ];
    for (const answer of bad) {
        const value = renderingTrial(answer);
        value.renderingContract = fenceRenderingContract;
        assert.equal(gradeDocumentTrial(value).status, "failed", answer);
    }
});

test("future v3 does not normalize even allowed prose formatting inside a fence or use an outside title to fill missing body", () => {
    const lines = document.content.split("\n");
    const bodies = [
        lines.slice(1).join("\n"),
        lines.slice(0, -1).join("\n"),
        [lines[0], lines[2], lines[1], ...lines.slice(3)].join("\n"),
        [lines[0], "Extra internal text", ...lines.slice(1)].join("\n"),
        [...lines, lines.at(-1)].join("\n"),
        document.content.replace("rollback", "roll-back"),
        document.content.replace("Owner:", "Owner"),
        document.content.replace("Vega", "vega"),
        document.content.replace("VEGA-CHECK-58", "VEGA-CHECK-59"),
        document.content.replace("Test Team", "Test  Team"),
        replaceFirstLineBreak(document.content, "\n\n"),
        replaceFirstLineBreak(document.content, "  \n"),
        "# " + document.content,
        "\n" + document.content,
        document.content + "\n",
        document.content + "  ",
        replaceFirstLineBreak(document.content, "\r\n"),
        lines.map((line) => "    " + line).join("\n"),
        lines.map((line) => "| " + line + " |").join("\n"),
    ];
    for (const body of bodies) {
        const answer =
            "# Vega deployment checklist\n\n```text\n" + body + "\n```";
        const value = renderingTrial(answer);
        value.renderingContract = fenceRenderingContract;
        assert.equal(gradeDocumentTrial(value).status, "failed", body);
    }
});

test("future v3 keeps exact contract validation and unsupported synthetic/raw fixture guards", () => {
    for (const value of [
        { ...fenceRenderingContract, fixtureShape: "generic-code" },
        { ...fenceRenderingContract, sourceBytesMayChange: true },
        {
            ...fenceRenderingContract,
            protocolVersion: "synthetic-document-rendering-v6",
        },
    ]) {
        const trial = renderingTrial(observedFencedAnswer);
        trial.renderingContract = value;
        assert.equal(gradeDocumentTrial(trial).status, "harness-invalid");
        assert.throws(() => validateSyntheticRenderingContract(value));
    }
    for (const fields of [
        { expectedId: "workiq-doc-vega" },
        { content: document.content.replace("\nOwner:", "\n    Owner:") },
        { content: document.content.replace("Owner:", "| Owner: |") },
        { content: replaceFirstLineBreak(document.content, "\n```text\n") },
        { content: document.content + " " },
    ]) {
        const changed = { ...document, ...fields };
        const value = renderingTrial("```text\n" + changed.content + "\n```");
        value.documents = [changed];
        value.renderingContract = fenceRenderingContract;
        assert.equal(gradeDocumentTrial(value).status, "blocked");
    }
});

test("future v3 fence output never weakens source originals, permission, audit, lease, root or callback identity", () => {
    withFinalizedSource(
        (value, source, write) => {
            const grade = gradeDocumentTrial(value);
            assert.equal(grade.status, "passed", JSON.stringify(grade));
            assert.equal(gradeDocumentTrial(value).grammarHit, false);
            const original = structuredClone(source);
            for (const mutate of [
                (s) => {
                    s.trace.toolCalls[1].result.content = observedFencedAnswer;
                },
                (s) => {
                    s.trace.toolCalls[1].modelResult.content =
                        observedFencedAnswer;
                },
                (s) => {
                    s.trace.response =
                        "I will look up the document." + document.content;
                },
                (s) => {
                    s.trace.toolCalls[1].permission = "allow-always";
                },
            ]) {
                Object.assign(source, structuredClone(original));
                mutate(source);
                write();
                assert.equal(gradeDocumentTrial(value).status, "failed");
            }
            Object.assign(source, structuredClone(original));
            write();
            value.renderingContract = renderingContract;
            assert.equal(gradeDocumentTrial(value).status, "failed");
            value.renderingContract = fenceRenderingContract;
            value.routeEvidence.receipt.callback = structuredClone(
                value.routeEvidence.receipt.callback,
            );
            assert.notEqual(gradeDocumentTrial(value).status, "passed");
        },
        {
            answer: observedFencedAnswer,
            renderingContract: fenceRenderingContract,
        },
    );
    for (const mutate of [
        (v) => {
            v.backendAudit[1].id = "captured-document";
        },
        (v) => {
            v.events.pop();
        },
        (v) => {
            v.executionEvidence.effects = ["write-file"];
        },
    ]) {
        const value = renderingTrial(observedFencedAnswer);
        value.renderingContract = fenceRenderingContract;
        mutate(value);
        assert.notEqual(gradeDocumentTrial(value).status, "passed");
    }
});

test("future v4 quote opt-in admits the observed whole exact quote while v1/v2/v3 and serialized histories stay rejecting", () => {
    assert.equal(
        syntheticDocumentBlockquoteRenderingContract,
        blockquoteRenderingContract.protocolVersion,
    );
    assert.equal(
        validateSyntheticRenderingContract(blockquoteRenderingContract),
        blockquoteRenderingContract,
    );
    for (const contract of [
        undefined,
        renderingContract,
        fenceRenderingContract,
    ]) {
        const value = renderingTrial(observedBlockquoteAnswer, false);
        if (contract) value.renderingContract = contract;
        assert.equal(gradeDocumentTrial(value).status, "failed");
        assert.equal(
            gradeDocumentTrial(JSON.parse(JSON.stringify(value))).status,
            "failed",
        );
    }
    const future = renderingTrial(observedBlockquoteAnswer);
    future.renderingContract = blockquoteRenderingContract;
    assert.equal(gradeDocumentTrial(future).status, "passed");
    assert.equal(
        gradeDocumentTrial(JSON.parse(JSON.stringify(future))).status,
        "passed",
    );
    future.renderingContract = fenceRenderingContract;
    assert.equal(gradeDocumentTrial(future).status, "failed");
});

test("future v4 admits prior prose/exact fence or a whole line-bounded consistently single quoted document", () => {
    const quote = document.content
        .split("\n")
        .map((line) => "> " + line)
        .join("\n");
    for (const answer of [
        quote,
        observedBlockquoteAnswer,
        "Requested contents:\n\n" + quote + "\n\nEnd of document.",
        document.content,
        observedRenderedAnswer,
        observedFencedAnswer,
    ]) {
        const value = renderingTrial(answer);
        value.renderingContract = blockquoteRenderingContract;
        assert.equal(gradeDocumentTrial(value).status, "passed", answer);
    }
    const spaced = {
        ...document,
        content: document.content.replace("Test Team", "Test  Team"),
    };
    const value = renderingTrial(
        spaced.content
            .split("\n")
            .map((line) => "> " + line)
            .join("\n"),
    );
    value.documents = [spaced];
    bindProgramOutput(value, spaced);
    value.renderingContract = blockquoteRenderingContract;
    assert.equal(gradeDocumentTrial(value).status, "passed");
});

test("future v4 exact quote rejects mixed/nested/indented wrappers, missing title/body, decorations, text changes and extra internal lines", () => {
    const lines = document.content.split("\n");
    const quote = (body) => body.map((line) => "> " + line).join("\n");
    const bodies = [
        lines.slice(1),
        lines.slice(0, -1),
        [lines[0], lines[2], lines[1], ...lines.slice(3)],
        [lines[0], "Extra internal text", ...lines.slice(1)],
        [...lines, "Extra quoted footer"],
        ["Extra quoted prefix", ...lines],
        [...lines.slice(0, 2), lines[1], ...lines.slice(2)],
        [lines[0], "", ...lines.slice(1)],
        ["", ...lines],
        [...lines, ""],
        lines.map((line) => line + "  "),
        lines.map((line) => line + " "),
        lines.map((line) => " " + line),
        lines.map((line) => "# " + line),
        lines.map((line) => "**" + line + "**"),
        lines.map((line) => "`" + line + "`"),
        lines.map((line) => "| " + line + " |"),
        lines.map((line) => line.replace("Owner:", "Owner")),
        lines.map((line) => line.replace("Vega", "vega")),
        lines.map((line) => line.replace("rollback", "roll-back")),
        lines.map((line) => line.replace("VEGA-CHECK-58", "VEGA-CHECK-59")),
        lines.map((line) => line.replace("Test Team", "Test  Team")),
        lines.map((line) => line.replace("Test Team", "Test\u00a0Team")),
    ];
    const bad = [
        ...bodies.map(quote),
        lines.map((line) => ">> " + line).join("\n"),
        lines.map((line) => "> > " + line).join("\n"),
        lines.map((line) => " > " + line).join("\n"),
        lines.map((line) => "\t> " + line).join("\n"),
        lines.map((line) => ">" + line).join("\n"),
        lines.map((line) => ">\t" + line).join("\n"),
        lines.map((line, index) => (index === 2 ? "" : "> ") + line).join("\n"),
        lines
            .map((line, index) => (index === 2 ? ">> " : "> ") + line)
            .join("\n"),
        lines
            .map((line, index) => (index === 2 ? " > " : "> ") + line)
            .join("\n"),
        replaceFirstLineBreak(quote(lines), "\n\n"),
        replaceFirstLineBreak(quote(lines), "\r\n"),
        "Prefix on same line " + quote(lines),
        quote(lines) + " changed suffix",
        "```text\n" + quote(lines) + "\n```",
        "> ```text\n" + quote(lines) + "\n> ```",
        "> ```javascript\n" + quote(lines) + "\n> ```",
        "~~~\n" + quote(lines) + "\n~~~",
        "<pre>\n" + quote(lines) + "\n</pre>",
        "<table>\n" + quote(lines) + "\n</table>",
    ];
    for (const answer of bad) {
        const value = renderingTrial(
            "# Vega deployment checklist\n\n" + answer,
        );
        value.renderingContract = blockquoteRenderingContract;
        assert.equal(gradeDocumentTrial(value).status, "failed", answer);
    }
});

test("future v4 explicit contract rejects unknown/loose values and cannot admit code/table/raw whitespace or non-synthetic fixtures", () => {
    for (const contract of [
        null,
        "synthetic-document-rendering-v4",
        {
            ...blockquoteRenderingContract,
            protocolVersion: "synthetic-document-rendering-v6",
        },
        { ...blockquoteRenderingContract, fixtureShape: "all-markdown" },
        { ...blockquoteRenderingContract, normalizeBody: true },
        { ...blockquoteRenderingContract, allowNestedQuotes: true },
    ]) {
        const value = renderingTrial(observedBlockquoteAnswer);
        value.renderingContract = contract;
        assert.equal(gradeDocumentTrial(value).status, "harness-invalid");
        assert.throws(() => validateSyntheticRenderingContract(contract));
    }
    for (const fields of [
        { expectedId: "workiq-document" },
        { content: document.content.replace("\nOwner", "\n    Owner") },
        { content: document.content.replace("Owner:", "| Owner: |") },
        { content: "> " + document.content },
        { content: replaceFirstLineBreak(document.content, "\n```text\n") },
        { content: document.content + " " },
    ]) {
        const changed = { ...document, ...fields };
        const value = renderingTrial(
            changed.content
                .split("\n")
                .map((line) => "> " + line)
                .join("\n"),
        );
        value.documents = [changed];
        value.renderingContract = blockquoteRenderingContract;
        assert.equal(gradeDocumentTrial(value).status, "blocked");
    }
});

test("future v4 presentation cannot replace exact SDK originals/model results, trace bytes, permissions or callback provenance", () => {
    withFinalizedSource(
        (value, source, write) => {
            assert.equal(gradeDocumentTrial(value).status, "passed");
            assert.equal(gradeDocumentTrial(value).grammarHit, false);
            const original = structuredClone(source);
            for (const mutate of [
                (s) => {
                    s.trace.toolCalls[1].result.content =
                        observedBlockquoteAnswer;
                },
                (s) => {
                    s.trace.toolCalls[1].modelResult.content =
                        observedBlockquoteAnswer;
                },
                (s) => {
                    s.trace.response =
                        "I will look up the document." + document.content;
                },
                (s) => {
                    s.trace.toolCalls[1].permission = "allow-always";
                },
            ]) {
                Object.assign(source, structuredClone(original));
                mutate(source);
                write();
                assert.equal(gradeDocumentTrial(value).status, "failed");
            }
            Object.assign(source, structuredClone(original));
            write();
            value.renderingContract = fenceRenderingContract;
            assert.equal(gradeDocumentTrial(value).status, "failed");
            value.renderingContract = blockquoteRenderingContract;
            value.routeEvidence.receipt.callback = structuredClone(
                value.routeEvidence.receipt.callback,
            );
            assert.notEqual(gradeDocumentTrial(value).status, "passed");
        },
        {
            answer: observedBlockquoteAnswer,
            renderingContract: blockquoteRenderingContract,
        },
    );
});

test("future v4 quoted correctness does not excuse wrong binding/audit, pending root completion, wrong macro count or forbidden effects", () => {
    for (const mutate of [
        (v) => {
            v.backendAudit[0].title = "Wrong title";
        },
        (v) => {
            v.backendAudit[1].id = "captured-doc";
        },
        (v) => {
            v.backendAudit = undefined;
        },
        (v) => {
            v.events.pop();
        },
        (v) => {
            v.events[0].data.toolRequests = [{ toolCallId: "pending" }];
        },
        (v) => {
            v.executionEvidence.wholeMacroInvocations = 0;
        },
        (v) => {
            v.executionEvidence.effects = ["write-file"];
        },
    ]) {
        const value = renderingTrial(observedBlockquoteAnswer);
        value.renderingContract = blockquoteRenderingContract;
        mutate(value);
        assert.notEqual(gradeDocumentTrial(value).status, "passed");
    }
});

test("experimental v5 reports exact measurable 90 percent acceptance and below-90 rejection using ordered Levenshtein", () => {
    const bounded = {
        key: "boundary",
        title: "T",
        expectedId: "synthetic-doc-boundary",
        content: "T\nMARK-A\n" + "A".repeat(84) + "\nMARK-Z",
    };
    assert.equal(bounded.content.length, 100);
    assert.equal(
        syntheticDocumentSimilarityContract,
        "synthetic-document-similarity-v5",
    );
    for (const [edits, score, status] of [
        [0, 1, "passed"],
        [10, 0.9, "passed"],
        [11, 0.89, "failed"],
    ]) {
        const answer = bounded.content.replace(
            "A".repeat(84),
            "B".repeat(edits) + "A".repeat(84 - edits),
        );
        const result = gradeDocumentTrial(similarityTrial(answer, [bounded]));
        assert.equal(result.status, status, JSON.stringify(result));
        assert.equal(result.answerScoring.similarity, score);
        assert.equal(result.answerScoring.distance, edits);
        assert.equal(result.answerScoring.denominator, 100);
        assert.equal(result.answerScoring.threshold, 0.9);
        assert.equal(
            result.answerScoring.metricVersion,
            "ordered-levenshtein-codepoints-v1",
        );
        assert.equal(result.answerScoring.experimental, true);
        assert.equal(result.answerScoring.protectedAnchors.ordered, true);
        assert.match(
            result.answerScoring.interpretation,
            /not complete exact-content or semantic/,
        );
    }
    for (const answer of [
        bounded.content.replace(/^T/u, "X"),
        bounded.content.slice(0, -10),
    ]) {
        const result = gradeDocumentTrial(similarityTrial(answer, [bounded]));
        assert.equal(result.status, "failed");
        assert.equal(result.answerScoring.similarity, null);
    }
});

test("experimental v5 normalizes documented display wrappers only and scores a bounded document region, not surrounding prose", () => {
    const lines = document.content.split("\n");
    for (const answer of [
        observedRenderedAnswer,
        observedFencedAnswer,
        observedBlockquoteAnswer,
        lines.map((line) => "- " + line).join("\n"),
        lines.map((line, index) => index + 1 + ". " + line).join("\n"),
        lines.map((line) => "**" + line + "**").join("\n"),
        lines.map((line) => "> - " + line).join("\n"),
        lines.map((line) => ">  " + line + "  ").join("\n"),
        "```markdown\n" + document.content + "\n```",
        document.content.replaceAll("\n", "\r\n"),
        document.content.replace("Test Team", "Test\t\tTeam"),
    ]) {
        const wrapped =
            "Outside introduction unrelated to this document.\n\n" +
            answer +
            "\n\nOutside closing prose unrelated to the document.";
        const result = gradeDocumentTrial(similarityTrial(wrapped));
        assert.equal(
            result.status,
            "passed",
            JSON.stringify({ answer, result }),
        );
        assert.equal(result.answerScoring.similarity, 1);
        assert.ok(result.answerScoring.region.startLine > 1);
        assert.deepEqual(
            result.answerScoring.scoringContract,
            similarityContract(),
        );
    }
});

test("experimental v5 requires exact title and both explicit fixture markers in one unique expected-order region", () => {
    for (const answer of [
        document.content.replace(document.title, "Vega deployment checklisx"),
        document.content.replace("VEGA-DEPLOY-23", "VEGA-DEPLOY-24"),
        document.content.replace("VEGA-CHECK-58", "VEGA-CHECK-59"),
        document.content.replace("\nVEGA-DEPLOY-23", ""),
        document.content.replace("\nVEGA-CHECK-58", ""),
        [
            document.content.split("\n")[0],
            document.content.split("\n")[1],
            document.content.split("\n")[3],
            document.content.split("\n")[2],
            document.content.split("\n")[4],
        ].join("\n"),
        document.content
            .replace("VEGA-DEPLOY-23", "TEMP")
            .replace("VEGA-CHECK-58", "VEGA-DEPLOY-23")
            .replace("TEMP", "VEGA-CHECK-58"),
        document.title +
            "\nMarkers in a different document:\nWrong title\n" +
            document.content.split("\n").slice(1).join("\n"),
        document.content.replace("\nOwner", "\nVEGA-DEPLOY-23\nOwner"),
        document.content.replace("\nOwner", "\n" + document.title + "\nOwner"),
        document.content.split("\n").slice(0, 3).join("\n"),
    ]) {
        const result = gradeDocumentTrial(similarityTrial(answer));
        assert.equal(
            result.status,
            "failed",
            JSON.stringify({ answer, result }),
        );
    }
});

test("experimental v5 rejects known other-document markers even when numerical similarity otherwise exceeds 90 percent", () => {
    const other = {
        key: "other",
        title: "Other fixture",
        expectedId: "synthetic-doc-other",
        content: "Other fixture\nM-A\nOwner: Other team\nM-Z",
    };
    const answer = document.content.replace("\nOwner", "\nM-A\nOwner");
    const result = gradeDocumentTrial(
        similarityTrial(answer, [document, other]),
    );
    assert.equal(result.status, "failed");
    assert.ok(result.answerScoring.similarity > 0.9);
    assert.equal(
        result.answerScoring.protectedAnchors.noWrongDocumentMarkers,
        false,
    );
});

test("experimental v5 ordered metric penalizes reordered words and negation changes instead of dropping them through a set", () => {
    const raw = {
        key: "ordered",
        title: "Ordered fixture",
        expectedId: "synthetic-doc-ordered",
        content:
            "Ordered fixture\nORDER-A\nDo not allow launch before review\nORDER-Z",
    };
    for (const answer of [
        raw.content.replace(
            "Do not allow launch before review",
            "review before launch allow not Do",
        ),
        raw.content.replace("Do not allow", "Do allow"),
        raw.content.replace("review", "Review"),
    ]) {
        const result = gradeDocumentTrial(similarityTrial(answer, [raw]));
        assert.ok(result.answerScoring.distance > 0);
        assert.ok(result.answerScoring.similarity < 1);
    }
});

test("experimental v5 shared admission verifies all protected records against exact current corpus identity/hash/marker roles", () => {
    const contract = similarityContract();
    assert.equal(validateSyntheticRenderingContract(contract), contract);
    assert.equal(
        validateSyntheticDocumentScoringContract(contract, {
            documents: [document],
        }),
        contract,
    );
    const mutations = [
        (c) => {
            c.protectedDocuments = [];
        },
        (c) => {
            delete c.protectedDocuments;
        },
        (c) => {
            c.protectedDocuments[0].markers = [];
        },
        (c) => {
            c.protectedDocuments[0].markers = [""];
        },
        (c) => {
            c.protectedDocuments[0].markers = [
                "VEGA-DEPLOY-23",
                "VEGA-DEPLOY-23",
            ];
        },
        (c) => {
            c.protectedDocuments[0].markers = [
                "VEGA-CHECK-58",
                "VEGA-DEPLOY-23",
            ];
        },
        (c) => {
            c.protectedDocuments[0].markers[0] = "Owner: Test Team Vega";
        },
        (c) => {
            c.protectedDocuments[0].markers[0] = "unknown-fixture-marker";
        },
        (c) => {
            c.protectedDocuments[0].title = "Wrong title";
        },
        (c) => {
            c.protectedDocuments[0].expectedId = "captured-id";
        },
        (c) => {
            c.protectedDocuments[0].contentSha256 = "0".repeat(64);
        },
        (c) => {
            c.protectedDocuments[0].key = "foreign";
        },
        (c) => {
            c.protectedDocuments.push(structuredClone(c.protectedDocuments[0]));
        },
        (c) => {
            c.fixtureId = "unknown-fixture";
        },
        (c) => {
            c.algorithm = "bag-of-words";
        },
        (c) => {
            c.threshold = NaN;
        },
        (c) => {
            c.threshold = Infinity;
        },
        (c) => {
            c.threshold = -1;
        },
        (c) => {
            c.threshold = 1.1;
        },
        (c) => {
            c.threshold = "0.9";
        },
        (c) => {
            c.caps = { workCells: Infinity };
        },
        (c) => {
            c.protocolVersion = "synthetic-document-similarity-v6";
        },
    ];
    for (const mutate of mutations) {
        const changed = structuredClone(contract);
        mutate(changed);
        assert.throws(() =>
            validateSyntheticDocumentScoringContract(changed, {
                documents: [document],
            }),
        );
        const value = similarityTrial(document.content);
        value.renderingContract = changed;
        const result = gradeDocumentTrial(value);
        assert.equal(
            result.status,
            "harness-invalid",
            JSON.stringify({ changed, result }),
        );
        assert.ok(result.errors.length > 0);
    }
    const modified = {
        ...document,
        content: document.content.replace("reviewed", "updated"),
    };
    assert.throws(
        () =>
            validateSyntheticDocumentScoringContract(contract, {
                documents: [modified],
            }),
        /Unknown or changed protected fixture/,
    );
    assert.throws(
        () =>
            validateSyntheticDocumentScoringContract(contract, {
                documents: [],
            }),
        /ALL current trusted/,
    );
});

test("experimental v5 bounded scoring refuses oversize input and title/region candidate floods explicitly", () => {
    const large = similarityTrial("x".repeat(65537));
    assert.equal(gradeDocumentTrial(large).status, "harness-invalid");
    for (const answer of [
        (document.title + "\n").repeat(9) + document.content,
        document.title +
            "\nVEGA-DEPLOY-23\n" +
            "x".repeat(1025) +
            "\nVEGA-CHECK-58",
    ]) {
        const result = gradeDocumentTrial(similarityTrial(answer));
        assert.equal(result.status, "failed");
        assert.match(result.answerScoring.error, /bounded|limit/);
    }
});

test("experimental v5 scoring is independent of strict source originals, identity, permissions, route, root and effects", () => {
    const contract = similarityContract();
    withFinalizedSource(
        (value, source, write) => {
            assert.equal(gradeDocumentTrial(value).status, "passed");
            const original = structuredClone(source);
            for (const mutate of [
                (s) => {
                    s.trace.toolCalls[1].result.content =
                        observedBlockquoteAnswer;
                },
                (s) => {
                    s.trace.toolCalls[1].modelResult.content =
                        observedBlockquoteAnswer;
                },
                (s) => {
                    s.trace.toolCalls[1].permission = "allow-always";
                },
                (s) => {
                    s.trace.response =
                        "I will look up the document." + document.content;
                },
            ]) {
                Object.assign(source, structuredClone(original));
                mutate(source);
                write();
                const result = gradeDocumentTrial(value);
                assert.equal(result.answerScoring.similarity, 1);
                assert.equal(result.status, "failed");
            }
            Object.assign(source, structuredClone(original));
            write();
            value.routeEvidence.receipt.callback = structuredClone(
                value.routeEvidence.receipt.callback,
            );
            assert.notEqual(gradeDocumentTrial(value).status, "passed");
        },
        { answer: observedBlockquoteAnswer, renderingContract: contract },
    );
    for (const mutate of [
        (v) => {
            v.backendAudit[1].id = "captured-id";
        },
        (v) => {
            v.events.pop();
        },
        (v) => {
            v.executionEvidence.effects = ["write-file"];
        },
    ]) {
        const value = similarityTrial(observedBlockquoteAnswer);
        mutate(value);
        assert.notEqual(gradeDocumentTrial(value).status, "passed");
    }
    const negative = negativeTrial();
    negative.renderingContract = similarityContract();
    const result = gradeDocumentTrial(negative);
    assert.equal(result.status, "passed");
    assert.equal(result.answerScoring.applicable, false);
    assert.equal(result.answerScoring.similarity, null);
    assert.deepEqual(
        result.answerScoring.scoringContract,
        similarityContract(),
    );
});

test("future output rendering never normalizes finalized trace bytes, original SDK result/modelResult, permission or callback provenance", () => {
    withFinalizedSource(
        (value, source, write) => {
            const original = structuredClone(source);
            const result = gradeDocumentTrial(value);
            assert.equal(result.status, "passed", JSON.stringify(result));
            assert.equal(result.grammarHit, false);
            for (const mutate of [
                (s) => {
                    s.trace.toolCalls[1].result.content = JSON.stringify({
                        ...s.trace.toolCalls[1].modelResult,
                        content: observedRenderedAnswer,
                    });
                },
                (s) => {
                    s.trace.toolCalls[1].modelResult.content =
                        observedRenderedAnswer;
                },
                (s) => {
                    s.trace.response =
                        "I will look up the document." + document.content;
                },
                (s) => {
                    s.trace.toolCalls[1].permission = "allow-always";
                },
            ]) {
                Object.assign(source, structuredClone(original));
                mutate(source);
                write();
                assert.equal(gradeDocumentTrial(value).status, "failed");
            }
            Object.assign(source, structuredClone(original));
            write();
            delete value.renderingContract;
            assert.equal(gradeDocumentTrial(value).status, "failed");
            value.renderingContract = renderingContract;
            value.routeEvidence.receipt.callback = structuredClone(
                value.routeEvidence.receipt.callback,
            );
            assert.notEqual(gradeDocumentTrial(value).status, "passed");
        },
        { answer: observedRenderedAnswer, renderingContract },
    );
});

test("finalized v1 source joins the original callback, current lease, physical store and all root SDK results, not live acceptance", () => {
    assert.equal(
        nativeSelectedSourceContract,
        "native-finalized-selected-source-v1",
    );
    withFinalizedSource((value) => {
        const result = gradeDocumentTrial(value);
        assert.equal(result.status, "passed", JSON.stringify(result));
        assert.equal(result.taskCorrect, true);
        assert.equal(result.grammarHit, false);
        assert.equal(
            value.events.some((entry) => entry.type === "session.idle"),
            false,
        );
        assert.equal(
            Object.hasOwn(event(value, "hook-end").data, "output"),
            false,
        );
        assert.ok(
            Date.parse(value.routeEvidence.receipt.capture.after.observedAt) <
                Date.parse(event(value, "hook-end").timestamp),
        );
    });
});

test("finalized source remains blocked without a synchronous host reader; serialized evidence and async readers are invalid", () => {
    withFinalizedSource((value, source) => {
        for (const reader of [
            undefined,
            null,
            () => null,
            () => {
                throw new Error("Current admitted service unavailable");
            },
        ]) {
            value.readFinalizedSource = reader;
            const result = gradeDocumentTrial(value);
            assert.equal(result.status, "blocked", JSON.stringify(result));
            assert.equal(result.taskCorrect, null);
            assert.equal(result.grammarHit, null);
        }
        for (const reader of [
            source,
            { verified: true },
            async () => source,
            async () => {
                throw new Error("Async evidence is unsupported");
            },
        ]) {
            value.readFinalizedSource = reader;
            assert.equal(gradeDocumentTrial(value).status, "harness-invalid");
        }
    });
});

test("finalized physical evidence cannot restore a cloned callback or replace actual armed/claimed lease observations", () => {
    withFinalizedSource((value) => {
        const callback = value.routeEvidence.receipt.callback;
        let calls = 0;
        const reader = value.readFinalizedSource;
        value.readFinalizedSource = (target) => {
            calls++;
            return reader(target);
        };
        value.routeEvidence.receipt.callback = structuredClone(callback);
        assert.notEqual(gradeDocumentTrial(value).status, "passed");
        assert.equal(calls, 0);
        value.routeEvidence.receipt.callback = callback;
        value.routeEvidence.receipt.capture.after.state.status = "completed";
        assert.notEqual(gradeDocumentTrial(value).status, "passed");
    });
});

test("finalized source independently rejects wrong current summary, prompt, root presentation, SDK binding/results and permission", () => {
    const cases = [
        [
            "session",
            (_v, s) => {
                s.trace.sessionId = "foreign-session";
            },
        ],
        [
            "workspace",
            (_v, s) => {
                s.trace.cwd += "\\foreign";
            },
        ],
        [
            "trace-summary",
            (_v, s) => {
                s.state.trace.traceId = randomUUID();
            },
        ],
        [
            "summary-count",
            (_v, s) => {
                s.state.trace.toolCallCount++;
            },
        ],
        [
            "summary-created",
            (_v, s) => {
                s.state.trace.createdAt = timestamp;
            },
        ],
        [
            "old-prompt",
            (_v, s) => {
                s.trace.prompt = "A different captured prompt";
            },
        ],
        [
            "missing-planning",
            (v, s) => {
                s.trace.response = v.answer;
            },
        ],
        [
            "wrong-start",
            (_v, s) => {
                s.trace.startedAt = timestamp;
            },
        ],
        [
            "turn-end-is-not-progress",
            (v, s) => {
                s.trace.completedAt = event(v, "root-turn-end").timestamp;
            },
        ],
        [
            "expired-finalize",
            (v, s) => {
                s.trace.createdAt =
                    v.routeEvidence.receipt.capture.after.state.token.expiresAt;
                s.state.trace.createdAt = s.trace.createdAt;
            },
        ],
        [
            "captured-id",
            (_v, s) => {
                s.trace.toolCalls[1].arguments.id = "captured-doc";
            },
        ],
        [
            "call-id",
            (_v, s) => {
                s.trace.toolCalls[0].toolCallId = "foreign-call";
            },
        ],
        [
            "call-order",
            (_v, s) => {
                s.trace.toolCalls.reverse();
            },
        ],
        [
            "server",
            (_v, s) => {
                s.trace.toolCalls[0].mcpServerName = "foreign-server";
            },
        ],
        [
            "raw-result",
            (_v, s) => {
                s.trace.toolCalls[1].result.content = "short content";
            },
        ],
        [
            "model-result",
            (_v, s) => {
                s.trace.toolCalls[1].modelResult.content = "short content";
            },
        ],
        [
            "missing-result",
            (_v, s) => {
                delete s.trace.toolCalls[1].result;
            },
        ],
        [
            "permission",
            (_v, s) => {
                s.trace.toolCalls[0].permission = "allow-always";
            },
        ],
        [
            "denied-call",
            (_v, s) => {
                s.trace.toolCalls[0].status = "denied";
            },
        ],
    ];
    withFinalizedSource((value, source, write) => {
        const original = structuredClone(source);
        for (const [name, mutate] of cases) {
            Object.assign(source, structuredClone(original));
            mutate(value, source);
            write();
            const result = gradeDocumentTrial(value);
            assert.equal(
                result.status,
                "failed",
                `${name}: ${JSON.stringify(result)}`,
            );
            assert.equal(result.grammarHit, null, name);
        }
    });
});

test("finalized source rejects foreign store/owner/instance, current file digest/object mismatch and observation outside its receipt", () => {
    withFinalizedSource((value, source, write) => {
        const original = structuredClone(source);
        const originalInstance =
            value.routeEvidence.receipt.control.source.instance;
        const cases = [
            [
                "store",
                () => {
                    source.storeRoot += "\\foreign";
                },
            ],
            [
                "path",
                () => {
                    source.file.path = path.join(
                        source.storeRoot,
                        "other.json",
                    );
                },
            ],
            [
                "digest",
                () => {
                    source.file.sha256 = "0".repeat(64);
                },
            ],
            [
                "object",
                () => {
                    source.trace.response = "tampered memory";
                },
            ],
            [
                "old-observation",
                () => {
                    source.observedAt = timestamp;
                },
            ],
            [
                "future-observation",
                () => {
                    source.observedAt = new Date(
                        Date.parse(
                            value.routeEvidence.receipt.expected.endedAt,
                        ) + 1,
                    ).toISOString();
                },
            ],
            [
                "instance",
                () => {
                    value.routeEvidence.receipt.control.source.instance =
                        "foreign-instance";
                },
            ],
        ];
        for (const [name, mutate] of cases) {
            Object.assign(source, structuredClone(original));
            value.routeEvidence.receipt.control.source.instance =
                originalInstance;
            write();
            mutate();
            assert.equal(gradeDocumentTrial(value).status, "failed", name);
        }
    });
});

test("artifact-backed v2 source stays blocked; unknown schemas/capabilities, v1 artifact fields and extra source keys fail closed", () => {
    withFinalizedSource((value, source, write) => {
        const original = structuredClone(source);
        source.trace.schemaVersion = 2;
        source.trace.capabilities = ["private-result-evidence-v1"];
        delete source.trace.toolCalls[0].result;
        source.trace.toolCalls[0].resultArtifact = { path: "private.bin" };
        write();
        const blocked = gradeDocumentTrial(value);
        assert.equal(blocked.status, "blocked");
        assert.equal(blocked.taskCorrect, null);
        assert.equal(blocked.grammarHit, null);
        const cases = [
            (s) => {
                s.trace.schemaVersion = 3;
            },
            (s) => {
                s.trace.capabilities = ["unknown-capability"];
            },
            (s) => {
                s.trace.toolCalls[0].resultArtifact = null;
            },
            (s) => {
                s.trace.handoffRunId = "foreign-run";
            },
            (s) => {
                s.verified = true;
            },
            (s) => {
                s.file.sizeBytes = 123;
            },
            (s) => {
                s.state.token = { id: "invented-completed-token" };
            },
            (s) => {
                s.trace.toolCalls[0].unknown = true;
            },
        ];
        for (const mutate of cases) {
            Object.keys(source).forEach((key) => delete source[key]);
            Object.assign(source, structuredClone(original));
            mutate(source);
            write();
            assert.equal(gradeDocumentTrial(value).status, "harness-invalid");
        }
    });
});

test("finalized source physical oracle rejects missing, empty, oversized, invalid UTF-8, truncated and hardlinked files", () => {
    withFinalizedSource((value, source, write) => {
        const file = source.file.path;
        for (const bytes of [
            Buffer.alloc(0),
            Buffer.alloc(1048577, 32),
            Buffer.from([0xff]),
            Buffer.from("{"),
        ]) {
            fs.writeFileSync(file, bytes);
            source.file.sha256 = createHash("sha256")
                .update(fs.readFileSync(file))
                .digest("hex");
            assert.equal(gradeDocumentTrial(value).status, "failed");
        }
        fs.unlinkSync(file);
        assert.equal(gradeDocumentTrial(value).status, "failed");
        write();
        const linked = path.join(source.storeRoot, "linked.json");
        fs.linkSync(file, linked);
        assert.equal(gradeDocumentTrial(value).status, "failed");
        fs.unlinkSync(linked);
        assert.equal(gradeDocumentTrial(value).status, "passed");
    });
});

test("finalized source rejects a linked trace file or store directory without following relocated content", () => {
    for (const directory of [false, true]) {
        withFinalizedSource((value, source) => {
            const original = directory
                ? path.dirname(source.file.path)
                : source.file.path;
            const moved = `${original}-relocated`;
            fs.renameSync(original, moved);
            fs.symlinkSync(moved, original, directory ? "junction" : "file");
            try {
                assert.equal(gradeDocumentTrial(value).status, "failed");
            } finally {
                fs.rmSync(original, { recursive: directory, force: true });
            }
        });
    }
});

test("finalized source does not excuse handled output, macro invocations, effects, failed hooks or missing root completion", () => {
    const cases = [
        (v) => {
            event(v, "hook-end").data.output = { handled: true };
        },
        (v) => {
            event(v, "hook-end").data.output = undefined;
        },
        (v) => {
            v.executionEvidence.wholeMacroInvocations = 1;
        },
        (v) => {
            v.executionEvidence.effects = ["write-file"];
        },
        (v) => {
            event(v, "hook-end").data.success = false;
        },
        (v) => {
            event(v, "root-turn-end").data.turnId = "foreign-turn";
        },
        (v) => {
            event(v, "fetch-complete").data.result = {
                content: "foreign result",
            };
        },
    ];
    for (const mutate of cases) {
        withFinalizedSource((value) => {
            mutate(value);
            const result = gradeDocumentTrial(value);
            assert.equal(result.status, "failed", JSON.stringify(result));
            assert.equal(result.grammarHit, null);
        });
    }
});

function assertOrdinaryCheckFails(value, name) {
    const grade = gradeDocumentTrial(value);
    assert.notEqual(grade.status, "passed");
    assert.equal(grade.grammarHit, null);
    assert.equal(
        grade.checks.find((check) => check.name === name)?.passed,
        false,
        name,
    );
    return grade;
}

test("ordinary v1 unit candidates validate both policy bindings but remain blocked without callback proof", () => {
    for (const policy of ["bypass-baseline", "mcp-mixed-source-capture"]) {
        const grade = gradeDocumentTrial(ordinaryCandidate(policy));
        assert.equal(grade.status, "blocked");
        assert.equal(grade.taskCorrect, null);
        assert.equal(grade.grammarHit, null);
        assert.ok(grade.checks.every((check) => check.passed));
        assert.match(grade.errors.join("\n"), /callback:null/);
        if (policy === "mcp-mixed-source-capture")
            assert.match(grade.errors.join("\n"), /finalized selected trace/);
    }
});

test("generated branded-reader bypass proves ordinary attribution, not a grammar miss or live acceptance", () => {
    withBrandedOrdinary("bypass-baseline", (value) => {
        const callback = value.routeEvidence.receipt.callback;
        assert.equal(isTrustedNormalHookCallback(callback), true);
        assert.equal(Object.isFrozen(callback.input), true);
        assert.equal(
            callback.staged.policy.file,
            path.join(
                value.routeEvidence.receipt.expected.ownedRoot,
                "plugin",
                "native-normal-hook-config.json",
            ),
        );
        assert.notEqual(
            callback.input.rawPromptHash,
            value.routeEvidence.receipt.expected.promptHash,
        );
        const grade = gradeDocumentTrial(value);
        assert.equal(grade.status, "passed");
        assert.equal(grade.taskCorrect, true);
        assert.equal(grade.grammarHit, false);
        assert.deepEqual(grade.errors, []);
        assert.ok(grade.checks.every((check) => check.passed));
    });
});

test("source-declared null policy remains typed without weakening branded OS/event gates", () => {
    withBrandedOrdinary(
        "bypass-baseline",
        (value) => {
            assert.equal(
                value.routeEvidence.receipt.callback.staged.policy,
                null,
            );
            assert.equal(gradeDocumentTrial(value).status, "passed");
            value.routeEvidence.receipt.callback = JSON.parse(
                JSON.stringify(value.routeEvidence.receipt.callback),
            );
            assert.equal(gradeDocumentTrial(value).status, "harness-invalid");
        },
        { launchPolicy: false },
    );
});

test("native omitted hook output is unhandled only with original current controlled bypass proof", () => {
    withBrandedOrdinary("bypass-baseline", (value) => {
        delete event(value, "hook-end").data.output;
        const grade = gradeDocumentTrial(value);
        assert.equal(grade.status, "passed");
        assert.equal(grade.taskCorrect, true);
        assert.equal(grade.grammarHit, false);
        assert.ok(grade.checks.every((entry) => entry.passed));
        value.routeEvidence.receipt.callback = null;
        assertOrdinaryCheckFails(value, "ordinary-successful-unhandled-hook");
    });
});

test("present null/undefined/handling/guidance output never borrows omitted bypass semantics", () => {
    withBrandedOrdinary("bypass-baseline", (value) => {
        for (const output of [
            undefined,
            null,
            { handled: true },
            { handledBy: "typeagent" },
            { responseContent: "TypeAgent guidance" },
            { handled: false, responseContent: "Guidance despite false" },
            { unknown: true },
        ]) {
            event(value, "hook-end").data.output = output;
            assertOrdinaryCheckFails(
                value,
                "ordinary-successful-unhandled-hook",
            );
        }
    });
});

test("omitted hook output cannot admit MCP, stale control, failed hooks or foreign current request", () => {
    withBrandedOrdinary("mcp-mixed-source-capture", (value) => {
        delete event(value, "hook-end").data.output;
        assertOrdinaryCheckFails(value, "ordinary-successful-unhandled-hook");
    });
    for (const change of [
        (value) => {
            value.routeEvidence.receipt.control.effectiveMode = "direct";
        },
        (value) => {
            value.routeEvidence.receipt.control.digest = "0".repeat(64);
        },
        (value) => {
            value.routeEvidence.receipt.control.source.request.sessionId =
                "foreign";
        },
        (value) => {
            value.routeEvidence.receipt.control.source.pid = 999;
        },
        (value) => {
            event(value, "hook-end").data.success = false;
        },
        (value) => {
            event(value, "hook-end").id = "foreign-end";
        },
        (value) => {
            value.routeEvidence.receipt.expected.prompt = "/typeagent status";
        },
    ])
        withBrandedOrdinary("bypass-baseline", (value) => {
            delete event(value, "hook-end").data.output;
            change(value);
            assertOrdinaryCheckFails(
                value,
                "ordinary-successful-unhandled-hook",
            );
        });
});

test("omitted-output bypass still needs independent root/tool/no-macro/no-error gates", () => {
    for (const [name, change] of [
        [
            "ordinary-callback-current-native-correlation",
            (value) => {
                value.events = value.events.filter(
                    (entry) => entry.id !== "root-turn-end",
                );
            },
        ],
        [
            "ordinary-no-delegation-or-whole-macro",
            (value) => {
                value.executionEvidence.wholeMacroInvocations = 1;
            },
        ],
        [
            "ordinary-fixture-tool-lifecycle",
            (value) => {
                event(value, "fetch-complete").data.success = false;
            },
        ],
        [
            "root-answer-without-pending-tools",
            (value) => {
                event(value, "root-answer").data.toolRequests = [
                    { toolCallId: "pending" },
                ];
            },
        ],
    ])
        withBrandedOrdinary("bypass-baseline", (value) => {
            delete event(value, "hook-end").data.output;
            change(value);
            assertOrdinaryCheckFails(value, name);
        });
});

test("actual native process cwd is only the staged plugin root, distinct from stdin workspace", () => {
    for (const processCwd of [
        (expected) => expected.cwd,
        () => "D:\\foreign\\plugin",
        (expected) => path.join(expected.ownedRoot, "plugin-sibling"),
    ])
        withBrandedOrdinary("bypass-baseline", (value) => {
            const { expected, control, callback } = value.routeEvidence.receipt;
            assert.equal(
                control.source.cwd,
                path.join(expected.ownedRoot, "plugin"),
            );
            assert.equal(control.source.request.cwd, expected.cwd);
            assert.equal(callback.input.cwd, expected.cwd);
            control.source.cwd = processCwd(expected);
            assertOrdinaryCheckFails(value, "ordinary-current-control-binding");
        });
});

test("correct native plugin cwd cannot admit CLI-injected config/default Direct from failed baseline", () => {
    withBrandedOrdinary("bypass-baseline", (value) => {
        const { expected, control } = value.routeEvidence.receipt;
        control.configPath = path.join(
            expected.ownedRoot,
            "home-0",
            "plugin-data",
            "_direct",
            "unadmitted-native-hash",
            "config.json",
        );
        control.effectiveMode = "direct";
        control.source.mode = "default";
        control.source.routing = "delegate";
        control.digest = createHash("sha256")
            .update(
                JSON.stringify({
                    configPath: control.configPath,
                    dataRoot: control.dataRoot,
                    effectiveMode: control.effectiveMode,
                    mcpRouting: control.source.routing,
                }),
            )
            .digest("hex");
        const grade = assertOrdinaryCheckFails(
            value,
            "ordinary-current-control-binding",
        );
        assert.equal(
            grade.checks.find(
                (entry) => entry.name === "ordinary-public-control-digest",
            ).passed,
            false,
        );
        assert.equal(
            grade.checks.find(
                (entry) => entry.name === "ordinary-callback-router-control",
            ).passed,
            false,
        );
    });
});

test("wrong owned launch policy path/hash cannot mint an admitting reader callback", () => {
    for (const mutate of [
        (binding) => {
            binding.policy.file = path.join(
                path.dirname(binding.policy.file),
                "foreign.json",
            );
        },
        (binding) => {
            binding.policy.sha256 = "not-a-valid-source-hash";
        },
    ])
        assert.throws(
            () =>
                withBrandedOrdinary(
                    "bypass-baseline",
                    () => assert.fail("Invalid policy minted a callback"),
                    { beforeRead: mutate },
                ),
            /Owned hook policy source drift/,
        );
});

test("serialized or cloned callbacks cannot retain trusted-reader provenance", () => {
    withBrandedOrdinary("bypass-baseline", (value) => {
        const callback = value.routeEvidence.receipt.callback;
        for (const copy of [
            JSON.parse(JSON.stringify(callback)),
            structuredClone(callback),
            { ...callback },
        ]) {
            assert.equal(isTrustedNormalHookCallback(copy), false);
            value.routeEvidence.receipt.callback = copy;
            const grade = gradeDocumentTrial(value);
            assert.equal(grade.status, "harness-invalid");
            assert.equal(grade.grammarHit, null);
            assert.match(grade.errors.join("\n"), /original branded/);
        }
        assert.throws(() => {
            callback.input.prompt = "forged";
        }, TypeError);
    });
});

test("branded callback independently rejects changed current native/control/root evidence", () => {
    const cases = [
        [
            "ordinary-callback-router-control",
            (value) => {
                value.routeEvidence.receipt.control.source.pid = 200;
            },
        ],
        [
            "ordinary-callback-router-control",
            (value) => {
                value.routeEvidence.receipt.control.source.parentPid = 999;
            },
        ],
        [
            "ordinary-callback-router-control",
            (value) => {
                value.routeEvidence.receipt.control.source.executable =
                    "D:\\foreign\\node.exe";
            },
        ],
        [
            "ordinary-callback-router-control",
            (value) => {
                value.routeEvidence.receipt.expected.digest = "f".repeat(64);
            },
        ],
        [
            "ordinary-callback-owned-staged-sources",
            (value) => {
                value.routeEvidence.receipt.expected.owner = "foreign";
            },
        ],
        [
            "ordinary-callback-owned-staged-sources",
            (value) => {
                value.routeEvidence.receipt.expected.ownedRoot = "D:\\foreign";
            },
        ],
        [
            "ordinary-callback-input-hashes",
            (value) => {
                event(value, "hook-start").data.input.timestamp += 1;
            },
        ],
        [
            "ordinary-callback-input-hashes",
            (value) => {
                value.routeEvidence.receipt.expected.sessionId =
                    "foreign-session";
            },
        ],
        [
            "ordinary-callback-current-native-correlation",
            (value) => {
                event(value, "root-answer").id = "copied-new-answer";
                event(value, "root-turn-end").parentId = "copied-new-answer";
            },
        ],
        [
            "ordinary-callback-current-native-correlation",
            (value) => {
                value.events = value.events.filter(
                    (entry) => entry.id !== "root-turn-end",
                );
            },
        ],
        [
            "ordinary-callback-current-native-correlation",
            (value) => {
                event(value, "hook-end").data.output = {
                    handled: true,
                    handledBy: "typeagent",
                };
            },
        ],
        [
            "ordinary-callback-current-os-window",
            (value) => {
                value.routeEvidence.receipt.control.source.observedAt =
                    new Date(Date.parse(timestamp) + 135).toISOString();
            },
        ],
        [
            "ordinary-callback-current-os-window",
            (value) => {
                value.routeEvidence.receipt.expected.startedAt = new Date(
                    Date.parse(timestamp) + 130,
                ).toISOString();
            },
        ],
        [
            "ordinary-callback-input-hashes",
            (value) => {
                value.events = value.events.filter(
                    (entry) => entry.id !== "hook-start",
                );
            },
        ],
        [
            "ordinary-callback-current-native-correlation",
            (value) => {
                value.events = value.events.filter(
                    (entry) => entry.id !== "hook-end",
                );
            },
        ],
        [
            "ordinary-callback-current-native-correlation",
            (value) => {
                value.events.push({
                    ...structuredClone(event(value, "hook-start")),
                    id: "ambiguous-duplicate-hook",
                });
            },
        ],
        [
            "ordinary-mode-capture-policy",
            (value) => {
                value.routeEvidence.receipt.policy = "mcp-mixed-source-capture";
            },
        ],
        [
            "root-answer-without-pending-tools",
            (value) => {
                event(value, "root-answer").data.toolRequests = [
                    { toolCallId: "pending" },
                ];
            },
        ],
        [
            "ordinary-no-delegation-or-whole-macro",
            (value) => {
                value.executionEvidence.wholeMacroInvocations = 1;
            },
        ],
        [
            "ordinary-no-delegation-or-whole-macro",
            (value) => {
                value.executionEvidence.effects = ["send-mail"];
            },
        ],
        [
            "ordinary-no-delegation-or-whole-macro",
            (value) => {
                value.events.push({
                    id: "delegation",
                    type: "subagent.started",
                    agentId: "child",
                    timestamp: new Date(
                        Date.parse(timestamp) + 950,
                    ).toISOString(),
                    data: {},
                });
            },
        ],
        [
            "no-session-error",
            (value) => {
                value.events.push({
                    id: "session-error",
                    type: "session.error",
                    timestamp: new Date(
                        Date.parse(timestamp) + 950,
                    ).toISOString(),
                    data: { message: "actual session failure" },
                });
            },
        ],
        [
            "ordinary-fixture-tool-lifecycle",
            (value) => {
                value.backendAudit = [];
            },
        ],
        [
            "ordinary-fixture-tool-lifecycle",
            (value) => {
                event(value, "fetch-complete").data.success = false;
            },
        ],
        [
            "ordinary-callback-owned-staged-sources",
            (value) => {
                value.routeEvidence.receipt.expected.ownedRoot = null;
            },
        ],
    ];
    for (const [name, mutate] of cases)
        withBrandedOrdinary("bypass-baseline", (value) => {
            mutate(value);
            assertOrdinaryCheckFails(value, name);
        });
});

test("proved ordinary route does not relax the independent document oracle", () => {
    withBrandedOrdinary("bypass-baseline", (value) => {
        value.answer = document.title + "\nPartial synthetic content";
        event(value, "root-answer").data.content = value.answer;
        const grade = gradeDocumentTrial(value);
        assert.equal(grade.status, "failed");
        assert.equal(grade.taskCorrect, false);
        assert.equal(grade.grammarHit, false);
        assert.equal(
            grade.checks.find(
                (entry) => entry.name === "full-exact-document-content",
            ).passed,
            false,
        );
    });
});

test("branded MCP-mixed callback and lease remain blocked without finalized source trace", () => {
    withBrandedOrdinary("mcp-mixed-source-capture", (value) => {
        const grade = gradeDocumentTrial(value);
        assert.equal(grade.status, "blocked");
        assert.equal(grade.taskCorrect, null);
        assert.equal(grade.grammarHit, null);
        assert.ok(grade.checks.every((entry) => entry.passed));
        assert.match(grade.errors.join("\n"), /finalized selected trace/);
        assert.doesNotMatch(grade.errors.join("\n"), /callback:null/);
    });
});

test("ordinary enum, status metadata, guessed callbacks and loose flags cannot certify bypass or a cache hit", () => {
    const value = ordinaryCandidate();
    value.routeEvidence = { route: "ordinary-copilot" };
    const absent = gradeDocumentTrial(value);
    assert.equal(absent.status, "blocked");
    assert.equal(absent.grammarHit, null);
    for (const mutate of [
        (entry) => {
            entry.routeEvidence.receipt.callback = { verified: true, pid: 200 };
        },
        (entry) => {
            entry.routeEvidence.bypassCandidate = true;
        },
        (entry) => {
            entry.routeEvidence.receipt.control.source.hookName =
                "userPromptSubmitted";
        },
        (entry) => {
            entry.routeEvidence.receipt.hook.commandSource = "native";
        },
        (entry) => {
            entry.routeEvidence.receipt = JSON.stringify(
                entry.routeEvidence.receipt,
            );
        },
    ]) {
        const input = ordinaryCandidate();
        mutate(input);
        assert.equal(gradeDocumentTrial(input).status, "harness-invalid");
    }
    const startup = ordinaryCandidate();
    startup.routeEvidence.receipt.control.source.request = null;
    assertOrdinaryCheckFails(startup, "ordinary-actual-parsed-hook-request");
    const ipc = ordinaryCandidate();
    ipc.routeEvidence.receipt.control.source.component =
        "native-extension-status";
    assertOrdinaryCheckFails(ipc, "ordinary-current-control-binding");
});

test("ordinary control checks reject stale, foreign, copied and wrong-digest receipts against current native fields", () => {
    const cases = [
        [
            "ordinary-current-control-binding",
            (value) => {
                value.routeEvidence.receipt.control.source.owner =
                    "foreign-owner";
            },
        ],
        [
            "ordinary-current-control-binding",
            (value) => {
                value.routeEvidence.receipt.control.configPath =
                    "D:\\foreign\\config.json";
            },
        ],
        [
            "ordinary-current-control-binding",
            (value) => {
                value.routeEvidence.receipt.control.source.expectedMode =
                    "direct";
            },
        ],
        [
            "ordinary-public-control-digest",
            (value) => {
                value.routeEvidence.receipt.control.digest = "0".repeat(64);
            },
        ],
        [
            "ordinary-current-hook-observation-window",
            (value) => {
                value.routeEvidence.receipt.control.source.observedAt =
                    "2026-10-11T00:00:00Z";
            },
        ],
        [
            "ordinary-current-hook-observation-window",
            (value) => {
                value.routeEvidence.receipt.control.source.observedAt =
                    "2026-10-13T00:00:00Z";
            },
        ],
        [
            "ordinary-actual-parsed-hook-request",
            (value) => {
                value.routeEvidence.receipt.control.source.request.timestamp--;
            },
        ],
        [
            "ordinary-actual-parsed-hook-request",
            (value) => {
                value.routeEvidence.receipt.control.source.request.sessionId =
                    "old-session";
            },
        ],
        [
            "ordinary-trusted-current-expectation",
            (value) => {
                value.routeEvidence.receipt.expected.cwd =
                    "D:\\outside\\workspace";
            },
        ],
        [
            "ordinary-owned-native-session",
            (value) => {
                event(value, "session-start").data.sessionId =
                    "new-session-with-copied-old-receipt";
            },
        ],
        [
            "ordinary-trusted-current-expectation",
            (value) => {
                value.routeEvidence.receipt.expected.prompt =
                    "Copied previous prompt.";
            },
        ],
        [
            "ordinary-current-native-trial-window",
            (value) => {
                event(value, "root-turn-end").timestamp =
                    "2026-10-13T00:00:00Z";
            },
        ],
    ];
    for (const [name, mutate] of cases) {
        const value = ordinaryCandidate();
        mutate(value);
        assertOrdinaryCheckFails(value, name);
    }
});

test("ordinary hook/terminal checks reject actual handled1155 shapes, missing hooks and model-only completion", () => {
    const cases = [
        [
            "ordinary-successful-unhandled-hook",
            (value) => {
                event(value, "hook-end").data.output = {
                    handled: true,
                    handledBy: "typeagent",
                    responseContent: "Empty knowledge response.",
                };
            },
        ],
        [
            "ordinary-user-prompt-hook",
            (value) => {
                event(value, "hook-end").data.hookInvocationId =
                    "different-invocation";
            },
        ],
        [
            "ordinary-hook-root-causal-chain",
            (value) => {
                event(value, "root-user").parentId = "unrelated-hook";
            },
        ],
        [
            "ordinary-successful-unhandled-hook",
            (value) => {
                event(value, "hook-end").data.success = false;
            },
        ],
        [
            "ordinary-user-prompt-hook",
            (value) => {
                value.events = value.events.filter(
                    (entry) => !entry.type.startsWith("hook."),
                );
            },
        ],
        [
            "ordinary-native-root-turn-end",
            (value) => {
                event(value, "root-turn-end").type = "session.idle";
            },
        ],
        [
            "ordinary-native-root-turn-end",
            (value) => {
                event(value, "root-turn-end").data.turnId = 1;
            },
        ],
        [
            "ordinary-native-root-turn-end",
            (value) => {
                value.events.pop();
            },
        ],
        [
            "ordinary-fixture-tool-lifecycle",
            (value) => {
                value.events = value.events.filter(
                    (entry) => !entry.type.startsWith("tool."),
                );
                event(value, "root-answer").parentId = "root-user";
            },
        ],
        [
            "ordinary-fixture-tool-lifecycle",
            (value) => {
                event(value, "lookup-start").data.toolName =
                    "typeagent-processCommand";
                event(value, "lookup-start").data.mcpServerName = "typeagent";
            },
        ],
        [
            "ordinary-fixture-tool-lifecycle",
            (value) => {
                event(value, "fetch-complete").data.success = false;
            },
        ],
        [
            "ordinary-fixture-tool-lifecycle",
            (value) => {
                value.backendAudit[0].timestamp = "2026-10-11T00:00:00Z";
            },
        ],
        [
            "ordinary-no-delegation-or-whole-macro",
            (value) => {
                value.executionEvidence.wholeMacroInvocations = 1;
            },
        ],
        [
            "ordinary-no-delegation-or-whole-macro",
            (value) => {
                event(value, "fetch-start").agentId = "delegated-child";
            },
        ],
    ];
    for (const [name, mutate] of cases) {
        const value = ordinaryCandidate();
        mutate(value);
        assertOrdinaryCheckFails(value, name);
    }
    const pending = ordinaryCandidate();
    event(pending, "root-answer").data.toolRequests = [
        { toolCallId: "pending" },
    ];
    assertOrdinaryCheckFails(pending, "root-answer-without-pending-tools");
});

test("ordinary MCP-mixed selected-source candidates require actual bound armed-to-claimed snapshots", () => {
    const cases = [
        [
            "ordinary-mode-capture-policy",
            (value) => {
                value.routeEvidence.receipt.capture = { policy: "none" };
            },
        ],
        [
            "ordinary-mode-capture-policy",
            (value) => {
                value.routeEvidence.receipt.expected.routing = "delegate";
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.after.state.token.sessionId =
                    "foreign-session";
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.after.state.token.cwd =
                    "D:\\foreign\\workspace";
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.after.state.token.id =
                    "foreign-lease";
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.after.state.token.learning = false;
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.after.state.token.promptHash =
                    "0".repeat(64);
            },
        ],
        [
            "ordinary-selected-source-lease",
            (value) => {
                value.routeEvidence.receipt.capture.before.state.status =
                    "claimed";
            },
        ],
        [
            "ordinary-selected-source-snapshot-window",
            (value) => {
                value.routeEvidence.receipt.capture.after.observedAt =
                    "2026-10-11T00:00:00Z";
            },
        ],
    ];
    for (const [name, mutate] of cases) {
        const value = ordinaryCandidate("mcp-mixed-source-capture");
        mutate(value);
        assertOrdinaryCheckFails(value, name);
    }
});

test("strict document oracle passes grammar and correct fallback independently", () => {
    assert.equal(gradeDocumentTrial(trial()).status, "passed");
    const value = trial();
    value.routeEvidence.route = "miss";
    value.executionEvidence.wholeMacroInvocations = 0;
    const grade = gradeDocumentTrial(value);
    assert.equal(grade.status, "passed");
    assert.equal(grade.taskCorrect, true);
    assert.equal(grade.grammarHit, false);
    value.routeEvidence.route = "unknown";
    assert.equal(gradeDocumentTrial(value).status, "blocked");
    assert.equal(gradeDocumentTrial(value).grammarHit, null);
});

test("native model turns accept causal parentId and matching root turn_end without SDK idle", () => {
    const value = nativeModelTrial();
    assert.equal(gradeDocumentTrial(value).status, "passed");
    value.routeEvidence.route = "miss";
    value.executionEvidence.wholeMacroInvocations = 0;
    assert.equal(gradeDocumentTrial(value).status, "passed");
    assert.ok(value.events.every((entry) => entry.type !== "session.idle"));
    value.events[0].data.turnId = 0;
    value.events[1].data.turnId = 0;
    assert.equal(gradeDocumentTrial(value).status, "passed");
});

test("native root classification rejects child agentId and wrong, missing, or unrelated turn completion", () => {
    for (const mutate of [
        (value) => {
            value.events[0].agentId = "child";
        },
        (value) => {
            value.events[1].agentId = "child";
        },
        (value) => {
            value.events[1].data.parentToolCallId = "child-tool";
        },
        (value) => {
            value.events[1].data.turnId = "different-turn";
        },
        (value) => {
            value.events[1].parentId = "different-answer";
        },
        (value) => {
            value.events[0].data.toolRequests = [{ toolCallId: "pending" }];
        },
        (value) => {
            value.events[0].data.toolRequests = null;
        },
        (value) => {
            value.events.splice(1, 0, {
                type: "user.message",
                data: { content: "Next unrelated task." },
            });
        },
        (value) => {
            value.events.pop();
        },
    ]) {
        const value = nativeModelTrial();
        mutate(value);
        assert.equal(gradeDocumentTrial(value).status, "failed");
    }
});

test("obsolete completed host child and phase report cannot certify checked-program execution", () => {
    const value = nativeHostTrial();
    assert.equal(gradeDocumentTrial(value).status, "failed");
    assert.ok(value.events.every((entry) => entry.type !== "session.idle"));
    assert.ok(value.events.at(-1).parentId);
});

test("obsolete host evidence stays rejected even when identities, phases or completion are changed", () => {
    const mutations = [
        (value) => {
            value.events[2].data.content = "A different child answer.";
        },
        (value) => {
            value.events[2].agentId = "other-child";
        },
        (value) => {
            value.events[2].data.parentToolCallId = "other-tool";
        },
        (value) => {
            value.events[2].data.toolRequests = [
                { toolCallId: "pending-child-tool" },
            ];
        },
        (value) => {
            value.events[3].data.turnId = "wrong-turn";
        },
        (value) => {
            value.events[4].data.toolCallId = "other-tool";
        },
        (value) => {
            value.events[4].data.cancelled = true;
        },
        (value) => {
            value.events[4].type = "subagent.failed";
        },
        (value) => {
            value.events[5].parentId = "unrelated-completion";
        },
        (value) => {
            value.events[5].data.message = "{invalid phase JSON";
        },
        (value) => {
            value.events[5].data.message = JSON.stringify({
                kind: "typeagent-macro-phases",
                phases: [],
            });
        },
        (value) => {
            value.events[8].data.interactionId = "other-interaction";
        },
        (value) => {
            value.routeEvidence.version = 3;
        },
        (value) => {
            value.routeEvidence.macroId = "different-approved-macro";
        },
        (value) => {
            value.events.splice(4, 1);
        },
        (value) => {
            value.events.splice(5, 1);
            value.events.push({ type: "session.idle", data: {} });
        },
        (value) => {
            value.events.push({
                type: "session.error",
                data: { message: "Failure" },
            });
        },
        (value) => {
            value.events.push({
                type: "tool.execution_complete",
                data: { success: false },
            });
        },
        (value) => {
            value.events.splice(8, 0, {
                id: "older-root-answer",
                parentId: "root-user",
                type: "assistant.message",
                data: { content: "A prior task's answer." },
            });
            value.events.at(-1).parentId = "older-root-answer";
        },
    ];
    for (const mutate of mutations) {
        const value = nativeHostTrial();
        mutate(value);
        assert.equal(gradeDocumentTrial(value).status, "failed");
    }
    for (const mutateReport of [
        (report) => {
            report.phases[1].phase = "host.unvalidated";
        },
        (report) => {
            report.phases[2].elapsedMs = -1;
        },
        (report) => {
            report.phases[0] = null;
        },
        (report) => {
            report.phases.pop();
        },
        (report) => {
            report.phases.push({ phase: "subagent.failed", elapsedMs: 10 });
        },
        (report) => {
            report.phases.push({ phase: "subagent.completed", elapsedMs: 10 });
        },
    ]) {
        const value = nativeHostTrial();
        const report = JSON.parse(value.events[5].data.message);
        mutateReport(report);
        value.events[5].data.message = JSON.stringify(report);
        assert.equal(gradeDocumentTrial(value).status, "failed");
    }
});

test("wrong binding, speculative/captured fetch, partial content and incomplete native completion fail", () => {
    const mutations = [
        (value) => {
            value.backendAudit.reverse();
        },
        (value) => {
            value.backendAudit[1].id = "doc-vega";
        },
        (value) => {
            value.backendAudit[0].returnedId = "synthetic-doc-orion";
        },
        (value) => {
            value.backendAudit[0].title = "Orion release readiness checklist";
        },
        (value) => {
            value.backendAudit.unshift({
                timestamp,
                operation: "fetch_document",
                id: "doc-orion",
            });
        },
        (value) => {
            value.answer = `${document.title}\nVEGA-DEPLOY-23\nVEGA-CHECK-58`;
            value.events[0].data.content = value.answer;
        },
        (value) => {
            value.answer = "Successfully fetched the document.";
            value.events[0].data.content = value.answer;
        },
        (value) => {
            value.events.pop();
        },
        (value) => {
            value.events[0].data.parentToolCallId = "child";
        },
        (value) => {
            value.events.push({ type: "session.error" });
        },
        (value) => {
            value.executionEvidence.wholeMacroInvocations = 0;
        },
        (value) => {
            value.executionEvidence.effects.push("send-mail");
        },
        (value) => {
            value.backendAudit[1].timestamp = "2026-10-11T23:59:59.000Z";
        },
    ];
    for (const mutate of mutations) {
        const value = trial();
        mutate(value);
        const grade = gradeDocumentTrial(value);
        assert.equal(grade.status, "failed");
        assert.equal(grade.taskCorrect, false);
        assert.ok(grade.errors.length > 0);
    }
});

test("missing or unsupported required evidence is harness-invalid, not zero-call success", () => {
    for (const value of [undefined, null, {}, { scenario: [] }])
        assert.equal(gradeDocumentTrial(value).status, "harness-invalid");
    for (const field of [
        "backendAudit",
        "events",
        "answer",
        "executionEvidence",
        "routeEvidence",
        "documents",
    ]) {
        const value = trial();
        delete value[field];
        const grade = gradeDocumentTrial(value);
        assert.equal(grade.status, "harness-invalid", field);
        assert.equal(grade.taskCorrect, null);
    }
    for (const mutate of [
        (value) => {
            value.events = [];
        },
        (value) => {
            value.events = [{ event: "assistant.message" }];
        },
        (value) => {
            value.routeEvidence = { grammarHit: true };
        },
        (value) => {
            delete value.executionEvidence.effects;
        },
        (value) => {
            value.scenario.forbiddenEffects = "send-mail";
        },
        (value) => {
            value.scenario.status = "accepted";
        },
        (value) => {
            value.executionEvidence.wholeMacroInvocations = -1;
        },
        (value) => {
            delete value.backendAudit[0].timestamp;
        },
        (value) => {
            delete value.backendAudit[0].returnedId;
        },
        (value) => {
            delete value.backendAudit[1].id;
        },
        (value) => {
            value.documents[0] = { key: "vega" };
        },
        (value) => {
            value.documents.push({ ...document, key: "alias" });
        },
    ]) {
        const value = trial();
        mutate(value);
        assert.equal(gradeDocumentTrial(value).status, "harness-invalid");
    }
});

test("negative oracle enforces actual zero macro invocations and forbidden effects, allowing alternative reads", () => {
    const value = negativeTrial();
    assert.equal(gradeDocumentTrial(value).status, "passed");
    value.executionEvidence.wholeMacroInvocations = 1;
    assert.equal(gradeDocumentTrial(value).status, "failed");
    value.executionEvidence.wholeMacroInvocations = 0;
    value.executionEvidence.effects = ["send-mail"];
    assert.equal(gradeDocumentTrial(value).status, "failed");
    value.executionEvidence.effects = [];
    value.backendAudit.push({ timestamp, operation: "rename_document" });
    assert.equal(gradeDocumentTrial(value).status, "failed");
    delete value.executionEvidence;
    assert.equal(gradeDocumentTrial(value).status, "harness-invalid");
});

test("list-only and do-not-fetch negatives reject alternative fetch with zero macro invocations, but allow lookup", () => {
    for (const id of ["doc-negative-01", "doc-negative-02"]) {
        const value = negativeTrial();
        value.scenario.id = id;
        value.scenario.forbiddenEffects = ["fetch-document"];
        value.backendAudit = value.backendAudit.slice(0, 1);
        value.answer = `Matching title found: ${document.title}.`;
        value.events[0].data.content = value.answer;
        assert.equal(
            gradeDocumentTrial(value).status,
            "passed",
            `${id}: lookup-only`,
        );
        value.backendAudit.push({
            timestamp,
            operation: "fetch_document",
            id: document.expectedId,
        });
        const grade = gradeDocumentTrial(value);
        assert.equal(value.executionEvidence.wholeMacroInvocations, 0);
        assert.deepEqual(value.executionEvidence.effects, []);
        assert.equal(
            grade.status,
            "failed",
            `${id}: alternative backend fetch`,
        );
        assert.equal(grade.taskCorrect, false);
        assert.equal(grade.grammarHit, false);
        assert.equal(
            grade.checks.find(
                (check) => check.name === "forbidden-effect:fetch-document",
            ).passed,
            false,
        );
    }
});

test("clarification requires no guessed document and no task calls, not a generic refusal", () => {
    const value = negativeTrial();
    value.scenario.expectedBehavior = "clarify-without-guessed-title";
    value.backendAudit = [];
    value.answer = "Which exact document title should I look up?";
    value.events[0].data.content = value.answer;
    assert.equal(gradeDocumentTrial(value).status, "passed");
    value.answer = `Which document: ${document.title}?`;
    value.events[0].data.content = value.answer;
    assert.equal(gradeDocumentTrial(value).status, "failed");
    value.answer = "I cannot do that.";
    value.events[0].data.content = value.answer;
    assert.equal(gradeDocumentTrial(value).status, "failed");
});

test("unsupported family, conversation, behavior or pending oracle is blocked without acceptance", () => {
    for (const mutate of [
        (value) => {
            value.scenario.familyId = "file-read-copy";
        },
        (value) => {
            value.scenario.kind = "conversation";
        },
        (value) => {
            value.scenario.expectedBehavior = "cancel-in-flight";
        },
        (value) => {
            value.scenario.status = "pending";
        },
    ]) {
        const value = trial();
        mutate(value);
        const grade = gradeDocumentTrial(value);
        assert.equal(grade.status, "blocked");
        assert.equal(grade.taskCorrect, null);
        assert.equal(grade.grammarHit, null);
    }
});
