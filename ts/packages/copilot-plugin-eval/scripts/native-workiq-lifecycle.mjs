// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import {
    stageNativeNormalHook,
    startNativeNormalHookReader,
} from "./macro-eval-native-bridge.mjs";
import { verifyNativeWorkiqProjectionSources } from "./native-workiq-projection.mjs";
import {
    isTrustedNormalHookCallback,
    nativeInputIdentity,
} from "./macro-eval-native-callback.mjs";
import {
    cleanServiceEnvironment,
    createNativeBudget,
    freezeNativeExecutable,
    verifyNativeExecutable,
    validateNativeCliVersion,
    processTree,
    probeWindowsServiceListeners,
    validateOwnedServiceListener,
    nativeControlTimeout,
    readNativeJsonl,
    nativeControlProof,
    classifyNativeScreen,
} from "./macro-eval-native.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const nativeRuntimes = new WeakMap();
const evidenceBoundaries = new WeakMap();
const nativeProjections = new WeakSet();
const nativeServiceModuleSnapshots = new WeakSet();
const serviceModuleRoles = {
    recordedReadEvidence:
        "packages\\copilot-macros\\dist\\recordedReadEvidence.js",
    resultEvidence: "packages\\copilot-macros\\dist\\resultEvidence.js",
    macroManager: "packages\\copilot-macros\\dist\\macroManager.js",
    macroLearning: "packages\\copilot-macros\\dist\\macroLearning.js",
    macroLearningRuntime:
        "packages\\defaultAgentProvider\\dist\\macroLearningRuntime.js",
};
const tsRoot = path.resolve(directory, "..", "..", "..");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const read = (file) =>
    JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
const write = (file, value) =>
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
    });

function requireNative(condition, message) {
    if (!condition)
        throw Object.assign(new Error(message), { status: "blocked" });
}

export function createNativeWorkiqHostAssertions(runtime, scope) {
    const factory = nativeRuntimes.get(runtime);
    requireNative(
        factory,
        "WorkIQ host assertions require the actual source-owned native runtime",
    );
    return factory(scope);
}

export function createNativeWorkiqEvidenceBoundary(runtime, trial) {
    const factory = evidenceBoundaries.get(runtime);
    requireNative(
        factory,
        "WorkIQ evidence requires the actual source-owned native runtime",
    );
    return factory(trial);
}

export function assertNativeWorkiqProjection(proof) {
    requireNative(
        nativeProjections.has(proof),
        "Native WorkIQ projection must originate from current physical native sources",
    );
    return proof;
}

export function assertNativeWorkiqServiceModules(proof) {
    requireNative(
        nativeServiceModuleSnapshots.has(proof),
        "Native service module proof requires the actual owned load callback",
    );
    return proof;
}

function validateNativeServiceModuleLoad(
    plan,
    actor,
    message,
    receivedMonotonicNs,
) {
    const entry = message.role === "normal-service-entry";
    const expected = entry
        ? {
              realPath: plan.serviceEntry,
              sha256: plan.serviceEntrySha256,
              sizeBytes: plan.serviceEntrySizeBytes,
          }
        : plan.modules.find((module) => module.role === message.role);
    const bindings = {
        kind: entry
            ? "native-workiq-service-entry-load-v1"
            : "native-workiq-service-module-load-v1",
        owner: plan.owner,
        ownedRoot: plan.ownedRoot,
        manifestDigest: plan.manifestDigest,
        planDigest: plan.planDigest,
        observerDigest: plan.observer.sha256,
        nonce: plan.nonce,
        pid: actor.ProcessId,
        parentPid: actor.ParentProcessId,
        executable: actor.ExecutablePath,
        serviceEntry: plan.serviceEntry,
        role: entry ? "normal-service-entry" : expected?.role,
        realPath: expected?.realPath,
        url: expected ? pathToFileURL(expected.realPath).href : undefined,
        sha256: expected?.sha256,
        sizeBytes: expected?.sizeBytes,
        format: "module",
        boundary: "normal-node-load-source-not-module-evaluation",
    };
    const keys = [...Object.keys(bindings), "observedMonotonicNs"];
    requireNative(
        expected &&
            Object.keys(message).length === keys.length &&
            keys.every((key) => Object.hasOwn(message, key)) &&
            Object.entries(bindings).every(
                ([key, value]) => message[key] === value,
            ) &&
            typeof message.observedMonotonicNs === "string" &&
            /^[0-9]{1,30}$/u.test(message.observedMonotonicNs) &&
            typeof receivedMonotonicNs === "string" &&
            /^[0-9]{1,30}$/u.test(receivedMonotonicNs) &&
            BigInt(message.observedMonotonicNs) >=
                BigInt(plan.createdMonotonicNs) &&
            BigInt(message.observedMonotonicNs) <=
                BigInt(receivedMonotonicNs) &&
            BigInt(receivedMonotonicNs) <= process.hrtime.bigint(),
        "Actual owned service module load has foreign/stale/path/byte/manifest authority",
    );
    return message;
}

function nativeServiceModulePlan(layout, config, index) {
    const authorization = config.budgetAuthorization?.serviceModuleLoadWitness;
    requireNative(
        !config.budgetAuthorization?.futureCompiledLineage ||
            authorization?.required === true,
        "Future product lineage requires a source-owned service module witness configuration",
    );
    if (!authorization) return undefined;
    const source = path.join(
        directory,
        "native-workiq-service-module-observer.mjs",
    );
    const serviceEntry = path.join(
        tsRoot,
        "packages",
        "agentServer",
        "server",
        "dist",
        "server.js",
    );
    requireNative(
        authorization.required === true &&
            authorization.observerSource.path === source &&
            hash(fs.readFileSync(source)) ===
                authorization.observerSource.sha256 &&
            authorization.serviceEntry.path === serviceEntry &&
            hash(fs.readFileSync(serviceEntry)) ===
                authorization.serviceEntry.sha256 &&
            hash(fs.readFileSync(authorization.manifest.path)) ===
                authorization.manifest.sha256 &&
            authorization.manifest.path ===
                config.budgetAuthorization.sourceQualification.path &&
            authorization.manifest.sha256 ===
                config.budgetAuthorization.sourceQualification.sha256,
        "Native service module observer/entry/product qualification changed",
    );
    const manifest = read(authorization.manifest.path);
    requireNative(
        manifest.requiredServiceCompiled?.length === 5,
        "Qualified native service closure requires exactly five modules",
    );
    const modules = Object.entries(serviceModuleRoles).map(([role, file]) => {
        const matches = manifest.requiredServiceCompiled.filter(
            (item) => item.path === file,
        );
        requireNative(
            matches.length === 1,
            "Qualified native service role coverage is incomplete",
        );
        const expected = matches[0];
        const realPath = fs.realpathSync(path.join(tsRoot, file));
        requireNative(
            hash(fs.readFileSync(realPath)) === expected.sha256 &&
                fs.statSync(realPath).size === expected.sizeBytes,
            "Qualified native service module physical bytes changed",
        );
        return {
            role,
            realPath,
            sha256: expected.sha256,
            sizeBytes: expected.sizeBytes,
        };
    });
    const observerFile = path.join(
        layout.run,
        `service-module-observer-${index}.mjs`,
    );
    fs.copyFileSync(source, observerFile, fs.constants.COPYFILE_EXCL);
    const planFile = path.join(
        layout.run,
        `service-module-plan-${index}.private.json`,
    );
    const plan = {
        owner: layout.owner,
        ownedRoot: layout.run,
        manifestDigest: authorization.manifest.sha256,
        nonce: randomUUID(),
        createdAtMs: Date.now(),
        createdMonotonicNs: process.hrtime.bigint().toString(),
        nodeExecutable: process.execPath,
        serviceEntry,
        serviceEntrySha256: authorization.serviceEntry.sha256,
        serviceEntrySizeBytes: fs.statSync(serviceEntry).size,
        observer: {
            file: fs.realpathSync(observerFile),
            sha256: authorization.observerSource.sha256,
        },
        modules,
    };
    write(planFile, plan);
    return { ...plan, planFile, planDigest: hash(fs.readFileSync(planFile)) };
}

function assertNativeWorkiqGetterReceipt(
    layout,
    getter,
    stagedRouter,
    extension,
    current,
) {
    requireNative(
        extension.length === 1 &&
            current.length === 1 &&
            getter?.provenance ===
                "registered-status-public-spawnSync-result" &&
            getter.ParentProcessId === extension[0].source.pid &&
            getter.script === stagedRouter.file &&
            getter.scriptHash === stagedRouter.sha256 &&
            /^[a-f0-9]{64}$/u.test(getter.scriptHash) &&
            /(?:^|[\\/])node(?:\.exe)?$/iu.test(getter.ExecutablePath) &&
            getter.ExecutablePath === current[0].source.executable &&
            current[0].source.parentPid === getter.ParentProcessId &&
            current[0].source.request === null &&
            Date.parse(getter.observedAt) >=
                Date.parse(current[0].source.observedAt) &&
            Date.parse(getter.observedAt) >=
                Date.parse(layout.controlStartedAt) &&
            Date.parse(getter.observedAt) <= Date.now(),
        "Current compiled getter receipt does not join its actual status child",
    );
}

function assertNativeWorkiqHookObservations(
    layout,
    hooks,
    getter,
    current,
    sessionId,
) {
    for (const record of hooks) {
        const source = record.source;
        const observedAt = Date.parse(source.observedAt);
        requireNative(
            source.owner === layout.owner &&
                record.configPath ===
                    path.join(layout.pluginData, "config.json") &&
                record.dataRoot === layout.data &&
                source.readableOwnedConfig === true &&
                source.expectedMode === record.effectiveMode &&
                /^[a-f0-9]{64}$/u.test(record.digest ?? "") &&
                Number.isFinite(observedAt) &&
                observedAt >= Date.parse(layout.controlStartedAt) &&
                observedAt <= Date.now(),
            "Native hook control observation is outside the current owned root",
        );
        if (source.request === null)
            requireNative(
                source.parentPid === getter.ParentProcessId &&
                    source.executable === getter.ExecutablePath &&
                    source.cwd === layout.workspace &&
                    observedAt <= Date.parse(current.source.observedAt) &&
                    (record.effectiveMode !== current.effectiveMode ||
                        record.digest === current.digest),
                "Historical getter does not belong to the current status actor",
            );
        else
            requireNative(
                source.request?.sessionId === sessionId &&
                    source.request.cwd === layout.workspace &&
                    source.cwd === layout.plugin &&
                    record.effectiveMode === current.effectiveMode &&
                    record.digest === current.digest,
                "Normal hook control is not the current session/owned route",
            );
    }
}

const nativeControlActorSnapshots = new WeakSet();
const nativeMcpRoles = Object.freeze({
    "mcp-agent": [],
    "mcp-workspace": ["--workspace"],
    "mcp-macros": ["--macros"],
    "mcp-skills": ["--skills"],
});

function matchesNativeCommandLine(commandLine, args, caseSensitive = false) {
    if (typeof commandLine !== "string") return false;
    const pattern = args
        .map((alternatives) =>
            alternatives
                .map((argument) => {
                    const exact = argument.replace(
                        /[.*+?^${}()|[\]\\]/gu,
                        "\\$&",
                    );
                    return /\s/u.test(argument)
                        ? `"${exact}"`
                        : `(?:"${exact}"|${exact})`;
                })
                .join("|"),
        )
        .map((argument) => `(?:${argument})`)
        .join("\\s+");
    return new RegExp(`^\\s*${pattern}\\s*$`, caseSensitive ? "u" : "iu").test(
        commandLine,
    );
}

