// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Storage, TokenCachePersistence } from "@typeagent/agent-sdk";
import {
    loadSettings,
    saveSettings,
    LocalPlayerSettings,
    SETTINGS_FILE,
} from "../src/agent/localPlayerHandlers.js";

/**
 * Mock implementation of Storage interface for testing
 */
class MockStorage implements Storage {
    private data: Map<string, string> = new Map();

    async read(storagePath: string): Promise<Uint8Array>;
    async read(
        storagePath: string,
        options: "utf8" | "base64",
    ): Promise<string>;
    async read(
        storagePath: string,
        options?: "utf8" | "base64",
    ): Promise<Uint8Array | string> {
        const content = this.data.get(storagePath);
        if (!content) {
            throw new Error(`File not found: ${storagePath}`);
        }
        if (options === "utf8" || options === "base64") {
            return content;
        }
        return new TextEncoder().encode(content);
    }

    async write(
        storagePath: string,
        data: string | Uint8Array,
        _options?: "utf8" | "base64",
    ): Promise<void> {
        if (typeof data === "string") {
            this.data.set(storagePath, data);
        } else {
            this.data.set(storagePath, new TextDecoder().decode(data));
        }
    }

    async list(
        _storagePath: string,
        _options?: { dirs?: boolean; fullPath?: boolean },
    ): Promise<string[]> {
        return Array.from(this.data.keys());
    }

    async exists(storagePath: string): Promise<boolean> {
        return this.data.has(storagePath);
    }

    async delete(storagePath: string): Promise<void> {
        this.data.delete(storagePath);
    }

    async getTokenCachePersistence(): Promise<TokenCachePersistence> {
        return {
            load: async () => null,
            save: async () => {},
            delete: async () => true,
        };
    }

    // Helper methods for testing
    clear(): void {
        this.data.clear();
    }

    setData(storagePath: string, content: string): void {
        this.data.set(storagePath, content);
    }

    getData(storagePath: string): string | undefined {
        return this.data.get(storagePath);
    }
}

describe("LocalPlayerSettings", () => {
    let storage: MockStorage;

    beforeEach(() => {
        storage = new MockStorage();
    });

    describe("loadSettings", () => {
        it("should return empty object when settings file does not exist", async () => {
            const settings = await loadSettings(storage);

            expect(settings).toEqual({});
        });

        it("should load settings from storage when file exists", async () => {
            const savedSettings: LocalPlayerSettings = {
                musicFolder: "C:\\Music\\MyCollection",
            };
            storage.setData(SETTINGS_FILE, JSON.stringify(savedSettings));

            const settings = await loadSettings(storage);

            expect(settings).toEqual(savedSettings);
            expect(settings.musicFolder).toBe("C:\\Music\\MyCollection");
        });

        it("should handle malformed JSON gracefully", async () => {
            storage.setData(SETTINGS_FILE, "not valid json {{{");

            const settings = await loadSettings(storage);

            // Should return empty object on parse error
            expect(settings).toEqual({});
        });
    });

    describe("saveSettings", () => {
        it("should write settings to storage", async () => {
            const settings: LocalPlayerSettings = {
                musicFolder: "/home/user/Music",
            };

            await saveSettings(storage, settings);

            const savedData = storage.getData(SETTINGS_FILE);
            expect(savedData).toBeDefined();
            const parsed = JSON.parse(savedData!);
            expect(parsed.musicFolder).toBe("/home/user/Music");
        });

        it("should overwrite existing settings", async () => {
            const originalSettings: LocalPlayerSettings = {
                musicFolder: "/original/path",
            };
            await saveSettings(storage, originalSettings);

            const newSettings: LocalPlayerSettings = {
                musicFolder: "/new/path",
            };
            await saveSettings(storage, newSettings);

            const savedData = storage.getData(SETTINGS_FILE);
            const parsed = JSON.parse(savedData!);
            expect(parsed.musicFolder).toBe("/new/path");
        });

        it("should persist settings that can be loaded back", async () => {
            const settings: LocalPlayerSettings = {
                musicFolder: "D:\\Media\\Music",
            };

            await saveSettings(storage, settings);
            const loadedSettings = await loadSettings(storage);

            expect(loadedSettings).toEqual(settings);
        });
    });

    describe("settings persistence roundtrip", () => {
        it("should save and load music folder correctly", async () => {
            // First save
            await saveSettings(storage, { musicFolder: "/path/to/music" });

            // Verify it exists
            expect(await storage.exists(SETTINGS_FILE)).toBe(true);

            // Load it back
            const loaded = await loadSettings(storage);
            expect(loaded.musicFolder).toBe("/path/to/music");
        });

        it("should handle empty settings", async () => {
            await saveSettings(storage, {});

            const loaded = await loadSettings(storage);
            expect(loaded).toEqual({});
            expect(loaded.musicFolder).toBeUndefined();
        });
    });
});
