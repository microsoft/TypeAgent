// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { randomUUID } from "crypto";
import lockfile from "proper-lockfile";
import { getPackageFilePath } from "../utils/getPackageFilePath.js";
import { ensureDirectory, getUniqueFileName } from "../utils/fsUtils.js";

export function getUserDataDir() {
    return path.join(os.homedir(), ".typeagent");
}

function ensureUserDataDir() {
    const dir = getUserDataDir();
    ensureDirectory(dir);
    return dir;
}

interface GlobalUserConfig {
    clientId: string;
    instances?: {
        [key: string]: string;
    };
}

function getGlobalUserConfigFilePath() {
    return path.join(getUserDataDir(), "global.json");
}

function readGlobalUserConfig(
    locked: boolean = false,
): GlobalUserConfig | undefined {
    try {
        const content = fs.readFileSync(getGlobalUserConfigFilePath(), "utf-8");
        const data: any = JSON.parse(content);
        if (data === undefined) {
            return undefined;
        }
        if (data.clientId !== undefined) {
            return data;
        }
        if (locked && data.userid !== undefined) {
            data.clientId = data.userid;
            delete data.userid;
            saveGlobalUserConfig(data);
            return data;
        }
    } catch (error) {}
    return undefined;
}

function saveGlobalUserConfig(userConfig: GlobalUserConfig) {
    const content = JSON.stringify(userConfig, null, 2);
    ensureUserDataDir();
    fs.writeFileSync(getGlobalUserConfigFilePath(), content);
}

function ensureGlobalUserConfig(): GlobalUserConfig {
    const existingUserConfig = readGlobalUserConfig(true);
    if (existingUserConfig === undefined) {
        const userConfig = { clientId: randomUUID() };
        saveGlobalUserConfig(userConfig);
        return userConfig;
    }
    return existingUserConfig;
}

function lockUserData<T>(fn: () => T) {
    let release: () => void;
    try {
        release = lockfile.lockSync(ensureUserDataDir());
    } catch (error: any) {
        console.error(
            `ERROR: Unable to lock user data directory: ${error.message}. Exiting.`,
        );
        process.exit(-1);
    }
    try {
        return fn();
    } finally {
        release();
    }
}

function getInstancesDir() {
    return path.join(ensureUserDataDir(), "profiles");
}

function ensureInstanceDirName(instanceName: string) {
    const userConfig = ensureGlobalUserConfig();
    const profileName = userConfig.instances?.[instanceName];
    if (profileName) {
        return profileName;
    }
    const newProfileName = getUniqueFileName(
        getInstancesDir(),
        process.env["INSTANCE_NAME"] ?? "dev",
    );
    if (userConfig.instances === undefined) {
        userConfig.instances = {};
    }
    userConfig.instances[instanceName] = newProfileName;
    saveGlobalUserConfig(userConfig);
    return newProfileName;
}

function getInstanceDirName(instanceName: string) {
    const currentGlobalUserConfig = readGlobalUserConfig();
    if (currentGlobalUserConfig !== undefined) {
        const instanceDirName =
            currentGlobalUserConfig.instances?.[instanceName];
        if (instanceDirName !== undefined) {
            return instanceDirName;
        }
    }
    return lockUserData(() => {
        return ensureInstanceDirName(instanceName);
    });
}
console.log(process.env.NODE_ENV);
console.log(process.env.MODE);
console.log(process.env.PROD);
console.log(process.env.DEV);
function getInstanceName() {
    return process.env["INSTANCE_NAME"] ?? `dev:${getPackageFilePath(".")}`;
}

let instanceDir: string | undefined;
export function getInstanceDir() {
    if (instanceDir === undefined) {
        instanceDir = path.join(
            getInstancesDir(),
            getInstanceDirName(getInstanceName()),
        );
    }
    return instanceDir;
}

let clientId: string | undefined;
export function getClientId(): string {
    if (clientId !== undefined) {
        return clientId;
    }
    const currentGlobalUserConfig = readGlobalUserConfig();
    if (currentGlobalUserConfig !== undefined) {
        clientId = currentGlobalUserConfig.clientId;
        return clientId;
    }
    return lockUserData(() => {
        clientId = ensureGlobalUserConfig().clientId;
        return clientId;
    });
}
