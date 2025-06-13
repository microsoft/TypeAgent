// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as website from "website-memory";
import { Result, success } from "typechat";

// Re-export types and classes from the website-memory package
export const WebsiteCollection = website.WebsiteCollection;
export const importWebsites = website.importWebsites;
export const getDefaultBrowserPaths = website.getDefaultBrowserPaths;
export const determinePageType = website.determinePageType;

export type WebsiteVisitInfo = website.WebsiteVisitInfo;
export type ImportOptions = website.ImportOptions;

export async function createWebsiteMemory(
    dirPath: string,
    baseFileName: string,
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
                dirPath,
                baseFileName,
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

export function getIndexingState(collection: website.WebsiteCollection) {
    return {
        lastMessageOrdinal: collection.messages.length - 1,
        lastSemanticRefOrdinal: collection.semanticRefs.length - 1,
    };
}

export async function addMessagesToCollection(
    collection: website.WebsiteCollection,
    messages: website.Website | website.Website[],
    updateIndex: boolean = true,
): Promise<
    Result<{ lastMessageOrdinal: number; lastSemanticRefOrdinal: number }>
> {
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

// Helper function for building index with progress tracking
export async function buildCollectionIndex(
    collection: website.WebsiteCollection,
): Promise<
    Result<{ lastMessageOrdinal: number; lastSemanticRefOrdinal: number }>
> {
    try {
        await collection.buildIndex();
        return success(getIndexingState(collection));
    } catch (err: any) {
        return { success: false, message: err.message };
    }
}
