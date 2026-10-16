// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { CopilotClient, RuntimeConnection } from "@github/copilot-sdk";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const state = path.join(root, ".macro-author-child-probe-state");

function sanitizedEvent(event) {
    const keys = [
        "content",
        "toolCallId",
        "toolName",
        "arguments",
        "success",
        "result",
        "error",
        "agentName",
        "agentType",
        "executionMode",
        "parentId",
        "cancelled",
        "totalToolCalls",
        "tools",
        "model",
        "modelSelectionSource",
        "multiTurn",
    ];
    return {
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        parentId: event.parentId,
        ...(event.agentId ? { agentId: event.agentId } : {}),
        data: Object.fromEntries(
            keys
                .filter((key) => key in event.data)
                .map((key) => [key, event.data[key]]),
        ),
    };
}

export async function joinedProbe() {
    const { joinSession } = await import("@github/copilot-sdk/extension");
    const { createMacroAuthorChildLauncher } = await import(
        pathToFileURL(path.join(root, "dist/extension/macro-author-child.js"))
            .href
    );
    const { createMacroTaskReceiptTool } = await import(
        pathToFileURL(path.join(root, "dist/extension/macro-task-receipt.js"))
            .href
    );
    const session = await joinSession({
        tools: [
            createMacroTaskReceiptTool(async () => ({
                status: "claimed",
                token: {
                    id: process.env.SYNTHETIC_RECORDING_TOKEN_ID,
                    sessionId: session.sessionId,
                    status: "claimed",
                    learning: true,
                    expiresAt: new Date(Date.now() + 120_000).toISOString(),
                    promptHash: process.env.SYNTHETIC_RECORDING_PROMPT_HASH,
                },
            })),
        ],
        commands: [
            {
                name: "synthetic-author-probe",
                handler: async () => {
                    const launch = createMacroAuthorChildLauncher(session);
                    const events = [];
                    const contextChecks = [];
                    const filterChecks = [];
                    const off = session.on((event) => {
                        filterChecks.push({
                            id: event.id,
                            type: event.type,
                            agentId: event.agentId,
                            authoring: launch.isAuthoringEvent(event),
                        });
                        if (
                            /^(subagent\.|tool\.execution_|session\.task_complete|session\.completion_receipt|session\.error|abort)/.test(
                                event.type,
                            )
                        )
                            events.push(sanitizedEvent(event));
                        if (event.type === "model.messages_snapshot") {
                            const snapshot = JSON.stringify(event.data);
                            contextChecks.push({
                                agentId: event.agentId,
                                keys: Object.keys(event.data),
                                hasChildNonce:
                                    snapshot.includes("CHILD_CONTEXT_4258"),
                                hasParentMarker:
                                    snapshot.includes("PARENT_ONLY_9837"),
                            });
                        }
                    });
                    try {
                        const parentProof = JSON.parse(
                            await readFile(
                                path.join(state, "parent-proof.json"),
                                "utf8",
                            ),
                        );
                        const prompt = JSON.stringify({
                            schemaVersion: 1,
                            requestId: "synthetic-author-request-4258",
                            phase: "extract",
                            recording: parentProof.capture,
                            promptHash: parentProof.promptHash,
                            context: { nonce: "CHILD_CONTEXT_4258" },
                            instructions:
                                "Use only supplied synthetic context. Return JSON with nonce, offeredTools (actual tool names), and parentMarker (if absent, null). Attempt to delegate or read a file only if a tool is actually available; do not invent a call.",
                        });
                        const result = await launch(prompt);
                        const cancellationEvents = [];
                        const controller = new AbortController();
                        const offCancel = session.on((event) => {
                            if (event.type === "subagent.started") {
                                cancellationEvents.push({
                                    id: event.agentId,
                                    type: event.type,
                                });
                                controller.abort();
                            }
                        });
                        let cancellation;
                        try {
                            await launch(
                                "Synthetic cancellation only. Return CANCEL_TEST.",
                                controller.signal,
                            );
                            cancellation = { unexpectedSuccess: true };
                        } catch (error) {
                            cancellation = {
                                code: error.code,
                                events: cancellationEvents,
                            };
                        } finally {
                            offCancel();
                        }
                        await writeFile(
                            path.join(state, "child.json"),
                            JSON.stringify({
                                result,
                                events,
                                contextChecks,
                                filterChecks,
                                cancellation,
                                processes: {
                                    extensionPid: process.pid,
                                    hostPid: process.ppid,
                                },
                            }),
                        );
                    } catch (error) {
                        await writeFile(
                            path.join(state, "child.json"),
                            JSON.stringify({
                                error: error.message,
                                events,
                                contextChecks,
                                filterChecks,
                            }),
                        );
                    } finally {
                        off();
                    }
                },
            },
        ],
    });
}

