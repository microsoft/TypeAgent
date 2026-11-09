// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { getScenarioCases } from "./macro-eval-corpus.mjs";
import { gradeDocumentTrial } from "./macro-eval-grade.mjs";
import { extractNativeEvidence } from "./macro-eval-program.mjs";
import { macroProtocolVersion } from "./macro-eval-plan.mjs";
import {
    NativeStop,
    createNativeBudget,
    validateNativeStagedEntries,
} from "./macro-eval-native.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const read = (file) =>
    JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
const write = (file, value) =>
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
        flag: "wx",
    });
const root = (event) => !event.agentId && !event.data?.parentToolCallId;

export function admitPluginNativeCampaign(config, corpus, now = Date.now()) {
    const authorization = config.authorization;
    if (
        config.recipeOwner !== "plugin" ||
        authorization?.scope !== "synthetic-only" ||
        !authorization.approvedBy?.trim() ||
        !Number.isFinite(Date.parse(authorization.approvedAt)) ||
        Date.parse(authorization.approvedAt) > now ||
        !(Date.parse(authorization.expiresAt) > now) ||
        authorization.approveSyntheticReads !== true ||
        authorization.approveSyntheticPublication !== true ||
        authorization.corpusSha256 !== hash(JSON.stringify(corpus))
    )
        throw new NativeStop(
            "Explicit unexpired synthetic read/publication authorization is required.",
            "blocked",
        );
    requireNativePins(config);
    const cases = getScenarioCases(corpus);
    const training = cases.find(
        (entry) =>
            entry.id === config.trainingCase && entry.kind === "training",
    );
    const reuse = cases.find(
        (entry) => entry.id === config.reuseCase && entry.kind === "positive",
    );
    if (
        !training ||
        !reuse ||
        training.expectedDocument === reuse.expectedDocument ||
        corpus.documents.some(
            (document) => !/^synthetic-doc-/u.test(document.expectedId),
        )
    )
        throw new NativeStop(
            "Select different synthetic training/reuse documents from the reviewed corpus.",
            "blocked",
        );
    if (typeof config.restart !== "boolean")
        throw new NativeStop("Explicit restart boolean required.", "blocked");
    return { training, reuse };
}

function requireNativePins(config) {
    if (
        !path.isAbsolute(config.cliExecutable ?? "") ||
        !/^[a-f0-9]{64}$/u.test(config.cliSha256 ?? "") ||
        !path.isAbsolute(config.helperDirectory ?? "") ||
        !path.isAbsolute(config.creditLedger ?? "")
    )
        throw new NativeStop(
            "Pinned native executable, helperDirectory and reconciled creditLedger are required.",
            "blocked",
        );
}

export function checkNativeCreditLedger(ledger, rootModel) {
    const amounts = [
        "capNanoAiu",
        "openingNanoAiu",
        "headroomNanoAiu",
        "requestMaximumNanoAiu",
    ];
    if (
        ledger?.version !== 1 ||
        ledger.model !== rootModel ||
        ledger.blockedReason ||
        !validReservations(ledger.reservations) ||
        amounts.some(
            (key) => !Number.isSafeInteger(ledger[key]) || ledger[key] < 0,
        ) ||
        ledger.requestMaximumNanoAiu < 1 ||
        ledger.capNanoAiu > 50_000_000_000_000
    )
        throw new NativeStop(
            "Missing, blocked or wrong-model credit ledger; reconcile before native launch.",
            "blocked",
        );
    const total = ledger.reservations.reduce(
        (sum, entry) => sum + (entry.settledNanoAiu ?? entry.maximumNanoAiu),
        ledger.openingNanoAiu + ledger.headroomNanoAiu,
    );
    if (
        !Number.isSafeInteger(total) ||
        total + ledger.requestMaximumNanoAiu > ledger.capNanoAiu
    )
        throw new NativeStop(
            "Native credit ledger has no admitted headroom.",
            "blocked",
        );
    return {
        accountedNanoAiu: total,
        capNanoAiu: ledger.capNanoAiu,
        policy: "Reconciled admission only; native root/provider usage remains separate. Turn/deadline limits are not a hard monetary cap; no unknown-usage savings claim.",
    };
}

