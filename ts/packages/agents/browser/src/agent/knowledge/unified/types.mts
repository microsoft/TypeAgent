// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";

export type UnifiedExtractionMode = 'basic' | 'content' | 'actions' | 'full';

export interface UnifiedModeConfig {
    mode: UnifiedExtractionMode;
    enableAI: boolean;
    enableActionDetection: boolean;
    enableRelationshipExtraction: boolean;
    maxCharsPerChunk: number;
    qualityThreshold: number;
    maxConcurrentExtractions: number;
}

export const UNIFIED_EXTRACTION_MODES: Record<UnifiedExtractionMode, UnifiedModeConfig> = {
    basic: {
        mode: 'basic',
        enableAI: false,
        enableActionDetection: false,
        enableRelationshipExtraction: false,
        maxCharsPerChunk: 500,
        qualityThreshold: 0.2,
        maxConcurrentExtractions: 10
    },
    
    content: {
        mode: 'content',
        enableAI: true,
        enableActionDetection: false,
        enableRelationshipExtraction: false,
        maxCharsPerChunk: 1000,
        qualityThreshold: 0.3,
        maxConcurrentExtractions: 5
    },
    
    actions: {
        mode: 'actions',
        enableAI: true,
        enableActionDetection: true,
        enableRelationshipExtraction: false,
        maxCharsPerChunk: 1200,
        qualityThreshold: 0.35,
        maxConcurrentExtractions: 3
    },
    
    full: {
        mode: 'full',
        enableAI: true,
        enableActionDetection: true,
        enableRelationshipExtraction: true,
        maxCharsPerChunk: 1500,
        qualityThreshold: 0.4,
        maxConcurrentExtractions: 2
    }
};

export interface ContentInput {
    url: string;
    title: string;
    htmlContent?: string;
    htmlFragments?: any[];
    textContent?: string;
    source: 'direct' | 'index' | 'bookmark' | 'history' | 'import';
    timestamp?: string;
}

export interface EnhancedKnowledgeResult {
    knowledge: kpLib.KnowledgeResponse;
    qualityMetrics: QualityMetrics;
    source: string;
    extractionMode: UnifiedExtractionMode;
    timestamp: string;
}

export interface QualityMetrics {
    confidence: number;
    entityCount: number;
    topicCount: number;
    actionCount: number;
    extractionTime: number;
}

export interface BatchProgress {
    total: number;
    processed: number;
    percentage: number;
    currentItem: string;
    errors: number;
    mode: UnifiedExtractionMode;
}

export interface BatchError {
    item: ContentInput;
    error: Error;
    timestamp: string;
}

export class AIModelUnavailableError extends Error {
    constructor(mode: UnifiedExtractionMode) {
        super(`AI model required for ${mode} mode but not available. Use 'basic' mode or configure AI model.`);
        this.name = 'AIModelUnavailableError';
    }
}