function matchesCurrentMcpControlSource(layout, source, snapshot) {
    const at = Date.parse(source?.observedAt);
    return (
        Number.isSafeInteger(source.pid) &&
        source.parentPid === snapshot.cli.ProcessId &&
        source.executable === snapshot.nodeExecutable &&
        Number.isFinite(at) &&
        at >= Date.parse(layout.controlStartedAt) &&
        at <= snapshot.observedAtMs
    );
}

function validateMcpControlObservation(layout, record, snapshot) {
    const source = record.source;
    requireNative(
        Object.hasOwn(nativeMcpRoles, source?.component ?? "") &&
            source.owner === layout.owner &&
            record.dataRoot === layout.data &&
            record.configPath === path.join(layout.pluginData, "config.json") &&
            source.expectedConfigPath === record.configPath &&
            source.config === "CLAUDE_PLUGIN_DATA" &&
            source.mode === "config" &&
            source.cwd === layout.plugin &&
            source.instance === layout.instance &&
            source.server === `ws://127.0.0.1:${layout.port}` &&
            source.readableOwnedConfig === true &&
            source.expectedMode === record.effectiveMode &&
            source.request === null &&
            ["direct", "mcp", "dev", "bypass"].includes(record.effectiveMode) &&
            ["delegate", "mixed"].includes(source.routing) &&
            /^[a-f0-9]{64}$/u.test(record.digest ?? "") &&
            matchesCurrentMcpControlSource(layout, source, snapshot) &&
            record.digest ===
                hash(
                    JSON.stringify({
                        configPath: record.configPath,
                        dataRoot: record.dataRoot,
                        effectiveMode: record.effectiveMode,
                        mcpRouting: source.routing,
                    }),
                ),
        "MCP control observation is outside its current source-qualified root",
    );
}

export function selectNativeWorkiqCurrentMcpControls(
    layout,
    records,
    snapshot,
) {
    requireNative(
        nativeControlActorSnapshots.has(snapshot),
        "Current MCP selection requires private source-owned OS/SDK authority",
    );
    const selected = [],
        historical = [];
    for (const record of records) {
        validateMcpControlObservation(layout, record, snapshot);
        const actor = snapshot.actors.find(
            (row) => row.ProcessId === record.source.pid,
        );
        if (!actor) {
            historical.push(record);
            continue;
        }
        requireNative(
            snapshot.tree.some((row) => identityMatches(row, actor)) &&
                actor.ParentProcessId === record.source.parentPid &&
                actor.ExecutablePath === record.source.executable &&
                Number.isSafeInteger(actor.StartedMs) &&
                actor.StartedMs >= snapshot.cli.StartedMs &&
                actor.StartedMs <= Date.parse(record.source.observedAt) &&
                matchesNativeCommandLine(actor.CommandLine, [
                    [actor.ExecutablePath, "node", "node.exe"],
                    ...snapshot.roleArgs[record.source.component].map(
                        (argument) => [argument],
                    ),
                ]),
            "MCP producer PID/lifetime/argv no longer joins its actual owned actor",
        );
        const flags = nativeMcpRoles[record.source.component];
        requireNative(
            flags.length === 0 ||
                new RegExp(
                    `${flags.map((flag) => `(?:"${flag}"|${flag})`).join("\\s+")}\\s*$`,
                    "u",
                ).test(actor.CommandLine),
            "MCP role argv flag differs from its case-sensitive declared role",
        );
        selected.push(record);
    }
    for (const role of Object.keys(nativeMcpRoles)) {
        const current = selected.filter(
            (record) => record.source.component === role,
        );
        requireNative(
            current.length === 1,
            "Current MCP physical role is missing or ambiguous",
        );
        requireNative(
            historical
                .filter((record) => record.source.component === role)
                .every(
                    (record) =>
                        Date.parse(record.source.observedAt) <
                        Date.parse(current[0].source.observedAt),
                ),
            "Historical MCP chronology does not precede its current actor",
        );
    }
    requireNative(
        new Set(selected.map((record) => record.source.pid)).size === 4 &&
            selected.every(
                (record) =>
                    record.digest === snapshot.configDigest &&
                    record.effectiveMode === snapshot.effectiveMode,
            ),
        "Current MCP actors conflict with the actual getter/config controls",
    );
    return { selected, historical };
}

export function selectNativeWorkiqGetterControls(
    layout,
    records,
    getter,
    stagedRouter,
    sessionId,
) {
    const extension = records.filter(
        (record) => record.source?.component === "native-extension-status",
    );
    const hooks = records.filter(
        (record) => record.source?.component === "native-hook",
    );
    const current = hooks.filter(
        (record) => record.source.pid === getter?.ProcessId,
    );
    assertNativeWorkiqGetterReceipt(
        layout,
        getter,
        stagedRouter,
        extension,
        current,
    );
    assertNativeWorkiqHookObservations(
        layout,
        hooks,
        getter,
        current[0],
        sessionId,
    );
    return records.filter(
        (record) =>
            record.source.component !== "native-hook" || record === current[0],
    );
}

export function assertNativeWorkiqCompletedRecording(
    recording,
    summary,
    sessionId,
) {
    requireNative(
        recording?.status === "completed" &&
            summary?.sessionId === sessionId &&
            ["traceId", "sessionId", "createdAt", "toolCallCount"].every(
                (key) =>
                    summary[key] !== undefined &&
                    recording.trace?.[key] === summary[key],
            ) &&
            (recording.token === undefined ||
                recording.token?.sessionId === sessionId),
        "Finalized WorkIQ SDK trace is not the actual current recording lease",
    );
}

export function validateNativeWorkiqHookTarget(target, expected = target) {
    requireNative(
        target &&
            Object.keys(target).sort().join(",") ===
                "configDigest,cwd,deadlineMs,mode,prompt,sessionId,submittedAtMs" &&
            Number.isSafeInteger(target.submittedAtMs) &&
            Number.isSafeInteger(target.deadlineMs) &&
            target.deadlineMs > target.submittedAtMs &&
            ["direct", "mcp", "dev", "bypass"].includes(target.mode) &&
            /^[a-f0-9]{64}$/u.test(target.configDigest ?? "") &&
            Object.keys(target).every((key) => target[key] === expected?.[key]),
        "Complete lexical native hook target context is required",
    );
    nativeInputIdentity({
        sessionId: target.sessionId,
        prompt: target.prompt,
        cwd: target.cwd,
        timestamp: target.submittedAtMs,
    });
    return target;
}

export function createNativeWorkiqHookTarget(context) {
    const target = Object.freeze({
        sessionId: context.sessionId,
        prompt: context.prompt,
        cwd: context.workspace,
        submittedAtMs: context.submittedAtMs,
        deadlineMs: context.deadlineMs,
        mode: context.mode,
        configDigest: context.configDigest,
    });
    return validateNativeWorkiqHookTarget(target);
}

function assertNativeWorkiqRecordingToken(token, request) {
    requireNative(
        typeof request.learning === "boolean" &&
            token?.status === "armed" &&
            token.sessionId === request.sessionId &&
            (request.learning
                ? token.learning === true && token.cwd === request.cwd
                : token.learning === undefined || token.learning === false),
        "Actual native WorkIQ recording token lost its boolean learning/workspace contract",
    );
}

function assertNativeWorkiqPrepareRecording(recording, summary, workspace) {
    requireNative(
        typeof summary.learningJobId === "string" &&
            summary.learningJobId.length > 0 &&
            recording.learningJob?.jobId === summary.learningJobId &&
            recording.learningJob.traceId === summary.traceId &&
            recording.learningJob.sessionId === summary.sessionId &&
            recording.learningJob.mode === "prepare" &&
            recording.learningJob.cwd === path.resolve(workspace).toLowerCase(),
        "Actual native WorkIQ Prepare recording has no matching source learning job",
    );
}

export function nativeWorkiqConsoleEnvironment(layout, config, home) {
    return {
        TYPEAGENT_HOST: "127.0.0.1",
        TYPEAGENT_PORT: String(config.port),
        CLAUDE_PLUGIN_DATA: layout.pluginData,
        TYPEAGENT_USER_DATA_DIR: layout.data,
        COPILOT_HOME: home,
        INSTANCE_NAME: layout.instance,
        ...Object.fromEntries(
            ["RECORDING", "INDUCTION", "REPLAY", "AGENT_HANDOFF"].map(
                (name) => [`TYPEAGENT_MACRO_${name}_ENABLED`, "true"],
            ),
        ),
    };
}

export function nativeWorkiqControlAdmission(layout, configPath) {
    return {
        owner: layout.owner,
        ownedRoot: layout.run,
        configPath,
        expectedMode: "bypass",
        diagnosticTransitions: true,
        workiqOriginals: {
            schemaVersion: 1,
            kind: "workiq-native-capture-opt-in-v1",
            exposureOverride: "user-authorized-unverified-model-exposure",
        },
    };
}

export function resolveNativeWorkiqSignal(
    signal = new AbortController().signal,
) {
    requireNative(
        signal instanceof AbortSignal,
        "Native WorkIQ requires an actual abort signal",
    );
    return signal;
}

function hasBoundedWorkiqBudget(config) {
    return (
        Number.isSafeInteger(config.maxTargetModelTurns) &&
        config.maxTargetModelTurns > 0 &&
        config.maxTargetModelTurns <= 20 &&
        Number.isSafeInteger(config.maxDurationMs) &&
        config.maxDurationMs > 0 &&
        config.maxDurationMs <= 300000
    );
}

export function validateWorkiqNativeRuntimeConfig(config) {
    requireNative(
        config &&
            path.isAbsolute(config.cliExecutable ?? "") &&
            path.isAbsolute(config.configDirectory ?? "") &&
            path.isAbsolute(config.helperDirectory ?? "") &&
            Number.isSafeInteger(config.port) &&
            config.port > 1024 &&
            config.port < 65536 &&
            hasBoundedWorkiqBudget(config) &&
            config.extensionMode === "load_only" &&
            config.exposureOverride ===
                "user-authorized-unverified-model-exposure" &&
            typeof config.rootModel === "string" &&
            config.rootModel.length > 0 &&
            (config.cliExecutableSha256 === undefined ||
                /^[a-f0-9]{64}$/u.test(config.cliExecutableSha256)) &&
            /^\d+\.\d+\.\d+$/u.test(config.cliVersion ?? ""),
        "Explicit bounded Windows native WorkIQ configuration is required",
    );
    requireNative(
        !config.budgetAuthorization?.futureCompiledLineage ||
            config.budgetAuthorization.serviceModuleLoadWitness?.required ===
                true,
        "Future product lineage requires a source-owned service module witness configuration",
    );
}

export function verifyNativeWorkiqExecutablePin(config, frozen) {
    requireNative(
        frozen.executable === config.cliExecutable &&
            (config.cliExecutableSha256 === undefined ||
                frozen.sha256 === config.cliExecutableSha256),
        "Native WorkIQ executable does not match the admitted original identity",
    );
}

export function readNativeWorkiqSessionEvents(
    home,
    { sessionId, required = false } = {},
) {
    const sessions = path.join(home, "session-state");
    const candidates = fs.existsSync(sessions)
        ? fs
              .readdirSync(physical(sessions))
              .map((name) => path.join(sessions, name, "events.jsonl"))
              .filter((file) => fs.existsSync(file))
        : [];
    requireNative(
        candidates.length <= 1,
        "Native WorkIQ current SDK session events are ambiguous",
    );
    if (!sessionId || candidates.length === 0) {
        requireNative(
            !required,
            "Native WorkIQ requires source-bound current SDK session events",
        );
        return [];
    }
    requireNative(
        path.basename(path.dirname(candidates[0])) === sessionId,
        "Native WorkIQ current SDK events have a foreign source SID",
    );
    physical(path.dirname(candidates[0]));
    const current = readNativeJsonl(physical(candidates[0]));
    const starts = current.filter((event) => event.type === "session.start");
    requireNative(
        starts.length <= 1 &&
            starts.every((event) => event.data?.sessionId === sessionId),
        "Native WorkIQ current SDK session start is ambiguous or foreign",
    );
    if (starts.length === 0) {
        requireNative(
            !required,
            "Native WorkIQ current SDK session start is not ready",
        );
        return [];
    }
    return current;
}

