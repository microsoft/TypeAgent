// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// =============================================
// Agent-side operations (forwarded via WebSocket)
// =============================================

export type BrowserAgentInvokeFunctions = {
    // Knowledge extraction
    extractKnowledgeFromPage(params: {
        url: string;
        title: string;
        htmlFragments: any[];
        extractEntities: boolean;
        extractRelationships: boolean;
        suggestQuestions: boolean;
        mode: string;
    }): Promise<any>;

    // Knowledge queries
    searchWebMemories(params: {
        query: string;
        generateAnswer?: boolean;
        includeRelatedEntities?: boolean;
        enableAdvancedSearch?: boolean;
        limit?: number;
        minScore?: number;
        searchScope?: string;
        metadata?: { url?: string };
        [key: string]: any;
    }): Promise<any>;

    queryKnowledge(params: {
        query: string;
        searchScope?: string;
        metadata?: { url?: string };
    }): Promise<any>;

    searchByEntities(params: {
        entities: string[];
        url?: string;
        maxResults?: number;
        searchScope?: string;
        includeMetadata?: boolean;
    }): Promise<any>;

    searchByTopics(params: {
        topics: string[];
        url?: string;
        maxResults?: number;
        searchScope?: string;
        includeMetadata?: boolean;
    }): Promise<any>;

    hybridSearch(params: {
        query: string;
        url?: string;
        maxResults?: number;
        searchScope?: string;
        includeMetadata?: boolean;
        combineStrategies?: boolean;
    }): Promise<any>;

    getHierarchicalTopics(params: {
        centerTopic?: string;
        includeRelationships?: boolean;
        maxDepth?: number;
        domain?: string;
    }): Promise<any>;

    getTopicImportanceLayer(params: {
        maxNodes?: number;
        minImportanceThreshold?: number;
    }): Promise<any>;

    getTopicViewportNeighborhood(params: {
        centerTopic: string;
        viewportTopicIds: string[];
        maxNodes?: number;
        maxDepth?: number;
    }): Promise<any>;

    getTopicMetrics(params: { topicId: string }): Promise<any>;

    getTopicDetails(params: { topicId: string }): Promise<any>;

    getEntityDetails(params: { entityName: string }): Promise<any>;

    getTopicTimelines(params: {
        topicNames: string[];
        maxTimelineEntries?: number;
        timeRange?: any;
        includeRelatedTopics?: boolean;
        neighborhoodDepth?: number;
    }): Promise<any>;

    discoverRelationships(params: {
        url: string;
        knowledge: any;
        maxResults?: number;
    }): Promise<any>;

    analyzeKnowledgeGaps(params: {
        url: string;
        knowledge: any;
        relatedContent?: any[];
    }): Promise<any>;

    // Knowledge graph
    getKnowledgeGraphStatus(params: {}): Promise<any>;
    buildKnowledgeGraph(params: any): Promise<any>;
    rebuildKnowledgeGraph(params: {}): Promise<any>;
    testMergeTopicHierarchies(params: {}): Promise<any>;
    mergeTopicHierarchies(params: {}): Promise<any>;
    getGlobalGraphLayoutData(params: any): Promise<any>;

    getEntityNeighborhood(params: {
        entityId: string;
        depth?: number;
        maxNodes?: number;
    }): Promise<any>;

    getEntityNeighborhoodLayoutData(params: {
        entityId: string;
        depth?: number;
        maxNodes?: number;
    }): Promise<any>;

    getGlobalImportanceLayer(params: {
        maxNodes?: number;
        includeConnectivity?: boolean;
    }): Promise<any>;

    getImportanceStatistics(params: {}): Promise<any>;

    getViewportBasedNeighborhood(params: {
        centerEntity?: string;
        viewportNodeNames?: string[];
        maxNodes?: number;
        importanceWeighting?: number;
        includeGlobalContext?: boolean;
        exploreFromAllViewportNodes?: boolean;
        minDepthFromViewport?: number;
    }): Promise<any>;

    // Index management
    indexWebPageContent(params: {
        url: string;
        title: string;
        htmlFragments?: any[];
        extractKnowledge?: boolean;
        timestamp?: string;
        quality?: string;
        textOnly?: boolean;
        mode?: string;
        extractedKnowledge?: any;
    }): Promise<any>;

    checkPageIndexStatus(params: { url: string }): Promise<any>;
    getPageIndexedKnowledge(params: { url: string }): Promise<any>;
    getKnowledgeIndexStats(params: { url?: string }): Promise<any>;

    // Import/export
    importWebsiteDataWithProgress(params: {
        source: string;
        type: string;
        limit?: number;
        days?: number;
        folder?: string;
        mode?: string;
        maxConcurrent?: number;
        contentTimeout?: number;
        importId: string;
        totalItems?: number;
        progressCallback?: boolean;
    }): Promise<any>;

    importHtmlFolder(params: {
        folderPath: string;
        options?: {
            mode?: string;
            preserveStructure?: boolean;
            recursive?: boolean;
            fileTypes?: string[];
            limit?: number;
            maxFileSize?: number;
            skipHidden?: boolean;
        };
        importId?: string;
    }): Promise<any>;

    clearKnowledgeIndex(params: {}): Promise<any>;

    getLibraryStats(params: any): Promise<any>;

    // Macros
    autoDiscoverActions(params: {
        url: string;
        domain: string;
        mode: "scope" | "content";
    }): Promise<any>;
    detectPageActions(params: { registerAgent?: boolean }): Promise<any>;

    registerPageDynamicAgent(params: { agentName: string }): Promise<any>;

    createWebFlowFromRecording(params: {
        actionName: string;
        actionDescription: string;
        recordedSteps: string;
        existingActionNames?: string[];
        startUrl: string;
        screenshots?: string[];
        fragments?: any[];
    }): Promise<any>;

    getWebFlowsForDomain(params: { domain: string }): Promise<any>;

    getAllWebFlows(params: {}): Promise<any>;

    deleteWebFlow(params: { name: string }): Promise<any>;

    // Search/analytics
    getAnalyticsData(params: {
        timeRange?: string;
        includeQuality?: boolean;
        includeProgress?: boolean;
        topDomainsLimit?: number;
        activityGranularity?: string;
    }): Promise<any>;

    getWebsiteStats(params: { groupBy?: string; limit?: number }): Promise<any>;

    // Navigation
    handlePageNavigation(params: {
        url: string;
        title: string;
        tabId?: number;
    }): Promise<void>;

    // Site translator
    enableSiteTranslator(params: { translator: string }): Promise<void>;
    disableSiteTranslator(params: { translator: string }): Promise<void>;

    // View host
    getViewHostUrl(params: {}): Promise<any>;

    // Tab index
    addTabIdToIndex(params: any): Promise<any>;
    deleteTabIdFromIndex(params: any): Promise<any>;
    getTabIdFromIndex(params: any): Promise<any>;
    resetTabIdToIndex(params: any): Promise<any>;
};

