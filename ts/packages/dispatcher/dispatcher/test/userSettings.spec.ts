// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
    loadUserSettings,
    saveUserSettings,
    resetUserSettings,
    defaultUserSettings,
} from "../src/helpers/userSettings.js";

// Override the user data dir to use a temp directory for tests
const testDir = path.join(os.tmpdir(), `typeagent-test-settings-${Date.now()}`);

beforeAll(() => {
    process.env.TYPEAGENT_USER_DATA_DIR = testDir;
    fs.mkdirSync(testDir, { recursive: true });
});

afterAll(() => {
    delete process.env.TYPEAGENT_USER_DATA_DIR;
    fs.rmSync(testDir, { recursive: true, force: true });
});

afterEach(() => {
    // Clean up settings file between tests
    const settingsPath = path.join(testDir, "user-settings.json");
    try {
        fs.unlinkSync(settingsPath);
    } catch {
        // ignore
    }
});

describe("userSettings", () => {
    test("loadUserSettings returns defaults when no file exists", () => {
        const settings = loadUserSettings();
        expect(settings).toEqual(defaultUserSettings);
    });

    test("saveUserSettings persists and returns merged settings", () => {
        const result = saveUserSettings({
            server: { hidden: true, idleTimeout: 0 },
        });
        expect(result.server.hidden).toBe(true);
        expect(result.server.idleTimeout).toBe(0);
        expect(result.conversation.resume).toBe(false);

        // Verify persistence
        const loaded = loadUserSettings();
        expect(loaded.server.hidden).toBe(true);
    });

    test("saveUserSettings merges partial updates", () => {
        saveUserSettings({
            server: { hidden: true, idleTimeout: 30 },
        });
        const result = saveUserSettings({
            conversation: { resume: true },
        });
        expect(result.server.hidden).toBe(true);
        expect(result.server.idleTimeout).toBe(30);
        expect(result.conversation.resume).toBe(true);
    });

    test("resetUserSettings returns defaults and removes file", () => {
        saveUserSettings({
            server: { hidden: true, idleTimeout: 60 },
        });
        const result = resetUserSettings();
        expect(result).toEqual(defaultUserSettings);

        const loaded = loadUserSettings();
        expect(loaded).toEqual(defaultUserSettings);
    });

    test("loadUserSettings handles corrupted file gracefully", () => {
        const settingsPath = path.join(testDir, "user-settings.json");
        fs.writeFileSync(settingsPath, "not valid json{{{");
        const settings = loadUserSettings();
        expect(settings).toEqual(defaultUserSettings);
    });

    test("saveUserSettings sets idleTimeout correctly", () => {
        const result = saveUserSettings({
            server: { hidden: false, idleTimeout: 120 },
        });
        expect(result.server.idleTimeout).toBe(120);
    });
});
