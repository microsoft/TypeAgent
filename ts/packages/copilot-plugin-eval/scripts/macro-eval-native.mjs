// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire, isBuiltin } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { documentFamilyId, getScenarioCases } from "./macro-eval-corpus.mjs";
import { gradeDocumentTrial } from "./macro-eval-grade.mjs";

const scripts = path.dirname(fileURLToPath(import.meta.url));
const tsRoot = path.resolve(scripts, "..", "..", "..");
const rootEvent = (event) => !event.agentId && !event.data?.parentToolCallId;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const readJson = (file) =>
    JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""));
const writeJson = (file, value) =>
    fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
    });

export class NativeStop extends Error {
    constructor(message, status = "harness-invalid") {
        super(message);
        this.status = status;
    }
}

export function validateNativeConfig(config, corpus) {
    const allowed = new Set([
        "cliExecutable",
        "cliVersion",
        "configDirectory",
        "port",
        "rootModel",
        "runnerModel",
        "maxTargetModelTurns",
        "maxDurationMs",
        "trainingCase",
        "reuseCase",
        "restart",
        "approveSyntheticReadsOnce",
        "reviewSyntheticDraft",
        "executionPath",
        "diagnosticOnly",
    ]);
    if (!config || typeof config !== "object" || Array.isArray(config))
        throw new Error("Native configuration must be an object");
    for (const name of Object.keys(config))
        if (!allowed.has(name))
            throw new Error(`Unsupported native option: ${name}`);
    for (const name of ["cliExecutable", "configDirectory"])
        if (typeof config[name] !== "string" || !path.isAbsolute(config[name]))
            throw new Error(`${name} must be an explicit absolute path`);
    if (!/\.exe$/iu.test(config.cliExecutable))
        throw new Error(
            "Native CLI must be a pinned executable, not a shell shim",
        );
    if (!["1.0.89", "1.0.95"].includes(config.cliVersion))
        throw new NativeStop(
            "Only explicitly configured native CLI 1.0.89 or 1.0.95 is admitted",
            "blocked",
        );
    if (config.executionPath !== undefined && config.executionPath !== "direct")
        throw new NativeStop(
            "Caller/MCP scoring is blocked: the grader route schema cannot represent an explicit MCP macro invocation without a grammar hit",
            "blocked",
        );
    if (
        config.runnerModel !== "gpt-6-luna" ||
        typeof config.rootModel !== "string" ||
        !/^[a-z0-9][a-z0-9._-]*$/iu.test(config.rootModel)
    )
        throw new Error(
            "Explicit rootModel and host runnerModel gpt-6-luna required",
        );
    for (const [name, maximum] of [
        ["port", 65535],
        ["maxTargetModelTurns", 1000],
        ["maxDurationMs", 3600000],
    ])
        if (
            !Number.isInteger(config[name]) ||
            config[name] <
                (name === "maxTargetModelTurns" &&
                config.diagnosticOnly === true
                    ? 0
                    : 1) ||
            config[name] > maximum
        )
            throw new Error(
                `${name} must be an integer between 1 and ${maximum}`,
            );
    validateDiagnosticBounds(config);
    for (const name of [
        "restart",
        "approveSyntheticReadsOnce",
        "reviewSyntheticDraft",
    ])
        if (typeof config[name] !== "boolean")
            throw new Error(`Explicit boolean ${name} required`);
    return selectNativeCases(config, corpus);
}

function validateDiagnosticBounds(config) {
    if (
        config.diagnosticOnly !== undefined &&
        typeof config.diagnosticOnly !== "boolean"
    )
        throw new Error("diagnosticOnly must be boolean");
    if (
        config.diagnosticOnly &&
        (config.maxTargetModelTurns !== 0 ||
            config.maxDurationMs > 180000 ||
            config.restart)
    )
        throw new Error(
            "Diagnostic startup requires zero model turns, at most 180000ms and no restart",
        );
}

function selectNativeCases(config, corpus) {
    const cases = getScenarioCases(corpus);
    const training = cases.find((item) => item.id === config.trainingCase);
    const reuse = cases.find((item) => item.id === config.reuseCase);
    for (const [item, kind] of [
        [training, "training"],
        [reuse, "positive"],
    ])
        if (
            !item ||
            item.kind !== kind ||
            item.familyId !== documentFamilyId ||
            ["pending", "blocked", "blocked-not-accepted"].includes(item.status)
        )
            throw new NativeStop(
                "Native rehearsal requires implemented training and positive document cases",
                "blocked",
            );
    if (training.expectedDocument === reuse.expectedDocument)
        throw new Error("Reuse must change the training document binding");
    for (const item of [training, reuse])
        if (!/^[\x20-\x7e]{1,2000}$/u.test(item.prompt))
            throw new NativeStop(
                "Console helper supports only single-line ASCII prompts up to 2000 characters",
                "blocked",
            );
    return { training, reuse };
}

export function readNativeJsonl(file) {
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, "utf8");
    // The CLI may be writing the last record. Never parse or manufacture it.
    return text
        .slice(0, text.lastIndexOf("\n") + 1)
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function linked(events, from, to) {
    const indexes = new Map(events.map((event, index) => [event.id, index]));
    let index = to;
    while (index > from) {
        const previous = indexes.get(events[index].parentId);
        if (previous === undefined || previous >= index) return false;
        index = previous;
    }
    return index === from;
}

export function extractNativeEvidence(
    events,
    backendAudit,
    routes = [],
    mode = "direct",
) {
    const answerIndex = events.findLastIndex(
        (event) =>
            event.type === "assistant.message" &&
            rootEvent(event) &&
            typeof event.data?.content === "string" &&
            event.data.content.trim() &&
            (!event.data.toolRequests || event.data.toolRequests.length === 0),
    );
    const answerEvent = events[answerIndex];
    const answer = answerEvent?.data.content ?? "";
    const starts = events.filter(
        (event) => event.type === "tool.execution_start",
    );
    const hosts = events.filter(
        (event) =>
            event.type === "subagent.started" &&
            [
                "typeagent-macro-runner-host",
                "typeagent:typeagent-macro-runner-host",
            ].includes(event.data?.agentName),
    );
    const calls = starts.filter((event) =>
        /(?:^|-)run_macro$/u.test(event.data?.toolName ?? ""),
    );
    const matchingRoutes = routes.filter(
        (entry) =>
            entry.event === "explained" &&
            entry.data?.detail?.phrase ===
                events.findLast(
                    (event) =>
                        event.type === "user.message" && rootEvent(event),
                )?.data?.content,
    );
    const grammar = matchingRoutes.filter(
        (entry) =>
            entry.data.fromCache === "grammar" &&
            /^macros\.run_.+_v\d+$/u.test(entry.data.detail?.action ?? ""),
    );
    const unhandledHook = events.some(
        (event, index) =>
            index < answerIndex &&
            rootEvent(event) &&
            event.type === "hook.end" &&
            event.data?.hookType === "userPromptSubmitted" &&
            event.data.success === true &&
            event.data.output &&
            event.data.output.handled !== true &&
            linked(events, index, answerIndex),
    );
    const route =
        grammar.length === 1
            ? "grammar"
            : mode === "bypass"
              ? "unknown"
              : (unhandledHook && hosts.length === 0 && calls.length === 0) ||
                  (matchingRoutes.length === 1 &&
                      !matchingRoutes[0].data.fromCache)
                ? "miss"
                : "unknown";
    const reference = grammar[0]?.data.detail.action.match(
        /^macros\.run_(.+)_v(\d+)$/u,
    );
    const routeEvidence = {
        route,
        ...(mode === "bypass"
            ? {
                  bypassCandidate:
                      unhandledHook && hosts.length === 0 && calls.length === 0,
              }
            : {}),
        ...(reference
            ? { macroId: reference[1], version: Number(reference[2]) }
            : {}),
        notifications: matchingRoutes,
        mode,
    };
    const effects = starts
        .filter(
            (event) =>
                !/(?:^|-)(?:lookup_document|fetch_document|run_macro)$/u.test(
                    event.data?.toolName ?? "",
                ) && event.data?.toolName !== "task",
        )
        .map((event) => event.data.toolName ?? "unknown-tool");
    effects.push(
        ...backendAudit
            .filter(
                (entry) =>
                    !["lookup_document", "fetch_document"].includes(
                        entry.operation,
                    ),
            )
            .map((entry) => entry.operation),
    );
    const executionEvidence = {
        wholeMacroInvocations: hosts.length + calls.length,
        effects,
    };
    if (hosts.some((entry) => entry.data?.model !== "gpt-6-luna"))
        executionEvidence.effects.push("unexpected-host-runner-model");
    for (const entry of events.filter(
        (event) => event.type === "subagent.started",
    ))
        if (!hosts.includes(entry))
            executionEvidence.effects.push("unexpected-subagent");
    if (hosts.length === 1) {
        const procedure = starts.filter((entry) =>
            /(?:^|-)(?:lookup_document|fetch_document)$/u.test(
                entry.data?.toolName ?? "",
            ),
        );
        if (
            procedure.some(
                (entry) =>
                    entry.agentId !== hosts[0].agentId ||
                    entry.data?.parentToolCallId !== hosts[0].data.toolCallId,
            )
        )
            executionEvidence.effects.push("procedure-outside-host-child");
    }
    return {
        events,
        backendAudit,
        answer,
        routeEvidence,
        executionEvidence,
        ...nativeTerminalProof(events, answerIndex, answer),
        modelTurns: events.filter(
            (event) => event.type === "assistant.turn_start",
        ).length,
    };
}

