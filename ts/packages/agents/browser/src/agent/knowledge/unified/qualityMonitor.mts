// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { UnifiedExtractionMode, EnhancedKnowledgeResult } from "./types.mjs";

export interface QualityMonitor {
    assessKnowledgeQuality(result: EnhancedKnowledgeResult): QualityAssessment;
    compareExtractionModes(results: Record<UnifiedExtractionMode, EnhancedKnowledgeResult>): ModeComparison;
    trackQualityTrends(results: EnhancedKnowledgeResult[]): QualityTrends;
    generateQualityReport(): QualityReport;
}

export interface QualityAssessment {
    overallScore: number;
    entityQuality: EntityQuality;
    topicQuality: TopicQuality;
    actionQuality: ActionQuality;
    consistencyScore: number;
    completenessScore: number;
    relevanceScore: number;
    recommendations: string[];
}

export interface EntityQuality {
    count: number;
    diversity: number;
    specificity: number;
    accuracy: number;
    duplicates: number;
}

export interface TopicQuality {
    count: number;
    coverage: number;
    specificity: number;
    relevance: number;
    hierarchy: number;
}

export interface ActionQuality {
    count: number;
    detectability: number;
    completeness: number;
    actionability: number;
    confidence: number;
}

export interface ModeComparison {
    bestMode: UnifiedExtractionMode;
    qualityScores: Record<UnifiedExtractionMode, number>;
    strengthsByMode: Record<UnifiedExtractionMode, string[]>;
    weaknessesByMode: Record<UnifiedExtractionMode, string[]>;
    recommendations: ModeRecommendation[];
}

export interface ModeRecommendation {
    mode: UnifiedExtractionMode;
    useCase: string;
    reasoning: string;
    expectedQuality: number;
}

export interface QualityTrends {
    timeRange: string;
    overallTrend: 'improving' | 'stable' | 'declining';
    trendScore: number;
    keyInsights: string[];
    anomalies: QualityAnomaly[];
}

export interface QualityAnomaly {
    timestamp: string;
    type: 'spike' | 'drop' | 'inconsistency';
    description: string;
    impact: 'low' | 'medium' | 'high';
    possibleCauses: string[];
}

export interface QualityReport {
    summary: QualitySummary;
    trends: QualityTrends;
    modeAnalysis: ModeAnalysis;
    recommendations: RecommendationSet;
    dataQuality: DataQualityMetrics;
}

export interface QualitySummary {
    totalExtractions: number;
    averageQuality: number;
    qualityDistribution: QualityDistribution;
    topPerformingModes: UnifiedExtractionMode[];
    qualityBySource: Record<string, number>;
}

export interface QualityDistribution {
    excellent: number; // 0.8-1.0
    good: number;      // 0.6-0.8
    fair: number;      // 0.4-0.6
    poor: number;      // 0.0-0.4
}

export interface ModeAnalysis {
    modeEffectiveness: Record<UnifiedExtractionMode, ModeEffectiveness>;
    optimalModeSelection: ModeSelectionGuidance;
    performanceMatrix: PerformanceMatrix;
}

export interface ModeEffectiveness {
    qualityScore: number;
    consistencyScore: number;
    speedScore: number;
    costEfficiency: number;
    recommendedUsage: string[];
}

export interface ModeSelectionGuidance {
    contentTypeRecommendations: Record<string, UnifiedExtractionMode>;
    sourcePriorityMapping: Record<string, UnifiedExtractionMode>;
    volumeBasedGuidance: VolumeGuidance[];
}

export interface VolumeGuidance {
    itemRange: string;
    recommendedMode: UnifiedExtractionMode;
    reasoning: string;
    expectedQuality: number;
}

export interface PerformanceMatrix {
    accuracy: Record<UnifiedExtractionMode, number>;
    speed: Record<UnifiedExtractionMode, number>;
    completeness: Record<UnifiedExtractionMode, number>;
    consistency: Record<UnifiedExtractionMode, number>;
}

export interface RecommendationSet {
    immediate: ImmediateRecommendation[];
    strategic: StrategicRecommendation[];
    optimization: OptimizationRecommendation[];
}

export interface ImmediateRecommendation {
    priority: 'high' | 'medium' | 'low';
    action: string;
    impact: string;
    effort: 'low' | 'medium' | 'high';
}

export interface StrategicRecommendation {
    timeframe: string;
    objective: string;
    actions: string[];
    expectedBenefit: string;
}

export interface OptimizationRecommendation {
    area: string;
    currentPerformance: number;
    targetPerformance: number;
    improvementSteps: string[];
}

export interface DataQualityMetrics {
    completeness: number;
    consistency: number;
    accuracy: number;
    timeliness: number;
    validity: number;
    uniqueness: number;
}

export class UnifiedQualityMonitor implements QualityMonitor {
    private qualityHistory: QualityRecord[] = [];
    
