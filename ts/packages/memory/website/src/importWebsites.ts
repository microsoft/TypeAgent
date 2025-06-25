// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    WebsiteVisitInfo,
    Website,
    importWebsiteVisit,
} from "./websiteMeta.js";
import path from "path";
import fs from "fs";
import * as sqlite from "better-sqlite3";

export interface ImportOptions {
    source: "chrome" | "edge";
    type: "bookmarks" | "history" | "reading_list";
    folder?: string;
    limit?: number;
    days?: number;
}

export interface ChromeBookmark {
    id: string;
    name: string;
    type: "url" | "folder";
    url?: string;
    date_added?: string;
    date_modified?: string;
    children?: ChromeBookmark[];
}

export interface ChromeBookmarkRoot {
    roots: {
        bookmark_bar: ChromeBookmark;
        other: ChromeBookmark;
        synced: ChromeBookmark;
    };
}

export interface ChromeHistoryEntry {
    id: number;
    url: string;
    title: string;
    visit_count: number;
    typed_count: number;
    last_visit_time: number;
    hidden: number;
}

export interface EdgeBookmark {
    name: string;
    type: "url" | "folder";
    url?: string;
    date_added?: string;
    children?: EdgeBookmark[];
}

// Progress callback for import operations
export type ImportProgressCallback = (
    current: number,
    total: number,
    item: string,
) => void;

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
    try {
        const data = fs.readFileSync(filePath, "utf8");
        return JSON.parse(data) as T;
    } catch (error) {
        console.error(`Error reading JSON file ${filePath}:`, error);
        return undefined;
    }
}

function chromeTimeToDate(chromeTime: string): string {
    const timestamp = parseInt(chromeTime);

    // Detect format based on timestamp magnitude
    if (timestamp < 1e12) {
        // HTML bookmark export format: Unix timestamp (seconds since epoch)
        return new Date(timestamp * 1000).toISOString();
    } else {
        // Chrome internal format: microseconds since Windows epoch (1601-01-01)
        const windowsEpoch = 11644473600000; // Milliseconds between 1601 and 1970
        const chromeTimeMs = timestamp / 1000; // Convert to milliseconds
        const unixTimeMs = chromeTimeMs - windowsEpoch;
        return new Date(unixTimeMs).toISOString();
    }
}

function chromeTimeToISOString(chromeTimeMicros: number): string {
    // Chrome stores time as microseconds since Windows epoch (1601-01-01)
    const windowsEpoch = 11644473600000; // Milliseconds between 1601 and 1970
    const chromeTimeMs = chromeTimeMicros / 1000; // Convert to milliseconds
    const unixTimeMs = chromeTimeMs - windowsEpoch;
    return new Date(unixTimeMs).toISOString();
}

function extractDomain(url: string): string {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch {
        return url;
    }
}

/**
 * Import bookmarks from Chrome
 */
export async function importChromeBookmarks(
    bookmarksPath: string,
    options?: Partial<ImportOptions>,
    progressCallback?: ImportProgressCallback,
): Promise<WebsiteVisitInfo[]> {
    try {
        const bookmarksData =
            await readJsonFile<ChromeBookmarkRoot>(bookmarksPath);
        if (!bookmarksData) {
            throw new Error("Could not read Chrome bookmarks file");
        }

        const websites: WebsiteVisitInfo[] = [];
        const now = Date.now();
        const cutoffDate = options?.days
            ? now - options.days * 24 * 60 * 60 * 1000
            : 0;

        // Process bookmark bar, other bookmarks, and synced bookmarks
        const rootFolders = [
            {
                folder: bookmarksData.roots.bookmark_bar,
                folderPath: "Bookmarks Bar",
            },
            {
                folder: bookmarksData.roots.other,
                folderPath: "Other Bookmarks",
            },
            {
                folder: bookmarksData.roots.synced,
                folderPath: "Mobile Bookmarks",
            },
        ];

        let processedRef = { count: 0 };
        const totalEstimate = 1000; // Rough estimate, will be updated

        for (const { folder, folderPath } of rootFolders) {
            if (options?.folder && !folderPath.includes(options.folder)) {
                continue;
            }
            extractBookmarks(
                folder,
                folderPath,
                websites,
                cutoffDate,
                options?.limit,
                progressCallback,
                processedRef,
                totalEstimate,
            );
        }

        return websites.slice(0, options?.limit);
    } catch (error) {
        throw new Error(`Failed to import Chrome bookmarks: ${error}`);
    }
}