function validReservations(reservations) {
    if (!Array.isArray(reservations)) return false;
    const ids = new Set();
    return reservations.every((entry) => {
        if (!entry || typeof entry.id !== "string" || ids.has(entry.id))
            return false;
        ids.add(entry.id);
        return (
            Number.isSafeInteger(entry.maximumNanoAiu) &&
            entry.maximumNanoAiu >= 0 &&
            (entry.settledNanoAiu === undefined ||
                (Number.isSafeInteger(entry.settledNanoAiu) &&
                    entry.settledNanoAiu >= 0 &&
                    entry.settledNanoAiu <= entry.maximumNanoAiu))
        );
    });
}

function ownLayout(output, config) {
    if (fs.existsSync(output))
        throw new NativeStop("Native output must be fresh.");
    const workspace = path.join(path.resolve(output), "workspace");
    if (path.resolve(config.workspace) !== workspace)
        throw new NativeStop(
            "Live workspace must be the fresh output/workspace directory.",
        );
    fs.mkdirSync(output);
    const layout = {
        run: path.resolve(output),
        workspace,
        owner: randomUUID(),
        plugin: path.join(output, "plugin"),
        pluginData: path.join(output, "plugin-data"),
        data: path.join(output, "data"),
        audit: path.join(output, "backend.jsonl"),
    };
    for (const directory of [workspace, layout.pluginData, layout.data])
        fs.mkdirSync(directory);
    write(path.join(output, "evaluation-owner.json"), { owner: layout.owner });
    return layout;
}

export function nativeModelAccounting(events) {
    const groups = { root: 0, author: 0, verifier: 0, otherChild: 0 };
    const roles = new Map(
        events
            .filter((event) => event.type === "subagent.started")
            .map((event) => [event.agentId, event.data?.agentName ?? ""]),
    );
    for (const event of events.filter(
        (entry) => entry.type === "assistant.turn_start",
    )) {
        const role = roles.get(event.agentId) ?? "";
        if (root(event)) groups.root++;
        else if (/verif/iu.test(role)) groups.verifier++;
        else if (/author/iu.test(role)) groups.author++;
        else groups.otherChild++;
    }
    return {
        turns: groups,
        tokens: null,
        credits: null,
        note: "Native root/child event attribution only. Independent verifier/provider and semantic usage cannot be inferred from root events.",
    };
}

function assertSafeObservation(observed, config, budget) {
    budget.check(observed.events);
    if (observed.events.some((event) => event.type === "session.error"))
        throw new NativeStop(
            "Native session error; uncertain work is not retried.",
            "failed",
        );
    if (
        /Confirm folder trust|wants elevated permissions|Allow once|\b(?:Allow|Approve|Confirm|Trust)\b.*\?|\b(?:permission|confirmation|elevated permissions)\b/iu.test(
            observed.screen ?? "",
        )
    )
        throw new NativeStop(
            "Native consent/interaction requires independent exact approval; no blanket or model-generated confirmation is sent.",
            "blocked",
        );
    if (observed.creditLedger)
        checkNativeCreditLedger(observed.creditLedger, config.rootModel);
}

async function bounded(operation, budget, signal) {
    budget.check();
    signal?.throwIfAborted();
    let timeout;
    let rejectAbort;
    const stop = () =>
        rejectAbort(new NativeStop("Native evaluation cancelled.", "blocked"));
    try {
        const aborted = new Promise((_, reject) => {
            rejectAbort = reject;
        });
        signal?.addEventListener("abort", stop, { once: true });
        return await Promise.race([
            operation(),
            aborted,
            new Promise((_, reject) => {
                timeout = setTimeout(
                    () =>
                        reject(
                            new NativeStop(
                                "Native operation deadline exceeded.",
                                "blocked",
                            ),
                        ),
                    budget.remaining(),
                );
                timeout.unref?.();
            }),
        ]);
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", stop);
    }
}

