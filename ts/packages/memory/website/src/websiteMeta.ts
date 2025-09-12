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
import { splitLargeTextIntoChunks } from "knowledge-processor";
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
                const existingFacetNames = new Set(
                    domainEntity.facets.map((f: any) => f.name),
                );

                if (!existingFacetNames.has("bookmarkDate")) {
                    domainEntity.facets.push({
                        name: "bookmarkDate",
                        value: this.bookmarkDate,
                    });
                }
                if (!existingFacetNames.has("bookmarkYear")) {
                    domainEntity.facets.push({
                        name: "bookmarkYear",
                        value: bookmarkDate.getFullYear().toString(),
                    });
                }
            }

            if (this.visitDate) {
                const visitDate = new Date(this.visitDate);
                const existingFacetNames = new Set(
                    domainEntity.facets.map((f: any) => f.name),
                );

                if (!existingFacetNames.has("visitDate")) {
                    domainEntity.facets.push({
                        name: "visitDate",
                        value: this.visitDate,
                    });
                }
                if (!existingFacetNames.has("visitYear")) {
                    domainEntity.facets.push({
                        name: "visitYear",
                        value: visitDate.getFullYear().toString(),
                    });
                }
            }

            // Frequency facets for popularity queries
            if (this.visitCount !== undefined) {
                const existingFacetNames = new Set(
                    domainEntity.facets.map((f: any) => f.name),
                );

                if (!existingFacetNames.has("visitCount")) {
                    domainEntity.facets.push({
                        name: "visitCount",
                        value: this.visitCount.toString(),
                    });
                }
                if (!existingFacetNames.has("visitFrequency")) {
                    const frequency = this.calculateVisitFrequency();
                    domainEntity.facets.push({
                        name: "visitFrequency",
                        value: frequency,
                    });
                }
            }

            // Category and source facets for filtering
            if (this.pageType) {
                const existingFacetNames = new Set(
                    domainEntity.facets.map((f: any) => f.name),
                );

                if (!existingFacetNames.has("category")) {
                    domainEntity.facets.push({
                        name: "category",
                        value: this.pageType,
                    });
                }
                if (!existingFacetNames.has("categoryConfidence")) {
                    const confidence = this.calculatePageTypeConfidence();
                    domainEntity.facets.push({
                        name: "categoryConfidence",
                        value: confidence.toString(),
                    });
                }
            }

            if (this.websiteSource) {
                const existingFacetNames = new Set(
                    domainEntity.facets.map((f: any) => f.name),
                );

                if (!existingFacetNames.has("source")) {
                    domainEntity.facets.push({
                        name: "source",
                        value: this.websiteSource,
                    });
                }
            }

            // Folder context for bookmarks
            if (this.folder && this.websiteSource === "bookmark") {
                const existingFacetNames = new Set(
                    domainEntity.facets.map((f: any) => f.name),
                );

                if (!existingFacetNames.has("folder")) {
                    domainEntity.facets.push({
                        name: "folder",
                        value: this.folder,
                    });
                }
            }

            // Check if entity with same name already exists
            const existingEntityNames = new Set(entities.map((e) => e.name));
            if (!existingEntityNames.has(domainEntity.name)) {
                entities.push(domainEntity);
            }
        }

        // Frequency-derived topics
        if (this.visitCount !== undefined) {
            let potentialTopics: string[] = [];

            if (this.visitCount > 10) {
                potentialTopics = [
                    "frequently visited site",
                    "popular domain",
                    "often visited",
                ];
            } else if (this.visitCount <= 2) {
                potentialTopics = ["rarely visited site", "infrequent visit"];
            }

            // Add only unique topics
            const existingTopics = new Set(topics);
            for (const topic of potentialTopics) {
                if (!existingTopics.has(topic)) {
                    topics.push(topic);
                    existingTopics.add(topic);
                }
            }
        }

        // Enhanced category topics
        if (this.pageType) {
            const potentialTopics = [
                this.pageType,
                `${this.pageType} site`,
                `${this.pageType} website`,
            ];

            // Add only unique topics
            const existingTopics = new Set(topics);
            for (const topic of potentialTopics) {
                if (!existingTopics.has(topic)) {
                    topics.push(topic);
                    existingTopics.add(topic);
                }
            }
        }

        // Add title as topic if available
        if (this.title) {
            const existingTopics = new Set(topics);
            if (!existingTopics.has(this.title)) {
                topics.push(this.title);
            }
        }

        // Add folder as topic if it's a bookmark
        if (this.folder && this.websiteSource === "bookmark") {
            const potentialTopics = [
                this.folder,
                `bookmark folder: ${this.folder}`,
            ];

            // Add only unique topics
            const existingTopics = new Set(topics);
            for (const topic of potentialTopics) {
                if (!existingTopics.has(topic)) {
                    topics.push(topic);
                    existingTopics.add(topic);
                }
            }
        }

        // Add keywords as topics
        if (this.keywords) {
            const existingTopics = new Set(topics);
            for (const keyword of this.keywords) {
                const potentialTopics = [keyword, `keyword: ${keyword}`];

                for (const topic of potentialTopics) {
                    if (!existingTopics.has(topic)) {
                        topics.push(topic);
                        existingTopics.add(topic);
                    }
                }
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

        // Check if action already exists (compare by verb, subject, and object)
        const actionExists = actions.some(
            (existingAction) =>
                existingAction.verbs?.[0] === action.verbs[0] &&
                existingAction.subjectEntityName === action.subjectEntityName &&
                existingAction.objectEntityName === action.objectEntityName,
        );

        if (!actionExists) {
            actions.push(action);
        }

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
        const existingTopics = new Set(topics);

        // Basic content analysis from page content
        if (this.pageContent) {
            // Add headings as topics
            this.pageContent.headings.forEach((heading) => {
                const potentialTopics = [heading, `topic: ${heading}`];

                for (const topic of potentialTopics) {
                    if (!existingTopics.has(topic)) {
                        topics.push(topic);
                        existingTopics.add(topic);
                    }
                }
            });
        }

        // Meta tag derived knowledge
        if (this.metaTags?.keywords) {
            this.metaTags.keywords.forEach((keyword) => {
                const potentialTopics = [keyword, `keyword: ${keyword}`];

                for (const topic of potentialTopics) {
                    if (!existingTopics.has(topic)) {
                        topics.push(topic);
                        existingTopics.add(topic);
                    }
                }
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

        if (Array.isArray(pageContent)) {
            this.textChunks = pageContent;
        } else {
            this.textChunks = [pageContent];
        }
    }

    static createWithProcessedContent(
        metadata: WebsiteMeta,
        processedContent: string,
        tags: string[] = [],
        knowledge?: kpLib.KnowledgeResponse | undefined,
        deletionInfo?: kp.DeletionInfo | undefined,
    ): Website {
        let content = "";
        if (metadata.title) {
            content += `Title: ${metadata.title}\n`;
        }
        if (metadata.url) {
            content += `URL: ${metadata.url}\n\n`;
        }
        content += processedContent;

        const chunks = Array.from(
            splitLargeTextIntoChunks(content, 2000, true),
        );

        return new Website(
            metadata,
            chunks,
            tags,
            knowledge,
            deletionInfo,
            false,
        );
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
