// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Core data structures for the ActionsStore system
 */

// DOM-related types for compatibility
interface DOMRect {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface StoredAction {
    // Core Identity
    id: string; // UUID v4
    name: string; // Human-readable name (max 100 chars)
    version: string; // Semantic version (e.g., "1.0.0")

    // Metadata
    description: string; // Action description (max 500 chars)
    category: ActionCategory; // Predefined categories
    tags: string[]; // Searchable tags (max 10, 30 chars each)
    author: ActionAuthor; // How action was created

    // Scope and Applicability
    scope: ActionScope; // Where this action applies
    urlPatterns: UrlPattern[]; // URL matching rules

    // Action Definition (consolidated from current multi-property storage)
    definition: ActionDefinition; // All schema and execution data

    // Context Data (from current recording system)
    context: ActionContext; // HTML, screenshots, selectors

    // Management
    metadata: ActionMetadata; // Timestamps, usage, relationships
}

export type ActionCategory =
    | "navigation" // Page navigation, links, back/forward
    | "form" // Form filling, input, submission
    | "commerce" // Shopping, cart, checkout, payment
    | "search" // Search operations, filtering
    | "content" // Content creation, editing, reading
    | "social" // Social interactions, sharing, commenting
    | "media" // Media playback, upload, download
    | "utility" // General utilities, tools
    | "custom"; // User-defined category

export type ActionAuthor = "discovered" | "user";

export interface ActionScope {
    type: "global" | "domain" | "pattern" | "page";
    domain?: string; // Required for domain/pattern/page
    priority: number; // 1-100, higher = more specific
}

export interface UrlPattern {
    pattern: string; // The pattern string
    type: "exact" | "glob" | "regex"; // Pattern matching type
    priority: number; // Matching priority (1-100)
    description?: string; // Human-readable description
}

export interface ActionDefinition {
    // TypeScript type definition for action schema
    intentSchema?: string;

    // Structured intent parameters
    intentJson?: UserIntent;

    // Execution steps for the action
    actionSteps?: ActionStep[];

    // Auto-discovered schema data
    detectedSchema?: any;

    actionsJson?: any;
    actionDefinition?: any;
    description?: string;

    screenshot?: string[] | undefined;
    steps?: any | undefined;
}

export interface ActionContext {
    // From current userActions
    recordedSteps?: RecordedStep[]; // Original recorded interactions
    screenshots?: string[]; // Base64 encoded screenshots
    htmlFragments?: string[]; // Relevant HTML content

    // Enhanced context
    selectors?: CSSSelector[]; // Important CSS selectors
    domState?: DOMSnapshot; // DOM state during recording
    viewport?: ViewportInfo; // Viewport size and settings
}

export interface ActionMetadata {
    createdAt: string; // ISO 8601 timestamp
    updatedAt: string; // ISO 8601 timestamp
    usageCount: number; // Usage statistics
    lastUsed?: string; // Last usage timestamp

    // Relationships
    relatedActions?: string[]; // Related action IDs
    supersedes?: string; // Action this replaces
    supersededBy?: string; // Action that replaces this

    // Validation
    isValid: boolean; // Whether action is valid
    validationErrors?: string[]; // Validation error messages
}

// Supporting interfaces from current system
export interface UserIntent {
    actionName: string;
    parameters: IntentParameter[];
}

export interface IntentParameter {
    shortName: string;
    description: string;
    type: "string" | "number" | "boolean";
    required: boolean;
    defaultValue?: any;
}

export interface ActionStep {
    type: string; // Step type (click, type, etc.)
    target?: string; // CSS selector or description
    value?: any; // Step value/parameter
    options?: Record<string, any>; // Additional options
}

export interface RecordedStep {
    type: string;
    timestamp: number;
    target?: string;
    value?: string;
    boundingBox?: DOMRect;
    id?: string;
    [key: string]: any; // Additional properties
}

export interface CSSSelector {
    selector: string; // CSS selector
    description?: string; // What this selector targets
    confidence: number; // Confidence score (0-1)
}

export interface DOMSnapshot {
    timestamp: number;
    url: string;
    title: string;
    elements: ElementSnapshot[];
}

export interface ElementSnapshot {
    selector: string;
    tagName: string;
    attributes: Record<string, string>;
    textContent?: string;
    boundingBox?: DOMRect;
}

export interface ViewportInfo {
    width: number;
    height: number;
    devicePixelRatio: number;
    userAgent: string;
}

// Domain Configuration interfaces
export interface DomainConfig {
    domain: string; // Domain name (e.g., "example.com")
    version: string; // Config version