async function poll(adapter, config, budget, signal, predicate) {
    for (;;) {
        const observed = await bounded(() => adapter.read(), budget, signal);
        assertSafeObservation(observed, config, budget);
        const result = await predicate(observed);
        if (result) return result;
        await bounded(() => adapter.wait(), budget, signal);
    }
}

function terminalSince(events, offset) {
    const selected = events.slice(offset);
    const answer = selected.findLast(
        (event) =>
            root(event) &&
            event.type === "assistant.message" &&
            typeof event.data?.content === "string" &&
            !event.data.toolRequests?.length,
    );
    const terminal = selected.findLast(
        (event) =>
            root(event) &&
            ["assistant.turn_end", "session.idle"].includes(event.type),
    );
    return (
        answer &&
        terminal &&
        selected.indexOf(terminal) > selected.indexOf(answer)
    );
}

async function selectedCapture(
    adapter,
    config,
    selection,
    budget,
    signal,
    report,
) {
    const ready = await poll(
        adapter,
        config,
        budget,
        signal,
        async (observation) => {
            if (!observation.sessionId) return;
            try {
                const scope = await adapter.call(
                    observation.sessionId,
                    "scope",
                    [],
                );
                if (scope.profileId !== config.profileId)
                    throw new NativeStop(
                        "Native profile registration mismatch.",
                    );
                return { ...observation, scope };
            } catch (error) {
                if (error instanceof NativeStop) throw error;
                return undefined;
            }
        },
    );
    const sessionId = ready.sessionId;
    if (config.sessionId && sessionId !== config.sessionId)
        throw new NativeStop(
            "Actual native session does not match the explicitly pinned session.",
        );
    await adapter.call(sessionId, "setMacroLearningPreference", [
        { cwd: config.workspace, mode: "prepare" },
    ]);
    const armed = await adapter.call(sessionId, "armMacroRecording", [
        { sessionId, cwd: config.workspace, learning: true },
    ]);
    report.capture = { sessionId, armed };
    await adapter.submit(selection.training.prompt);
    const completed = await poll(
        adapter,
        config,
        budget,
        signal,
        async (observation) => {
            const state = await adapter.call(
                sessionId,
                "getMacroRecordingState",
                [sessionId],
            );
            if (state.status === "failed")
                throw new NativeStop(
                    state.error ?? "Selected recording failed.",
                    "failed",
                );
            if (
                state.status !== "completed" ||
                !state.learningJob ||
                !terminalSince(observation.events, ready.events.length)
            )
                return;
            return { state, observation };
        },
    );
    report.capture.completed = completed.state;
    const source = extractNativeEvidence(
        completed.observation.events.slice(ready.events.length),
        completed.observation.backendAudit.slice(ready.backendAudit.length),
    );
    source.executionEvidence.effects = source.executionEvidence.effects.filter(
        (effect) =>
            !["task", "typeagent_recorded_task_succeeded"].includes(effect),
    );
    report.capture.grade = gradeDocumentTrial({
        ...source,
        scenario: selection.training,
        documents: report.documents,
    });
    if (report.capture.grade.status !== "passed")
        throw new NativeStop(
            "Selected source failed independent synthetic task/audit grading.",
            "failed",
        );
    const job = await poll(adapter, config, budget, signal, async () => {
        const current = await adapter.call(sessionId, "getMacroLearningJob", [
            completed.state.learningJob.jobId,
        ]);
        if (["failed", "cancelled"].includes(current.status))
            throw new NativeStop(
                current.error ?? `Child authoring ${current.status}.`,
                "failed",
            );
        return ["needsReview", "ready"].includes(current.status) &&
            current.macro
            ? current
            : undefined;
    });
    if (
        job.authoring?.captureId !== completed.state.trace?.traceId ||
        job.sessionId !== sessionId ||
        job.cwd !== config.workspace ||
        job.authoring?.tokenId !== armed.id ||
        !job.authoring?.taskId ||
        !/^[a-f0-9]{64}$/u.test(job.authoring?.contextDigest ?? "")
    )
        throw new NativeStop(
            "Learning did not retain genuine correlated child context.",
        );
    const macro = await adapter.call(sessionId, "inspectMacro", [job.macro]);
    if (
        !isDeepStrictEqual(macro.learning?.authoring, job.authoring) ||
        ["captureId", "taskId", "tokenId"].some(
            (key) => macro.program?.provenance?.[key] !== job.authoring[key],
        )
    )
        throw new NativeStop(
            "Published program does not retain the sealed learning child provenance.",
        );
    const validation = await adapter.call(sessionId, "validateMacro", [
        job.macro,
    ]);
    reviewSyntheticProgram(macro, validation);
    if (macro.state === "draft")
        await adapter.call(sessionId, "approveMacro", [job.macro]);
    const approved = await adapter.call(sessionId, "inspectMacro", [job.macro]);
    if (
        approved.state !== "approved" ||
        approved.program?.revision !== macro.program.revision
    )
        throw new NativeStop(
            "Program publication/version changed after review.",
        );
    report.capture.job = job;
    report.capture.macro = approved;
    return approved;
}

