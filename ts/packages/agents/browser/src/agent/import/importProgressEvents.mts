// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { EventEmitter } from "node:events";

export interface ImportProgressEvent {
    importId: string;
    type: "websiteImport" | "htmlFolderImport";
    phase:
        | "initializing"
        | "counting"
        | "fetching"
        | "processing"
        | "extracting"
        | "graph-building"
        | "persisting"
        | "complete"
        | "error";
    current: number;
    total: number;
    description: string;
    timestamp: number;
    url?: string;
    folderPath?: string;
    errors?: Array<{ message: string; timestamp: number }>;
    incrementalData?: any;
    source: "website" | "folder" | "api";
    summary?: {
        totalProcessed: number;
        successfullyImported: number;
        entitiesFound: number;
        topicsIdentified: number;
        actionsDetected: number;
    };
    itemDetails?: {
        url?: string;
        title?: string;
        filename?: string;
        currentAction?: string;
    };
    graphBuildingPhase?:
        | "entities"
        | "relationships"
        | "topics"
        | "communities";
    entitiesProcessed?: number;
    relationshipsBuilt?: number;
    topicsHierarchized?: number;
    lastSavePoint?: number;
    nextSavePoint?: number;
    dataPersistedToDisk?: boolean;
    graphPersistedToDb?: boolean;
}

export class ImportProgressEventEmitter extends EventEmitter {
    emitProgress(progress: ImportProgressEvent): void {
        this.emit("importProgress", progress);
        this.emit(`progress:${progress.importId}`, progress);
        this.emit(`phase:${progress.phase}`, progress);
        this.emit(`type:${progress.type}`, progress);
    }

    onProgress(listener: (progress: ImportProgressEvent) => void): void {
        this.on("importProgress", listener);
    }

    onProgressById(
        importId: string,
        listener: (progress: ImportProgressEvent) => void,
    ): void {
        this.on(`progress:${importId}`, listener);
    }

    onPhase(
        phase: ImportProgressEvent["phase"],
        listener: (progress: ImportProgressEvent) => void,
    ): void {
        this.on(`phase:${phase}`, listener);
    }

    onType(
        type: ImportProgressEvent["type"],
        listener: (progress: ImportProgressEvent) => void,
    ): void {
        this.on(`type:${type}`, listener);
    }

    removeProgressListener(importId: string): void {
        this.removeAllListeners(`progress:${importId}`);
    }
}

export const importProgressEvents = new ImportProgressEventEmitter();