function nativeTerminalProof(events, answerIndex, answer) {
    const answerEvent = events[answerIndex];
    const rootCompleted = events.some(
        (event, index) =>
            index > answerIndex &&
            rootEvent(event) &&
            event.type === "assistant.turn_end" &&
            answerEvent?.data.turnId &&
            event.data?.turnId === answerEvent.data.turnId &&
            linked(events, answerIndex, index),
    );
    // Actual handled-hook output is diagnostic proof, not a substitute grader idle.
    const literalHook = events.findLastIndex(
        (event, index) =>
            index < answerIndex &&
            rootEvent(event) &&
            event.type === "hook.end" &&
            event.data?.hookType === "userPromptSubmitted" &&
            event.data.success === true &&
            event.data.output?.handled === true &&
            event.data.output.responseContent === answer &&
            linked(events, index, answerIndex),
    );
    const user = events.findLastIndex(
        (event, index) =>
            index < answerIndex &&
            event.type === "user.message" &&
            rootEvent(event),
    );
    const literalCompleted =
        literalHook >= 0 &&
        user > literalHook &&
        !events
            .slice(literalHook + 1, user)
            .some(
                (event) =>
                    rootEvent(event) &&
                    ["user.message", "assistant.message"].includes(event.type),
            ) &&
        typeof events[user].data?.interactionId === "string" &&
        events[user].data.interactionId === answerEvent?.data.interactionId;
    return {
        terminal: rootCompleted
            ? "root-turn"
            : literalCompleted
              ? "handled-hook"
              : "pending",
        literalHookId: literalCompleted ? events[literalHook].id : undefined,
    };
}

export function classifyNativeScreen(screen, workspace, consent) {
    const compact = screen.replace(/[\s│┃]/gu, "");
    if (/Confirm folder trust/u.test(screen)) {
        if (
            compact.includes(workspace.replace(/\s/gu, "")) &&
            /\b1\.\s+Yes/u.test(screen)
        )
            return { text: "1", reason: "trust owned workspace once" };
        throw new NativeStop("Unverified folder-trust prompt", "blocked");
    }
    if (/wants elevated permissions/u.test(screen)) {
        const permissionText = screen
            .split(/\r?\n/u)
            .map((line) => line.replace(/^[\s│┃]+|[\s│┃]+$/gu, ""))
            .join("\n");
        const scope =
            /This extension wants to: ([\s\S]*?)(?:\nDenying will prevent this extension from loading\.|\n(?:❯\s*)?1\.\s+Yes\b)/u
                .exec(permissionText)?.[1]
                ?.trim();
        if (
            screen.includes('Extension "plugin:typeagent:typeagent"') &&
            scope === "register hooks." &&
            /\b1\.\s+Yes/u.test(screen)
        )
            return { text: "1", reason: "register hooks once" };
        throw new NativeStop(
            "Unexpected extension permission scope",
            "blocked",
        );
    }
    if (screen.includes("Install it now?") && screen.includes("No, thanks"))
        return { text: "n", reason: "decline optional installation" };
    if (
        screen.includes("Would you like to add this key binding") &&
        screen.includes("2. No")
    )
        return { text: "2", reason: "decline keybinding change" };
    if (/Do you want to use this tool\?/u.test(screen)) {
        const permitted = consent?.tools ?? [];
        const match = permitted.filter(
            (tool) =>
                screen.includes(tool.name) &&
                compact.includes(
                    JSON.stringify(tool.arguments).replace(/\s/gu, ""),
                ),
        );
        if (
            consent?.approve === true &&
            match.length === 1 &&
            /\b1\.\s+Yes/u.test(screen) &&
            /\b3\.\s+No/u.test(screen)
        )
            return {
                text: "1",
                reason: `approve exact synthetic ${match[0].name} once`,
            };
        throw new NativeStop(
            "Execution permission requires exact admitted synthetic arguments",
            "blocked",
        );
    }
    if (
        /sign in|authenticate|choose.*model|select.*model|allow all|permission|do you want|would you like|confirm|trust this|1\.\s+Yes/iu.test(
            screen,
        )
    )
        throw new NativeStop(
            "Unknown native interaction; no input supplied",
            "blocked",
        );
    return undefined;
}

export function reviewNativeDraft(draft, validation) {
    if (
        !validation?.valid ||
        draft?.state !== "draft" ||
        draft.inputs?.length !== 1 ||
        draft.steps?.length !== 2 ||
        !draft.learning?.requiresLivePermissions ||
        !draft.learning.grammarRules?.length
    )
        throw new NativeStop(
            "Synthetic draft validation/guards failed",
            "blocked",
        );
    const input = draft.inputs[0];
    if (!input.required || input.secret || input.valueType !== "string")
        throw new NativeStop("Unsafe learned title input", "blocked");
    const [lookup, fetch] = draft.steps;
    reviewProcedure(lookup, fetch, input);
}

function reviewProcedure(lookup, fetch, input) {
    for (const [step, operation] of [
        [lookup, "lookup_document"],
        [fetch, "fetch_document"],
    ])
        if (
            step.mcpServerName !== "macro-eval-docs" ||
            step.toolName !== `macro-eval-docs-${operation}` ||
            !step.postconditions?.length ||
            step.arguments?.bindings?.length !== 1
        )
            throw new NativeStop(
                "Draft is not the admitted guarded document procedure",
                "blocked",
            );
    const title = lookup.arguments.bindings[0];
    const id = fetch.arguments.bindings[0];
    if (
        title.path.join(".") !== "title" ||
        title.expression.kind !== "input" ||
        title.expression.name !== input.name ||
        id.path.join(".") !== "id" ||
        id.expression.kind !== "stepResult" ||
        id.expression.stepId !== lookup.id ||
        id.expression.path.join(".") !== "id"
    )
        throw new NativeStop(
            "Draft does not bind a fresh lookup result to fetch",
            "blocked",
        );
}

export function createNativeBudget(config, signal, clock = Date.now) {
    const deadline = clock() + config.maxDurationMs;
    let turns = 0;
    const seen = new Set();
    return {
        check(events = []) {
            if (signal?.aborted)
                throw new NativeStop("Native evaluation cancelled", "blocked");
            if (clock() >= deadline)
                throw new NativeStop(
                    "Native evaluation deadline exceeded",
                    "blocked",
                );
            for (const event of events)
                if (
                    event.type === "assistant.turn_start" &&
                    !seen.has(event.id)
                ) {
                    if (!event.id)
                        throw new NativeStop(
                            "Model turn lacks native identity",
                        );
                    seen.add(event.id);
                    turns++;
                }
            if (turns > config.maxTargetModelTurns)
                throw new NativeStop(
                    "Native target model turn bound exceeded",
                    "blocked",
                );
        },
        remaining: () => Math.max(1, deadline - clock()),
        run: (promise) =>
            boundedNative(promise, Math.max(1, deadline - clock()), signal),
        used: () => turns,
    };
}

function ownLayout(output, config) {
    const run = path.resolve(output);
    fs.mkdirSync(run);
    const owner = randomUUID();
    writeJson(path.join(run, "evaluation-owner.json"), {
        owner,
        createdAt: new Date().toISOString(),
    });
    const layout = {
        run,
        owner,
        workspace: path.join(run, "workspace"),
        plugin: path.join(run, "plugin"),
        pluginData: path.join(run, "plugin-data"),
        data: path.join(run, "data"),
        audit: path.join(run, "backend.jsonl"),
        instance: `macro-eval-${owner.slice(0, 8)}`,
        port: config.port,
    };
    for (const dir of [layout.workspace, layout.pluginData, layout.data])
        fs.mkdirSync(dir);
    fs.writeFileSync(layout.audit, "", { flag: "wx", mode: 0o600 });
    return layout;
}

function inventory(directory) {
    const files = [];
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory())
            files.push(
                ...inventory(file).map((entry) => ({
                    ...entry,
                    file: path.join(item.name, entry.file),
                })),
            );
        else if (item.isFile())
            files.push({
                file: item.name,
                sha256: hash(fs.readFileSync(file)),
            });
        else
            throw new Error(
                `Runtime/source symlinks are not admitted: ${file}`,
            );
    }

    return files.sort((left, right) => left.file.localeCompare(right.file));
}

export function verifyNativeWorkspace(layout, expectedFiles) {
    const owner = readJson(path.join(layout.run, "evaluation-owner.json"));
    if (
        owner.owner !== layout.owner ||
        fs.lstatSync(layout.workspace).isSymbolicLink() ||
        fs.realpathSync(layout.workspace) !==
            path.join(fs.realpathSync(layout.run), "workspace") ||
        JSON.stringify(inventory(layout.workspace)) !==
            JSON.stringify(expectedFiles)
    )
        throw new NativeStop(
            "Generated synthetic workspace ownership/content changed",
            "blocked",
        );
}

