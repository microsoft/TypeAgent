// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";

export interface WebsiteVisitInfo {
    url: string;
    title?: string;
    domain?: string;
    visitDate?: string;
    bookmarkDate?: string;
    source: "bookmark" | "history" | "reading_list";
    folder?: string;
    pageType?: string; // e.g., "news", "commerce", "travel", "documentation"
    keywords?: string[];
    description?: string;
    favicon?: string;
    visitCount?: number;
    lastVisitTime?: string;
    typedCount?: number;
}

export class WebsiteMeta implements kp.IMessageMetadata, kp.IKnowledgeSource {
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

    constructor(visitInfo: WebsiteVisitInfo) {
        this.url = visitInfo.url;
        if (visitInfo.title !== undefined) this.title = visitInfo.title;
        if (visitInfo.domain !== undefined) this.domain = visitInfo.domain;
        else this.domain = this.extractDomain(visitInfo.url);
        if (visitInfo.visitDate !== undefined)
            this.visitDate = visitInfo.visitDate;
        if (visitInfo.bookmarkDate !== undefined)
            this.bookmarkDate = visitInfo.bookmarkDate;
        this.websiteSource = visitInfo.source;
        if (visitInfo.folder !== undefined) this.folder = visitInfo.folder;
        if (visitInfo.pageType !== undefined)
            this.pageType = visitInfo.pageType;
        if (visitInfo.keywords !== undefined)
            this.keywords = visitInfo.keywords;
        if (visitInfo.description !== undefined)
            this.description = visitInfo.description;
        if (visitInfo.favicon !== undefined) this.favicon = visitInfo.favicon;
        if (visitInfo.visitCount !== undefined)
            this.visitCount = visitInfo.visitCount;
        if (visitInfo.lastVisitTime !== undefined)
            this.lastVisitTime = visitInfo.lastVisitTime;
        if (visitInfo.typedCount !== undefined)
            this.typedCount = visitInfo.typedCount;
    }

    public get source() {
        return this.url;
    }

    public get dest() {
        return undefined;
    }

    public get displayTitle() {
        return this.title || this.url;
    }

    public getKnowledge(): kpLib.KnowledgeResponse {
        return this.websiteToKnowledge();
    }

    private extractDomain(url: string): string {
        try {
            const urlObj = new URL(url);
            return urlObj.hostname;
        } catch {
            return url;
        }
    }

    private websiteToKnowledge(): kpLib.KnowledgeResponse {
        const entities: any[] = [];
        const topics: string[] = [];
        const actions: any[] = [];
        const inverseActions: any[] = [];

        // Add domain as entity
        if (this.domain) {
            entities.push({
                name: this.domain,
                type: ["website", "domain"],
            });
        }

        // Add title as topic if available
        if (this.title) {
            topics.push(this.title);
        }

        // Add folder as topic if it's a bookmark
        if (this.folder && this.websiteSource === "bookmark") {
            topics.push(this.folder);
        }

        // Add page type as topic
        if (this.pageType) {
            topics.push(this.pageType);
        }

        // Add keywords as topics
        if (this.keywords) {
            for (const keyword of this.keywords) {
                topics.push(keyword);
            }
        }

        // Add action based on source
        const actionVerb =
            this.websiteSource === "bookmark" ? "bookmarked" : "visited";
        actions.push({
            verbs: [actionVerb],
            verbTense: "past",
            subjectEntityName: "user", // The user performed the action
            objectEntityName: this.domain || this.url,
            indirectObjectEntityName: "none",
        });

        return {
            entities,
            topics,
            actions,
            inverseActions,
        };
    }
}

export class WebsiteMessage implements kp.IMessage {
    public textChunks: string[];
    public tags: string[];
    public timestamp: string | undefined;
    public knowledge: kpLib.KnowledgeResponse | undefined;
    public deletionInfo: kp.DeletionInfo | undefined;

