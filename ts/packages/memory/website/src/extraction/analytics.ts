// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ExtractionMode,
    ExtractionResult,
    ExtractionQualityMetrics,
    EXTRACTION_MODE_CONFIGS,
} from "./types.js";

/**
 * Analytics data for extraction operations
 */
export interface ExtractionAnalytics {
    totalExtractions: number;
    successfulExtractions: number;
    failedExtractions: number;
    successRate: number;
    averageProcessingTime: number;
    averageConfidence: number;

    // Mode-specific analytics
    modeUsage: Record<ExtractionMode, number>;
    modeAverageTime: Record<ExtractionMode, number>;
    modeSuccessRate: Record<ExtractionMode, number>;

    // Quality metrics
    averageEntityCount: number;
    averageTopicCount: number;
    averageActionCount: number;

    // Time-based analytics
    extractionsLast24h: number;
    extractionsLastWeek: number;
    extractionsLastMonth: number;

    // AI usage analytics
    aiExtractions: number;
    basicExtractions: number;
    aiSuccessRate: number;

    // Performance analytics
    fastExtractions: number; // < 1s
    mediumExtractions: number; // 1-5s
    slowExtractions: number; // > 5s
}

/**
 * Individual extraction record for analytics
 */
interface ExtractionRecord {
    timestamp: Date;
    mode: ExtractionMode;
    success: boolean;
    processingTime: number;
    qualityMetrics: ExtractionQualityMetrics;
    error?: string;
}

/**
 * Analytics manager for extraction operations
 * Tracks performance, quality, and usage patterns
 */
export class Analytics {
    private records: ExtractionRecord[] = [];
    private maxRecords: number = 10000; // Keep last 10k records

    constructor(maxRecords?: number) {
        if (maxRecords) {
            this.maxRecords = maxRecords;
        }
    }

    /**
     * Record an extraction operation
     */
    recordExtraction(result: ExtractionResult, error?: Error): void {
        const record: ExtractionRecord = {
            timestamp: new Date(),
            mode: result.extractionMode,
            success: !error,
            processingTime: result.processingTime,
            qualityMetrics: result.qualityMetrics,
            ...(error && { error: error.message }),
        };

        this.records.push(record);

        // Trim old records if we exceed max
        if (this.records.length > this.maxRecords) {
            this.records = this.records.slice(-this.maxRecords);
        }
    }

    /**
     * Record a failed extraction
     */
    recordFailure(
        mode: ExtractionMode,
        processingTime: number,
        error: Error,
    ): void {
        const record: ExtractionRecord = {
            timestamp: new Date(),
            mode,
            success: false,
            processingTime,
            qualityMetrics: {
                confidence: 0,
                entityCount: 0,
                topicCount: 0,
                actionCount: 0,
                extractionTime: processingTime,
                knowledgeStrategy:
                    EXTRACTION_MODE_CONFIGS[mode].knowledgeStrategy,
            },
            error: error.message,
        };

        this.records.push(record);

        if (this.records.length > this.maxRecords) {
            this.records = this.records.slice(-this.maxRecords);
        }
    }

    /**
     * Get comprehensive analytics summary
     */
    getAnalyticsSummary(): ExtractionAnalytics {
        if (this.records.length === 0) {
            return this.getEmptyAnalytics();
        }

        const successfulRecords = this.records.filter((r) => r.success);
        const failedRecords = this.records.filter((r) => !r.success);

        const now = new Date();
        const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const lastMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Calculate mode-specific metrics
        const modeUsage: Record<ExtractionMode, number> = {
            basic: 0,
            content: 0,
            actions: 0,
            full: 0,
        };
        const modeTimeSum: Record<ExtractionMode, number> = {
            basic: 0,
            content: 0,
            actions: 0,
            full: 0,
        };
        const modeSuccesses: Record<ExtractionMode, number> = {
            basic: 0,
            content: 0,
            actions: 0,
            full: 0,
        };

        this.records.forEach((record) => {
            modeUsage[record.mode]++;
            modeTimeSum[record.mode] += record.processingTime;
            if (record.success) {
                modeSuccesses[record.mode]++;
            }
        });

        const modeAverageTime: Record<ExtractionMode, number> = {
            basic:
                modeUsage.basic > 0 ? modeTimeSum.basic / modeUsage.basic : 0,
            content:
                modeUsage.content > 0
                    ? modeTimeSum.content / modeUsage.content
                    : 0,
            actions:
                modeUsage.actions > 0
                    ? modeTimeSum.actions / modeUsage.actions
                    : 0,
            full: modeUsage.full > 0 ? modeTimeSum.full / modeUsage.full : 0,
        };

        const modeSuccessRate: Record<ExtractionMode, number> = {
            basic:
                modeUsage.basic > 0
                    ? (modeSuccesses.basic / modeUsage.basic) * 100
                    : 0,
            content:
                modeUsage.content > 0
                    ? (modeSuccesses.content / modeUsage.content) * 100
                    : 0,
            actions:
                modeUsage.actions > 0
                    ? (modeSuccesses.actions / modeUsage.actions) * 100
                    : 0,
            full:
                modeUsage.full > 0
                    ? (modeSuccesses.full / modeUsage.full) * 100
                    : 0,
        };

        // AI vs Basic analytics
        const aiRecords = this.records.filter(
            (r) => EXTRACTION_MODE_CONFIGS[r.mode].usesAI,
        );
        const basicRecords = this.records.filter((r) => r.mode === "basic");
        const aiSuccessful = aiRecords.filter((r) => r.success);

        // Performance categorization
        const fastExtractions = this.records.filter(
            (r) => r.processingTime < 1000,
        ).length;
        const mediumExtractions = this.records.filter(
            (r) => r.processingTime >= 1000 && r.processingTime <= 5000,
        ).length;
        const slowExtractions = this.records.filter(
            (r) => r.processingTime > 5000,
        ).length;

        return {
            totalExtractions: this.records.length,
            successfulExtractions: successfulRecords.length,
            failedExtractions: failedRecords.length,
            successRate: (successfulRecords.length / this.records.length) * 100,
            averageProcessingTime:
                this.records.reduce((sum, r) => sum + r.processingTime, 0) /
                this.records.length,
            averageConfidence:
                successfulRecords.length > 0
                    ? successfulRecords.reduce(
                          (sum, r) => sum + r.qualityMetrics.confidence,
                          0,
                      ) / successfulRecords.length
                    : 0,

            modeUsage,
            modeAverageTime,
            modeSuccessRate,

            averageEntityCount:
                successfulRecords.length > 0
                    ? successfulRecords.reduce(
                          (sum, r) => sum + r.qualityMetrics.entityCount,
                          0,
                      ) / successfulRecords.length
                    : 0,
            averageTopicCount:
                successfulRecords.length > 0
                    ? successfulRecords.reduce(
                          (sum, r) => sum + r.qualityMetrics.topicCount,
                          0,
                      ) / successfulRecords.length
                    : 0,
            averageActionCount:
                successfulRecords.length > 0
                    ? successfulRecords.reduce(
                          (sum, r) => sum + r.qualityMetrics.actionCount,
                          0,
                      ) / successfulRecords.length
                    : 0,

            extractionsLast24h: this.records.filter(
                (r) => r.timestamp >= last24h,
            ).length,
            extractionsLastWeek: this.records.filter(
                (r) => r.timestamp >= lastWeek,
            ).length,
            extractionsLastMonth: this.records.filter(
                (r) => r.timestamp >= lastMonth,
            ).length,

            aiExtractions: aiRecords.length,
            basicExtractions: basicRecords.length,
            aiSuccessRate:
                aiRecords.length > 0
                    ? (aiSuccessful.length / aiRecords.length) * 100
                    : 0,

            fastExtractions,
            mediumExtractions,
            slowExtractions,
        };
    }