    settings: DomainSettings;
    patterns: UrlPatternDefinition[];
    metadata: DomainMetadata;
}

export interface DomainSettings {
    autoDiscovery: boolean; // Enable automatic action discovery
    inheritGlobal: boolean; // Inherit global actions
    defaultCategory: ActionCategory; // Default category for new actions
    maxActions: number; // Maximum actions for this domain

    // Custom selectors for common elements
    customSelectors: Record<string, string>;

    // Framework-specific settings
    framework?: FrameworkSettings;
}

export interface FrameworkSettings {
    type: "react" | "angular" | "vue" | "vanilla" | "unknown";
    version?: string;
    routing?: "spa" | "mpa"; // Single/Multi page app
    customBehaviors?: Record<string, any>;
}

export interface UrlPatternDefinition {
    name: string; // Pattern identifier
    pattern: string; // Pattern string
    type: "glob" | "regex"; // Pattern type
    description: string; // Human description
    category?: ActionCategory; // Default category for this pattern
    priority: number; // Pattern priority (1-100)
}

export interface DomainMetadata {
    siteType: SiteType; // Type of website
    framework?: string; // Detected framework
    version?: string; // Site version if detectable
    lastAnalyzed: string; // Last analysis timestamp
    analysisData?: any; // Raw analysis data
    createdAt: string; // Domain config creation timestamp
    updatedAt: string; // Last update timestamp
}

export type SiteType =
    | "ecommerce" // Shopping sites
    | "social" // Social networks
    | "productivity" // Work/productivity tools
    | "entertainment" // Media, games, content
    | "news" // News and information
    | "education" // Learning platforms
    | "government" // Government sites
    | "corporate" // Company websites
    | "blog" // Blogs and personal sites
    | "utility" // Tools and utilities
    | "unknown"; // Unclassified

// Storage operation interfaces
export interface StoreStatistics {
    totalActions: number;
    actionsByScope: Record<ActionScope["type"], number>;
    actionsByCategory: Record<ActionCategory, number>;
    actionsByAuthor: Record<ActionAuthor, number>;
    totalDomains: number;
    totalPatterns: number;

    usage: {
        totalUsage: number; // Total action usages
        averageUsage: number; // Average usage per action
        mostUsedActions: Array<{
            id: string;
            name: string;
            count: number;
        }>;
    };

    storage: {
        totalSize: number; // Total storage size in bytes
        actionFiles: number; // Number of action files
        domainConfigs: number; // Number of domain configs
        indexSize: number; // Index file sizes
    };

    health: {
        validActions: number; // Valid actions count
        invalidActions: number; // Invalid actions count
        lastCleanup?: string; // Last cleanup timestamp
        lastBackup?: string; // Last backup timestamp
    };
}

// Action index for fast lookups
export interface ActionIndex {
    version: string;
    lastUpdated: string;
    actions: Record<string, ActionIndexEntry>;
}

export interface ActionIndexEntry {
    id: string;
    name: string;
    scope: ActionScope;
    category: ActionCategory;
    author: ActionAuthor;
    filePath: string;
    lastModified: string;
    usageCount: number;
}

// Validation and error types
export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: string[];
}

export interface ValidationError {
    field: string;
    message: string;
    value?: any;
}

