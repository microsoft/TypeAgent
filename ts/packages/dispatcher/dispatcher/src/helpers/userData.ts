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
    traceId: string;
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
        if (data.traceId !== undefined) {
            return data;
        }
        if (locked) {
            if (data.clientId !== undefined) {
                data.traceId = data.clientId;
                delete data.clientId;
            } else if (data.userid !== undefined) {
                data.traceId = data.userid;
                delete data.userid;
            }
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
        const userConfig = { traceId: randomUUID() };
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

async function lockUserDataAsync<T>(fn: () => T | Promise<T>): Promise<T> {
    const release = await lockfile.lock(ensureUserDataDir(), {
        retries: { retries: 10, minTimeout: 500, maxTimeout: 1000 },
    });
    try {
        return await fn();
    } finally {
        await release();
    }
}

function getInstancesDir() {
    return path.join(ensureUserDataDir(), "profiles");
}

function ensureInstanceDirName(instanceName: string) {
    if (instanceName === "prod") {
        return "prod";
    }
    const userConfig = ensureGlobalUserConfig();
    const profileName = userConfig.instances?.[instanceName];
    if (profileName) {
        return profileName;
    }
    const newProfileName = getUniqueFileName(
        getInstancesDir(),
        process.env.INSTANCE_NAME ?? "dev",
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

function getInstanceName() {
    return process.env.INSTANCE_NAME ?? `dev:${getPackageFilePath(".")}`;
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

let instanceDirPromise: Promise<string> | undefined;
export function getInstanceDirAsync(): Promise<string> {
    if (instanceDirPromise === undefined) {
        instanceDirPromise = resolveInstanceDir();
    }
    return instanceDirPromise;
}

async function resolveInstanceDir(): Promise<string> {
    const instanceName = getInstanceName();
    const currentConfig = readGlobalUserConfig();
    const existing = currentConfig?.instances?.[instanceName];
    if (existing !== undefined) {
        const dir = path.join(getInstancesDir(), existing);
        instanceDir = dir;
        return dir;
    }
    const dirName = await lockUserDataAsync(() =>
        ensureInstanceDirName(instanceName),
    );
    const dir = path.join(getInstancesDir(), dirName);
    instanceDir = dir;
    return dir;
}

let traceId: string | undefined;
export function getTraceId(): string {
    if (traceId !== undefined) {
        return traceId;
    }
    const currentGlobalUserConfig = readGlobalUserConfig();
    if (currentGlobalUserConfig !== undefined) {
        traceId = currentGlobalUserConfig.traceId;
        return traceId;
    }
    return lockUserData(() => {
        traceId = ensureGlobalUserConfig().traceId;
        return traceId;
    });
}

let traceIdPromise: Promise<string> | undefined;
export function getTraceIdAsync(): Promise<string> {
    if (traceIdPromise === undefined) {
        traceIdPromise = resolveTraceId();
    }
    return traceIdPromise;
}

async function resolveTraceId(): Promise<string> {
    if (traceId !== undefined) {
        return traceId;
    }
    const currentConfig = readGlobalUserConfig();
    if (currentConfig?.traceId !== undefined) {
        traceId = currentConfig.traceId;
        return traceId;
    }
    return lockUserDataAsync(() => {
        traceId = ensureGlobalUserConfig().traceId;
        return traceId!;
    });
}
