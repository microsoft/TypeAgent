// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import { conversation as kpLib } from "knowledge-processor";
import { 
    PageContent, 
    MetaTagCollection, 
    StructuredDataCollection,
    ActionInfo 
} from "./contentExtractor.js";
import { ContentAnalysis } from "./schemas/contentAnalysisSchema.js";

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
    intelligentAnalysis?: ContentAnalysis;
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
    public intelligentAnalysis?: ContentAnalysis;

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
        if (visitInfo.intelligentAnalysis !== undefined)
            this.intelligentAnalysis = visitInfo.intelligentAnalysis;
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

        // NEW: LLM-based intelligent content analysis
        if (this.intelligentAnalysis) {
            this.addIntelligentTopics(topics, this.intelligentAnalysis);
        } else {
            // Fallback: Basic content-derived knowledge (legacy approach)
            this.addBasicContentTopics(topics);
        }

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

    private addIntelligentTopics(topics: string[], analysis: ContentAnalysis): void {
        // Content type and classification
        topics.push(analysis.contentType);
        topics.push(`${analysis.contentType} content`);
        
        // Technical level
        topics.push(`${analysis.technicalLevel} level`);
        topics.push(`for ${analysis.technicalLevel} users`);
        
        // Content length
        topics.push(analysis.contentLength.replace('_', ' '));
        if (analysis.contentLength === 'comprehensive') {
            topics.push("detailed content");
            topics.push("in-depth coverage");
        }
        
        // Technologies (high-value search terms)
        analysis.technologies.forEach(tech => {
            topics.push(tech);
            topics.push(`${tech} content`);
            topics.push(`${tech} ${analysis.contentType}`);
        });
        
        // Domains and concepts
        analysis.domains.forEach(domain => {
            topics.push(domain);
            topics.push(`${domain} content`);
        });
        
        analysis.concepts.forEach(concept => {
            topics.push(concept);
            topics.push(`${concept} topic`);
        });
        
        // Main and secondary topics
        analysis.mainTopics.forEach(topic => {
            topics.push(topic);
            topics.push(`primary: ${topic}`);
        });
        
        analysis.secondaryTopics.forEach(topic => {
            topics.push(topic);
        });
        
        // Content characteristics
        if (analysis.hasProgrammingCode) {
            topics.push("programming code");
            topics.push("code examples");
            topics.push("technical tutorial");
        }
        
        if (analysis.hasVisualContent) {
            topics.push("visual content");
            topics.push("diagrams and images");
        }
        
        if (analysis.hasDownloadableContent) {
            topics.push("downloadable resources");
            topics.push("files available");
        }
        
        if (analysis.requiresSignup) {
            topics.push("requires registration");
            topics.push("gated content");
        }
        
        // Educational value
        if (analysis.isEducational) {
            topics.push("educational content");
            topics.push("learning material");
        }
        
        if (analysis.isReference) {
            topics.push("reference material");
            topics.push("documentation");
        }
        
        if (analysis.isPracticalExample) {
            topics.push("practical examples");
            topics.push("hands-on content");
        }
        
        // Target audience
        analysis.targetAudience.forEach(audience => {
            topics.push(`for ${audience}`);
            topics.push(`${audience} focused`);
        });
        
        // Primary purpose as searchable topic
        if (analysis.primaryPurpose) {
            topics.push(analysis.primaryPurpose);
        }
        
        // Quality indicators
        if (analysis.isComprehensive) {
            topics.push("comprehensive coverage");
            topics.push("thorough content");
        }
        
        if (analysis.isUpToDate) {
            topics.push("current content");
            topics.push("up to date");
        }
        
        if (analysis.isWellStructured) {
            topics.push("well organized");
            topics.push("structured content");
        }
        
        // Interactivity level
        switch (analysis.interactivityLevel) {
            case 'interactive':
                topics.push("interactive content");
                topics.push("hands-on experience");
                break;
            case 'highly_interactive':
                topics.push("highly interactive");
                topics.push("immersive experience");
                break;
        }
    }

    private addBasicContentTopics(topics: string[]): void {
        // Fallback to basic content analysis when LLM analysis is not available
        if (this.pageContent) {
            // Add headings as topics
            this.pageContent.headings.forEach(heading => {
                topics.push(heading);
                topics.push(`topic: ${heading}`);
            });
            
            // Content characteristics
            if (this.pageContent.codeBlocks && this.pageContent.codeBlocks.length > 0) {
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
            this.metaTags.keywords.forEach(keyword => {
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
