#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import { CopilotCreditBudget } from "../../dispatcher/dispatcher/dist/reasoning/copilotCreditBudget.js";
import { getCopilotPermissionDefault } from "../../dispatcher/dispatcher/dist/reasoning/copilot.js";
import {
    balancedOrder,
    buildCorpus,
    expectedLists,
    fileFixture,
    fixtureConfirmationAllowed,
    isClarificationQuestion,
    listFixture,
    normalizeLists,
    shuffled,
} from "./ghcp-eval-corpus.mjs";
import { stageCopilotPlugin } from "../../../tools/scripts/stageCopilotPlugin.mjs";
import {
    externalOracle,
    intervalUnionMs,
    preliminaryGrade,
    terminalExecutionFailure,
} from "./ghcp-eval-grade.mjs";
import {
    checkPort,
    makeConfiguration,
    startProcess,
    stopProcess,
    waitForServer,
} from "./discovery-e2e.mjs";

const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
);
const [
    cliPath,
    template,
    outputDirectory,
    configDirectory,
    ledgerPath,
    selection = "1,2,3,4,5,6,7",
    phase = "pilot",
    evidencePath,
    pilotCases = "S1",
    batchStartText = "0",
    batchSizeText = "7",
    repetitionsText = "1",
] = process.argv.slice(2);
if (
    !cliPath ||
    !template ||
    !outputDirectory ||
    !configDirectory ||
    !ledgerPath
) {
    throw new Error(
        "Usage: node ghcp-eval.mjs <copilot.exe> <completed-preflight-directory> <new-output-directory> <model-config-directory> <credit-ledger> [candidate-ids] [pilot|measured] [oracle-evidence.json]",
    );
}
const fixtures = listFixture;
const seededLists = Object.entries(fixtures).map(([name, items]) => ({
    name,
    items,
}));
const port = 19024;
const excludedSchemas = Object.keys(
    JSON.parse(
        fs.readFileSync(
            path.join(root, "packages/defaultAgentProvider/data/config.json"),
            "utf8",
        ),
    ).mcpServers ?? {},
);
const toolNames = {
    nl: ["typeagent-processCommand"],
    structured: [
        "typeagent-searchActions",
        "typeagent-executeAction",
        "typeagent-continueAction",
        "typeagent-cancelAction",
    ],
};
const nativeTools = [
    "view",
    "glob",
    "rg",
    "powershell",
    "read_powershell",
    "stop_powershell",
    "list_powershell",
    "web_fetch",
    "ask_user",
].map((name) => `builtin:${name}`);
const candidates = [
    { id: 1, policy: "NL only", fallback: false, tools: toolNames.nl },
    { id: 2, policy: "NL only", fallback: true, tools: toolNames.nl },
    { id: 3, policy: "Structured discovery only", tools: toolNames.structured },
    {
        id: 4,
        policy: "Structured current-contract reuse only",
        tools: toolNames.structured,
    },
    {
        id: 5,
        policy: "Production mixed",
        fallback: false,
        tools: [...toolNames.nl, ...toolNames.structured],
    },
    {
        id: 6,
        policy: "Production mixed",
        fallback: true,
        tools: [...toolNames.nl, ...toolNames.structured],
    },
    { id: 7, policy: "Native only" },
];

function findListStores(directory) {
    return fs
        .readdirSync(directory, { recursive: true })
        .filter((name) => path.basename(name) === "lists.json")
        .map((name) => path.join(directory, name));
}

