// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Frontend performance tracking for topic graph rendering and interactions
 * Tracks browser-side performance metrics for the topic graph visualization
 */

export interface FrontendTopicGraphMetrics {
    operationName: string;
    totalDuration: number;
    dataFetchTime: number;
    dataProcessingTime: number;
    domRenderTime: number;
    cytoscapeRenderTime: number;
    itemCounts: {
        topicsFetched: number;
        topicsRendered: number;
        relationshipsFetched: number;
        relationshipsRendered: number;
        domUpdates: number;
    };
    browserMetrics?: {
        memoryUsed: number;
        renderingFrames: number;
        layoutComputeTime: number;
    };
}

export class FrontendTopicGraphPerformanceTracker {
    private currentOperation: string | null = null;
    private metrics: FrontendTopicGraphMetrics | null = null;
    private startTime: number = 0;
    private phaseStartTimes: Map<string, number> = new Map();

    startOperation(operationName: string): void {
        this.currentOperation = operationName;
        this.startTime = performance.now();
        this.metrics = {
            operationName,
            totalDuration: 0,
            dataFetchTime: 0,
            dataProcessingTime: 0,
            domRenderTime: 0,
            cytoscapeRenderTime: 0,
            itemCounts: {
                topicsFetched: 0,
                topicsRendered: 0,
                relationshipsFetched: 0,
                relationshipsRendered: 0,
                domUpdates: 0,
            },
            browserMetrics: this.getBrowserMetrics(),
        };

        console.log(`[TopicGraphView] Started operation: ${operationName}`);
    }

    startPhase(phaseName: string): void {
        this.phaseStartTimes.set(phaseName, performance.now());
    }

    endPhase(phaseName: string): void {
        if (!this.metrics) return;
        
        const startTime = this.phaseStartTimes.get(phaseName);
        if (!startTime) return;
        
        const duration = performance.now() - startTime;
        
        switch (phaseName) {
            case "dataFetch":
                this.metrics.dataFetchTime += duration;
                break;
            case "dataProcessing":
                this.metrics.dataProcessingTime += duration;
                break;
            case "domRender":
                this.metrics.domRenderTime += duration;
                break;
            case "cytoscapeRender":
                this.metrics.cytoscapeRenderTime += duration;
                break;
        }
        
        this.phaseStartTimes.delete(phaseName);
    }

    recordItemsFetched(topics: number, relationships: number): void {
        if (!this.metrics) return;
        this.metrics.itemCounts.topicsFetched += topics;
        this.metrics.itemCounts.relationshipsFetched += relationships;
    }

    recordItemsRendered(topics: number, relationships: number): void {
        if (!this.metrics) return;
        this.metrics.itemCounts.topicsRendered += topics;
        this.metrics.itemCounts.relationshipsRendered += relationships;
    }

    recordDomUpdate(): void {
        if (!this.metrics) return;
        this.metrics.itemCounts.domUpdates++;
    }

    endOperation(): FrontendTopicGraphMetrics | null {
        if (!this.currentOperation || !this.metrics) return null;

        this.metrics.totalDuration = performance.now() - this.startTime;
        
        // Update final browser metrics
        const finalMetrics = this.getBrowserMetrics();
        if (finalMetrics) {
            this.metrics.browserMetrics = finalMetrics;
        }

        const result = { ...this.metrics };
        
        console.log(`[TopicGraphView] Completed operation: ${this.currentOperation}`);
        console.log(`[TopicGraphView] Total duration: ${result.totalDuration.toFixed(2)}ms`);
        console.log(`[TopicGraphView] Data fetch: ${result.dataFetchTime.toFixed(2)}ms`);
        console.log(`[TopicGraphView] Data processing: ${result.dataProcessingTime.toFixed(2)}ms`);
        console.log(`[TopicGraphView] DOM render: ${result.domRenderTime.toFixed(2)}ms`);
        console.log(`[TopicGraphView] Cytoscape render: ${result.cytoscapeRenderTime.toFixed(2)}ms`);
        console.log(`[TopicGraphView] Topics fetched: ${result.itemCounts.topicsFetched}, rendered: ${result.itemCounts.topicsRendered}`);
        console.log(`[TopicGraphView] Relationships fetched: ${result.itemCounts.relationshipsFetched}, rendered: ${result.itemCounts.relationshipsRendered}`);

        // Show performance warnings for slow operations
        if (result.totalDuration > 2000) { // 2+ seconds
            this.printPerformanceWarnings(result);
        }

        this.currentOperation = null;
        this.metrics = null;

        return result;
    }

