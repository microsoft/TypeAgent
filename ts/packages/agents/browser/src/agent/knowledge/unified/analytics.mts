// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { UnifiedExtractionMode } from "./types.mjs";

export interface ExtractionAnalytics {
    trackExtractionMode(mode: UnifiedExtractionMode, source: string): void;
    measureProcessingTime(operation: string, duration: number): void;
    recordQualityScore(extractionId: string, score: number): void;
    reportError(error: ExtractionError): void;
    getAnalyticsSummary(): AnalyticsSummary;
}

export interface ExtractionError {
    operation: string;
    mode: UnifiedExtractionMode;
    source: string;
    error: string;
    timestamp: string;
    url?: string;
}

export interface AnalyticsSummary {
    totalExtractions: number;
    modeDistribution: Record<UnifiedExtractionMode, number>;
    sourceDistribution: Record<string, number>;
    averageProcessingTime: Record<UnifiedExtractionMode, number>;
    averageQualityScore: Record<UnifiedExtractionMode, number>;
    errorRate: Record<UnifiedExtractionMode, number>;
    trends: {
        dailyExtractions: DailyStats[];
        qualityTrend: QualityTrend[];
        performanceTrend: PerformanceTrend[];
    };
}

export interface DailyStats {
    date: string;
    extractions: number;
    avgQuality: number;
    avgProcessingTime: number;
    errors: number;
}

export interface QualityTrend {
    date: string;
    mode: UnifiedExtractionMode;
    avgEntities: number;
    avgTopics: number;
    avgActions: number;
    confidenceScore: number;
}

export interface PerformanceTrend {
    date: string;
    mode: UnifiedExtractionMode;
    avgProcessingTime: number;
    throughput: number;
    concurrentOperations: number;
}

export class UnifiedExtractionAnalytics implements ExtractionAnalytics {
    private extractions: ExtractionRecord[] = [];
    private errors: ExtractionError[] = [];
    private processingTimes: ProcessingTimeRecord[] = [];
    private qualityScores: QualityScoreRecord[] = [];
    
    trackExtractionMode(mode: UnifiedExtractionMode, source: string): void {
        this.extractions.push({
            mode,
            source,
            timestamp: new Date().toISOString(),
            id: this.generateId()
        });
    }
    
    measureProcessingTime(operation: string, duration: number): void {
        this.processingTimes.push({
            operation,
            duration,
            timestamp: new Date().toISOString()
        });
    }
    
    recordQualityScore(extractionId: string, score: number): void {
        this.qualityScores.push({
            extractionId,
            score,
            timestamp: new Date().toISOString()
        });
    }
    
    reportError(error: ExtractionError): void {
        this.errors.push({
            ...error,
            timestamp: new Date().toISOString()
        });
    }
    
    getAnalyticsSummary(): AnalyticsSummary {
        const modeDistribution = this.calculateModeDistribution();
        const sourceDistribution = this.calculateSourceDistribution();
        const averageProcessingTime = this.calculateAverageProcessingTime();
        const averageQualityScore = this.calculateAverageQualityScore();
        const errorRate = this.calculateErrorRate();
        
        return {
            totalExtractions: this.extractions.length,
            modeDistribution,
            sourceDistribution,
            averageProcessingTime,
            averageQualityScore,
            errorRate,
            trends: {
                dailyExtractions: this.calculateDailyStats(),
                qualityTrend: this.calculateQualityTrend(),
                performanceTrend: this.calculatePerformanceTrend()
            }
        };
    }
    
    private calculateModeDistribution(): Record<UnifiedExtractionMode, number> {
        const distribution: Record<UnifiedExtractionMode, number> = {
            basic: 0,
            content: 0,
            actions: 0,
            full: 0
        };
        
        this.extractions.forEach(extraction => {
            distribution[extraction.mode]++;
        });
        
        return distribution;
    }
    
    private calculateSourceDistribution(): Record<string, number> {
        const distribution: Record<string, number> = {};
        
        this.extractions.forEach(extraction => {
            distribution[extraction.source] = (distribution[extraction.source] || 0) + 1;
        });
        
        return distribution;
    }
    