    /**
     * Get analytics for a specific time period
     */
    getAnalyticsForPeriod(startDate: Date, endDate: Date): ExtractionAnalytics {
        const originalRecords = this.records;
        this.records = this.records.filter(
            (r) => r.timestamp >= startDate && r.timestamp <= endDate,
        );

        const analytics = this.getAnalyticsSummary();
        this.records = originalRecords;

        return analytics;
    }

    /**
     * Get top errors by frequency
     */
    getTopErrors(
        limit: number = 10,
    ): Array<{ error: string; count: number; percentage: number }> {
        const errorCounts = new Map<string, number>();
        const failedRecords = this.records.filter((r) => !r.success && r.error);

        failedRecords.forEach((record) => {
            const error = record.error!;
            errorCounts.set(error, (errorCounts.get(error) || 0) + 1);
        });

        const totalErrors = failedRecords.length;
        return Array.from(errorCounts.entries())
            .map(([error, count]) => ({
                error,
                count,
                percentage: totalErrors > 0 ? (count / totalErrors) * 100 : 0,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit);
    }

    /**
     * Get performance trends over time
     */
    getPerformanceTrends(bucketSize: "hour" | "day" | "week" = "hour"): Array<{
        timestamp: Date;
        averageTime: number;
        successRate: number;
        extractionCount: number;
    }> {
        if (this.records.length === 0) return [];

        const bucketMillis =
            bucketSize === "hour"
                ? 60 * 60 * 1000
                : bucketSize === "day"
                  ? 24 * 60 * 60 * 1000
                  : 7 * 24 * 60 * 60 * 1000;

        const buckets = new Map<number, ExtractionRecord[]>();

        this.records.forEach((record) => {
            const bucketKey =
                Math.floor(record.timestamp.getTime() / bucketMillis) *
                bucketMillis;
            if (!buckets.has(bucketKey)) {
                buckets.set(bucketKey, []);
            }
            buckets.get(bucketKey)!.push(record);
        });

        return Array.from(buckets.entries())
            .map(([timestamp, records]) => {
                const successful = records.filter((r) => r.success);
                return {
                    timestamp: new Date(timestamp),
                    averageTime:
                        records.reduce((sum, r) => sum + r.processingTime, 0) /
                        records.length,
                    successRate: (successful.length / records.length) * 100,
                    extractionCount: records.length,
                };
            })
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }

    /**
     * Clear all analytics data
     */
    clear(): void {
        this.records = [];
    }

    /**
     * Export analytics data for external analysis
     */
    exportData(): ExtractionRecord[] {
        return [...this.records];
    }

    private getEmptyAnalytics(): ExtractionAnalytics {
        return {
            totalExtractions: 0,
            successfulExtractions: 0,
            failedExtractions: 0,
            successRate: 0,
            averageProcessingTime: 0,
            averageConfidence: 0,
            modeUsage: { basic: 0, content: 0, actions: 0, full: 0 },
            modeAverageTime: { basic: 0, content: 0, actions: 0, full: 0 },
            modeSuccessRate: { basic: 0, content: 0, actions: 0, full: 0 },
            averageEntityCount: 0,
            averageTopicCount: 0,
            averageActionCount: 0,
            extractionsLast24h: 0,
            extractionsLastWeek: 0,
            extractionsLastMonth: 0,
            aiExtractions: 0,
            basicExtractions: 0,
            aiSuccessRate: 0,
            fastExtractions: 0,
            mediumExtractions: 0,
            slowExtractions: 0,
        };
    }
}