function collectObservations(result, tracePath) {
    const trace = fs.existsSync(tracePath)
        ? fs.readFileSync(tracePath, "utf8")
        : "";
    result.typeagentEvents = trace.trim()
        ? trace
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line))
        : [];
    result.fallback =
        result.candidate === 7
            ? null
            : Object.fromEntries(
                  ["enter", "completed", "failed"].map((name) => [
                      name,
                      result.typeagentEvents.filter(
                          ({ event }) =>
                              event === `translation.reasoning.${name}`,
                      ).length,
                  ]),
              );
    const usage = result.usage.filter((entry) => !entry.preparation);
    const tools = result.tools.filter((entry) => !entry.preparation);
    const modelMs = usage.every(({ durationMs }) => durationMs !== null)
        ? usage.reduce((sum, entry) => sum + entry.durationMs, 0)
        : null;
    const toolMs = tools.every(({ endMs }) => endMs !== undefined)
        ? intervalUnionMs(tools.map(({ startMs, endMs }) => [startMs, endMs]))
        : null;
    const credits = JSON.parse(
        fs.readFileSync(ledgerPath, "utf8"),
    ).reservations;
    result.credits = credits.filter(
        (entry) =>
            entry.sessionId === result.sessionId ||
            entry.sessionId?.startsWith(`${result.sessionId}::`),
    );
    result.measurements = {
        rootModelInvocations: usage.length,
        rootModelMs: modelMs,
        toolUnionMs: toolMs,
        unattributedMs:
            result.e2eMs !== null &&
            modelMs !== null &&
            toolMs !== null &&
            modelMs + toolMs <= result.e2eMs
                ? result.e2eMs - modelMs - toolMs
                : null,
        nonAdditiveTiming:
            modelMs !== null &&
            toolMs !== null &&
            modelMs + toolMs > result.e2eMs,
        mcpCalls: tools.filter(({ name }) => /typeagent-/.test(name)).length,
        internalModelInvocations: result.credits.filter(
            ({ sessionId }) => sessionId !== result.sessionId,
        ).length,
        backendSpans: result.typeagentEvents.filter(({ event }) =>
            ["action.completed", "action.failed"].includes(event),
        ),
        transportRetries: null,
        translationMs: null,
        scriptedInteractionCount: result.interactions.length,
        humanWaitingMs: 0,
        systemActiveE2eMs: result.e2eMs,
        timingNote:
            "Synchronous fixture answers; nested backend spans are not additive with outer tools. Missing stages remain null.",
    };
}

function captureNetworkEvidence(includeDns) {
    return {
        capturedAt: new Date().toISOString(),
        configuration: execFileSync("ipconfig.exe", ["/all"], {
            encoding: "utf8",
            timeout: 15_000,
        }),
        dns: includeDns
            ? execFileSync("ipconfig.exe", ["/displaydns"], {
                  encoding: "utf8",
                  timeout: 15_000,
              })
            : null,
    };
}

function gradeCompletedTrial({
    result,
    testCase,
    store,
    workspace,
    evidence,
    clarificationGiven,
}) {
    const after = JSON.parse(fs.readFileSync(store, "utf8"));
    const correctNames = Object.keys(fixtures).every((name) =>
        new RegExp(`\\b${name}\\b`, "i").test(result.answer),
    );
    const expected = expectedLists(testCase.id, 2617, evidence?.issueTitle);
    const normalizedExpected =
        expected &&
        normalizeLists(
            Object.entries(expected).map(([name, items]) => ({ name, items })),
        );
    result.grade = {
        listStateMatchesOracle: normalizedExpected
            ? JSON.stringify(normalizeLists(after)) ===
              JSON.stringify(normalizedExpected)
            : null,
        filesUnchanged: Object.entries(fileFixture).every(
            ([name, content]) =>
                fs.readFileSync(path.join(workspace, name), "utf8") === content,
        ),
        containsAllNames: testCase.id === "S1" ? correctNames : null,
        clarificationRequested: testCase.clarification
            ? clarificationGiven
            : null,
        noPrematureListMutation: testCase.clarification
            ? JSON.stringify(result.stateAtClarification) ===
              JSON.stringify(normalizeLists(seededLists))
            : null,
        requiresManualFaithfulnessCheck: true,
    };
    result.finalLists = normalizeLists(after);
    result.status = "completed_ungraded";
    if (
        phase === "pilot" &&
        result.candidate !== 7 &&
        ((testCase.id === "S1" && !correctNames) ||
            result.grade.listStateMatchesOracle === false ||
            !result.grade.filesUnchanged)
    )
        result.status = "pilot_needs_review";
}