    assessKnowledgeQuality(result: EnhancedKnowledgeResult): QualityAssessment {
        const entityQuality = this.assessEntityQuality(result.knowledge.entities);
        const topicQuality = this.assessTopicQuality(result.knowledge.topics);
        const actionQuality = this.assessActionQuality(result.knowledge.actions);
        
        const consistencyScore = this.calculateConsistencyScore(result);
        const completenessScore = this.calculateCompletenessScore(result);
        const relevanceScore = this.calculateRelevanceScore(result);
        
        const overallScore = (
            entityQuality.accuracy * 0.3 +
            topicQuality.relevance * 0.3 +
            actionQuality.confidence * 0.2 +
            consistencyScore * 0.1 +
            completenessScore * 0.1
        );
        
        const recommendations = this.generateRecommendations(
            entityQuality,
            topicQuality,
            actionQuality,
            overallScore
        );
        
        const assessment: QualityAssessment = {
            overallScore,
            entityQuality,
            topicQuality,
            actionQuality,
            consistencyScore,
            completenessScore,
            relevanceScore,
            recommendations
        };
        
        this.recordQualityAssessment(result, assessment);
        
        return assessment;
    }
    
    compareExtractionModes(results: Record<UnifiedExtractionMode, EnhancedKnowledgeResult>): ModeComparison {
        const qualityScores: Record<UnifiedExtractionMode, number> = {} as any;
        const strengthsByMode: Record<UnifiedExtractionMode, string[]> = {} as any;
        const weaknessesByMode: Record<UnifiedExtractionMode, string[]> = {} as any;
        
        Object.entries(results).forEach(([mode, result]) => {
            const assessment = this.assessKnowledgeQuality(result);
            qualityScores[mode as UnifiedExtractionMode] = assessment.overallScore;
            strengthsByMode[mode as UnifiedExtractionMode] = this.identifyStrengths(assessment);
            weaknessesByMode[mode as UnifiedExtractionMode] = this.identifyWeaknesses(assessment);
        });
        
        const bestMode = Object.entries(qualityScores).reduce((best, [mode, score]) => 
            score > qualityScores[best] ? mode as UnifiedExtractionMode : best
        , 'basic' as UnifiedExtractionMode);
        
        const recommendations = this.generateModeRecommendations(qualityScores, strengthsByMode);
        
        return {
            bestMode,
            qualityScores,
            strengthsByMode,
            weaknessesByMode,
            recommendations
        };
    }
    
    trackQualityTrends(results: EnhancedKnowledgeResult[]): QualityTrends {
        const scores = results.map(result => this.assessKnowledgeQuality(result).overallScore);
        const trendScore = this.calculateTrendScore(scores);
        const overallTrend = this.determineTrend(scores);
        const keyInsights = this.extractKeyInsights(results);
        const anomalies = this.detectAnomalies(results);
        
        return {
            timeRange: this.calculateTimeRange(results),
            overallTrend,
            trendScore,
            keyInsights,
            anomalies
        };
    }
    
    generateQualityReport(): QualityReport {
        const summary = this.generateQualitySummary();
        const trends = this.generateTrendsAnalysis();
        const modeAnalysis = this.generateModeAnalysis();
        const recommendations = this.generateRecommendationSet();
        const dataQuality = this.assessDataQuality();
        
        return {
            summary,
            trends,
            modeAnalysis,
            recommendations,
            dataQuality
        };
    }
    
    private assessEntityQuality(entities: any[]): EntityQuality {
        const count = entities.length;
        const diversity = this.calculateEntityDiversity(entities);
        const specificity = this.calculateEntitySpecificity(entities);
        const accuracy = this.estimateEntityAccuracy(entities);
        const duplicates = this.countDuplicateEntities(entities);
        
        return {
            count,
            diversity,
            specificity,
            accuracy,
            duplicates
        };
    }
    
    private assessTopicQuality(topics: string[]): TopicQuality {
        const count = topics.length;
        const coverage = this.calculateTopicCoverage(topics);
        const specificity = this.calculateTopicSpecificity(topics);
        const relevance = this.calculateTopicRelevance(topics);
        const hierarchy = this.calculateTopicHierarchy(topics);
        
        return {
            count,
            coverage,
            specificity,
            relevance,
            hierarchy
        };
    }
    
    private assessActionQuality(actions: any[]): ActionQuality {
        const count = actions.length;
        const detectability = this.calculateActionDetectability(actions);
        const completeness = this.calculateActionCompleteness(actions);
        const actionability = this.calculateActionability(actions);
        const confidence = this.calculateActionConfidence(actions);
        
        return {
            count,
            detectability,
            completeness,
            actionability,
            confidence
        };
    }
    
