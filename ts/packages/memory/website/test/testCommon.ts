// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";

export function createSampleChromeBookmarks() {
    return {
        roots: {
            bookmark_bar: {
                id: "1",
                name: "Bookmarks Bar",
                type: "folder" as const,
                children: [
                    {
                        id: "2",
                        name: "TypeAgent Repository",
                        type: "url" as const,
                        url: "https://github.com/microsoft/TypeAgent",
                        date_added: "13370728742000000", // Chrome microseconds
                    },
                    {
                        id: "3",
                        name: "Development",
                        type: "folder" as const,
                        children: [
                            {
                                id: "4",
                                name: "TypeScript Documentation",
                                type: "url" as const,
                                url: "https://docs.microsoft.com/typescript",
                                date_added: "13370728742000000",
                            },
                        ],
                    },
                ],
            },
            other: {
                id: "5",
                name: "Other Bookmarks",
                type: "folder" as const,
                children: [],
            },
            synced: {
                id: "6",
                name: "Mobile Bookmarks",
                type: "folder" as const,
                children: [],
            },
        },
    };
}

export function writeSampleBookmarksFile(filePath: string): void {
    const bookmarks = createSampleChromeBookmarks();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(bookmarks, null, 2));
}

export function cleanupTestFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}
