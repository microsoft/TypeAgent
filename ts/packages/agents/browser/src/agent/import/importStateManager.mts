// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs/promises";
import * as path from "path";
import { debug } from "debug";

export interface ImportState {
    importId: string;
    totalWebsites: number;
    processedWebsites: number;
    lastSavePoint: number;
    failedUrls: string[];
    startTime: number;
    lastProgressTime: number;
    extractionMode: string;
    source: string;
    type: string;
    filePath?: string;
}

export class ImportStateManager {
    private static readonly STATE_DIR = path.join(
        process.cwd(),
        ".import-states",
    );
    private static readonly COLLECTION_BACKUPS_DIR = path.join(
        process.cwd(),
        ".collection-backups",
    );

    static async ensureDirectories(): Promise<void> {
        await fs.mkdir(this.STATE_DIR, { recursive: true });
        await fs.mkdir(this.COLLECTION_BACKUPS_DIR, { recursive: true });
    }

    static async saveImportState(state: ImportState): Promise<void> {
        await this.ensureDirectories();
        const statePath = path.join(this.STATE_DIR, `${state.importId}.json`);
        await fs.writeFile(statePath, JSON.stringify(state, null, 2));
        debug(`Import state saved for ${state.importId} at ${statePath}`);
    }

    static async loadImportState(
        importId: string,
    ): Promise<ImportState | null> {
        try {
            const statePath = path.join(this.STATE_DIR, `${importId}.json`);
            const data = await fs.readFile(statePath, "utf-8");
            return JSON.parse(data);
        } catch (error) {
            debug(`Failed to load import state for ${importId}: ${error}`);
            return null;
        }
    }

    static async deleteImportState(importId: string): Promise<void> {
        try {
            const statePath = path.join(this.STATE_DIR, `${importId}.json`);
            await fs.unlink(statePath);
            debug(`Import state deleted for ${importId}`);
        } catch (error) {
            debug(`Failed to delete import state for ${importId}: ${error}`);
        }
    }

    static getCollectionBackupPath(
        importId: string,
        savePoint: number,
    ): string {
        return path.join(
            this.COLLECTION_BACKUPS_DIR,
            `${importId}_${savePoint}.json`,
        );
    }

    static async cleanupOldBackups(importId: string): Promise<void> {
        try {
            const files = await fs.readdir(this.COLLECTION_BACKUPS_DIR);
            const importFiles = files.filter((f) => f.startsWith(importId));

            for (const file of importFiles) {
                await fs.unlink(path.join(this.COLLECTION_BACKUPS_DIR, file));
            }
            debug(
                `Cleaned up ${importFiles.length} backup files for ${importId}`,
            );
        } catch (error) {
            debug(`Failed to cleanup backups for ${importId}: ${error}`);
        }
    }

    static calculateSavePoints(totalCount: number): number[] {
        const fixedInterval = 50;
        const percentageInterval = Math.ceil(totalCount * 0.2);
        const saveInterval = Math.min(fixedInterval, percentageInterval);

        const savePoints = [];
        for (let i = saveInterval; i < totalCount; i += saveInterval) {
            savePoints.push(i);
        }
        savePoints.push(totalCount); // Always save at end

        return savePoints;
    }
}
