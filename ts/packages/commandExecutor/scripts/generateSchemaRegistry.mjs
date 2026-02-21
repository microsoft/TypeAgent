// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Build-time script: scans packages/agents/ and generates src/generatedSchemaRegistry.json.
 * Run via "prebuild" in package.json so the JSON is always fresh before tsc.
 *
 * Usage: node scripts/generateSchemaRegistry.mjs
 * Working directory: ts/  (repo root) or ts/packages/commandExecutor/
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the agents directory relative to repo root.
// This script can be invoked from the package dir or the ts/ root.
function findAgentsDir() {
    const candidates = [
        path.resolve(__dirname, "../../agents"), // from packages/commandExecutor/scripts/ → ts/packages/agents
        path.resolve(process.cwd(), "packages/agents"), // from ts/ root
        path.resolve(process.cwd(), "../../agents"), // from packages/commandExecutor/ cwd
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    throw new Error(
        `Cannot locate packages/agents/. Tried:\n${candidates.join("\n")}`,
    );
}

const OUTPUT_PATH = path.resolve(
    __dirname,
    "../src/generatedSchemaRegistry.json",
);
const OUTPUT_PATH_DIST = path.resolve(
    __dirname,
    "../dist/generatedSchemaRegistry.json",
);

/** Recursively find all *Manifest.json or manifest.json files under dir. */
function findManifestFiles(dir) {
    const results = [];
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                results.push(...findManifestFiles(full));
            } else if (
                entry.name.endsWith("Manifest.json") ||
                entry.name === "manifest.json"
            ) {
                results.push(full);
            }
        }
    } catch {}
    return results;
}

/**
 * Extract action names + descriptions from a compiled .pas.json file.
 * Uses the compiler-extracted comments[] for descriptions.
 */
function extractActionsFromPas(pasFullPath) {
    try {
        const pas = JSON.parse(fs.readFileSync(pasFullPath, "utf-8"));
        const actions = [];
        for (const [, typeDef] of Object.entries(pas.types ?? {})) {
            const fields = typeDef.type?.fields;
            if (!fields?.actionName) continue;
            const actionNameEnum = fields.actionName.type?.typeEnum;
            if (!actionNameEnum?.length) continue;
            const name = actionNameEnum[0];
            const desc =
                (typeDef.comments?.[0] ?? "").trim() ||
                name
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (c) => c.toUpperCase())
                    .trim();
            actions.push({ name, description: desc });
        }
        return actions;
    } catch {
        return [];
    }
}

/** Fallback: extract action names from TypeScript source via regex. */
function extractActionNamesFromSource(source) {
    const seen = new Set();
    for (const [, name] of source.matchAll(/actionName:\s*"([^"]+)"/g)) {
        seen.add(name);
    }
    return [...seen];
}

/** Fallback: extract a JSDoc description for an action name from TS source. */
function extractActionDescriptionFromSource(source, actionName) {
    const re = new RegExp(
        `/\\*\\*([\\s\\S]*?)\\*/[\\s\\S]*?actionName:\\s*"${actionName}"`,
        "m",
    );
    const m = source.match(re);
    if (m) {
        return m[1]
            .split("\n")
            .map((l) => l.replace(/^\s*\*\s?/, "").trim())
            .filter(Boolean)
            .join(" ");
    }
    return actionName
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (c) => c.toUpperCase())
        .trim();
}

function readSchemaSource(manifestDir, schemaFile) {
    if (!schemaFile) return "";
    const schemaPath = path.resolve(manifestDir, schemaFile);
    try {
        return fs.readFileSync(schemaPath, "utf-8");
    } catch {
        return "";
    }
}

/**
 * Process one schema entry (main or sub-schema) and return a subSchema record.
 * Returns null if no actions found.
 */
