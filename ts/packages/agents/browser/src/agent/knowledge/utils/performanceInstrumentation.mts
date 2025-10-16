// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Performance instrumentation utilities for knowledge graph operations
 * Tracks latency, item counts, and identifies bottlenecks
 */

import registerDebug from "debug";

const debug = registerDebug("typeagent:browser:perf");

export interface PerformanceMetric {
    operation: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    itemsRead?: number;
    itemsProcessed?: number;
    metadata?: Record<string, any>;
}

export interface PerformanceReport {
    operation: string;
    totalDuration: number;
    steps: Array<{
        name: string;
        duration: number;
        itemsRead: number;
        itemsProcessed: number;
        percentage: number;
    }>;
    summary: {
        totalItemsRead: number;
        totalItemsProcessed: number;
        slowestStep: string;
        slowestStepDuration: number;
    };
}

export class PerformanceTracker {
    private metrics: Map<string, PerformanceMetric> = new Map();
    private operationStack: string[] = [];
    private enabled: boolean = true;

    constructor(enabled: boolean = true) {
        this.enabled = enabled;
    }

    startOperation(operation: string, metadata?: Record<string, any>): void {
        if (!this.enabled) return;

        const metric: PerformanceMetric = {
            operation,
            startTime: performance.now(),
            itemsRead: 0,
            itemsProcessed: 0,
            metadata: metadata || {},
        };

        this.metrics.set(operation, metric);
        this.operationStack.push(operation);

        debug(`[PERF] START ${operation}`, metadata);
    }

    endOperation(
        operation: string,
        itemsRead?: number,
        itemsProcessed?: number,
    ): void {
        if (!this.enabled) return;

        const metric = this.metrics.get(operation);
        if (!metric) {
            console.warn(`[PERF] Operation ${operation} not found`);
            return;
        }

        metric.endTime = performance.now();
        metric.duration = metric.endTime - metric.startTime;

        if (itemsRead !== undefined) {
            metric.itemsRead = itemsRead;
        }
        if (itemsProcessed !== undefined) {
            metric.itemsProcessed = itemsProcessed;
        }

        // Remove from stack
        const index = this.operationStack.indexOf(operation);
        if (index > -1) {
            this.operationStack.splice(index, 1);
        }

        debug(
            `[PERF] END ${operation}: ${metric.duration.toFixed(2)}ms | Read: ${metric.itemsRead} | Processed: ${metric.itemsProcessed}`,
        );
    }

    recordCount(
        operation: string,
        type: "read" | "processed",
        count: number,
    ): void {
        if (!this.enabled) return;

        const metric = this.metrics.get(operation);
        if (!metric) {
            return;
        }

        if (type === "read") {
            metric.itemsRead = (metric.itemsRead || 0) + count;
        } else {
            metric.itemsProcessed = (metric.itemsProcessed || 0) + count;
        }
    }

    addMetadata(operation: string, key: string, value: any): void {
        if (!this.enabled) return;

        const metric = this.metrics.get(operation);
        if (metric && metric.metadata) {
            metric.metadata[key] = value;
        }
    }

    getMetric(operation: string): PerformanceMetric | undefined {
        return this.metrics.get(operation);
    }

    generateReport(operation: string): PerformanceReport | null {
        const mainMetric = this.metrics.get(operation);
        if (!mainMetric || !mainMetric.duration) {
            return null;
        }

        // Find all sub-operations
        const subOps = Array.from(this.metrics.values()).filter(
            (m) =>
                m.operation.startsWith(operation + ".") &&
                m.duration !== undefined,
        );

        const steps = subOps.map((m) => ({
            name: m.operation.replace(operation + ".", ""),
            duration: m.duration!,
            itemsRead: m.itemsRead || 0,
            itemsProcessed: m.itemsProcessed || 0,
            percentage: (m.duration! / mainMetric.duration!) * 100,
        }));

        // Sort by duration descending
        steps.sort((a, b) => b.duration - a.duration);

        const totalItemsRead = steps.reduce((sum, s) => sum + s.itemsRead, 0);
        const totalItemsProcessed = steps.reduce(
            (sum, s) => sum + s.itemsProcessed,
            0,
        );

        const slowestStep = steps[0];

        return {
            operation,
            totalDuration: mainMetric.duration,
            steps,
            summary: {
                totalItemsRead,
                totalItemsProcessed,
                slowestStep: slowestStep?.name || "none",
                slowestStepDuration: slowestStep?.duration || 0,
            },
        };
    }

    printReport(operation: string): void {
        const report = this.generateReport(operation);
        if (!report) {
            console.log(`No report available for operation: ${operation}`);
            return;
        }

        console.log(`\n=== Performance Report: ${operation} ===`);
        console.log(`Total Duration: ${report.totalDuration.toFixed(2)}ms`);
        console.log(`Total Items Read: ${report.summary.totalItemsRead}`);
        console.log(
            `Total Items Processed: ${report.summary.totalItemsProcessed}`,
        );
        console.log(
            `Slowest Step: ${report.summary.slowestStep} (${report.summary.slowestStepDuration.toFixed(2)}ms)`,
        );
        console.log(`\nStep Breakdown:`);

        report.steps.forEach((step, index) => {
            console.log(
                `  ${index + 1}. ${step.name}: ${step.duration.toFixed(2)}ms (${step.percentage.toFixed(1)}%) | Read: ${step.itemsRead} | Processed: ${step.itemsProcessed}`,
            );
        });

        console.log(`===================================\n`);
    }

    clear(): void {
        this.metrics.clear();
        this.operationStack = [];
    }

    enable(): void {
        this.enabled = true;
    }

    disable(): void {
        this.enabled = false;
    }
}

// Global instance
let globalTracker: PerformanceTracker | null = null;

export function getPerformanceTracker(): PerformanceTracker {
    if (!globalTracker) {
        globalTracker = new PerformanceTracker(true);
    }
    return globalTracker;
}

export function resetPerformanceTracker(): void {
    globalTracker = new PerformanceTracker(true);
}

/**
 * Decorator for automatic performance tracking
 */
export function trackPerformance(operation: string) {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor,
    ) {
        const originalMethod = descriptor.value;

        descriptor.value = async function (...args: any[]) {
            const tracker = getPerformanceTracker();
            const fullOperation = `${operation}.${propertyKey}`;

            tracker.startOperation(fullOperation, {
                args: args.length,
            });

            try {
                const result = await originalMethod.apply(this, args);
                tracker.endOperation(fullOperation);
                return result;
            } catch (error) {
                tracker.endOperation(fullOperation);
                throw error;
            }
        };

        return descriptor;
    };
}