// Fire-and-forget events from agent → extension
export type BrowserAgentCallFunctions = {
    importProgress(params: { importId: string; progress: any }): void;
    knowledgeExtractionProgress(params: {
        extractionId: string;
        progress: any;
    }): void;
};

// =============================================
// Local operations (handled in service worker)
// =============================================

export type ExtensionLocalInvokeFunctions = {
    checkWebSocketConnection(): Promise<{ connected: boolean }>;
    checkConnection(): Promise<{ connected: boolean }>;
    initialize(): Promise<string>;
    takeScreenshot(): Promise<string>;
    saveRecordedActions(params: {
        recordedActions: any;
        recordedActionPageHTML: any;
        recordedActionScreenshot: any;
        actionIndex: number;
        isCurrentlyRecording?: boolean;
    }): Promise<{}>;
    recordingStopped(params: {
        recordedActions: any;
        recordedActionPageHTML: any;
        recordedActionScreenshot: any;
        actionIndex: number;
    }): Promise<{}>;
    getRecordedActions(): Promise<any>;
    downloadData(params: { data: any; filename?: string }): Promise<{}>;
    getViewHostUrl(): Promise<{ url?: string }>;

    // Settings
    settingsUpdated(params: { settings: any }): Promise<{ success: boolean }>;
    autoIndexSettingChanged(params: {
        enabled: boolean;
    }): Promise<{ success: boolean }>;

    // Search history (local storage)
    saveSearchHistory(params: { query: string; results?: any }): Promise<any>;
    getSearchHistory(): Promise<any>;
    getSearchSuggestions(params: {
        query: string;
        limit?: number;
    }): Promise<any>;
    getSuggestedSearches(): Promise<any>;

    // Index status
    checkIndexStatus(): Promise<{
        success: boolean;
        exists: boolean;
        error?: string;
    }>;

    // Content download
    downloadContentWithBrowser(params: {
        url: string;
        options?: any;
    }): Promise<any>;
    processHtmlContent(params: {
        htmlContent: string;
        options?: any;
    }): Promise<any>;
    testOffscreenDocument(params: { testUrl?: string }): Promise<any>;

    // Site agent
    enableSiteAgent(params: {
        agentName: string;
        reinitialize?: boolean;
    }): Promise<{ success: boolean; error?: string }>;
};