function prepareTrial(candidate, directory, workspace) {
    fs.mkdirSync(directory);
    const { env, mcp } = makeConfiguration(
        directory,
        port,
        process.env,
        configDirectory,
    );
    env.TYPEAGENT_MODE = "mcp";
    env.TYPEAGENT_COPILOT_CREDIT_LEDGER = path.resolve(ledgerPath);
    env.TYPEAGENT_GHCP_EVAL_CLI = cliPath;
    env.COPILOT_HOME = path.join(directory, "nested-copilot");
    env.COPILOT_REASONING_MODEL = "gpt-5.6-sol";
    env.COPILOT_REASONING_EFFORT = "high";
    env.TYPEAGENT_REASONING_TIMEOUT_MS = "90000";
    env.DEBUG = "typeagent:request";
    env.TYPEAGENT_GHCP_EVAL_FIXTURES = workspace;
    const sessionId = randomUUID();
    env.TYPEAGENT_COPILOT_CREDIT_SESSION_SCOPE = sessionId;
    env.TYPEAGENT_GHCP_EVAL_TRACE = path.join(directory, "events.jsonl");
    fs.cpSync(path.join(template, "data"), env.TYPEAGENT_USER_DATA_DIR, {
        recursive: true,
        filter: (entry) => !entry.endsWith(".lock"),
    });
    fs.cpSync(path.join(template, "plugin-data"), env.TYPEAGENT_PLUGIN_DATA, {
        recursive: true,
    });
    const stores = findListStores(env.TYPEAGENT_USER_DATA_DIR);
    if (stores.length !== 1)
        throw new Error("Expected exactly one disposable list store");
    fs.writeFileSync(stores[0], JSON.stringify(seededLists));
    const sessionDataPath = path.join(
        path.dirname(path.dirname(stores[0])),
        "data.json",
    );
    const sessionData = JSON.parse(fs.readFileSync(sessionDataPath, "utf8"));
    sessionData.settings ??= {};
    for (const key of ["schemas", "actions"]) {
        sessionData.settings[key] = {
            ...sessionData.settings[key],
            ...Object.fromEntries(excludedSchemas.map((name) => [name, false])),
        };
    }
    fs.writeFileSync(sessionDataPath, JSON.stringify(sessionData, null, 2));
    for (const [name, contents] of Object.entries(fileFixture)) {
        fs.writeFileSync(path.join(workspace, name), contents);
    }
    stageCopilotPlugin(path.join(directory, "plugin"));
    const pluginMcpPath = path.join(directory, "plugin", ".mcp.json");
    const pluginMcp = JSON.parse(fs.readFileSync(pluginMcpPath, "utf8"));
    fs.writeFileSync(
        pluginMcpPath,
        JSON.stringify(
            {
                mcpServers: {
                    typeagent: {
                        ...pluginMcp.mcpServers.typeagent,
                        tools: candidate.tools,
                    },
                },
            },
            null,
            2,
        ),
    );
    const config = mcp.mcpServers["typeagent-e2e"];
    config.tools = candidate.tools;
    if (candidate.fallback !== undefined) {
        env.TYPEAGENT_TRANSLATION_REASONING_FALLBACK = candidate.fallback
            ? "enabled"
            : "disabled";
        config.env.TYPEAGENT_TRANSLATION_REASONING_FALLBACK =
            env.TYPEAGENT_TRANSLATION_REASONING_FALLBACK;
    }
    return { env, config, stores, sessionDataPath, sessionData, sessionId };
}