export function validateNativeCliVersion(stdout, expected) {
    const observed = /^GitHub Copilot CLI (\d+\.\d+\.\d+)\.?\r?$/mu.exec(
        stdout,
    )?.[1];
    if (observed !== expected)
        throw new NativeStop(
            `Pinned CLI version mismatch: required ${expected}; observed ${observed ?? "unrecognized"}`,
            "blocked",
        );
    return observed;
}

export function verifyNativeHookRegistrationContext(
    layout,
    workspaceFiles,
    extensionHash,
    home,
) {
    verifyNativeWorkspace(layout, workspaceFiles);
    const extension = path.join(
        layout.plugin,
        "extensions",
        "typeagent",
        "extension.mjs",
    );
    if (
        path.dirname(home) !== layout.run ||
        !/^home-\d+$/u.test(path.basename(home)) ||
        fs.lstatSync(home).isSymbolicLink() ||
        fs.realpathSync(home) !==
            path.join(fs.realpathSync(layout.run), path.basename(home)) ||
        fs.realpathSync(extension) !==
            path.join(
                fs.realpathSync(layout.run),
                "plugin",
                "extensions",
                "typeagent",
                "extension.mjs",
            ) ||
        hash(fs.readFileSync(extension)) !== extensionHash
    )
        throw new NativeStop(
            "Hook registration requires the exact hashed extension and owned profile",
            "blocked",
        );
}

export function validateNativeStagedEntries(plugin) {
    const ts = createRequire(
        path.join(tsRoot, "packages", "copilot-plugin", "package.json"),
    )("typescript");
    for (const relative of ["hooks/hook-router.js", "mcp/server.js"]) {
        const file = path.join(plugin, "dist", relative);
        const ast = ts.createSourceFile(
            file,
            fs.readFileSync(file, "utf8"),
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.JS,
        );
        const visit = (node) => {
            const specifier =
                ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
                    ? node.moduleSpecifier
                    : ts.isCallExpression(node) &&
                        node.expression.kind === ts.SyntaxKind.ImportKeyword
                      ? node.arguments[0]
                      : undefined;
            if (
                specifier &&
                ts.isStringLiteral(specifier) &&
                !isBuiltin(specifier.text)
            )
                throw new NativeStop(
                    `Staged ${relative} is not a self-contained bundle: ${specifier.text}. Canonical staging must bundle the complete current compiled runtime dependency closure before scheduling a rehearsal.`,
                    "blocked",
                );
            ts.forEachChild(node, visit);
        };
        visit(ast);
    }
}
export function verifyNativeStagedManifest(plugin, extensionSource) {
    const manifest = readJson(path.join(plugin, "bundle-manifest.json"));
    const extensionTarget = path.join(
        plugin,
        "extensions",
        "typeagent",
        "extension.mjs",
    );
    const expected = hash(fs.readFileSync(extensionSource));
    if (
        manifest.package !== "@typeagent/copilot-plugin" ||
        manifest.runtimeClosure?.extensionSha256 !== expected ||
        hash(fs.readFileSync(extensionTarget)) !== expected ||
        !manifest.runtimeClosure.inputs?.length
    )
        throw new NativeStop(
            "Staged runtime manifest/current extension mismatch",
            "blocked",
        );
    for (const input of manifest.runtimeClosure.inputs)
        if (
            !path.isAbsolute(input.file) ||
            hash(fs.readFileSync(input.file)) !== input.sha256
        )
            throw new NativeStop(
                "Compiled runtime dependency changed after staging",
                "blocked",
            );
}

export function validateNativeObservation(
    observation,
    { allowMetadataCatalogPending = false } = {},
) {
    if (
        /Failed to connect to MCP server|MCP Servers reloaded:.*\bfailed\b/u.test(
            observation.screen,
        )
    )
        throw new NativeStop(
            "Native MCP catalog startup failed; no task may be submitted",
            "blocked",
        );
    if (
        /Unknown tool name in the tool allowlist:/u.test(observation.screen) &&
        (!allowMetadataCatalogPending ||
            nativeCatalogReady(
                observation.screen,
                nativeConfiguredServerCount(),
            ))
    )
        throw new NativeStop(
            "Native CLI reports unresolved tool allowlist names; exact tool restriction readiness is unproved",
            "blocked",
        );
    const failed = observation.events.find(
        (event) => event.type === "hook.end" && event.data?.success === false,
    );
    if (failed)
        throw new NativeStop(
            `Native hook failed: ${failed.data.error?.message ?? "unknown hook error"}`,
            "failed",
        );
}

export function nativeCatalogReady(screen, expectedServers) {
    const match = screen.match(
        /MCP Servers reloaded: (\d+) servers? connected/u,
    );
    return (
        !!match &&
        Number(match[1]) === expectedServers &&
        !/\bfailed\b/u.test(match.input.slice(match.index))
    );
}

function nativeConfiguredServerCount() {
    return (
        Object.keys(
            readJson(
                path.join(tsRoot, "packages", "copilot-plugin", ".mcp.json"),
            ).mcpServers,
        ).length + 1
    );
}

export function nativeReadyObservation(observation) {
    if (
        typeof observation.sessionId !== "string" ||
        !observation.sessionId.trim() ||
        !/Session:/u.test(observation.screen) ||
        !nativeCatalogReady(observation.screen, nativeConfiguredServerCount())
    )
        return undefined;
    return observation;
}

function admitDiagnosticCatalog(layout, observation, adapter) {
    const admissionFile = path.join(
        layout.data,
        "native-control-admission.json",
    );
    writeJson(`${admissionFile}.pending`, {
        ...readJson(admissionFile),
        diagnosticCatalogReady: true,
        diagnosticCatalogSessionId: observation.sessionId,
        diagnosticActorIdentities: adapter.controlIdentities?.() ?? [],
    });
    fs.renameSync(`${admissionFile}.pending`, admissionFile);
}

function metadataCatalogPending(observation, budget, decision) {
    return (
        budget.metadataOnly &&
        observation.verifiedHookRegistration === true &&
        decision?.reason === "register hooks once"
    );
}