export function verifyNativeWorkiqBootstrapArtifacts(
    layout,
    stagedRuntime,
    compiledExtension,
) {
    physical(layout.workspace);
    requireNative(
        stagedRuntime &&
            compiledExtension &&
            isDeepStrictEqual(
                inventory(physical(layout.plugin)),
                stagedRuntime,
            ) &&
            hash(fs.readFileSync(physical(compiledExtension.file))) ===
                compiledExtension.sha256,
        "Bootstrap workspace/hooks consent lacks current staged source proof",
    );
}

export function snapshotNativeWorkiqRuntimeConfig(config) {
    validateWorkiqNativeRuntimeConfig(config);
    return Object.freeze(structuredClone(config));
}

function physical(file) {
    const info = fs.lstatSync(file);
    requireNative(
        !info.isSymbolicLink() &&
            (!info.isFile() || info.nlink === 1) &&
            fs.realpathSync(file) === path.resolve(file),
        "Native WorkIQ path must be physical and canonical",
    );
    return file;
}

function inventory(root) {
    return fs
        .readdirSync(root, { withFileTypes: true })
        .flatMap((entry) => {
            const file = physical(path.join(root, entry.name));
            return entry.isDirectory()
                ? inventory(file)
                : [{ file, sha256: hash(fs.readFileSync(file)) }];
        })
        .sort((left, right) => left.file.localeCompare(right.file));
}

export function verifyWorkiqSdkToolInventory(tools, discovery) {
    requireNative(
        Array.isArray(tools) &&
            tools.length === 4 &&
            new Set(tools.map((tool) => tool.name)).size === 4 &&
            discovery.tools.length === 3,
        "Current WorkIQ inventory must be three actual MCP tools plus builtin task",
    );
    for (const expected of discovery.tools) {
        const current = tools.find(
            (tool) => tool.name === expected.callableName,
        );
        requireNative(
            current &&
                current.mcpServerName === expected.mcpServerName &&
                current.mcpToolName === expected.advertisedName &&
                current.namespacedName ===
                    `${expected.mcpServerName}/${expected.advertisedName}` &&
                isDeepStrictEqual(current.input_schema, expected.inputSchema),
            "Current WorkIQ MCP source/alias identity differs from discovery",
        );
    }

    const task = tools.find((tool) => tool.name === "task");
    requireNative(
        task &&
            task.mcpServerName === undefined &&
            task.mcpToolName === undefined,
        "WorkIQ task source must be the actual builtin task",
    );
}

export function assertNativeWorkiqSelectedToolOutcomes(events, tools) {
    const starts = new Map();
    for (const event of events) {
        const data = event.data ?? {};
        if (event.type === "tool.execution_start") {
            const selected = tools.find(
                (tool) => tool.callableName === data.toolName,
            );
            if (!selected) continue;
            requireNative(
                data.mcpServerName === selected.mcpServerName &&
                    data.mcpToolName === selected.advertisedName,
                "Actual selected WorkIQ SDK tool alias identity drift",
            );
            requireNative(
                typeof data.toolCallId === "string" &&
                    data.toolCallId.length > 0 &&
                    !starts.has(data.toolCallId),
                "Actual selected WorkIQ SDK call identity ambiguous",
            );
            starts.set(data.toolCallId, data.toolName);
        } else if (
            event.type === "tool.execution_complete" &&
            starts.has(data.toolCallId) &&
            data.success !== true
        ) {
            throw Object.assign(
                new Error("Actual selected WorkIQ SDK tool completion failed"),
                {
                    status: "blocked",
                    sdkToolName: starts.get(data.toolCallId),
                    sdkErrorCode: ["failure", "denied"].includes(
                        data.error?.code,
                    )
                        ? data.error.code
                        : "unknown",
                    sdkReasonCode: String(data.error?.message ?? "").includes(
                        "workiqScopeMismatch",
                    )
                        ? "workiqScopeMismatch"
                        : undefined,
                    sdkEventId: event.id,
                },
            );
        }
    }
}

function powershell(file, args, timeout) {
    return execFileSync(
        "powershell.exe",
        ["-NoProfile", "-File", file, ...args],
        {
            timeout,
            encoding: "utf8",
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
}

export function awaitNativeWorkiqLauncher(command, args, { timeout, signal }) {
    return new Promise((resolve, reject) => {
        let failure;
        let stdout = "";
        let stderr = "";
        const child = spawn(command, args, {
            timeout,
            signal,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
        });
        child.stdout.setEncoding("utf8").on("data", (text) => (stdout += text));
        child.stderr.setEncoding("utf8").on("data", (text) => (stderr += text));
        child.once("error", (error) => {
            failure = error;
        });
        child.once("close", (status, terminatedSignal) => {
            const evidence = {
                pid: child.pid,
                status,
                signal: terminatedSignal,
                stdout,
                stderr,
            };
            if (failure || status !== 0) {
                reject(
                    Object.assign(
                        failure ??
                            new Error("Owned native WorkIQ launch failed"),
                        evidence,
                    ),
                );
            } else resolve(evidence);
        });
    });
}

function consoleAllocationTitles(allocations) {
    return allocations.flatMap((entry) => {
        const ownerFile = path.join(entry.console, "owner.json");
        if (!fs.existsSync(ownerFile)) return [];
        const title = read(ownerFile).title;
        requireNative(
            typeof title === "string" &&
                title.length > 0 &&
                (entry.title === undefined || entry.title === title),
            "Owned console allocation title changed",
        );
        entry.title ??= title;
        return [title];
    });
}

function bootstrapReceipt(consoleRun, launchFile, outcome) {
    return {
        kind: "native-workiq-private-bootstrap-receipt-v1",
        observedAt: new Date().toISOString(),
        admission: false,
        outcome,
        files: [
            launchFile,
            ...["owner.json", "console-state.json"].map((name) =>
                path.join(consoleRun, name),
            ),
        ].map((file) => {
            if (!fs.existsSync(file)) return { file, present: false };
            const bytes = fs.readFileSync(file);
            return {
                file,
                present: true,
                sha256: hash(bytes),
                utf8: bytes.toString("utf8"),
            };
        }),
    };
}

function partialConsoleBridgeIdentity(allocation, helperDirectory) {
    const stateFile = path.join(allocation.console, "console-state.json");
    if (!fs.existsSync(stateFile)) return undefined;
    const saved = read(stateFile);
    if (!Number.isSafeInteger(saved.bridgePid)) return undefined;
    const actor = JSON.parse(
        execFileSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-Command",
                `. $PROFILE; $ErrorActionPreference='Stop'; ` +
                    `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${saved.bridgePid}"; ` +
                    `if($p){@{ProcessId=$p.ProcessId;ParentProcessId=$p.ParentProcessId;` +
                    `StartedMs=([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds();` +
                    `ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine}|ConvertTo-Json -Compress}else{'null'}`,
            ],
            { timeout: 10000, encoding: "utf8" },
        ),
    );
    return matchesPartialConsoleBridge(
        actor,
        allocation,
        saved,
        helperDirectory,
    )
        ? actor
        : undefined;
}

export function matchesPartialConsoleBridge(
    actor,
    allocation,
    saved,
    helperDirectory,
) {
    if (!actor || typeof actor.CommandLine !== "string") return false;
    const args = [
        process.execPath,
        path.join(helperDirectory, "console-bridge.mjs"),
        allocation.launchFile,
        allocation.console,
    ].map((argument) => [argument]);
    return (
        actor.ProcessId === saved.bridgePid &&
        actor.ExecutablePath?.toLowerCase() ===
            process.execPath.toLowerCase() &&
        Number.isSafeInteger(actor.StartedMs) &&
        actor.StartedMs >= Date.parse(allocation.allocatedAt) &&
        Date.parse(saved.startedAt) >= actor.StartedMs &&
        Date.parse(saved.startedAt) - actor.StartedMs <= 10000 &&
        matchesNativeCommandLine(actor.CommandLine, args)
    );
}

function identityMatches(left, right) {
    return (
        left?.ProcessId === right?.ProcessId &&
        left?.StartedMs === right?.StartedMs &&
        left?.ExecutablePath === right?.ExecutablePath
    );
}

function stopOwnedIdentities(identities) {
    const dispositions = [];
    for (const actor of identities.toReversed()) {
        requireNative(
            Number.isSafeInteger(actor.ProcessId) &&
                Number.isSafeInteger(actor.StartedMs) &&
                typeof actor.ExecutablePath === "string",
            "Exact native WorkIQ process identity is required for cleanup",
        );
        const exe = actor.ExecutablePath.replaceAll("'", "''");
        const disposition = JSON.parse(
            execFileSync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-Command",
                    `. $PROFILE; $ErrorActionPreference='Stop'; ` +
                        `$filter="ProcessId=${actor.ProcessId}"; $held=$null; $result=@{ProcessId=${actor.ProcessId};StartedMs=${actor.StartedMs};ExecutablePath='${exe}';status='alreadyAbsent'}; ` +
                        `try { $p=Get-CimInstance Win32_Process -Filter $filter -ErrorAction Stop; ` +
                        `if($p){ if(([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() -ne ${actor.StartedMs} -or $p.ExecutablePath -cne '${exe}'){throw 'Owned cleanup PID lifetime/executable changed'}; ` +
                        `try { $held=Get-Process -Id ${actor.ProcessId} -ErrorAction Stop; $handle=$held.Handle; ` +
                        `if(([DateTimeOffset]$held.StartTime).ToUnixTimeMilliseconds() -ne ${actor.StartedMs} -or $held.Path -cne '${exe}'){throw 'Owned cleanup held process identity changed'}; ` +
                        `Stop-Process -Id ${actor.ProcessId} -Force -ErrorAction Stop; $result.status='stopped' ` +
                        `} catch { if($_.FullyQualifiedErrorId -notlike 'NoProcessFoundForGivenId,*'){throw}; ` +
                        `$after=Get-CimInstance Win32_Process -Filter $filter -ErrorAction Stop; if($after){throw}; ` +
                        `$result.status='exitedBeforeStop'; $result.originalErrorId=$_.FullyQualifiedErrorId; $result.originalError=$_.Exception.Message } }; ` +
                        `$result | ConvertTo-Json -Compress } finally { if($held){$held.Dispose()} }`,
                ],
                {
                    timeout: 10000,
                    encoding: "utf8",
                    stdio: ["ignore", "pipe", "pipe"],
                },
            ),
        );
        requireNative(
            identityMatches(disposition, actor) &&
                ["alreadyAbsent", "stopped", "exitedBeforeStop"].includes(
                    disposition.status,
                ),
            "Owned native WorkIQ shutdown disposition is invalid",
        );
        dispositions.push(disposition);
    }
    for (const actor of identities)
        requireNative(
            !processTree(actor.ProcessId).some((row) =>
                identityMatches(row, actor),
            ),
            "Owned native WorkIQ actor survived shutdown",
        );
    return dispositions;
}

