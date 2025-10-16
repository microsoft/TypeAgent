// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Enhanced performance tracking specifically for graph building operations
 * Provides detailed metrics on database queries, algorithmic performance, and optimization opportunities
 */

import registerDebug from "debug";

const debug = registerDebug("typeagent:memory:website:perf:graphbuilding");

export interface GraphBuildingMetrics {
    operationName: string;
    totalDuration: number;
    phases: {
        entityExtraction: number;
        entityStorage: number;
        relationshipBuilding: number;
        communityDetection: number;
        topicHierarchy: number;
        topicRelationships: number;
        topicMetrics: number;
    };
    dataMetrics: {
        entitiesProcessed: number;
        relationshipsCreated: number;
        communitiesDetected: number;
        topicsProcessed: number;
        websitesProcessed: number;
    };
    databaseMetrics: {
        queriesExecuted: number;
        totalQueryTime: number;
        slowestQuery: string;
        slowestQueryTime: number;
        batchQueriesUsed: number;
        individualQueriesUsed: number;
    };
    memoryUsage?: {
        heapUsed: number;
        heapTotal: number;
    };
    optimizationOpportunities: string[];
}

export class GraphBuildingPerformanceTracker {
    private startTimes = new Map<string, number>();
    private currentOperation: string | null = null;
    private metrics: GraphBuildingMetrics | null = null;
    private slowQueryThreshold = 100; // ms

    startGraphBuildingOperation(operationName: string): void {
        this.currentOperation = operationName;
        this.metrics = {
            operationName,
            totalDuration: 0,
            phases: {
                entityExtraction: 0,
                entityStorage: 0,
                relationshipBuilding: 0,
                communityDetection: 0,
                topicHierarchy: 0,
                topicRelationships: 0,
                topicMetrics: 0,
            },
            dataMetrics: {
                entitiesProcessed: 0,
                relationshipsCreated: 0,
                communitiesDetected: 0,
                topicsProcessed: 0,
                websitesProcessed: 0,
            },
            databaseMetrics: {
                queriesExecuted: 0,
                totalQueryTime: 0,
                slowestQuery: "",
                slowestQueryTime: 0,
                batchQueriesUsed: 0,
                individualQueriesUsed: 0,
            },
            optimizationOpportunities: [],
        };

        const memUsage = this.getMemoryUsage();
        if (memUsage) {
            this.metrics.memoryUsage = memUsage;
        }

        this.startTimes.set(operationName, performance.now());
        debug(`[GraphBuilding] Started operation: ${operationName}`);
    }

    recordPhaseStart(phase: keyof GraphBuildingMetrics["phases"]): void {
        if (!this.currentOperation) return;
        this.startTimes.set(`${this.currentOperation}.${phase}`, performance.now());
    }

    recordPhaseEnd(phase: keyof GraphBuildingMetrics["phases"], itemsProcessed?: number): void {
        if (!this.currentOperation || !this.metrics) return;
        
        const startTime = this.startTimes.get(`${this.currentOperation}.${phase}`);
        if (startTime) {
            const duration = performance.now() - startTime;
            this.metrics.phases[phase] = duration;
        }
    }

    recordDatabaseQuery(
        queryName: string, 
        duration: number, 
        isBatch: boolean = false, 
        itemCount?: number
    ): void {
        if (!this.metrics) return;

        this.metrics.databaseMetrics.queriesExecuted++;
        this.metrics.databaseMetrics.totalQueryTime += duration;
        
        if (isBatch) {
            this.metrics.databaseMetrics.batchQueriesUsed++;
        } else {
            this.metrics.databaseMetrics.individualQueriesUsed++;
        }

        if (duration > this.metrics.databaseMetrics.slowestQueryTime) {
            this.metrics.databaseMetrics.slowestQuery = queryName;
            this.metrics.databaseMetrics.slowestQueryTime = duration;
        }

        // Track slow queries and potential optimizations
        if (duration > this.slowQueryThreshold) {
            console.warn(`🐌 SLOW QUERY DETECTED: ${queryName} took ${duration.toFixed(2)}ms`);
            
            if (!isBatch && queryName.includes("get") && !queryName.includes("batch")) {
                this.metrics.optimizationOpportunities.push(
                    `Consider batching query: ${queryName} (${duration.toFixed(2)}ms)`
                );
            }
        }

        // Track batch efficiency
        if (isBatch && itemCount) {
            const efficiency = itemCount / (duration / 10); // items per 10ms
            console.log(`⚡ BATCH EFFICIENCY: ${queryName} processed ${itemCount} items in ${duration.toFixed(2)}ms (${efficiency.toFixed(1)} items/10ms)`);
        }
    }

    recordDataMetric(metric: keyof GraphBuildingMetrics["dataMetrics"], count: number): void {
        if (!this.metrics) return;
        this.metrics.dataMetrics[metric] += count;
    }

    addOptimizationOpportunity(opportunity: string): void {
        if (!this.metrics) return;
        this.metrics.optimizationOpportunities.push(opportunity);
    }

    endGraphBuildingOperation(): GraphBuildingMetrics | null {
        if (!this.currentOperation || !this.metrics) return null;

        const startTime = this.startTimes.get(this.currentOperation);
        if (startTime) {
            this.metrics.totalDuration = performance.now() - startTime;
        }

        const result = { ...this.metrics };

        // Analysis and recommendations
        this.analyzePerformance(result);

        // Print summary
        debug(`[GraphBuilding] Completed ${result.operationName} in ${result.totalDuration.toFixed(2)}ms`);
        debug(`[GraphBuilding] Phases - Entity extraction: ${result.phases.entityExtraction.toFixed(2)}ms, Relationships: ${result.phases.relationshipBuilding.toFixed(2)}ms`);
        debug(`[GraphBuilding] Data - Entities: ${result.dataMetrics.entitiesProcessed}, Relationships: ${result.dataMetrics.relationshipsCreated}`);
        debug(`[GraphBuilding] DB - Queries: ${result.databaseMetrics.queriesExecuted}, Total time: ${result.databaseMetrics.totalQueryTime.toFixed(2)}ms`);

        // Print detailed report if operation took longer than 5 seconds
        if (result.totalDuration > 5000) {
            this.printDetailedReport(result);
        }

        this.currentOperation = null;
        this.metrics = null;

        return result;
    }

