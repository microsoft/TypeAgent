// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Schema definitions for browser knowledge extraction functionality
 * This module defines types and interfaces for extracting structured knowledge
 * from web pages, including entities, relationships, actions, and facets.
 */

export interface Entity {
    /** The name or identifier of the entity */
    name: string;
    /** The type/category of the entity (e.g., 'technology', 'concept', 'person') */
    type: string;
    /** Optional description providing more context about the entity */
    description?: string;
    /** Confidence score (0-1) indicating how certain we are about this entity */
    confidence: number;
}

export interface Relationship {
    /** The subject entity in the relationship */
    subject: string;
    /** The predicate/verb describing the relationship */
    predicate: string;
    /** The object entity in the relationship */
    object: string;
    /** Confidence score (0-1) for this relationship */
    confidence: number;
}

export interface ActionInfo {
    /** Human-readable name of the action */
    name: string;
    /** Description of what this action does */
    description: string;
    /** Optional CSS selector for the actionable element */
    selector?: string;
    /** Type of action that can be performed */
    actionType: "click" | "navigate" | "copy" | "download" | "form" | "search";
    /** Confidence score (0-1) for action detection */
    confidence: number;
}

export interface Facet {
    /** The category name for this facet (e.g., 'Technology Stack', 'Content Type') */
    category: string;
    /** Array of values within this facet category */
    values: string[];
    /** Optional description explaining what this facet represents */
    description?: string;
}

export interface PageMetadata {
    /** Page title */
    title: string;
    /** Full URL of the page */
    url: string;
    /** Domain name */
    domain: string;
    /** Timestamp when knowledge was extracted */
    timestamp: number;
    /** Optional page type classification */
    pageType?: string;
    /** Optional reading/interaction metrics */
    metrics?: {
        readingTime?: number;
        scrollDepth?: number;
        interactionCount?: number;
    };
}

export interface KnowledgeExtractionResult {
    /** Extracted entities from the page */
    entities: Entity[];
    /** Relationships between entities found on the page */
    relationships: Relationship[];
    /** Available actions that can be performed on the page */
    actions: ActionInfo[];
    /** Content facets/categories for classification */
    facets: Facet[];
    /** Auto-generated summary of the page content */
    summary: string;
    /** AI-generated questions that users might want to ask about this content */
    suggestedQuestions: string[];
    /** Metadata about the page and extraction process */
    pageMetadata: PageMetadata;
}

export interface WebKnowledgeSearchResult {
    /** Page title */
    title: string;
    /** Page URL */
    url: string;
    /** Domain name */
    domain: string;
    /** Entities found on this page */
    entities: Entity[];
    /** Brief summary of the page content */
    summary: string;
    /** Relevance score for the search query (0-1) */
    relevanceScore: number;
    /** When this page was indexed */
    timestamp: number;
    /** Optional facets for this result */
    facets?: Facet[];
    /** Optional snippet of matching content */
    snippet?: string;
}

export interface WebKnowledgeQueryResponse {
    /** The original search query */
    query: string;
    /** Array of matching results */
    results: WebKnowledgeSearchResult[];
    /** Total number of results found (may be more than returned) */
    totalFound: number;
    /** Optional suggested follow-up questions */
    suggestedQuestions?: string[];
    /** Optional query execution time in milliseconds */
    executionTime?: number;
}

// Action Type Definitions

/**
 * Extract structured knowledge from page HTML
 * This action analyzes a web page and extracts entities, relationships,
 * actions, and other structured knowledge that can be queried later.
 */
export type ExtractPageKnowledge = {
    actionName: "extractPageKnowledge";
    parameters: {
        /** Raw HTML content of the page */
        html: string;
        /** URL of the page being analyzed */
        url: string;
        /** Optional page title (if not extractable from HTML) */
        title?: string;
        /** Analysis depth: 'basic' focuses on main content, 'detailed' includes more comprehensive analysis */
        depth?: "basic" | "detailed" | "full";
        /** Optional user context for more targeted extraction */
        userContext?: string;
    };
};

/**
 * Query the accumulated web knowledge index
 * Search through previously extracted knowledge from browsed pages
 */
export type QueryWebKnowledge = {
    actionName: "queryWebKnowledge";
    parameters: {
        /** The search query string */
        query: string;
        /** Whether to include the current page context in search */
        includeCurrentPage?: boolean;
        /** Maximum number of results to return */
        limit?: number;
        /** Filter by specific domains */
        domains?: string[];
        /** Filter by specific facet categories */
        facets?: string[];
        /** Filter by entity types */
        entityTypes?: string[];
        /** Time range filter (in days) - only include pages from last N days */
        timeRange?: number;
    };
};

