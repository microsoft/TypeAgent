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
    const persistence = await createPersistence(dir);
    return persistence.load();
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

async function getKeys(dir: string, envFile?: string): Promise<string | null> {
    const keys = await loadKeysFromPersistence(dir);
    if (envFile) {
        if (!fs.existsSync(envFile)) {
            throw new Error(`Environment file ${envFile} not found`);
        }
        debugShell("Loading environment variables from file", envFile);
        const content = await fs.promises.readFile(envFile, "utf-8");
        if (keys === null) {
            await saveKeysToPersistence(dir, content);
            return content;
        }

        if (keys !== content) {
            const result = await dialog.showMessageBox({
                type: "question",
                buttons: ["Yes", "No"],
                title: "Loading keys",
                message: `The environment variables from ${envFile} is different from saved keys. Do you want to update them?`,
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
            buttons: ["Import from file", "Cancel"],
            title: "Loading keys",
            message: `Environment variables not found. Do you want to import them from a file?`,
        });

        if (result.response === 0) {
            // Use the sync version as nothing else is going on.
            const result = dialog.showOpenDialogSync({
                properties: ["openFile", "showHiddenFiles"],
                message: "Select the .env file",
                filters: [
                    {
                        name: "Environment files",
                        extensions: ["env"],
                    },
                    {
                        name: "All files",
                        extensions: ["*"],
                    },
                ]

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

export async function loadKeys(dir: string, envFile?: string) {
    const keys = await getKeys(dir, envFile);
    if (keys) {
        populateKeys(keys);
    } else {
        debugShellError("No keys loaded");
        await dialog.showMessageBox({
            type: "warning",
            buttons: ["OK"],
            title: "Loading keys",
            message: `No keys loaded. Using values in existing environment variables.`,
        });
    }
}