/**
 * Recursively extract bookmarks from Chrome bookmark structure
 */
function extractBookmarks(
    bookmark: ChromeBookmark,
    currentPath: string,
    websites: WebsiteVisitInfo[],
    cutoffDate: number,
    limit?: number,
    progressCallback?: ImportProgressCallback,
    processedRef?: { count: number },
    total?: number,
): void {
    if (limit && websites.length >= limit) return;

    if (bookmark.type === "url" && bookmark.url) {
        const bookmarkDate = bookmark.date_added
            ? chromeTimeToDate(bookmark.date_added)
            : undefined;

        if (cutoffDate && bookmarkDate) {
            const bookmarkTime = new Date(bookmarkDate).getTime();
            if (bookmarkTime < cutoffDate) return;
        }

        const domain = extractDomain(bookmark.url);
        const visitInfo: WebsiteVisitInfo = {
            url: bookmark.url,
            title: bookmark.name,
            domain,
            source: "bookmark" as const,
            folder: currentPath,
        };
        if (bookmarkDate) {
            visitInfo.bookmarkDate = bookmarkDate;
        }
        websites.push(visitInfo);

        if (progressCallback && processedRef && total !== undefined) {
            processedRef.count++;
            progressCallback(processedRef.count, total, bookmark.name);
        }
    } else if (bookmark.type === "folder" && bookmark.children) {
        const folderPath = currentPath
            ? `${currentPath}/${bookmark.name}`
            : bookmark.name;
        for (const child of bookmark.children) {
            extractBookmarks(
                child,
                folderPath,
                websites,
                cutoffDate,
                limit,
                progressCallback,
                processedRef,
                total,
            );
            if (limit && websites.length >= limit) break;
        }
    }
}

/**
 * Import history from Chrome SQLite database
 */