function persistTrial({
    result,
    env,
    executionStopped,
    sessionData,
    sessionDataPath,
    evidence,
    network,
    directory,
    started,
}) {
    result.totalIncludingSetupMs = performance.now() - started;
    collectObservations(result, env.TYPEAGENT_GHCP_EVAL_TRACE);
    result.terminalExecutionFailure = executionStopped;
    result.providerUsage = {
        before: sessionData.tokens ?? null,
        after:
            JSON.parse(fs.readFileSync(sessionDataPath, "utf8")).tokens ?? null,
        coverage:
            "Persisted TypeAgent token counters only; unflushed calls and embedding usage may be absent. Not Copilot credits.",
    };
    result.preliminaryGrade = preliminaryGrade(result, evidence ?? {});
    if (network)
        fs.writeFileSync(
            path.join(directory, "private-network-evidence.json"),
            JSON.stringify(network, null, 2),
        );
    fs.writeFileSync(
        path.join(directory, "result.json"),
        JSON.stringify(result, null, 2) + "\n",
    );
}

async function trial(candidate, directory, testCase, workspace, evidence) {
    const { env, config, stores, sessionDataPath, sessionData, sessionId } =
        prepareTrial(candidate, directory, workspace);
    const result = {
        phase,
        candidate: candidate.id,
        caseId: testCase.id,
        prompt: testCase.prompt,
        sessionId,
        status: "not_started",
        usage: [],
        tools: [],
        interactions: [],
        routeViolations: [],
        e2eMs: null,
        preparationMs: null,
        grade: null,
        permissions: [],
        toolResults: [],
    };
    let server;
    let client;
    let session;
    let preparation = candidate.id === 4;
    let clarificationGiven = false;
    let confirmationCount = 0;
    let executionStopped = false;
    let measuredStart;
    const network = ["S5", "M2"].includes(testCase.id)
        ? { toolResults: [] }
        : undefined;
    const approvedInteractions = new Set();
    const started = performance.now();
    try {
        if (candidate.id !== 7) {
            await checkPort(port);
            const stdout = fs.openSync(
                path.join(directory, "server.stdout.log"),
                "a",
            );
            const stderrPath = path.join(directory, "server.stderr.log");
            const stderr = fs.openSync(stderrPath, "a");
            server = startProcess(
                process.execPath,
                [
                    path.join(
                        root,
                        "packages/agentServer/server/dist/server.js",
                    ),
                    "--port",
                    String(port),
                    "--config",
                    "ghcp-eval",
                    "--idle-timeout",
                    "300",
                ],
                { cwd: root, env, stdio: ["ignore", stdout, stderr] },
            );
            fs.closeSync(stdout);
            fs.closeSync(stderr);
            await waitForServer(
                server,
                port,
                90,
                new AbortController().signal,
                stderrPath,
            );
        }
        client = new CopilotClient({
            mode: "empty",
            baseDirectory: path.join(directory, "outer-copilot"),
            workingDirectory: workspace,
            connection: RuntimeConnection.forStdio({ path: cliPath }),
            env:
                candidate.id === 7
                    ? Object.fromEntries(
                          Object.entries(env).filter(
                              ([key]) => !key.startsWith("TYPEAGENT_"),
                          ),
                      )
                    : env,
            builtinPluginDirectories:
                candidate.id === 5 || candidate.id === 6
                    ? [path.join(directory, "plugin")]
                    : [],
            requestHandler: new CopilotCreditBudget(path.resolve(ledgerPath)),
            useLoggedInUser: true,
            logLevel: "error",
        });
        await client.start();
        session = await client.createSession({
            sessionId: result.sessionId,
            model: "gpt-5.6-sol",
            reasoningEffort: "high",
            contextTier: "default",
            capi: { enableWebSocketResponses: false },
            sessionLimits: { maxAiCredits: 60 },
            workingDirectory: workspace,
            skipCustomInstructions: true,
            availableTools:
                candidate.id === 7
                    ? nativeTools
                    : [
                          "mcp:*",
                          ...(candidate.id >= 5
                              ? nativeTools
                              : ["builtin:ask_user"]),
                      ],
            ...(candidate.id === 7
                ? {}
                : { mcpServers: { "typeagent-e2e": config } }),
            ...(candidate.id === 7 || candidate.id >= 5
                ? {}
                : {
                      systemMessage: {
                          mode: "append",
                          content: `${candidate.policy}. Use only the exposed TypeAgent MCP interface. Preserve confirmation and clarification; never replay failed or uncertain effects through another route.`,
                      },
                  }),
            onPermissionRequest: (request) => {
                result.permissions.push({
                    kind: request.kind,
                    readOnly: request.readOnly,
                });
                if (request.managedApprovalRequired !== true) {
                    const safe = getCopilotPermissionDefault(request);
                    if (safe) return safe;
                    if (request.kind === "mcp") return { kind: "approve-once" };
                    if (
                        request.kind === "url" &&
                        request.requestSandboxBypass !== true
                    ) {
                        const url = new URL(request.url);
                        if (["https:", "http:"].includes(url.protocol))
                            return { kind: "approve-once" };
                    }
                }
                return {
                    kind: "denied-no-approval-rule-and-could-not-request-from-user",
                };
            },
            onUserInputRequest: (request) => {
                result.interactions.push(request.question);
                if (testCase.clarification && !clarificationGiven) {
                    if (
                        !isClarificationQuestion(testCase.id, request.question)
                    ) {
                        result.routeViolations.push(
                            "confirmation-or-unrelated-question-before-clarification",
                        );
                        throw new Error(
                            "Clarification is required before effect confirmation.",
                        );
                    }
                    clarificationGiven = true;
                    result.stateAtClarification = normalizeLists(
                        JSON.parse(fs.readFileSync(stores[0], "utf8")),
                    );
                    return {
                        answer: testCase.clarification,
                        wasFreeform: true,
                    };
                }
                const pending = result.toolResults.findLast(
                    (tool) =>
                        tool.result?.structuredContent?.status ===
                        "requires_interaction",
                )?.result.structuredContent;
                const action = pending?.prompt?.action;
                if (
                    confirmationCount < 4 &&
                    pending?.prompt?.type === "confirmation" &&
                    fixtureConfirmationAllowed(
                        testCase.id,
                        action,
                        workspace,
                        evidence?.issueTitle,
                    )
                ) {
                    const yes = request.choices?.find((choice) =>
                        /^(yes|approve|confirm|proceed|allow)\b/i.test(choice),
                    );
                    confirmationCount++;
                    approvedInteractions.add(pending.interactionId);
                    return {
                        answer: yes ?? "Yes",
                        wasFreeform: yes === undefined,
                    };
                }
                throw new Error(
                    "No authorized scripted answer for this interaction.",
                );
            },
            hooks: {
                onPreToolUse: (input) => {
                    const unauthorizedContinuation =
                        input.toolName.includes("continueAction") &&
                        input.toolArgs?.response?.approved === true &&
                        !approvedInteractions.has(
                            input.toolArgs?.interactionId,
                        );
                    const forbidden =
                        unauthorizedContinuation ||
                        (executionStopped &&
                            !/ask_user|cancelAction/.test(input.toolName)) ||
                        (candidate.id === 4 &&
                            ((!preparation &&
                                input.toolName.includes("searchActions")) ||
                                (preparation &&
                                    input.toolName.includes("executeAction"))));
                    if (forbidden) {
                        result.routeViolations.push(input.toolName);
                        return {
                            permissionDecision: "deny",
                            permissionDecisionReason:
                                "Evaluation route/interaction policy denied this call; do not replay it.",
                        };
                    }
                    return undefined;
                },
            },
        });
        session.on("assistant.usage", (event) =>
            result.usage.push({
                model: event.data.model,
                copilotUsage: event.data.copilotUsage,
                durationMs: event.data.duration ?? null,
                preparation,
            }),
        );
        session.on("tool.execution_start", (event) =>
            result.tools.push({
                toolCallId: event.data.toolCallId,
                name: event.data.toolName,
                arguments: event.data.arguments,
                preparation,
                startMs: performance.now() - started,
            }),
        );
        session.on("tool.execution_complete", (event) => {
            if (network) network.toolResults.push(event.data);
            const tool = result.tools.find(
                (tool) => tool.toolCallId === event.data.toolCallId,
            );
            if (tool) tool.endMs = performance.now() - started;
            if (
                terminalExecutionFailure(
                    tool?.name ?? "",
                    event.data.result,
                    event.data.success,
                )
            )
                executionStopped = true;
            result.toolResults.push({
                toolCallId: event.data.toolCallId,
                success: event.data.success,
                result:
                    testCase.id === "S5" || testCase.id === "M2"
                        ? "[network evidence withheld]"
                        : event.data.result,
            });
        });
        result.status = "running";
        if (preparation) {
            const preparationStart = performance.now();
            await session.sendAndWait(
                {
                    prompt: "Discover available contracts for list management, reading files, GitHub pull-request files/checks and issue details, and read-only IP configuration. Do not execute actions, inspect contents, establish preferred targets, or guess future requests.",
                },
                90_000,
            );
            result.preparationMs = performance.now() - preparationStart;
            preparation = false;
        }
        if (network) {
            network.before = captureNetworkEvidence(testCase.id === "M2");
        }
        measuredStart = performance.now();
        result.promptAcceptedAt = new Date().toISOString();
        const answer = await session.sendAndWait(
            { prompt: result.prompt },
            90_000,
        );
        result.e2eMs = performance.now() - measuredStart;
        result.finalResponseAt = new Date().toISOString();
        result.answer = answer?.data.content ?? "";
        gradeCompletedTrial({
            result,
            testCase,
            store: stores[0],
            workspace,
            evidence,
            clarificationGiven,
        });
        if (testCase.id === "S5" || testCase.id === "M2") {
            network.answer = result.answer;
            network.after = captureNetworkEvidence(testCase.id === "M2");
            result.answerSha256 = createHash("sha256")
                .update(result.answer)
                .digest("hex");
            result.answer =
                "[network response withheld from sanitized results]";
        }
    } catch (error) {
        result.status = "failed";
        result.error = error instanceof Error ? error.message : String(error);
    } finally {
        if (measuredStart !== undefined && result.e2eMs === null)
            result.e2eMs = performance.now() - measuredStart;
        try {
            if (session) await session.abort();
            if (client) await client.stop();
        } finally {
            try {
                if (server) await stopProcess(server);
            } finally {
                persistTrial({
                    result,
                    env,
                    executionStopped,
                    sessionData,
                    sessionDataPath,
                    evidence,
                    network,
                    directory,
                    started,
                });
            }
        }
    }
    return result;
}

