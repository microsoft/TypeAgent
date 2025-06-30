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
    commands.kpWebsiteAnalyzeContent = websiteAnalyzeContent;
    commands.kpWebsiteTestEnhanced = websiteTestEnhanced;
    
    // NEW: Action detection commands
    commands.kpWebsiteAnalyzeActions = websiteAnalyzeActions;
    commands.kpWebsiteListActions = websiteListActions;

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
                extractionMode: arg("Extraction mode: basic | content | actions | full", "content"),
                maxConcurrent: argNum("Max concurrent extractions", 3),
                contentTimeout: argNum("Content extraction timeout (ms)", 10000),
                
                // NEW: Action detection options
                enableActionDetection: argBool("Enable action detection", true),
                actionConfidence: argNum("Minimum action confidence threshold", 0.7)
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
            
            // Enhanced import with content extraction
            if (namedArgs.extractContent) {
                context.printer.writeLine(`🔍 Extracting content in ${namedArgs.extractionMode} mode...`);
                context.printer.writeLine(`⚙️  Max concurrent: ${namedArgs.maxConcurrent}, Timeout: ${namedArgs.contentTimeout}ms`);
                
                if (namedArgs.enableActionDetection && (namedArgs.extractionMode === 'actions' || namedArgs.extractionMode === 'full')) {
                    context.printer.writeLine(`🎯 Action detection enabled (min confidence: ${namedArgs.actionConfidence})`);
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
                        actionConfidence: namedArgs.actionConfidence
                    },
                    (current, total, item) => {
                        // writeProgress might only expect one argument  
                        context.printer.writeLine(`Processing ${current}/${total}: ${item}`);
                    }
                );
                
                context.printer.writeLine(`✅ Content extraction completed for ${websites.length} bookmarks`);
                
                // Count websites with enhanced content
                const enhancedCount = websites.filter(w => w.metadata.pageContent).length;
                if (enhancedCount > 0) {
                    context.printer.writeLine(`📄 ${enhancedCount} bookmarks now have enhanced content`);
                }
                
                // Report action detection results
                if (namedArgs.enableActionDetection && (namedArgs.extractionMode === 'actions' || namedArgs.extractionMode === 'full')) {
                    const actionStats = calculateActionStats(websites);
                    if (actionStats.sitesWithActions > 0) {
                        context.printer.writeLine(`✅ Action detection completed:`);
                        context.printer.writeLine(`   • ${actionStats.sitesWithActions} sites have detectable actions`);
                        context.printer.writeLine(`   • ${actionStats.totalActions} total actions found`);
                        context.printer.writeLine(`   • ${actionStats.actionTypes.join(', ')} action types detected`);
                        context.printer.writeLine(`   • ${actionStats.highConfidenceActions} high-confidence actions (>80%)`);
                    } else {
                        context.printer.writeLine(`ℹ️  No high-confidence actions detected in imported bookmarks`);
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

    function websiteAnalyzeContentDef(): CommandMetadata {
        return {
            description: "Analyze content of specific URLs", 
            args: {
                url: arg("URL to analyze")
            },
            options: {
                mode: arg("Analysis mode: content | actions | full", "content"),
                addToMemory: argBool("Add to website memory", false),
                showContent: argBool("Show extracted content", false)
            }
        };
    }
    commands.kpWebsiteAnalyzeContent.metadata = websiteAnalyzeContentDef();
    async function websiteAnalyzeContent(args: string[]) {
        const namedArgs = parseNamedArguments(args, websiteAnalyzeContentDef());
        
        const extractor = new website.ContentExtractor();
        try {
            context.printer.writeLine(`🔍 Analyzing content: ${namedArgs.url}`);
            const analysis = await extractor.extractFromUrl(namedArgs.url, namedArgs.mode as any);
            
            if (!analysis.success) {
                context.printer.writeError(`Analysis failed: ${analysis.error}`);
                return;
            }
            
            // Display analysis results
            context.printer.writeLine(`\n📊 Content Analysis Results:`);
            context.printer.writeLine(`Success: ${analysis.success}`);
            context.printer.writeLine(`Extraction Time: ${analysis.extractionTime}ms`);
            
            if (analysis.pageContent) {
                context.printer.writeLine(`Title: ${analysis.pageContent.title || 'N/A'}`);
                context.printer.writeLine(`Word Count: ${analysis.pageContent.wordCount || 0}`);
                context.printer.writeLine(`Reading Time: ${analysis.pageContent.readingTime || 0} minutes`);
                
                if (analysis.pageContent.headings?.length) {
                    context.printer.writeLine(`Headings (${analysis.pageContent.headings.length}): ${analysis.pageContent.headings.slice(0, 5).join(', ')}${analysis.pageContent.headings.length > 5 ? '...' : ''}`);
                }
                
                if (analysis.pageContent.codeBlocks?.length) {
                    context.printer.writeLine(`Code Blocks: ${analysis.pageContent.codeBlocks.length} found`);
                }
            }
            
            if (analysis.metaTags?.keywords?.length) {
                context.printer.writeLine(`Keywords: ${analysis.metaTags.keywords.join(', ')}`);
            }
            
            if (analysis.structuredData?.schemaType) {
                context.printer.writeLine(`Schema Type: ${analysis.structuredData.schemaType}`);
            }
            
            if (analysis.actions?.length) {
                context.printer.writeLine(`Actions Found: ${analysis.actions.length} (forms, buttons, links)`);
            }
            
            if (namedArgs.showContent && analysis.pageContent?.mainContent) {
                context.printer.writeLine(`\n📄 Main Content (first 500 chars):`);
                context.printer.writeLine(analysis.pageContent.mainContent.substring(0, 500) + '...');
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
                    if (analysis.pageContent?.title) visitInfo.title = analysis.pageContent.title;
                    if (analysis.pageContent) visitInfo.pageContent = analysis.pageContent;
                    if (analysis.metaTags) visitInfo.metaTags = analysis.metaTags;
                    if (analysis.structuredData) visitInfo.structuredData = analysis.structuredData;
                    if (analysis.actions) visitInfo.extractedActions = analysis.actions;
                    
                    const websiteMessage = website.importWebsiteVisit(visitInfo);
                    const result = await addMessagesToCollection(websiteCollection, [websiteMessage], true);
                    
                    if (result.success) {
                        context.printer.writeLine(`✅ Added to website memory with enhanced content`);
                    } else {
                        context.printer.writeError(`Failed to add to memory: ${result.message}`);
                    }
                }
            }
            
        } catch (error) {
            context.printer.writeError(`Content analysis failed: ${error}`);
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

    // NEW: Action Analysis Commands
    
    function websiteAnalyzeActionsDef(): CommandMetadata {
        return {
            description: "Analyze actions available on specific URLs",
            args: {
                url: arg("URL to analyze for actions")
            },
            options: {
                confidence: arg("Minimum confidence threshold", "0.5"),
                showDetails: argBool("Show detailed action information", false)
            }
        };
    }
    commands.kpWebsiteAnalyzeActions.metadata = websiteAnalyzeActionsDef();
    
    async function websiteAnalyzeActions(args: string[]) {
        const namedArgs = parseNamedArguments(args, websiteAnalyzeActionsDef());
        
        try {
            context.printer.writeLine(`🎯 Analyzing actions: ${namedArgs.url}`);
            
            const actionExtractor = new website.ActionExtractor({
                minConfidence: parseFloat(namedArgs.confidence) || 0.5
            });
            
            const actions = await actionExtractor.extractActionsFromUrl(namedArgs.url);
            
            if (actions.length === 0) {
                context.printer.writeLine(`❌ No actions found with confidence >= ${namedArgs.confidence}`);
                return;
            }
            
            context.printer.writeLine(`\n🎯 Found ${actions.length} actions:`);
            
            // Group by action type
            const groupedActions = new Map<string, any[]>();
            actions.forEach(action => {
                if (!groupedActions.has(action.actionType)) {
                    groupedActions.set(action.actionType, []);
                }
                groupedActions.get(action.actionType)!.push(action);
            });
            
            for (const [actionType, actionGroup] of groupedActions) {
                context.printer.writeLine(`\n📋 ${actionType} (${actionGroup.length}):`);
                
                actionGroup.forEach(action => {
                    const confidenceIcon = action.confidence > 0.8 ? '🟢' : action.confidence > 0.6 ? '🟡' : '🔴';
                    context.printer.writeLine(`   ${confidenceIcon} ${action.name} (${(action.confidence * 100).toFixed(0)}%)`);
                    
                    if (namedArgs.showDetails) {
                        if (action.target) {
                            context.printer.writeLine(`      Target: ${action.target.type} - ${action.target.name || 'N/A'}`);
                        }
                        if (action.selectors && action.selectors.length > 0) {
                            context.printer.writeLine(`      Selectors: ${action.selectors.slice(0, 2).join(', ')}`);
                        }
                        if (action.url && action.url !== namedArgs.url) {
                            context.printer.writeLine(`      Action URL: ${action.url}`);
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
                actionType: arg("Filter by action type (BuyAction, DownloadAction, etc.)"),
                confidence: arg("Minimum confidence threshold", "0.7"),
                limit: arg("Maximum results to show", "10")
            }
        };
    }
    commands.kpWebsiteListActions.metadata = websiteListActionsDef();
    
    async function websiteListActions(args: string[]) {
        const websiteCollection = ensureMemoryLoaded();
        if (!websiteCollection) return;
        
        const namedArgs = parseNamedArguments(args, websiteListActionsDef());
        const minConfidence = parseFloat(namedArgs.confidence) || 0.7;
        const limit = parseInt(namedArgs.limit) || 10;
        
        context.printer.writeLine(`🎯 Finding sites with actions (confidence >= ${minConfidence}):`);
        
        const sitesWithActions: any[] = [];
        
        for (let i = 0; i < websiteCollection.messages.length; i++) {
            const website = websiteCollection.messages.get(i);
            if (!website?.metadata.detectedActions) continue;
            
            const relevantActions = website.metadata.detectedActions.filter(action => {
                const meetsConfidence = action.confidence >= minConfidence;
                const meetsType = !namedArgs.actionType || action.actionType === namedArgs.actionType;
                return meetsConfidence && meetsType;
            });
            
            if (relevantActions.length > 0) {
                sitesWithActions.push({
                    url: website.metadata.url,
                    title: website.metadata.title,
                    domain: website.metadata.domain,
                    actions: relevantActions
                });
            }
        }
        
        if (sitesWithActions.length === 0) {
            context.printer.writeLine(`❌ No sites found with matching actions`);
            return;
        }
        
        context.printer.writeLine(`\n📊 Found ${sitesWithActions.length} sites with actions:\n`);
        
        sitesWithActions
            .sort((a, b) => b.actions.length - a.actions.length)
            .slice(0, limit)
            .forEach((site, index) => {
                context.printer.writeLine(`${index + 1}. **${site.title || site.domain}**`);
                context.printer.writeLine(`   URL: ${site.url}`);
                
                const actionSummary = site.actions
                    .map(a => `${a.actionType.replace('Action', '')} (${(a.confidence * 100).toFixed(0)}%)`)
                    .join(', ');
                context.printer.writeLine(`   Actions: ${actionSummary}`);
                
                // Show high-confidence actions
                const highConfActions = site.actions.filter(a => a.confidence > 0.8);
                if (highConfActions.length > 0) {
                    context.printer.writeLine(`   High-confidence: ${highConfActions.map(a => a.name).join(', ')}`);
                }
                
                context.printer.writeLine('');
            });
    }

    function calculateActionStats(websites: website.Website[]) {
        let sitesWithActions = 0;
        let totalActions = 0;
        let highConfidenceActions = 0;
        const actionTypesSet = new Set<string>();
        
        websites.forEach(w => {
            if (w.metadata.detectedActions && w.metadata.detectedActions.length > 0) {
                sitesWithActions++;
                totalActions += w.metadata.detectedActions.length;
                
                w.metadata.detectedActions.forEach(action => {
                    actionTypesSet.add(action.actionType.replace('Action', ''));
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
            actionTypes: Array.from(actionTypesSet)
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

    return;
}