function ownWorkiqLayout(output, config) {
    const run = path.resolve(output);
    const relative = path.relative(path.resolve(directory, ".."), run);
    requireNative(
        relative !== "" &&
            !relative.startsWith("..") &&
            !path.isAbsolute(relative),
        "WorkIQ output must be a fresh evaluator-owned directory",
    );
    fs.mkdirSync(run);
    const owner = randomUUID();
    write(path.join(run, "evaluation-owner.json"), {
        owner,
        createdAt: new Date().toISOString(),
        kind: "native-workiq-experimental-owner-v1",
    });
    const layout = {
        run,
        owner,
        workspace: path.join(run, "workspace"),
        plugin: path.join(run, "plugin"),
        pluginData: path.join(run, "plugin-data"),
        data: path.join(run, "data"),
        instance: `macro-eval-${owner.slice(0, 8)}`,
        port: config.port,
    };
    for (const name of ["workspace", "pluginData", "data"])
        fs.mkdirSync(layout[name]);
    write(path.join(layout.pluginData, "config.json"), {
        mode: "bypass",
        powershell: { enabled: false },
    });
    write(
        path.join(layout.data, "native-control-admission.json"),
        nativeWorkiqControlAdmission(
            layout,
            path.join(layout.pluginData, "config.json"),
        ),
    );
    return layout;
}

/**
 * Production-only native runtime. SDK policy/read assertions are composed by
 * the separate WorkIQ controller; this module never grants tool permission.
 */