// Storage operation results
export interface SaveResult {
    success: boolean;
    actionId?: string;
    error?: string;
}

export interface LoadResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

// Advanced Features - Search and Analytics

// Search Types
export interface ActionSearchQuery {
    text?: string;
    filters?: ActionFilter;
    limit?: number;
    offset?: number;
    sortBy?: "relevance" | "name" | "usage" | "created" | "updated";
    sortOrder?: "asc" | "desc";
}

export interface ActionSearchResult {
    actions: StoredAction[];
    total: number;
    hasMore: boolean;
    searchStats: {
        searchTime: number;
        cacheHit: boolean;
    };
}

export interface SearchSuggestion {
    text: string;
    type: "action" | "tag" | "domain" | "category";
    score: number;
    context?: string;
}

// Analytics Types
export interface UsageContext {
    success: boolean;
    executionTime?: number;
    userAgent?: string;
    url?: string;
    domain?: string;
    sessionId?: string;
}

export interface ActionUsageStats {
    actionId: string;
    totalUsage: number;
    lastUsed: string;
    usageHistory: Array<{
        timestamp: string;
        success: boolean;
        executionTime?: number;
        userAgent?: string;
        url?: string;
    }>;
    averageSuccessRate: number;
    averageExecutionTime: number;
    popularTimes: Record<number, number>;
    errorCount: number;
}

export interface UsageStatistics {
    totalUsage: number;
    totalActions: number;
    averageUsage: number;
    mostUsedActions: Array<{
        actionId: string;
        usageCount: number;
        lastUsed: string;
        successRate: number;
    }>;
    usageTrends: Array<{
        date: string;
        usage: number;
    }>;
    performanceMetrics: PerformanceMetrics;
    domainBreakdown: Array<{
        domain: string;
        usage: number;
        percentage: number;
    }>;
    timeRange: {
        start: string;
        end: string;
    };
}

export interface DomainAnalytics {
    domain: string;
    totalUsage: number;
    uniqueActions: number;
    averageSuccessRate: number;
    popularActions: Array<{
        actionId: string;
        name: string;
        usage: number;
    }>;
    usageTrends: Array<{
        date: string;
        usage: number;
        successRate: number;
        averageExecutionTime: number;
    }>;
    lastActivity: string;
}

export interface PerformanceMetrics {
    timestamp: string;
    averageSearchTime: number;
    averageActionExecutionTime: number;
    cacheHitRate: number;
    errorRate: number;
    memoryUsage: number;
    indexSize: number;
}

// Enhanced Statistics Types
export interface EnhancedStoreStatistics extends StoreStatistics {
    searchStats: {
        totalSearches: number;
        averageSearchTime: number;
        popularQueries: PopularSearch[];
        searchSuccessRate: number;
    };
    tagStats: {
        totalTags: number;
        averageTagsPerAction: number;
        popularTags: TagStatistics[];
    };
    performanceStats: PerformanceMetrics;
    trendsAndInsights: {
        growthRate: number;
        usageGrowth: number;
        topGrowingDomains: string[];
        recommendedOptimizations: string[];
    };
}

// Time Range Types
export interface TimeRange {
    start?: string;
    end?: string;
    preset?: "today" | "week" | "month" | "quarter" | "year";
}

// Additional types for filtering
export interface ActionFilter {
    categories?: ActionCategory[];
    authors?: ActionAuthor[];
    domains?: string[];
    scopes?: ActionScope["type"][];
    tags?: string[];
    minUsage?: number;
    maxUsage?: number;
    createdAfter?: string;
    createdBefore?: string;
    lastUsedAfter?: string;
    lastUsedBefore?: string;
}

export interface PopularSearch {
    query: string;
    searchCount: number;
    lastSearched: string;
    averageResults: number;
    successRate: number;
}

export interface TagStatistics {
    tag: string;
    count: number;
    lastUsed?: string;
    trending: boolean;
}