    private getBrowserMetrics() {
        try {
            // Check if performance memory API is available
            if ('memory' in performance) {
                const memory = (performance as any).memory;
                return {
                    memoryUsed: memory.usedJSHeapSize || 0,
                    renderingFrames: 0, // Would need frame counting implementation
                    layoutComputeTime: 0, // Would need paint timing API
                };
            }
        } catch (error) {
            // Ignore errors accessing performance APIs
        }
        return undefined;
    }

    private printPerformanceWarnings(metrics: FrontendTopicGraphMetrics): void {
        console.warn(`\n⚠️  SLOW TOPIC GRAPH FRONTEND OPERATION ⚠️`);
        console.warn(`Operation: ${metrics.operationName}`);
        console.warn(`Total Duration: ${metrics.totalDuration.toFixed(2)}ms`);
        
        console.warn(`\nBreakdown:`);
        console.warn(`  Data Fetch: ${metrics.dataFetchTime.toFixed(2)}ms (${((metrics.dataFetchTime / metrics.totalDuration) * 100).toFixed(1)}%)`);
        console.warn(`  Data Processing: ${metrics.dataProcessingTime.toFixed(2)}ms (${((metrics.dataProcessingTime / metrics.totalDuration) * 100).toFixed(1)}%)`);
        console.warn(`  DOM Render: ${metrics.domRenderTime.toFixed(2)}ms (${((metrics.domRenderTime / metrics.totalDuration) * 100).toFixed(1)}%)`);
        console.warn(`  Cytoscape Render: ${metrics.cytoscapeRenderTime.toFixed(2)}ms (${((metrics.cytoscapeRenderTime / metrics.totalDuration) * 100).toFixed(1)}%)`);
        
        console.warn(`\nRecommendations:`);
        
        if (metrics.dataFetchTime > metrics.totalDuration * 0.4) {
            console.warn(`  - Data fetching is slow (${((metrics.dataFetchTime / metrics.totalDuration) * 100).toFixed(1)}% of time)`);
            console.warn(`  - Consider implementing request caching or reducing data volume`);
        }
        
        if (metrics.dataProcessingTime > metrics.totalDuration * 0.3) {
            console.warn(`  - Data processing is slow (${((metrics.dataProcessingTime / metrics.totalDuration) * 100).toFixed(1)}% of time)`);
            console.warn(`  - Consider optimizing data transformation algorithms`);
        }
        
        if (metrics.cytoscapeRenderTime > metrics.totalDuration * 0.4) {
            console.warn(`  - Cytoscape rendering is slow (${((metrics.cytoscapeRenderTime / metrics.totalDuration) * 100).toFixed(1)}% of time)`);
            console.warn(`  - Consider reducing node/edge count or simplifying layout`);
        }
        
        if (metrics.itemCounts.topicsFetched > 1000) {
            console.warn(`  - Large number of topics (${metrics.itemCounts.topicsFetched}) may impact performance`);
            console.warn(`  - Consider implementing pagination or hierarchical loading`);
        }
        
        if (metrics.itemCounts.domUpdates > 50) {
            console.warn(`  - High number of DOM updates (${metrics.itemCounts.domUpdates}) may cause layout thrashing`);
            console.warn(`  - Consider batching DOM updates or using virtual scrolling`);
        }
        
        console.warn(`===============================================\n`);
    }
}

// Global instance for the frontend
let globalFrontendTracker: FrontendTopicGraphPerformanceTracker | null = null;

export function getFrontendTopicGraphTracker(): FrontendTopicGraphPerformanceTracker {
    if (!globalFrontendTracker) {
        globalFrontendTracker = new FrontendTopicGraphPerformanceTracker();
    }
    return globalFrontendTracker;
}