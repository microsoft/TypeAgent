// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Gets a stored property for a specific page
 * @param url The URL of the page
 * @param key The property key
 * @returns The stored property value or undefined
 */
export async function getStoredPageProperty(
    url: string,
    key: string,
): Promise<any> {
    const storageKey = `${url}:${key}`;
    const result = await chrome.storage.session.get([storageKey]);
    return result[storageKey];
}

/**
 * Sets a stored property for a specific page
 * @param url The URL of the page
 * @param key The property key
 * @param value The property value
 */
export async function setStoredPageProperty(
    url: string,
    key: string,
    value: any,
): Promise<void> {
    const storageKey = `${url}:${key}`;
    await chrome.storage.session.set({ [storageKey]: value });
}

/**
 * Stores schema for a page
 * @param url The URL of the page
 * @param schema The schema to store
 */
export async function setPageSchema(url: string, schema: any): Promise<void> {
    let value = await chrome.storage.session.get(["pageSchema"]);
    let updatedSchema = value.pageSchema;

    if (value && Array.isArray(value.pageSchema)) {
        updatedSchema = value.pageSchema.filter(
            (c: { url: string }) => c.url !== url,
        );
    } else {
        updatedSchema = [];
    }

    updatedSchema.push({
        url: url,
        body: schema,
    });

    await chrome.storage.session.set({ pageSchema: updatedSchema });
}

/**
 * Gets schema for a page
 * @param url The URL of the page
 * @returns The stored schema or undefined
 */
export async function getPageSchema(url: string): Promise<any> {
    const value = await chrome.storage.session.get(["pageSchema"]);
    if (value && Array.isArray(value.pageSchema)) {
        const targetSchema = value.pageSchema.filter(
            (c: { url: string }) => c.url === url,
        );

        if (targetSchema && targetSchema.length > 0) {
            return targetSchema[0].body;
        }
    }

    return undefined;
}

/**
 * Removes schema for a page
 * @param url The URL of the page
 */
export async function removePageSchema(url: string): Promise<void> {
    const value = await chrome.storage.session.get(["pageSchema"]);
    if (value && Array.isArray(value.pageSchema)) {
        const updatedSchema = value.pageSchema.filter(
            (c: { url: string }) => c.url !== url,
        );

        await chrome.storage.session.set({ pageSchema: updatedSchema });
    }
}

/**
 * Saves recorded actions to storage
 * @param recordedActions The recorded actions
 * @param recordedActionPageHTML The HTML of the page during recording
 * @param recordedActionScreenshot The screenshot taken during recording
 * @param actionIndex The index of the current action
 * @param isCurrentlyRecording Whether recording is in progress
 */
export async function saveRecordedActions(
    recordedActions: any[],
    recordedActionPageHTML: any,
    recordedActionScreenshot: string,
    actionIndex: number,
    isCurrentlyRecording: boolean,
): Promise<void> {
    await chrome.storage.session.set({
        recordedActions,
        recordedActionPageHTML,
        annotatedScreenshot: recordedActionScreenshot,
        actionIndex,
        isCurrentlyRecording,
    });
}

/**
 * Gets recorded actions from storage
 * @returns The recorded actions and related data
 */
export async function getRecordedActions(): Promise<any> {
    return await chrome.storage.session.get([
        "recordedActions",
        "recordedActionPageHTML",
        "annotatedScreenshot",
        "actionIndex",
        "isCurrentlyRecording",
    ]);
}

/**
 * Clears recorded actions from storage
 */
export async function clearRecordedActions(): Promise<void> {
    try {
        await chrome.storage.session.remove([
            "recordedActions",
            "recordedActionPageHTML",
            "annotatedScreenshot",
            "actionIndex",
            "isCurrentlyRecording",
        ]);
    } catch (error) {
        console.error("Error clearing storage data:", error);
    }
}

/**
 * Gets settings from storage
 * @returns The settings
 */
export async function getSettings(): Promise<Record<string, string>> {
    const settings = await chrome.storage.sync.get({
        websocketHost: "ws://localhost:8080/",
    });
    return settings;
}
