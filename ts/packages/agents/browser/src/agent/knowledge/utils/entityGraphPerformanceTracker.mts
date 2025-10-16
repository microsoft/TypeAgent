/**
 * Entity Graph Performance Tracker
 *
 * Similar to TopicGraphPerformanceTracker but focused on entity graph operations.
 * Tracks database query performance, batch efficiency, and entity-specific bottlenecks.
 */

import { getPerformanceTracker } from "./performanceInstrumentation.mjs";

interface EntityQueryMetrics {
    operation: string;
    duration: number;
    entityCount?: number;
    relationshipCount?: number;
    timestamp: number;
}

interface BatchOperationMetrics {
    operation: string;
    batchSize: number;
    duration: number;
    itemsPerMs: number;
    timestamp: number;
}

export class EntityGraphPerformanceTracker {
    private static instance: EntityGraphPerformanceTracker | null = null;
    private baseTracker = getPerformanceTracker();
    private queryMetrics: EntityQueryMetrics[] = [];
    private batchMetrics: BatchOperationMetrics[] = [];
    private slowQueryThreshold = 50; // ms
    private maxMetricsHistory = 100;

    constructor() {
        console.log("[Entity Graph Perf] Performance tracker initialized");
    }

    static getInstance(): EntityGraphPerformanceTracker {
        if (!EntityGraphPerformanceTracker.instance) {
            EntityGraphPerformanceTracker.instance =
                new EntityGraphPerformanceTracker();
        }
        return EntityGraphPerformanceTracker.instance;
    }

    /**
     * Record database query performance for entity operations
     */
    recordDatabaseQuery(
        operation: string,
        duration: number,
        entityCount?: number,
        relationshipCount?: number,
    ): void {
        const metric: EntityQueryMetrics = {
            operation,
            duration,
            ...(entityCount !== undefined && { entityCount }),
            ...(relationshipCount !== undefined && { relationshipCount }),
            timestamp: Date.now(),
        };

        // Add to metrics history
        this.queryMetrics.push(metric);
        if (this.queryMetrics.length > this.maxMetricsHistory) {
            this.queryMetrics.shift();
        }

        // Log slow queries
        if (duration > this.slowQueryThreshold) {
            console.warn(
                `[Entity Graph Perf] Slow query detected: ${operation} took ${duration.toFixed(1)}ms` +
                    (entityCount ? ` (${entityCount} entities)` : "") +
                    (relationshipCount
                        ? ` (${relationshipCount} relationships)`
                        : ""),
            );
        } else {
            console.log(
                `[Entity Graph Perf] ${operation}: ${duration.toFixed(1)}ms` +
                    (entityCount ? ` (${entityCount} entities)` : "") +
                    (relationshipCount
                        ? ` (${relationshipCount} relationships)`
                        : ""),
            );
        }
    }

    /**
     * Record batch operation efficiency for entity operations
     */
    recordBatchEfficiency(
        operation: string,
        batchSize: number,
        duration: number,
    ): void {
        const itemsPerMs = batchSize / Math.max(duration, 1);

        const metric: BatchOperationMetrics = {
            operation,
            batchSize,
            duration,
            itemsPerMs,
            timestamp: Date.now(),
        };

        // Add to metrics history
        this.batchMetrics.push(metric);
        if (this.batchMetrics.length > this.maxMetricsHistory) {
            this.batchMetrics.shift();
        }

        console.log(
            `[Entity Graph Perf] Batch ${operation}: ${batchSize} items in ${duration.toFixed(1)}ms ` +
                `(${itemsPerMs.toFixed(1)} items/ms)`,
        );
    }

    /**
     * Record entity neighborhood search performance
     */
    recordNeighborhoodSearch(
        entityId: string,
        depth: number,
        maxNodes: number,
        duration: number,
        actualNodes: number,
        actualEdges: number,
    ): void {
        this.recordDatabaseQuery(
            `neighborhood_search_${entityId}_depth${depth}_max${maxNodes}`,
            duration,
            actualNodes,
            actualEdges,
        );

        const efficiency = actualNodes / Math.max(duration, 1);
        console.log(
            `[Entity Graph Perf] Neighborhood search for "${entityId}": ` +
                `${actualNodes} nodes, ${actualEdges} edges in ${duration.toFixed(1)}ms ` +
                `(${efficiency.toFixed(2)} nodes/ms)`,
        );
    }

    /**
     * Record entity metrics calculation performance
     */
    recordEntityMetricsCalculation(
        entityCount: number,
        relationshipCount: number,
        duration: number,
    ): void {
        this.recordDatabaseQuery(
            "entity_metrics_calculation",
            duration,
            entityCount,
            relationshipCount,
        );

        const efficiency = entityCount / Math.max(duration, 1);
        console.log(
            `[Entity Graph Perf] Entity metrics calculation: ` +
                `${entityCount} entities, ${relationshipCount} relationships in ${duration.toFixed(1)}ms ` +
                `(${efficiency.toFixed(2)} entities/ms)`,
        );
    }

    /**
     * Record BFS traversal performance
     */
    recordBFSTraversal(
        startEntity: string,
        depth: number,
        visitedNodes: number,
        duration: number,
    ): void {
        this.recordDatabaseQuery(
            `bfs_traversal_${startEntity}_depth${depth}`,
            duration,
            visitedNodes,
        );

        const efficiency = visitedNodes / Math.max(duration, 1);
        console.log(
            `[Entity Graph Perf] BFS traversal from "${startEntity}": ` +
                `${visitedNodes} nodes visited in ${duration.toFixed(1)}ms ` +
                `(${efficiency.toFixed(2)} nodes/ms)`,
        );
    }