function prepareNative(layout, config, corpus, helperDirectory) {
    writeJson(path.join(layout.data, "native-control-admission.json"), {
        owner: layout.owner,
        ownedRoot: layout.run,
        configPath: path.join(layout.pluginData, "config.json"),
        expectedMode: "bypass",
        diagnosticTransitions: config.diagnosticOnly === true,
    });
    writeJson(path.join(layout.pluginData, "config.json"), {
        mode: "bypass",
        powershell: { enabled: false },
    });
    execFileSync(
        "git",
        ["init", "--quiet", "--template=", "--initial-branch=macro-eval"],
        {
            cwd: layout.workspace,
            timeout: 10000,
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
    const node = process.execPath;
    const fixture = path.join(scripts, "macro-eval-fixture.mjs");
    const corpusPath = path.join(layout.run, "corpus.json");
    writeJson(corpusPath, corpus);
    const mcp = {
        mcpServers: {
            "macro-eval-docs": {
                type: "stdio",
                command: node,
                args: [
                    fixture,
                    "--corpus",
                    corpusPath,
                    "--audit",
                    layout.audit,
                    "--append-audit",
                ],
                tools: ["lookup_document", "fetch_document"],
            },
        },
    };
    writeJson(path.join(layout.workspace, ".mcp.json"), mcp);
    fs.writeFileSync(
        path.join(layout.workspace, "AGENTS.md"),
        "For a document read, return the complete fetched document title and contents. " +
            "Clarify missing or vague titles. Never invent document identities. " +
            "Never approve macros or change permissions. Follow the real TypeAgent handoff when present.\n",
        { flag: "wx" },
    );
    const required = [
        config.cliExecutable,
        path.join(
            tsRoot,
            "packages",
            "agentServer",
            "server",
            "dist",
            "server.js",
        ),
        path.join(
            tsRoot,
            "packages",
            "agentServer",
            "client",
            "dist",
            "index.js",
        ),
        ...["Launch-Demo.ps1", "Control-Demo.ps1", "console-bridge.mjs"].map(
            (name) => path.join(helperDirectory, name),
        ),
        path.join(tsRoot, "tools", "scripts", "stageCopilotPlugin.mjs"),
        path.join(tsRoot, "tools", "scripts", "bundleUtils.mjs"),
    ];
    for (const file of required)
        if (!fs.statSync(file).isFile())
            throw new Error(`Required built runtime/helper missing: ${file}`);
    return {
        protocol: "macro-native-rehearsal-v1",
        acceptance: "unexecuted",
        sourceCommit: execFileSync("git", ["--no-pager", "rev-parse", "HEAD"], {
            cwd: tsRoot,
            encoding: "utf8",
        }).trim(),
        dirtyFiles: execFileSync("git", ["--no-pager", "status", "--short"], {
            cwd: tsRoot,
            encoding: "utf8",
        })
            .trim()
            .split(/\r?\n/u)
            .filter(Boolean),
        config,
        configurationHash: hash(JSON.stringify(config)),
        workspaceFiles: inventory(layout.workspace),
        corpusHash: hash(JSON.stringify(corpus)),
        node: { executable: node, version: process.version },
        runtime: required.map((file) => ({
            file,
            sha256: hash(fs.readFileSync(file)),
        })),
        source: inventory(
            path.join(tsRoot, "packages", "copilot-plugin", "src"),
        ),
        serverSource: inventory(
            path.join(tsRoot, "packages", "agentServer", "server", "src"),
        ),
        coupledProduct: Object.fromEntries(
            ["copilot-macros", "defaultAgentProvider", "copilot-plugin"].map(
                (name) => [
                    name,
                    Object.fromEntries(
                        ["src", "dist"].map((directory) => [
                            directory,
                            inventory(
                                path.join(tsRoot, "packages", name, directory),
                            ),
                        ]),
                    ),
                ],
            ),
        ),
        evaluator: fs
            .readdirSync(scripts)
            .filter((name) => /^macro-eval.*\.mjs$/u.test(name))
            .map((file) => ({
                file,
                sha256: hash(fs.readFileSync(path.join(scripts, file))),
            })),
        timingBoundary: "controller-submit-to-observed-terminal",
        usage: null,
        cost: null,
    };
}

export function freezeNativeExecutable(executable) {
    const resolvedExecutable = fs.realpathSync(executable);
    return {
        executable,
        resolvedExecutable,
        sha256: hash(fs.readFileSync(resolvedExecutable)),
    };
}

export function verifyNativeExecutable(frozen) {
    const current = freezeNativeExecutable(frozen.executable);
    if (
        current.resolvedExecutable !== frozen.resolvedExecutable ||
        current.sha256 !== frozen.sha256
    )
        throw new NativeStop(
            "Frozen native executable changed after version admission",
            "blocked",
        );
}

export function nativeFailureStatus(error) {
    return ["failed", "blocked", "harness-invalid"].includes(error?.status)
        ? error.status
        : "harness-invalid";
}

export function validateOwnedServiceListener(
    supervisor,
    tree,
    listeners,
    port,
    previousTree = tree,
) {
    if (listeners.length === 0) return false;
    if (listeners.length !== 1 || listeners[0].LocalPort !== port)
        throw new NativeStop(
            "Service readiness requires exactly one explicit-port listener",
        );
    if (
        listeners[0].LocalAddress !== "127.0.0.1" ||
        listeners[0].ListenerTable !== "TCP_TABLE_OWNER_PID_LISTENER"
    )
        throw new NativeStop(
            "Service readiness requires OS-classified exact loopback listener ownership",
        );
    const processes = new Map(tree.map((item) => [item.ProcessId, item]));
    const previous = new Map(
        previousTree.map((item) => [item.ProcessId, item]),
    );
    const root = processes.get(supervisor.ProcessId);
    if (
        !root ||
        root.StartedMs !== supervisor.StartedMs ||
        root.ExecutablePath !== supervisor.ExecutablePath
    )
        throw new NativeStop("Owned service supervisor identity changed");
    let owner = processes.get(listeners[0].OwningProcess);
    const seen = new Set();
    while (owner && !seen.has(owner.ProcessId)) {
        const frozen = previous.get(owner.ProcessId);
        if (
            !frozen ||
            !Number.isFinite(owner.StartedMs) ||
            !path.win32.isAbsolute(owner.ExecutablePath ?? "") ||
            frozen.StartedMs !== owner.StartedMs ||
            frozen.ExecutablePath !== owner.ExecutablePath ||
            frozen.ParentProcessId !== owner.ParentProcessId
        )
            throw new NativeStop(
                "Owned listener ancestry identity changed or is unverifiable",
            );
        if (owner.ProcessId === root.ProcessId) return true;
        seen.add(owner.ProcessId);
        const parent = processes.get(owner.ParentProcessId);
        if (parent && owner.StartedMs < parent.StartedMs)
            throw new NativeStop("Owned listener ancestry predates its parent");
        owner = parent;
    }
    throw new NativeStop(
        "Readiness listener is not the owned service supervisor or worker",
    );
}

function cleanServiceEnvironment(inherited, layout, config) {
    const env = { ...inherited };
    for (const name of Object.keys(env))
        if (
            /^(?:TYPEAGENT_|CLAUDE_PLUGIN_DATA$|INSTANCE_NAME$|COPILOT_HOME$|COPILOT_ALLOW_ALL$|COPILOT_ASSISTED_APPROVAL$)/iu.test(
                name,
            )
        )
            delete env[name];
    return {
        ...env,
        TYPEAGENT_HOST: "127.0.0.1",
        TYPEAGENT_PORT: String(config.port),
        TYPEAGENT_USER_DATA_DIR: layout.data,
        CLAUDE_PLUGIN_DATA: layout.pluginData,
        TYPEAGENT_CONFIG_DIR: config.configDirectory,
        INSTANCE_NAME: layout.instance,
        ...Object.fromEntries(
            ["RECORDING", "INDUCTION", "REPLAY", "AGENT_HANDOFF"].map(
                (name) => [`TYPEAGENT_MACRO_${name}_ENABLED`, "true"],
            ),
        ),
    };
}

export function nativeToolFilters() {
    return [
        "mcp:macro-eval-docs-lookup_document",
        "mcp:macro-eval-docs-fetch_document",
        "builtin:task",
    ];
}

export function nativeControlProof(
    layout,
    expectedMode = "bypass",
    identities = [],
    snapshots,
) {
    const directory = path.join(layout.data, "native-control");
    const records =
        snapshots ??
        (fs.existsSync(directory)
            ? fs
                  .readdirSync(directory)
                  .filter((file) => file.endsWith(".json"))
                  .map((file) => readJson(path.join(directory, file)))
            : []);
    const configPath = path.join(layout.pluginData, "config.json");
    const mismatches = records.filter(
        (record) =>
            record.source?.owner !== layout.owner ||
            record.dataRoot !== layout.data ||
            record.configPath !== configPath ||
            record.effectiveMode !== expectedMode ||
            !record.source?.readableOwnedConfig ||
            !/^[a-f0-9]{64}$/u.test(record.digest ?? "") ||
            !Number.isFinite(Date.parse(record.source?.observedAt)) ||
            Date.parse(record.source.observedAt) <
                Date.parse(layout.controlStartedAt ?? "") ||
            Date.parse(record.source.observedAt) > Date.now() ||
            (record.source.component !== "native-hook" &&
                !identities.some(
                    (identity) =>
                        identity.ProcessId === record.source.pid &&
                        identity.ParentProcessId === record.source.parentPid &&
                        identity.ExecutablePath?.toLowerCase() ===
                            record.source.executable?.toLowerCase() &&
                        identity.StartedMs <=
                            Date.parse(record.source.observedAt),
                )),
    );
    const mcp = records.filter((record) =>
        record.source?.component?.startsWith("mcp-"),
    );
    const extension = records.filter(
        (record) => record.source?.component === "native-extension-status",
    );
    const hooks = records.filter(
        (record) =>
            record.source?.component === "native-hook" &&
            extension.some(
                (parent) => parent.source.pid === record.source.parentPid,
            ),
    );
    const requiredMcp = [
        "mcp-agent",
        "mcp-workspace",
        "mcp-macros",
        "mcp-skills",
    ];
    const complete =
        requiredMcp.every(
            (component) =>
                mcp.filter((record) => record.source.component === component)
                    .length === 1,
        ) &&
        mcp.length === 4 &&
        extension.length === 1 &&
        hooks.length === 1;
    const consistentDigest =
        new Set(records.map((record) => record.digest)).size === 1;
    return {
        records,
        expectedMode,
        expectedConfigPath: configPath,
        expectedDataRoot: layout.data,
        mismatches,
        complete,
        consistentDigest,
        identities,
        passed: mismatches.length === 0 && complete && consistentDigest,
        hookTransport:
            "Required: compiled --control-metadata child of registered native-extension status getter; controller IPC/startup is not that getter, a native callback, or terminal proof.",
    };
}

export function consoleConfiguration(layout, config, index) {
    const home = path.join(layout.run, `home-${index}`);
    fs.mkdirSync(home);
    return {
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
            ...nativeToolFilters(),
            "--log-dir",
            path.join(layout.run, `cli-logs-${index}`),
        ],
        environment: {
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
        },
    };
}

function powershell(script, args, timeout) {
    return execFileSync(
        "powershell.exe",
        ["-NoProfile", "-File", script, ...args],
        {
            encoding: "utf8",
            windowsHide: true,
            timeout,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
        },
    );
}

export function nativeControlTimeout(action, remaining) {
    return action === "Close" ? 30000 : Math.min(remaining, 15000);
}

export function processTree(pid, timeout = 10000) {
    if (!Number.isSafeInteger(pid) || pid < 1)
        throw new NativeStop("Owned process requires a valid explicit PID");
    const code =
        `$ErrorActionPreference='Stop'; $all=@(Get-CimInstance Win32_Process -ErrorAction Stop); $ids=@(${Number(pid)}); ` +
        `for($i=0;$i -lt $ids.Count;$i++){ foreach($id in @($all | Where-Object {$_.ParentProcessId -eq $ids[$i]} | ForEach-Object {$_.ProcessId})){ if($id -notin $ids){ $ids+= $id } } }; ` +
        `$all | Where-Object {$_.ProcessId -in $ids} | Select-Object ProcessId,ParentProcessId,@{n='StartedMs';e={([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}},ExecutablePath | ConvertTo-Json -Compress`;
    try {
        const text = execFileSync(
            "powershell.exe",
            ["-NoProfile", "-Command", code],
            { encoding: "utf8", timeout, stdio: ["ignore", "pipe", "pipe"] },
        );
        if (!text.trim()) return [];
        const value = JSON.parse(text);
        return Array.isArray(value) ? value : [value];
    } catch (error) {
        throw new NativeStop(
            `OS process ownership proof unavailable: ${error.stderr?.toString().trim() || error.message}`,
            "blocked",
        );
    }
}

export function probeWindowsServiceListeners(
    port,
    scratchDirectory,
    timeout = 10000,
    execute = execFileSync,
) {
    if (process.platform !== "win32")
        throw new NativeStop(
            "Windows listener ownership proof requires Windows",
        );
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
        throw new NativeStop("Listener probe requires an explicit valid port");
    // Request the OS listener-only table. On this Windows build even CIM's raw
    // State is zero; neither a State filter nor a guessed replacement is proof.
    const source = `
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Net;
using System.Runtime.InteropServices;
public class MacroEvalListener {
    public string LocalAddress;
    public int LocalPort;
    public uint OwningProcess;
    public uint State;
    public string ListenerTable = "TCP_TABLE_OWNER_PID_LISTENER";
}
public class MacroEvalTcp {
    [DllImport("iphlpapi.dll", SetLastError=true)]
    static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool order, int family, int tableClass, uint reserved);
    public static MacroEvalListener[] Read(int port) {
        var rows = new List<MacroEvalListener>();
        ReadFamily(rows, port, 2, 24);
        ReadFamily(rows, port, 23, 56);
        return rows.ToArray();
    }
    static void ReadFamily(List<MacroEvalListener> rows, int port, int family, int stride) {
        int size = 0;
        uint status = GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, 3, 0);
        if (status != 122) throw new Win32Exception((int)status, "Windows listener ownership table sizing failed");
        IntPtr buffer = IntPtr.Zero;
        try {
            for (int attempt = 0; attempt < 3; attempt++) {
                if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
                buffer = Marshal.AllocHGlobal(size);
                status = GetExtendedTcpTable(buffer, ref size, false, family, 3, 0);
                if (status != 122) break;
            }
            if (status != 0) throw new Win32Exception((int)status, "Windows listener ownership table read failed");
            int count = Marshal.ReadInt32(buffer);
            if (count < 0 || count > (size - 4) / stride) throw new InvalidOperationException("Invalid Windows listener table size");
            for (int index = 0; index < count; index++) {
                IntPtr row = IntPtr.Add(buffer, 4 + index * stride);
                int rawPort = Marshal.ReadInt32(row, family == 2 ? 8 : 20);
                int localPort = ((rawPort & 255) << 8) | ((rawPort >> 8) & 255);
                if (localPort != port) continue;
                uint state = (uint)Marshal.ReadInt32(row, family == 2 ? 0 : 48);
                if (state != 0 && state != 2) throw new InvalidOperationException("Unsupported native listener table state");
                byte[] address = new byte[family == 2 ? 4 : 16];
                Marshal.Copy(IntPtr.Add(row, family == 2 ? 4 : 0), address, 0, address.Length);
                var ip = family == 2 ? new IPAddress(address) : new IPAddress(address, (uint)Marshal.ReadInt32(row, 16));
                rows.Add(new MacroEvalListener {
                    LocalAddress = ip.ToString(), LocalPort = localPort, State = state,
                    OwningProcess = (uint)Marshal.ReadInt32(row, family == 2 ? 20 : 52)
                });
            }
        } finally {
            if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
        }
    }
}`;
    const command =
        `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'\n${source}\n'@; ` +
        `ConvertTo-Json -InputObject @([MacroEvalTcp]::Read(${port})) -Compress`;
    try {
        fs.mkdirSync(scratchDirectory, { recursive: true });
        return JSON.parse(
            execute("powershell.exe", ["-NoProfile", "-Command", command], {
                encoding: "utf8",
                timeout,
                windowsHide: true,
                env: {
                    ...process.env,
                    TEMP: scratchDirectory,
                    TMP: scratchDirectory,
                },
                stdio: ["ignore", "pipe", "pipe"],
            }),
        );
    } catch (error) {
        throw new NativeStop(
            `OS listener ownership proof unavailable: ${error.stderr?.toString().trim() || error.message}`,
            "blocked",
        );
    }
}

function stopIdentities(identities) {
    for (const item of identities.toReversed()) {
        const code =
            `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${Number(item.ProcessId)}"; ` +
            `if($p -and ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() -eq ${item.StartedMs} ` +
            `-and $p.ExecutablePath -eq '${item.ExecutablePath?.replaceAll("'", "''")}'){ Stop-Process -Id ${Number(item.ProcessId)} -Force -ErrorAction Stop }`;
        execFileSync("powershell.exe", ["-NoProfile", "-Command", code], {
            timeout: 10000,
            stdio: "ignore",
        });
    }
    for (const item of identities) {
        const current = processTree(item.ProcessId);
        if (
            current.some(
                (entry) =>
                    entry.ProcessId === item.ProcessId &&
                    entry.StartedMs === item.StartedMs,
            )
        )
            throw new NativeStop(
                `Owned process ${item.ProcessId} survived cleanup`,
            );
    }
}

async function makeLiveAdapter(layout, config, helperDirectory, budget) {
    const { childEnvironment } = await import(
        pathToFileURL(path.join(helperDirectory, "console-bridge.mjs"))
    );
    const { stageCopilotPlugin } = await import(
        "../../../tools/scripts/stageCopilotPlugin.mjs"
    );
    const { checkPort, waitForServer, startProcess } = await import(
        "../../copilot-plugin/scripts/discovery-e2e.mjs"
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
    let server,
        serviceIdentity,
        connection,
        consoleRun,
        home,
        consoleIdentity,
        admittedConsole;
    const consoles = [];
    const routesDirectory = path.join(
        layout.data,
        "profiles",
        layout.instance,
        "conversations",
    );
    const helper = path.join(helperDirectory, "Control-Demo.ps1");
    const expectedWorkspace = readJson(
        path.join(layout.run, "manifest.json"),
    ).workspaceFiles;
    const control = (action, text) =>
        powershell(
            helper,
            [
                "-Action",
                action,
                "-RunDirectory",
                consoleRun,
                ...(text === undefined ? [] : ["-Text", text]),
            ],
            nativeControlTimeout(action, budget.remaining()),
        );
    const sessionEvents = () => {
        const directory = path.join(home, "session-state");
        if (!fs.existsSync(directory)) return { events: [] };
        const sessions = fs
            .readdirSync(directory)
            .filter((id) =>
                fs.existsSync(path.join(directory, id, "events.jsonl")),
            );
        if (sessions.length > 1)
            throw new NativeStop("More than one owned root native session");
        return sessions.length
            ? {
                  sessionId: sessions[0],
                  events: readNativeJsonl(
                      path.join(directory, sessions[0], "events.jsonl"),
                  ),
              }
            : { events: [] };
    };
    const routeLog = () =>
        !fs.existsSync(routesDirectory)
            ? []
            : fs.readdirSync(routesDirectory).flatMap((id) => {
                  const file = path.join(
                      routesDirectory,
                      id,
                      "displayLog.json",
                  );
                  return fs.existsSync(file)
                      ? readJson(file).map((entry) => ({
                            ...entry,
                            conversationId: id,
                        }))
                      : [];
              });
    return {
        async startService() {
            budget.check();
            await checkPort(config.port);
            stageCopilotPlugin(layout.plugin);
            validateNativeStagedEntries(layout.plugin);
            const extensionSource = path.join(
                tsRoot,
                "packages",
                "copilot-plugin",
                "dist",
                "extensions",
                "typeagent",
                "extension.mjs",
            );
            const extensionTarget = path.join(
                layout.plugin,
                "extensions",
                "typeagent",
                "extension.mjs",
            );
            if (
                hash(fs.readFileSync(extensionSource)) !==
                hash(fs.readFileSync(extensionTarget))
            )
                throw new NativeStop(
                    "Staged extension does not match the current built plugin",
                    "blocked",
                );
            verifyNativeStagedManifest(layout.plugin, extensionSource);
            writeJson(
                path.join(layout.run, `staged-runtime-${consoles.length}.json`),
                inventory(layout.plugin),
            );
            if (config.diagnosticOnly) {
                // The control diagnostic never calls a fixture operation.
                const stdout = execFileSync(
                    process.execPath,
                    [
                        path.join(
                            layout.plugin,
                            "dist",
                            "hooks",
                            "hook-router.js",
                        ),
                    ],
                    {
                        encoding: "utf8",
                        input: JSON.stringify({
                            sessionId: layout.owner,
                            cwd: layout.workspace,
                            prompt: "@typeagent status",
                            timestamp: Date.now(),
                        }),
                        timeout: Math.min(15000, budget.remaining()),
                        env: {
                            ...cleanServiceEnvironment(
                                process.env,
                                layout,
                                config,
                            ),
                            TYPEAGENT_MODE: "bypass",
                        },
                        stdio: ["pipe", "pipe", "pipe"],
                    },
                );
                const status = JSON.parse(stdout);
                if (
                    status.handled !== true ||
                    !/TypeAgent/u.test(status.responseContent ?? "")
                )
                    throw new NativeStop(
                        "Compiled hook IPC status failed; no task may be submitted",
                        "blocked",
                    );
                writeJson(path.join(layout.run, "hook-ipc-status.json"), {
                    command: "@typeagent status",
                    output: status,
                    modelGeneration: false,
                    grammarMissProof: false,
                });
            }
            const frozen = freezeNativeExecutable(config.cliExecutable);
            const cliConfig = consoleConfiguration(
                layout,
                config,
                consoles.length,
            );
            cliConfig.command = frozen.resolvedExecutable;
            const version = execFileSync(
                frozen.resolvedExecutable,
                ["--no-auto-update", "--experimental", "--version"],
                {
                    encoding: "utf8",
                    timeout: Math.min(budget.remaining(), 10000),
                    cwd: cliConfig.workspace,
                    env: childEnvironment(
                        process.env,
                        cliConfig.environment.COPILOT_HOME,
                        cliConfig.environment,
                    ),
                },
            );
            writeJson(
                path.join(layout.run, `cli-version-${consoles.length}.json`),
                {
                    ...frozen,
                    home: cliConfig.environment.COPILOT_HOME,
                    workspace: cliConfig.workspace,
                    environmentContract:
                        "shared-helper childEnvironment with the exact real-launch owned overlay",
                    expected: config.cliVersion,
                    stdout: version,
                    observedAt: new Date().toISOString(),
                },
            );
            validateNativeCliVersion(version, config.cliVersion);
            verifyNativeExecutable(frozen);
            admittedConsole = { cliConfig, frozen };
            const out = fs.openSync(
                path.join(layout.run, `service-${consoles.length}.stdout.log`),
                "wx",
            );
            const err = fs.openSync(
                path.join(layout.run, `service-${consoles.length}.stderr.log`),
                "wx",
            );
            try {
                server = startProcess(
                    process.execPath,
                    [
                        path.join(
                            tsRoot,
                            "packages",
                            "agentServer",
                            "server",
                            "dist",
                            "server.js",
                        ),
                        "--port",
                        String(config.port),
                        "--host",
                        "127.0.0.1",
                        "--config",
                        "test",
                        "--idle-timeout",
                        "600",
                    ],
                    {
                        cwd: tsRoot,
                        env: cleanServiceEnvironment(
                            process.env,
                            layout,
                            config,
                        ),
                        stdio: ["ignore", out, err],
                    },
                );
            } finally {
                fs.closeSync(out);
                fs.closeSync(err);
            }
            serviceIdentity = processTree(
                server.child.pid,
                Math.min(10000, budget.remaining()),
            ).find((item) => item.ProcessId === server.child.pid);
            if (!serviceIdentity)
                throw new NativeStop("Owned service process identity missing");
            await waitForServer(
                server,
                config.port,
                Math.min(120, budget.remaining() / 1000),
                AbortSignal.timeout(budget.remaining()),
                path.join(layout.run, `service-${consoles.length}.stderr.log`),
            );
            const readiness = {
                supervisor: serviceIdentity,
                osProbe:
                    "iphlpapi.dll GetExtendedTcpTable/TCP_TABLE_OWNER_PID_LISTENER; IPv4 and IPv6; exact 127.0.0.1",
                observations: [],
            };
            const readinessDeadline =
                Date.now() + Math.min(30000, budget.remaining());
            let ownedListener = false;
            try {
                while (!ownedListener && Date.now() < readinessDeadline) {
                    budget.check();
                    const previousTree = processTree(
                        server.child.pid,
                        Math.min(10000, budget.remaining()),
                    );
                    const listeners = probeWindowsServiceListeners(
                        config.port,
                        path.join(layout.run, "windows-os-probe"),
                        Math.min(10000, budget.remaining()),
                    );
                    const tree = processTree(
                        server.child.pid,
                        Math.min(10000, budget.remaining()),
                    );
                    readiness.observations.push({
                        at: new Date().toISOString(),
                        tree,
                        previousTree,
                        listeners,
                    });
                    ownedListener = validateOwnedServiceListener(
                        serviceIdentity,
                        tree,
                        listeners,
                        config.port,
                        previousTree,
                    );
                    if (!ownedListener) await delay(250);
                }
                if (!ownedListener)
                    throw new NativeStop(
                        "Owned service listener readiness deadline exceeded",
                        "blocked",
                    );
            } catch (error) {
                readiness.error = error.message;
                throw error;
            } finally {
                writeJson(
                    path.join(
                        layout.run,
                        `service-readiness-${consoles.length}.json`,
                    ),
                    readiness,
                );
            }
            const connected = connectAgentServer(
                `ws://127.0.0.1:${config.port}`,
            );
            try {
                connection = await budget.run(connected);
            } catch (error) {
                void connected.then(
                    (late) => late.close(),
                    () => {},
                );
                throw error;
            }
            return budget.run(connection.listMacros({ limit: 100 }));
        },
        async openConsole() {
            budget.check();
            verifyNativeWorkspace(layout, expectedWorkspace);
            const index = consoles.length;
            consoleRun = path.join(layout.run, `console-${index}`);
            if (!admittedConsole)
                throw new NativeStop(
                    "Native console has no successful version admission",
                );
            verifyNativeExecutable(admittedConsole.frozen);
            const { cliConfig } = admittedConsole;
            home = cliConfig.environment.COPILOT_HOME;
            const file = path.join(layout.run, `console-${index}.private.json`);
            writeJson(file, cliConfig);
            consoles.push(consoleRun);
            // Launch creates its own fresh run directory.
            powershell(
                path.join(helperDirectory, "Launch-Demo.ps1"),
                [
                    "-ConfigPath",
                    file,
                    "-RunDirectory",
                    consoleRun,
                    "-NodePath",
                    process.execPath,
                    "-TimeoutSeconds",
                    String(
                        Math.max(
                            1,
                            Math.min(30, Math.floor(budget.remaining() / 1000)),
                        ),
                    ),
                ],
                Math.min(budget.remaining(), 45000),
            );
            const state = readJson(path.join(consoleRun, "console-state.json"));
            if (state.phase !== "running" || !state.cliPid)
                throw new NativeStop("CLI bridge not running");
            consoleIdentity = processTree(state.bridgePid);
            if (
                !consoleIdentity.some((item) => item.ProcessId === state.cliPid)
            )
                throw new NativeStop("CLI is not a child of the owned bridge");
            writeJson(
                path.join(consoleRun, "process-identities.json"),
                consoleIdentity,
            );
            writeJson(path.join(consoleRun, "launcher-child-provenance.json"), {
                admittedExecutable: admittedConsole.frozen,
                launcherPid: state.cliPid,
                bridgePid: state.bridgePid,
                children: consoleIdentity.map((item) => ({
                    ...item,
                    ...(item.ExecutablePath &&
                    fs.existsSync(item.ExecutablePath)
                        ? {
                              binary: freezeNativeExecutable(
                                  item.ExecutablePath,
                              ),
                          }
                        : {}),
                })),
            });
            for (const action of ["Compile", "Select", "Restore", "Verify"])
                control(action);
        },
        async closeConsole() {
            if (!consoleRun) return;
            const stateFile = path.join(consoleRun, "console-state.json");
            if (!fs.existsSync(stateFile)) {
                try {
                    control("Close");
                } finally {
                    consoleRun = undefined;
                }
                return;
            }
            if (!consoleIdentity) {
                const state = readJson(stateFile);
                const owner = readJson(path.join(consoleRun, "owner.json"));
                if (state.title !== owner.title)
                    throw new NativeStop(
                        "Console ownership mismatch during cleanup",
                    );
                consoleIdentity = processTree(state.bridgePid);
            }
            // Snapshot descendants only while the original bridge identity still matches.
            const root = consoleIdentity?.find(
                (item) => item.ProcessId === readJson(stateFile).bridgePid,
            );
            const current = root ? processTree(root.ProcessId) : [];
            const same = current.some(
                (item) =>
                    item.ProcessId === root?.ProcessId &&
                    item.StartedMs === root.StartedMs,
            );
            const identities = same ? current : (consoleIdentity ?? []);
            let closeError;
            try {
                control("Close");
            } catch (error) {
                closeError = error;
            }
            stopIdentities(identities);
            consoleRun = undefined;
            consoleIdentity = undefined;
            if (closeError)
                throw new NativeStop(
                    "Owned console Close failed; exact process cleanup attempted",
                );
        },
        async stopService() {
            try {
                await boundedNative(connection?.close(), 10000);
            } finally {
                connection = undefined;
                if (
                    server &&
                    server.child.exitCode === null &&
                    server.child.signalCode === null
                ) {
                    const identities = processTree(server.child.pid);
                    if (
                        identities.some(
                            (item) =>
                                item.ProcessId === serviceIdentity?.ProcessId &&
                                item.StartedMs === serviceIdentity.StartedMs,
                        )
                    )
                        stopIdentities(identities);
                    await Promise.race([server.completion, delay(5000)]);
                    if (
                        server.child.exitCode === null &&
                        server.child.signalCode === null
                    )
                        throw new NativeStop("Owned service did not stop");
                }
                server = undefined;
                serviceIdentity = undefined;
            }
        },
        setMode(mode) {
            fs.writeFileSync(
                path.join(layout.pluginData, "config.json"),
                JSON.stringify({ mode, powershell: { enabled: false } }),
            );
            const admissionFile = path.join(
                layout.data,
                "native-control-admission.json",
            );
            writeJson(admissionFile, {
                ...readJson(admissionFile),
                expectedMode: mode,
            });
        },
        read() {
            budget.check();
            const state = readJson(path.join(consoleRun, "console-state.json"));
            if (state.phase !== "running")
                throw new NativeStop("Owned native CLI exited");
            const screen = control("Read");
            let verifiedHookRegistration = false;
            if (/Confirm folder trust/u.test(screen))
                verifyNativeWorkspace(layout, expectedWorkspace);
            if (/wants elevated permissions/u.test(screen)) {
                const expectedExtension = readJson(
                    path.join(
                        layout.run,
                        `staged-runtime-${consoles.length - 1}.json`,
                    ),
                ).find(
                    (entry) =>
                        entry.file ===
                        path.join("extensions", "typeagent", "extension.mjs"),
                );
                verifyNativeHookRegistrationContext(
                    layout,
                    expectedWorkspace,
                    expectedExtension?.sha256,
                    home,
                );
                verifiedHookRegistration = true;
            }
            return {
                ...sessionEvents(),
                backendAudit: readNativeJsonl(layout.audit),
                routes: routeLog(),
                screen,
                verifiedHookRegistration,
            };
        },
        submit: (text) => control("Type", text),
        recording: (sessionId) =>
            budget.run(connection.getMacroRecordingState(sessionId)),
        inspect: (reference) => budget.run(connection.inspectMacro(reference)),
        validate: (reference) =>
            budget.run(connection.validateMacro(reference)),
        approve: (reference) => budget.run(connection.approveMacro(reference)),
        runtime: () => inventory(layout.plugin),
        controlIdentities() {
            if (!consoleRun) return [];
            const pid = readJson(
                path.join(consoleRun, "console-state.json"),
            ).bridgePid;
            const root = consoleIdentity?.find(
                (item) => item.ProcessId === pid,
            );
            const current = processTree(pid);
            if (
                !root ||
                !current.some(
                    (item) =>
                        item.ProcessId === pid &&
                        item.StartedMs === root.StartedMs &&
                        item.ExecutablePath === root.ExecutablePath,
                )
            )
                throw new NativeStop(
                    "Native control actor ownership root changed",
                    "blocked",
                );
            return current;
        },
        finalEvents: () => sessionEvents().events,
    };
}

async function boundedNative(promise, milliseconds, signal) {
    let timer;
    let cancel;
    try {
        if (signal?.aborted)
            throw new NativeStop("Native evaluation cancelled", "blocked");
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new NativeStop(
                                "Native operation deadline exceeded",
                                "blocked",
                            ),
                        ),
                    milliseconds,
                );
                cancel = () =>
                    reject(
                        new NativeStop(
                            "Native evaluation cancelled",
                            "blocked",
                        ),
                    );
                signal?.addEventListener("abort", cancel, { once: true });
            }),
        ]);
    } finally {
        clearTimeout(timer);
        if (cancel) signal?.removeEventListener("abort", cancel);
    }
}