export async function createNativeWorkiqRuntime({
    output,
    config,
    signal = resolveNativeWorkiqSignal(),
}) {
    config = snapshotNativeWorkiqRuntimeConfig(config);
    signal = resolveNativeWorkiqSignal(signal);
    requireNative(
        process.platform === "win32",
        "Native WorkIQ requires Windows",
    );
    const admittedExecutable = freezeNativeExecutable(config.cliExecutable);
    verifyNativeWorkiqExecutablePin(config, admittedExecutable);
    const layout = ownWorkiqLayout(output, config);
    const budget = createNativeBudget(config, signal);
    write(path.join(layout.run, "native-runtime-manifest.json"), {
        kind: "native-workiq-experimental-runtime-v1",
        owner: layout.owner,
        executable: admittedExecutable,
        exposureOverride: config.exposureOverride,
        assurance: {
            completePreModelBinaryExposure: "unverified",
            functionalAcceptance: "pending",
        },
        modelRoles: { configuredRoot: config.rootModel, observed: "unknown" },
        bounds: {
            maxTargetModelTurns: config.maxTargetModelTurns,
            maxDurationMs: config.maxDurationMs,
        },
        budgetAuthorization: config.budgetAuthorization ?? null,
        source: [
            "native-workiq-lifecycle.mjs",
            "native-workiq-projection.mjs",
            "macro-eval-native-bridge.mjs",
            "macro-eval-native-callback.mjs",
            "macro-eval-native-hook.mjs",
            "macro-eval-native-pipe.ps1",
            "macro-eval-workiq-controller.mjs",
            "macro-eval-workiq-native.mjs",
            "native-workiq-service-module-observer.mjs",
        ].map((name) => ({
            file: path.join(directory, name),
            sha256: hash(fs.readFileSync(path.join(directory, name))),
        })),
        helper: [
            "Launch-Demo.ps1",
            "Control-Demo.ps1",
            "console-bridge.mjs",
            "NativeControl.cs",
        ].map((name) => ({
            file: path.join(config.helperDirectory, name),
            sha256: hash(
                fs.readFileSync(path.join(config.helperDirectory, name)),
            ),
        })),
    });
    const { stageCopilotPlugin } = await import(
        "../../../tools/scripts/stageCopilotPlugin.mjs"
    );
    const { checkPort, waitForServer, startProcess } = await import(
        "../../copilot-plugin/scripts/discovery-e2e.mjs"
    );
    const { childEnvironment } = await import(
        pathToFileURL(path.join(config.helperDirectory, "console-bridge.mjs"))
    );
    const { connectAgentServer } = await import(
        pathToFileURL(
            path.join(
                tsRoot,
                "packages",
                "agentServer",
                "client",
                "dist",
                "index.js",
            ),
        )
    );
    const state = {
        service: undefined,
        serviceIdentity: undefined,
        connection: undefined,
        console: undefined,
        consoleAbort: undefined,
        consoleIdentities: [],
        consoleAllocations: [],
        histories: [],
        homes: [],
        lease: undefined,
        hook: undefined,
        reader: undefined,
        submission: undefined,
        controlStartedAt: undefined,
        sourceRecords: new WeakSet(),
        initialized: undefined,
        knownSource: undefined,
        eventSessionId: undefined,
        selectedTools: [],
        publication: undefined,
        callback: undefined,
        hookTarget: undefined,
        recordingLearning: undefined,
        serviceModulePlan: undefined,
        serviceModuleMessages: [],
        serviceModuleFailure: undefined,
        serviceModuleHandler: undefined,
        serviceModuleProofIndex: 0,
        controlProofIndex: 0,
        answeredViewports: new Set(),
        ownedIdentities: [],
        stagedRuntime: undefined,
        compiledExtension: undefined,
    };
    const control = (action, text, cleanup = false) =>
        powershell(
            path.join(config.helperDirectory, "Control-Demo.ps1"),
            [
                "-Action",
                action,
                "-RunDirectory",
                state.console,
                ...(text === undefined ? [] : ["-Text", text]),
            ],
            cleanup ? 30000 : nativeControlTimeout(action, budget.remaining()),
        );
    async function startService() {
        budget.check();
        await checkPort(config.port);
        stageCopilotPlugin(layout.plugin);
        const built = path.join(
            tsRoot,
            "packages",
            "copilot-plugin",
            "dist",
            "extensions",
            "typeagent",
            "extension.mjs",
        );
        requireNative(
            hash(fs.readFileSync(built)) ===
                hash(
                    fs.readFileSync(
                        path.join(
                            layout.plugin,
                            "extensions",
                            "typeagent",
                            "extension.mjs",
                        ),
                    ),
                ),
            "WorkIQ staged extension differs from actual compiled source",
        );
        state.hook = stageNativeNormalHook(
            layout,
            Date.now() + budget.remaining(),
        );
        const index = state.consoleAllocations.length;
        state.stagedRuntime = inventory(layout.plugin);
        state.compiledExtension = {
            file: built,
            sha256: hash(fs.readFileSync(built)),
        };
        write(
            path.join(layout.run, `staged-runtime-${index}.json`),
            state.stagedRuntime,
        );
        const out = fs.openSync(
            path.join(layout.run, `service-${index}.stdout.log`),
            "wx",
        );
        const err = fs.openSync(
            path.join(layout.run, `service-${index}.stderr.log`),
            "wx",
        );
        try {
            state.serviceModulePlan = nativeServiceModulePlan(
                layout,
                config,
                index,
            );
            state.serviceModuleMessages = [];
            state.serviceModuleFailure = undefined;
            const plan = state.serviceModulePlan;
            const moduleLog = path.join(
                layout.run,
                `service-module-load-events-${index}.private.jsonl`,
            );
            if (plan)
                fs.writeFileSync(moduleLog, "", { flag: "wx", mode: 0o600 });
            const serviceEntry = path.join(
                tsRoot,
                "packages",
                "agentServer",
                "server",
                "dist",
                "server.js",
            );
            const args = [
                ...(plan
                    ? ["--import", pathToFileURL(plan.observer.file).href]
                    : []),
                serviceEntry,
                "--port",
                String(config.port),
                "--host",
                "127.0.0.1",
                "--config",
                "test",
                "--idle-timeout",
                "600",
            ];
            state.service = startProcess(process.execPath, args, {
                cwd: tsRoot,
                env: {
                    ...cleanServiceEnvironment(process.env, layout, config),
                    ...(plan
                        ? {
                              TYPEAGENT_NATIVE_SERVICE_MODULE_PLAN:
                                  plan.planFile,
                              TYPEAGENT_NATIVE_SERVICE_MODULE_PLAN_SHA256:
                                  plan.planDigest,
                          }
                        : {}),
                },
                stdio: ["ignore", out, err, ...(plan ? ["ipc"] : [])],
            });
            if (plan) {
                state.serviceDeclaredArgs = [process.execPath, ...args];
                const child = state.service.child;
                state.serviceModuleHandler = (message) => {
                    if (
                        typeof message?.kind !== "string" ||
                        !message.kind.startsWith("native-workiq-service-")
                    )
                        return;
                    const receivedAtMs = Date.now();
                    const receivedMonotonicNs = process.hrtime
                        .bigint()
                        .toString();
                    try {
                        requireNative(
                            child === state.service?.child &&
                                message.pid === child.pid &&
                                state.serviceIdentity?.ProcessId === child.pid,
                            "Foreign native service module callback",
                        );
                        validateNativeServiceModuleLoad(
                            plan,
                            state.serviceIdentity,
                            message,
                            receivedMonotonicNs,
                        );
                        const observation = Object.freeze({
                            message: Object.freeze({ ...message }),
                            receivedAtMs,
                            receivedMonotonicNs,
                        });
                        state.serviceModuleMessages.push(observation);
                        fs.appendFileSync(
                            moduleLog,
                            JSON.stringify(observation) + "\n",
                        );
                    } catch (error) {
                        state.serviceModuleFailure = error;
                        fs.appendFileSync(
                            moduleLog,
                            JSON.stringify({
                                receivedAtMs,
                                rejected: error.message,
                                fieldNames: Object.keys(message),
                            }) + "\n",
                        );
                    }
                };
                child.on("message", state.serviceModuleHandler);
            }
        } finally {
            fs.closeSync(out);
            fs.closeSync(err);
        }
        state.serviceIdentity = processTree(state.service.child.pid).find(
            (row) => row.ProcessId === state.service.child.pid,
        );
        state.ownedIdentities.push(...processTree(state.service.child.pid));
        requireNative(
            state.serviceIdentity,
            "Owned WorkIQ service root missing",
        );
        await budget.run(
            waitForServer(
                state.service,
                config.port,
                Math.min(120, budget.remaining() / 1000),
                signal,
                path.join(layout.run, `service-${index}.stderr.log`),
            ),
        );
        await admitServiceListener();
        state.connection = await budget.run(
            connectAgentServer(`ws://127.0.0.1:${config.port}`),
        );
        const macros = await budget.run(
            state.connection.listMacros({ limit: 100 }),
        );
        if (state.serviceModulePlan) {
            const deadline = Date.now() + Math.min(5000, budget.remaining());
            while (
                state.serviceModuleMessages.length < 6 &&
                Date.now() < deadline
            ) {
                budget.check();
                if (state.serviceModuleFailure)
                    throw state.serviceModuleFailure;
                await delay(50);
            }
            proveCurrentServiceModules(null);
        }
        return macros;
    }
    function proveCurrentServiceModules(sessionId) {
        const plan = state.serviceModulePlan;
        if (!plan) return undefined;
        if (state.serviceModuleFailure) throw state.serviceModuleFailure;
        const id = state.service?.child.pid;
        requireNative(
            id === state.serviceIdentity?.ProcessId,
            "Current module witness service missing",
        );
        const actor = JSON.parse(
            execFileSync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-Command",
                    `. $PROFILE; $ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter "ProcessId=${id}" -ErrorAction Stop; ` +
                        `if($p){@{ProcessId=$p.ProcessId;ParentProcessId=$p.ParentProcessId;StartedMs=([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds();ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine}|ConvertTo-Json -Compress}else{'null'}`,
                ],
                {
                    timeout: Math.min(10000, budget.remaining()),
                    encoding: "utf8",
                },
            ),
        );
        requireNative(
            identityMatches(actor, state.serviceIdentity) &&
                actor.ParentProcessId === process.pid &&
                actor.ExecutablePath === plan.nodeExecutable &&
                matchesNativeCommandLine(
                    actor.CommandLine,
                    state.serviceDeclaredArgs.map((argument) => [argument]),
                    true,
                ) &&
                hash(fs.readFileSync(plan.observer.file)) ===
                    plan.observer.sha256 &&
                hash(fs.readFileSync(plan.serviceEntry)) ===
                    plan.serviceEntrySha256 &&
                hash(fs.readFileSync(plan.planFile)) === plan.planDigest,
            "Current service module observer OS/source/argv lifetime changed",
        );
        const records = state.serviceModuleMessages.map(
            ({ message, receivedMonotonicNs }) =>
                validateNativeServiceModuleLoad(
                    plan,
                    actor,
                    message,
                    receivedMonotonicNs,
                ),
        );
        requireNative(
            records.length === 6 &&
                new Set(records.map((record) => record.role)).size === 6 &&
                records.some(
                    (record) => record.role === "normal-service-entry",
                ) &&
                plan.modules.every(
                    (entry) =>
                        records.some((record) => record.role === entry.role) &&
                        hash(fs.readFileSync(entry.realPath)) === entry.sha256,
                ),
            "Actual native service module coverage is missing/ambiguous or bytes changed",
        );
        const proof = Object.freeze({
            owner: layout.owner,
            ownedRoot: layout.run,
            sessionId,
            manifestDigest: plan.manifestDigest,
            planDigest: plan.planDigest,
            actor: Object.freeze(actor),
            observer: Object.freeze({ ...plan.observer }),
            entryLoad: records.find(
                (record) => record.role === "normal-service-entry",
            ),
            modules: Object.freeze(
                records.filter(
                    (record) => record.role !== "normal-service-entry",
                ),
            ),
            observedAtMs: Date.now(),
            loadBoundary:
                "actual normal Node load bytes; evaluation/readiness verified separately",
        });
        nativeServiceModuleSnapshots.add(proof);
        write(
            path.join(
                layout.run,
                `service-module-load-proof-${state.serviceModuleProofIndex++}.private.json`,
            ),
            { serializedNativeAuthority: false, proof },
        );
        return assertNativeWorkiqServiceModules(proof);
    }
    async function admitServiceListener() {
        let admitted = false;
        const observations = [];
        const deadline = Date.now() + Math.min(30000, budget.remaining());
        while (!admitted && Date.now() < deadline) {
            budget.check();
            const previousTree = processTree(state.service.child.pid);
            const listeners = probeWindowsServiceListeners(
                config.port,
                path.join(layout.run, "windows-os-probe"),
            );
            const tree = processTree(state.service.child.pid);
            observations.push({
                at: new Date().toISOString(),
                previousTree,
                tree,
                listeners,
            });
            try {
                admitted = validateOwnedServiceListener(
                    state.serviceIdentity,
                    tree,
                    listeners,
                    config.port,
                    previousTree,
                );
            } catch (error) {
                if (Date.now() >= deadline) throw error;
                await delay(200);
            }
        }
        write(
            path.join(
                layout.run,
                `service-readiness-${state.histories.length}.json`,
            ),
            { supervisor: state.serviceIdentity, observations },
        );
        requireNative(admitted, "Actual owned WorkIQ listener unproved");
    }
    async function openConsole({ discovery, mcpConfiguration, policyPath }) {
        budget.check();
        requireNative(
            state.connection && !state.console,
            "WorkIQ service/console lifecycle mismatch",
        );
        state.selectedTools = structuredClone(discovery.tools);
        const index = state.histories.length;
        const home = path.join(layout.run, `home-${index}`);
        fs.mkdirSync(home);
        write(path.join(home, "settings.json"), {
            extensions: { mode: "load_only" },
        });
        const mcpFile = path.join(layout.workspace, ".mcp.json");
        requireNative(
            policyPath ===
                path.join(layout.data, "native-workiq-originals-policy.json") &&
                !fs.existsSync(policyPath),
            "Native WorkIQ bootstrap requires its fresh exact owned SDK policy path",
        );
        requireNative(
            !fs.existsSync(mcpFile),
            "WorkIQ MCP bootstrap cannot overwrite prior scope",
        );
        write(mcpFile, mcpConfiguration);
        const frozen = freezeNativeExecutable(config.cliExecutable);
        verifyNativeExecutable(admittedExecutable);
        verifyNativeWorkiqExecutablePin(config, frozen);
        const environment = nativeWorkiqConsoleEnvironment(
            layout,
            config,
            home,
        );
        const version = execFileSync(
            frozen.resolvedExecutable,
            ["--no-auto-update", "--experimental", "--version"],
            {
                cwd: layout.workspace,
                env: childEnvironment(process.env, home, environment),
                encoding: "utf8",
                timeout: Math.min(10000, budget.remaining()),
            },
        );
        validateNativeCliVersion(version, config.cliVersion);
        verifyNativeExecutable(frozen);
        const launch = {
            command: frozen.resolvedExecutable,
            workspace: layout.workspace,
            environment,
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
                `@${mcpFile}`,
                "--available-tools",
                ...discovery.tools.map((tool) => tool.callableName),
                "builtin:task",
                "--log-dir",
                path.join(layout.run, `cli-logs-${index}`),
            ],
        };
        const launchFile = path.join(
            layout.run,
            `console-${index}.private.json`,
        );
        write(launchFile, launch);
        state.console = path.join(layout.run, `console-${index}`);
        state.consoleAbort = new AbortController();
        state.controlStartedAt = new Date().toISOString();
        state.homes.push(home);
        const allocation = {
            console: state.console,
            index,
            launchFile,
            home,
            allocatedAt: state.controlStartedAt,
            admitted: false,
        };
        state.consoleAllocations.push(allocation);
        try {
            const outcome = await awaitNativeWorkiqLauncher(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-File",
                    path.join(config.helperDirectory, "Launch-Demo.ps1"),
                    "-ConfigPath",
                    launchFile,
                    "-RunDirectory",
                    state.console,
                    "-NodePath",
                    process.execPath,
                    "-TimeoutSeconds",
                    "30",
                ],
                { timeout: Math.min(45000, budget.remaining()), signal },
            );
            write(
                path.join(layout.run, `bootstrap-${index}.private.json`),
                bootstrapReceipt(state.console, launchFile, outcome),
            );
            consoleAllocationTitles([allocation]);
            budget.check();
        } catch (error) {
            const evidenceErrors = [];
            try {
                consoleAllocationTitles([allocation]);
                const actor = partialConsoleBridgeIdentity(
                    allocation,
                    config.helperDirectory,
                );
                if (actor) {
                    state.consoleIdentities = [actor];
                    state.ownedIdentities.push(actor);
                }
            } catch (evidenceError) {
                evidenceErrors.push(evidenceError.message);
            }
            write(
                path.join(layout.run, `bootstrap-${index}.private.json`),
                bootstrapReceipt(state.console, launchFile, {
                    message: error.message,
                    name: error.name,
                    code: error.code,
                    pid: error.pid,
                    status: error.status,
                    signal: error.signal,
                    stdout: error.stdout,
                    stderr: error.stderr,
                    evidenceErrors,
                }),
            );
            throw error;
        }
        const launched = read(path.join(state.console, "console-state.json"));
        requireNative(
            launched.phase === "running",
            "WorkIQ native bridge did not launch",
        );
        const bridge = partialConsoleBridgeIdentity(
            allocation,
            config.helperDirectory,
        );
        requireNative(bridge, "Actual source-owned native bridge is unproved");
        const launchedTree = processTree(launched.bridgePid);
        requireNative(
            launchedTree.some((row) => identityMatches(row, bridge)),
            "Source-owned native bridge identity changed during startup",
        );
        state.consoleIdentities = launchedTree;
        state.ownedIdentities.push(...state.consoleIdentities);
        requireNative(
            state.consoleIdentities.some(
                (row) => row.ProcessId === launched.cliPid,
            ),
            "Native WorkIQ CLI is not an actual owned bridge child",
        );
        write(
            path.join(state.console, "process-identities.json"),
            state.consoleIdentities,
        );
        state.histories.push({
            console: state.console,
            home,
            cliPid: launched.cliPid,
            frozen,
        });
        allocation.admitted = true;
        for (const action of ["Compile", "Select", "Restore", "Verify"])
            control(action);
        state.reader = await startNativeNormalHookReader({
            layout,
            staged: state.hook,
            budget,
            index,
            probe: (pid) =>
                processTree(pid).find((row) => row.ProcessId === pid),
            cli: {
                ...state.consoleIdentities.find(
                    (row) => row.ProcessId === launched.cliPid,
                ),
                sha256: frozen.sha256,
            },
        });
        state.ownedIdentities.push(state.reader.server);
        return { home, consoleRun: state.console, cliPid: launched.cliPid };
    }
    function assertCurrentActor(controlRecord) {
        const actor = controlRecord.source;
        const launched = read(path.join(state.console, "console-state.json"));
        const rows = processTree(launched.bridgePid);
        const bridge = state.consoleIdentities.find(
            (row) => row.ProcessId === launched.bridgePid,
        );
        requireNative(
            bridge &&
                rows.some((row) => identityMatches(row, bridge)) &&
                rows.some(
                    (row) =>
                        row.ProcessId === actor.pid &&
                        row.ParentProcessId === actor.parentPid &&
                        row.ExecutablePath?.toLowerCase() ===
                            actor.executable?.toLowerCase(),
                ) &&
                actor.owner === layout.owner &&
                controlRecord.configPath ===
                    path.join(layout.pluginData, "config.json") &&
                controlRecord.dataRoot === layout.data &&
                actor.cwd === layout.workspace &&
                actor.readableOwnedConfig === true &&
                actor.config === "CLAUDE_PLUGIN_DATA" &&
                actor.instance === layout.instance &&
                actor.server === `ws://127.0.0.1:${config.port}`,
            "WorkIQ SDK producer is not the actual owned native actor/root",
        );
        return rows.find((row) => row.ProcessId === actor.pid);
    }
    function claimTrial(sessionSource, entityKey) {
        requireNative(
            !state.lease,
            "WorkIQ native trial lease is already active",
        );
        requireNative(
            state.sourceRecords.has(sessionSource) &&
                ["A", "B"].includes(entityKey),
            "Native WorkIQ lease requires source-loaded SDK identity and frozen A/B entity",
        );
        const actor = assertCurrentActor(sessionSource.source.control);
        state.lease = Object.freeze({
            trialLeaseId: randomUUID(),
            owner: layout.owner,
            sessionId: sessionSource.source.sessionId,
            entityKey,
            actor,
            createdAt: new Date().toISOString(),
            runIdentityKind: "controller-trial-lease",
        });
        write(
            path.join(
                layout.run,
                `trial-lease-${state.histories.length - 1}.json`,
            ),
            state.lease,
        );
        return state.lease;
    }
    function events() {
        budget.check();
        const history = state.histories.at(-1);
        if (!history) return [];
        const current = readNativeWorkiqSessionEvents(history.home, {
            sessionId: state.knownSource?.source.sessionId,
            required: Boolean(state.eventSessionId || state.submission),
        });
        budget.observe(current);
        if (
            state.eventSessionId &&
            state.initialized &&
            current.some(
                (event) =>
                    event.type === "tool.execution_complete" &&
                    event.data?.success !== true,
            )
        ) {
            assertCurrentActor(state.knownSource.source.control);
            verifyWorkiqSdkToolInventory(state.initialized.tools.tools, {
                tools: state.selectedTools,
            });
            assertNativeWorkiqSelectedToolOutcomes(
                current,
                state.selectedTools,
            );
        }
        return current;
    }
    async function sessionEvents() {
        requireNative(
            state.lease &&
                state.initialized?.source.sessionId === state.lease.sessionId &&
                state.knownSource?.source.sessionId === state.lease.sessionId,
            "Native WorkIQ event readiness requires actual current initialized SDK source",
        );
        while (true) {
            budget.check();
            state.consoleAbort.signal.throwIfAborted();
            assertCurrentActor(state.knownSource.source.control);
            const current = events();
            if (current.some((event) => event.type === "session.start")) {
                state.eventSessionId = state.lease.sessionId;
                return current;
            }
            await delay(200, undefined, { signal: state.consoleAbort.signal });
        }
    }
    async function closeConsole() {
        state.consoleAbort?.abort(
            new Error("Owned native WorkIQ console closed"),
        );
        const failures = [];
        try {
            if (state.reader)
                write(
                    path.join(
                        layout.run,
                        `reader-stop-${state.consoleAllocations.at(-1).index}.json`,
                    ),
                    stopOwnedIdentities([state.reader.server]),
                );
        } catch (error) {
            failures.push(error);
        }
        state.reader = undefined;
        if (!state.console) {
            if (failures.length)
                throw new AggregateError(
                    failures,
                    failures.map((error) => error.message).join("; "),
                );
            return;
        }
        let owned = state.consoleIdentities;
        try {
            const stateFile = path.join(state.console, "console-state.json");
            if (fs.existsSync(stateFile)) {
                const launched = read(stateFile);
                const original = state.consoleIdentities.find(
                    (row) => row.ProcessId === launched.bridgePid,
                );
                const current = original ? processTree(launched.bridgePid) : [];
                if (current.some((row) => identityMatches(row, original)))
                    owned = current;
            }
        } catch (error) {
            failures.push(error);
        }
        state.ownedIdentities.push(...owned);
        try {
            const ownerFile = path.join(state.console, "owner.json");
            if (fs.existsSync(ownerFile)) {
                consoleAllocationTitles(state.consoleAllocations);
                if (!fs.existsSync(path.join(state.console, "window.json")))
                    control("Select", undefined, true);
                control("Close", undefined, true);
            }
        } catch (error) {
            failures.push(error);
        }
        try {
            write(
                path.join(
                    layout.run,
                    `console-stop-${state.consoleAllocations.at(-1).index}.json`,
                ),
                stopOwnedIdentities(owned),
            );
        } catch (error) {
            failures.push(error);
        }
        state.console = undefined;
        state.consoleIdentities = [];
        state.lease = undefined;
        state.submission = undefined;
        state.initialized = undefined;
        state.knownSource = undefined;
        state.eventSessionId = undefined;
        state.selectedTools = [];
        state.callback = undefined;
        state.hookTarget = undefined;
        state.recordingLearning = undefined;
        try {
            retireSessionArtifacts();
        } catch (error) {
            failures.push(error);
        }
        if (failures.length)
            throw new AggregateError(
                failures,
                failures.map((error) => error.message).join("; "),
            );
    }
    function retireSessionArtifacts() {
        const archive = path.join(
            layout.run,
            `retired-session-${state.consoleAllocations.at(-1).index}`,
        );
        fs.mkdirSync(archive);
        const files = [
            path.join(layout.workspace, ".mcp.json"),
            ...[
                "native-workiq-originals-policy.json",
                "native-workiq-session.json",
                "native-workiq-finalized.json",
                "native-control",
            ].map((name) => path.join(layout.data, name)),
        ];
        for (const file of files)
            if (fs.existsSync(file))
                fs.renameSync(
                    physical(file),
                    path.join(archive, path.basename(file)),
                );
        const configFile = path.join(layout.pluginData, "config.json");
        fs.copyFileSync(
            configFile,
            path.join(archive, "config.json"),
            fs.constants.COPYFILE_EXCL,
        );
        fs.writeFileSync(
            configFile,
            JSON.stringify(
                {
                    mode: "bypass",
                    powershell: { enabled: false },
                },
                null,
                2,
            ) + "\n",
        );
        const admission = path.join(
            layout.data,
            "native-control-admission.json",
        );
        fs.renameSync(
            physical(admission),
            path.join(archive, "native-control-admission.json"),
        );
        write(admission, nativeWorkiqControlAdmission(layout, configFile));
    }
    async function stopService() {
        try {
            if (state.connection) await state.connection.close();
        } finally {
            state.connection = undefined;
            if (state.serviceModuleHandler)
                state.service?.child.removeListener(
                    "message",
                    state.serviceModuleHandler,
                );
            state.serviceModuleHandler = undefined;
            if (state.serviceIdentity) {
                const current = processTree(state.serviceIdentity.ProcessId);
                if (
                    current.some((row) =>
                        identityMatches(row, state.serviceIdentity),
                    )
                ) {
                    state.ownedIdentities.push(...current);
                    write(
                        path.join(
                            layout.run,
                            `service-stop-${state.serviceIdentity.ProcessId}-${state.serviceIdentity.StartedMs}.json`,
                        ),
                        stopOwnedIdentities(current),
                    );
                }
            }
            state.service = undefined;
            state.serviceIdentity = undefined;
            state.serviceModulePlan = undefined;
            state.serviceModuleMessages = [];
        }
    }
    async function sessionSource(requireInitialized = false) {
        requireNative(
            state.console && state.consoleAbort,
            "Native WorkIQ SDK source requires its actual owned console",
        );
        const { awaitWorkiqNativeSession } = await import(
            "./macro-eval-workiq-native.mjs"
        );
        const record = await budget.run(
            awaitWorkiqNativeSession({
                ownedRoot: layout.run,
                dataRoot: layout.data,
                owner: layout.owner,
                configPath: path.join(layout.pluginData, "config.json"),
                deadlineMs: Date.now() + budget.remaining(),
                requireInitialized,
                signal: AbortSignal.any([signal, state.consoleAbort.signal]),
            }),
        );
        const actor = assertCurrentActor(record.source.control);
        requireNative(
            Math.abs(
                Date.parse(record.source.processStartedAt) - actor.StartedMs,
            ) < 5000,
            "Native WorkIQ SDK producer lifetime differs from current OS actor",
        );
        requireNative(
            !state.lease || record.source.sessionId === state.lease.sessionId,
            "Native WorkIQ source changed actual SID during the trial lease",
        );
        state.sourceRecords.add(record);
        state.knownSource = record;
        if (requireInitialized) state.initialized = record;
        return record;
    }
    function currentControlActors(observations, getter) {
        budget.check();
        requireNative(
            state.sourceRecords.has(state.knownSource),
            "Current MCP actors require source-loaded current SDK authority",
        );
        const sdkActor = assertCurrentActor(state.knownSource.source.control);
        const launched = read(path.join(state.console, "console-state.json"));
        const bridge = state.consoleIdentities.find(
            (row) => row.ProcessId === launched.bridgePid,
        );
        const cli = state.consoleIdentities.find(
            (row) => row.ProcessId === launched.cliPid,
        );
        const tree = processTree(launched.bridgePid);
        requireNative(
            tree.some((row) => identityMatches(row, bridge)) &&
                tree.some((row) => identityMatches(row, cli)) &&
                tree.some((row) => identityMatches(row, sdkActor)),
            "Current MCP snapshot lost its exact native bridge/CLI/SDK ancestry",
        );
        const extension = observations.filter(
            (record) => record.source.component === "native-extension-status",
        );
        requireNative(
            extension.length === 1 &&
                extension[0].source.pid === sdkActor.ProcessId &&
                getter.ParentProcessId === sdkActor.ProcessId,
            "Current MCP snapshot has no actual SDK/status/getter join",
        );
        const serverScript = path.join(
            layout.plugin,
            "dist",
            "mcp",
            "server.js",
        );
        const staged = state.stagedRuntime.find(
            (entry) => entry.file === serverScript,
        );
        requireNative(
            staged &&
                hash(fs.readFileSync(physical(serverScript))) === staged.sha256,
            "Current MCP argv script differs from its physical staged source",
        );
        const manifestFile = path.join(layout.plugin, ".mcp.json");
        const manifestPin = state.stagedRuntime.find(
            (entry) => entry.file === manifestFile,
        );
        requireNative(
            manifestPin &&
                hash(fs.readFileSync(physical(manifestFile))) ===
                    manifestPin.sha256,
            "Current MCP role argv manifest differs from its physical staged source",
        );
        const declared = read(manifestFile).mcpServers;
        const roleArgs = Object.freeze(
            Object.fromEntries(
                Object.entries(nativeMcpRoles).map(([role, flags]) => {
                    const name =
                        role === "mcp-agent"
                            ? "typeagent"
                            : `typeagent-${role.slice(4)}`;
                    const entry = declared?.[name];
                    requireNative(
                        entry?.command === "node" &&
                            isDeepStrictEqual(entry.args, [
                                "${PLUGIN_ROOT}/dist/mcp/server.js",
                                ...flags,
                            ]),
                        "Current MCP role has no exact protected declared argv",
                    );
                    return [
                        role,
                        Object.freeze(
                            entry.args.map((argument) =>
                                argument.replaceAll(
                                    "${PLUGIN_ROOT}",
                                    layout.plugin,
                                ),
                            ),
                        ),
                    ];
                }),
            ),
        );
        const ids = [
            ...new Set(
                observations
                    .filter((record) =>
                        record.source.component.startsWith("mcp-"),
                    )
                    .map((record) => record.source.pid),
            ),
        ];
        requireNative(
            ids.every((pid) => Number.isSafeInteger(pid) && pid > 0),
            "Current MCP probe requires exact PIDs",
        );
        const actors = JSON.parse(
            execFileSync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-Command",
                    `. $PROFILE; $ErrorActionPreference='Stop'; $rows=@(foreach($id in @(${ids.join(",")})){` +
                        `$p=Get-CimInstance Win32_Process -Filter "ProcessId=$id"; if($p){` +
                        `@{ProcessId=$p.ProcessId;ParentProcessId=$p.ParentProcessId;` +
                        `StartedMs=([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds();` +
                        `ExecutablePath=$p.ExecutablePath;CommandLine=$p.CommandLine}}}); ` +
                        `ConvertTo-Json -InputObject $rows -Compress`,
                ],
                {
                    timeout: Math.min(30000, budget.remaining()),
                    encoding: "utf8",
                },
            ),
        );
        const snapshot = Object.freeze({
            proofIndex: state.controlProofIndex++,
            observedAtMs: Date.now(),
            bridge: Object.freeze({ ...bridge }),
            cli: Object.freeze({ ...cli }),
            sdkActor: Object.freeze({ ...sdkActor }),
            tree: Object.freeze(tree.map((row) => Object.freeze({ ...row }))),
            actors: Object.freeze(actors.map((row) => Object.freeze(row))),
            serverScript,
            serverScriptSha256: staged.sha256,
            nodeExecutable: bridge.ExecutablePath,
            roleArgs,
            roleArgvManifest: Object.freeze({
                file: manifestFile,
                sha256: manifestPin.sha256,
            }),
            configDigest: extension[0].digest,
            effectiveMode: extension[0].effectiveMode,
        });
        nativeControlActorSnapshots.add(snapshot);
        write(
            path.join(
                layout.run,
                `native-control-actors-${snapshot.proofIndex}.private.json`,
            ),
            {
                kind: "native-workiq-physical-control-actor-snapshot-v1",
                admission: false,
                serializedNativeAuthority: false,
                snapshot,
            },
        );
        return snapshot;
    }
    function stockControlProof(mode) {
        const launched = read(path.join(state.console, "console-state.json"));
        const all = inventory(path.join(layout.data, "native-control"))
            .filter((entry) => entry.file.endsWith(".json"))
            .map((entry) => read(entry.file));
        const stock = [
            "mcp-agent",
            "mcp-workspace",
            "mcp-macros",
            "mcp-skills",
            "native-extension-status",
            "native-hook",
        ];
        const extras = all.filter(
            (record) => !stock.includes(record.source?.component),
        );
        for (const record of extras) {
            requireNative(
                [
                    "native-extension-startup",
                    "native-workiq-session",
                    "native-workiq-pure-control",
                ].includes(record.source?.component),
                "Unclassified native WorkIQ control producer",
            );
            assertCurrentActor(record);
        }
        const observations = all.filter((record) =>
            stock.includes(record.source.component),
        );
        const getter = read(
            physical(
                path.join(layout.data, "native-control-getter-process.json"),
            ),
        );
        requireNative(
            hash(fs.readFileSync(physical(state.hook.router.file))) ===
                state.hook.router.sha256,
            "Current compiled getter router differs from its staged source",
        );
        const proofLayout = {
            ...layout,
            controlStartedAt: state.controlStartedAt,
        };
        const actors = currentControlActors(observations, getter);
        const mcpSelection = selectNativeWorkiqCurrentMcpControls(
            proofLayout,
            observations.filter((record) =>
                record.source.component.startsWith("mcp-"),
            ),
            actors,
        );
        const records = selectNativeWorkiqGetterControls(
            proofLayout,
            observations.filter(
                (record) =>
                    !record.source.component.startsWith("mcp-") ||
                    mcpSelection.selected.includes(record),
            ),
            getter,
            state.hook.router,
            state.lease.sessionId,
        );
        const identities = processTree(launched.bridgePid);
        requireNative(
            [
                actors.bridge,
                actors.cli,
                actors.sdkActor,
                ...actors.actors,
            ].every((actor) =>
                identities.some((row) => identityMatches(row, actor)),
            ),
            "Current MCP OS identities changed during control selection",
        );
        const proof = nativeControlProof(
            proofLayout,
            mode,
            identities,
            records,
        );
        write(
            path.join(
                layout.run,
                `native-control-selection-${actors.proofIndex}.private.json`,
            ),
            {
                kind: "native-workiq-current-control-selection-v1",
                admission: false,
                observations,
                selected: records,
                historical: observations.filter(
                    (record) => !records.includes(record),
                ),
                proof,
            },
        );
        requireNative(
            proof.passed,
            "Actual current native root/MCP/compiled getter controls disagree",
        );
        return { ...proof, observations, getter };
    }
    async function finalizedCapture() {
        requireNative(state.lease, "Current native WorkIQ lease missing");
        const { awaitWorkiqFinalizedCapture } = await import(
            "./macro-eval-workiq-native.mjs"
        );
        const result = await budget.run(
            awaitWorkiqFinalizedCapture({
                ownedRoot: layout.run,
                dataRoot: layout.data,
                owner: layout.owner,
                configPath: path.join(layout.pluginData, "config.json"),
                deadlineMs: Date.now() + budget.remaining(),
                sessionId: state.lease.sessionId,
                runId: state.lease.trialLeaseId,
                signal: AbortSignal.any([signal, state.consoleAbort.signal]),
            }),
        );
        assertCurrentActor(result.source.control);
        const recording = await budget.run(
            state.connection.getMacroRecordingState(state.lease.sessionId),
        );
        assertNativeWorkiqCompletedRecording(
            recording,
            result.summary,
            state.lease.sessionId,
        );
        if (state.recordingLearning === "prepare")
            assertNativeWorkiqPrepareRecording(
                recording,
                result.summary,
                layout.workspace,
            );
        return { source: result, recording };
    }
    function assertScope(scope) {
        requireNative(
            state.lease &&
                scope.ownerId === layout.owner &&
                scope.sessionId === state.lease.sessionId &&
                scope.runId === state.lease.trialLeaseId &&
                (scope.phase === "capture-a"
                    ? "A"
                    : ["reuse-b", "restart-b"].includes(scope.phase)
                      ? "B"
                      : null) === state.lease.entityKey,
            "WorkIQ adapter scope is not the active native document trial lease",
        );
        budget.check(events());
        const marker = read(path.join(layout.run, "evaluation-owner.json"));
        requireNative(
            marker.owner === layout.owner,
            "Native WorkIQ owner marker changed",
        );
        physical(layout.run);
        const source = read(
            physical(path.join(layout.data, "native-workiq-session.json")),
        );
        assertCurrentActor(source.source.control);
        requireNative(
            source.source.sessionId === scope.sessionId &&
                state.knownSource?.source.sessionId === scope.sessionId,
            "Bound WorkIQ metadata has a foreign current source SID",
        );
        const policy = read(
            physical(
                path.join(layout.data, "native-workiq-originals-policy.json"),
            ),
        );
        requireNative(
            policy.kind === "workiq-sdk-originals-experimental-v1" &&
                policy.exposureOverride === config.exposureOverride &&
                policy.owner === layout.owner &&
                policy.sessionId === scope.sessionId &&
                policy.runId === scope.runId &&
                policy.artifactRoot ===
                    path.join(
                        layout.data,
                        "profiles",
                        layout.instance,
                        "copilot-macros",
                    ),
            "Current WorkIQ SDK policy is not the exact experimental native lease",
        );
        return policy;
    }
    function hostAssertions(scope) {
        if (scope === null)
            return Object.freeze({
                async assertPrerequisites(current) {
                    requireNative(
                        current === null && state.connection,
                        "Native WorkIQ metadata bootstrap scope drift",
                    );
                    budget.check();
                    physical(layout.run);
                    requireNative(
                        read(path.join(layout.run, "evaluation-owner.json"))
                            .owner === layout.owner &&
                            processTree(state.service.child.pid).some((row) =>
                                identityMatches(row, state.serviceIdentity),
                            ),
                        "Native WorkIQ metadata bootstrap owner/service changed",
                    );
                },
                async authorizeRead() {
                    requireNative(
                        false,
                        "Metadata-only native WorkIQ bootstrap cannot authorize document reads",
                    );
                },
            });
        const binding = Object.freeze(structuredClone(scope));
        return Object.freeze({
            async assertPrerequisites(current) {
                requireNative(
                    isDeepStrictEqual(current, binding),
                    "WorkIQ prerequisite scope drift",
                );
                assertScope(binding);
            },
            async authorizeRead(request) {
                const policy = assertScope(binding);
                for (const key of ["ownerId", "sessionId", "runId", "phase"])
                    requireNative(
                        request[key] === binding[key],
                        "WorkIQ read scope drift",
                    );
                const initialized = await sessionSource(true);
                verifyWorkiqSdkToolInventory(initialized.tools.tools, {
                    tools: policy.tools.map((tool) => ({
                        ...tool,
                        mcpServerName: policy.mcpServerName,
                    })),
                });
                const tool = policy.tools.find(
                    (item) => item.advertisedName === request.name,
                );
                requireNative(
                    tool && state.submission,
                    "Unmapped or pre-submission WorkIQ document read",
                );
                const deadline =
                    Date.now() + Math.min(5000, budget.remaining());
                while (Date.now() < deadline) {
                    const current = events();
                    const starts = current.filter(
                        (event) =>
                            event.type === "tool.execution_start" &&
                            event.data?.toolName === tool.callableName &&
                            event.data?.mcpServerName ===
                                policy.mcpServerName &&
                            isDeepStrictEqual(
                                event.data.arguments,
                                request.arguments,
                            ) &&
                            Date.parse(event.timestamp) >=
                                state.submission.submittedAtMs &&
                            !current.some(
                                (end) =>
                                    end.type === "tool.execution_complete" &&
                                    end.agentId === event.agentId &&
                                    end.data?.toolCallId ===
                                        event.data.toolCallId,
                            ),
                    );
                    if (starts.length === 1) return;
                    requireNative(
                        starts.length === 0,
                        "Ambiguous native WorkIQ read actor/call",
                    );
                    budget.check(current);
                    await delay(100);
                }
                requireNative(
                    false,
                    "Agency read has no actual active current SDK tool call",
                );
            },
        });
    }
    function normalHookCallback() {
        if (state.callback) return state.callback;
        requireNative(
            state.reader && state.lease && state.submission,
            "Actual native WorkIQ hook/lease/submission missing",
        );
        const mode = read(path.join(layout.pluginData, "config.json")).mode;
        const proof = stockControlProof(mode);
        const configDigest = proof.records[0].digest;
        const target = createNativeWorkiqHookTarget({
            sessionId: state.lease.sessionId,
            prompt: state.submission.prompt,
            workspace: layout.workspace,
            mode,
            configDigest,
            submittedAtMs: state.submission.submittedAtMs,
            deadlineMs: state.submission.deadlineMs,
        });
        validateNativeWorkiqHookTarget(state.hookTarget, target);
        state.callback = state.reader
            .bind(mode, configDigest)
            .read(state.hookTarget, events());
        requireNative(
            isTrustedNormalHookCallback(state.callback),
            "Untrusted WorkIQ root completion",
        );
        return state.callback;
    }
    function routeLog() {
        const root = path.join(
            layout.data,
            "profiles",
            layout.instance,
            "conversations",
        );
        if (!fs.existsSync(root)) return [];
        return fs.readdirSync(root).flatMap((id) => {
            const file = path.join(root, id, "displayLog.json");
            return fs.existsSync(file) ? read(physical(file)) : [];
        });
    }
    async function projection(trial, discovery) {
        const finalized = await finalizedCapture();
        requireNative(
            finalized.source.summary.traceId === trial.traceId,
            "WorkIQ verification does not name the actual finalized current trace",
        );
        const trace = read(physical(finalized.source.tracePath));
        const current = events();
        const callback = normalHookCallback();
        const root = path.join(
            layout.data,
            "profiles",
            layout.instance,
            "copilot-macros",
        );
        const coreId = current
            .find(
                (event) =>
                    event.type === "subagent.started" &&
                    [
                        "typeagent-macro-runner-host",
                        "typeagent:typeagent-macro-runner-host",
                    ].includes(event.data?.agentName),
            )
            ?.data?.toolCallId?.match(/^typeagent-macro-([a-f0-9]{64})$/u)?.[1];
        const audit = coreId
            ? read(physical(path.join(root, "runs", `${coreId}.json`)))
            : undefined;
        const qualified = verifyNativeWorkiqProjectionSources({
            events: current,
            trace,
            discovery,
            callback,
            phase: trial.phase,
            audit,
            publication: state.publication,
            routes: routeLog(),
        });
        const proof = Object.freeze({
            sessionId: state.lease.sessionId,
            traceId: finalized.source.summary.traceId,
            runId: state.lease.trialLeaseId,
            runIdentityKind: "controller-trial-lease",
            handoffRunId: qualified.handoffRunId,
            fullTraceSha256: finalized.source.traceSha256,
            workiqToolCallIds: Object.freeze(
                qualified.document.map((call) => call.toolCallId),
            ),
            excludedToolCallIds: Object.freeze(
                qualified.controls.map((call) => call.toolCallId),
            ),
            excludedEventIds: Object.freeze(
                qualified.controls.flatMap((call) =>
                    qualified.pairs.get(call).map((event) => event.id),
                ),
            ),
        });
        nativeProjections.add(proof);
        return proof;
    }
    async function handleInteraction(controller) {
        const { assertWorkiqNativeController } = await import(
            "./macro-eval-workiq-controller.mjs"
        );
        assertWorkiqNativeController(controller, runtime);
        budget.check(events());
        const viewport = control("Read");
        const tools = state.initialized
            ? await controller.currentConsentTools()
            : [];
        const decision = classifyNativeScreen(viewport, layout.workspace, {
            approve: tools.length === 1,
            tools,
        });
        if (!decision) return null;
        if (
            ["trust owned workspace once", "register hooks once"].includes(
                decision.reason,
            )
        ) {
            const history = state.histories.at(-1);
            const launched = read(
                path.join(state.console, "console-state.json"),
            );
            const rows = processTree(launched.bridgePid);
            requireNative(
                history &&
                    !state.submission &&
                    state.serviceIdentity &&
                    read(
                        physical(
                            path.join(layout.run, "evaluation-owner.json"),
                        ),
                    ).owner === layout.owner &&
                    [launched.bridgePid, history.cliPid].every((pid) =>
                        state.consoleIdentities.some(
                            (actor) =>
                                actor.ProcessId === pid &&
                                rows.some((current) =>
                                    identityMatches(current, actor),
                                ),
                        ),
                    ),
                "Bootstrap workspace/hooks consent lacks current owned console and staged source proof",
            );
            verifyNativeWorkiqBootstrapArtifacts(
                layout,
                state.stagedRuntime,
                state.compiledExtension,
            );
            verifyNativeExecutable(history.frozen);
        }
        const viewportHash = hash(viewport);
        if (state.answeredViewports.has(viewportHash)) return null;
        const evidence = path.join(
            state.console,
            `consent-${randomUUID()}.private.json`,
        );
        write(evidence, {
            sessionId: state.lease?.sessionId ?? null,
            observedAt: new Date().toISOString(),
            viewportSha256: viewportHash,
            viewport,
            decision,
            tool: tools.length === 1 ? tools[0] : null,
        });
        control("Type", decision.text);
        state.answeredViewports.add(viewportHash);
        return { reason: decision.reason, source: evidence };
    }
    function verifyCleanup() {
        const identities = [
            ...new Map(
                state.ownedIdentities.map((actor) => [
                    `${actor.ProcessId}:${actor.StartedMs}`,
                    actor,
                ]),
            ).values(),
        ];
        const survivors = identities.filter((actor) =>
            processTree(actor.ProcessId).some((current) =>
                identityMatches(current, actor),
            ),
        );
        const listeners = probeWindowsServiceListeners(
            config.port,
            path.join(layout.run, "windows-os-probe"),
        );
        const titles = consoleAllocationTitles(state.consoleAllocations);
        const native = path
            .join(config.helperDirectory, "NativeControl.cs")
            .replaceAll("'", "''");
        const encoded = JSON.stringify(titles).replaceAll("'", "''");
        const windows = JSON.parse(
            execFileSync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-Command",
                    `. $PROFILE; $ErrorActionPreference='Stop'; Add-Type -Path '${native}'; ` +
                        `$titles=ConvertFrom-Json '${encoded}'; $hits=[System.Collections.Generic.List[object]]::new(); ` +
                        `[DemoNative]::EnumWindows([DemoNative+EnumProc]{param($h,$x) ` +
                        `$s=[Text.StringBuilder]::new(4096); [void][DemoNative]::GetWindowText($h,$s,$s.Capacity); ` +
                        `if($titles -contains $s.ToString()){$hits.Add(@{handle=$h.ToInt64();title=$s.ToString()})}; return $true},[IntPtr]::Zero)|Out-Null; ` +
                        `ConvertTo-Json -InputObject @($hits.ToArray()) -Compress`,
                ],
                { timeout: 30000, encoding: "utf8" },
            ),
        );
        const root = layout.run.replaceAll("'", "''");
        const rootCommands = JSON.parse(
            execFileSync(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-Command",
                    `. $PROFILE; $ErrorActionPreference='Stop'; ` +
                        `$rows=@(Get-CimInstance Win32_Process | Where-Object {` +
                        `$_.ProcessId -ne $PID -and $_.CommandLine -and ` +
                        `$_.CommandLine.IndexOf('${root}',[StringComparison]::OrdinalIgnoreCase) -ge 0} | ` +
                        `Select-Object ProcessId,ParentProcessId,ExecutablePath); ` +
                        `ConvertTo-Json -InputObject $rows -Compress`,
                ],
                { timeout: 30000, encoding: "utf8" },
            ),
        );
        const proof = {
            allocations: state.consoleAllocations,
            titles,
            identities,
            survivors,
            listeners,
            windows,
            rootCommands,
            observedAt: new Date().toISOString(),
        };
        write(path.join(layout.run, "cleanup-verification.json"), proof);
        requireNative(
            survivors.length === 0 &&
                listeners.length === 0 &&
                windows.length === 0 &&
                rootCommands.length === 0,
            "Native WorkIQ exact process/window/receiver/port cleanup unresolved",
        );
        return proof;
    }
    const runtime = Object.freeze({
        layout: Object.freeze(layout),
        budget,
        startService,
        openConsole,
        closeConsole,
        stopService,
        verifyCleanup,
        assertCurrentActor,
        claimTrial,
        sessionSource,
        sessionEvents,
        finalizedCapture,
        stockControlProof,
        normalHookCallback,
        events,
        readViewport: () => control("Read"),
        handleInteraction,
        submit: (prompt) => {
            requireNative(
                state.lease &&
                    state.initialized?.source.sessionId ===
                        state.lease.sessionId &&
                    state.eventSessionId === state.lease.sessionId &&
                    /^[\x20-\x7e]{1,2000}$/u.test(prompt),
                "Actual owned WorkIQ initialized SDK/event lease and bounded ASCII prompt required",
            );
            budget.check(events());
            assertCurrentActor(state.knownSource.source.control);
            proveCurrentServiceModules(state.lease.sessionId);
            requireNative(
                !state.submission,
                "WorkIQ lease already submitted its document task",
            );
            const mode = read(path.join(layout.pluginData, "config.json")).mode;
            const controls = stockControlProof(mode);
            const submittedAtMs = Date.now();
            const deadlineMs = submittedAtMs + budget.remaining();
            state.hookTarget = createNativeWorkiqHookTarget({
                sessionId: state.lease.sessionId,
                prompt,
                workspace: layout.workspace,
                submittedAtMs,
                deadlineMs,
                mode,
                configDigest: controls.records[0].digest,
            });
            state.submission = {
                prompt,
                submittedAtMs,
                deadlineMs,
            };
            write(
                path.join(
                    layout.run,
                    `submission-${state.histories.length - 1}.private.json`,
                ),
                {
                    sessionId: state.lease.sessionId,
                    promptSha256: hash(prompt),
                    ...state.submission,
                },
            );
            control("Type", prompt);
        },
        invokeRecordingState: () => {
            requireNative(state.lease, "Current WorkIQ lease missing");
            return budget.run(
                state.connection.getMacroRecordingState(state.lease.sessionId),
            );
        },
        learningPreference: (mode) =>
            budget.run(
                state.connection.setMacroLearningPreference({
                    cwd: layout.workspace,
                    mode,
                }),
            ),
        inspect: (reference) =>
            budget.run(state.connection.inspectMacro(reference)),
        validate: (reference) =>
            budget.run(state.connection.validateMacro(reference)),
        approve: async (reference) => {
            const publication = await budget.run(
                state.connection.approveMacro(reference),
            );
            requireNative(
                publication.state === "approved",
                "WorkIQ actual publication is not approved",
            );
            state.publication = Object.freeze(structuredClone(publication));
            return publication;
        },
        prepare: (traceId) =>
            budget.run(state.connection.prepareMacroLearning({ traceId })),
        learningJob: (jobId) =>
            budget.run(state.connection.getMacroLearningJob(jobId)),
        armRecording: async (learning) => {
            requireNative(state.lease, "Current native WorkIQ lease missing");
            requireNative(
                learning === "prepare" || learning === "off",
                "Native WorkIQ recording learning must be prepare or off",
            );
            const preference = await budget.run(
                state.connection.getMacroLearningPreference(layout.workspace),
            );
            requireNative(
                preference.mode === learning &&
                    preference.cwd ===
                        path.resolve(layout.workspace).toLowerCase(),
                "Actual native WorkIQ learning preference/workspace disagrees before recording",
            );
            const request = {
                sessionId: state.lease.sessionId,
                cwd: layout.workspace,
                ttlMs: Math.min(270000, budget.remaining()),
                learning: learning === "prepare",
            };
            const token = await budget.run(
                state.connection.armMacroRecording(request),
            );
            assertNativeWorkiqRecordingToken(token, request);
            state.recordingLearning = learning;
            write(
                path.join(
                    layout.run,
                    `recording-arm-${state.consoleAllocations.at(-1).index}.private.json`,
                ),
                {
                    request,
                    token,
                    preference,
                    observedAt: new Date().toISOString(),
                },
            );
            return token;
        },
        cancelRecording: async () => {
            requireNative(state.lease, "Current native WorkIQ lease missing");
            const sessionId = state.lease.sessionId;
            let before, after;
            const failures = [];
            for (const step of [
                async () => {
                    before =
                        await state.connection.getMacroRecordingState(
                            sessionId,
                        );
                },
                () => state.connection.cancelMacroRecording(sessionId),
                async () => {
                    after =
                        await state.connection.getMacroRecordingState(
                            sessionId,
                        );
                    requireNative(
                        after.status === "idle" && !after.token && !after.trace,
                        "Actual owned native WorkIQ recording claim did not release",
                    );
                },
            ])
                try {
                    await step();
                } catch (error) {
                    failures.push(error);
                }
            if (failures.length)
                throw new AggregateError(
                    failures,
                    failures.map((error) => error.message).join("; "),
                );
            return { sessionId, before, after };
        },
        verifyInventory: verifyWorkiqSdkToolInventory,
        verifyPinnedMacro: (actual, expected) =>
            requireNative(
                isDeepStrictEqual(actual, expected),
                "Current WorkIQ immutable macro changed",
            ),
    });
    nativeRuntimes.set(runtime, hostAssertions);
    evidenceBoundaries.set(runtime, async (trial) => {
        const scope = {
            ownerId: trial.ownerId,
            sessionId: trial.sessionId,
            runId: trial.runId,
            phase: trial.phase,
        };
        const policy = assertScope(scope);
        requireNative(
            state.initialized,
            "Native WorkIQ evidence lacks initialized current SDK inventory",
        );
        const auditRoot = path.join(layout.run, `agency-${scope.runId}`);
        const catalog = read(physical(path.join(auditRoot, "catalog.json")));
        requireNative(
            catalog.kind === "workiq-agency-current-catalog" &&
                isDeepStrictEqual(catalog.scope, scope) &&
                catalog.tools?.length === 3,
            "Native WorkIQ evidence requires actual current scoped Agency catalog",
        );
        const discovery = Object.freeze({
            origin: "native-tool-discovery",
            sessionId: scope.sessionId,
            tools: policy.tools.map((tool) => {
                const actual = catalog.tools.filter(
                    (item) => item.name === tool.advertisedName,
                );
                requireNative(
                    actual.length === 1 &&
                        isDeepStrictEqual(
                            actual[0].inputSchema,
                            tool.inputSchema,
                        ) &&
                        actual[0].annotations?.readOnlyHint === true &&
                        actual[0].annotations?.destructiveHint === false,
                    "Actual Agency/native SDK schema or readonly annotation drift",
                );
                return Object.freeze({
                    ...tool,
                    mcpServerName: policy.mcpServerName,
                    annotations: Object.freeze(
                        structuredClone(actual[0].annotations),
                    ),
                });
            }),
        });
        verifyWorkiqSdkToolInventory(state.initialized.tools.tools, discovery);
        const sourceProjection = await projection(trial, discovery);
        return Object.freeze({
            artifactRoot: policy.artifactRoot,
            nativeSessionRoot: path.join(state.homes.at(-1), "session-state"),
            auditRoot,
            sdkCaptureDataRoot: layout.data,
            projection: sourceProjection,
            readNativeDiscovery: async () => {
                assertScope(scope);
                return discovery;
            },
        });
    });
    return runtime;
}
