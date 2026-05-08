// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PersistenceCreator,
    DataProtectionScope,
} from "@azure/msal-node-extensions";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import {
    flatten as flattenYamlConfig,
    type ConfigTree,
} from "@typeagent/config";
import yaml from "js-yaml";

import { debugShell, debugShellError } from "./debug.js";

import { dialog } from "electron";
import { getShellDataDir } from "./shellSettings.js";

export function getKeysPersistencePath(dir: string | undefined) {
    return path.join(getShellDataDir(dir), "keys");
}

type ParsedKeys = dotenv.DotenvParseOutput;

/**
 * Detect YAML config files by extension and parse them through the
 * @typeagent/config flattener so they yield the same
 * `KEY=value` shape that dotenv would have produced. Falls back to
 * `dotenv.parse` for everything else (including extensionless `.env`).
 */
function parseConfigFileContent(
    fileName: string,
    content: string,
): ParsedKeys {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === ".yaml" || ext === ".yml") {
        const tree = yaml.load(content, { filename: fileName });
        if (tree === null || tree === undefined) {
            return {};
        }
        if (typeof tree !== "object" || Array.isArray(tree)) {
            throw new Error(
                `${fileName}: top level must be a YAML mapping.`,
            );
        }
        const flat = flattenYamlConfig(tree as ConfigTree);
        // dotenv.populate (used downstream) accepts a plain object of
        // string values; coerce any non-strings just in case.
        const out: ParsedKeys = {};
        for (const [k, v] of Object.entries(flat)) {
            out[k] = String(v);
        }
        return out;
    }
    return dotenv.parse(Buffer.from(content));
}

/**
 * Persist parsed keys uniformly as `KEY=value` text so the existing
 * DPAPI-encrypted cache can re-hydrate them via `dotenv.parse` on
 * subsequent launches, regardless of the source file's format.
 */
function serializeParsedKeysForCache(parsed: ParsedKeys): string {
    const lines: string[] = [];
    for (const [k, v] of Object.entries(parsed)) {
        // Quote to preserve trailing whitespace / special chars; escape
        // any embedded double quotes and newlines.
        const escaped = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        lines.push(`${k}="${escaped}"`);
    }
    return lines.join("\n") + "\n";
}

async function createPersistence(dir: string | undefined) {
    const cachePath = getKeysPersistencePath(dir);
    return PersistenceCreator.createPersistence({
        cachePath,
        dataProtectionScope: DataProtectionScope.CurrentUser,
        serviceName: `TypeAgent.shell`,
        accountName: `TokenCache`,
        usePlaintextFileOnLinux: false,
    });
}

async function loadKeysFromPersistence(dir: string | undefined) {
    debugShell("Loading keys persistence from directory", dir);
    try {
        const persistence = await createPersistence(dir);
        const keys = await persistence.load();
        if (keys !== null) {
            return dotenv.parse(Buffer.from(keys));
        }
    } catch (e) {
        // Ignore load error and return null as if we don't have the keys.
        debugShellError("Failed to load keys persistence", e);
    }
    return null;
}

async function saveKeysToPersistence(dir: string | undefined, keys: string) {
    debugShell("Saving keys persistence to directory", dir);
    const persistence = await createPersistence(dir);
    await persistence.save(keys);
}

function populateKeys(parsed: ParsedKeys) {
    dotenv.populate(process.env as any, parsed, { override: true });
}

function parsedKeysEqual(a: ParsedKeys, b: ParsedKeys) {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.length !== keysB.length) {
        return false;
    }
    for (let i = 0; i < keysA.length; i++) {
        if (keysA[i] !== keysB[i] || a[keysA[i]] !== b[keysB[i]]) {
            return false;
        }
    }
    return true;
}

async function getParsedKeys(
    dir: string | undefined,
    reset: boolean,
    envFile?: string,
): Promise<ParsedKeys | null> {
    const parsed = reset ? null : await loadKeysFromPersistence(dir);
    if (envFile) {
        if (!fs.existsSync(envFile)) {
            throw new Error(`Env file ${envFile} not found`);
        }
        debugShell("Loading service keys from file", envFile);
        const content = await fs.promises.readFile(envFile, "utf-8");
        const parsedContent = parseConfigFileContent(envFile, content);
        const cacheText = serializeParsedKeysForCache(parsedContent);
        if (parsed === null) {
            await saveKeysToPersistence(dir, cacheText);
            return parsedContent;
        }

        if (!parsedKeysEqual(parsed, parsedContent)) {
            const result = await dialog.showMessageBox({
                type: "question",
                buttons: ["Yes", "No"],
                title: "Loading service keys",
                message: `The service keys from ${envFile} is different from saved keys. Do you want to update them?`,
            });

            if (result.response === 0) {
                await saveKeysToPersistence(dir, cacheText);
                return parsedContent;
            }
        } else {
            debugShell(`Key persistence is up to date with ${envFile}`);
        }
    } else if (parsed === null) {
        const result = await dialog.showMessageBox({
            type: "question",
            buttons: ["Import from a .env file", "Cancel"],
            title: "Loading service keys",
            message: `Service keys not found.`,
        });

        if (result.response === 0) {
            // Use the sync version as nothing else is going on.
            const result = dialog.showOpenDialogSync({
                properties: ["openFile", "showHiddenFiles"],
                message: "Select .env or YAML config file",
                filters: [
                    { name: "Config", extensions: ["env", "yaml", "yml"] },
                    { name: "All files", extensions: ["*"] },
                ],
            });
            if (result && result.length > 0) {
                const content = await fs.promises.readFile(result[0], "utf-8");
                const parsedContent = parseConfigFileContent(
                    result[0],
                    content,
                );
                await saveKeysToPersistence(
                    dir,
                    serializeParsedKeysForCache(parsedContent),
                );
                return parsedContent;
            }
        }
    }
    return parsed;
}

export async function loadKeysFromEnvFile(envFile: string) {
    if (!fs.existsSync(envFile)) {
        throw new Error(`Env file ${envFile} not found`);
    }
    debugShell("Loading service keys from file", envFile);
    const content = await fs.promises.readFile(envFile, "utf-8");
    const parsed = parseConfigFileContent(envFile, content);
    populateKeys(parsed);
}

export async function loadKeys(
    dir: string | undefined,
    reset: boolean = false,
    envFile?: string,
) {
    const parsed = await getParsedKeys(dir, reset, envFile);
    if (parsed) {
        populateKeys(parsed);
    } else {
        debugShellError("No service keys loaded");
        await dialog.showMessageBox({
            type: "warning",
            buttons: ["OK"],
            title: "Loading service keys",
            message: `Service keys not loaded. Using existing environment variables.`,
        });
    }
}