export function reviewSyntheticProgram(macro, validation) {
    const capabilities = macro?.program?.capabilities;
    if (
        !validation?.valid ||
        macro?.executionKind !== "program" ||
        !macro.program?.revision ||
        !Array.isArray(capabilities) ||
        capabilities.length !== 2 ||
        capabilities.some(
            (entry) =>
                entry.effect !== "read" ||
                entry.providerId !== "eval-docs" ||
                entry.transport !== "mcp",
        ) ||
        !isDeepStrictEqual(
            capabilities.map((entry) => entry.operation).sort(),
            ["fetch_document", "lookup_document"],
        ) ||
        macro.program.semanticFunctions?.length !== 0 ||
        macro.inputs?.length !== 1 ||
        macro.inputs[0].secret
    )
        throw new NativeStop(
            "Synthetic program review rejected unvalidated, semantic, extra, write or unknown capabilities.",
            "blocked",
        );
}

async function reuseProgram(
    adapter,
    config,
    corpus,
    scenario,
    macro,
    budget,
    signal,
) {
    const before = await poll(
        adapter,
        config,
        budget,
        signal,
        async (observation) => {
            if (!observation.sessionId) return;
            try {
                const registration = await adapter.call(
                    observation.sessionId,
                    "scope",
                    [],
                );
                return { ...observation, registration };
            } catch {
                return undefined;
            }
        },
    );
    const workspaceId =
        process.platform === "win32"
            ? path.resolve(config.workspace).toLowerCase()
            : path.resolve(config.workspace);
    if (
        before.registration.workspaceId !== workspaceId ||
        before.registration.profileId !== config.profileId
    )
        throw new NativeStop(
            "Reuse session has a foreign workspace/profile registration.",
        );
    const currentMacro = await adapter.call(before.sessionId, "inspectMacro", [
        { macroId: macro.macroId, version: macro.version },
    ]);
    if (
        currentMacro.state !== "approved" ||
        !isDeepStrictEqual(currentMacro.program, macro.program)
    )
        throw new NativeStop(
            "Approved program changed across capture/reuse or restart.",
        );
    const startedAt = new Date().toISOString();
    const document = corpus.documents.find(
        (entry) => entry.key === scenario.expectedDocument,
    );
    const prompt =
        config.executionPath === "explicit-mcp"
            ? `Use only the explicit run_macro MCP tool for ${JSON.stringify({ macroId: macro.macroId, version: macro.version, inputs: { [macro.inputs[0].name]: document.title } })}. Request: ${scenario.prompt}`
            : scenario.prompt;
    await adapter.submit(prompt);
    const observed = await poll(
        adapter,
        config,
        budget,
        signal,
        (observation) =>
            terminalSince(observation.events, before.events.length)
                ? observation
                : undefined,
    );
    const events = observed.events.slice(before.events.length);
    const audit = observed.backendAudit.slice(before.backendAudit.length);
    const evidence = extractNativeEvidence(events, audit);
    const runId = evidence.routeEvidence.runId;
    if (!runId || evidence.routeEvidence.route !== config.executionPath)
        throw new NativeStop(
            "Actual current program route/run identity is unproved.",
            "failed",
        );
    const reconciledRun = await adapter.call(
        observed.sessionId,
        "getMacroRun",
        [runId],
    );
    evidence.programEvidence = {
        ...evidence.programEvidence,
        owner: "plugin",
        macro: currentMacro,
        reconciledRun,
        registration: before.registration,
        expected: {
            ...before.registration,
            runId,
            startedAt,
            endedAt: new Date().toISOString(),
        },
    };
    const grade = gradeDocumentTrial({
        ...evidence,
        scenario,
        documents: corpus.documents,
    });
    return {
        scenarioId: scenario.id,
        sessionId: observed.sessionId,
        evidence,
        grade,
        accounting: nativeModelAccounting(events),
    };
}

