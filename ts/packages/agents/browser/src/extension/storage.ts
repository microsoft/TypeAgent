// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export async function setStoredPageProperty(
    url: string,
    key: string,
    value: any,
): Promise<void> {
    try {
        const result = await chrome.storage.local.get([url]);
        const urlData = result[url] || {};
        urlData[key] = value;

        await chrome.storage.local.set({ [url]: urlData });
        console.log(`Saved property '${key}' for ${url}`);
    } catch (error) {
        console.error("Error saving data:", error);
    }
}

export async function getStoredPageProperty(
    url: string,
    key: string,
): Promise<any | null> {
    try {
        const result = await chrome.storage.local.get([url]);
        return result[url]?.[key] ?? null;
    } catch (error) {
        console.error("Error retrieving data:", error);
        return null;
    }
}

export async function deleteStoredPageProperty(
    url: string,
    key: string,
): Promise<void> {
    try {
        const result = await chrome.storage.local.get([url]);
        const urlData = result[url] || {};

        if (key in urlData) {
            delete urlData[key];

            if (Object.keys(urlData).length === 0) {
                await chrome.storage.local.remove(url);
                console.log(`All properties deleted for ${url}`);
            } else {
                await chrome.storage.local.set({ [url]: urlData });
                console.log(`Deleted property '${key}' for ${url}`);
            }
        }
    } catch (error) {
        console.error("Error deleting data:", error);
    }
}
