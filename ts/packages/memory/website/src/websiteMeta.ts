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

        // Enhanced domain entity with rich facets
        if (this.domain) {
            const domainEntity: any = {
                name: this.domain,
                type: ["website", "domain"],
                facets: []
            };

            // Temporal facets for ordering queries
            if (this.bookmarkDate) {
                const bookmarkDate = new Date(this.bookmarkDate);
                domainEntity.facets.push({name: "bookmarkDate", value: this.bookmarkDate});
                domainEntity.facets.push({name: "bookmarkYear", value: bookmarkDate.getFullYear().toString()});
            }

            if (this.visitDate) {
                const visitDate = new Date(this.visitDate);
                domainEntity.facets.push({name: "visitDate", value: this.visitDate});
                domainEntity.facets.push({name: "visitYear", value: visitDate.getFullYear().toString()});
            }

            // Frequency facets for popularity queries
            if (this.visitCount !== undefined) {
                domainEntity.facets.push({name: "visitCount", value: this.visitCount.toString()});
                const frequency = this.calculateVisitFrequency();
                domainEntity.facets.push({name: "visitFrequency", value: frequency});
            }

            // Category and source facets for filtering
            if (this.pageType) {
                domainEntity.facets.push({name: "category", value: this.pageType});
                const confidence = this.calculatePageTypeConfidence();
                domainEntity.facets.push({name: "categoryConfidence", value: confidence.toString()});
            }

            if (this.websiteSource) {
                domainEntity.facets.push({name: "source", value: this.websiteSource});
            }

            // Folder context for bookmarks
            if (this.folder && this.websiteSource === "bookmark") {
                domainEntity.facets.push({name: "folder", value: this.folder});
            }

            entities.push(domainEntity);
        }

        // Enhanced temporal topics for LLM reasoning
        if (this.bookmarkDate) {
            const bookmarkDate = new Date(this.bookmarkDate);
            const year = bookmarkDate.getFullYear();
            const currentYear = new Date().getFullYear();
            
            topics.push(`bookmarked in ${year}`);
            topics.push(`${this.domain} bookmark from ${year}`);
            
            // Relative temporal topics
            const yearsAgo = currentYear - year;
            if (yearsAgo === 0) {
                topics.push("recent bookmark");
                topics.push("new bookmark");
            } else if (yearsAgo >= 3) {
                topics.push("old bookmark");
                topics.push("early bookmark");
            }
        }

        if (this.visitDate) {
            const visitDate = new Date(this.visitDate);
            const year = visitDate.getFullYear();
            topics.push(`visited in ${year}`);
            topics.push(`${this.domain} visit from ${year}`);
        }

        // Frequency-derived topics
        if (this.visitCount !== undefined && this.visitCount > 10) {
            topics.push("frequently visited site");
            topics.push("popular domain");
            topics.push("often visited");
        } else if (this.visitCount !== undefined && this.visitCount <= 2) {
            topics.push("rarely visited site");
            topics.push("infrequent visit");
        }

        // Enhanced category topics
        if (this.pageType) {
            topics.push(this.pageType);
            topics.push(`${this.pageType} site`);
            topics.push(`${this.pageType} website`);
            
            // Category-specific temporal topics
            if (this.bookmarkDate) {
                const year = new Date(this.bookmarkDate).getFullYear();
                topics.push(`${this.pageType} bookmark from ${year}`);
            }
        }

        // Add title as topic if available
        if (this.title) {
            topics.push(this.title);
        }

        // Add folder as topic if it's a bookmark
        if (this.folder && this.websiteSource === "bookmark") {
            topics.push(this.folder);
            topics.push(`bookmark folder: ${this.folder}`);
        }

        // Add keywords as topics
        if (this.keywords) {
            for (const keyword of this.keywords) {
                topics.push(keyword);
                topics.push(`keyword: ${keyword}`);
            }
        }

        // Enhanced action with temporal and frequency context
        const actionVerb = this.websiteSource === "bookmark" ? "bookmarked" : "visited";
        const action: any = {
            verbs: [actionVerb],
            verbTense: "past",
            subjectEntityName: "user",
            objectEntityName: this.domain || this.url,
            indirectObjectEntityName: "none",
            params: []
        };

        // Add temporal context to actions as parameters
        const relevantDate = this.bookmarkDate || this.visitDate;
        if (relevantDate) {
            const date = new Date(relevantDate);
            action.params.push({name: "actionDate", value: relevantDate});
            action.params.push({name: "actionYear", value: date.getFullYear().toString()});
        }

        // Add frequency context to actions as parameters
        if (this.visitCount !== undefined) {
            action.params.push({name: "actionFrequency", value: this.visitCount.toString()});
        }

        actions.push(action);

        return {
            entities,
            topics,
            actions,
            inverseActions,
        };
    }

    private calculateVisitFrequency(): "low" | "medium" | "high" {
        if (!this.visitCount) return "low";
        if (this.visitCount >= 20) return "high";
        if (this.visitCount >= 5) return "medium";
        return "low";
    }

    private calculatePageTypeConfidence(): number {
        // Simple confidence scoring - can be enhanced later
        if (!this.pageType) return 0.5;
        
        // Higher confidence for URL-based detection
        if (this.url.toLowerCase().includes(this.pageType.toLowerCase())) {
            return 0.9;
        }
        
        // Medium confidence for title-based detection
        if (this.title?.toLowerCase().includes(this.pageType.toLowerCase())) {
            return 0.8;
        }
        
        // Default confidence
        return 0.7;
    }
}

export class Website implements kp.IMessage {
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
): Website {
    const meta = new WebsiteMeta(visitInfo);
    return new Website(meta, pageContent || visitInfo.description || "");
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
