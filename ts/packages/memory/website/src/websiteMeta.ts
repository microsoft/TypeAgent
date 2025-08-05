// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";
import {
    PageContent,
    MetaTagCollection,
    StructuredDataCollection,
    ActionInfo,
} from "./extraction/types.js";
import { websiteToTextChunks } from "./chunkingUtils.js";
import { DetectedAction, ActionSummary } from "./extraction/types.js";

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

    // NEW: Enhanced content fields
    pageContent?: PageContent;
    metaTags?: MetaTagCollection;
    structuredData?: StructuredDataCollection;
    extractedActions?: ActionInfo[];
    contentSummary?: string;

    // Action detection fields
    detectedActions?: DetectedAction[];
    actionSummary?: ActionSummary;
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

    // NEW: Enhanced content properties
    public pageContent?: PageContent;
    public metaTags?: MetaTagCollection;
    public structuredData?: StructuredDataCollection;
    public extractedActions?: ActionInfo[];
    public contentSummary?: string;

    // NEW: Action detection properties
    public detectedActions?: DetectedAction[];
    public actionSummary?: ActionSummary;

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

        // NEW: Enhanced content properties
        if (visitInfo.pageContent !== undefined)
            this.pageContent = visitInfo.pageContent;
        if (visitInfo.metaTags !== undefined)
            this.metaTags = visitInfo.metaTags;
        if (visitInfo.structuredData !== undefined)
            this.structuredData = visitInfo.structuredData;
        if (visitInfo.extractedActions !== undefined)
            this.extractedActions = visitInfo.extractedActions;
        if (visitInfo.contentSummary !== undefined)
            this.contentSummary = visitInfo.contentSummary;

        // Action detection properties
        if (visitInfo.detectedActions !== undefined)
            this.detectedActions = visitInfo.detectedActions;
        if (visitInfo.actionSummary !== undefined)
            this.actionSummary = visitInfo.actionSummary;
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

    public getMergedKnowledge(
        extractedKnowledge?: kpLib.KnowledgeResponse,
    ): kpLib.KnowledgeResponse {
        const baseKnowledge = this.websiteToKnowledge();

        if (!extractedKnowledge) {
            return baseKnowledge;
        }

        // Merge base knowledge with advanced extracted knowledge
        return this.mergeKnowledgeResponses(baseKnowledge, extractedKnowledge);
    }

    private mergeKnowledgeResponses(
        baseKnowledge: kpLib.KnowledgeResponse,
        extractedKnowledge: kpLib.KnowledgeResponse,
    ): kpLib.KnowledgeResponse {
        // Merge topics (removing duplicates)
        const allTopics = [
            ...baseKnowledge.topics,
            ...extractedKnowledge.topics,
        ];
        const mergedTopics = [...new Set(allTopics)].slice(0, 30);

        // Merge entities (removing duplicates by name, preserving website-specific facets)
        const entityMap = new Map<string, kpLib.ConcreteEntity>();

        // Add base entities first (preserve website-specific facets)
        baseKnowledge.entities.forEach((entity) => {
            entityMap.set(entity.name, entity);
        });

        // Add extracted entities, merging with existing if same name
        extractedKnowledge.entities.forEach((entity) => {
            const existing = entityMap.get(entity.name);
            if (existing) {
                // Merge facets, preserving website-specific ones
                const mergedFacets = [...(existing.facets || [])];
                const existingFacetNames = new Set(
                    mergedFacets.map((f) => f.name),
                );

                entity.facets?.forEach((facet) => {
                    if (!existingFacetNames.has(facet.name)) {
                        mergedFacets.push(facet);
                    }
                });

                entityMap.set(entity.name, {
                    ...entity,
                    type: [
                        ...new Set([
                            ...(existing.type || []),
                            ...(entity.type || []),
                        ]),
                    ],
                    facets: mergedFacets,
                });
            } else {
                entityMap.set(entity.name, entity);
            }
        });

        // Merge actions
        const mergedActions = [
            ...baseKnowledge.actions,
            ...extractedKnowledge.actions,
        ];

        return {
            entities: Array.from(entityMap.values()).slice(0, 40),
            topics: mergedTopics,
            actions: mergedActions.slice(0, 50),
            inverseActions: [
                ...baseKnowledge.inverseActions,
                ...extractedKnowledge.inverseActions,
            ].slice(0, 20),
        };
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
                facets: [],
            };

            // Temporal facets for ordering queries
            if (this.bookmarkDate) {
                const bookmarkDate = new Date(this.bookmarkDate);
                domainEntity.facets.push({
                    name: "bookmarkDate",
                    value: this.bookmarkDate,
                });
                domainEntity.facets.push({
                    name: "bookmarkYear",
                    value: bookmarkDate.getFullYear().toString(),
                });
            }

            if (this.visitDate) {
                const visitDate = new Date(this.visitDate);
                domainEntity.facets.push({
                    name: "visitDate",
                    value: this.visitDate,
                });
                domainEntity.facets.push({
                    name: "visitYear",
                    value: visitDate.getFullYear().toString(),
                });
            }

            // Frequency facets for popularity queries
            if (this.visitCount !== undefined) {
                domainEntity.facets.push({
                    name: "visitCount",
                    value: this.visitCount.toString(),
                });
                const frequency = this.calculateVisitFrequency();
                domainEntity.facets.push({
                    name: "visitFrequency",
                    value: frequency,
                });
            }

            // Category and source facets for filtering
            if (this.pageType) {
                domainEntity.facets.push({
                    name: "category",
                    value: this.pageType,
                });
                const confidence = this.calculatePageTypeConfidence();
                domainEntity.facets.push({
                    name: "categoryConfidence",
                    value: confidence.toString(),
                });
            }

            if (this.websiteSource) {
                domainEntity.facets.push({
                    name: "source",
                    value: this.websiteSource,
                });
            }

            // Folder context for bookmarks
            if (this.folder && this.websiteSource === "bookmark") {
                domainEntity.facets.push({
                    name: "folder",
                    value: this.folder,
                });
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
        const actionVerb =
            this.websiteSource === "bookmark" ? "bookmarked" : "visited";
        const action: any = {
            verbs: [actionVerb],
            verbTense: "past",
            subjectEntityName: "user",
            objectEntityName: this.domain || this.url,
            indirectObjectEntityName: "none",
            params: [],
        };

        // Add temporal context to actions as parameters
        const relevantDate = this.bookmarkDate || this.visitDate;
        if (relevantDate) {
            const date = new Date(relevantDate);
            action.params.push({ name: "actionDate", value: relevantDate });
            action.params.push({
                name: "actionYear",
                value: date.getFullYear().toString(),
            });
        }

        // Add frequency context to actions as parameters
        if (this.visitCount !== undefined) {
            action.params.push({
                name: "actionFrequency",
                value: this.visitCount.toString(),
            });
        }

        actions.push(action);

        // Basic content-derived knowledge
        this.addBasicContentTopics(topics);

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

    private addBasicContentTopics(topics: string[]): void {
        // Basic content analysis from page content
        if (this.pageContent) {
            // Add headings as topics
            this.pageContent.headings.forEach((heading) => {
                topics.push(heading);
                topics.push(`topic: ${heading}`);
            });

            // Content characteristics
            if (
                this.pageContent.codeBlocks &&
                this.pageContent.codeBlocks.length > 0
            ) {
                topics.push("contains code examples");
                topics.push("programming tutorial");
                topics.push("technical documentation");
            }

            // Reading time context
            if (this.pageContent.readingTime > 10) {
                topics.push("long form content");
                topics.push("detailed article");
            } else if (this.pageContent.readingTime < 3) {
                topics.push("quick read");
                topics.push("short content");
            }
        }

        // Meta tag derived knowledge
        if (this.metaTags?.keywords) {
            this.metaTags.keywords.forEach((keyword) => {
                topics.push(keyword);
                topics.push(`keyword: ${keyword}`);
            });
        }
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
            const chunks = websiteToTextChunks(
                pageContent,
                metadata.title,
                metadata.url,
                2000, // Default chunk size, can be made configurable
            );
            pageContent = chunks;
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
    const knowledge = meta.getKnowledge(); // Extract knowledge from metadata
    return new Website(
        meta,
        pageContent || visitInfo.description || "",
        [],
        knowledge,
    );
}