export async function importChromeHistory(
    historyDbPath: string,
    options?: Partial<ImportOptions>,
    progressCallback?: ImportProgressCallback,
): Promise<WebsiteVisitInfo[]> {
    try {
        // Check if the history file exists
        if (!fs.existsSync(historyDbPath)) {
            throw new Error(
                `Chrome history database not found at: ${historyDbPath}`,
            );
        }

        // Chrome may have the database locked, so we'll copy it first
        const tempDbPath = historyDbPath + ".temp_" + Date.now();
        try {
            fs.copyFileSync(historyDbPath, tempDbPath);
        } catch (error) {
            throw new Error(
                `Cannot access Chrome history database. Make sure Chrome is closed. Error: ${error}`,
            );
        }

        const websites: WebsiteVisitInfo[] = [];
        let db: sqlite.Database | null = null;

        try {
            // Open the temporary database copy
            db = new sqlite.default(tempDbPath, { readonly: true });

            // Calculate date filter if specified
            const cutoffTime = options?.days
                ? Date.now() * 1000 - options.days * 24 * 60 * 60 * 1000 * 1000 // Chrome uses microseconds
                : 0;

            // Build the SQL query
            let query = `
                SELECT 
                    urls.url,
                    urls.title,
                    urls.visit_count,
                    urls.typed_count,
                    urls.last_visit_time,
                    urls.hidden
                FROM urls 
                WHERE urls.hidden = 0
            `;

            const params: any[] = [];

            if (cutoffTime > 0) {
                query += ` AND urls.last_visit_time > ?`;
                params.push(cutoffTime);
            }

            query += ` ORDER BY urls.last_visit_time DESC`;

            if (options?.limit) {
                query += ` LIMIT ?`;
                params.push(options.limit);
            }

            console.log(
                `Executing Chrome history query with ${params.length} parameters`,
            );

            // Execute the query
            const stmt = db.prepare(query);
            const rows = stmt.all(...params) as ChromeHistoryEntry[];

            console.log(`Found ${rows.length} history entries`);

            // Convert rows to WebsiteVisitInfo
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];

                if (
                    !row.url ||
                    row.url.startsWith("chrome://") ||
                    row.url.startsWith("chrome-extension://")
                ) {
                    continue; // Skip Chrome internal URLs
                }

                const domain = extractDomain(row.url);
                const visitDate = chromeTimeToISOString(row.last_visit_time);
                const pageType = determinePageType(row.url, row.title); // TODO: Call LLM for this

                const visitInfo: WebsiteVisitInfo = {
                    url: row.url,
                    domain,
                    visitDate,
                    source: "history" as const,
                    pageType,
                };

                if (row.title) visitInfo.title = row.title;
                if (row.visit_count) visitInfo.visitCount = row.visit_count;
                if (row.typed_count) visitInfo.typedCount = row.typed_count;

                websites.push(visitInfo);

                if (progressCallback) {
                    progressCallback(i + 1, rows.length, row.title || row.url);
                }

                if (options?.limit && websites.length >= options.limit) {
                    break;
                }
            }
        } finally {
            // Clean up: close database and remove temp file
            if (db) {
                db.close();
            }
            try {
                fs.unlinkSync(tempDbPath);
            } catch (error) {
                console.warn(
                    `Could not delete temporary database file: ${tempDbPath}`,
                );
            }
        }

        console.log(`Successfully imported ${websites.length} history entries`);
        return websites;
    } catch (error) {
        throw new Error(`Failed to import Chrome history: ${error}`);
    }
}

/**
 * Import history from Edge SQLite database
 */
export async function importEdgeHistory(
    historyDbPath: string,
    options?: Partial<ImportOptions>,
    progressCallback?: ImportProgressCallback,
): Promise<WebsiteVisitInfo[]> {
    // Edge uses a similar SQLite structure to Chrome
    // For now, we can reuse the Chrome import logic as Edge history has similar schema
    console.log(
        "Using Chrome history import logic for Edge (similar database schema)",
    );
    return importChromeHistory(historyDbPath, options, progressCallback);
}

export async function importEdgeBookmarks(
    bookmarksPath: string,
    options?: Partial<ImportOptions>,
    progressCallback?: ImportProgressCallback,
): Promise<WebsiteVisitInfo[]> {
    console.warn("Edge bookmark import not yet implemented");
    return [];
}

/**
 * Import websites from various sources and convert to Website objects
 */
export async function importWebsites(
    source: "chrome" | "edge",
    type: "bookmarks" | "history",
    filePath: string,
    options?: Partial<ImportOptions>,
    progressCallback?: ImportProgressCallback,
): Promise<Website[]> {
    let visitInfos: WebsiteVisitInfo[] = [];

    switch (source) {
        case "chrome":
            if (type === "bookmarks") {
                visitInfos = await importChromeBookmarks(
                    filePath,
                    options,
                    progressCallback,
                );
            } else if (type === "history") {
                visitInfos = await importChromeHistory(
                    filePath,
                    options,
                    progressCallback,
                );
            }
            break;
        case "edge":
            if (type === "bookmarks") {
                visitInfos = await importEdgeBookmarks(
                    filePath,
                    options,
                    progressCallback,
                );
            } else if (type === "history") {
                visitInfos = await importEdgeHistory(
                    filePath,
                    options,
                    progressCallback,
                );
            }
            break;
    }

    // Convert WebsiteVisitInfo to Website objects
    return visitInfos.map((visitInfo) => importWebsiteVisit(visitInfo));
}

