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
import type { DetectedAction } from "website-memory";
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
    commands.kpWebsiteAnalyzeContent = websiteAnalyzeContent;
    commands.kpWebsiteTestEnhanced = websiteTestEnhanced;

    // NEW: Action detection commands
    commands.kpWebsiteAnalyzeActions = websiteAnalyzeActions;
    commands.kpWebsiteListActions = websiteListActions;

    // Enhanced knowledge search commands
    commands.kpWebsiteSearchEntities = websiteSearchEntities;
    commands.kpWebsiteSearchTopics = websiteSearchTopics;
    commands.kpWebsiteHybridSearch = websiteHybridSearch;
    commands.kpWebsiteKnowledgeInsights = websiteKnowledgeInsights;

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
            [websiteMessage],
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

                // NEW: Content extraction options
                extractContent: argBool("Extract page content", false),
                extractionMode: arg(
                    "Extraction mode: basic | content | actions | full",
                    "content",
                ),
                maxConcurrent: argNum("Max concurrent extractions", 3),
                contentTimeout: argNum(
                    "Content extraction timeout (ms)",
                    10000,
                ),

                enableActionDetection: argBool("Enable action detection", true),
                actionConfidence: argNum(
                    "Minimum action confidence threshold",
                    0.7,
                ),

                enableKnowledgeExtraction: argBool(
                    "Enable knowledge extraction",
                    false,
                ),
                knowledgeMode: arg(
                    "Knowledge extraction mode: basic | enhanced | hybrid",
                    "hybrid",
                ),
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

        let bookmarksPath: string | undefined = undefined;

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

            // Enhanced import with content extraction
            if (namedArgs.extractContent) {
                context.printer.writeLine(
                    `🔍 Extracting content in ${namedArgs.extractionMode} mode...`,
                );
                context.printer.writeLine(
                    `⚙️  Max concurrent: ${namedArgs.maxConcurrent}, Timeout: ${namedArgs.contentTimeout}ms`,
                );

                if (
                    namedArgs.enableActionDetection &&
                    (namedArgs.extractionMode === "actions" ||
                        namedArgs.extractionMode === "full")
                ) {
                    context.printer.writeLine(
                        `🎯 Action detection enabled (min confidence: ${namedArgs.actionConfidence})`,
                    );
                }

                websites = await website.importWebsitesWithContent(
                    namedArgs.source as "chrome" | "edge",
                    "bookmarks",
                    bookmarksPath,
                    {
                        ...importOptions,
                        extractContent: true,
                        extractionMode: namedArgs.extractionMode as any,
                        maxConcurrent: namedArgs.maxConcurrent,
                        contentTimeout: namedArgs.contentTimeout,
                        enableActionDetection: namedArgs.enableActionDetection,
                        actionConfidence: namedArgs.actionConfidence,
                        // NEW: Knowledge extraction options
                        enableKnowledgeExtraction:
                            namedArgs.enableKnowledgeExtraction,
                        knowledgeMode: namedArgs.knowledgeMode as any,
                    },
                    (current, total, item) => {
                        // writeProgress might only expect one argument
                        context.printer.writeLine(
                            `Processing ${current}/${total}: ${item}`,
                        );
                    },
                );

                context.printer.writeLine(
                    `✅ Content extraction completed for ${websites.length} bookmarks`,
                );

                // Count websites with enhanced content
                const enhancedCount = websites.filter(
                    (w) => w.metadata.pageContent,
                ).length;
                if (enhancedCount > 0) {
                    context.printer.writeLine(
                        `📄 ${enhancedCount} bookmarks now have enhanced content`,
                    );
                }

                // Report action detection results
                if (
                    namedArgs.enableActionDetection &&
                    (namedArgs.extractionMode === "actions" ||
                        namedArgs.extractionMode === "full")
                ) {
                    const actionStats = calculateActionStats(websites);
                    if (actionStats.sitesWithActions > 0) {
                        context.printer.writeLine(
                            `✅ Action detection completed:`,
                        );
                        context.printer.writeLine(
                            `   • ${actionStats.sitesWithActions} sites have detectable actions`,
                        );
                        context.printer.writeLine(
                            `   • ${actionStats.totalActions} total actions found`,
                        );
                        context.printer.writeLine(
                            `   • ${actionStats.actionTypes.join(", ")} action types detected`,
                        );
                        context.printer.writeLine(
                            `   • ${actionStats.highConfidenceActions} high-confidence actions (>80%)`,
                        );
                    } else {
                        context.printer.writeLine(
                            `ℹ️  No high-confidence actions detected in imported bookmarks`,
                        );
                    }
                }
            } else {
                // Use existing basic import
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
            description:
                "Show detailed statistics about the website memory including domains, entities, topics, and actions",
            options: {
                detailed: argBool("Show detailed breakdowns", false),
                limit: argNum("Limit top results shown", 10),
                showActions: argBool("Show action statistics", true),
                showContent: argBool("Show content analysis stats", true),
                showTemporal: argBool("Show temporal distribution", true),
                showKnowledgeInsights: argBool("Show knowledge insights", true),
            },
        };
    }
    commands.kpWebsiteStats.metadata = websiteStatsDef();
    async function websiteStats(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) {
            return;
        }

        const namedArgs = parseNamedArguments(args, websiteStatsDef());
        const limit = namedArgs.limit || 10;

        const totalMessages = websiteCollection.messages.length;
        const indexingState = getIndexingState(websiteCollection);
        const indexedMessages = indexingState.lastMessageOrdinal + 1;

        context.printer.writeLine(`🌐 Website Memory Statistics:`);
        context.printer.writeLine(`${"=".repeat(50)}`);
        context.printer.writeLine(`📊 Overview:`);
        context.printer.writeLine(`  Total visits: ${totalMessages}`);
        context.printer.writeLine(`  Indexed visits: ${indexedMessages}`);
        context.printer.writeLine(
            `  Pending indexing: ${totalMessages - indexedMessages}`,
        );

        // Initialize tracking variables
        const sourceCounts = new Map<string, number>();
        const domainCounts = new Map<string, number>();
        const pageTypeCounts = new Map<string, number>();
        const actionTypeCounts = new Map<string, number>();
        const topicCounts = new Map<string, number>();
        const entityCounts = new Map<string, number>();
        const temporalData = new Map<string, number>();

        let totalActions = 0;
        let highConfidenceActions = 0;
        let sitesWithContent = 0;
        let totalWordCount = 0;
        let sitesWithActions = 0;

        // Analyze each message
        for (let i = 0; i < totalMessages; i++) {
            const message = websiteCollection.messages.get(i);
            if (!message) continue;

            const metadata = message.metadata as website.WebsiteDocPartMeta;

            // Source tracking
            const source = metadata.websiteSource || "unknown";
            sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);

            // Domain tracking
            if (metadata.domain) {
                domainCounts.set(
                    metadata.domain,
                    (domainCounts.get(metadata.domain) || 0) + 1,
                );
            }

            // Page type tracking
            if (metadata.pageType) {
                pageTypeCounts.set(
                    metadata.pageType,
                    (pageTypeCounts.get(metadata.pageType) || 0) + 1,
                );
            }

            // Content analysis
            if (metadata.pageContent) {
                sitesWithContent++;
                if (metadata.pageContent.wordCount) {
                    totalWordCount += metadata.pageContent.wordCount;
                }

                // Extract topics from headings and keywords
                if (metadata.pageContent.headings) {
                    metadata.pageContent.headings.forEach((heading: any) => {
                        const topics = extractTopicsFromText(heading);
                        topics.forEach((topic) => {
                            topicCounts.set(
                                topic,
                                (topicCounts.get(topic) || 0) + 1,
                            );
                        });
                    });
                }
            }

            // Meta tags analysis for entities/keywords
            if (metadata.metaTags && metadata.metaTags.keywords) {
                metadata.metaTags.keywords.forEach((keyword: any) => {
                    const entity = keyword.toLowerCase().trim();
                    if (entity.length > 2) {
                        entityCounts.set(
                            entity,
                            (entityCounts.get(entity) || 0) + 1,
                        );
                    }
                });
            }

            // Action analysis
            if (
                metadata.detectedActions &&
                metadata.detectedActions.length > 0
            ) {
                sitesWithActions++;
                totalActions += metadata.detectedActions.length;

                metadata.detectedActions.forEach((action: DetectedAction) => {
                    const actionType = action.actionType.replace("Action", "");
                    actionTypeCounts.set(
                        actionType,
                        (actionTypeCounts.get(actionType) || 0) + 1,
                    );

                    if (action.confidence > 0.8) {
                        highConfidenceActions++;
                    }
                });
            }

            // Temporal analysis
            if (metadata.visitDate || metadata.bookmarkDate) {
                const date = new Date(
                    metadata.visitDate || metadata.bookmarkDate!,
                );
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
                temporalData.set(
                    monthKey,
                    (temporalData.get(monthKey) || 0) + 1,
                );
            }
        }

        // Display source breakdown
        if (sourceCounts.size > 0) {
            context.printer.writeLine(`\n📥 Sources:`);
            for (const [source, count] of sourceCounts.entries()) {
                const percentage = ((count / totalMessages) * 100).toFixed(1);
                context.printer.writeLine(
                    `  ${source}: ${count} (${percentage}%)`,
                );
            }
        }

        // Display top domains
        if (domainCounts.size > 0) {
            context.printer.writeLine(`\n🌍 Top ${limit} Domains:`);
            const sortedDomains = Array.from(domainCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, limit);

            sortedDomains.forEach(([domain, count], index) => {
                const percentage = ((count / totalMessages) * 100).toFixed(1);
                context.printer.writeLine(
                    `  ${index + 1}. ${domain}: ${count} visits (${percentage}%)`,
                );
            });
        }

        // Display page types
        if (pageTypeCounts.size > 0) {
            context.printer.writeLine(`\n📄 Page Types:`);
            const sortedPageTypes = Array.from(pageTypeCounts.entries()).sort(
                (a, b) => b[1] - a[1],
            );

            sortedPageTypes.forEach(([pageType, count]) => {
                const percentage = ((count / totalMessages) * 100).toFixed(1);
                context.printer.writeLine(
                    `  ${pageType}: ${count} (${percentage}%)`,
                );
            });
        }

        // Display content analysis stats
        if (namedArgs.showContent && sitesWithContent > 0) {
            const avgWordCount = Math.round(totalWordCount / sitesWithContent);
            context.printer.writeLine(`\n📚 Content Analysis:`);
            context.printer.writeLine(
                `  Sites with extracted content: ${sitesWithContent}/${totalMessages} (${((sitesWithContent / totalMessages) * 100).toFixed(1)}%)`,
            );
            context.printer.writeLine(
                `  Total words extracted: ${totalWordCount.toLocaleString()}`,
            );
            context.printer.writeLine(
                `  Average words per site: ${avgWordCount.toLocaleString()}`,
            );

            // Show top topics if available
            if (topicCounts.size > 0) {
                context.printer.writeLine(
                    `\n🏷️  Top ${Math.min(limit, topicCounts.size)} Topics:`,
                );
                const sortedTopics = Array.from(topicCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, limit);

                sortedTopics.forEach(([topic, count], index) => {
                    context.printer.writeLine(
                        `  ${index + 1}. ${topic}: ${count} mentions`,
                    );
                });
            }
        }

        // Display common entities/keywords
        if (entityCounts.size > 0) {
            context.printer.writeLine(`\n🔍 Common Keywords/Entities:`);
            const sortedEntities = Array.from(entityCounts.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, limit);

            sortedEntities.forEach(([entity, count], index) => {
                context.printer.writeLine(
                    `  ${index + 1}. ${entity}: ${count} occurrences`,
                );
            });
        }

        // Display action statistics
        if (namedArgs.showActions && sitesWithActions > 0) {
            context.printer.writeLine(`\n🎯 Action Detection Summary:`);
            context.printer.writeLine(
                `  Sites with actions: ${sitesWithActions}/${totalMessages} (${((sitesWithActions / totalMessages) * 100).toFixed(1)}%)`,
            );
            context.printer.writeLine(
                `  Total actions detected: ${totalActions}`,
            );
            context.printer.writeLine(
                `  High-confidence actions: ${highConfidenceActions} (>${((highConfidenceActions / totalActions) * 100).toFixed(1)}%)`,
            );

            if (actionTypeCounts.size > 0) {
                context.printer.writeLine(`\n🎭 Action Types:`);
                const sortedActionTypes = Array.from(
                    actionTypeCounts.entries(),
                ).sort((a, b) => b[1] - a[1]);

                sortedActionTypes.forEach(([actionType, count]) => {
                    const percentage = ((count / totalActions) * 100).toFixed(
                        1,
                    );
                    context.printer.writeLine(
                        `  ${actionType}: ${count} (${percentage}%)`,
                    );
                });
            }
        }

        // Display temporal distribution
        if (namedArgs.showTemporal && temporalData.size > 0) {
            context.printer.writeLine(`\n📅 Temporal Distribution (by Month):`);
            const sortedTemporal = Array.from(temporalData.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .slice(-6); // Show last 6 months

            sortedTemporal.forEach(([month, count]) => {
                const bar = "█".repeat(
                    Math.min(
                        20,
                        Math.round(
                            (count / Math.max(...temporalData.values())) * 20,
                        ),
                    ),
                );
                context.printer.writeLine(
                    `  ${month}: ${count.toString().padStart(3)} ${bar}`,
                );
            });
        }

        // Detailed breakdown if requested
        if (namedArgs.detailed) {
            context.printer.writeLine(`\n🔬 Detailed Analysis:`);
            context.printer.writeLine(`  Unique domains: ${domainCounts.size}`);
            context.printer.writeLine(
                `  Unique page types: ${pageTypeCounts.size}`,
            );
            context.printer.writeLine(
                `  Unique action types: ${actionTypeCounts.size}`,
            );
            context.printer.writeLine(
                `  Unique topics identified: ${topicCounts.size}`,
            );
            context.printer.writeLine(
                `  Unique entities/keywords: ${entityCounts.size}`,
            );

            if (sitesWithContent > 0) {
                const contentPercentage = (
                    (sitesWithContent / totalMessages) *
                    100
                ).toFixed(1);
                context.printer.writeLine(
                    `  Content extraction success rate: ${contentPercentage}%`,
                );
            }

            if (sitesWithActions > 0) {
                const actionPercentage = (
                    (sitesWithActions / totalMessages) *
                    100
                ).toFixed(1);
                const avgActionsPerSite = (
                    totalActions / sitesWithActions
                ).toFixed(1);
                context.printer.writeLine(
                    `  Action detection success rate: ${actionPercentage}%`,
                );
                context.printer.writeLine(
                    `  Average actions per actionable site: ${avgActionsPerSite}`,
                );
            }
        }

        // Display knowledge insights
        if (namedArgs.showKnowledgeInsights) {
            try {
                const insights = websiteCollection.getKnowledgeInsights();
                context.printer.writeLine(`\n🧠 Knowledge Insights:`);
                context.printer.writeLine(
                    `  Sites with knowledge: ${insights.sitesWithKnowledge}/${insights.totalSites} (${((insights.sitesWithKnowledge / insights.totalSites) * 100).toFixed(1)}%)`,
                );
                context.printer.writeLine(
                    `  Average knowledge richness: ${insights.averageKnowledgeRichness.toFixed(1)}`,
                );

                // Show top entities
                if (insights.topEntities.size > 0) {
                    context.printer.writeLine(`\n🏷️  Top Knowledge Entities:`);
                    const topEntities = Array.from(
                        insights.topEntities.entries(),
                    )
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, limit);
                    topEntities.forEach(([entity, count], index) => {
                        context.printer.writeLine(
                            `  ${index + 1}. ${entity}: ${count} occurrences`,
                        );
                    });
                }

                // Show top topics
                if (insights.topTopics.size > 0) {
                    context.printer.writeLine(`\n📚 Top Knowledge Topics:`);
                    const topTopics = Array.from(insights.topTopics.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, limit);
                    topTopics.forEach(([topic, count], index) => {
                        context.printer.writeLine(
                            `  ${index + 1}. ${topic}: ${count} mentions`,
                        );
                    });
                }

                // Show action types from knowledge
                if (insights.actionTypes.size > 0) {
                    context.printer.writeLine(
                        `\n🎯 Knowledge-Enhanced Action Types:`,
                    );
                    const topActions = Array.from(
                        insights.actionTypes.entries(),
                    )
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5);
                    topActions.forEach(([actionType, count]) => {
                        context.printer.writeLine(
                            `  ${actionType}: ${count} actions`,
                        );
                    });
                }
            } catch (insightsError) {
                context.printer.writeLine(
                    `\n⚠️  Could not load knowledge insights: ${insightsError}`,
                );
            }
        }
    }

    // Helper function to write website search results without content (filtered metadata)
    function writeWebsiteSearchResultWithoutContent(
        conversation: kp.IConversation,
        searchResult: kp.ConversationSearchResult | undefined,
        maxToDisplay: number,
        distinct: boolean,
    ) {
        if (searchResult && kp.hasConversationResult(searchResult)) {
            // Show knowledge matches
            context.printer.writeKnowledgeSearchResults(
                conversation,
                searchResult.knowledgeMatches,
                maxToDisplay,
                distinct,
            );

            // Show messages with filtered metadata (no content)
            if (searchResult.messageMatches) {
                const matchesToDisplay = searchResult.messageMatches.slice(
                    0,
                    maxToDisplay,
                );
                context.printer.writeLine(
                    `Displaying ${matchesToDisplay.length} matches of total ${searchResult.messageMatches.length}`,
                );

                for (let i = 0; i < matchesToDisplay.length; ++i) {
                    const scoredMessage = matchesToDisplay[i];
                    const message = conversation.messages.get(
                        scoredMessage.messageOrdinal,
                    );

                    context.printer.writeInColor(
                        chalk.green,
                        `#${i + 1} / ${matchesToDisplay.length}: <${scoredMessage.messageOrdinal}> [${scoredMessage.score}]`,
                    );

                    if (message) {
                        // Write message with filtered metadata
                        writeMessageWithFilteredMetadata(message);
                    }
                    context.printer.writeLine();
                }
            }
        } else {
            context.printer.writeLine("No matches");
        }
    }

    // Helper function to write a message with filtered metadata (removes content fields)
    function writeMessageWithFilteredMetadata(message: kp.IMessage) {
        const prevColor = context.printer.setForeColor(chalk.cyan);
        try {
            context.printer.writeNameValue("Timestamp", message.timestamp);
            if (message.tags && message.tags.length > 0) {
                context.printer.writeList(message.tags, {
                    type: "csv",
                    title: "Tags",
                });
            }

            // Filter out content-heavy fields from metadata
            const metadata = message.metadata as any;
            if (metadata) {
                const filteredMetadata: any = {};

                // Copy all metadata except content fields
                for (const [key, value] of Object.entries(metadata)) {
                    if (!isContentField(key)) {
                        filteredMetadata[key] = value;
                    }
                }

                context.printer.write("Metadata: ").writeJson(filteredMetadata);
            }
        } finally {
            context.printer.setForeColor(prevColor);
        }

        // Don't write text chunks when content is filtered - they contain the page content
        // Text chunks are suppressed to keep output clean when --includeContent false

        context.printer.writeLine();
    }

    // Helper function to identify content fields that should be filtered out
    function isContentField(fieldName: string): boolean {
        const contentFields = [
            "pageContent",
            "mainContent",
            "metaTags",
            "structuredData",
            "detectedActions",
            "extractedActions",
        ];
        return contentFields.includes(fieldName);
    }

    // Helper function to write website search results with optional content
    function writeWebsiteSearchResultWithContent(
        conversation: kp.IConversation,
        searchResult: kp.ConversationSearchResult | undefined,
        maxToDisplay: number,
        distinct: boolean,
    ) {
        if (searchResult && kp.hasConversationResult(searchResult)) {
            // Show knowledge matches
            context.printer.writeKnowledgeSearchResults(
                conversation,
                searchResult.knowledgeMatches,
                maxToDisplay,
                distinct,
            );

            // Show messages with enhanced content display
            if (searchResult.messageMatches) {
                const matchesToDisplay = searchResult.messageMatches.slice(
                    0,
                    maxToDisplay,
                );
                context.printer.writeLine(
                    `Displaying ${matchesToDisplay.length} matches of total ${searchResult.messageMatches.length}`,
                );

                for (let i = 0; i < matchesToDisplay.length; ++i) {
                    const scoredMessage = matchesToDisplay[i];
                    const message = conversation.messages.get(
                        scoredMessage.messageOrdinal,
                    );

                    context.printer.writeInColor(
                        chalk.green,
                        `#${i + 1} / ${matchesToDisplay.length}: <${scoredMessage.messageOrdinal}> [${scoredMessage.score}]`,
                    );

                    if (message) {
                        // Standard message display
                        context.printer.writeMessage(message);

                        // Add enhanced content display for websites
                        const metadata = message.metadata as any; // Cast to access website-specific metadata
                        if (metadata && metadata.pageContent) {
                            context.printer.writeLine();
                            context.printer.writeInColor(
                                chalk.yellow,
                                "📄 Page Content:",
                            );

                            if (metadata.pageContent.title) {
                                context.printer.writeLine(
                                    `Title: ${metadata.pageContent.title}`,
                                );
                            }

                            if (
                                metadata.pageContent.headings &&
                                metadata.pageContent.headings.length > 0
                            ) {
                                context.printer.writeLine(
                                    `Headings: ${metadata.pageContent.headings.slice(0, 3).join(" | ")}${metadata.pageContent.headings.length > 3 ? "..." : ""}`,
                                );
                            }

                            if (metadata.pageContent.mainContent) {
                                const truncatedContent =
                                    metadata.pageContent.mainContent.length >
                                    300
                                        ? metadata.pageContent.mainContent.substring(
                                              0,
                                              300,
                                          ) + "..."
                                        : metadata.pageContent.mainContent;
                                context.printer.writeLine(
                                    `Content: ${truncatedContent}`,
                                );
                            }

                            if (metadata.pageContent.wordCount) {
                                context.printer.writeLine(
                                    `Word Count: ${metadata.pageContent.wordCount}`,
                                );
                            }

                            // Show detected actions if available
                            if (
                                metadata.detectedActions &&
                                metadata.detectedActions.length > 0
                            ) {
                                context.printer.writeInColor(
                                    chalk.magenta,
                                    "🎯 Available Actions:",
                                );
                                const highConfActions =
                                    metadata.detectedActions.filter(
                                        (a: DetectedAction) =>
                                            a.confidence > 0.7,
                                    );
                                if (highConfActions.length > 0) {
                                    const actionSummary = highConfActions
                                        .map(
                                            (a: DetectedAction) =>
                                                `${a.actionType.replace("Action", "")} (${(a.confidence * 100).toFixed(0)}%)`,
                                        )
                                        .join(", ");
                                    context.printer.writeLine(
                                        `${actionSummary}`,
                                    );
                                }
                            }
                        }
                    }
                    context.printer.writeLine();
                }
            }
        } else {
            context.printer.writeLine("No matches");
        }
    }

    // Helper function to extract topics from text
    function extractTopicsFromText(text: string): string[] {
        const commonWords = new Set([
            "the",
            "and",
            "or",
            "but",
            "in",
            "on",
            "at",
            "to",
            "for",
            "of",
            "with",
            "by",
            "how",
            "what",
            "when",
            "where",
            "why",
            "which",
            "who",
            "that",
            "this",
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "have",
            "has",
            "had",
            "do",
            "does",
            "did",
            "will",
            "would",
            "could",
            "should",
            "can",
            "may",
            "might",
            "must",
            "a",
            "an",
        ]);

        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .split(/\s+/)
            .filter((word) => word.length > 3 && !commonWords.has(word))
            .filter((word) => /^[a-zA-Z]+$/.test(word)); // Only alphabetic words
    }

    function websiteSearchDef(): CommandMetadata {
        return {
            description:
                "Search website memory using enhanced search capabilities with multiple modes",
            args: {
                query: arg("Natural language search query"),
            },
            options: {
                maxToDisplay: argNum("Maximum results to display", 10),
                showUrls: argBool("Show full URLs", true),
                includeContent: argBool(
                    "Include page content in response items",
                    false,
                ),
                debug: argBool("Show debug information", false),
                mode: arg(
                    "Search mode: auto | hybrid | entity | topic | semantic",
                    "auto",
                ),
                showInsights: argBool("Show knowledge insights", false),
                includeEntities: argBool("Include entity information", false),
            },
        };
    }
    commands.kpWebsiteSearch.metadata = websiteSearchDef();
    async function websiteSearch(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) {
            return;
        }

        if (
            !kpContext.conversation ||
            kpContext.conversation !== websiteCollection
        ) {
            context.printer.writeError(
                "Website memory not loaded as conversation. Please load with kpWebsiteLoad first.",
            );
            return;
        }

        const namedArgs = parseNamedArguments(args, websiteSearchDef());
        const query = namedArgs.query;
        const searchMode = namedArgs.mode || "auto";

        context.printer.writeLine(
            `🔍 Searching website memory: "${query}" (mode: ${searchMode})`,
        );
        context.printer.writeLine("=".repeat(60));

        try {
            let results: any[] = [];
            let usedMethod = "semantic";

            // Try enhanced search methods based on mode selection
            if (
                searchMode === "hybrid" ||
                (searchMode === "auto" && !query.includes(" "))
            ) {
                try {
                    const hybridResults =
                        await websiteCollection.hybridSearch(query);
                    if (hybridResults.length > 0) {
                        results = hybridResults.map((result, index) => ({
                            messageOrdinal: index, // Use index since WebsiteDocPart doesn't have messageOrdinal
                            score: result.relevanceScore,
                            website: result.website,
                        }));
                        usedMethod = "hybrid";
                        context.printer.writeLine(
                            `✅ Found ${results.length} results using hybrid search`,
                        );
                    }
                } catch (error) {
                    context.printer.writeLine(
                        `⚠️  Hybrid search failed: ${error}, falling back...`,
                    );
                }
            }

            if (
                results.length === 0 &&
                (searchMode === "entity" ||
                    (searchMode === "auto" && /^[A-Z]/.test(query)))
            ) {
                try {
                    const entityResults =
                        await websiteCollection.searchByEntities([query]);
                    if (entityResults.length > 0) {
                        results = entityResults.map((result, index) => ({
                            messageOrdinal: index, // Use index since WebsiteDocPart doesn't have messageOrdinal
                            score: 0.8,
                            website: result,
                        }));
                        usedMethod = "entity";
                        context.printer.writeLine(
                            `✅ Found ${results.length} results using entity search`,
                        );
                    }
                } catch (error) {
                    context.printer.writeLine(
                        `⚠️  Entity search failed: ${error}, falling back...`,
                    );
                }
            }

            if (
                results.length === 0 &&
                (searchMode === "topic" || searchMode === "auto")
            ) {
                try {
                    const topicResults = await websiteCollection.searchByTopics(
                        [query],
                    );
                    if (topicResults.length > 0) {
                        results = topicResults.map((result, index) => ({
                            messageOrdinal: index, // Use index since WebsiteDocPart doesn't have messageOrdinal
                            score: 0.7,
                            website: result,
                        }));
                        usedMethod = "topic";
                        context.printer.writeLine(
                            `✅ Found ${results.length} results using topic search`,
                        );
                    }
                } catch (error) {
                    context.printer.writeLine(
                        `⚠️  Topic search failed: ${error}, falling back...`,
                    );
                }
            }

            // Display enhanced search results if found
            if (results.length > 0) {
                context.printer.writeLine(
                    `\n📊 Search Method: ${usedMethod.toUpperCase()}`,
                );
                const limitedResults = results.slice(0, namedArgs.maxToDisplay);

                for (let i = 0; i < limitedResults.length; i++) {
                    const result = limitedResults[i];

                    context.printer.writeInColor(
                        chalk.green,
                        `#${i + 1} / ${limitedResults.length}: <${result.messageOrdinal}> [${result.score.toFixed(3)}]`,
                    );

                    if (namedArgs.includeContent) {
                        context.printer.writeMessage(result.website);
                    } else {
                        writeMessageWithFilteredMetadata(result.website);
                    }

                    context.printer.writeLine();
                }

                // Show knowledge insights if requested
                if (namedArgs.showInsights) {
                    try {
                        const insights =
                            websiteCollection.getKnowledgeInsights();
                        context.printer.writeLine(`\n📈 Knowledge Insights:`);
                        context.printer.writeLine(
                            `   Sites with knowledge: ${insights.sitesWithKnowledge}/${insights.totalSites}`,
                        );
                        context.printer.writeLine(
                            `   Average knowledge richness: ${insights.averageKnowledgeRichness.toFixed(1)}`,
                        );

                        if (insights.topEntities.size > 0) {
                            const topEntities = Array.from(
                                insights.topEntities.entries(),
                            )
                                .sort((a, b) => b[1] - a[1])
                                .slice(0, 5);
                            context.printer.writeLine(
                                `   Top entities: ${topEntities.map(([entity, count]) => `${entity} (${count})`).join(", ")}`,
                            );
                        }
                    } catch (insightsError) {
                        context.printer.writeLine(
                            `⚠️  Could not load knowledge insights: ${insightsError}`,
                        );
                    }
                }
                return;
            }

            // Fallback to semantic search if no enhanced search results
            context.printer.writeLine(
                `🔄 No enhanced search results found, using semantic search...`,
            );

            // Use existing semantic search implementation
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

            // Display semantic search results
            for (let i = 0; i < searchResults.data.length; ++i) {
                const searchQueryExpr = debugContext.searchQueryExpr![i];
                const result = searchResults.data[i];

                if (!namedArgs.debug) {
                    for (const selectExpr of searchQueryExpr.selectExpressions) {
                        context.printer.writeSelectExpr(selectExpr, false);
                    }
                }

                context.printer.writeLine("####");
                context.printer.writeInColor(
                    chalk.cyan,
                    searchQueryExpr.rawQuery!,
                );
                context.printer.writeLine("####");

                if (namedArgs.includeContent) {
                    writeWebsiteSearchResultWithContent(
                        kpContext.conversation!,
                        result,
                        namedArgs.maxToDisplay,
                        true,
                    );
                } else {
                    writeWebsiteSearchResultWithoutContent(
                        kpContext.conversation!,
                        result,
                        namedArgs.maxToDisplay,
                        true,
                    );
                }
            }
        } catch (error) {
            context.printer.writeError(`Search failed: ${error}`);
        }
    }

    function websiteAnalyzeContentDef(): CommandMetadata {
        return {
            description: "Analyze content of specific URLs",
            args: {
                url: arg("URL to analyze"),
            },
            options: {
                mode: arg("Analysis mode: content | actions | full", "content"),
                addToMemory: argBool("Add to website memory", false),
                showContent: argBool("Show extracted content", false),
            },
        };
    }
    commands.kpWebsiteAnalyzeContent.metadata = websiteAnalyzeContentDef();
    async function websiteAnalyzeContent(args: string[]) {
        const namedArgs = parseNamedArguments(args, websiteAnalyzeContentDef());

        const extractor = new website.ContentExtractor();
        try {
            context.printer.writeLine(`🔍 Analyzing content: ${namedArgs.url}`);
            const analysis = await extractor.extractFromUrl(
                namedArgs.url,
                namedArgs.mode as any,
            );

            if (!analysis.success) {
                context.printer.writeError(
                    `Analysis failed: ${analysis.error}`,
                );
                return;
            }

            // Display analysis results
            context.printer.writeLine(`\n📊 Content Analysis Results:`);
            context.printer.writeLine(`Success: ${analysis.success}`);
            context.printer.writeLine(
                `Extraction Time: ${analysis.extractionTime}ms`,
            );

            if (analysis.pageContent) {
                context.printer.writeLine(
                    `Title: ${analysis.pageContent.title || "N/A"}`,
                );
                context.printer.writeLine(
                    `Word Count: ${analysis.pageContent.wordCount || 0}`,
                );
                context.printer.writeLine(
                    `Reading Time: ${analysis.pageContent.readingTime || 0} minutes`,
                );

                if (analysis.pageContent.headings?.length) {
                    context.printer.writeLine(
                        `Headings (${analysis.pageContent.headings.length}): ${analysis.pageContent.headings.slice(0, 5).join(", ")}${analysis.pageContent.headings.length > 5 ? "..." : ""}`,
                    );
                }

                if (analysis.pageContent.codeBlocks?.length) {
                    context.printer.writeLine(
                        `Code Blocks: ${analysis.pageContent.codeBlocks.length} found`,
                    );
                }
            }

            if (analysis.metaTags?.keywords?.length) {
                context.printer.writeLine(
                    `Keywords: ${analysis.metaTags.keywords.join(", ")}`,
                );
            }

            if (analysis.structuredData?.schemaType) {
                context.printer.writeLine(
                    `Schema Type: ${analysis.structuredData.schemaType}`,
                );
            }

            if (analysis.actions?.length) {
                context.printer.writeLine(
                    `Actions Found: ${analysis.actions.length} (forms, buttons, links)`,
                );
            }

            if (namedArgs.showContent && analysis.pageContent?.mainContent) {
                context.printer.writeLine(
                    `\n📄 Main Content (first 500 chars):`,
                );
                context.printer.writeLine(
                    analysis.pageContent.mainContent.substring(0, 500) + "...",
                );
            }

            if (namedArgs.addToMemory) {
                const websiteCollection = ensureMemoryLoaded();
                if (websiteCollection) {
                    // Create enhanced website and add to memory
                    const visitInfo: website.WebsiteVisitInfo = {
                        url: namedArgs.url,
                        source: "bookmark",
                        visitDate: new Date().toISOString(),
                    };

                    // Add optional properties only if they exist
                    if (analysis.pageContent?.title)
                        visitInfo.title = analysis.pageContent.title;
                    if (analysis.pageContent)
                        visitInfo.pageContent = analysis.pageContent;
                    if (analysis.metaTags)
                        visitInfo.metaTags = analysis.metaTags;
                    if (analysis.structuredData)
                        visitInfo.structuredData = analysis.structuredData;
                    if (analysis.actions)
                        visitInfo.extractedActions = analysis.actions;

                    const websiteMessage =
                        website.importWebsiteVisit(visitInfo);
                    const result = await addMessagesToCollection(
                        websiteCollection,
                        [websiteMessage],
                        true,
                    );

                    if (result.success) {
                        context.printer.writeLine(
                            `✅ Added to website memory with enhanced content`,
                        );
                    } else {
                        context.printer.writeError(
                            `Failed to add to memory: ${result.message}`,
                        );
                    }
                }
            }
        } catch (error) {
            context.printer.writeError(`Content analysis failed: ${error}`);
        }
    }

    function websiteTestEnhancedDef(): CommandMetadata {
        return {
            description:
                "Test enhanced natural language queries with temporal and frequency intelligence",
            args: {
                query: arg("Natural language query to test"),
            },
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
        context.printer.writeLine("=".repeat(60));

        try {
            // Use the new LLM-based search with enhanced website context
            if (kpContext.conversation === websiteCollection) {
                await websiteSearch([query, "--debug", "true"]);

                context.printer.writeLine();
                context.printer.writeInColor(
                    chalk.green,
                    "🧪 Enhanced test completed successfully!",
                );
            } else {
                context.printer.writeError(
                    "Website memory not loaded as conversation. Use kpWebsiteLoad first.",
                );
            }
        } catch (error) {
            context.printer.writeError(`Enhanced query failed: ${error}`);
        }
    }

    async function websiteClose() {
        closeWebsite();
    }

    // NEW: Action Analysis Commands

    function websiteAnalyzeActionsDef(): CommandMetadata {
        return {
            description: "Analyze actions available on specific URLs",
            args: {
                url: arg("URL to analyze for actions"),
            },
            options: {
                confidence: arg("Minimum confidence threshold", "0.5"),
                showDetails: argBool("Show detailed action information", false),
            },
        };
    }
    commands.kpWebsiteAnalyzeActions.metadata = websiteAnalyzeActionsDef();

    async function websiteAnalyzeActions(args: string[]) {
        const namedArgs = parseNamedArguments(args, websiteAnalyzeActionsDef());

        try {
            context.printer.writeLine(`🎯 Analyzing actions: ${namedArgs.url}`);

            const actionExtractor = new website.ActionExtractor({
                minConfidence: parseFloat(namedArgs.confidence) || 0.5,
            });

            const actions = await actionExtractor.extractActionsFromUrl(
                namedArgs.url,
            );

            if (actions.length === 0) {
                context.printer.writeLine(
                    `❌ No actions found with confidence >= ${namedArgs.confidence}`,
                );
                return;
            }

            context.printer.writeLine(`\n🎯 Found ${actions.length} actions:`);

            // Group by action type
            const groupedActions = new Map<string, any[]>();
            actions.forEach((action) => {
                if (!groupedActions.has(action.actionType)) {
                    groupedActions.set(action.actionType, []);
                }
                groupedActions.get(action.actionType)!.push(action);
            });

            for (const [actionType, actionGroup] of groupedActions) {
                context.printer.writeLine(
                    `\n📋 ${actionType} (${actionGroup.length}):`,
                );

                actionGroup.forEach((action: DetectedAction) => {
                    const confidenceIcon =
                        action.confidence > 0.8
                            ? "🟢"
                            : action.confidence > 0.6
                              ? "🟡"
                              : "🔴";
                    context.printer.writeLine(
                        `   ${confidenceIcon} ${action.name} (${(action.confidence * 100).toFixed(0)}%)`,
                    );

                    if (namedArgs.showDetails) {
                        if (action.target) {
                            context.printer.writeLine(
                                `      Target: ${action.target.type} - ${action.target.name || "N/A"}`,
                            );
                        }
                        if (action.selectors && action.selectors.length > 0) {
                            context.printer.writeLine(
                                `      Selectors: ${action.selectors.slice(0, 2).join(", ")}`,
                            );
                        }
                        if (action.url && action.url !== namedArgs.url) {
                            context.printer.writeLine(
                                `      Action URL: ${action.url}`,
                            );
                        }
                    }
                });
            }
        } catch (error) {
            context.printer.writeError(`Action analysis failed: ${error}`);
        }
    }

    function websiteListActionsDef(): CommandMetadata {
        return {
            description: "List all sites with specific action types",
            options: {
                actionType: arg(
                    "Filter by action type (BuyAction, DownloadAction, etc.)",
                ),
                confidence: arg("Minimum confidence threshold", "0.7"),
                limit: arg("Maximum results to show", "10"),
            },
        };
    }
    commands.kpWebsiteListActions.metadata = websiteListActionsDef();

    async function websiteListActions(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) return;

        const namedArgs = parseNamedArguments(args, websiteListActionsDef());
        const minConfidence = parseFloat(namedArgs.confidence) || 0.7;
        const limit = parseInt(namedArgs.limit) || 10;

        context.printer.writeLine(
            `🎯 Finding sites with actions (confidence >= ${minConfidence}):`,
        );

        const sitesWithActions: any[] = [];

        for (let i = 0; i < websiteCollection.messages.length; i++) {
            const website = websiteCollection.messages.get(i);
            const metadata = website?.metadata as website.WebsiteDocPartMeta;
            if (!metadata.detectedActions) continue;

            const relevantActions = metadata.detectedActions.filter(
                (action) => {
                    const meetsConfidence = action.confidence >= minConfidence;
                    const meetsType =
                        !namedArgs.actionType ||
                        action.actionType === namedArgs.actionType;
                    return meetsConfidence && meetsType;
                },
            );

            if (relevantActions.length > 0) {
                sitesWithActions.push({
                    url: metadata.url,
                    title: metadata.title,
                    domain: metadata.domain,
                    actions: relevantActions,
                });
            }
        }

        if (sitesWithActions.length === 0) {
            context.printer.writeLine(
                `❌ No sites found with matching actions`,
            );
            return;
        }

        context.printer.writeLine(
            `\n📊 Found ${sitesWithActions.length} sites with actions:\n`,
        );

        sitesWithActions
            .sort((a, b) => b.actions.length - a.actions.length)
            .slice(0, limit)
            .forEach((site, index) => {
                context.printer.writeLine(
                    `${index + 1}. **${site.title || site.domain}**`,
                );
                context.printer.writeLine(`   URL: ${site.url}`);

                const actionSummary = site.actions
                    .map(
                        (a: DetectedAction) =>
                            `${a.actionType.replace("Action", "")} (${(a.confidence * 100).toFixed(0)}%)`,
                    )
                    .join(", ");
                context.printer.writeLine(`   Actions: ${actionSummary}`);

                // Show high-confidence actions
                const highConfActions = site.actions.filter(
                    (a: DetectedAction) => a.confidence > 0.8,
                );
                if (highConfActions.length > 0) {
                    context.printer.writeLine(
                        `   High-confidence: ${highConfActions.map((a: DetectedAction) => a.name).join(", ")}`,
                    );
                }

                context.printer.writeLine("");
            });
    }

    function calculateActionStats(websites: website.Website[]) {
        let sitesWithActions = 0;
        let totalActions = 0;
        let highConfidenceActions = 0;
        const actionTypesSet = new Set<string>();

        websites.forEach((w) => {
            if (
                w.metadata.detectedActions &&
                w.metadata.detectedActions.length > 0
            ) {
                sitesWithActions++;
                totalActions += w.metadata.detectedActions.length;

                w.metadata.detectedActions.forEach((action) => {
                    actionTypesSet.add(action.actionType.replace("Action", ""));
                    if (action.confidence > 0.8) {
                        highConfidenceActions++;
                    }
                });
            }
        });

        return {
            sitesWithActions,
            totalActions,
            highConfidenceActions,
            actionTypes: Array.from(actionTypesSet),
        };
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

    // Enhanced Knowledge Search Commands

    function websiteSearchEntitiesDef(): CommandMetadata {
        return {
            description: "Search websites by knowledge entities",
            args: {
                entities: arg("Comma-separated list of entities to search for"),
            },
            options: {
                limit: argNum("Maximum results to show", 10),
            },
        };
    }
    commands.kpWebsiteSearchEntities.metadata = websiteSearchEntitiesDef();
    async function websiteSearchEntities(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) return;

        const namedArgs = parseNamedArguments(args, websiteSearchEntitiesDef());
        const entities = namedArgs.entities
            .split(",")
            .map((e: string) => e.trim());

        try {
            const results = await websiteCollection.searchByEntities(entities);

            if (results.length === 0) {
                context.printer.writeLine(
                    "No websites found with those entities.",
                );
                return;
            }

            context.printer.writeLine(
                `Found ${results.length} websites matching entities: ${entities.join(", ")}`,
            );

            const limit = Math.min(results.length, namedArgs.limit || 10);
            for (let i = 0; i < limit; i++) {
                const result = results[i];
                const metadata = result.metadata as website.WebsiteDocPartMeta;
                context.printer.writeLine(
                    `${i + 1}. ${metadata.title || metadata.url}`,
                );
                context.printer.writeLine(`   URL: ${metadata.url}`);
                context.printer.writeLine(`   Domain: ${metadata.domain}`);

                // Show matched entities
                const knowledge = result.getKnowledge();
                if (knowledge?.entities) {
                    const matchedEntities = knowledge.entities.filter(
                        (entity: any) =>
                            entities.some((searchEntity: string) =>
                                entity.name
                                    .toLowerCase()
                                    .includes(searchEntity.toLowerCase()),
                            ),
                    );
                    if (matchedEntities.length > 0) {
                        context.printer.writeLine(
                            `   Matched entities: ${matchedEntities.map((e) => e.name).join(", ")}`,
                        );
                    }
                }
                context.printer.writeLine();
            }
        } catch (error) {
            context.printer.writeError(`Error searching entities: ${error}`);
        }
    }

    function websiteSearchTopicsDef(): CommandMetadata {
        return {
            description: "Search websites by knowledge topics",
            args: {
                topics: arg("Comma-separated list of topics to search for"),
            },
            options: {
                limit: argNum("Maximum results to show", 10),
            },
        };
    }
    commands.kpWebsiteSearchTopics.metadata = websiteSearchTopicsDef();
    async function websiteSearchTopics(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) return;

        const namedArgs = parseNamedArguments(args, websiteSearchTopicsDef());
        const topics = namedArgs.topics.split(",").map((t: string) => t.trim());

        try {
            const results = await websiteCollection.searchByTopics(topics);

            if (results.length === 0) {
                context.printer.writeLine(
                    "No websites found with those topics.",
                );
                return;
            }

            context.printer.writeLine(
                `Found ${results.length} websites matching topics: ${topics.join(", ")}`,
            );

            const limit = Math.min(results.length, namedArgs.limit || 10);
            for (let i = 0; i < limit; i++) {
                const result = results[i];
                const metadata = result.metadata as website.WebsiteDocPartMeta;
                context.printer.writeLine(
                    `${i + 1}. ${metadata.title || metadata.url}`,
                );
                context.printer.writeLine(`   URL: ${metadata.url}`);
                context.printer.writeLine(`   Domain: ${metadata.domain}`);

                // Show matched topics
                const knowledge = result.getKnowledge();
                if (knowledge?.topics) {
                    const matchedTopics = knowledge.topics.filter(
                        (topic: string) =>
                            topics.some((searchTopic: string) =>
                                topic
                                    .toLowerCase()
                                    .includes(searchTopic.toLowerCase()),
                            ),
                    );
                    if (matchedTopics.length > 0) {
                        context.printer.writeLine(
                            `   Matched topics: ${matchedTopics.slice(0, 3).join(", ")}`,
                        );
                    }
                }
                context.printer.writeLine();
            }
        } catch (error) {
            context.printer.writeError(`Error searching topics: ${error}`);
        }
    }

    function websiteHybridSearchDef(): CommandMetadata {
        return {
            description:
                "Perform hybrid search across entities, topics, and content",
            args: {
                query: arg("Search query"),
            },
            options: {
                limit: argNum("Maximum results to show", 10),
                minScore: argNum("Minimum relevance score", 0.1),
            },
        };
    }
    commands.kpWebsiteHybridSearch.metadata = websiteHybridSearchDef();
    async function websiteHybridSearch(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) return;

        const namedArgs = parseNamedArguments(args, websiteHybridSearchDef());

        try {
            const results = await websiteCollection.hybridSearch(
                namedArgs.query,
            );

            const filteredResults = results.filter(
                (result) =>
                    result.relevanceScore >= (namedArgs.minScore || 0.1),
            );

            if (filteredResults.length === 0) {
                context.printer.writeLine(
                    `No websites found for query: "${namedArgs.query}"`,
                );
                return;
            }

            context.printer.writeLine(
                `Found ${filteredResults.length} websites for: "${namedArgs.query}"`,
            );

            const limit = Math.min(
                filteredResults.length,
                namedArgs.limit || 10,
            );
            for (let i = 0; i < limit; i++) {
                const result = filteredResults[i];
                const metadata = result.website
                    .metadata as website.WebsiteDocPartMeta;
                context.printer.writeLine(
                    `${i + 1}. [${result.relevanceScore.toFixed(2)}] ${metadata.title || metadata.url}`,
                );
                context.printer.writeLine(`   URL: ${metadata.url}`);
                context.printer.writeLine(
                    `   Matched: ${result.matchedElements.join(", ")}`,
                );

                if (result.knowledgeContext) {
                    context.printer.writeLine(
                        `   Knowledge: ${result.knowledgeContext.entityCount} entities, ${result.knowledgeContext.topicCount} topics`,
                    );
                }
                context.printer.writeLine();
            }
        } catch (error) {
            context.printer.writeError(`Error in hybrid search: ${error}`);
        }
    }

    function websiteKnowledgeInsightsDef(): CommandMetadata {
        return {
            description: "Show knowledge analytics and insights",
            options: {
                timeframe: arg("Timeframe for analysis", "all"),
                showGrowth: argBool("Show knowledge growth over time", false),
            },
        };
    }
    commands.kpWebsiteKnowledgeInsights.metadata =
        websiteKnowledgeInsightsDef();
    async function websiteKnowledgeInsights(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) return;

        const namedArgs = parseNamedArguments(
            args,
            websiteKnowledgeInsightsDef(),
        );

        try {
            const insights = websiteCollection.getKnowledgeInsights(
                namedArgs.timeframe,
            );

            context.printer.writeLine(
                `🧠 Knowledge Insights (${insights.timeframe}):`,
            );
            context.printer.writeLine(`${"=".repeat(50)}`);
            context.printer.writeLine(`📊 Overview:`);
            context.printer.writeLine(`  Total sites: ${insights.totalSites}`);
            context.printer.writeLine(
                `  Sites with knowledge: ${insights.sitesWithKnowledge} (${((insights.sitesWithKnowledge / insights.totalSites) * 100).toFixed(1)}%)`,
            );
            context.printer.writeLine(
                `  Average knowledge richness: ${insights.averageKnowledgeRichness.toFixed(1)}`,
            );

            // Top entities
            if (insights.topEntities.size > 0) {
                context.printer.writeLine(`\n🏷️  Top Entities:`);
                const topEntities = Array.from(insights.topEntities.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10);
                topEntities.forEach(([entity, count], index) => {
                    context.printer.writeLine(
                        `  ${index + 1}. ${entity}: ${count} occurrences`,
                    );
                });
            }

            // Top topics
            if (insights.topTopics.size > 0) {
                context.printer.writeLine(`\n📚 Top Topics:`);
                const topTopics = Array.from(insights.topTopics.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10);
                topTopics.forEach(([topic, count], index) => {
                    context.printer.writeLine(
                        `  ${index + 1}. ${topic}: ${count} mentions`,
                    );
                });
            }

            // Action types
            if (insights.actionTypes.size > 0) {
                context.printer.writeLine(`\n🎯 Action Types:`);
                const topActions = Array.from(insights.actionTypes.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5);
                topActions.forEach(([actionType, count]) => {
                    context.printer.writeLine(
                        `  ${actionType}: ${count} actions`,
                    );
                });
            }

            // Knowledge growth if requested
            if (namedArgs.showGrowth) {
                const growthInsights =
                    websiteCollection.getKnowledgeGrowthInsights();
                context.printer.writeLine(`\n📈 Knowledge Growth:`);

                if (growthInsights.knowledgeRichnessTrend.length > 0) {
                    context.printer.writeLine(`  Recent knowledge trend:`);
                    growthInsights.knowledgeRichnessTrend
                        .slice(-5)
                        .forEach((trend) => {
                            context.printer.writeLine(
                                `    ${trend.date}: ${trend.richness} total knowledge points`,
                            );
                        });
                }
            }
        } catch (error) {
            context.printer.writeError(
                `Error getting knowledge insights: ${error}`,
            );
        }
    }

    return;
    return;
}