function processSchemaEntry(manifestDir, tsRoot, schemaEntry, schemaName) {
    const { description, schemaFile, compiledSchemaFile } = schemaEntry;

    let actions = [];

    // Primary: use compiled .pas.json for action descriptions
    if (compiledSchemaFile) {
        const pasPath = path.resolve(tsRoot, compiledSchemaFile);
        actions = extractActionsFromPas(pasPath);
    }

    // Fallback: extract from TypeScript source via regex
    if (actions.length === 0 && schemaFile) {
        const source = readSchemaSource(manifestDir, schemaFile);
        const names = extractActionNamesFromSource(source);
        actions = names.map((n) => ({
            name: n,
            description: extractActionDescriptionFromSource(source, n),
        }));
    }

    if (actions.length === 0) return null;

    // Store absolute path so MCP server can read the source on demand (level-3)
    const schemaFilePath = schemaFile
        ? path.resolve(manifestDir, schemaFile)
        : null;

    return {
        schemaName,
        description: description ?? schemaName,
        schemaFilePath,
        actions,
    };
}

const SKIP_DIRS = new Set([
    "agentUtils",
    "dist",
    "test",
    "browser", // use Claude browser extension instead
    "settings", // dead stub — brightness/monitor superseded by desktop agent
    "montage", // requires shell embedded browser
    "androidMobile", // requires a connected Android device
    "markdown", // not applicable for MCP use
    "oracle", // not applicable for MCP use
    "spelunker", // not applicable for MCP use
]);

function processAgent(agentDir, tsRoot) {
    const agentName = path.basename(agentDir);
    if (SKIP_DIRS.has(agentName)) return null;

    const srcDir = path.join(agentDir, "src");
    const manifestFiles = findManifestFiles(srcDir);
    if (manifestFiles.length === 0) return null;

    const manifestPath = manifestFiles[0];
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
        return null;
    }

    // Skip agents marked as injected — these are internal/infrastructure agents
    if (manifest.schema?.injected === true) return null;

    const manifestDir = path.dirname(manifestPath);
    const subSchemas = [];

    // Main schema
    if (manifest.schema) {
        const sub = processSchemaEntry(
            manifestDir,
            tsRoot,
            manifest.schema,
            agentName,
        );
        if (sub) subSchemas.push(sub);
    }

    // Sub-schemas (e.g. desktop.desktop-taskbar, code.code-debug)
    for (const [subKey, subManifest] of Object.entries(
        manifest.subActionManifests ?? {},
    )) {
        if (!subManifest?.schema) continue;
        const sub = processSchemaEntry(
            manifestDir,
            tsRoot,
            subManifest.schema,
            `${agentName}.${subKey}`,
        );
        if (sub) subSchemas.push(sub);
    }

    if (subSchemas.length === 0) return null;

    const totalActions = subSchemas.reduce((n, s) => n + s.actions.length, 0);
    if (totalActions === 0) return null;

    return {
        name: agentName,
        emoji: manifest.emojiChar ?? "🤖",
        description: manifest.description ?? agentName,
        subSchemas,
    };
}

function main() {
    const agentsDir = findAgentsDir();
    const tsRoot = path.resolve(agentsDir, ".."); // ts/ root
    console.log(`Scanning agents in: ${agentsDir}`);

    const agentDirs = fs
        .readdirSync(agentsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(agentsDir, e.name));

    const registry = [];
    for (const agentDir of agentDirs) {
        const entry = processAgent(agentDir, tsRoot);
        if (entry) {
            registry.push(entry);
            const totalActions = entry.subSchemas.reduce(
                (n, s) => n + s.actions.length,
                0,
            );
            const subCount = entry.subSchemas.length;
            console.log(
                `  ✓ ${entry.name}  (${subCount} schema${subCount > 1 ? "s" : ""}, ${totalActions} actions)`,
            );
        }
    }

    const json = JSON.stringify(registry, null, 2);
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, json);
    fs.mkdirSync(path.dirname(OUTPUT_PATH_DIST), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH_DIST, json);
    console.log(
        `\nWrote ${registry.length} agents → ${path.relative(process.cwd(), OUTPUT_PATH)}`,
    );
}

main();
