// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Enhanced performance tracking specifically for topic graph operations
 * Provides detailed metrics on data fetching, processing, and rendering bottlenecks
 */

import { getPerformanceTracker } from "./performanceInstrumentation.mjs";
import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:perf:topicgraph");

export interface TopicGraphMetrics {
    operationName: string;
    totalDuration: number;
    dataFetchTime: number;
    processingTime: number;
    renderingTime: number;
    itemCounts: {
        topicsRead: number;
        topicsProcessed: number;
        relationshipsRead: number;
        relationshipsProcessed: number;
        entitiesRead: number;
        cacheHits: number;
        cacheMisses: number;
    };
    memoryUsage?: {
        heapUsed: number;
        heapTotal: number;
    };
    databaseMetrics?: {
        queriesExecuted: number;
        totalQueryTime: number;
        slowestQuery: string;
        slowestQueryTime: number;
    };
}

export class TopicGraphPerformanceTracker {
    private baseTracker = getPerformanceTracker();
    private currentOperation: string | null = null;
    private metrics: TopicGraphMetrics | null = null;

    startTopicGraphOperation(operationName: string): void {
        this.currentOperation = operationName;
        this.metrics = {
            operationName,
            totalDuration: 0,
            dataFetchTime: 0,
            processingTime: 0,
            renderingTime: 0,
            itemCounts: {
                topicsRead: 0,
                topicsProcessed: 0,
                relationshipsRead: 0,
                relationshipsProcessed: 0,
                entitiesRead: 0,
                cacheHits: 0,
                cacheMisses: 0,
            },
        };

        const memUsage = this.getMemoryUsage();
        if (memUsage) {
            this.metrics.memoryUsage = memUsage;
        }

        this.baseTracker.startOperation(operationName);
        debug(`[TopicGraph] Started operation: ${operationName}`);
    }

    recordDataFetch(phase: "start" | "end", itemsRead?: number): void {
        if (!this.currentOperation || !this.metrics) return;

        const subOperation = `${this.currentOperation}.dataFetch`;
        
        if (phase === "start") {
            this.baseTracker.startOperation(subOperation);
        } else {
            this.baseTracker.endOperation(subOperation, itemsRead, itemsRead);
            const metric = this.baseTracker.getMetric(subOperation);
            if (metric?.duration) {
                this.metrics.dataFetchTime += metric.duration;
            }
            if (itemsRead) {
                this.metrics.itemCounts.topicsRead += itemsRead;
            }
        }
    }

    recordProcessing(phase: "start" | "end", itemsProcessed?: number): void {
        if (!this.currentOperation || !this.metrics) return;

        const subOperation = `${this.currentOperation}.processing`;
        
        if (phase === "start") {
            this.baseTracker.startOperation(subOperation);
        } else {
            this.baseTracker.endOperation(subOperation, itemsProcessed, itemsProcessed);
            const metric = this.baseTracker.getMetric(subOperation);
            if (metric?.duration) {
                this.metrics.processingTime += metric.duration;
            }
            if (itemsProcessed) {
                this.metrics.itemCounts.topicsProcessed += itemsProcessed;
            }
        }
    }

    recordCacheHit(): void {
        if (this.metrics) {
            this.metrics.itemCounts.cacheHits++;
        }
    }

    recordCacheMiss(): void {
        if (this.metrics) {
            this.metrics.itemCounts.cacheMisses++;
        }
    }

    recordDatabaseQuery(queryName: string, duration: number): void {
        if (!this.metrics) return;

        if (!this.metrics.databaseMetrics) {
            this.metrics.databaseMetrics = {
                queriesExecuted: 0,
                totalQueryTime: 0,
                slowestQuery: "",
                slowestQueryTime: 0,
            };
        }

        this.metrics.databaseMetrics.queriesExecuted++;
        this.metrics.databaseMetrics.totalQueryTime += duration;
        
        if (duration > this.metrics.databaseMetrics.slowestQueryTime) {
            this.metrics.databaseMetrics.slowestQuery = queryName;
            this.metrics.databaseMetrics.slowestQueryTime = duration;
        }

        // Enhanced profiling: Track slow queries (> 50ms)
        const SLOW_QUERY_THRESHOLD = 50; // milliseconds
        if (duration > SLOW_QUERY_THRESHOLD) {
            console.warn(`🐌 SLOW QUERY DETECTED: ${queryName} took ${duration.toFixed(2)}ms`);
        }

        // Enhanced profiling: Track batch vs individual query efficiency
        if (queryName.includes("_batch_")) {
            const batchSize = queryName.split("_batch_")[1]?.split("_")[0];
            if (batchSize) {
                const efficiencyScore = parseFloat(batchSize) / (duration / 10); // topics per 10ms
                console.log(`⚡ BATCH EFFICIENCY: ${queryName} processed ${batchSize} items in ${duration.toFixed(2)}ms (efficiency: ${efficiencyScore.toFixed(1)} items/10ms)`);
            }
        }
    }

