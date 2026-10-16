// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
    collectPluginProgramBinding,
    extractNativeEvidence,
} from "../macro-eval-program.mjs";
import { gradeDocumentTrial } from "../macro-eval-grade.mjs";
import { macroProtocolVersion } from "../macro-eval-plan.mjs";
import {
    createNativeBudget,
    validateNativeConfig,
    runNativeEvaluation,
} from "../macro-eval-native.mjs";
import { programFixture } from "./program-fixture.mjs";

const timestamp = "2026-10-16T00:00:00.000Z";
const document = {
    key: "alpha",
    title: "Alpha",
    expectedId: "synthetic-doc-alpha",
    content: "Alpha\nFRESH-CURRENT-CONTENT",
};

function trial(route = "grammar") {
    const fixture = programFixture(document, timestamp);
    const invocation = fixture.event;
    const events = [];
    if (route === "explicit-mcp") {
        events.push({
            id: "mcp-start",
            timestamp,
            type: "tool.execution_start",
            data: {
                toolCallId: "mcp-current",
                toolName: "typeagent-macros-run_macro",
                arguments: {
                    macroId: fixture.run.macroId,
                    version: fixture.run.version,
                },
            },
        });
        invocation.type = "tool.execution_complete";
        invocation.data = {
            toolCallId: "mcp-current",
            success: true,
            result: {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(fixture.evidence.response),
                    },
                ],
            },
        };
    }
    events.push(
        invocation,
        {
            id: "root-answer",
            parentId: invocation.id,
            timestamp,
            type: "assistant.message",
            data: { content: document.content, turnId: 0 },
        },
        {
            id: "root-end",
            parentId: "root-answer",
            timestamp,
            type: "assistant.turn_end",
            data: { turnId: 0 },
        },
    );
    const audit = [
        {
            timestamp,
            operation: "lookup_document",
            title: document.title,
            returnedId: document.expectedId,
        },
        { timestamp, operation: "fetch_document", id: document.expectedId },
    ];
    return {
        ...extractNativeEvidence(events, audit, fixture.evidence),
        documents: [document],
        scenario: {
            id: "read",
            kind: "positive",
            familyId: "exact-document-lookup-fetch",
            expectedDocument: document.key,
        },
    };
}

test("actual grammar and explicit MCP results certify the same program without conflating routes", () => {
    const grammar = gradeDocumentTrial(trial());
    assert.equal(grammar.status, "passed", JSON.stringify(grammar));
    assert.equal(grammar.grammarHit, true);
    const mcp = gradeDocumentTrial(trial("explicit-mcp"));
    assert.equal(mcp.status, "passed", JSON.stringify(mcp));
    assert.equal(mcp.grammarHit, false);
    assert.equal(mcp.explicitMcpReuse, true);
});

test("program identity, immutable revision, reconciliation, scope, acceptance, freshness and read dispatch are mandatory", () => {
    const mutations = [
        (v) => {
            delete v.programEvidence;
        },
        (v) => {
            v.programEvidence.owner = "typeagent";
        },
        (v) => {
            v.programEvidence.eventId = "unobserved-completion";
        },
        (v) => {
            v.routeEvidence.runId = "prior-run";
        },
        (v) => {
            v.routeEvidence.macroId = "other-macro";
        },
        (v) => {
            v.routeEvidence.version++;
        },
        (v) => {
            v.programEvidence.macro.program.revision = "stale-revision";
        },
        (v) => {
            v.programEvidence.macro.program.recipeId = "other-program";
        },
        (v) => {
            v.programEvidence.macro.state = "draft";
        },
        (v) => {
            v.programEvidence.expected.runId = "prior-run";
        },
        (v) => {
            v.programEvidence.reconciledRun.status = "running";
        },
        (v) => {
            v.programEvidence.registration.sessionId = "other-session";
        },
        (v) => {
            v.programEvidence.registration.workspaceId = "other-workspace";
        },
        (v) => {
            v.programEvidence.registration.profileId = "other-profile";
        },
        (v) => {
            v.programEvidence.response.run.program.accepted = false;
        },
        (v) => {
            v.programEvidence.response.run.program.fallback = "planner";
        },
        (v) => {
            v.programEvidence.response.run.program.status =
                "execution_uncertain";
        },
        (v) => {
            v.programEvidence.expected.startedAt = "2026-10-17T00:00:00.000Z";
        },
        (v) => {
            v.backendAudit[1].timestamp = "2026-10-15T00:00:00.000Z";
        },
        (v) => {
            v.programEvidence.response.run.program.output =
                "old cached content";
        },
        (v) => {
            v.programEvidence.response.run.program.checkpoints[0].phase =
                "dispatched";
        },
        (v) => {
            v.programEvidence.response.run.program.checkpoints[1].phase =
                "uncertain";
        },
        (v) => {
            v.programEvidence.response.run.program.checkpoints[0].effect =
                "write";
        },
        (v) => {
            v.programEvidence.response.run.program.checkpoints[0].capabilityId =
                "unknown";
        },
        (v) => {
            v.programEvidence.response.run.program.checkpoints.reverse();
        },
        (v) => {
            v.programEvidence.response.run.program.completedCallIds.pop();
        },
        (v) => {
            v.executionEvidence.wholeMacroInvocations = 2;
        },
        (v) => {
            v.events.pop();
        },
        (v) => {
            v.events.push({
                type: "subagent.started",
                data: { agentName: "typeagent:typeagent-macro-runner-host" },
            });
        },
        (v) => {
            v.protocolVersion = "macro-native-eval-v1";
        },
    ];
    for (const [index, mutate] of mutations.entries()) {
        const value = trial();
        mutate(value);
        assert.notEqual(
            gradeDocumentTrial(value).status,
            "passed",
            `mutation ${index}`,
        );
    }
});