    /**
     * Start timing an operation
     */
    startOperation(operationName: string): void {
        this.baseTracker.startOperation(`entity_graph_${operationName}`);
    }

    /**
     * End timing an operation
     */
    endOperation(
        operationName: string,
        itemCount: number = 0,
        resultCount: number = 0,
    ): void {
        this.baseTracker.endOperation(
            `entity_graph_${operationName}`,
            itemCount,
            resultCount,
        );
    }

    /**
     * Get performance summary
     */
    getPerformanceSummary(): {
        slowQueries: EntityQueryMetrics[];
        averageQueryTime: number;
        totalQueries: number;
        batchEfficiency: {
            operation: string;
            avgItemsPerMs: number;
        }[];
    } {
        const slowQueries = this.queryMetrics.filter(
            (q) => q.duration > this.slowQueryThreshold,
        );
        const averageQueryTime =
            this.queryMetrics.length > 0
                ? this.queryMetrics.reduce((sum, q) => sum + q.duration, 0) /
                  this.queryMetrics.length
                : 0;

        // Calculate batch efficiency by operation
        const batchEfficiencyMap = new Map<string, number[]>();
        for (const metric of this.batchMetrics) {
            if (!batchEfficiencyMap.has(metric.operation)) {
                batchEfficiencyMap.set(metric.operation, []);
            }
            batchEfficiencyMap.get(metric.operation)!.push(metric.itemsPerMs);
        }

        const batchEfficiency = Array.from(batchEfficiencyMap.entries()).map(
            ([operation, rates]) => ({
                operation,
                avgItemsPerMs:
                    rates.reduce((sum, rate) => sum + rate, 0) / rates.length,
            }),
        );

        return {
            slowQueries,
            averageQueryTime,
            totalQueries: this.queryMetrics.length,
            batchEfficiency,
        };
    }

    /**
     * Print performance report
     */
    printReport(): void {
        const summary = this.getPerformanceSummary();

        console.log("\n=== Entity Graph Performance Report ===");
        console.log(`Total queries: ${summary.totalQueries}`);
        console.log(
            `Average query time: ${summary.averageQueryTime.toFixed(1)}ms`,
        );
        console.log(
            `Slow queries (>${this.slowQueryThreshold}ms): ${summary.slowQueries.length}`,
        );

        if (summary.slowQueries.length > 0) {
            console.log("\nSlow queries:");
            summary.slowQueries.slice(-5).forEach((query) => {
                console.log(
                    `  - ${query.operation}: ${query.duration.toFixed(1)}ms`,
                );
            });
        }

        if (summary.batchEfficiency.length > 0) {
            console.log("\nBatch efficiency:");
            summary.batchEfficiency.forEach((batch) => {
                console.log(
                    `  - ${batch.operation}: ${batch.avgItemsPerMs.toFixed(1)} items/ms`,
                );
            });
        }
        console.log("=====================================\n");
    }

    /**
     * Record data quality issues for monitoring
     */
    recordDataQualityIssue(
        operation: string,
        issueType: string,
        count: number,
        details?: string,
    ): void {
        console.warn(
            `[Entity Graph Perf] Data quality issue in ${operation}: ` +
                `${issueType} (${count} instances)` +
                (details ? ` - ${details}` : ""),
        );

        // Record as a special type of query metric for tracking
        this.recordDatabaseQuery(
            `data_quality_${operation}_${issueType}`,
            0,
            count,
        );
    }

    /**
     * Validate and clean entity data, reporting issues
     */
    validateEntityData(entities: any[], operation: string): any[] {
        const originalCount = entities.length;

        // Filter out entities with empty or invalid names
        const validEntities = entities.filter((entity) => {
            const name = entity.name || entity.entityName;
            return name && typeof name === "string" && name.trim() !== "";
        });

        const invalidCount = originalCount - validEntities.length;
        if (invalidCount > 0) {
            this.recordDataQualityIssue(
                operation,
                "empty_entity_names",
                invalidCount,
                `${invalidCount}/${originalCount} entities had empty names`,
            );
        }

        return validEntities;
    }

    /**
     * Validate and clean relationship data, reporting issues
     */
    validateRelationshipData(relationships: any[], operation: string): any[] {
        const originalCount = relationships.length;

        // Filter out relationships with empty entity names
        const validRelationships = relationships.filter((rel) => {
            const fromEntity = rel.fromEntity || rel.from;
            const toEntity = rel.toEntity || rel.to;

            return (
                fromEntity &&
                typeof fromEntity === "string" &&
                fromEntity.trim() !== "" &&
                toEntity &&
                typeof toEntity === "string" &&
                toEntity.trim() !== ""
            );
        });

        const invalidCount = originalCount - validRelationships.length;
        if (invalidCount > 0) {
            this.recordDataQualityIssue(
                operation,
                "empty_relationship_entities",
                invalidCount,
                `${invalidCount}/${originalCount} relationships had empty entity names`,
            );
        }

        return validRelationships;
    }

    /**
     * Reset metrics (useful for testing)
     */
    reset(): void {
        this.queryMetrics = [];
        this.batchMetrics = [];
        console.log("[Entity Graph Perf] Metrics reset");
    }
}

/**
 * Get the singleton entity graph performance tracker
 */
export function getEntityGraphPerformanceTracker(): EntityGraphPerformanceTracker {
    return EntityGraphPerformanceTracker.getInstance();
}