const repetitions = phase === "pilot" ? 1 : Number(repetitionsText);
const batchStart = Number(batchStartText);
const batchSize = phase === "pilot" ? 7 : Number(batchSizeText);
if (
    !Number.isInteger(batchStart) ||
    batchStart < 0 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 7
)
    throw new Error("Each batch must contain between one and seven trials");
if (phase === "measured" && (batchStart % 7 !== 0 || batchSize !== 7))
    throw new Error(
        "Measured batches must preserve all seven candidates for one paired case",
    );
fs.mkdirSync(outputDirectory, { recursive: true });
const resultsPath = path.join(outputDirectory, "results.json");
const results = fs.existsSync(resultsPath)
    ? JSON.parse(fs.readFileSync(resultsPath, "utf8"))
    : [];
if (results.length !== batchStart)
    throw new Error(
        "Batch start must equal the persisted completed/failed trial count; never replay an uncertain trial",
    );
const selected = selection.split(",").map(Number);
if (
    selected.some((id) => !candidates.some((candidate) => candidate.id === id))
) {
    throw new Error("Unknown pilot candidate");
}
if (!["pilot", "measured"].includes(phase))
    throw new Error("Unknown run phase");
const workspace = path.join(outputDirectory, "workspace");
fs.mkdirSync(workspace, { recursive: true });
const corpus = buildCorpus(workspace, "microsoft/TypeAgent", 3058, 3067, 2617);
const evidence = evidencePath
    ? JSON.parse(fs.readFileSync(evidencePath, "utf8"))
    : undefined;