// =============================================
// Chat panel / dispatcher operations
// =============================================

export type ChatPanelInvokeFunctions = {
    chatPanelConnect(): Promise<{
        connected: boolean;
        error?: string;
    }>;
    chatPanelConnectionStatus(): Promise<{ connected: boolean }>;
    chatPanelProcessCommand(params: {
        command: string;
        clientRequestId: string;
        attachments?: any[];
    }): Promise<any>;
    chatPanelGetCompletions(params: { input: string }): Promise<{
        completions: string[];
        startIndex: number;
        prefix: string;
    } | null>;
    chatPanelGetHistory(): Promise<any[]>;
    chatPanelGetDynamicDisplay(params: {
        source: string;
        displayId: string;
    }): Promise<{ content: any; nextRefreshMs: number }>;
    chatPanelQueryKnowledge(params: {
        query: string;
        url: string;
    }): Promise<any>;
    chatPanelGenerateQuestions(params: {
        url: string;
        knowledge?: any;
    }): Promise<any>;
    chatPanelStartRecording(): Promise<{ success: boolean; error?: string }>;
    chatPanelStopRecording(): Promise<{
        success: boolean;
        stepCount: number;
        error?: string;
    }>;
    chatPanelCreateWebFlowFromRecording(params: {
        actionName: string;
        actionDescription: string;
    }): Promise<{ success: boolean; flowName?: string; error?: string }>;
};

// =============================================
// Chat panel invoke functions (service worker → chat panel, awaited)
// These are invoke targets that the service worker calls on the chat panel
// and awaits a response (e.g., user confirmation).
// =============================================

export type ChatPanelInvokeTargets = {
    chatPanelAskYesNo(data: {
        message: string;
        defaultValue?: boolean;
    }): Promise<boolean>;
    chatPanelProposeAction(data: {
        actionText: string;
        source: string;
    }): Promise<boolean>;
};

// =============================================
// Chat panel call functions (service worker → chat panel, fire-and-forget)
// =============================================

export type ChatPanelCallFunctions = {
    dispatcherClear(data: { requestId: any }): void;
    dispatcherExit(data: { requestId: any }): void;
    dispatcherSetDisplayInfo(data: {
        requestId: any;
        source: any;
        actionIndex?: any;
        action?: any;
    }): void;
    dispatcherSetDisplay(data: { message: any }): void;
    dispatcherAppendDisplay(data: { message: any; mode: any }): void;
    dispatcherSetDynamicDisplay(data: {
        requestId: any;
        source: any;
        actionIndex: any;
        displayId: any;
        nextRefreshMs: any;
    }): void;
    dispatcherNotify(data: {
        notificationId: any;
        event: any;
        data: any;
        source: any;
    }): void;
    dispatcherTakeAction(data: {
        requestId: any;
        action: any;
        data: any;
    }): void;
    dispatcherConnectionStatus(data: { connected: boolean }): void;
    /** Inject a command into the chat panel as if the user typed it. */
    injectCommand(data: { command: string }): void;
    /** Start the interactive macro authoring flow. */
    startMacroAuthoring(data: {}): void;
};

