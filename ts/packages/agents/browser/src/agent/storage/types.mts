// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Core data structures for the MacroStore system
 */

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

export interface StoredMacro {
    // Core Identity
    id: string; // UUID v4
    name: string; // Human-readable name (max 100 chars)
    version: string; // Semantic version (e.g., "1.0.0")

    // Metadata
    description: string; // Macro description (max 500 chars)
    category: MacroCategory; // Predefined categories
    tags: string[]; // Searchable tags (max 10, 30 chars each)
    author: MacroAuthor; // How macro was created

    // Scope and Applicability
    scope: MacroScope; // Where this macro applies
    urlPatterns: UrlPattern[]; // URL matching rules

    // Macro Definition (consolidated from current multi-property storage)
    definition: MacroDefinition; // All schema and execution data

    // Context Data (from current recording system)
    context: MacroContext; // HTML, screenshots, selectors

    // Management
    metadata: MacroMetadata; // Timestamps, usage, relationships
}

export type MacroCategory =
    | "navigation" // Page navigation, links, back/forward
    | "form" // Form filling, input, submission
    | "commerce" // Shopping, cart, checkout, payment
    | "search" // Search operations, filtering
    | "content" // Content creation, editing, reading
    | "social" // Social interactions, sharing, commenting
    | "media" // Media playback, upload, download
    | "utility" // General utilities, tools
    | "custom"; // User-defined category

export type MacroAuthor = "discovered" | "user";

export interface MacroScope {
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

export interface MacroDefinition {
    // TypeScript type definition for macro schema
    intentSchema?: string;

    // Structured intent parameters
    intentJson?: UserIntent;

    // Execution steps for the macro
    macroSteps?: MacroStep[];

    // Auto-discovered schema data
    detectedSchema?: any;

    macrosJson?: any;
    macroDefinition?: any;
    description?: string;

    screenshot?: string[] | undefined;
    steps?: any | undefined;
}

export interface MacroContext {
    // From current userActions
    recordedSteps?: RecordedStep[]; // Original recorded interactions
    screenshots?: string[]; // Base64 encoded screenshots
    htmlFragments?: string[]; // Relevant HTML content

    // Enhanced context
    selectors?: CSSSelector[]; // Important CSS selectors
    domState?: DOMSnapshot; // DOM state during recording
    viewport?: ViewportInfo; // Viewport size and settings
}

export interface MacroMetadata {
    createdAt: string; // ISO 8601 timestamp
    updatedAt: string; // ISO 8601 timestamp
    usageCount: number; // Usage statistics
    lastUsed?: string; // Last usage timestamp

    // Relationships
    relatedMacros?: string[]; // Related macro IDs
    supersedes?: string;
    supersededBy?: string;

    // Validation
    isValid: boolean; // Whether macro is valid
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

export interface MacroStep {
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
    autoDiscovery: boolean; // Enable automatic macro discovery
    inheritGlobal: boolean; // Inherit global macros
    defaultCategory: MacroCategory; // Default category for new macros
    maxMacros: number; // Maximum macros for this domain

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
    category?: MacroCategory; // Default category for this pattern
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
    totalMacros: number;
    macrosByScope: Record<MacroScope["type"], number>;
    macrosByCategory: Record<MacroCategory, number>;
    macrosByAuthor: Record<MacroAuthor, number>;
    totalDomains: number;
    totalPatterns: number;

    usage: {
        totalUsage: number; // Total macro usages
        averageUsage: number; // Average usage per macro
        mostUsedMacros: Array<{
            id: string;
            name: string;
            count: number;
        }>;
    };

    storage: {
        totalSize: number; // Total storage size in bytes
        macroFiles: number; // Number of macro files
        domainConfigs: number; // Number of domain configs
        indexSize: number; // Index file sizes
    };

    health: {
        validMacros: number; // Valid macros count
        invalidMacros: number; // Invalid macros count
        lastCleanup?: string; // Last cleanup timestamp
        lastBackup?: string; // Last backup timestamp
    };
}

// Macro index for fast lookups
export interface MacroIndex {
    version: string;
    lastUpdated: string;
    macros: Record<string, MacroIndexEntry>;
}

export interface MacroIndexEntry {
    id: string;
    name: string;
    scope: MacroScope;
    category: MacroCategory;
    author: MacroAuthor;
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
    macroId?: string;
    error?: string;
}

export interface LoadResult<T> {
    success: boolean;
    data?: T;
    error?: string;
}

// Advanced Features - Search and Analytics

// Search Types
export interface MacroSearchQuery {
    text?: string;
    filters?: MacroFilter;
    limit?: number;
    offset?: number;
    sortBy?: "relevance" | "name" | "usage" | "created" | "updated";
    sortOrder?: "asc" | "desc";
}

export interface MacroSearchResult {
    macros: StoredMacro[];
    total: number;
    hasMore: boolean;
    searchStats: {
        searchTime: number;
        cacheHit: boolean;
    };
}

export interface SearchSuggestion {
    text: string;
    type: "macro" | "tag" | "domain" | "category";
    score: number;
    context?: string;
}

// Additional types for filtering
export interface MacroFilter {
    categories?: MacroCategory[];
    authors?: MacroAuthor[];
    domains?: string[];
    scopes?: MacroScope["type"][];
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

// Backward compatibility exports - these should be removed after full refactoring
export type StoredAction = StoredMacro;
export type ActionCategory = MacroCategory;
export type ActionAuthor = MacroAuthor;
export type ActionScope = MacroScope;
export type ActionDefinition = MacroDefinition;
export type ActionContext = MacroContext;
export type ActionMetadata = MacroMetadata;
export type ActionStep = MacroStep;
export type ActionIndex = MacroIndex;
export type ActionIndexEntry = MacroIndexEntry;
export type ActionSearchQuery = MacroSearchQuery;
export type ActionSearchResult = MacroSearchResult;
export type ActionFilter = MacroFilter;
// Note: ResolvedAction is an alias for ResolvedMacro (defined in patternResolver.mts)
export type ResolvedAction = import("./patternResolver.mjs").ResolvedMacro;