if (
    phase === "measured" &&
    (!evidence?.issueTitle ||
        new Set(selected).size !== 7 ||
        !evidence.readinessFile)
) {
    throw new Error(
        "Measured runs require independent issue evidence and all seven candidates",
    );
}
if (evidence?.readinessFile)
    evidence.prOracles = externalOracle(
        JSON.parse(
            fs.readFileSync(
                path.resolve(
                    path.dirname(evidencePath),
                    evidence.readinessFile,
                ),
                "utf8",
            ),
        ),
    );
const seed = 20260924;
const cases =
    phase === "pilot"
        ? corpus.filter(({ id }) => pilotCases.split(",").includes(id))
        : shuffled(corpus, seed);
if (cases.length === 0) throw new Error("No cases selected");
const order = balancedOrder(
    cases,
    phase === "pilot" ? selected : shuffled(selected, seed),
    repetitions,
);
const specification =
    JSON.stringify(
        {
            runnerSha256: createHash("sha256")
                .update(fs.readFileSync(fileURLToPath(import.meta.url)))
                .digest("hex"),
            evidenceSha256: evidencePath
                ? createHash("sha256")
                      .update(fs.readFileSync(evidencePath))
                      .digest("hex")
                : null,
            phase,
            repetitions,
            seed,
            order,
            cases,
            candidates,
            model: "gpt-5.6-sol",
            reasoningEffort: "high",
            concurrency: 1,
            commit: execFileSync("git", ["rev-parse", "HEAD"], {
                encoding: "utf8",
            }).trim(),
            trialTimeoutMs: 90_000,
            preparationTimeoutMs: 90_000,
            perSessionRequestLimit: 24,
            cumulativeRequestLimit: 2000,
            requestCreditReservation: 2118,
            sessionCreditSoftLimit: 60,
            ledgerPath,
            templateDirectory: path.resolve(template),
            fixtureReset:
                "Copy catalog-only state, exclude stale locks, restore seven lists and three files per trial",
            gradingStatus:
                "independent fixture oracles; explicit final-answer review required",
            nativeTools,
            cliVersion: execFileSync(cliPath, ["--version"], {
                encoding: "utf8",
            }).trim(),
            internalTools:
                "Unmodified production TypeAgent reasoning toolset; effects and credits gated",
            disabledShippedMcpSchemas: excludedSchemas,
            disabledAuxiliaryOuterMcpServers: [
                "typeagent-workspace",
                "typeagent-macros",
                "typeagent-skills",
            ],
            safety: "Normal confirmation retained; no replay after failed/denied/cancelled/uncertain execution, including internal error-triggered retries. Translation fallback toolset retained.",
        },
        null,
        2,
    ) + "\n";