    private calculateAverageProcessingTime(): Record<UnifiedExtractionMode, number> {
        const avgTimes: Record<UnifiedExtractionMode, number> = {
            basic: 0,
            content: 0,
            actions: 0,
            full: 0
        };
        
        const counts: Record<UnifiedExtractionMode, number> = {
            basic: 0,
            content: 0,
            actions: 0,
            full: 0
        };
        
        this.processingTimes.forEach(record => {
            const extraction = this.extractions.find(e => 
                Math.abs(new Date(e.timestamp).getTime() - new Date(record.timestamp).getTime()) < 10000
            );
            
            if (extraction) {
                avgTimes[extraction.mode] += record.duration;
                counts[extraction.mode]++;
            }
        });
        
        Object.keys(avgTimes).forEach(mode => {
            const modeKey = mode as UnifiedExtractionMode;
            if (counts[modeKey] > 0) {
                avgTimes[modeKey] = avgTimes[modeKey] / counts[modeKey];
            }
        });
        
        return avgTimes;
    }
    
    private calculateAverageQualityScore(): Record<UnifiedExtractionMode, number> {
        const avgScores: Record<UnifiedExtractionMode, number> = {
            basic: 0,
            content: 0,
            actions: 0,
            full: 0
        };
        
        const counts: Record<UnifiedExtractionMode, number> = {
            basic: 0,
            content: 0,
            actions: 0,
            full: 0
        };
        
        this.qualityScores.forEach(record => {
            const extraction = this.extractions.find(e => e.id === record.extractionId);
            if (extraction) {
                avgScores[extraction.mode] += record.score;
                counts[extraction.mode]++;
            }
        });
        
        Object.keys(avgScores).forEach(mode => {
            const modeKey = mode as UnifiedExtractionMode;
            if (counts[modeKey] > 0) {
                avgScores[modeKey] = avgScores[modeKey] / counts[modeKey];
            }
        });
        
        return avgScores;
    }
    
    private calculateErrorRate(): Record<UnifiedExtractionMode, number> {
        const errorCounts: Record<UnifiedExtractionMode, number> = {
            basic: 0,
            content: 0,
            actions: 0,
            full: 0
        };
        
        const totalCounts: Record<UnifiedExtractionMode, number> = {
            basic: 0,
            content: 0,
            actions: 0,
            full: 0
        };
        
        this.errors.forEach(error => {
            errorCounts[error.mode]++;
        });
        
        this.extractions.forEach(extraction => {
            totalCounts[extraction.mode]++;
        });
        
        const errorRates: Record<UnifiedExtractionMode, number> = {
            basic: 0,
            content: 0,
            actions: 0,
            full: 0
        };
        
        Object.keys(errorCounts).forEach(mode => {
            const modeKey = mode as UnifiedExtractionMode;
            if (totalCounts[modeKey] > 0) {
                errorRates[modeKey] = errorCounts[modeKey] / totalCounts[modeKey];
            }
        });
        
        return errorRates;
    }
    
    private calculateDailyStats(): DailyStats[] {
        const dailyStats = new Map<string, DailyStats>();
        
        this.extractions.forEach(extraction => {
            const date = extraction.timestamp.split('T')[0];
            if (!dailyStats.has(date)) {
                dailyStats.set(date, {
                    date,
                    extractions: 0,
                    avgQuality: 0,
                    avgProcessingTime: 0,
                    errors: 0
                });
            }
            
            const stats = dailyStats.get(date)!;
            stats.extractions++;
        });
        
        return Array.from(dailyStats.values()).sort((a, b) => a.date.localeCompare(b.date));
    }
    
    private calculateQualityTrend(): QualityTrend[] {
        return [];
    }
    
    private calculatePerformanceTrend(): PerformanceTrend[] {
        return [];
    }
    
    private generateId(): string {
        return Math.random().toString(36).substring(2, 15);
    }
    
    exportAnalytics(): string {
        const summary = this.getAnalyticsSummary();
        return JSON.stringify(summary, null, 2);
    }
    
    clearAnalytics(): void {
        this.extractions = [];
        this.errors = [];
        this.processingTimes = [];
        this.qualityScores = [];
    }
}

interface ExtractionRecord {
    id: string;
    mode: UnifiedExtractionMode;
    source: string;
    timestamp: string;
}

interface ProcessingTimeRecord {
    operation: string;
    duration: number;
    timestamp: string;
}

interface QualityScoreRecord {
    extractionId: string;
    score: number;
    timestamp: string;
}
