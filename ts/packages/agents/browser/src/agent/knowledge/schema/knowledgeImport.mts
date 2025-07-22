// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Import website data from browser history, bookmarks, or reading list
export type ImportWebsiteData = {
    actionName: "importWebsiteData";
    parameters: {
        // Which browser to import from
        source: "chrome" | "edge";
        // What type of data to import
        type: "history" | "bookmarks";
        // Maximum number of items to import
        limit?: number;
        // How many days back to import (for history)
        days?: number;
        // Specific bookmark folder to import (for bookmarks)
        folder?: string;
        // extraction mode
        mode?: "basic" | "content" | "macros" | "full";
        maxConcurrent?: number;
        contentTimeout?: number;
    };
};

// Import HTML files from local folder path
export type ImportHtmlFolder = {
    actionName: "importHtmlFolder";
    parameters: {
        // Folder path containing HTML files
        folderPath: string;
        // Import options
        options?: {
            // extraction mode
            mode?: "basic" | "content" | "macros" | "full";
            preserveStructure?: boolean;
            // Folder-specific options
            recursive?: boolean;
            fileTypes?: string[];
            limit?: number;
            maxFileSize?: number;
            skipHidden?: boolean;
        };
        // Import tracking ID
        importId: string;
    };
};
