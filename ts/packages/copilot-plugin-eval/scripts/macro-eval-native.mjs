// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire, isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";
import { macroProtocolVersion } from "./macro-eval-plan.mjs";
export { extractNativeEvidence } from "./macro-eval-program.mjs";

const tsRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const isText = (value) => typeof value === "string" && value.trim().length > 0;

export class NativeStop extends Error {
    constructor(message, status = "harness-invalid") {
        super(message);
        this.status = status;
    }
}

export function validateNativeConfig(config) {
    if (config?.protocolVersion !== macroProtocolVersion)
        throw new Error(
            `Obsolete native configuration: re-create with protocolVersion ${macroProtocolVersion}; backend catalogs, runner models and old capture policies are retired.`,
        );
    const allowed = new Set([
        "protocolVersion",
        "recipeOwner",
        "workspace",
        "profileId",
        "sessionId",
        "rootModel",
        "maxTargetModelTurns",
        "maxDurationMs",
        "executionPath",
        "scope",
        "cliExecutable",
        "cliSha256",
        "helperDirectory",
        "trainingCase",
        "reuseCase",
        "restart",
        "authorization",
        "creditLedger",
    ]);
    for (const key of Object.keys(config))
        if (!allowed.has(key))
            throw new Error(
                `Unsupported native option ${key}; re-create the plugin-only configuration.`,
            );
    const owner = config.recipeOwner ?? "plugin";
    if (!["plugin", "off"].includes(owner))
        throw new Error(
            "recipeOwner must be plugin or off; re-record in the plugin workspace/profile catalog.",
        );
    if (config.scope !== "synthetic-only")
        throw new Error(
            "Only explicitly synthetic-only evaluation is admitted.",
        );
    if (
        !isText(config.workspace) ||
        !path.isAbsolute(config.workspace) ||
        !isText(config.profileId) ||
        (config.sessionId !== undefined && !isText(config.sessionId))
    )
        throw new Error(
            "Explicit absolute workspace/profileId and a nonempty optional pinned native sessionId are required; never synthesize broker registration.",
        );
    if (!isText(config.rootModel))
        throw new Error("Explicit rootModel is required.");
    for (const [key, max] of [
        ["maxTargetModelTurns", 1000],
        ["maxDurationMs", 3600000],
    ])
        if (
            !Number.isSafeInteger(config[key]) ||
            config[key] < 1 ||
            config[key] > max
        )
            throw new Error(`${key} must be an integer between 1 and ${max}.`);
    if (!["grammar", "explicit-mcp"].includes(config.executionPath))
        throw new Error(
            "executionPath must be grammar or explicit-mcp; explicit MCP is not a grammar hit.",
        );
    if (owner === "off" && config.executionPath === "explicit-mcp")
        throw new Error(
            "Explicit MCP recipe reuse requires recipeOwner plugin.",
        );
    return { ...config, recipeOwner: owner };
}

export async function runNativeEvaluation({
    corpus,
    config,
    output,
    executeLive = false,
    signal,
    adapterFactory,
}) {
    const admitted = validateNativeConfig(config);
    if (executeLive) {
        const { runPluginNativeEvaluation } = await import(
            "./macro-eval-native-driver.mjs"
        );
        return runPluginNativeEvaluation({
            corpus,
            config: admitted,
            output,
            signal,
            adapterFactory,
        });
    }
    fs.mkdirSync(output, { recursive: false });
    const report = {
        protocolVersion: macroProtocolVersion,
        status: "unexecuted",
        config: admitted,
        admission: false,
        note: "Offline configuration validation only. No model, tool, broker registration, catalog, media or live safety admission was attempted.",
    };
    fs.writeFileSync(
        path.join(output, "report.json"),
        JSON.stringify(report, null, 2) + "\n",
        { flag: "wx" },
    );
    return report;
}

export function createNativeBudget(config, signal, clock = Date.now) {
    const deadline = clock() + config.maxDurationMs;
    const seen = new Set();
    return {
        check(events = []) {
            for (const event of events)
                if (event.type === "assistant.turn_start") {
                    if (!event.id)
                        throw new NativeStop(
                            "Model turn lacks native identity",
                        );
                    seen.add(event.id);
                }
            if (signal?.aborted)
                throw new NativeStop("Native evaluation cancelled", "blocked");
            if (clock() >= deadline)
                throw new NativeStop(
                    "Native evaluation deadline exceeded",
                    "blocked",
                );
            if (seen.size > config.maxTargetModelTurns)
                throw new NativeStop(
                    "Native target model turn bound exceeded",
                    "blocked",
                );
        },
        remaining: () => Math.max(0, deadline - clock()),
        used: () => seen.size,
    };
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
                    `Staged ${relative} is not a self-contained bundle: ${specifier.text}`,
                    "blocked",
                );
            ts.forEachChild(node, visit);
        };
        visit(ast);
    }
}

export function verifyNativeStagedManifest(plugin, extensionSource) {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(plugin, "bundle-manifest.json"), "utf8"),
    );
    const expected = hash(fs.readFileSync(extensionSource));
    if (
        manifest.package !== "@typeagent/copilot-plugin" ||
        manifest.runtimeClosure?.extensionSha256 !== expected ||
        hash(
            fs.readFileSync(
                path.join(
                    plugin,
                    "dist",
                    "extensions",
                    "typeagent",
                    "extension.mjs",
                ),
            ),
        ) !== expected ||
        hash(
            fs.readFileSync(
                path.join(plugin, "extensions", "typeagent", "extension.mjs"),
            ),
        ) !== manifest.runtimeClosure.extensionLoaderSha256 ||
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
