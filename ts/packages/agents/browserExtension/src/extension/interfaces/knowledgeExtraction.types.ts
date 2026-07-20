// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Progress tracking for knowledge extraction (based on ImportProgress pattern)
export interface KnowledgeExtractionProgress {
    extractionId: string;
    phase:
        | "content"
        | "basic"
        | "summary"
        | "analyzing"
        | "extracting"
        | "complete"
        | "error";
    totalItems: number;
    processedItems: number;
    currentItem?: string;
    estimatedTimeRemaining?: number;
    errors: ExtractionError[];
    incrementalData?: Partial<KnowledgeData>;
}

// Error tracking for extraction operations
export interface ExtractionError {
    message: string;
    timestamp: number;
    phase?: string;
    recoverable?: boolean;
}

// Knowledge data structure for incremental updates
export interface KnowledgeData {
    entities: Entity[];
    relationships: Relationship[];
    keyTopics: string[];
    summary: string;
    contentActions?: Action[];
    detectedActions?: DetectedAction[];
    actionSummary?: ActionSummary;
    contentMetrics?: {
        readingTime: number;
        wordCount: number;
    };
}

// Supporting interfaces (referencing existing types)
export interface Entity {
    name: string;
    type: string;
    confidence?: number;
    context?: string;
}

export interface Relationship {
    from: string;
    to: string;
    relationship: string;
    confidence?: number;
}

export interface Action {
    name: string;
    description: string;
    parameters?: any;
}

export interface DetectedAction {
    action: string;
    confidence: number;
    context: string;
}

export interface ActionSummary {
    totalActions: number;
    primaryActions: string[];
    actionTypes: string[];
}

// Progress callback type for knowledge extraction
export type KnowledgeProgressCallback = (
    progress: KnowledgeExtractionProgress,
) => void;

// Extraction result interface
export interface KnowledgeExtractionResult {
    success: boolean;
    extractionId: string;
    duration: number;
    errors: ExtractionError[];
    finalData: KnowledgeData;
}
