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

import { dialog } from "electron";
import { getShellDataDir } from "./shellSettings.js";

export function getKeysPersistencePath(dir: string) {
    return path.join(getShellDataDir(dir), "keys");
}

async function createPersistence(dir: string) {
    const cachePath = getKeysPersistencePath(dir);
    return PersistenceCreator.createPersistence({
        cachePath,
        dataProtectionScope: DataProtectionScope.CurrentUser,
        serviceName: `TypeAgent.shell`,
        accountName: `TokenCache`,
        usePlaintextFileOnLinux: false,
    });
}

async function loadKeysFromPersistence(dir: string) {
    debugShell("Loading keys persistence from directory", dir);
    try {
        const persistence = await createPersistence(dir);
        return await persistence.load();
    } catch (e) {
        // Ignore load error and return null as if we don't have the keys.
        debugShellError("Failed to load keys persistence", e);
        return null;
    }
}

async function saveKeysToPersistence(dir: string, keys: string) {
    debugShell("Saving keys persistence to directory", dir);
    const persistence = await createPersistence(dir);
    await persistence.save(keys);
}

function populateKeys(keys: string) {
    const parsed = dotenv.parse(Buffer.from(keys));
    dotenv.populate(process.env as any, parsed, { override: true });
}

async function getKeys(
    dir: string,
    reset: boolean,
    envFile?: string,
): Promise<string | null> {
    const keys = reset ? null : await loadKeysFromPersistence(dir);
    if (envFile) {
        if (!fs.existsSync(envFile)) {
            throw new Error(`Env file ${envFile} not found`);
        }
        debugShell("Loading service keys from file", envFile);
        const content = await fs.promises.readFile(envFile, "utf-8");
        if (keys === null) {
            await saveKeysToPersistence(dir, content);
            return content;
        }

        if (keys !== content) {
            const result = await dialog.showMessageBox({
                type: "question",
                buttons: ["Yes", "No"],
                title: "Loading service keys",
                message: `The service keys from ${envFile} is different from saved keys. Do you want to update them?`,
            });

            if (result.response === 0) {
                await saveKeysToPersistence(dir, content);
                return content;
            }
        } else {
            debugShell(`Key persistence is up to date with ${envFile}`);
        }
    } else if (keys === null) {
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
                return content;
            }
        }
    }
    return keys;
}

export async function loadKeysFromEnvFile(envFile: string) {
    if (!fs.existsSync(envFile)) {
        throw new Error(`Env file ${envFile} not found`);
    }
    debugShell("Loading service keys from file", envFile);
    const keys = await fs.promises.readFile(envFile, "utf-8");
    populateKeys(keys);
}

export async function loadKeys(
    dir: string,
    reset: boolean = false,
    envFile?: string,
) {
    const keys = await getKeys(dir, reset, envFile);
    if (keys) {
        populateKeys(keys);
    } else {
        debugShellError("No serivce keys loaded");
        await dialog.showMessageBox({
            type: "warning",
            buttons: ["OK"],
            title: "Loading service keys",
            message: `Service keys not loaded. Using existing environment variables.`,
        });
    }
}
