// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { FileManager } from "./fileManager.mjs";
import {
    UsageContext,
    UsageStatistics,
    ActionUsageStats,
    DomainAnalytics,
    PerformanceMetrics,
    TimeRange,
} from "./types.mjs";
import registerDebug from "debug";
const debug = registerDebug("typeagent:browser:storage:analyticsManager");

/**
 * AnalyticsManager - Usage analytics and performance tracking
 *
 * Provides comprehensive analytics capabilities including:
 * - Usage tracking and statistics
 * - Performance metrics collection
 * - Popular actions identification
 * - Domain usage analytics
 * - Trend analysis over time
 * - Data cleanup and retention management
 */
export class AnalyticsManager {
    private fileManager: FileManager;
    private usageData: Map<string, ActionUsageStats> = new Map();
    private domainAnalytics: Map<string, DomainAnalytics> = new Map();
    private performanceMetrics: PerformanceMetrics[] = [];
    private initialized = false;

    constructor(fileManager: FileManager) {
        this.fileManager = fileManager;
    }

    /**
     * Initialize analytics manager
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            await this.loadAnalyticsData();
            this.initialized = true;
            debug("AnalyticsManager initialized successfully");
        } catch (error) {
            console.error("Failed to initialize AnalyticsManager:", error);
            throw new Error("AnalyticsManager initialization failed");
        }
    }

    /**
     * Record action usage with context
     */
    async recordUsage(actionId: string, context: UsageContext): Promise<void> {
        this.ensureInitialized();

        try {
            const timestamp = new Date().toISOString();

            // Update action usage stats
            if (!this.usageData.has(actionId)) {
                this.usageData.set(actionId, {
                    actionId,
                    totalUsage: 0,
                    lastUsed: timestamp,
                    usageHistory: [],
                    averageSuccessRate: 1.0,
                    averageExecutionTime: 0,
                    popularTimes: {},
                    errorCount: 0,
                });
            }

            const usageStats = this.usageData.get(actionId)!;
            usageStats.totalUsage++;
            usageStats.lastUsed = timestamp;

            // Add to usage history (keep last 100 entries)
            const historyEntry: any = {
                timestamp,
                success: context.success,
            };

            if (context.executionTime !== undefined) {
                historyEntry.executionTime = context.executionTime;
            }
            if (context.userAgent !== undefined) {
                historyEntry.userAgent = context.userAgent;
            }
            if (context.url !== undefined) {
                historyEntry.url = context.url;
            }

            usageStats.usageHistory.push(historyEntry);

            if (usageStats.usageHistory.length > 100) {
                usageStats.usageHistory = usageStats.usageHistory.slice(-100);
            }

            // Update success rate
            const successCount = usageStats.usageHistory.filter(
                (h) => h.success,
            ).length;
            usageStats.averageSuccessRate =
                successCount / usageStats.usageHistory.length;

            // Update average execution time
            const validTimes = usageStats.usageHistory
                .filter((h) => h.executionTime !== undefined)
                .map((h) => h.executionTime!);

            if (validTimes.length > 0) {
                usageStats.averageExecutionTime =
                    validTimes.reduce((a, b) => a + b, 0) / validTimes.length;
            }

            // Track error count
            if (!context.success) {
                usageStats.errorCount++;
            }

            // Track popular usage times
            const hour = new Date(timestamp).getHours();
            usageStats.popularTimes[hour] =
                (usageStats.popularTimes[hour] || 0) + 1;

            // Update domain analytics if available
            if (context.domain) {
                await this.updateDomainAnalytics(context.domain, context);
            }

            // Save updated analytics
            await this.saveAnalyticsData();
        } catch (error) {
            console.error(
                `Failed to record usage for action ${actionId}:`,
                error,
            );
        }
    }

    /**
     * Get comprehensive usage statistics
     */
    async getUsageStatistics(timeRange?: TimeRange): Promise<UsageStatistics> {
        this.ensureInitialized();

        try {
            const startDate = timeRange?.start
                ? new Date(timeRange.start)
                : new Date(0);
            const endDate = timeRange?.end
                ? new Date(timeRange.end)
                : new Date();

            const filteredUsageData = this.filterUsageByTimeRange(
                startDate,
                endDate,
            );

            const totalUsage = Array.from(filteredUsageData.values()).reduce(
                (sum, stats) => sum + stats.totalUsage,
                0,
            );

            const totalActions = filteredUsageData.size;
            const averageUsage =
                totalActions > 0 ? totalUsage / totalActions : 0;

            // Get most used actions
            const mostUsedActions = Array.from(filteredUsageData.values())
                .sort((a, b) => b.totalUsage - a.totalUsage)
                .slice(0, 10)
                .map((stats) => ({
                    actionId: stats.actionId,
                    usageCount: stats.totalUsage,
                    lastUsed: stats.lastUsed,
                    successRate: stats.averageSuccessRate,
                }));

            // Calculate usage trends
            const usageTrends = this.calculateUsageTrends(
                filteredUsageData,
                startDate,
                endDate,
            );

            // Get performance metrics
            const performanceData = this.getPerformanceMetrics(
                startDate,
                endDate,
            );

            return {
                totalUsage,
                totalActions,
                averageUsage,
                mostUsedActions,
                usageTrends,
                performanceMetrics: performanceData,
                domainBreakdown: this.getDomainBreakdown(startDate, endDate),
                timeRange: {
                    start: startDate.toISOString(),
                    end: endDate.toISOString(),
                },
            };
        } catch (error) {
            console.error("Failed to get usage statistics:", error);
            throw new Error("Failed to get usage statistics");
        }
    }

