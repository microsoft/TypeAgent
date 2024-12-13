// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import fs from "node:fs";
import {
    Storage,
    StorageListOptions,
    StorageEncoding,
} from "@typeagent/agent-sdk";

import {
    DataProtectionScope,
    PersistenceCreator,
} from "@azure/msal-node-extensions";
import { isImageFileType } from "common-utils";

export function getStorage(name: string, baseDir: string): Storage {
    const getFullPath = (storagePath: string) => {
        // REVIEW: validate that the file is still within base path
        return path.join(baseDir, name, storagePath);
    };
    return {
        list: async (storagePath: string, options?: StorageListOptions) => {
            const fullPath = getFullPath(storagePath);
            const items = await fs.promises.readdir(fullPath, {
                withFileTypes: true,
            });
            return items
                .filter((item) =>
                    options?.dirs ? item.isDirectory() : item.isFile(),
                )
                .map((item) =>
                    options?.fullPath ? getFullPath(item.name) : item.name,
                );
        },
        exists: async (storagePath: string) => {
            const fullPath = getFullPath(storagePath);
            return fs.existsSync(fullPath);
        },
        read: async (storagePath: string, options: StorageEncoding) => {
            const fullPath = getFullPath(storagePath);
            return fs.promises.readFile(fullPath, options);
        },
        write: async (storagePath: string, data: string) => {
            const fullPath = getFullPath(storagePath);
            const dirName = path.dirname(fullPath);
            if (!fs.existsSync(dirName)) {
                await fs.promises.mkdir(dirName, { recursive: true });
            }

            // images are passed in as base64 strings so we need to encode them properly on disk
            if (isImageFileType(path.extname(storagePath))) {
                return fs.promises.writeFile(
                    fullPath,
                    Buffer.from(data, "base64"),
                );
            } else {
                return fs.promises.writeFile(fullPath, data);
            }
        },
        delete: async (storagePath: string) => {
            const fullPath = getFullPath(storagePath);
            return fs.promises.unlink(fullPath);
        },
        getTokenCachePersistence: async () => {
            try {
                return await PersistenceCreator.createPersistence({
                    cachePath: getFullPath("token"),
                    dataProtectionScope: DataProtectionScope.CurrentUser,
                    serviceName: `TypeAgent.${name}`,
                    accountName: `TokenCache`,
                    usePlaintextFileOnLinux: false,
                });
            } catch (e: any) {
                console.error(
                    `Failed to create token cache persistence for ${name}: ${e.message}`,
                );
                return {
                    load: async () => null,
                    save: async () => {},
                };
            }
        },
    };
}
