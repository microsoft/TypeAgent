// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { SessionContext } from "@typeagent/agent-sdk";
import { BrowserActionContext } from "../../actionHandler.mjs";
import * as website from "website-memory";
import { UnifiedKnowledgeExtractor } from "./unifiedExtractor.mjs";
import { UnifiedExtractionMode, ContentInput } from "./types.mjs";

export interface MigrationProgress {
    total: number;
    migrated: number;
    skipped: number;
    errors: number;
    currentSite: string;
    percentage: number;
}

export interface MigrationResult {
    total: number;
    migrated: number;
    skipped: number;
    errors: MigrationError[];
    duration: number;
    qualityImprovement: QualityImprovement;
}

export interface MigrationError {
    url: string;
    error: string;
    timestamp: string;
}

export interface QualityImprovement {
    avgEntitiesBefore: number;
    avgEntitiesAfter: number;
    avgTopicsBefore: number;
    avgTopicsAfter: number;
    avgActionsBefore: number;
    avgActionsAfter: number;
    qualityScoreImprovement: number;
}

export class KnowledgeMigrationManager {
    private websiteCollection: website.WebsiteCollection;
    private unifiedExtractor: UnifiedKnowledgeExtractor;
    
    constructor(
        websiteCollection: website.WebsiteCollection,
        context: SessionContext<BrowserActionContext>
    ) {
        this.websiteCollection = websiteCollection;
        this.unifiedExtractor = new UnifiedKnowledgeExtractor(context);
    }
    
    async migrateExistingContent(
        mode: UnifiedExtractionMode = 'content',
        progressCallback?: (progress: MigrationProgress) => void
    ): Promise<MigrationResult> {
        const startTime = Date.now();
        const websites = this.websiteCollection.messages.getAll();
        const migrationCandidates = websites.filter(site => 
            this.needsMigration(site)
        );
        
        const results: MigrationResult = {
            total: migrationCandidates.length,
            migrated: 0,
            skipped: 0,
            errors: [],
            duration: 0,
            qualityImprovement: {
                avgEntitiesBefore: 0,
                avgEntitiesAfter: 0,
                avgTopicsBefore: 0,
                avgTopicsAfter: 0,
                avgActionsBefore: 0,
                avgActionsAfter: 0,
                qualityScoreImprovement: 0
            }
        };
        
        const qualityBefore = this.calculateQualityMetrics(migrationCandidates);
        
        for (const site of migrationCandidates) {
            try {
                const enhanced = await this.migrateIndividualSite(site, mode);
                if (enhanced) {
                    results.migrated++;
                } else {
                    results.skipped++;
                }
                
                if (progressCallback) {
                    progressCallback({
                        total: results.total,
                        migrated: results.migrated,
                        skipped: results.skipped,
                        errors: results.errors.length,
                        currentSite: (site.metadata as any).url || 'unknown',
                        percentage: Math.round(
                            ((results.migrated + results.skipped + results.errors.length) / results.total) * 100
                        )
                    });
                }
            } catch (error) {
                results.errors.push({
                    url: (site.metadata as any).url || 'unknown',
                    error: error instanceof Error ? error.message : String(error),
                    timestamp: new Date().toISOString()
                });
            }
        }
        
        const qualityAfter = this.calculateQualityMetrics(migrationCandidates);
        results.qualityImprovement = this.calculateQualityImprovement(qualityBefore, qualityAfter);
        results.duration = Date.now() - startTime;
        
        return results;
    }
    
    private needsMigration(site: any): boolean {
        const knowledge = site.getKnowledge();
        
        if (!knowledge) return true;
        
        const hasOnlyBasicEntities = knowledge.entities.every((entity: any) => 
            entity.type.includes('domain') || entity.type.includes('website')
        );
        
        const hasLimitedTopics = knowledge.topics.length < 3;
        const hasNoActions = knowledge.actions.length === 0;
        const hasNoContent = !site.textChunks || site.textChunks.join('').length < 100;
        
        return hasOnlyBasicEntities && hasLimitedTopics && hasNoActions && !hasNoContent;
    }
    