// =============================================
// Combined types for service worker RPC server
// =============================================

export type AllServiceWorkerInvokeFunctions = ExtensionLocalInvokeFunctions &
    ChatPanelInvokeFunctions & {
        // Agent-forwarded operations (the service worker forwards these to the agent)
        // Listed separately because the service worker acts as a proxy
        getLibraryStats(params?: any): Promise<any>;
        queryKnowledge(params: any): Promise<any>;
        searchWebMemories(params: any): Promise<any>;
        searchByEntities(params: any): Promise<any>;
        searchByTopics(params: any): Promise<any>;
        getHierarchicalTopics(params: any): Promise<any>;
        getTopicImportanceLayer(params: any): Promise<any>;
        getTopicViewportNeighborhood(params: any): Promise<any>;
        getTopicMetrics(params: any): Promise<any>;
        getTopicDetails(params: any): Promise<any>;
        getEntityDetails(params: any): Promise<any>;
        getTopicTimelines(params: any): Promise<any>;
        hybridSearch(params: any): Promise<any>;
        discoverRelationships(params: any): Promise<any>;
        analyzeKnowledgeGaps(params: any): Promise<any>;
        indexPageContentDirect(params: any): Promise<any>;
        autoIndexPage(params: any): Promise<any>;
        autoDiscoverActions(params: any): Promise<any>;
        getPageIndexStatus(params: any): Promise<any>;
        getPageIndexedKnowledge(params: any): Promise<any>;
        indexExtractedKnowledge(params: any): Promise<any>;
        getIndexStats(): Promise<any>;
        importWebsiteDataWithProgress(params: any): Promise<any>;
        getWebsiteLibraryStats(): Promise<any>;
        clearWebsiteLibrary(): Promise<any>;
        cancelImport(params: { importId: string }): Promise<any>;
        importHtmlFolder(params: any): Promise<any>;
        getFileImportProgress(params: { importId: string }): Promise<any>;
        cancelFileImport(params: { importId: string }): Promise<any>;
        getAllWebFlows(): Promise<any>;
        deleteWebFlow(params: any): Promise<any>;
        getPageQualityMetrics(params: any): Promise<any>;
        getAnalyticsData(params: any): Promise<any>;
        getKnowledgeGraphStatus(): Promise<any>;
        buildKnowledgeGraph(params: any): Promise<any>;
        rebuildKnowledgeGraph(): Promise<any>;
        testMergeTopicHierarchies(): Promise<any>;
        mergeTopicHierarchies(): Promise<any>;
        getGlobalGraphLayoutData(params: any): Promise<any>;
        getEntityNeighborhood(params: any): Promise<any>;
        getEntityNeighborhoodLayoutData(params: any): Promise<any>;
        getGlobalImportanceLayer(params: any): Promise<any>;
        getImportanceStatistics(): Promise<any>;
        getViewportBasedNeighborhood(params: any): Promise<any>;

        // Aliases used by ExtensionServiceBase views
        saveSearch(params: { query: string; results?: any }): Promise<any>;
        getRecentSearches(): Promise<any>;
        openOptionsPage(): Promise<any>;
        createTab(params: { url: string; active?: boolean }): Promise<any>;
        extractKnowledge(params: { url: string }): Promise<any>;
        checkKnowledgeStatus(params: { url: string }): Promise<any>;
        getAutoIndexSetting(): Promise<any>;
        setAutoIndexSetting(params: { enabled: boolean }): Promise<any>;
        getExtractionSettings(): Promise<any>;
        saveExtractionSettings(params: { settings: any }): Promise<any>;
        notifyAutoIndexSettingChanged(params: {
            enabled: boolean;
        }): Promise<any>;
        generateTemporalSuggestions(params: any): Promise<any>;
        searchWebMemoriesAdvanced(params: any): Promise<any>;
        getPageSourceInfo(params: { url: string }): Promise<any>;
    };