    /**
     * Get popular actions within a time range
     */
    async getPopularActions(
        limit: number = 10,
        timeRange?: TimeRange,
    ): Promise<ActionUsageStats[]> {
        this.ensureInitialized();

        const startDate = timeRange?.start
            ? new Date(timeRange.start)
            : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
        const endDate = timeRange?.end ? new Date(timeRange.end) : new Date();

        const filteredUsageData = this.filterUsageByTimeRange(
            startDate,
            endDate,
        );

        return Array.from(filteredUsageData.values())
            .sort((a, b) => b.totalUsage - a.totalUsage)
            .slice(0, limit);
    }

    /**
     * Get domain analytics
     */
    async getDomainAnalytics(
        domain?: string,
    ): Promise<DomainAnalytics | DomainAnalytics[]> {
        this.ensureInitialized();

        if (domain) {
            return (
                this.domainAnalytics.get(domain) || {
                    domain,
                    totalUsage: 0,
                    uniqueActions: 0,
                    averageSuccessRate: 0,
                    popularActions: [],
                    usageTrends: [],
                    lastActivity: new Date().toISOString(),
                }
            );
        }

        return Array.from(this.domainAnalytics.values());
    }

    /**
     * Get performance metrics
     */
    getPerformanceMetrics(
        startDate?: Date,
        endDate?: Date,
    ): PerformanceMetrics {
        const start = startDate || new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours
        const end = endDate || new Date();

        const relevantMetrics = this.performanceMetrics.filter((metric) => {
            const metricDate = new Date(metric.timestamp);
            return metricDate >= start && metricDate <= end;
        });

        if (relevantMetrics.length === 0) {
            return {
                timestamp: new Date().toISOString(),
                averageSearchTime: 0,
                averageActionExecutionTime: 0,
                cacheHitRate: 0,
                errorRate: 0,
                memoryUsage: 0,
                indexSize: 0,
            };
        }

        const avgSearchTime =
            relevantMetrics.reduce((sum, m) => sum + m.averageSearchTime, 0) /
            relevantMetrics.length;
        const avgExecTime =
            relevantMetrics.reduce(
                (sum, m) => sum + m.averageActionExecutionTime,
                0,
            ) / relevantMetrics.length;
        const avgCacheHitRate =
            relevantMetrics.reduce((sum, m) => sum + m.cacheHitRate, 0) /
            relevantMetrics.length;
        const avgErrorRate =
            relevantMetrics.reduce((sum, m) => sum + m.errorRate, 0) /
            relevantMetrics.length;
        const avgMemoryUsage =
            relevantMetrics.reduce((sum, m) => sum + m.memoryUsage, 0) /
            relevantMetrics.length;
        const avgIndexSize =
            relevantMetrics.reduce((sum, m) => sum + m.indexSize, 0) /
            relevantMetrics.length;

        return {
            timestamp: new Date().toISOString(),
            averageSearchTime: avgSearchTime,
            averageActionExecutionTime: avgExecTime,
            cacheHitRate: avgCacheHitRate,
            errorRate: avgErrorRate,
            memoryUsage: avgMemoryUsage,
            indexSize: avgIndexSize,
        };
    }

    /**
     * Record performance metrics
     */
    async recordPerformanceMetric(metric: PerformanceMetrics): Promise<void> {
        this.ensureInitialized();

        this.performanceMetrics.push(metric);

        // Keep only last 1000 metrics to prevent memory issues
        if (this.performanceMetrics.length > 1000) {
            this.performanceMetrics = this.performanceMetrics.slice(-1000);
        }

        // Save periodically
        if (this.performanceMetrics.length % 10 === 0) {
            await this.saveAnalyticsData();
        }
    }