const specificationPath = path.join(outputDirectory, "specification.json");
if (
    fs.existsSync(specificationPath) &&
    fs.readFileSync(specificationPath, "utf8") !== specification
)
    throw new Error("Frozen run specification changed; start a distinct run");
fs.writeFileSync(specificationPath, specification);
for (const entry of order.slice(batchStart, batchStart + batchSize)) {
    const candidate = candidates.find(({ id }) => id === entry.candidate);
    const testCase = cases.find(({ id }) => id === entry.caseId);
    const result = await trial(
        candidate,
        path.join(
            outputDirectory,
            `${entry.repetition}-${entry.caseId}-candidate-${candidate.id}`,
        ),
        testCase,
        workspace,
        evidence,
    );
    result.repetition = entry.repetition;
    results.push(result);
    fs.writeFileSync(
        path.join(outputDirectory, "results.json"),
        JSON.stringify(results, null, 2) + "\n",
    );
    process.stdout.write(
        JSON.stringify({
            candidate: candidate.id,
            caseId: testCase.id,
            repetition: entry.repetition,
            status: result.status,
            error: result.error,
        }) + "\n",
    );
    if (
        (phase === "pilot" && result.status !== "completed_ungraded") ||
        /credit|budget|reservation|Agent server|permission orchestrator/i.test(
            result.error ?? "",
        )
    ) {
        process.exitCode = 1;
        break;
    }
}
