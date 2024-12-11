// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { randomUUID } from "crypto";
import lockfile from "proper-lockfile";
import { getPackageFilePath } from "./getPackageFilePath.js";

export function getYMDPrefix() {
    const date = new Date();
    return `${date.getFullYear()}${(date.getMonth() + 1)
        .toString()
        .padStart(2, "0")}${date.getDate().toString().padStart(2, "0")}`;
}

export function getUniqueFileName(
    dirpath: string,
    prefix: string = "",
    ext: string = "",
) {
    let currentDirs = fs.existsSync(dirpath) ? fs.readdirSync(dirpath) : [];
    if (prefix !== "") {
        currentDirs = currentDirs.filter((d) => d.startsWith(prefix));
    }
    let dir = `${prefix}${ext}`;
    if (currentDirs.includes(dir)) {
        let index = 0;
        while (true) {
            dir = `${prefix}_${index}${ext}`;
            if (!currentDirs.includes(dir)) {
                return dir;
            }
            index++;
        }
    }
    return dir;
}

function createDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
        } catch (error: any) {
            if (fs.existsSync(dir)) {
                // there might be a race
                return;
            }
            throw new Error(
                `Error creating directory '${dir}': ${error.message}`,
            );
        }
    }
}

export function getUserDataDir() {
    return path.join(os.homedir(), ".typeagent");
}

function ensureUserDataDir() {
    const dir = getUserDataDir();
    createDirectory(dir);
    return dir;
}

interface GlobalUserConfig {
    userid: string;
    instances?: {
        [key: string]: string;
    };
}

function getGlobalUserConfigFilePath() {
    return path.join(getUserDataDir(), "global.json");
}

function readGlobalUserConfig(): GlobalUserConfig | undefined {
    try {
        const content = fs.readFileSync(getGlobalUserConfigFilePath(), "utf-8");
        const userConfig: GlobalUserConfig = JSON.parse(content);
        if (userConfig && userConfig.userid) {
            return userConfig;
        }
    } catch (error) {}
    return undefined;
}

function saveGlobalUserConfig(userConfig: GlobalUserConfig) {
    const content = JSON.stringify(userConfig, null, 2);
    ensureUserDataDir();
    fs.writeFileSync(getGlobalUserConfigFilePath(), content);
}

function migrateOldUserDataDir() {
    const newDir = getUserDataDir();
    const oldDir = path.join(os.homedir(), ".aisystems");
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
        fs.renameSync(oldDir, newDir);
    }
}

function ensureGlobalUserConfig(): GlobalUserConfig {
    migrateOldUserDataDir();

    const existingUserConfig = readGlobalUserConfig();
    if (existingUserConfig === undefined) {
        const userConfig = { userid: randomUUID() };
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

export function getUserId() {
    return lockUserData(() => {
        return ensureGlobalUserConfig().userid;
    });
}

function getInstanceName() {
    return process.env["INSTANCE_NAME"] ?? `dev:${getPackageFilePath(".")}`;
}

function getProfilesDir() {
    return path.join(ensureUserDataDir(), "profiles");
}

function ensureUserProfileName() {
    const userConfig = ensureGlobalUserConfig();

    const instanceName = getInstanceName();
    const profileName = userConfig.instances?.[instanceName];
    if (profileName) {
        return profileName;
    }
    const newProfileName = getUniqueFileName(
        getProfilesDir(),
        process.env["INSTANCE_NAME"] ?? "dev",
    );
    if (userConfig.instances === undefined) {
        userConfig.instances = {};
    }
    userConfig.instances[instanceName] = newProfileName;
    saveGlobalUserConfig(userConfig);
    return newProfileName;
}

function getUserProfileName() {
    const currentGlobalUserConfig = readGlobalUserConfig();
    if (currentGlobalUserConfig !== undefined) {
        const instanceName = getInstanceName();
        const profileName = currentGlobalUserConfig.instances?.[instanceName];
        if (profileName !== undefined) {
            return profileName;
        }
    }
    return lockUserData(() => {
        return ensureUserProfileName();
    });
}

let userProfileDir: string | undefined;
export function getUserProfileDir() {
    if (userProfileDir === undefined) {
        userProfileDir = path.join(getProfilesDir(), getUserProfileName());
    }
    return userProfileDir;
}

export function ensureUserProfileDir() {
    const dir = getUserProfileDir();
    createDirectory(dir);
    return dir;
}

export function ensureCacheDir() {
    const dir = path.join(getUserProfileDir(), "cache");
    createDirectory(dir);
    return dir;
}
