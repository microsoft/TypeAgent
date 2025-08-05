// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { DetectedAction, ActionSummary } from "./extraction/types.js";

export type ExtractionMode = "basic" | "content" | "macros" | "full";

export interface PageContent {
    title: string;
    mainContent: string;
    headings: string[];
    codeBlocks?: string[];
    images?: ImageInfo[];
    links?: LinkInfo[];
    wordCount: number;
    readingTime: number;
}

export interface ImageInfo {
    src: string;
    alt?: string;
    width?: number;
    height?: number;
    isExternal?: boolean;
}

export interface LinkInfo {
    href: string;
    text: string;
    isExternal: boolean;
}

export interface MetaTagCollection {
    description?: string;
    keywords?: string[];
    author?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogType?: string;
    twitterCard?: string;
    custom: { [key: string]: string };
}

export interface StructuredDataCollection {
    schemaType?: string;
    data?: any;
    jsonLd?: any[];
}

export interface ActionInfo {
    type: "form" | "button" | "link";
    action?: string;
    method?: string;
    text?: string;
}

export interface EnhancedContentWithKnowledge extends EnhancedContent {
    knowledge?: kpLib.KnowledgeResponse;
    knowledgeQuality?: KnowledgeQualityMetrics;
}

export interface KnowledgeQualityMetrics {
    entityCount: number;
    topicCount: number;
    actionCount: number;
    confidence: number;
    extractionMode: "basic" | "enhanced" | "hybrid";
}

export interface EnhancedContent {
    pageContent?: PageContent;
    metaTags?: MetaTagCollection;
    structuredData?: StructuredDataCollection;
    actions?: ActionInfo[];
    extractionTime: number;
    success: boolean;
    error?: string;
    detectedActions?: DetectedAction[];
    actionSummary?: ActionSummary;
}