    endTopicGraphOperation(): TopicGraphMetrics | null {
        if (!this.currentOperation || !this.metrics) return null;

        this.baseTracker.endOperation(this.currentOperation);
        const mainMetric = this.baseTracker.getMetric(this.currentOperation);
        
        if (mainMetric?.duration) {
            this.metrics.totalDuration = mainMetric.duration;
        }

        // Record final memory usage
        const finalMemory = this.getMemoryUsage();
        if (this.metrics.memoryUsage && finalMemory) {
            this.metrics.memoryUsage = finalMemory;
        }

        const result = { ...this.metrics };
        
        debug(`[TopicGraph] Completed operation: ${this.currentOperation}`);
        debug(`[TopicGraph] Total duration: ${result.totalDuration.toFixed(2)}ms`);
        debug(`[TopicGraph] Data fetch: ${result.dataFetchTime.toFixed(2)}ms`);
        debug(`[TopicGraph] Processing: ${result.processingTime.toFixed(2)}ms`);
        debug(`[TopicGraph] Items - Topics read: ${result.itemCounts.topicsRead}, processed: ${result.itemCounts.topicsProcessed}`);
        debug(`[TopicGraph] Cache - Hits: ${result.itemCounts.cacheHits}, Misses: ${result.itemCounts.cacheMisses}`);
        
        if (result.databaseMetrics) {
            debug(`[TopicGraph] DB - Queries: ${result.databaseMetrics.queriesExecuted}, Total time: ${result.databaseMetrics.totalQueryTime.toFixed(2)}ms`);
            debug(`[TopicGraph] DB - Slowest query: ${result.databaseMetrics.slowestQuery} (${result.databaseMetrics.slowestQueryTime.toFixed(2)}ms)`);
        }

        // Print detailed report if operation took longer than 1 second
        if (result.totalDuration > 1000) {
            this.printDetailedReport(result);
        }

        this.currentOperation = null;
        this.metrics = null;

        return result;
    }

    private getMemoryUsage() {
        if (typeof process !== "undefined" && process.memoryUsage) {
            const mem = process.memoryUsage();
            return {
                heapUsed: mem.heapUsed,
                heapTotal: mem.heapTotal,
            };
        }
        return undefined;
    }

    private printDetailedReport(metrics: TopicGraphMetrics): void {
        console.log(`\n🔥 SLOW TOPIC GRAPH OPERATION DETECTED 🔥`);
        console.log(`Operation: ${metrics.operationName}`);
        console.log(`Total Duration: ${metrics.totalDuration.toFixed(2)}ms`);
        console.log(`\nBreakdown:`);
        console.log(`  Data Fetch: ${metrics.dataFetchTime.toFixed(2)}ms (${((metrics.dataFetchTime / metrics.totalDuration) * 100).toFixed(1)}%)`);
        console.log(`  Processing: ${metrics.processingTime.toFixed(2)}ms (${((metrics.processingTime / metrics.totalDuration) * 100).toFixed(1)}%)`);
        console.log(`  Other: ${(metrics.totalDuration - metrics.dataFetchTime - metrics.processingTime).toFixed(2)}ms`);
        
        console.log(`\nData Volume:`);
        console.log(`  Topics read: ${metrics.itemCounts.topicsRead}`);
        console.log(`  Topics processed: ${metrics.itemCounts.topicsProcessed}`);
        console.log(`  Relationships read: ${metrics.itemCounts.relationshipsRead}`);
        console.log(`  Relationships processed: ${metrics.itemCounts.relationshipsProcessed}`);
        
        console.log(`\nCache Performance:`);
        console.log(`  Cache hits: ${metrics.itemCounts.cacheHits}`);
        console.log(`  Cache misses: ${metrics.itemCounts.cacheMisses}`);
        
        if (metrics.itemCounts.cacheHits + metrics.itemCounts.cacheMisses > 0) {
            const hitRate = (metrics.itemCounts.cacheHits / (metrics.itemCounts.cacheHits + metrics.itemCounts.cacheMisses)) * 100;
            console.log(`  Cache hit rate: ${hitRate.toFixed(1)}%`);
        }
        
        if (metrics.databaseMetrics) {
            console.log(`\nDatabase Performance:`);
            console.log(`  Queries executed: ${metrics.databaseMetrics.queriesExecuted}`);
            console.log(`  Total query time: ${metrics.databaseMetrics.totalQueryTime.toFixed(2)}ms`);
            console.log(`  Average query time: ${(metrics.databaseMetrics.totalQueryTime / metrics.databaseMetrics.queriesExecuted).toFixed(2)}ms`);
            console.log(`  Slowest query: ${metrics.databaseMetrics.slowestQuery} (${metrics.databaseMetrics.slowestQueryTime.toFixed(2)}ms)`);
        }
        
        if (metrics.memoryUsage) {
            console.log(`\nMemory Usage:`);
            console.log(`  Heap used: ${(metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Heap total: ${(metrics.memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
        }
        
        console.log(`\n💡 Performance Recommendations:`);
        
        if (metrics.dataFetchTime > metrics.totalDuration * 0.5) {
            console.log(`  - Data fetching is the bottleneck (${((metrics.dataFetchTime / metrics.totalDuration) * 100).toFixed(1)}% of time)`);
            console.log(`  - Consider optimizing database queries or adding indexes`);
        }
        
        if (metrics.itemCounts.cacheHits + metrics.itemCounts.cacheMisses > 0) {
            const hitRate = (metrics.itemCounts.cacheHits / (metrics.itemCounts.cacheHits + metrics.itemCounts.cacheMisses)) * 100;
            if (hitRate < 80) {
                console.log(`  - Low cache hit rate (${hitRate.toFixed(1)}%) - consider improving caching strategy`);
            }
        }
        
        if (metrics.itemCounts.topicsRead > 1000) {
            console.log(`  - Large number of topics (${metrics.itemCounts.topicsRead}) - consider pagination or filtering`);
        }
        
        if (metrics.databaseMetrics && metrics.databaseMetrics.queriesExecuted > 10) {
            console.log(`  - High number of database queries (${metrics.databaseMetrics.queriesExecuted}) - consider batching or using joins`);
        }
        
        console.log(`============================================\n`);
    }
}

// Global instance
let globalTopicGraphTracker: TopicGraphPerformanceTracker | null = null;

export function getTopicGraphPerformanceTracker(): TopicGraphPerformanceTracker {
    if (!globalTopicGraphTracker) {
        globalTopicGraphTracker = new TopicGraphPerformanceTracker();
    }
    return globalTopicGraphTracker;
}