    constructor(
        public metadata: WebsiteMeta,
        pageContent: string | string[],
        tags: string[] = [],
        knowledge?: kpLib.KnowledgeResponse | undefined,
        deletionInfo?: kp.DeletionInfo | undefined,
        isNew: boolean = true,
    ) {
        this.tags = tags;
        this.knowledge = knowledge;
        this.deletionInfo = deletionInfo;
        this.timestamp = metadata.visitDate || metadata.bookmarkDate;

        if (isNew) {
            pageContent = websiteToTextChunks(
                pageContent,
                metadata.title,
                metadata.url,
            );
        }

        if (Array.isArray(pageContent)) {
            this.textChunks = pageContent;
        } else {
            this.textChunks = [pageContent];
        }
    }

    public getKnowledge(): kpLib.KnowledgeResponse | undefined {
        let metaKnowledge = this.metadata.getKnowledge();
        if (!metaKnowledge) {
            return this.knowledge;
        }
        if (!this.knowledge) {
            return metaKnowledge;
        }
        // Merge knowledge from metadata and message
        return {
            entities: [...metaKnowledge.entities, ...this.knowledge.entities],
            topics: [...metaKnowledge.topics, ...this.knowledge.topics],
            actions: [...metaKnowledge.actions, ...this.knowledge.actions],
            inverseActions: [
                ...metaKnowledge.inverseActions,
                ...this.knowledge.inverseActions,
            ],
        };
    }
}

export function importWebsiteVisit(
    visitInfo: WebsiteVisitInfo,
    pageContent?: string,
): WebsiteMessage {
    const meta = new WebsiteMeta(visitInfo);
    return new WebsiteMessage(meta, pageContent || visitInfo.description || "");
}

export class WebsiteMessageSerializer
    implements kp.JsonSerializer<WebsiteMessage>
{
    public serialize(value: WebsiteMessage): string {
        return JSON.stringify(value);
    }

    public deserialize(json: string): WebsiteMessage {
        const jMsg: WebsiteMessage = JSON.parse(json);
        const jMeta: WebsiteMeta = jMsg.metadata;
        const visitInfo: WebsiteVisitInfo = {
            url: jMeta.url,
            source: jMeta.websiteSource,
        };
        if (jMeta.title !== undefined) visitInfo.title = jMeta.title;
        if (jMeta.domain !== undefined) visitInfo.domain = jMeta.domain;
        if (jMeta.visitDate !== undefined)
            visitInfo.visitDate = jMeta.visitDate;
        if (jMeta.bookmarkDate !== undefined)
            visitInfo.bookmarkDate = jMeta.bookmarkDate;
        if (jMeta.folder !== undefined) visitInfo.folder = jMeta.folder;
        if (jMeta.pageType !== undefined) visitInfo.pageType = jMeta.pageType;
        if (jMeta.keywords !== undefined) visitInfo.keywords = jMeta.keywords;
        if (jMeta.description !== undefined)
            visitInfo.description = jMeta.description;
        if (jMeta.favicon !== undefined) visitInfo.favicon = jMeta.favicon;
        if (jMeta.visitCount !== undefined)
            visitInfo.visitCount = jMeta.visitCount;
        if (jMeta.lastVisitTime !== undefined)
            visitInfo.lastVisitTime = jMeta.lastVisitTime;
        if (jMeta.typedCount !== undefined)
            visitInfo.typedCount = jMeta.typedCount;

        const meta = new WebsiteMeta(visitInfo);
        return new WebsiteMessage(
            meta,
            jMsg.textChunks,
            jMsg.tags,
            jMsg.knowledge,
            jMsg.deletionInfo,
            false,
        );
    }
}

function websiteToTextChunks(
    pageContent: string | string[],
    title?: string,
    url?: string,
): string | string[] {
    if (Array.isArray(pageContent)) {
        pageContent[0] = joinTitleUrlAndContent(pageContent[0], title, url);
        return pageContent;
    } else {
        return joinTitleUrlAndContent(pageContent, title, url);
    }
}

function joinTitleUrlAndContent(
    pageContent: string,
    title?: string,
    url?: string,
): string {
    let result = "";
    if (title) {
        result += `Title: ${title}\n`;
    }
    if (url) {
        result += `URL: ${url}\n`;
    }
    if (result) {
        result += "\n";
    }
    return result + pageContent;
}