    private async migrateIndividualSite(site: any, mode: UnifiedExtractionMode): Promise<boolean> {
        const metadata = site.metadata as any;
        
        if (!site.textChunks || site.textChunks.join('').length < 100) {
            return false;
        }
        
        const contentInput: ContentInput = {
            url: metadata.url || 'unknown',
            title: metadata.title || metadata.url || 'untitled',
            textContent: site.textChunks.join('\n\n'),
            source: 'index',
            timestamp: metadata.visitDate || metadata.bookmarkDate
        };
        
        const enhanced = await this.unifiedExtractor.extractKnowledge(contentInput, mode);
        
        site.knowledge = enhanced.knowledge;
        
        return true;
    }

    async migrateSingleSite(site: any, mode: UnifiedExtractionMode): Promise<boolean> {
        return this.migrateIndividualSite(site, mode);
    }
    
    private calculateQualityMetrics(sites: any[]): QualityMetrics {
        let totalEntities = 0;
        let totalTopics = 0;
        let totalActions = 0;
        let validSites = 0;
        
        for (const site of sites) {
            const knowledge = site.getKnowledge();
            if (knowledge) {
                totalEntities += knowledge.entities?.length || 0;
                totalTopics += knowledge.topics?.length || 0;
                totalActions += knowledge.actions?.length || 0;
                validSites++;
            }
        }
        
        return {
            avgEntities: validSites > 0 ? totalEntities / validSites : 0,
            avgTopics: validSites > 0 ? totalTopics / validSites : 0,
            avgActions: validSites > 0 ? totalActions / validSites : 0
        };
    }
    
    private calculateQualityImprovement(before: QualityMetrics, after: QualityMetrics): QualityImprovement {
        const entityImprovement = after.avgEntities - before.avgEntities;
        const topicImprovement = after.avgTopics - before.avgTopics;
        const actionImprovement = after.avgActions - before.avgActions;
        
        const overallImprovement = (entityImprovement + topicImprovement + actionImprovement) / 3;
        
        return {
            avgEntitiesBefore: before.avgEntities,
            avgEntitiesAfter: after.avgEntities,
            avgTopicsBefore: before.avgTopics,
            avgTopicsAfter: after.avgTopics,
            avgActionsBefore: before.avgActions,
            avgActionsAfter: after.avgActions,
            qualityScoreImprovement: overallImprovement
        };
    }
    
    async detectMigrationCandidates(): Promise<MigrationCandidate[]> {
        const websites = this.websiteCollection.messages.getAll();
        const candidates: MigrationCandidate[] = [];
        
        for (const site of websites) {
            if (this.needsMigration(site)) {
                const knowledge = site.getKnowledge();
                const metadata = site.metadata as any;
                candidates.push({
                    url: metadata.url || 'unknown',
                    title: metadata.title || metadata.url || 'untitled',
                    currentEntityCount: knowledge?.entities?.length || 0,
                    currentTopicCount: knowledge?.topics?.length || 0,
                    currentActionCount: knowledge?.actions?.length || 0,
                    contentLength: site.textChunks?.join('').length || 0,
                    lastIndexed: metadata.visitDate || metadata.bookmarkDate || 'unknown',
                    estimatedImprovement: this.estimateImprovement(site)
                });
            }
        }
        
        return candidates.sort((a, b) => b.estimatedImprovement - a.estimatedImprovement);
    }
    
    private estimateImprovement(site: any): number {
        const contentLength = site.textChunks?.join('').length || 0;
        const currentKnowledge = site.getKnowledge();
        const currentScore = (currentKnowledge?.entities?.length || 0) + 
                           (currentKnowledge?.topics?.length || 0) + 
                           (currentKnowledge?.actions?.length || 0);
        
        const estimatedScore = Math.min(contentLength / 100, 20);
        return Math.max(0, estimatedScore - currentScore);
    }
}

interface QualityMetrics {
    avgEntities: number;
    avgTopics: number;
    avgActions: number;
}

export interface MigrationCandidate {
    url: string;
    title: string;
    currentEntityCount: number;
    currentTopicCount: number;
    currentActionCount: number;
    contentLength: number;
    lastIndexed: string;
    estimatedImprovement: number;
}