if (path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [cliPath, reportPath, authenticated] = process.argv.slice(2);
    if (!cliPath || !reportPath)
        throw new Error(
            "Usage: node macro-author-child-probe.mjs <cli.exe> <report.json> [--authenticated]",
        );
    await mkdir(state);
    const fixturePath = path.join(state, "synthetic-read-fixture.txt");
    const fixtureContent = "SYNTHETIC_READ_ONLY_FIXTURE_7319";
    await writeFile(fixturePath, fixtureContent + "\n");
    const recordingTokenId = `synthetic-recording-${randomUUID()}`;
    const originalPrompt =
        `Synthetic selected learning task. Parent-only marker PARENT_ONLY_9837. ` +
        `Read exactly this fixture with view: ${JSON.stringify(fixturePath)}. ` +
        `After the successful read, call typeagent_recorded_task_succeeded exactly once ` +
        `with summary "Synthetic fixture read succeeded.", BEFORE your final answer. ` +
        `Then answer exactly PARENT_DONE:${fixtureContent}. ` +
        `Use no other tools, no delegation, no writes. Do not attest success on failure.`;
    const promptHash = createHash("sha256")
        .update(originalPrompt)
        .digest("hex");
    const plugin = path.join(state, "plugin");
    await mkdir(path.join(plugin, "extensions", "probe"), { recursive: true });
    await mkdir(path.join(plugin, "agents"), { recursive: true });
    await writeFile(
        path.join(plugin, "plugin.json"),
        JSON.stringify({
            name: "synthetic-author-probe",
            version: "1.0.0",
            description: "Isolated synthetic author child probe",
            extensions: "extensions/",
            agents: "agents/",
        }),
    );
    await writeFile(
        path.join(plugin, "agents", "typeagent-macro-author.agent.md"),
        await readFile(
            path.join(root, "agents", "typeagent-macro-author.agent.md"),
        ),
    );
    await writeFile(
        path.join(plugin, "extensions", "probe", "extension.mjs"),
        `import { joinedProbe } from ${JSON.stringify(import.meta.url)};\nawait joinedProbe();\n`,
    );
    const env = {};
    for (const key of [
        "SystemRoot",
        "WINDIR",
        "COMSPEC",
        "PATH",
        "PATHEXT",
        "HOME",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
    ]) {
        if (process.env[key]) env[key] = process.env[key];
    }
    Object.assign(env, {
        TEMP: state,
        TMP: state,
        DO_NOT_TRACK: "1",
        SYNTHETIC_RECORDING_TOKEN_ID: recordingTokenId,
        SYNTHETIC_RECORDING_PROMPT_HASH: promptHash,
    });
    const client = new CopilotClient({
        connection: RuntimeConnection.forStdio({ path: cliPath, env }),
        mode: "empty",
        baseDirectory: state,
        workingDirectory: state,
        useLoggedInUser: authenticated === "--authenticated",
        logLevel: "none",
        builtinPluginDirectories: [plugin],
    });
    const sdk = JSON.parse(
        await readFile(
            path.join(
                root,
                "node_modules",
                "@github",
                "copilot-sdk",
                "package.json",
            ),
            "utf8",
        ),
    );
    const report = {
        sdk: sdk.version,
        sdkTargetCliVersion: sdk.copilotCliVersion,
        events: [],
        contextChecks: [],
        authenticated: authenticated === "--authenticated",
    };
    let session;
    let capture;
    let assembler;
    let originalRecording = true;
    const finalizations = [];
    const captureErrors = [];
    const captureFailures = [];
    const startedAt = performance.now();
    const previousDemoState = process.env.TYPEAGENT_DEMO_STATE_PATH;
    process.env.TYPEAGENT_DEMO_STATE_PATH = path.join(state, "demo-state.json");
    const watchdog = setTimeout(() => void client.forceStop(), 150_000);
    try {
        await client.start();
        report.status = await client.getStatus();
        const { macroAuthorChildAgent } = await import(
            pathToFileURL(
                path.join(root, "dist/extension/macro-author-child.js"),
            ).href
        );
        session = await client.createSession({
            requestExtensions: true,
            enableConfigDiscovery: false,
            enableSessionStore: false,
            enableFileHooks: false,
            enableSkills: false,
            enableHostGitOperations: false,
            availableTools: [
                "view",
                "task",
                "typeagent_recorded_task_succeeded",
            ],
            customAgents: [macroAuthorChildAgent],
            onPermissionRequest: (request) => ({
                kind:
                    (request.kind === "read" &&
                        path.resolve(request.path) === fixturePath &&
                        !request.managedApprovalRequired &&
                        !request.requestSandboxBypass) ||
                    (request.kind === "custom-tool" &&
                        request.toolName ===
                            "typeagent_recorded_task_succeeded")
                        ? "approve-once"
                        : "reject",
            }),
        });
        const { ExtensionTraceAssembler } = await import(
            pathToFileURL(path.join(root, "dist/extension/trace-assembler.js"))
                .href
        );
        const { SessionCapture } = await import(
            pathToFileURL(path.join(root, "dist/extension/session-capture.js"))
                .href
        );
        let recordingState = {
            status: "claimed",
            token: {
                id: recordingTokenId,
                sessionId: session.sessionId,
                status: "claimed",
                learning: true,
                promptHash,
                expiresAt: new Date(Date.now() + 120_000).toISOString(),
            },
        };
        assembler = new ExtensionTraceAssembler(session.sessionId, state, true);
        capture = new SessionCapture(
            session.sessionId,
            state,
            (error) => captureErrors.push(error),
            {
                connectAgentServer: async () => ({
                    getMacroRecordingState: async () => recordingState,
                    finalizeMacroRecording: async (request) => {
                        finalizations.push(request);
                        recordingState = { status: "completed" };
                        return {
                            traceId: "synthetic-trace",
                            sessionId: session.sessionId,
                            createdAt: new Date().toISOString(),
                            toolCallCount: request.trace.toolCalls.length,
                        };
                    },
                    failMacroRecording: async (_sessionId, tokenId, error) => {
                        captureFailures.push({ tokenId, error });
                    },
                    close: async () => {},
                }),
                insertToolHistory: async () => {},
                insertTurnHistory: async () => {},
            },
            async () => {},
            async () => {},
            true,
        );
        session.on((event) => {
            if (originalRecording) {
                assembler.record(event);
                capture.enqueue(event);
            }
            if (event.type === "model.messages_snapshot") {
                const snapshot = JSON.stringify(event.data);
                report.contextChecks.push({
                    agentId: event.agentId,
                    keys: Object.keys(event.data),
                    hasChildNonce: snapshot.includes("CHILD_CONTEXT_4258"),
                    hasParentMarker: snapshot.includes("PARENT_ONLY_9837"),
                });
            }
            if (
                /^(subagent\.|tool\.execution_|session\.task_complete|session\.completion_receipt|session\.error|abort|user\.message|assistant\.message|assistant\.turn_end|session\.idle)/.test(
                    event.type,
                )
            )
                report.events.push(sanitizedEvent(event));
        });
        await session.rpc.tools.initializeAndValidate();
        report.agents = await session.rpc.agent.list({ includePrompt: true });
        report.tools = await session.rpc.tools.getCurrentMetadata();
        if (report.authenticated) {
            await session.sendAndWait(
                {
                    prompt: originalPrompt,
                },
                60_000,
            );
        }
        await capture.flush();
        const parentCapture = assembler.getChildAuthoringCapture();
        assert.ok(
            parentCapture,
            "Actual native receipt/final events did not yield a capture.",
        );
        assert.equal(assembler.getPromptHash(), promptHash);
        assert.equal(finalizations.length, 1);
        assert.equal(captureErrors.length, 0, JSON.stringify(captureErrors));
        assert.equal(
            captureFailures.length,
            0,
            JSON.stringify(captureFailures),
        );
        assert.equal(finalizations[0].tokenId, recordingTokenId);
        assert.deepEqual(finalizations[0].childAuthoring, parentCapture);
        const receiptEvents = report.events.filter(
            (event) =>
                event.type === "tool.execution_complete" &&
                event.id === parentCapture.successEventId,
        );
        assert.equal(receiptEvents.length, 1);
        assert.equal(
            report.events.filter(
                (event) =>
                    event.type === "tool.execution_start" &&
                    event.data.toolName ===
                        "typeagent_recorded_task_succeeded" &&
                    !event.agentId,
            ).length,
            1,
        );
        const receiptEvent = receiptEvents[0];
        assert.equal(receiptEvent.data.success, true);
        const receipt = JSON.parse(receiptEvent.data.result.content);
        assert.deepEqual(receipt, {
            status: "succeeded",
            recordingTokenId,
            promptHash,
        });
        const finalEvent = report.events.find(
            (event) => event.id === parentCapture.outputEventId,
        );
        assert.equal(finalEvent?.type, "assistant.message");
        assert.equal(finalEvent?.agentId, undefined);
        assert.equal(
            finalEvent?.data.content.trim(),
            `PARENT_DONE:${fixtureContent}`,
        );
        const receiptIndex = report.events.indexOf(receiptEvent);
        const finalIndex = report.events.indexOf(finalEvent);
        assert.ok(receiptIndex < finalIndex);
        assert.ok(
            report.events
                .slice(finalIndex + 1)
                .some(
                    (event) =>
                        event.type === "assistant.turn_end" && !event.agentId,
                ),
        );
        assert.equal(finalizations[0].trace.toolCalls.length, 1);
        assert.equal(finalizations[0].trace.toolCalls[0].name, "view");
        assert.equal(finalizations[0].trace.toolCalls[0].status, "completed");
        assert.ok(
            JSON.stringify(finalizations[0].trace.toolCalls[0].result).includes(
                fixtureContent,
            ),
        );
        const rootTurnEnd = report.events
            .slice(finalIndex + 1)
            .find(
                (event) =>
                    event.type === "assistant.turn_end" && !event.agentId,
            );
        const originalRootAnswers = report.events.filter(
            (event) => event.type === "assistant.message" && !event.agentId,
        ).length;
        report.parent = {
            capture: parentCapture,
            promptHash,
            receipt,
            receiptResultShape: Object.keys(receiptEvent.data.result),
            finalizationCount: finalizations.length,
            rootAnswerCount: originalRootAnswers,
            turnEndEventId: rootTurnEnd.id,
            durationMs: Math.round(performance.now() - startedAt),
        };
        await writeFile(
            path.join(state, "parent-proof.json"),
            JSON.stringify(report.parent),
        );
        originalRecording = false;
        const childStartedAt = performance.now();
        report.command = await session.rpc.commands.invoke({
            name: "synthetic-author-probe",
        });
        report.child = JSON.parse(
            await readFile(path.join(state, "child.json"), "utf8"),
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));
        report.tasks = await session.rpc.tasks.list();
        report.childDurationMs = Math.round(performance.now() - childStartedAt);
        const childStart = report.events.find(
            (event) =>
                event.type === "subagent.started" &&
                event.agentId === report.child.result?.childId,
        );
        assert.ok(childStart);
        assert.ok(
            Date.parse(childStart.timestamp) >=
                Date.parse(rootTurnEnd.timestamp),
        );
        const filteredIds = new Set(
            report.child.filterChecks
                .filter((check) => check.authoring)
                .map((check) => check.id),
        );
        for (const event of report.events.slice(finalIndex + 1)) {
            if (!filteredIds.has(event.id)) assembler.record(event);
        }
        assert.deepEqual(assembler.getChildAuthoringCapture(), parentCapture);
        report.proof = {
            contextIsolation:
                "Unproved: joined host does not expose child model-input snapshots; parent-marker response is behavioral evidence only.",
            explicitRootTaskSuccess: report.events.some(
                (event) =>
                    event.type === "session.task_complete" &&
                    !event.agentId &&
                    event.data.success === true,
            ),
            rootCompletionReceipt: report.events.some(
                (event) =>
                    event.type === "session.completion_receipt" &&
                    !event.agentId,
            ),
        };
        if (report.authenticated) {
            assert.ok(report.child.result, report.child.error);
            const id = report.child.result.childId;
            const completed = report.child.events.find(
                (event) =>
                    event.type === "subagent.completed" &&
                    event.agentId === id &&
                    !event.data.cancelled,
            );
            assert.equal(completed?.data.totalToolCalls, 0);
            const selected = report.child.events.find(
                (event) =>
                    event.type === "subagent.selected" && event.agentId === id,
            );
            assert.deepEqual(selected?.data.tools, []);
            assert.equal(
                report.child.events.filter(
                    (event) =>
                        event.type === "tool.execution_start" &&
                        event.agentId === id,
                ).length,
                0,
            );
            assert.equal(
                report.events.filter(
                    (event) =>
                        event.type === "assistant.message" && !event.agentId,
                ).length,
                originalRootAnswers,
            );
            assert.equal(report.child.cancellation?.code, "cancelled");
            const cancelledId = report.child.cancellation.events[0]?.id;
            assert.ok(cancelledId);
            assert.notEqual(cancelledId, id);
            assert.notEqual(cancelledId, session.sessionId);
            assert.equal(
                report.tasks.tasks.find((task) => task.id === id)?.status,
                "cancelled",
            );
            assert.equal(
                report.tasks.tasks.find((task) => task.id === cancelledId)
                    ?.status,
                "cancelled",
            );
            assert.equal(
                report.child.filterChecks.filter(
                    (check) =>
                        (check.agentId === id ||
                            check.agentId === cancelledId) &&
                        !check.authoring,
                ).length,
                0,
            );
            const candidate = JSON.parse(report.child.result.text);
            assert.equal(candidate.nonce, "CHILD_CONTEXT_4258");
            assert.equal(candidate.parentMarker, null);
            report.proof.launch =
                "Proved: joined extension synchronous task after parent answer.";
            report.proof.toolsAndRecursion =
                "Proved: host-selected tools [], totalToolCalls 0.";
            report.proof.cancellation =
                "Proved: distinct exact child cancelled by AbortSignal, parent unchanged.";
            report.proof.noParentContinuation =
                "Observed: no additional root answer during 1.5-second observation.";
            report.proof.eventFiltering =
                "Proved: exact native child events matched author identity filter, including cancellation.";
            report.proof.explicitReceipt =
                "Proved: real defineTool result.content JSON parsed by actual assembler and SessionCapture; receipt preceded final answer and root turn_end.";
        }
    } catch (error) {
        report.error = { message: error.message, code: error.code };
        process.exitCode = 1;
    } finally {
        await session?.disconnect().catch(() => {});
        report.shutdownErrors = (await client.stop()).map(
            (error) => error.message,
        );
        const ownedProcesses = Object.values(report.child?.processes ?? {});
        report.cleanup = [];
        for (const pid of ownedProcesses) {
            const deadline = Date.now() + 2000;
            let exited = false;
            while (Date.now() < deadline && !exited) {
                try {
                    process.kill(pid, 0);
                    await new Promise((resolve) => setTimeout(resolve, 100));
                } catch (error) {
                    exited = error.code === "ESRCH";
                    break;
                }
            }
            report.cleanup.push({ pid, exited });
            if (!exited) process.exitCode = 1;
        }
        clearTimeout(watchdog);
        report.totalDurationMs = Math.round(performance.now() - startedAt);
        if (previousDemoState === undefined) {
            delete process.env.TYPEAGENT_DEMO_STATE_PATH;
        } else {
            process.env.TYPEAGENT_DEMO_STATE_PATH = previousDemoState;
        }
        await writeFile(
            path.resolve(reportPath),
            JSON.stringify(report, null, 2),
        );
        await rm(state, { recursive: true, force: true });
        process.stdout.write(
            JSON.stringify({
                reportPath,
                error: report.error,
                child: report.child?.error ?? report.child?.result,
                proof: report.proof,
            }) + "\n",
        );
    }
}