async function waitNative(
    adapter,
    budget,
    predicate,
    consent,
    workspace,
    decisions,
    onObservation,
) {
    const admitted = new Set();
    for (;;) {
        budget.check();
        const observation = adapter.read();
        onObservation?.(observation);
        if (
            budget.metadataOnly &&
            observation.events.some((event) =>
                [
                    "model.turn_started",
                    "model.model_call_started",
                    "assistant.turn_start",
                ].includes(event.type),
            )
        )
            throw new NativeStop(
                "Metadata diagnostic observed model-start telemetry; no workflows admitted",
                "blocked",
            );
        const decision = classifyNativeScreen(
            observation.screen,
            workspace,
            consent,
        );
        validateNativeObservation(observation, {
            allowMetadataCatalogPending: metadataCatalogPending(
                observation,
                budget,
                decision,
            ),
        });
        budget.check(observation.events);
        if (decision) {
            if (admitted.has(decision.reason))
                throw new NativeStop(
                    "Repeated native interaction after a decision",
                    "blocked",
                );
            admitted.add(decision.reason);
            decisions.push({ at: new Date().toISOString(), ...decision });
            adapter.submit(decision.text);
        } else {
            const result = await budget.run(predicate(observation));
            if (result) return result;
        }
        await delay(250);
    }
}