test("restricted author/verifier children are not counted as execution-planner invocations", () => {
    const value = trial();
    value.events.unshift({
        type: "subagent.started",
        agentId: "author",
        data: { agentName: "typeagent-macro-author" },
    });
    assert.equal(gradeDocumentTrial(value).status, "passed");
});

test("root structured run envelope is unwrapped only when it equals the actual current response", () => {
    const value = trial();
    value.answer = JSON.stringify(value.programEvidence.response);
    value.events[1].data.content = value.answer;
    assert.equal(gradeDocumentTrial(value).status, "passed");
    value.programEvidence.response.run.program.output = "stale-output";
    assert.notEqual(gradeDocumentTrial(value).status, "passed");
});

test("unrelated root turns and mismatched explicit MCP call identities never borrow a program result", () => {
    const value = trial();
    value.events[1].parentId = "unrelated-task";
    assert.equal(gradeDocumentTrial(value).status, "failed");
    for (const mutate of [
        (v) => {
            v.events[0].data.toolCallId = "unrelated-call";
        },
        (v) => {
            v.events[0].data.arguments.macroId = "different-macro";
        },
        (v) => {
            v.events[0].data.arguments.version++;
        },
        (v) => {
            v.events[1].agentId = "child-only";
        },
        (v) => {
            v.events.push(structuredClone(v.events[0]));
        },
    ]) {
        const current = trial("explicit-mcp");
        mutate(current);
        assert.notEqual(gradeDocumentTrial(current).status, "passed");
    }
});

test("collector resolves the actual plugin session/scope and reconciles only current local run/version APIs", async () => {
    const fixture = programFixture(document, timestamp);
    const calls = [];
    const options = {
        workspace: "D:\\synthetic\\workspace",
        profileId: "synthetic-profile",
        sessionId: "synthetic-session",
        runId: fixture.run.runId,
        startedAt: timestamp,
        endedAt: timestamp,
    };
    const host = {
        resolveLocalRecipeWorkspace: async (sessionId) => {
            assert.equal(sessionId, options.sessionId);
            return options.workspace;
        },
        localRecipeScope: (workspace) => ({
            workspaceId: workspace.toLowerCase(),
            profileId: options.profileId,
        }),
        localRecipeDirectory: () =>
            "D:\\synthetic\\plugin-config\\recipes\\actual-scope-digest",
        callLocalRecipe: async (workspace, sessionId, method, args) => {
            calls.push({ workspace, sessionId, method, args });
            return method === "getMacroRun"
                ? fixture.run
                : fixture.evidence.macro;
        },
    };
    const binding = await collectPluginProgramBinding(
        options,
        async () => host,
    );
    assert.deepEqual(
        calls.map((call) => call.method),
        ["getMacroRun", "inspectMacro"],
    );
    assert.deepEqual(calls[1].args, [
        { macroId: fixture.run.macroId, version: fixture.run.version },
    ]);
    assert.equal(
        binding.registration.catalogDirectory,
        host.localRecipeDirectory(),
    );
    assert.equal(binding.expected.sessionId, options.sessionId);
    assert.equal(JSON.stringify(binding).includes("token"), false);
    await assert.rejects(
        collectPluginProgramBinding(
            { ...options, profileId: "foreign-profile" },
            async () => host,
        ),
        /registration/u,
    );
    await assert.rejects(
        collectPluginProgramBinding(options, async () => ({
            ...host,
            resolveLocalRecipeWorkspace: async () => "D:\\foreign\\workspace",
        })),
        /registration/u,
    );
    await assert.rejects(
        collectPluginProgramBinding(options, async () => ({
            ...host,
            callLocalRecipe: async () => undefined,
        })),
        /reconciled/u,
    );
    await assert.rejects(
        collectPluginProgramBinding(
            { ...options, sessionId: "" },
            async () => host,
        ),
        /identity/u,
    );
});