export async function runPluginNativeEvaluation({
    corpus,
    config,
    output,
    signal,
    adapterFactory,
}) {
    const selection = admitPluginNativeCampaign(config, corpus);
    if (!adapterFactory && process.platform !== "win32")
        throw new NativeStop("Native evaluation requires Windows.", "blocked");
    const layout = ownLayout(output, config);
    const budget = createNativeBudget(config, signal);
    const report = {
        protocolVersion: macroProtocolVersion,
        status: "harness-invalid",
        owner: layout.owner,
        scope: "synthetic-only",
        trials: [],
        media: { recorded: false, validated: false },
        documents: corpus.documents,
        execution: adapterFactory
            ? "injected-offline-controller-fixture"
            : "native-windows-console",
        usage: {
            monetarySavings: null,
            note: "Complete provider accounting required.",
        },
    };
    let adapter;
    try {
        adapter = await (adapterFactory ?? createWindowsPluginAdapter)(
            layout,
            config,
            corpus,
            budget,
        );
        report.creditAdmission = await adapter.creditAdmission();
        await bounded(() => adapter.open(), budget, signal);
        const macro = await selectedCapture(
            adapter,
            config,
            selection,
            budget,
            signal,
            report,
        );
        report.trials.push(
            await reuseProgram(
                adapter,
                config,
                corpus,
                selection.reuse,
                macro,
                budget,
                signal,
            ),
        );
        if (report.trials[0].grade.status !== "passed")
            throw new NativeStop(
                "Current program reuse failed independent grading.",
                "failed",
            );
        if (config.restart) {
            await adapter.close();
            await bounded(() => adapter.open(), budget, signal);
            report.trials.push(
                await reuseProgram(
                    adapter,
                    config,
                    corpus,
                    selection.reuse,
                    macro,
                    budget,
                    signal,
                ),
            );
        }
        report.status = report.trials.every(
            (trial) => trial.grade.status === "passed",
        )
            ? "passed"
            : "failed";
    } catch (error) {
        report.status = error.status ?? "harness-invalid";
        report.error = error.message;
    } finally {
        try {
            await adapter?.close();
        } catch (error) {
            report.status = "harness-invalid";
            report.cleanupError = error.message;
        }
        delete report.documents;
        write(path.join(layout.run, "report.json"), report);
    }
    return report;
}

function readJsonl(file) {
    if (!fs.existsSync(file)) return [];
    const bytes = fs.readFileSync(file, "utf8");
    if (!bytes.endsWith("\n"))
        return bytes
            .slice(0, bytes.lastIndexOf("\n") + 1)
            .split("\n")
            .filter(Boolean)
            .map(JSON.parse);
    return bytes.split("\n").filter(Boolean).map(JSON.parse);
}