    /**
     * Clean up old analytics data
     */
    async cleanupOldData(retentionDays: number = 90): Promise<void> {
        this.ensureInitialized();

        const cutoffDate = new Date(
            Date.now() - retentionDays * 24 * 60 * 60 * 1000,
        );

        try {
            // Clean up usage history
            for (const [actionId, usageStats] of this.usageData.entries()) {
                usageStats.usageHistory = usageStats.usageHistory.filter(
                    (entry) => new Date(entry.timestamp) >= cutoffDate,
                );

                // Remove actions with no recent usage
                if (
                    usageStats.usageHistory.length === 0 &&
                    new Date(usageStats.lastUsed) < cutoffDate
                ) {
                    this.usageData.delete(actionId);
                }
            }

            // Clean up performance metrics
            this.performanceMetrics = this.performanceMetrics.filter(
                (metric) => new Date(metric.timestamp) >= cutoffDate,
            );

            // Clean up domain analytics
            for (const [domain, analytics] of this.domainAnalytics.entries()) {
                analytics.usageTrends = analytics.usageTrends.filter(
                    (trend) => new Date(trend.date) >= cutoffDate,
                );

                // Remove domains with no recent activity
                if (
                    analytics.usageTrends.length === 0 &&
                    new Date(analytics.lastActivity) < cutoffDate
                ) {
                    this.domainAnalytics.delete(domain);
                }
            }

            await this.saveAnalyticsData();
            debug(`Cleaned up analytics data older than ${retentionDays} days`);
        } catch (error) {
            console.error("Failed to cleanup old analytics data:", error);
        }
    }

    /**
     * Export analytics data
     */
    async exportAnalyticsData(): Promise<string> {
        this.ensureInitialized();

        const exportData = {
            usageData: Array.from(this.usageData.entries()),
            domainAnalytics: Array.from(this.domainAnalytics.entries()),
            performanceMetrics: this.performanceMetrics,
            exportTimestamp: new Date().toISOString(),
        };

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Get cache statistics for performance monitoring
     */
    getCacheStats() {
        return {
            usageDataSize: this.usageData.size,
            domainAnalyticsSize: this.domainAnalytics.size,
            performanceMetricsCount: this.performanceMetrics.length,
            memoryFootprint: this.estimateMemoryUsage(),
        };
    }

    // Private helper methods

    /**
     * Update domain analytics with new usage data
     */
    private async updateDomainAnalytics(
        domain: string,
        context: UsageContext,
    ): Promise<void> {
        if (!this.domainAnalytics.has(domain)) {
            this.domainAnalytics.set(domain, {
                domain,
                totalUsage: 0,
                uniqueActions: 0,
                averageSuccessRate: 0,
                popularActions: [],
                usageTrends: [],
                lastActivity: new Date().toISOString(),
            });
        }

        const analytics = this.domainAnalytics.get(domain)!;
        analytics.totalUsage++;
        analytics.lastActivity = new Date().toISOString();

        // Update usage trends (daily aggregation)
        const today = new Date().toISOString().split("T")[0];
        let todayTrend = analytics.usageTrends.find(
            (trend) => trend.date === today,
        );

        if (!todayTrend) {
            todayTrend = {
                date: today,
                usage: 0,
                successRate: 0,
                averageExecutionTime: 0,
            };
            analytics.usageTrends.push(todayTrend);
        }

        todayTrend.usage++;

        // Update success rate for the day
        const todayUsage = analytics.usageTrends.filter(
            (trend) => trend.date === today,
        );
        const totalTodayUsage = todayUsage.reduce(
            (sum, trend) => sum + trend.usage,
            0,
        );
        const successfulUsage = context.success ? 1 : 0;
        todayTrend.successRate =
            (todayTrend.successRate * (totalTodayUsage - 1) + successfulUsage) /
            totalTodayUsage;

        // Keep only last 30 days of trends
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0];
        analytics.usageTrends = analytics.usageTrends.filter(
            (trend) => trend.date >= thirtyDaysAgo,
        );
    }

    /**
     * Filter usage data by time range
     */
    private filterUsageByTimeRange(
        startDate: Date,
        endDate: Date,
    ): Map<string, ActionUsageStats> {
        const filtered = new Map<string, ActionUsageStats>();

        for (const [actionId, usageStats] of this.usageData.entries()) {
            const relevantHistory = usageStats.usageHistory.filter((entry) => {
                const entryDate = new Date(entry.timestamp);
                return entryDate >= startDate && entryDate <= endDate;
            });

            if (relevantHistory.length > 0) {
                const filteredStats: ActionUsageStats = {
                    ...usageStats,
                    totalUsage: relevantHistory.length,
                    usageHistory: relevantHistory,
                    averageSuccessRate:
                        relevantHistory.filter((h) => h.success).length /
                        relevantHistory.length,
                    errorCount: relevantHistory.filter((h) => !h.success)
                        .length,
                };

                const validTimes = relevantHistory
                    .filter((h) => h.executionTime !== undefined)
                    .map((h) => h.executionTime!);

                if (validTimes.length > 0) {
                    filteredStats.averageExecutionTime =
                        validTimes.reduce((a, b) => a + b, 0) /
                        validTimes.length;
                }

                filtered.set(actionId, filteredStats);
            }
        }

        return filtered;
    }