async function nativeCommand(adapter, budget, text, expectation, context) {
    const before = adapter.read().events.length;
    adapter.submit(text);
    return waitNative(
        adapter,
        budget,
        (observed) => {
            const evidence = extractNativeEvidence(
                observed.events.slice(before),
                [],
                [],
                "direct",
            );
            return evidence.terminal === "handled-hook" &&
                expectation.test(evidence.answer)
                ? evidence
                : undefined;
        },
        undefined,
        context.workspace,
        context.decisions,
    );
}

async function observeTrial(adapter, budget, scenario, corpus, mode, context) {
    const before = adapter.read();
    const routes = new Set(
        before.routes.map((entry) => `${entry.conversationId}:${entry.seq}`),
    );
    const submittedAt = Date.now();
    adapter.submit(scenario.prompt);
    const document = corpus.documents.find(
        (entry) => entry.key === scenario.expectedDocument,
    );
    const consent = {
        approve: context.config.approveSyntheticReadsOnce,
        tools: [
            {
                name: "macro-eval-docs-lookup_document",
                arguments: { title: document.title },
            },
            {
                name: "macro-eval-docs-fetch_document",
                arguments: { id: document.expectedId },
            },
        ],
    };
    const evidenceFor = (observed) =>
        extractNativeEvidence(
            observed.events.slice(before.events.length),
            observed.backendAudit.slice(before.backendAudit.length),
            observed.routes.filter(
                (entry) => !routes.has(`${entry.conversationId}:${entry.seq}`),
            ),
            mode,
        );
    const result = await waitNative(
        adapter,
        budget,
        (observed) => {
            const evidence = evidenceFor(observed);
            if (
                evidence.events.some(
                    (entry) =>
                        entry.type === "session.error" ||
                        entry.type === "subagent.failed" ||
                        (entry.type === "subagent.completed" &&
                            entry.data?.cancelled) ||
                        (entry.type === "tool.execution_complete" &&
                            entry.data?.success === false),
                )
            )
                throw new NativeStop(
                    "Native task failed or cancelled",
                    "failed",
                );
            const grade = gradeDocumentTrial({
                ...evidence,
                scenario,
                documents: corpus.documents,
            });
            const terminalPassed = grade.checks.find(
                (check) => check.name === "terminal-native-completion",
            )?.passed;
            if (!terminalPassed && evidence.terminal === "pending")
                return undefined;
            return {
                scenarioId: scenario.id,
                sessionId: observed.sessionId,
                mode,
                evidence,
                grade,
                submittedAt,
                observedTerminalAt: Date.now(),
                timingBoundary: "controller-submit-to-observed-terminal",
            };
        },
        consent,
        context.workspace,
        context.decisions,
        (observed) => {
            context.partialTrial = {
                scenarioId: scenario.id,
                sessionId: observed.sessionId,
                submittedAt,
                observedAt: Date.now(),
                evidence: evidenceFor(observed),
            };
        },
    );
    result.elapsedMs = result.observedTerminalAt - result.submittedAt;
    if (
        result.evidence.terminal === "handled-hook" &&
        !result.grade.checks.find(
            (check) => check.name === "terminal-native-completion",
        )?.passed
    ) {
        result.status = "blocked";
        result.blockedReason =
            "Authoritative handled-hook literal response has no turnId/host phases; grader contract update required";
    } else result.status = result.grade.status;
    context.partialTrial = undefined;
    return result;
}