    private analyzePerformance(metrics: GraphBuildingMetrics): void {
        // Analyze database query patterns
        const totalDbTime = metrics.databaseMetrics.totalQueryTime;
        const dbPercentage = (totalDbTime / metrics.totalDuration) * 100;
        
        if (dbPercentage > 60) {
            metrics.optimizationOpportunities.push(
                `Database queries consume ${dbPercentage.toFixed(1)}% of total time - consider optimizing queries or adding indexes`
            );
        }

        // Analyze batch vs individual query usage
        const batchRatio = metrics.databaseMetrics.batchQueriesUsed / 
                          Math.max(metrics.databaseMetrics.queriesExecuted, 1);
        
        if (batchRatio < 0.5) {
            metrics.optimizationOpportunities.push(
                `Low batch query usage (${(batchRatio * 100).toFixed(1)}%) - consider batching more operations`
            );
        }

        // Analyze phase bottlenecks
        const phaseEntries = Object.entries(metrics.phases) as [keyof typeof metrics.phases, number][];
        const slowestPhase = phaseEntries.reduce((max, [phase, time]) => 
            time > max.time ? { phase, time } : max, 
            { phase: phaseEntries[0][0], time: phaseEntries[0][1] }
        );

        if (slowestPhase.time > metrics.totalDuration * 0.4) {
            metrics.optimizationOpportunities.push(
                `Phase '${slowestPhase.phase}' is the bottleneck (${((slowestPhase.time / metrics.totalDuration) * 100).toFixed(1)}% of time)`
            );
        }

        // Analyze algorithmic complexity warnings
        const entitiesSquared = Math.pow(metrics.dataMetrics.entitiesProcessed, 2);
        if (metrics.dataMetrics.relationshipsCreated > entitiesSquared * 0.1) {
            metrics.optimizationOpportunities.push(
                `High relationship density may indicate O(n²) algorithm usage - consider optimization`
            );
        }
    }

    private printDetailedReport(metrics: GraphBuildingMetrics): void {
        console.log(`\n========== GRAPH BUILDING PERFORMANCE REPORT ==========`);
        console.log(`Operation: ${metrics.operationName}`);
        console.log(`Total Duration: ${metrics.totalDuration.toFixed(2)}ms`);
        
        console.log(`\nPhase Breakdown:`);
        Object.entries(metrics.phases).forEach(([phase, duration]) => {
            const percentage = (duration / metrics.totalDuration) * 100;
            console.log(`  ${phase}: ${duration.toFixed(2)}ms (${percentage.toFixed(1)}%)`);
        });

        console.log(`\nData Processed:`);
        console.log(`  Entities: ${metrics.dataMetrics.entitiesProcessed}`);
        console.log(`  Relationships: ${metrics.dataMetrics.relationshipsCreated}`);
        console.log(`  Communities: ${metrics.dataMetrics.communitiesDetected}`);
        console.log(`  Topics: ${metrics.dataMetrics.topicsProcessed}`);
        console.log(`  Websites: ${metrics.dataMetrics.websitesProcessed}`);

        console.log(`\nDatabase Performance:`);
        console.log(`  Total queries: ${metrics.databaseMetrics.queriesExecuted}`);
        console.log(`  Batch queries: ${metrics.databaseMetrics.batchQueriesUsed}`);
        console.log(`  Individual queries: ${metrics.databaseMetrics.individualQueriesUsed}`);
        console.log(`  Total query time: ${metrics.databaseMetrics.totalQueryTime.toFixed(2)}ms`);
        console.log(`  Average query time: ${(metrics.databaseMetrics.totalQueryTime / metrics.databaseMetrics.queriesExecuted).toFixed(2)}ms`);
        console.log(`  Slowest query: ${metrics.databaseMetrics.slowestQuery} (${metrics.databaseMetrics.slowestQueryTime.toFixed(2)}ms)`);

        if (metrics.memoryUsage) {
            console.log(`\nMemory Usage:`);
            console.log(`  Heap used: ${(metrics.memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Heap total: ${(metrics.memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
        }

        if (metrics.optimizationOpportunities.length > 0) {
            console.log(`\n💡 Optimization Opportunities:`);
            metrics.optimizationOpportunities.forEach((opportunity, index) => {
                console.log(`  ${index + 1}. ${opportunity}`);
            });
        }

        console.log(`========================================\n`);
    }

    private getMemoryUsage() {
        try {
            if (typeof process !== 'undefined' && process.memoryUsage) {
                const usage = process.memoryUsage();
                return {
                    heapUsed: usage.heapUsed,
                    heapTotal: usage.heapTotal,
                };
            }
        } catch (error) {
            // Ignore memory usage errors in browser environments
        }
        return null;
    }

    printReport(): void {
        if (this.metrics) {
            this.printDetailedReport(this.metrics);
        }
    }
}

// Global instance
let globalGraphBuildingTracker: GraphBuildingPerformanceTracker | null = null;

export function getGraphBuildingPerformanceTracker(): GraphBuildingPerformanceTracker {
    if (!globalGraphBuildingTracker) {
        globalGraphBuildingTracker = new GraphBuildingPerformanceTracker();
    }
    return globalGraphBuildingTracker;
}