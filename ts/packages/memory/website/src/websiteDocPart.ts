// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DocPart } from "conversation-memory";
import { conversation as kpLib } from "knowledge-processor";
import * as kp from "knowpro";
import { WebsiteDocPartMeta } from "./websiteDocPartMeta.js";
import { WebsiteMeta } from "./websiteMeta.js";

/**
 * A document part specifically for website content.
 * Maintains compatibility with DocPart while providing website-specific functionality.
 */
export class WebsiteDocPart extends DocPart {
    declare public metadata: WebsiteDocPartMeta;

    constructor(
        websiteMeta: WebsiteMeta,
        textChunks: string | string[] = [],
        tags?: string[] | undefined,
        timestamp?: string | undefined,
        knowledge?: kpLib.KnowledgeResponse | undefined,
        deletionInfo?: kp.DeletionInfo | undefined,
    ) {
        const metadata = new WebsiteDocPartMeta(websiteMeta);
        timestamp =
            timestamp || websiteMeta.visitDate || websiteMeta.bookmarkDate;

        super(textChunks, metadata, tags, timestamp, knowledge, deletionInfo);
    }

    // Convenience accessors for website-specific properties
    public get url(): string {
        return this.metadata.url;
    }

    public get title(): string | undefined {
        return this.metadata.title;
    }

    public get domain(): string | undefined {
        return this.metadata.domain;
    }

    public get visitDate(): string | undefined {
        return this.metadata.visitDate;
    }

    public get bookmarkDate(): string | undefined {
        return this.metadata.bookmarkDate;
    }

    public get websiteSource(): "bookmark" | "history" | "reading_list" {
        return this.metadata.websiteSource;
    }

    public get folder(): string | undefined {
        return this.metadata.folder;
    }

    public get pageType(): string | undefined {
        return this.metadata.pageType;
    }

    public get visitCount(): number | undefined {
        return this.metadata.visitCount;
    }

    /**
     * Create a WebsiteDocPart from the existing Website format
     * This enables migration from the old format to the new one
     */
    public static fromWebsite(website: any): WebsiteDocPart {
        return new WebsiteDocPart(
            website.metadata,
            website.textChunks,
            website.tags,
            website.timestamp,
            website.knowledge,
            website.deletionInfo,
        );
    }

    /**
     * Convert this WebsiteDocPart to the legacy Website format for backward compatibility
     */
    public toWebsite(): any {
        return {
            metadata: this.metadata.websiteMeta,
            textChunks: this.textChunks,
            tags: this.tags,
            timestamp: this.timestamp,
            knowledge: this.knowledge,
            deletionInfo: this.deletionInfo,
            getKnowledge: () => this.getKnowledge(),
        };
    }
}
