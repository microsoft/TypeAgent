// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DocPartMeta } from "conversation-memory";
import { conversation as kpLib } from "knowledge-processor";
import { WebsiteMeta } from "./websiteMeta.js";
import { DetectedAction, ActionSummary } from "./actionExtractor.js";

/**
 * Extended metadata for website documents that includes all website-specific information
 * while maintaining compatibility with the conversation memory system.
 *
 * This class exposes website properties directly on the metadata for backward compatibility.
 */
export class WebsiteDocPartMeta extends DocPartMeta {
    public websiteMeta: WebsiteMeta;

    // Expose website properties directly for backward compatibility
    public url: string;
    public title?: string;
    public domain?: string;
    public visitDate?: string;
    public bookmarkDate?: string;
    public websiteSource: "bookmark" | "history" | "reading_list";
    public folder?: string;
    public pageType?: string;
    public keywords?: string[];
    public description?: string;
    public favicon?: string;
    public visitCount?: number;
    public lastVisitTime?: string;
    public typedCount?: number;
    public pageContent?: any;
    public metaTags?: any;
    public structuredData?: any;
    public extractedActions?: any[];
    public contentSummary?: string;
    public detectedActions?: DetectedAction[];
    public actionSummary?: ActionSummary;

    constructor(websiteMeta: WebsiteMeta) {
        super(websiteMeta.url);
        this.websiteMeta = websiteMeta;

        // Copy all properties for direct access
        this.url = websiteMeta.url;
        if (websiteMeta.title !== undefined) this.title = websiteMeta.title;
        if (websiteMeta.domain !== undefined) this.domain = websiteMeta.domain;
        if (websiteMeta.visitDate !== undefined)
            this.visitDate = websiteMeta.visitDate;
        if (websiteMeta.bookmarkDate !== undefined)
            this.bookmarkDate = websiteMeta.bookmarkDate;
        this.websiteSource = websiteMeta.websiteSource;
        if (websiteMeta.folder !== undefined) this.folder = websiteMeta.folder;
        if (websiteMeta.pageType !== undefined)
            this.pageType = websiteMeta.pageType;
        if (websiteMeta.keywords !== undefined)
            this.keywords = websiteMeta.keywords;
        if (websiteMeta.description !== undefined)
            this.description = websiteMeta.description;
        if (websiteMeta.favicon !== undefined)
            this.favicon = websiteMeta.favicon;
        if (websiteMeta.visitCount !== undefined)
            this.visitCount = websiteMeta.visitCount;
        if (websiteMeta.lastVisitTime !== undefined)
            this.lastVisitTime = websiteMeta.lastVisitTime;
        if (websiteMeta.typedCount !== undefined)
            this.typedCount = websiteMeta.typedCount;
        if (websiteMeta.pageContent !== undefined)
            this.pageContent = websiteMeta.pageContent;
        if (websiteMeta.metaTags !== undefined)
            this.metaTags = websiteMeta.metaTags;
        if (websiteMeta.structuredData !== undefined)
            this.structuredData = websiteMeta.structuredData;
        if (websiteMeta.extractedActions !== undefined)
            this.extractedActions = websiteMeta.extractedActions;
        if (websiteMeta.contentSummary !== undefined)
            this.contentSummary = websiteMeta.contentSummary;
        if (websiteMeta.detectedActions !== undefined)
            this.detectedActions = websiteMeta.detectedActions;
        if (websiteMeta.actionSummary !== undefined)
            this.actionSummary = websiteMeta.actionSummary;
    }

    public get source(): string | string[] | undefined {
        return this.websiteSource;
    }

    public get dest(): string | string[] | undefined {
        return this.domain;
    }

    public getKnowledge(): kpLib.KnowledgeResponse | undefined {
        return this.websiteMeta.getKnowledge();
    }
}
