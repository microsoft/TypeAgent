// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    PersistenceCreator,
    DataProtectionScope,
} from "@azure/msal-node-extensions";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";

import { debugShell, debugShellError } from "./debug.js";

import { dialog, shell } from "electron";
import { getShellDataDir } from "./shellSettings.js";

export function getKeysPersistencePath(dir: string | undefined) {
    return path.join(getShellDataDir(dir), "keys");
}

type ParsedKeys = dotenv.DotenvParseOutput;

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
        const parsedContent = dotenv.parse(Buffer.from(content));
        if (parsed === null) {
            await saveKeysToPersistence(dir, content);
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
                await saveKeysToPersistence(dir, content);
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
                message: "Select .env file",
            });
            if (result && result.length > 0) {
                const content = await fs.promises.readFile(result[0], "utf-8");
                await saveKeysToPersistence(dir, content);
                return dotenv.parse(Buffer.from(content));
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
    const keys = await fs.promises.readFile(envFile, "utf-8");
    const parsed = dotenv.parse(Buffer.from(keys));
    populateKeys(parsed);
}

// Minimum required keys for TypeAgent to function.
// At least one of these groups must be fully set.
const REQUIRED_KEY_GROUPS = [
    ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"],
    ["OPENAI_API_KEY", "OPENAI_ENDPOINT"],
];

function hasRequiredKeys(): boolean {
    return REQUIRED_KEY_GROUPS.some((group) =>
        group.every((key) => {
            const value = process.env[key];
            return value !== undefined && value.trim().length > 0;
        }),
    );
}

async function showOOBEWarning() {
    const result = await dialog.showMessageBox({
        type: "warning",
        buttons: ["Open Setup Docs", "Continue Anyway"],
        defaultId: 0,
        title: "Service keys not configured",
        message: "TypeAgent requires API keys to function.",
        detail:
            "No valid service keys were found. Please configure at least one of:\n\n" +
            "• Azure OpenAI: AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT\n" +
            "• OpenAI: OPENAI_API_KEY + OPENAI_ENDPOINT\n\n" +
            "Click 'Open Setup Docs' to learn how to set up your keys.",
    });

    if (result.response === 0) {
        shell.openExternal(
            "https://github.com/microsoft/TypeAgent/blob/main/ts/README.md",
        );
    }
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

    // OOBE: check that the minimum required keys are present after loading.
    if (!hasRequiredKeys()) {
        debugShellError("Required service keys are missing");
        await showOOBEWarning();
    }
}