    private calculateConsistencyScore(result: EnhancedKnowledgeResult): number {
        // Assess consistency between entities, topics, and actions
        const entityTopicAlignment = this.calculateEntityTopicAlignment(result.knowledge);
        const actionEntityAlignment = this.calculateActionEntityAlignment(result.knowledge);
        return (entityTopicAlignment + actionEntityAlignment) / 2;
    }
    
    private calculateCompletenessScore(result: EnhancedKnowledgeResult): number {
        // Assess how complete the extraction is relative to content
        const expectedEntities = Math.min(result.qualityMetrics.entityCount * 1.2, 20);
        const expectedTopics = Math.min(result.qualityMetrics.topicCount * 1.1, 15);
        const expectedActions = Math.min(result.qualityMetrics.actionCount * 1.1, 10);
        
        const entityCompleteness = Math.min(result.knowledge.entities.length / expectedEntities, 1);
        const topicCompleteness = Math.min(result.knowledge.topics.length / expectedTopics, 1);
        const actionCompleteness = Math.min(result.knowledge.actions.length / expectedActions, 1);
        
        return (entityCompleteness + topicCompleteness + actionCompleteness) / 3;
    }
    
    private calculateRelevanceScore(result: EnhancedKnowledgeResult): number {
        // Assess how relevant the extracted knowledge is
        return result.qualityMetrics.confidence;
    }
    
    private generateRecommendations(
        entityQuality: EntityQuality,
        topicQuality: TopicQuality,
        actionQuality: ActionQuality,
        overallScore: number
    ): string[] {
        const recommendations: string[] = [];
        
        if (entityQuality.duplicates > 2) {
            recommendations.push("Consider entity deduplication to improve quality");
        }
        
        if (topicQuality.specificity < 0.5) {
            recommendations.push("Topics are too generic - consider more specific extraction");
        }
        
        if (actionQuality.confidence < 0.6) {
            recommendations.push("Action detection confidence is low - review detection criteria");
        }
        
        if (overallScore < 0.5) {
            recommendations.push("Overall quality is below threshold - consider using enhanced mode");
        }
        
        return recommendations;
    }
    
    private recordQualityAssessment(result: EnhancedKnowledgeResult, assessment: QualityAssessment): void {
        this.qualityHistory.push({
            timestamp: new Date().toISOString(),
            mode: result.extractionMode,
            source: result.source,
            qualityScore: assessment.overallScore,
            entityCount: result.knowledge.entities.length,
            topicCount: result.knowledge.topics.length,
            actionCount: result.knowledge.actions.length,
            processingTime: result.qualityMetrics.extractionTime
        });
    }
    
    // Placeholder implementations for complex calculations
    private calculateEntityDiversity(entities: any[]): number { return 0.7; }
    private calculateEntitySpecificity(entities: any[]): number { return 0.6; }
    private estimateEntityAccuracy(entities: any[]): number { return 0.8; }
    private countDuplicateEntities(entities: any[]): number { return 0; }
    private calculateTopicCoverage(topics: string[]): number { return 0.7; }
    private calculateTopicSpecificity(topics: string[]): number { return 0.6; }
    private calculateTopicRelevance(topics: string[]): number { return 0.8; }
    private calculateTopicHierarchy(topics: string[]): number { return 0.5; }
    private calculateActionDetectability(actions: any[]): number { return 0.7; }
    private calculateActionCompleteness(actions: any[]): number { return 0.6; }
    private calculateActionability(actions: any[]): number { return 0.8; }
    private calculateActionConfidence(actions: any[]): number { return 0.7; }
    private calculateEntityTopicAlignment(knowledge: any): number { return 0.8; }
    private calculateActionEntityAlignment(knowledge: any): number { return 0.7; }
    private identifyStrengths(assessment: QualityAssessment): string[] { return []; }
    private identifyWeaknesses(assessment: QualityAssessment): string[] { return []; }
    private generateModeRecommendations(scores: any, strengths: any): ModeRecommendation[] { return []; }
    private calculateTrendScore(scores: number[]): number { return 0.5; }
    private determineTrend(scores: number[]): 'improving' | 'stable' | 'declining' { return 'stable'; }
    private extractKeyInsights(results: EnhancedKnowledgeResult[]): string[] { return []; }
    private detectAnomalies(results: EnhancedKnowledgeResult[]): QualityAnomaly[] { return []; }
    private calculateTimeRange(results: EnhancedKnowledgeResult[]): string { return '24h'; }
    private generateQualitySummary(): QualitySummary { return {} as any; }
    private generateTrendsAnalysis(): QualityTrends { return {} as any; }
    private generateModeAnalysis(): ModeAnalysis { return {} as any; }
    private generateRecommendationSet(): RecommendationSet { return {} as any; }
    private assessDataQuality(): DataQualityMetrics { return {} as any; }
}

interface QualityRecord {
    timestamp: string;
    mode: UnifiedExtractionMode;
    source: string;
    qualityScore: number;
    entityCount: number;
    topicCount: number;
    actionCount: number;
    processingTime: number;
}
