// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    NamedArgs,
    parseNamedArguments,
    ProgressBar,
    StopWatch,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { KnowProPrinter } from "./knowproPrinter.js";
import path from "path";
import { ensureDir } from "typeagent";
import { memoryNameToIndexPath } from "./knowproCommon.js";
import chalk from "chalk";
import {
    createWebsiteMemory,
    getIndexingState,
    addMessagesToCollection,
    buildCollectionIndex,
} from "./websiteMemory.js";

import * as website from "website-memory";
// import { createWebsiteAnswerGenerator } from "./websiteAnswerContext.js";
import * as kp from "knowpro";
import * as kpTest from "knowpro-test";

export type KnowProWebsiteContext = {
    printer: KnowProPrinter;
    website?: website.WebsiteCollection | undefined;
    basePath: string;
};

export async function createKnowproWebsiteCommands(
    kpContext: KnowproContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const context: KnowProWebsiteContext = {
        printer: kpContext.printer,
        basePath: path.join(kpContext.basePath, "website"),
    };
    await ensureDir(context.basePath);

    commands.kpWebsiteAdd = websiteAdd;
    commands.kpWebsiteLoad = websiteLoad;
    commands.kpWebsiteBuildIndex = websiteBuildIndex;
    commands.kpWebsiteAddBookmarks = websiteAddBookmarks;
    commands.kpWebsiteAddHistory = websiteAddHistory;
    commands.kpWebsiteClose = websiteClose;
    commands.kpWebsiteStats = websiteStats;
    commands.kpWebsiteSearch = websiteSearch;
    commands.kpWebsiteTestEnhanced = websiteTestEnhanced;

    function websiteAddDef(): CommandMetadata {
        return {
            description: "Add website visits to the current website memory",
            args: {
                url: arg("Website URL to add"),
            },
            options: {
                title: arg("Page title"),
                content: arg("Page content or description"),
                updateIndex: argBool("Automatically update index", true),
                source: arg(
                    "Source type: bookmark | history | reading_list",
                    "bookmark",
                ),
                folder: arg("Bookmark folder name"),
                pageType: arg(
                    "Page type: news | documentation | commerce | social | travel | development | general",
                ),
            },
        };
    }
    commands.kpWebsiteAdd.metadata = websiteAddDef();
    async function websiteAdd(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) {
            return;
        }
        const namedArgs = parseNamedArguments(args, websiteAddDef());

        const visitInfo: website.WebsiteVisitInfo = {
            url: namedArgs.url,
            source: (namedArgs.source as "bookmark" | "history") || "bookmark",
        };

        visitInfo.visitDate = new Date().toISOString();
        if (namedArgs.title) visitInfo.title = namedArgs.title;
        if (namedArgs.folder) visitInfo.folder = namedArgs.folder;
        if (namedArgs.pageType) {
            visitInfo.pageType = namedArgs.pageType;
        } else {
            visitInfo.pageType = website.determinePageType(
                namedArgs.url,
                namedArgs.title,
            );
        }

        if (visitInfo.source === "bookmark") {
            visitInfo.bookmarkDate = visitInfo.visitDate;
        }

        const websiteMessage = website.importWebsiteVisit(
            visitInfo,
            namedArgs.content,
        );

        context.printer.writeLine(`Adding website: ${visitInfo.url}`);
        const result = await addMessagesToCollection(
            websiteCollection,
            websiteMessage,
            namedArgs.updateIndex,
        );

        if (!result.success) {
            context.printer.writeError(result.message);
            return;
        }
    }

    function websiteBuildIndexDef(): CommandMetadata {
        return {
            description: "Update the website index with any pending items",
            options: {
                knowledge: argBool("Extract knowledge", true),
            },
        };
    }
    commands.kpWebsiteBuildIndex.metadata = websiteBuildIndexDef();
    async function websiteBuildIndex(
        args: string[] | NamedArgs,
    ): Promise<void> {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) {
            return;
        }
        parseNamedArguments(args, websiteBuildIndexDef()); // Parse but don't use for now
        context.printer.writeLine(`Building website index`);
        const indexingState = getIndexingState(websiteCollection);
        const ordinalStartAt = indexingState.lastMessageOrdinal;
        const countToIndex = websiteCollection.messages.length - ordinalStartAt;
        context.printer.writeLine(
            `OrdinalStartAt: ${ordinalStartAt + 1} / ${countToIndex}`,
        );

        let progress = new ProgressBar(context.printer, countToIndex);

        try {
            const clock = new StopWatch();
            clock.start();
            const result = await buildCollectionIndex(websiteCollection);
            clock.stop();
            progress.complete();
            context.printer.writeTiming(chalk.gray, clock, "Build index");
            if (!result.success) {
                context.printer.writeError(result.message);
                return;
            }
        } catch (error) {
            context.printer.writeError(`Indexing failed: ${error}`);
        }
    }

    function loadWebsitesDef(): CommandMetadata {
        return {
            description: "Load or Create Website Memory",
            options: {
                name: arg("Name of website memory"),
                createNew: argBool("Create new", false),
            },
        };
    }
    commands.kpWebsiteLoad.metadata = loadWebsitesDef();
    async function websiteLoad(args: string[]) {
        const namedArgs = parseNamedArguments(args, loadWebsitesDef());
        let websiteIndexPath = namedArgs.name
            ? memoryNameToIndexPath(context.basePath, namedArgs.name)
            : undefined;
        if (!websiteIndexPath) {
            context.printer.writeError("No memory name provided");
            return;
        }
        closeWebsite();

        const clock = new StopWatch();
        clock.start();
        try {
            context.website = await createWebsiteMemory(
                path.dirname(websiteIndexPath),
                path.basename(websiteIndexPath, path.extname(websiteIndexPath)),
                namedArgs.createNew,
                kpContext.knowledgeModel,
                kpContext.queryTranslator,
                kpContext.answerGenerator,
            );
            clock.stop();
            if (context.website) {
                // Set up enhanced search context for website queries
                kpContext.conversation = context.website;
                
                context.printer.writeTiming(chalk.gray, clock);
                context.printer.writeLine(
                    `Loaded website memory with enhanced temporal/frequency search: ${namedArgs.name}`,
                );
            }
        } catch (error) {
            context.printer.writeError(
                `Could not create website memory: ${error}`,
            );
        }
    }

    function websiteAddBookmarksDef(): CommandMetadata {
        return {
            description: "Import bookmarks from browser",
            options: {
                source: arg("Browser: chrome | edge", "chrome"),
                path: arg("Custom bookmarks file path"),
                folder: arg("Filter by folder name"),
                limit: arg("Maximum number to import"),
                days: arg("Only import bookmarks from last N days"),
                updateIndex: argBool("Automatically update index", true),
            },
        };
    }
    commands.kpWebsiteAddBookmarks.metadata = websiteAddBookmarksDef();
    async function websiteAddBookmarks(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) {
            return;
        }
        const namedArgs = parseNamedArguments(args, websiteAddBookmarksDef());

        // For now, let's hardcode the path since namedArgs.path is a function
        let bookmarksPath: string | undefined = undefined; // namedArgs.path would be a function call

        const defaultPaths = website.getDefaultBrowserPaths();
        if (namedArgs.source === "chrome") {
            bookmarksPath = defaultPaths.chrome.bookmarks as string;
        } else if (namedArgs.source === "edge") {
            bookmarksPath = defaultPaths.edge.bookmarks as string;
        } else {
            context.printer.writeError("Unsupported browser source");
            return;
        }

        try {
            if (!bookmarksPath) {
                context.printer.writeError(
                    "Could not determine bookmarks path",
                );
                return;
            }

            context.printer.writeLine(
                `Importing bookmarks from ${namedArgs.source} at ${bookmarksPath}`,
            );

            const importOptions: Partial<website.ImportOptions> = {
                source: namedArgs.source as "chrome" | "edge",
                type: "bookmarks",
            };
            if (namedArgs.folder) importOptions.folder = namedArgs.folder;
            const limitStr = namedArgs.limit;
            if (limitStr && !isNaN(parseInt(limitStr))) {
                importOptions.limit = parseInt(limitStr);
            }
            const daysStr = namedArgs.days;
            if (daysStr && !isNaN(parseInt(daysStr))) {
                importOptions.days = parseInt(daysStr);
            }

            let websites: website.Website[] = [];
            if (namedArgs.source === "chrome") {
                websites = await website.importWebsites(
                    "chrome",
                    "bookmarks",
                    bookmarksPath,
                    importOptions,
                );
            } else if (namedArgs.source === "edge") {
                websites = await website.importWebsites(
                    "edge",
                    "bookmarks",
                    bookmarksPath,
                    importOptions,
                );
            }

            if (websites.length === 0) {
                context.printer.writeError("No bookmarks found to import");
                return;
            }

            context.printer.writeLine(
                `Found ${websites.length} bookmarks to import`,
            );

            const websiteMessages = websites;

            let progress = new ProgressBar(context.printer, 1);

            const result = await addMessagesToCollection(
                websiteCollection,
                websiteMessages,
                namedArgs.updateIndex,
            );
            progress.complete();

            if (!result.success) {
                context.printer.writeError(result.message);
                return;
            }

            context.printer.writeLine(
                `Successfully imported ${websites.length} bookmarks`,
            );
        } catch (error) {
            context.printer.writeError(`Failed to import bookmarks: ${error}`);
        }
    }

    function websiteAddHistoryDef(): CommandMetadata {
        return {
            description: "Import browsing history from browser",
            options: {
                source: arg("Browser: chrome | edge", "chrome"),
                path: arg("Custom history file path"),
                limit: arg("Maximum number to import"),
                days: arg("Only import history from last N days", "7"),
                updateIndex: argBool("Automatically update index", true),
            },
        };
    }
    commands.kpWebsiteAddHistory.metadata = websiteAddHistoryDef();
    async function websiteAddHistory(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) {
            return;
        }
        const namedArgs = parseNamedArguments(args, websiteAddHistoryDef());

        // For now, let's hardcode the path since namedArgs.path is a function
        let historyPath: string | undefined = undefined; // namedArgs.path would be a function call

        const defaultPaths = website.getDefaultBrowserPaths();
        if (namedArgs.source === "chrome") {
            historyPath = defaultPaths.chrome.history as string;
        } else if (namedArgs.source === "edge") {
            historyPath = defaultPaths.edge.history as string;
        } else {
            context.printer.writeError("Unsupported browser source");
            return;
        }

        try {
            if (!historyPath) {
                context.printer.writeError(
                    "Could not determine history database path",
                );
                return;
            }

            context.printer.writeLine(
                `Importing history from ${namedArgs.source} at ${historyPath}`,
            );
            context.printer.writeLine(
                "Note: Please close Chrome before importing history to avoid database lock issues.",
            );

            const importOptions: Partial<website.ImportOptions> = {
                source: namedArgs.source as "chrome" | "edge",
                type: "history",
            };
            const limitStr = namedArgs.limit;
            if (limitStr && !isNaN(parseInt(limitStr))) {
                importOptions.limit = parseInt(limitStr);
            }
            const daysStr = namedArgs.days;
            if (daysStr && !isNaN(parseInt(daysStr))) {
                importOptions.days = parseInt(daysStr);
            }

            let websites: website.Website[] = [];
            if (namedArgs.source === "chrome") {
                websites = await website.importWebsites(
                    "chrome",
                    "history",
                    historyPath,
                    importOptions,
                );
            } else if (namedArgs.source === "edge") {
                websites = await website.importWebsites(
                    "edge",
                    "history",
                    historyPath,
                    importOptions,
                );
            }

            if (websites.length === 0) {
                context.printer.writeError(
                    "No history entries found to import",
                );
                return;
            }

            context.printer.writeLine(
                `Found ${websites.length} history entries to import`,
            );

            const websiteMessages = websites;

            let progress = new ProgressBar(context.printer, 1);

            const result = await addMessagesToCollection(
                websiteCollection,
                websiteMessages,
                namedArgs.updateIndex,
            );
            progress.complete();

            if (!result.success) {
                context.printer.writeError(result.message);
                return;
            }

            context.printer.writeLine(
                `Successfully imported ${websites.length} history entries`,
            );
        } catch (error) {
            context.printer.writeError(`Failed to import history: ${error}`);
        }
    }

    function websiteStatsDef(): CommandMetadata {
        return {
            description: "Show statistics about the website memory",
        };
    }
    commands.kpWebsiteStats.metadata = websiteStatsDef();
    async function websiteStats(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) {
            return;
        }

        const totalMessages = websiteCollection.messages.length;
        const indexingState = getIndexingState(websiteCollection);
        const indexedMessages = indexingState.lastMessageOrdinal + 1;

        context.printer.writeLine(`Website Memory Statistics:`);
        context.printer.writeLine(`  Total visits: ${totalMessages}`);
        context.printer.writeLine(`  Indexed visits: ${indexedMessages}`);
        context.printer.writeLine(
            `  Pending indexing: ${totalMessages - indexedMessages}`,
        );

        // Count by source type
        const sourceCounts = new Map<string, number>();
        const domainCounts = new Map<string, number>();
        const pageTypeCounts = new Map<string, number>();

        for (let i = 0; i < totalMessages; i++) {
            const message = websiteCollection.messages.get(i);
            if (message) {
                const source = message.metadata.websiteSource;
                sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);

                if (message.metadata.domain) {
                    const domain = message.metadata.domain;
                    domainCounts.set(
                        domain,
                        (domainCounts.get(domain) || 0) + 1,
                    );
                }

                if (message.metadata.pageType) {
                    const pageType = message.metadata.pageType;
                    pageTypeCounts.set(
                        pageType,
                        (pageTypeCounts.get(pageType) || 0) + 1,
                    );
                }
            }
        }

        if (sourceCounts.size > 0) {
            context.printer.writeLine(`\nBy Source:`);
            for (const [source, count] of sourceCounts.entries()) {
                context.printer.writeLine(`  ${source}: ${count}`);
            }
        }

        if (domainCounts.size > 0) {
            context.printer.writeLine(`\nTop Domains:`);
            const sortedDomains = Array.from(domainCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
            for (const [domain, count] of sortedDomains) {
                context.printer.writeLine(`  ${domain}: ${count} visits`);
            }
        }

        if (pageTypeCounts.size > 0) {
            context.printer.writeLine(`\nBy Page Type:`);
            for (const [pageType, count] of pageTypeCounts.entries()) {
                context.printer.writeLine(`  ${pageType}: ${count}`);
            }
        }
    }

    function websiteSearchDef(): CommandMetadata {
        return {
            description: "Search website memory using natural language queries with temporal and frequency intelligence",
            args: {
                query: arg("Natural language search query")
            },
            options: {
                maxToDisplay: argNum("Maximum results to display", 10),
                showUrls: argBool("Show full URLs", true),
                debug: argBool("Show debug information", false)
            }
        };
    }
    commands.kpWebsiteSearch.metadata = websiteSearchDef();
    async function websiteSearch(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) {
            return;
        }
        
        if (!kpContext.conversation || kpContext.conversation !== websiteCollection) {
            context.printer.writeError("Website memory not loaded as conversation. Please load with kpWebsiteLoad first.");
            return;
        }
        
        const namedArgs = parseNamedArguments(args, websiteSearchDef());
        const query = namedArgs.query;
        
        context.printer.writeLine(`🔍 Searching website memory: "${query}"`);
        context.printer.writeLine("=" .repeat(60));
        
        try {
            // Use the knowpro search pattern with LLM query understanding
            const searchResponse = await kpTest.execSearchRequest(
                kpContext,
                namedArgs,
            );
            
            const searchResults = searchResponse.searchResults;
            const debugContext = searchResponse.debugContext;
            
            if (!searchResults.success) {
                context.printer.writeError(searchResults.message);
                return;
            }
            
            if (namedArgs.debug) {
                context.printer.writeInColor(chalk.gray, () => {
                    context.printer.writeLine();
                    context.printer.writeDebugContext(debugContext);
                });
            }
            
            if (!kp.hasConversationResults(searchResults.data)) {
                context.printer.writeLine("No matches found");
                return;
            }
            
            // Display results with website-specific formatting
            for (let i = 0; i < searchResults.data.length; ++i) {
                const searchQueryExpr = debugContext.searchQueryExpr![i];
                const result = searchResults.data[i];
                
                if (!namedArgs.debug) {
                    for (const selectExpr of searchQueryExpr.selectExpressions) {
                        context.printer.writeSelectExpr(selectExpr, false);
                    }
                }
                
                // Use the standard search result writer
                context.printer.writeLine("####");
                context.printer.writeInColor(chalk.cyan, searchQueryExpr.rawQuery!);
                context.printer.writeLine("####");
                context.printer.writeConversationSearchResult(
                    kpContext.conversation!,
                    result,
                    true, // showKnowledge
                    true, // showMessages
                    namedArgs.maxToDisplay,
                    true, // distinct
                );
            }
            
        } catch (error) {
            context.printer.writeError(`Search failed: ${error}`);
        }
    }

    function websiteTestEnhancedDef(): CommandMetadata {
        return {
            description: "Test enhanced natural language queries with temporal and frequency intelligence",
            args: {
                query: arg("Natural language query to test")
            }
        };
    }
    commands.kpWebsiteTestEnhanced.metadata = websiteTestEnhancedDef();
    async function websiteTestEnhanced(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) {
            return;
        }
        
        const namedArgs = parseNamedArguments(args, websiteTestEnhancedDef());
        const query = namedArgs.query;
        
        context.printer.writeLine(`🧪 Testing enhanced query: "${query}"`);
        context.printer.writeLine("=" .repeat(60));
        
        try {
            // Use the new LLM-based search with enhanced website context
            if (kpContext.conversation === websiteCollection) {
                await websiteSearch([query, "--debug", "true"]);
                
                context.printer.writeLine();
                context.printer.writeInColor(chalk.green, "🧪 Enhanced test completed successfully!");
            } else {
                context.printer.writeError("Website memory not loaded as conversation. Use kpWebsiteLoad first.");
            }
            
        } catch (error) {
            context.printer.writeError(`Enhanced query failed: ${error}`);
        }
    }

    async function websiteClose() {
        closeWebsite();
    }

    function ensureMemoryLoaded() {
        if (context.website) {
            return context.website;
        }
        context.printer.writeError("No website memory loaded");
        return undefined;
    }

    function closeWebsite() {
        if (context.website) {
            // WebsiteCollection doesn't have a close method like the old WebsiteMemory
            // So we just clear the reference
            context.website = undefined;
        }
    }

    return;
}