export async function createWindowsPluginAdapter(
    layout,
    config,
    corpus,
    budget,
    execute = execFileSync,
) {
    if (hash(fs.readFileSync(config.cliExecutable)) !== config.cliSha256)
        throw new NativeStop("Pinned native executable changed.", "blocked");
    const { stageCopilotPlugin } = await import(
        "../../../tools/scripts/stageCopilotPlugin.mjs"
    );
    stageCopilotPlugin(layout.plugin);
    validateNativeStagedEntries(layout.plugin);
    const mcp = read(path.join(layout.plugin, ".mcp.json"));
    const macroServer = mcp.mcpServers["typeagent-macros"];
    if (!macroServer)
        throw new NativeStop("Current staged macro MCP server is missing.");
    write(path.join(layout.pluginData, "config.json"), {
        recipeOwner: "plugin",
        macroLearning: "prepare",
    });
    fs.writeFileSync(
        path.join(layout.plugin, ".mcp.json"),
        JSON.stringify({
            mcpServers: {
                "typeagent-macros": { ...macroServer, tools: ["run_macro"] },
            },
        }),
    );
    write(path.join(layout.run, "corpus.json"), corpus);
    fs.writeFileSync(layout.audit, "", { flag: "wx" });
    write(path.join(layout.workspace, ".mcp.json"), {
        mcpServers: {
            "eval-docs": {
                type: "stdio",
                command: process.execPath,
                args: [
                    path.join(scripts, "macro-eval-fixture.mjs"),
                    "--corpus",
                    path.join(layout.run, "corpus.json"),
                    "--audit",
                    layout.audit,
                    "--append-audit",
                ],
                tools: ["lookup_document", "fetch_document"],
            },
        },
    });
    fs.writeFileSync(
        path.join(layout.workspace, "AGENTS.md"),
        "Only read the synthetic fixture documents. Return the complete current title and contents. Clarify ambiguous requests. Never invent IDs, grant permissions, approve programs, write files or repeat uncertain work.\n",
        { flag: "wx" },
    );
    let index = 0,
        consoleRun,
        home,
        identities = [];
    const environment = {
        CLAUDE_PLUGIN_DATA: layout.pluginData,
        TYPEAGENT_USER_DATA_DIR: layout.data,
        TYPEAGENT_RECIPE_PROFILE_ID: config.profileId,
        TYPEAGENT_RECIPE_OWNER: "plugin",
        TYPEAGENT_RECIPE_CLI_PATH: config.cliExecutable,
        TYPEAGENT_MACRO_RECORDING_ENABLED: "true",
        TYPEAGENT_MACRO_INDUCTION_ENABLED: "true",
    };
    const helperHashes = new Map(
        ["Launch-Demo.ps1", "Control-Demo.ps1", "console-bridge.mjs"].map(
            (name) => {
                const file = path.join(config.helperDirectory, name);
                return [file, hash(fs.readFileSync(file))];
            },
        ),
    );
    const powershell = (
        name,
        args,
        timeout = Math.min(15000, budget.remaining()),
    ) => {
        if (!(name === "Control-Demo.ps1" && args[1] === "Close"))
            budget.check();
        for (const [file, digest] of helperHashes)
            if (hash(fs.readFileSync(file)) !== digest)
                throw new NativeStop("Owned native helper changed.");
        return execute(
            "powershell.exe",
            [
                "-NoProfile",
                "-File",
                path.join(config.helperDirectory, name),
                ...args,
            ],
            { encoding: "utf8", windowsHide: true, timeout, shell: false },
        );
    };
    const control = (action, text) =>
        powershell("Control-Demo.ps1", [
            "-Action",
            action,
            "-RunDirectory",
            consoleRun,
            ...(text === undefined ? [] : ["-Text", text]),
        ]);
    const tree = (pid) => nativeOwnedProcessTree(pid, execute);
    const verifyIdentity = () => {
        const state = read(path.join(consoleRun, "console-state.json"));
        const current = tree(state.bridgePid);
        if (
            !nativeProcessIdentityMatches(identities, current) ||
            !current.some((entry) => entry.ProcessId === state.cliPid)
        )
            throw new NativeStop(
                "Owned native process identity changed.",
                "blocked",
            );
        return current;
    };
    return {
        creditAdmission: async () =>
            checkNativeCreditLedger(
                read(config.creditLedger),
                config.rootModel,
            ),
        async open() {
            if (
                hash(fs.readFileSync(config.cliExecutable)) !== config.cliSha256
            )
                throw new NativeStop("Native executable changed.");
            home = path.join(layout.run, `home-${index}`);
            consoleRun = path.join(layout.run, `console-${index++}`);
            fs.mkdirSync(home);
            write(path.join(home, "settings.json"), {
                extensions: { mode: "load_only" },
            });
            const launchFile = path.join(layout.run, `launch-${index}.json`);
            write(launchFile, {
                command: config.cliExecutable,
                workspace: layout.workspace,
                args: [
                    "--no-auto-update",
                    "--experimental",
                    "--no-ask-user",
                    "--disable-builtin-mcps",
                    "--no-remote-export",
                    "--model",
                    config.rootModel,
                    "--plugin-dir",
                    layout.plugin,
                    "--additional-mcp-config",
                    `@${path.join(layout.workspace, ".mcp.json")}`,
                    "--available-tools",
                    "eval-docs-lookup_document",
                    "eval-docs-fetch_document",
                    "typeagent-macros-run_macro",
                    "typeagent_recorded_task_succeeded",
                    "builtin:task",
                ],
                environment: { ...environment, COPILOT_HOME: home },
            });
            powershell(
                "Launch-Demo.ps1",
                [
                    "-ConfigPath",
                    launchFile,
                    "-RunDirectory",
                    consoleRun,
                    "-NodePath",
                    process.execPath,
                    "-TimeoutSeconds",
                    "30",
                ],
                Math.min(45000, budget.remaining()),
            );
            const state = read(path.join(consoleRun, "console-state.json"));
            identities = tree(state.bridgePid);
            const cli = identities.find(
                (entry) => entry.ProcessId === state.cliPid,
            );
            if (
                state.phase !== "running" ||
                !cli ||
                path.resolve(cli.ExecutablePath).toLowerCase() !==
                    path.resolve(config.cliExecutable).toLowerCase()
            )
                throw new NativeStop(
                    "Native CLI is not the pinned owned bridge child.",
                    "blocked",
                );
            for (const action of ["Compile", "Select", "Restore", "Verify"])
                control(action);
        },
        async read() {
            const state = read(path.join(consoleRun, "console-state.json"));
            if (state.phase !== "running")
                throw new NativeStop("Owned native CLI exited.", "blocked");
            verifyIdentity();
            control("Verify");
            const sessionRoot = path.join(home, "session-state");
            const sessions = fs.existsSync(sessionRoot)
                ? fs
                      .readdirSync(sessionRoot)
                      .filter((id) =>
                          fs.existsSync(
                              path.join(sessionRoot, id, "events.jsonl"),
                          ),
                      )
                : [];
            if (sessions.length > 1)
                throw new NativeStop(
                    "More than one native root session in owned home.",
                );
            const screen = control("Read");
            const consent = nativeConsentAction(
                screen,
                layout,
                config.authorization,
            );
            if (consent) {
                control("Type", consent);
                return {
                    events: [],
                    backendAudit: readJsonl(layout.audit),
                    screen: "",
                    creditLedger: read(config.creditLedger),
                };
            }
            return {
                sessionId: sessions[0],
                screen,
                events: sessions.length
                    ? readJsonl(
                          path.join(sessionRoot, sessions[0], "events.jsonl"),
                      )
                    : [],
                backendAudit: readJsonl(layout.audit),
                creditLedger: read(config.creditLedger),
            };
        },
        async call(sessionId, method, args) {
            return JSON.parse(
                execute(
                    process.execPath,
                    [path.join(scripts, "macro-eval-local-owner.mjs")],
                    {
                        input: JSON.stringify({
                            workspace: layout.workspace,
                            sessionId,
                            method,
                            args,
                        }),
                        env: { ...process.env, ...environment },
                        encoding: "utf8",
                        timeout: Math.min(15000, budget.remaining()),
                        windowsHide: true,
                        shell: false,
                    },
                ),
            );
        },
        submit: async (text) => {
            verifyIdentity();
            control("Verify");
            control("Type", text);
        },
        wait: () => delay(250),
        async close() {
            if (!consoleRun) return;
            const previous = consoleRun;
            const observed = tree(identities[0]?.ProcessId);
            const same = nativeProcessIdentityMatches(identities, observed);
            const current = same ? observed : identities;
            consoleRun = undefined;
            try {
                if (same)
                    powershell(
                        "Control-Demo.ps1",
                        ["-Action", "Close", "-RunDirectory", previous],
                        30000,
                    );
            } finally {
                for (const identity of [...current].reverse())
                    if (
                        nativeProcessIdentityMatches(
                            [identity],
                            tree(identity.ProcessId),
                        )
                    )
                        execute(
                            "powershell.exe",
                            [
                                "-NoProfile",
                                "-Command",
                                `Stop-Process -Id ${identity.ProcessId} -ErrorAction SilentlyContinue`,
                            ],
                            { timeout: 10000, windowsHide: true, shell: false },
                        );
            }
        },
    };
}