/**
 * Get default browser data paths for the current platform
 */
export function getDefaultBrowserPaths(): { chrome: any; edge: any } {
    const os = process.platform;
    const userHome = process.env.HOME || process.env.USERPROFILE || "";

    if (os === "win32") {
        return {
            chrome: {
                bookmarks: path.join(
                    userHome,
                    "AppData/Local/Google/Chrome/User Data/Default/Bookmarks",
                ),
                history: path.join(
                    userHome,
                    "AppData/Local/Google/Chrome/User Data/Default/History",
                ),
            },
            edge: {
                bookmarks: path.join(
                    userHome,
                    "AppData/Local/Microsoft/Edge/User Data/Default/Bookmarks",
                ),
                history: path.join(
                    userHome,
                    "AppData/Local/Microsoft/Edge/User Data/Default/History",
                ),
            },
        };
    } else if (os === "darwin") {
        return {
            chrome: {
                bookmarks: path.join(
                    userHome,
                    "Library/Application Support/Google/Chrome/Default/Bookmarks",
                ),
                history: path.join(
                    userHome,
                    "Library/Application Support/Google/Chrome/Default/History",
                ),
            },
            edge: {
                bookmarks: path.join(
                    userHome,
                    "Library/Application Support/Microsoft Edge/Default/Bookmarks",
                ),
                history: path.join(
                    userHome,
                    "Library/Application Support/Microsoft Edge/Default/History",
                ),
            },
        };
    } else {
        // Linux
        return {
            chrome: {
                bookmarks: path.join(
                    userHome,
                    ".config/google-chrome/Default/Bookmarks",
                ),
                history: path.join(
                    userHome,
                    ".config/google-chrome/Default/History",
                ),
            },
            edge: {
                bookmarks: path.join(
                    userHome,
                    ".config/microsoft-edge/Default/Bookmarks",
                ),
                history: path.join(
                    userHome,
                    ".config/microsoft-edge/Default/History",
                ),
            },
        };
    }
}

/**
 * Determine page type based on URL and title
 */
export function determinePageType(url: string, title?: string): string {
    const domain = extractDomain(url).toLowerCase();
    const urlLower = url.toLowerCase();
    const titleLower = title?.toLowerCase() || "";

    // News sites
    if (
        domain.includes("news") ||
        domain.includes("cnn") ||
        domain.includes("bbc") ||
        domain.includes("reuters") ||
        domain.includes("npr") ||
        domain.includes("guardian")
    ) {
        return "news";
    }

    // Documentation sites
    if (
        domain.includes("docs") ||
        domain.includes("documentation") ||
        urlLower.includes("/docs/") ||
        titleLower.includes("documentation")
    ) {
        return "documentation";
    }

    // Shopping/commerce
    if (
        domain.includes("amazon") ||
        domain.includes("shop") ||
        domain.includes("store") ||
        domain.includes("ebay") ||
        urlLower.includes("/shop/") ||
        urlLower.includes("/cart/")
    ) {
        return "commerce";
    }

    // Social media
    if (
        domain.includes("twitter") ||
        domain.includes("facebook") ||
        domain.includes("linkedin") ||
        domain.includes("instagram") ||
        domain.includes("reddit")
    ) {
        return "social";
    }

    // Travel
    if (
        domain.includes("booking") ||
        domain.includes("expedia") ||
        domain.includes("travel") ||
        domain.includes("airbnb") ||
        titleLower.includes("travel")
    ) {
        return "travel";
    }

    // Development/tech
    if (
        domain.includes("github") ||
        domain.includes("stackoverflow") ||
        domain.includes("dev") ||
        titleLower.includes("api") ||
        titleLower.includes("tutorial")
    ) {
        return "development";
    }

    return "general";
}