function assertLiveAdmission(config, adapterFactory) {
    if (!config.diagnosticOnly && !adapterFactory)
        throw new NativeStop(
            "Task rehearsal blocked before models: explicit Copilot bypass is not a grammar miss. Grader route contract must admit an explicit bypass baseline/capture and current mode/data-root transition proof.",
            "blocked",
        );
    if (!adapterFactory && process.platform !== "win32")
        throw new NativeStop(
            "Live native controller requires Windows",
            "blocked",
        );
}

export async function runNativeEvaluation({
    corpus,
    config,
    output,
    helperDirectory,
    executeLive = false,
    signal,
    adapterFactory,
}) {
    const selected = validateNativeConfig(config, corpus);
    if (typeof executeLive !== "boolean")
        throw new Error("executeLive must be boolean");
    if (!path.isAbsolute(helperDirectory ?? ""))
        throw new Error(
            "Explicit absolute --console-helper-dir required (scripts directory)",
        );
    const layout = ownLayout(output, config);
    const report = {
        protocol: "macro-native-rehearsal-v1",
        status: "unexecuted",
        trials: [],
        decisions: [],
        operatorActions: [],
        startedAt: new Date().toISOString(),
    };
    let adapter;
    const budget = createNativeBudget(config, signal);
    budget.metadataOnly = config.diagnosticOnly === true;
    const context = { ...layout, config, decisions: report.decisions };
    layout.controlStartedAt = report.startedAt;
    let controlIdentities = [];
    try {
        budget.check();
        const manifest = prepareNative(layout, config, corpus, helperDirectory);
        writeJson(path.join(layout.run, "manifest.json"), manifest);
        if (!executeLive) return report;
        assertLiveAdmission(config, adapterFactory);
        adapter = await (adapterFactory ?? makeLiveAdapter)(
            layout,
            config,
            helperDirectory,
            budget,
        );
        const catalog = await budget.run(adapter.startService());
        if (catalog.length)
            throw new NativeStop("Fresh owned catalog is not empty");
        await budget.run(adapter.openConsole());
        const readyObservation = await waitNative(
            adapter,
            budget,
            nativeReadyObservation,
            undefined,
            layout.workspace,
            report.decisions,
        );
        if (config.diagnosticOnly) {
            admitDiagnosticCatalog(layout, readyObservation, adapter);
            const transitionFile = path.join(
                layout.data,
                "native-control-diagnostic-result.json",
            );
            const transitionDiagnostic = await waitNative(
                adapter,
                budget,
                () => {
                    if (!fs.existsSync(transitionFile)) return undefined;
                    const value = readJson(transitionFile);
                    return value.status === "running" ? undefined : value;
                },
                undefined,
                layout.workspace,
                report.decisions,
            );
            const observed = adapter.read();
            validateNativeObservation(observed);
            budget.check(observed.events);
            report.diagnostic = {
                kind: "metadata-only-startup",
                toolFilters: nativeToolFilters(),
                nativeCommandSubmitted: false,
                commandContract:
                    "No user/task submitted. Native extension uses commands.list/invoke for existing local mode setters and typeagent-status --control (canonical Node compiled getter); tools.getCurrentMetadata only, never send/tool execute.",
                observedEvents: observed.events.length,
                sessionId: observed.sessionId,
                statusViewport: observed.screen,
                restrictionMetadata:
                    "source-qualified exact wire names accepted without warnings; availability is distinct from execution consent",
                remainingGate:
                    "Native user-prompt callback and capture lease proof remain unavailable; ordinary-route receipt must stay proof-blocked. Tool availability metadata is not execution-permission proof.",
                transitions: transitionDiagnostic,
            };
            controlIdentities = adapter.controlIdentities?.() ?? [];
            report.controlTransitionProofs = (
                transitionDiagnostic.transitions ?? []
            ).map((transition) =>
                nativeControlProof(
                    layout,
                    transition.mode,
                    controlIdentities,
                    transition.control,
                ),
            );
            report.controlProof =
                report.controlTransitionProofs.at(-1) ??
                nativeControlProof(layout, "bypass", controlIdentities);
            writeJson(
                path.join(layout.run, "native-startup-evidence.json"),
                report.diagnostic,
            );
            report.status = "blocked";
            report.error =
                transitionDiagnostic.status === "passed-metadata-only"
                    ? report.diagnostic.remainingGate
                    : (transitionDiagnostic.error ??
                      "Actual native control transition diagnostic blocked");
            return report;
        }
        controlIdentities = adapter.controlIdentities?.() ?? [];
        report.controlProof = nativeControlProof(
            layout,
            "bypass",
            controlIdentities,
        );
        if (!adapterFactory && !report.controlProof.passed)
            throw new NativeStop(
                "Authoritative native mode/data-root binding is missing or mismatched; no task admitted",
                "blocked",
            );
        adapter.setMode("bypass");
        const baseline = await observeTrial(
            adapter,
            budget,
            selected.reuse,
            corpus,
            "bypass",
            context,
        );
        report.trials.push({ ...baseline, candidate: "baseline" });
        if (baseline.status !== "passed")
            throw new NativeStop(
                "Baseline oracle did not pass",
                baseline.status,
            );
        adapter.setMode("direct");
        await nativeCommand(
            adapter,
            budget,
            "/typeagent-macro-learning prepare",
            /prepare/iu,
            context,
        );
        await nativeCommand(
            adapter,
            budget,
            "/typeagent-macro-record",
            /Recording token:/u,
            context,
        );
        const training = await observeTrial(
            adapter,
            budget,
            selected.training,
            corpus,
            "direct",
            context,
        );
        report.trials.push({ ...training, candidate: "training" });
        if (training.status !== "passed")
            throw new NativeStop(
                "Training correctness/completion oracle did not pass",
                training.status,
            );
        const recording = await waitNative(
            adapter,
            budget,
            async (observed) => {
                const state = await adapter.recording(observed.sessionId);
                if (state.learningJob?.status === "failed")
                    throw new NativeStop("Macro preparation failed", "failed");
                return state.learningJob?.status === "needsReview"
                    ? state
                    : undefined;
            },
            undefined,
            layout.workspace,
            report.decisions,
        );
        const reference = recording.learningJob.macro;
        const draft = await budget.run(adapter.inspect(reference));
        reviewNativeDraft(draft, await budget.run(adapter.validate(reference)));
        writeJson(path.join(layout.run, "reviewed-draft.json"), draft);
        if (!config.reviewSyntheticDraft)
            throw new NativeStop(
                "External bounded synthetic publication review not authorized",
                "blocked",
            );
        const approved = await budget.run(adapter.approve(reference));
        report.operatorActions.push({
            operation: "external bounded synthetic review/approve",
            reference: approved,
        });
        const reuse = await observeTrial(
            adapter,
            budget,
            selected.reuse,
            corpus,
            "direct",
            context,
        );
        report.trials.push({ ...reuse, candidate: "reuse" });
        requireGrammarTrial(reuse);
        if (config.restart) {
            await budget.run(adapter.closeConsole());
            await budget.run(adapter.stopService());
            const persisted = await budget.run(adapter.startService());
            if (
                !persisted.some(
                    (item) =>
                        item.macroId === approved.macroId &&
                        item.version === approved.version &&
                        item.state === "approved",
                )
            )
                throw new NativeStop(
                    "Approved macro missing after owned service restart",
                );
            await budget.run(adapter.openConsole());
            await waitNative(
                adapter,
                budget,
                (observation) =>
                    observation.sessionId &&
                    observation.sessionId !== reuse.sessionId &&
                    /Session:/u.test(observation.screen),
                undefined,
                layout.workspace,
                report.decisions,
            );
            const restarted = await observeTrial(
                adapter,
                budget,
                selected.reuse,
                corpus,
                "direct",
                context,
            );
            report.trials.push({ ...restarted, candidate: "restart-reuse" });
            requireGrammarTrial(restarted);
        }

        function requireGrammarTrial(trial) {
            if (
                trial.status !== "passed" ||
                trial.evidence.routeEvidence.route !== "grammar"
            )
                throw new NativeStop(
                    "Reuse must pass with actual grammar attribution",
                    trial.status === "passed" ? "blocked" : trial.status,
                );
        }
        report.status = "passed";
        report.runtime = adapter.runtime();
        return report;
    } catch (error) {
        report.status = nativeFailureStatus(error);
        report.error = error.message;
        return report;
    } finally {
        await finalizeNativeEvaluation({
            adapter,
            budget,
            layout,
            report,
            context,
            controlIdentities,
            config,
        });
    }
}

