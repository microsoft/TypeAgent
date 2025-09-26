// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync, existsSync, writeFileSync } from "fs";
import path from "path";
import { getShellDataDir } from "./shellSettings.js";
import { debugShell } from "./debug.js";

export type ExtensionStorageData = {
    autoIndexing?: boolean;
    extractionMode?: string;
    [key: string]: any;
};

const defaultExtensionStorage: ExtensionStorageData = {
    autoIndexing: false,
    extractionMode: "content",
};

function getExtensionStoragePath(instanceDir: string) {
    return path.join(getShellDataDir(instanceDir), "extensionStorage.json");
}

export class ExtensionStorageManager {
    private readonly storage: ExtensionStorageData;

    constructor(private readonly instanceDir: string) {
        const storagePath = getExtensionStoragePath(instanceDir);
        debugShell(
            `Loading extension storage from '${storagePath}'`,
            performance.now(),
        );

        this.storage = { ...defaultExtensionStorage };

        if (existsSync(storagePath)) {
            try {
                const existingStorage = JSON.parse(
                    readFileSync(storagePath, "utf-8"),
                );
                Object.assign(this.storage, existingStorage);
            } catch (e) {
                debugShell(`Error loading extension storage: ${e}`);
            }
        }

        debugShell(
            `Extension storage loaded: ${JSON.stringify(this.storage, undefined, 2)}`,
        );
    }

    public get(keys: string[]): Record<string, any> {
        const result: Record<string, any> = {};
        for (const key of keys) {
            if (key in this.storage) {
                result[key] = this.storage[key];
            }
        }
        return result;
    }

    public set(items: Record<string, any>): void {
        let hasChanges = false;
        for (const [key, value] of Object.entries(items)) {
            if (this.storage[key] !== value) {
                this.storage[key] = value;
                hasChanges = true;
            }
        }

        if (hasChanges) {
            this.save();
        }
    }

    public remove(keys: string[]): void {
        let hasChanges = false;
        for (const key of keys) {
            if (key in this.storage) {
                delete this.storage[key];
                hasChanges = true;
            }
        }

        if (hasChanges) {
            this.save();
        }
    }

    private save(): void {
        const storagePath = getExtensionStoragePath(this.instanceDir);
        debugShell(`Saving extension storage to '${storagePath}'.`);
        debugShell(JSON.stringify(this.storage, undefined, 2));
        writeFileSync(storagePath, JSON.stringify(this.storage, undefined, 2));
    }
}