const config = {
    protocolVersion: macroProtocolVersion,
    scope: "synthetic-only",
    workspace: "D:\\synthetic\\workspace",
    profileId: "synthetic-profile",
    sessionId: "actual-native-session",
    rootModel: "explicit-root-model",
    maxTargetModelTurns: 10,
    maxDurationMs: 60000,
    executionPath: "grammar",
};

test("native configuration defaults to plugin; supports off and distinct explicit MCP; rejects obsolete live configuration", () => {
    assert.equal(validateNativeConfig(config).recipeOwner, "plugin");
    assert.equal(
        validateNativeConfig({ ...config, recipeOwner: "off" }).recipeOwner,
        "off",
    );
    assert.equal(
        validateNativeConfig({ ...config, executionPath: "explicit-mcp" })
            .executionPath,
        "explicit-mcp",
    );
    for (const change of [
        { protocolVersion: "macro-native-eval-v1" },
        { recipeOwner: "typeagent" },
        { runnerModel: "gpt-6-luna" },
        { approvedCatalog: {} },
        { executionPath: "direct" },
        { scope: "corporate-data" },
        { maxDurationMs: 0 },
        { maxTargetModelTurns: 0 },
        { sessionId: "" },
        { profileId: "" },
        { workspace: "relative" },
        { recipeOwner: "off", executionPath: "explicit-mcp" },
    ])
        assert.throws(() => validateNativeConfig({ ...config, ...change }));
});

test("native live opt-in cannot bypass exact synthetic campaign authorization", async () => {
    await assert.rejects(
        runNativeEvaluation({ config, executeLive: true }),
        /authorization/u,
    );
});

test("offline preflight persists an unexecuted report without creating session registration or a catalog", async (t) => {
    const directory = fs.mkdtempSync(path.resolve("eval-program-preflight-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const output = path.join(directory, "preflight");
    const result = await runNativeEvaluation({ config, output });
    assert.equal(result.status, "unexecuted");
    assert.equal(result.admission, false);
    assert.deepEqual(fs.readdirSync(output), ["report.json"]);
    assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(output, "report.json"), "utf8")),
        result,
    );
    await assert.rejects(runNativeEvaluation({ config, output }), /EEXIST/u);
});

test("offline budgets deduplicate actual turns and bound child/root spend, cancellation and deadlines", () => {
    let now = 0;
    const abort = new AbortController();
    const budget = createNativeBudget(
        { maxDurationMs: 100, maxTargetModelTurns: 1 },
        abort.signal,
        () => now,
    );
    const turn = { id: "root-turn", type: "assistant.turn_start" };
    budget.check([turn, turn]);
    assert.equal(budget.used(), 1);
    assert.throws(
        () =>
            budget.check([
                {
                    id: "child-turn",
                    agentId: "author",
                    type: "assistant.turn_start",
                },
            ]),
        /turn bound/u,
    );
    const deadline = createNativeBudget(
        { maxDurationMs: 100, maxTargetModelTurns: 2 },
        abort.signal,
        () => now,
    );
    now = 100;
    assert.throws(() => deadline.check(), /deadline/u);
    abort.abort();
    assert.throws(() => deadline.check(), /cancelled/u);
});