async function finalizeNativeEvaluation({
    adapter,
    budget,
    layout,
    report,
    context,
    controlIdentities,
    config,
}) {
    const transitionFile = path.join(
        layout.data,
        "native-control-diagnostic-result.json",
    );
    if (fs.existsSync(transitionFile))
        report.controlTransitions = readJson(transitionFile);
    try {
        controlIdentities = adapter?.controlIdentities?.() ?? controlIdentities;
    } catch (error) {
        report.controlOwnershipError = error.message;
    }
    report.controlProof = nativeControlProof(
        layout,
        "bypass",
        controlIdentities,
    );
    if (context.partialTrial) report.incompleteTrial = context.partialTrial;
    report.targetModelTurns = budget.used();
    report.completedAt = new Date().toISOString();
    report.elapsedMs =
        Date.parse(report.completedAt) - Date.parse(report.startedAt);
    report.cleanupErrors = [];
    for (const operation of ["closeConsole", "stopService"])
        try {
            await boundedNative(adapter?.[operation](), 30000);
        } catch (error) {
            report.cleanupErrors.push(error.message);
        }
    if (report.cleanupErrors.length) report.status = "harness-invalid";
    const finalEvents = adapter?.finalEvents?.() ?? [];
    report.nativeModelTelemetry = {
        counts: Object.fromEntries(
            [
                "assistant.turn_start",
                "model.turn_started",
                "model.model_call_started",
            ].map((type) => [
                type,
                finalEvents.filter((event) => event.type === type).length,
            ]),
        ),
        modelStarts: finalEvents.filter((event) =>
            ["model.turn_started", "model.model_call_started"].includes(
                event.type,
            ),
        ),
        serviceModelUsage:
            "unknown: no complete service model-start telemetry contract",
    };
    if (
        config.diagnosticOnly &&
        Object.values(report.nativeModelTelemetry.counts).some(
            (count) => count > 0,
        )
    ) {
        report.status = "harness-invalid";
        report.error =
            "Metadata-only diagnostic observed native model generation telemetry";
    }
    writeJson(path.join(layout.run, "result.json"), report);
}