/**
 * Configure automatic knowledge indexing settings
 * Control how and when pages are automatically analyzed and indexed
 */
export type ConfigureAutoIndexing = {
    actionName: "configureAutoIndexing";
    parameters: {
        /** Enable or disable automatic indexing */
        enabled: boolean;
        /** Depth of analysis for auto-indexing */
        autoDepth?: "basic" | "detailed";
        /** Domains to exclude from auto-indexing */
        excludeDomains?: string[];
        /** Domains to include for auto-indexing (if specified, only these will be indexed) */
        includeDomains?: string[];
        /** Minimum time on page before triggering auto-indexing (seconds) */
        minTimeOnPage?: number;
        /** Maximum pages to auto-index per session */
        maxPagesPerSession?: number;
    };
};

/**
 * Get statistics about the current knowledge base
 */
export type GetKnowledgeStats = {
    actionName: "getKnowledgeStats";
    parameters?: {
        /** Group statistics by: 'domain', 'entityType', 'facet', 'timeRange' */
        groupBy?: string;
        /** Number of top items to return in each group */
        limit?: number;
        /** Time range for statistics (in days) */
        timeRange?: number;
    };
};

/**
 * Export knowledge data for backup or analysis
 */
export type ExportKnowledge = {
    actionName: "exportKnowledge";
    parameters: {
        /** Export format: 'json', 'csv', 'rdf' */
        format: "json" | "csv" | "rdf";
        /** Optional filter criteria */
        filter?: {
            domains?: string[];
            timeRange?: number;
            entityTypes?: string[];
        };
        /** Whether to include full content or just metadata */
        includeContent?: boolean;
    };
};

// Union type for all browser knowledge actions
export type BrowserKnowledgeActions =
    | ExtractPageKnowledge
    | QueryWebKnowledge
    | ConfigureAutoIndexing
    | GetKnowledgeStats
    | ExportKnowledge;

// Additional utility types for internal use

export interface KnowledgeExtractionSettings {
    /** Default extraction depth */
    defaultDepth: "basic" | "detailed" | "full";
    /** Entity extraction confidence threshold */
    entityConfidenceThreshold: number;
    /** Relationship extraction confidence threshold */
    relationshipConfidenceThreshold: number;
    /** Maximum entities to extract per page */
    maxEntitiesPerPage: number;
    /** Maximum relationships to extract per page */
    maxRelationshipsPerPage: number;
    /** Whether to extract actions from pages */
    extractActions: boolean;
    /** Whether to generate summaries */
    generateSummaries: boolean;
    /** Maximum summary length in characters */
    maxSummaryLength: number;
}

export interface AutoIndexingSettings {
    /** Whether auto-indexing is enabled */
    enabled: boolean;
    /** Depth of auto-indexing analysis */
    depth: "basic" | "detailed";
    /** Domains to exclude from auto-indexing */
    excludeDomains: string[];
    /** Domains to include for auto-indexing */
    includeDomains: string[];
    /** Minimum time on page before indexing (seconds) */
    minTimeOnPage: number;
    /** Maximum pages to index per browsing session */
    maxPagesPerSession: number;
    /** Whether to index only when user is active */
    onlyWhenActive: boolean;
}

export interface KnowledgeStats {
    /** Total number of pages indexed */
    totalPages: number;
    /** Total number of entities extracted */
    totalEntities: number;
    /** Total number of relationships found */
    totalRelationships: number;
    /** Number of unique domains */
    uniqueDomains: number;
    /** Most common entity types */
    topEntityTypes: Array<{ type: string; count: number }>;
    /** Most active domains */
    topDomains: Array<{ domain: string; pageCount: number }>;
    /** Recent indexing activity */
    recentActivity: Array<{ date: string; pagesIndexed: number }>;
    /** Storage size information */
    storageSize: {
        totalBytes: number;
        entitiesBytes: number;
        contentBytes: number;
        metadataBytes: number;
    };
}

// Error types for knowledge extraction
export interface KnowledgeExtractionError {
    code:
        | "EXTRACTION_FAILED"
        | "INVALID_HTML"
        | "TIMEOUT"
        | "STORAGE_FULL"
        | "NETWORK_ERROR";
    message: string;
    details?: any;
    url?: string;
    timestamp: number;
}

// Event types for knowledge extraction lifecycle
export interface KnowledgeExtractionEvent {
    type:
        | "extraction_started"
        | "extraction_completed"
        | "extraction_failed"
        | "query_executed"
        | "settings_changed";
    timestamp: number;
    data: any;
    url?: string;
    duration?: number;
}
