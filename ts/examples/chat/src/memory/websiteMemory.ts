// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This file now imports from the standalone website-memory package
// and provides a simplified interface

import * as website from "website-memory";
import { Result, success } from "typechat";
import * as cm from "conversation-memory";

// Re-export types and classes from the website-memory package
export const WebsiteCollection = website.WebsiteCollection;
export const importWebsites = website.importWebsites;
export const getDefaultBrowserPaths = website.getDefaultBrowserPaths;
export const determinePageType = website.determinePageType;

export type WebsiteVisitInfo = website.WebsiteVisitInfo;
export type ImportOptions = website.ImportOptions;

// Legacy compatibility types
export interface WebsiteMemorySettings {
    languageModel: any;
    embeddingModel: any;
    embeddingSize: number;
    conversationSettings: any;
    queryTranslator?: any;
    answerGenerator?: any;
    fileSaveSettings?: IndexFileSettings;
    userProfile?: WebsiteUserProfile;
}

export interface WebsiteUserProfile {
    userName: string;
    preferredDomains?: string[];
    interests?: string[];
}

export interface IndexFileSettings {
    dirPath: string;
    baseFileName: string;
}

export type IndexingState = {
    lastMessageOrdinal: number;
    lastSemanticRefOrdinal: number;
};

export interface WebsiteMemoryData {
    indexingState: IndexingState;
    nameTag: string;
    messages: any[];
    tags: string[];
    semanticRefs: any[];
    semanticIndexData?: any;
    relatedTermsIndexData?: any;
    messageIndexData?: any;
}

export function createWebsiteMemorySettings(
    languageModel?: any,
    embeddingModel?: any,
    embeddingSize?: number,
): WebsiteMemorySettings {
    const settings = cm.createMemorySettings(64);
    if (languageModel) settings.languageModel = languageModel;
    if (embeddingModel) settings.embeddingModel = embeddingModel;
    if (embeddingSize) settings.embeddingSize = embeddingSize;
    return settings as WebsiteMemorySettings;
}

export async function createWebsiteMemory(
    fileSettings: IndexFileSettings,
    createNew: boolean,
    knowledgeModel?: any,
    queryTranslator?: any,
    answerGenerator?: any,
): Promise<website.WebsiteCollection> {
    let collection: website.WebsiteCollection | undefined;

    if (!createNew) {
        // Try to read existing file
        try {
            collection = await website.WebsiteCollection.readFromFile(
                fileSettings.dirPath,
                fileSettings.baseFileName,
            );
        } catch (error) {
            console.warn("Could not read existing website memory:", error);
        }
    }

    if (!collection) {
        // Create new website collection
        collection = new website.WebsiteCollection();
    }

    return collection;
}

// Helper functions for legacy compatibility
export function getIndexingState(
    collection: website.WebsiteCollection,
): IndexingState {
    return {
        lastMessageOrdinal: collection.messages.length - 1,
        lastSemanticRefOrdinal: collection.semanticRefs.length - 1,
    };
}

export async function addMessagesToCollection(
    collection: website.WebsiteCollection,
    messages: website.Website | website.Website[],
    updateIndex: boolean = true,
): Promise<Result<IndexingState>> {
    try {
        if (Array.isArray(messages)) {
            collection.addWebsites(messages);
        } else {
            collection.addWebsites([messages]);
        }

        if (updateIndex) {
            await collection.buildIndex();
        }

        return success(getIndexingState(collection));
    } catch (err: any) {
        return { success: false, message: err.message };
    }
}

export async function buildCollectionIndex(
    collection: website.WebsiteCollection,
): Promise<Result<IndexingState>> {
    try {
        await collection.buildIndex();
        return success(getIndexingState(collection));
    } catch (err: any) {
        return { success: false, message: err.message };
    }
}
