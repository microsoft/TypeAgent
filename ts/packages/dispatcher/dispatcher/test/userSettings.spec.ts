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

    test("saveUserSettings deep-merges without overwriting siblings", () => {
        saveUserSettings({
            server: { hidden: true, idleTimeout: 60 },
        });
        // Update only hidden — idleTimeout should be preserved
        const result = saveUserSettings({ server: { hidden: false } });
        expect(result.server.hidden).toBe(false);
        expect(result.server.idleTimeout).toBe(60);
    });

    test("loadUserSettings does not share references with defaults", () => {
        const a = loadUserSettings();
        const b = loadUserSettings();
        expect(a).toEqual(b);
        // Mutating one should not affect the other or the defaults
        a.server.hidden = true;
        expect(b.server.hidden).toBe(false);
        expect(defaultUserSettings.server.hidden).toBe(false);
    });

    test("loadUserSettings ignores prototype pollution keys in saved file", () => {
        const settingsPath = path.join(testDir, "user-settings.json");
        fs.writeFileSync(
            settingsPath,
            JSON.stringify({
                __proto__: { polluted: true },
                server: { hidden: true },
            }),
        );
        const settings = loadUserSettings();
        expect(settings.server.hidden).toBe(true);
        // Ensure __proto__ was not merged
        expect((settings as any).polluted).toBeUndefined();
        expect(({} as any).polluted).toBeUndefined();
    });
});