export function nativeProcessIdentityMatches(expected, actual) {
    return (
        expected.length > 0 &&
        expected.every((before) =>
            actual.some(
                (after) =>
                    before.ProcessId === after.ProcessId &&
                    before.ParentProcessId === after.ParentProcessId &&
                    before.StartedAt === after.StartedAt &&
                    before.ExecutablePath === after.ExecutablePath,
            ),
        )
    );
}

function nativeOwnedProcessTree(pid, execute) {
    if (!Number.isSafeInteger(pid) || pid < 1)
        throw new NativeStop("Owned bridge PID is invalid.");
    const command = `$all=@(Get-CimInstance Win32_Process); $ids=@(${pid}); $rows=@(); for($i=0;$i -lt $ids.Count;$i++){ $p=$all|Where-Object ProcessId -eq $ids[$i]; if($p){ $rows += [pscustomobject]@{ProcessId=[int]$p.ProcessId;ParentProcessId=[int]$p.ParentProcessId;StartedAt=$p.CreationDate.ToUniversalTime().ToString('O');ExecutablePath=$p.ExecutablePath}; $ids += @($all|Where-Object ParentProcessId -eq $p.ProcessId|ForEach-Object {[int]$_.ProcessId}) }}; ConvertTo-Json -InputObject @($rows) -Compress`;
    const rows = JSON.parse(
        execute("powershell.exe", ["-NoProfile", "-Command", command], {
            encoding: "utf8",
            timeout: 10000,
            windowsHide: true,
            shell: false,
        }),
    );
    return Array.isArray(rows) ? rows : [rows];
}

export function nativeConsentAction(screen, layout, authorization) {
    if (
        /Confirm folder trust/u.test(screen) &&
        screen.includes(layout.workspace) &&
        authorization.approveOwnedWorkspaceTrust === true &&
        /1[.)]\s*(?:Yes,?\s*)?trust/iu.test(screen)
    )
        return "1";
    if (
        /wants elevated permissions/u.test(screen) &&
        screen.includes(
            path.join(
                layout.plugin,
                "extensions",
                "typeagent",
                "extension.mjs",
            ),
        ) &&
        authorization.approveOwnedExtension === true &&
        /1[.)]\s*Yes/iu.test(screen)
    )
        return "1";
    if (
        /\bpermission\b/iu.test(screen) &&
        /1[.)]\s*Allow once/iu.test(screen) &&
        /eval-docs[-:](?:lookup_document|fetch_document)/u.test(screen) &&
        !/\b(?:shell|write|delete|all tools|always)\b/iu.test(screen) &&
        authorization.approveSyntheticReads === true
    )
        return "1";
    return undefined;
}