    /**
     * Calculate usage trends over time
     */
    private calculateUsageTrends(
        usageData: Map<string, ActionUsageStats>,
        startDate: Date,
        endDate: Date,
    ): Array<{ date: string; usage: number }> {
        const trends: Map<string, number> = new Map();

        for (const usageStats of usageData.values()) {
            for (const entry of usageStats.usageHistory) {
                const date = new Date(entry.timestamp)
                    .toISOString()
                    .split("T")[0];
                trends.set(date, (trends.get(date) || 0) + 1);
            }
        }

        return Array.from(trends.entries())
            .map(([date, usage]) => ({ date, usage }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    /**
     * Get domain breakdown for usage statistics
     */
    private getDomainBreakdown(
        startDate: Date,
        endDate: Date,
    ): { domain: string; usage: number; percentage: number }[] {
        const domainUsage: Map<string, number> = new Map();
        let totalUsage = 0;

        for (const analytics of this.domainAnalytics.values()) {
            const relevantTrends = analytics.usageTrends.filter((trend) => {
                const trendDate = new Date(trend.date);
                return trendDate >= startDate && trendDate <= endDate;
            });

            const domainTotal = relevantTrends.reduce(
                (sum, trend) => sum + trend.usage,
                0,
            );
            if (domainTotal > 0) {
                domainUsage.set(analytics.domain, domainTotal);
                totalUsage += domainTotal;
            }
        }

        return Array.from(domainUsage.entries())
            .map(([domain, usage]) => ({
                domain,
                usage,
                percentage: totalUsage > 0 ? (usage / totalUsage) * 100 : 0,
            }))
            .sort((a, b) => b.usage - a.usage);
    }

    /**
     * Estimate memory usage for monitoring
     */
    private estimateMemoryUsage(): number {
        // Rough estimation in bytes
        let size = 0;

        // Usage data
        for (const usageStats of this.usageData.values()) {
            size += JSON.stringify(usageStats).length * 2; // Unicode characters are 2 bytes
        }

        // Domain analytics
        for (const analytics of this.domainAnalytics.values()) {
            size += JSON.stringify(analytics).length * 2;
        }

        // Performance metrics
        size += JSON.stringify(this.performanceMetrics).length * 2;

        return size;
    }

    /**
     * Load analytics data from storage
     */
    private async loadAnalyticsData(): Promise<void> {
        try {
            // Load usage data
            const usageDataPath = "analytics/usageData.json";
            const usageData =
                await this.fileManager.readJson<
                    Array<[string, ActionUsageStats]>
                >(usageDataPath);
            if (usageData) {
                this.usageData = new Map(usageData);
            }

            // Load domain analytics
            const domainAnalyticsPath = "analytics/domainAnalytics.json";
            const domainAnalytics =
                await this.fileManager.readJson<
                    Array<[string, DomainAnalytics]>
                >(domainAnalyticsPath);
            if (domainAnalytics) {
                this.domainAnalytics = new Map(domainAnalytics);
            }

            // Load performance metrics
            const performanceMetricsPath = "analytics/performanceMetrics.json";
            const performanceMetrics = await this.fileManager.readJson<
                PerformanceMetrics[]
            >(performanceMetricsPath);
            if (performanceMetrics) {
                this.performanceMetrics = performanceMetrics;
            }
        } catch (error) {
            console.error("Failed to load analytics data:", error);
            // Initialize with empty data on error
        }
    }

    /**
     * Save analytics data to storage
     */
    private async saveAnalyticsData(): Promise<void> {
        try {
            // Ensure analytics directory exists
            await this.fileManager.createDirectory("analytics");

            // Save usage data
            const usageDataPath = "analytics/usageData.json";
            await this.fileManager.writeJson(
                usageDataPath,
                Array.from(this.usageData.entries()),
            );

            // Save domain analytics
            const domainAnalyticsPath = "analytics/domainAnalytics.json";
            await this.fileManager.writeJson(
                domainAnalyticsPath,
                Array.from(this.domainAnalytics.entries()),
            );

            // Save performance metrics
            const performanceMetricsPath = "analytics/performanceMetrics.json";
            await this.fileManager.writeJson(
                performanceMetricsPath,
                this.performanceMetrics,
            );
        } catch (error) {
            console.error("Failed to save analytics data:", error);
        }
    }

    /**
     * Ensure analytics manager is initialized
     */
    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error(
                "AnalyticsManager not initialized. Call initialize() first.",
            );
        }
    }
}
