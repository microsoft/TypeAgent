// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversation as kpLib } from "knowledge-processor";
import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../actionHandler.mjs";
import {
    ContentInput,
    EnhancedKnowledgeResult,
    UnifiedExtractionMode,
    UNIFIED_EXTRACTION_MODES,
    QualityMetrics,
    BatchProgress
} from "./types.mjs";
import { StrictAIModelManager } from "./aiModelManager.mjs";
import { BatchProcessor } from "./batchProcessor.mjs";
import { MetadataExtractor, BasicKnowledge } from "./metadataExtractor.mjs";
import { 
    EnhancedURLAnalyzer, 
    EnhancedDomainClassifier, 
    EnhancedTitleProcessor 
} from "./enhancedMetadata.mjs";

export class UnifiedKnowledgeExtractor {
    private aiModelManager: StrictAIModelManager;
    private metadataExtractor: MetadataExtractor;
    private cache: Map<string, EnhancedKnowledgeResult> = new Map();
    
    constructor(context: SessionContext<BrowserActionContext>) {
        this.aiModelManager = new StrictAIModelManager(context);
        this.metadataExtractor = new (class implements MetadataExtractor {
            private urlAnalyzer = new EnhancedURLAnalyzer();
            private domainClassifier = new EnhancedDomainClassifier();
            private titleProcessor = new EnhancedTitleProcessor();
            
            extractFromUrl(url: string) {
                const urlInfo = this.urlAnalyzer.analyze(url);
                const domainInfo = this.domainClassifier.classify(urlInfo.domain);
                
                return {
                    entities: [{
                        name: urlInfo.domain,
                        type: ['website', 'domain', domainInfo.category],
                        facets: [
                            { name: 'domainType', value: domainInfo.type },
                            { name: 'subdomain', value: urlInfo.subdomain || 'www' },
                            { name: 'pathSegments', value: urlInfo.pathSegments.length.toString() },
                            { name: 'category', value: domainInfo.category }
                        ]
                    }],
                    topics: [
                        ...urlInfo.pathSegments.filter(segment => segment.length > 2),
                        ...domainInfo.keywords,
                        domainInfo.category
                    ],
                    actions: [],
                    confidence: domainInfo.confidence
                };
            }
            
            extractFromTitle(title: string) {
                const titleInfo = this.titleProcessor.process(title);
                
                return {
                    entities: titleInfo.entities.map(entity => ({
                        name: entity,
                        type: ['concept'],
                        facets: [
                            { name: 'source', value: 'title' },
                            { name: 'confidence', value: titleInfo.confidence.toString() }
                        ]
                    })),
                    topics: titleInfo.keywords,
                    actions: [],
                    confidence: titleInfo.confidence
                };
            }
            
            extractTemporal(visitDate?: string, bookmarkDate?: string) {
                const facets: any = {};
                if (visitDate) {
                    facets.visitDate = visitDate;
                    facets.visitYear = new Date(visitDate).getFullYear().toString();
                }
                if (bookmarkDate) {
                    facets.bookmarkDate = bookmarkDate;
                    facets.bookmarkYear = new Date(bookmarkDate).getFullYear().toString();
                }
                return facets;
            }
            
            extractDomain(url: string) {
                const domain = this.extractDomainFromUrl(url);
                return {
                    name: domain,
                    type: ['website', 'domain'],
                    facets: [
                        { name: 'domain', value: domain },
                        { name: 'url', value: url }
                    ],
                    domain,
                    confidence: 0.9
                };
            }
            
            mergeWithAIKnowledge(metadata: any, aiKnowledge: kpLib.KnowledgeResponse) {
                return {
                    entities: [...metadata.entities, ...aiKnowledge.entities],
                    topics: [...new Set([...metadata.topics, ...aiKnowledge.topics])],
                    actions: [...metadata.actions, ...aiKnowledge.actions],
                    inverseActions: aiKnowledge.inverseActions || []
                };
            }
            
            private extractDomainFromUrl(url: string): string {
                try {
                    return new URL(url).hostname;
                } catch {
                    return url;
                }
            }
        })();
    }
    
    async extractKnowledge(
        content: ContentInput,
        mode: UnifiedExtractionMode
    ): Promise<EnhancedKnowledgeResult> {
        const startTime = Date.now();
        const modeConfig = UNIFIED_EXTRACTION_MODES[mode];
        
        if (modeConfig.enableAI) {
            this.aiModelManager.validateAvailability();
        }
        
        const contentHash = this.generateContentHash(content);
        
        const cached = this.cache.get(contentHash);
        if (cached) {
            return cached;
        }
        
        let knowledge: kpLib.KnowledgeResponse;
        
        if (mode === 'basic') {
            knowledge = await this.extractMetadataKnowledge(content);
        } else {
            knowledge = await this.extractAIKnowledge(content, modeConfig);
        }
        
        const qualityMetrics = this.calculateQualityMetrics(
            knowledge,
            content,
            modeConfig,
            Date.now() - startTime
        );
        
        const result: EnhancedKnowledgeResult = {
            knowledge,
            qualityMetrics,
            source: content.source,
            extractionMode: mode,
            timestamp: new Date().toISOString()
        };
        
        this.cache.set(contentHash, result);
        
        return result;
    }
    
    async extractBatch(
        contents: ContentInput[],
        mode: UnifiedExtractionMode,
        progressCallback?: (progress: BatchProgress) => void
    ): Promise<EnhancedKnowledgeResult[]> {
        const modeConfig = UNIFIED_EXTRACTION_MODES[mode];
        
        if (modeConfig.enableAI) {
            this.aiModelManager.validateAvailability();
        }
        
        const batchProcessor = new BatchProcessor(modeConfig);
        
        return await batchProcessor.process(
            contents,
            (content) => this.extractKnowledge(content, mode),
            progressCallback
        );
    }
    
    private async extractMetadataKnowledge(content: ContentInput): Promise<kpLib.KnowledgeResponse> {
        const urlKnowledge = this.metadataExtractor.extractFromUrl(content.url);
        const titleKnowledge = content.title ? 
            this.metadataExtractor.extractFromTitle(content.title) : 
            { entities: [], topics: [], actions: [], confidence: 0 };
        
        return {
            entities: [...urlKnowledge.entities, ...titleKnowledge.entities],
            topics: [...new Set([...urlKnowledge.topics, ...titleKnowledge.topics])],
            actions: [...urlKnowledge.actions, ...titleKnowledge.actions],
            inverseActions: []
        };
    }
    
    private async extractAIKnowledge(
        content: ContentInput, 
        modeConfig: any
    ): Promise<kpLib.KnowledgeResponse> {
        const textContent = this.prepareTextContent(content);
        
        if (!textContent || textContent.length < 100) {
            return this.extractMetadataKnowledge(content);
        }
        
        try {
            const aiKnowledge = await this.aiModelManager.extractKnowledge(textContent);
            const metadataKnowledge = await this.extractMetadataKnowledge(content);
            
            const metadataAsBasic: BasicKnowledge = {
                entities: metadataKnowledge.entities,
                topics: metadataKnowledge.topics,
                actions: metadataKnowledge.actions,
                confidence: 0.8
            };
            
            return this.metadataExtractor.mergeWithAIKnowledge(metadataAsBasic, aiKnowledge);
        } catch (error) {
            console.warn('AI extraction failed, falling back to metadata:', error);
            return this.extractMetadataKnowledge(content);
        }
    }
    
    private prepareTextContent(content: ContentInput): string {
        if (content.textContent) {
            return content.textContent;
        }
        
        if (content.htmlFragments) {
            return content.htmlFragments
                .map((fragment) => fragment.text || "")
                .join("\n\n")
                .trim();
        }
        
        if (content.htmlContent) {
            return content.htmlContent.replace(/<[^>]*>/g, ' ').trim();
        }
        
        return content.title || '';
    }
    
    private generateContentHash(content: ContentInput): string {
        const textContent = this.prepareTextContent(content);
        const hashInput = `${content.url}:${content.title}:${textContent.substring(0, 1000)}`;
        
        let hash = 0;
        for (let i = 0; i < hashInput.length; i++) {
            const char = hashInput.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }
    
    private calculateQualityMetrics(
        knowledge: kpLib.KnowledgeResponse,
        content: ContentInput,
        modeConfig: any,
        extractionTime: number
    ): QualityMetrics {
        const entityCount = knowledge.entities.length;
        const topicCount = knowledge.topics.length;
        const actionCount = knowledge.actions.length;
        
        let confidence = 0.5;
        
        if (entityCount > 0) confidence += 0.1;
        if (topicCount > 2) confidence += 0.1;
        if (actionCount > 0) confidence += 0.1;
        if (modeConfig.enableAI) confidence += 0.2;
        
        confidence = Math.min(confidence, 1.0);
        
        return {
            confidence,
            entityCount,
            topicCount,
            actionCount,
            extractionTime
        };
    }
}
