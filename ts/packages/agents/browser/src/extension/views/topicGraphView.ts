// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TopicGraphVisualizer } from "./topicGraphVisualizer";
import { createExtensionService } from "./knowledgeUtilities";

interface TopicGraphViewState {
    currentTopic: string | null;
    searchQuery: string;
    visibleLevels: number[];
    sidebarOpen: boolean;
}

class TopicGraphView {
    private visualizer: TopicGraphVisualizer | null = null;
    private extensionService: any;
    private lastLoadedData: any = null;
    private state: TopicGraphViewState = {
        currentTopic: null,
        searchQuery: "",
        visibleLevels: [0, 1, 2, 3],
        sidebarOpen: false,
    };

    private loadingOverlay: HTMLElement;
    private errorOverlay: HTMLElement;
    private sidebar: HTMLElement;
    private graphContainer: HTMLElement;

    constructor() {
        this.loadingOverlay = document.getElementById("loadingOverlay")!;
        this.errorOverlay = document.getElementById("errorOverlay")!;
        this.sidebar = document.getElementById("topicSidebar")!;
        this.graphContainer = document.getElementById("topicGraphContainer")!;

        // Initialize extension service
        this.extensionService = createExtensionService();

        this.initializeEventHandlers();
        this.initializeVisualizer();
        this.loadInitialData();
    }

    private initializeEventHandlers(): void {
        // Topic Graph breadcrumb link - navigate to global view
        const topicGraphBreadcrumb = document.getElementById(
            "topicGraphBreadcrumb",
        );
        if (topicGraphBreadcrumb) {
            topicGraphBreadcrumb.addEventListener("click", (e) => {
                e.preventDefault();
                this.navigateToGlobalView();
            });
        }

        // Search functionality
        const searchInput = document.getElementById(
            "topicSearch",
        ) as HTMLInputElement;
        const searchButton = document.getElementById("searchButton");

        searchInput?.addEventListener("input", (e) => {
            this.state.searchQuery = (e.target as HTMLInputElement).value;
            this.handleSearch();
        });

        searchButton?.addEventListener("click", () => {
            this.handleSearch();
        });

        // View mode buttons removed - using optimized CoSE by default

        // Graph controls
        document.getElementById("fitButton")?.addEventListener("click", () => {
            this.visualizer?.fitToView();
        });

        document
            .getElementById("centerButton")
            ?.addEventListener("click", () => {
                this.visualizer?.centerGraph();
            });

        document
            .getElementById("exportButton")
            ?.addEventListener("click", () => {
                this.exportGraph();
            });

        document
            .getElementById("exportJsonButton")
            ?.addEventListener("click", () => {
                this.exportGraphologyJson();
            });

        // Settings modal removed - using optimized defaults

        // Sidebar close button
        document
            .getElementById("closeSidebar")
            ?.addEventListener("click", () => {
                this.closeSidebar();
            });

        // Retry button
        document
            .getElementById("retryButton")
            ?.addEventListener("click", () => {
                this.loadInitialData();
            });

        // Entity clicks (navigate to entity graph) and topic action buttons
        document.addEventListener("click", (e) => {
            const target = e.target as HTMLElement;

            // Handle entity item clicks
            if (target.classList.contains("entity-item")) {
                const entityName = target.textContent?.trim();
                if (entityName) {
                    this.navigateToEntityGraph(entityName);
                }
                return;
            }

            // Handle topic action buttons (expand/focus)
            const button = target.closest("[data-action]") as HTMLElement;
            if (button) {
                const action = button.getAttribute("data-action");
                const topicId = button.getAttribute("data-topic-id");

                if (topicId) {
                    if (action === "expand") {
                        this.expandTopic(topicId);
                    } else if (action === "focus") {
                        this.focusOnTopic(topicId);
                    }
                }
            }
        });
    }

    private async initializeVisualizer(): Promise<void> {
        try {
            this.visualizer = new TopicGraphVisualizer(this.graphContainer);

            // Set up topic click callback
            this.visualizer.onTopicClick((topic) => {
                this.showTopicDetails(topic);
                this.updateBreadcrumb(topic);
            });

            // Set up graph data provider for neighborhood loading
            this.visualizer.setGraphDataProvider({
                getTopicViewportNeighborhood: async (
                    centerTopic: string,
                    viewportTopicIds: string[],
                    maxNodes: number,
                ) => {
                    return await this.fetchTopicNeighborhood(
                        centerTopic,
                        viewportTopicIds,
                        maxNodes,
                    );
                },
            });
        } catch (error) {
            console.error("Failed to initialize topic visualizer:", error);
            this.showError("Failed to initialize topic graph visualization");
        }
    }

    private async loadInitialData(): Promise<void> {
        this.showLoading();

        try {
            const topicData = await this.fetchGlobalImportanceView();

            if (!topicData) {
                this.showError("No topic data available");
                return;
            }

            this.lastLoadedData = topicData;

            await this.visualizer?.init(topicData);

            this.updateGraphStats();
            this.hideLoading();
        } catch (error) {
            console.error("Failed to load topic data:", error);
            this.showError("Failed to load topic data");
        }
    }

    /**
     * Fetch global importance view with top N most important topics
     */
    private async fetchGlobalImportanceView(): Promise<any> {
        try {
            console.log(
                "[TopicGraphView] Fetching global importance layer (top 500 topics)...",
            );
            const result = await this.extensionService.getTopicImportanceLayer(
                500,
                0.0,
            );

            if (!result ) {
                console.warn(
                    "[TopicGraphView] No importance layer data available",
                );
                return this.createEmptyTopicGraph();
            }

            console.log(
                `[TopicGraphView] Fetched global importance layer`,
            );
            if (result.metadata) {
                console.log(`[TopicGraphView] Metadata:`, result.metadata);
            }
            const transformedData = this.transformImportanceLayerData(result);
            return transformedData;
        } catch (error) {
            console.error(
                "[TopicGraphView] Error fetching importance layer:",
                error,
            );
            return this.createEmptyTopicGraph();
        }
    }

    /**
     * Transform importance layer data to visualization format
     */
    private transformImportanceLayerData(data: any): any {
        if (!data.topics) {
            return this.createEmptyTopicGraph();
        }

        const inputTopics = data.topics || [];

        const topics = inputTopics.map((topic: any) => ({
            id: topic.topicId,
            name: topic.topicName,
            level: topic.level,
            parentId: topic.parentTopicId,
            confidence: topic.confidence || 0.7,
            keywords: this.parseKeywords(topic.keywords),
            entityReferences: topic.entityReferences || [],
            childCount: this.countChildren(topic.topicId, inputTopics),
            importance: topic.importance || 0.5,
        }));

        const relationships = data.relationships || [];

        const result: any = {
            centerTopic: null,
            topics,
            relationships,
            maxDepth: Math.max(...topics.map((t: any) => t.level), 0),
            metadata: data.metadata,
        };

        if (data.metadata?.graphologyLayout) {
            console.log(
                `[TopicGraphView] Using graphology preset layout (${data.metadata.graphologyLayout.elements?.length || 0} elements)`,
            );
            result.presetLayout = {
                elements: data.metadata.graphologyLayout.elements,
                layoutDuration: data.metadata.graphologyLayout.layoutDuration,
                avgSpacing: data.metadata.graphologyLayout.avgSpacing,
                communityCount: data.metadata.graphologyLayout.communityCount,
            };
        }

        return result;
    }

    /**
     * Fetch topic neighborhood for viewport expansion
     */
    private async fetchTopicNeighborhood(
        centerTopic: string,
        viewportTopicIds: string[],
        maxNodes: number,
    ): Promise<any> {
        try {
            console.log(
                `[TopicGraphView] Fetching neighborhood for ${centerTopic} with ${viewportTopicIds.length} viewport topics`,
            );

            const result =
                await this.extensionService.getTopicViewportNeighborhood(
                    centerTopic,
                    viewportTopicIds,
                    maxNodes,
                );

            if (!result || !result.topics) {
                console.warn("[TopicGraphView] No neighborhood data returned");
                return { topics: [], relationships: [], maxDepth: 0 };
            }

            console.log(
                `[TopicGraphView] Received neighborhood: ${result.topics.length} topics`,
            );

            // Transform to visualization format
            const topics = result.topics.map((topic: any) => ({
                id: topic.topicId,
                name: topic.topicName,
                level: topic.level,
                parentId: topic.parentTopicId,
                confidence: topic.confidence || 0.7,
                keywords: this.parseKeywords(topic.keywords),
                entityReferences: topic.entityReferences || [],
                childCount: this.countChildren(topic.topicId, result.topics),
            }));

            const relationships = result.relationships || [];

            return {
                centerTopic: centerTopic,
                topics,
                relationships,
                maxDepth: Math.max(...topics.map((t: any) => t.level), 0),
                metadata: result.metadata,
            };
        } catch (error) {
            console.error(
                "[TopicGraphView] Error fetching neighborhood:",
                error,
            );
            return { topics: [], relationships: [], maxDepth: 0 };
        }
    }

    /**
     * Create an empty topic graph when no data is available
     */
    private createEmptyTopicGraph(): any {
        return {
            centerTopic: null,
            topics: [],
            relationships: [],
            maxDepth: 0,
        };
    }

    /**
     * Parse keywords from JSON string or return as array
     */
    private parseKeywords(keywords: string | string[]): string[] {
        if (Array.isArray(keywords)) {
            return keywords;
        }
        if (typeof keywords === "string") {
            try {
                return JSON.parse(keywords);
            } catch {
                return [keywords];
            }
        }
        return [];
    }

    /**
     * Count children for a given topic
     */
    private countChildren(topicId: string, allTopics: any[]): number {
        return allTopics.filter((t) => t.parentTopicId === topicId).length;
    }

    /**
     * Analyze and log topic hierarchy levels and importance distribution
     */
    private analyzeTopicHierarchyAndImportance(data: any): void {
        if (!data.topics || data.topics.length === 0) {
            console.log("[TopicAnalysis] No topics to analyze");
            return;
        }

        console.log("\n=== TOPIC HIERARCHY AND IMPORTANCE ANALYSIS ===");

        // Analyze hierarchy levels
        const levelCounts = new Map<number, number>();
        const levelTopics = new Map<number, any[]>();

        data.topics.forEach((topic: any) => {
            const level = topic.level;
            levelCounts.set(level, (levelCounts.get(level) || 0) + 1);

            if (!levelTopics.has(level)) {
                levelTopics.set(level, []);
            }
            levelTopics.get(level)!.push(topic);
        });

        // Log hierarchy distribution
        console.log(
            `\n📊 HIERARCHY LEVELS (${data.topics.length} total topics):`,
        );
        const sortedLevels = Array.from(levelCounts.keys()).sort(
            (a, b) => a - b,
        );

        sortedLevels.forEach((level) => {
            const count = levelCounts.get(level)!;
            const percentage = ((count / data.topics.length) * 100).toFixed(1);
            console.log(`   Level ${level}: ${count} topics (${percentage}%)`);
        });

        // Calculate importance scores for all topics and analyze distribution
        const importanceScores: number[] = [];
        const importanceBuckets = new Map<string, number>();

        // Define importance buckets
        const bucketRanges = [
            { min: 0.0, max: 0.2, label: "Very Low (0.0-0.2)" },
            { min: 0.2, max: 0.4, label: "Low (0.2-0.4)" },
            { min: 0.4, max: 0.6, label: "Medium (0.4-0.6)" },
            { min: 0.6, max: 0.8, label: "High (0.6-0.8)" },
            { min: 0.8, max: 1.0, label: "Very High (0.8-1.0)" },
        ];

        // Initialize buckets
        bucketRanges.forEach((bucket) => {
            importanceBuckets.set(bucket.label, 0);
        });

        // Calculate importance for each topic
        data.topics.forEach((topic: any) => {
            // Use the same calculation logic as the visualizer
            const baseConfidence = topic.confidence || 0.5;
            const levelWeight = 1 / (topic.level + 1);
            const childrenWeight = Math.min(1, topic.childCount * 0.1);
            const entityRefWeight = Math.min(
                1,
                topic.entityReferences.length * 0.05,
            );
            const keywordWeight = Math.min(1, topic.keywords.length * 0.03);

            const importance = Math.min(
                1,
                Math.max(
                    0.1,
                    baseConfidence * 0.4 +
                        levelWeight * 0.25 +
                        childrenWeight * 0.15 +
                        entityRefWeight * 0.15 +
                        keywordWeight * 0.05,
                ),
            );

            importanceScores.push(importance);

            // Categorize into buckets
            for (const bucket of bucketRanges) {
                if (importance >= bucket.min && importance <= bucket.max) {
                    importanceBuckets.set(
                        bucket.label,
                        importanceBuckets.get(bucket.label)! + 1,
                    );
                    break;
                }
            }
        });

        // Log importance distribution
        console.log(`\n🎯 IMPORTANCE DISTRIBUTION:`);
        bucketRanges.forEach((bucket) => {
            const count = importanceBuckets.get(bucket.label)!;
            const percentage = ((count / data.topics.length) * 100).toFixed(1);
            console.log(`   ${bucket.label}: ${count} topics (${percentage}%)`);
        });

        // Log importance statistics
        const avgImportance =
            importanceScores.reduce((a, b) => a + b, 0) /
            importanceScores.length;
        const minImportance = Math.min(...importanceScores);
        const maxImportance = Math.max(...importanceScores);

        console.log(`\n📈 IMPORTANCE STATISTICS:`);
        console.log(`   Average: ${avgImportance.toFixed(3)}`);
        console.log(
            `   Range: ${minImportance.toFixed(3)} - ${maxImportance.toFixed(3)}`,
        );

        // Show sample topics from each level for debugging
        console.log(`\n🔍 SAMPLE TOPICS BY LEVEL:`);
        sortedLevels.slice(0, 3).forEach((level) => {
            // Show first 3 levels
            const topics = levelTopics.get(level)!;
            console.log(`   Level ${level} (${topics.length} topics):`);
            topics.slice(0, 3).forEach((topic) => {
                // Show first 3 topics in each level
                console.log(
                    `     - "${topic.name}" (confidence: ${topic.confidence?.toFixed(2) || "N/A"}, children: ${topic.childCount})`,
                );
            });
        });

        // LoD recommendations based on analysis
        console.log(`\n💡 LEVEL OF DETAIL RECOMMENDATIONS:`);
        const highImportanceCount =
            importanceBuckets.get("High (0.6-0.8)")! +
            importanceBuckets.get("Very High (0.8-1.0)")!;
        const lowZoomThreshold = Math.min(
            0.8,
            highImportanceCount / data.topics.length,
        );

        console.log(
            `   - At low zoom, show ~${highImportanceCount} high-importance topics (threshold: ${lowZoomThreshold.toFixed(2)})`,
        );
        console.log(
            `   - Level 0 topics (${levelCounts.get(0) || 0}) should be prioritized for visibility`,
        );
        console.log(`   - Current max depth: ${data.maxDepth} levels`);

        console.log("=== END TOPIC ANALYSIS ===\n");

        // Detailed hierarchy investigation
        this.investigateHierarchyStructure(data);
    }

    /**
     * Investigate detailed hierarchy structure and parent-child relationships
     */
    private investigateHierarchyStructure(data: any): void {
        console.log("\n=== DETAILED HIERARCHY INVESTIGATION ===");

        if (!data.topics || data.topics.length === 0) {
            console.log("No topics to investigate");
            return;
        }

        // Find root nodes (level 0)
        const rootNodes = data.topics.filter((t: any) => t.level === 0);
        console.log(
            `\n🌳 ROOT NODES ANALYSIS (${rootNodes.length} root nodes):`,
        );

        // Analyze each root node's hierarchy
        rootNodes.forEach((root: any, index: number) => {
            console.log(`\n📂 Root Node ${index + 1}: "${root.name}"`);
            console.log(`   ├─ ID: ${root.id}`);
            console.log(
                `   ├─ Confidence: ${root.confidence?.toFixed(2) || "N/A"}`,
            );
            console.log(`   ├─ Direct Children: ${root.childCount}`);
            console.log(
                `   ├─ Keywords: ${root.keywords.length} (${root.keywords.slice(0, 3).join(", ")}${root.keywords.length > 3 ? "..." : ""})`,
            );

            // Get all descendants of this root
            const descendants = this.getAllDescendants(root.id, data.topics);
            console.log(`   └─ Total Descendants: ${descendants.length}`);

            if (descendants.length > 0) {
                // Show hierarchy tree for first few children
                console.log(`\n   🌿 Children Structure (showing first 10):`);
                const directChildren = data.topics.filter(
                    (t: any) => t.parentId === root.id,
                );
                directChildren
                    .slice(0, 10)
                    .forEach((child: any, childIndex: number) => {
                        const isLast =
                            childIndex ===
                            Math.min(9, directChildren.length - 1);
                        const prefix = isLast ? "   └─" : "   ├─";
                        console.log(
                            `${prefix} "${this.truncateText(child.name, 60)}" (conf: ${child.confidence?.toFixed(2) || "N/A"})`,
                        );
                    });

                if (directChildren.length > 10) {
                    console.log(
                        `   └─ ... and ${directChildren.length - 10} more children`,
                    );
                }

                // Analyze depth distribution under this root
                const depthDistribution = this.analyzeDepthDistribution(
                    root.id,
                    data.topics,
                );
                console.log(
                    `\n   📊 Depth Distribution under "${this.truncateText(root.name, 40)}":`,
                );
                Object.entries(depthDistribution).forEach(([depth, count]) => {
                    console.log(`      Level ${depth}: ${count} topics`);
                });
            }
        });

        // Overall hierarchy statistics
        console.log(`\n📈 HIERARCHY STATISTICS:`);
        console.log(`   ├─ Total Nodes: ${data.topics.length}`);
        console.log(`   ├─ Root Nodes: ${rootNodes.length}`);
        console.log(
            `   ├─ Leaf Nodes: ${data.topics.filter((t: any) => t.childCount === 0).length}`,
        );
        console.log(
            `   ├─ Average Fan-out: ${this.calculateAverageFanout(data.topics).toFixed(1)}`,
        );
        console.log(`   ├─ Max Depth: ${data.maxDepth}`);
        console.log(
            `   └─ Hierarchy Effectiveness: ${this.assessHierarchyEffectiveness(data.topics)}`,
        );

        // Parent-child relationship validation
        const orphanedNodes = data.topics.filter(
            (t: any) =>
                t.level > 0 &&
                !data.topics.some((p: any) => p.id === t.parentId),
        );
        if (orphanedNodes.length > 0) {
            console.log(`\n⚠️  HIERARCHY ISSUES:`);
            console.log(
                `   └─ Orphaned nodes: ${orphanedNodes.length} (nodes with missing parents)`,
            );
        }

        // LoD improvement recommendations based on investigation
        console.log(`\n💡 LOD IMPROVEMENT RECOMMENDATIONS:`);
        this.suggestLoDImprovements(data);

        console.log("\n=== END HIERARCHY INVESTIGATION ===\n");
    }

    /**
     * Get all descendants of a given topic
     */
    private getAllDescendants(topicId: string, allTopics: any[]): any[] {
        const descendants: any[] = [];
        const directChildren = allTopics.filter((t) => t.parentId === topicId);

        directChildren.forEach((child) => {
            descendants.push(child);
            // Recursively get descendants of this child
            const childDescendants = this.getAllDescendants(
                child.id,
                allTopics,
            );
            descendants.push(...childDescendants);
        });

        return descendants;
    }

    /**
     * Analyze depth distribution under a specific root
     */
    private analyzeDepthDistribution(
        rootId: string,
        allTopics: any[],
    ): Record<number, number> {
        const distribution: Record<number, number> = {};
        const descendants = this.getAllDescendants(rootId, allTopics);

        descendants.forEach((topic) => {
            const level = topic.level;
            distribution[level] = (distribution[level] || 0) + 1;
        });

        return distribution;
    }

    /**
     * Calculate average fan-out (children per non-leaf node)
     */
    private calculateAverageFanout(allTopics: any[]): number {
        const nonLeafNodes = allTopics.filter((t) => t.childCount > 0);
        if (nonLeafNodes.length === 0) return 0;

        const totalChildren = nonLeafNodes.reduce(
            (sum, node) => sum + node.childCount,
            0,
        );
        return totalChildren / nonLeafNodes.length;
    }

    /**
     * Assess hierarchy effectiveness for LoD purposes
     */
    private assessHierarchyEffectiveness(allTopics: any[]): string {
        const levels = [...new Set(allTopics.map((t) => t.level))].length;
        const avgFanout = this.calculateAverageFanout(allTopics);
        const leafPercentage =
            (allTopics.filter((t) => t.childCount === 0).length /
                allTopics.length) *
            100;

        if (levels <= 2 && avgFanout > 50) {
            return "Poor (Too flat, high fan-out)";
        } else if (levels <= 2) {
            return "Fair (Flat but manageable fan-out)";
        } else if (levels >= 4 && avgFanout < 10) {
            return "Good (Deep hierarchy, balanced fan-out)";
        } else if (levels >= 3) {
            return "Fair (Multi-level but needs balancing)";
        } else {
            return "Moderate";
        }
    }

    /**
     * Truncate text to specified length with ellipsis
     */
    private truncateText(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + "...";
    }

    /**
     * Suggest LoD improvements based on hierarchy and importance analysis
     */
    private suggestLoDImprovements(data: any): void {
        const rootNodes = data.topics.filter((t: any) => t.level === 0);
        const avgFanout = this.calculateAverageFanout(data.topics);
        const leafNodes = data.topics.filter((t: any) => t.childCount === 0);

        console.log(`\n   🔧 CURRENT PROBLEMS:`);
        console.log(
            `      ├─ Flat hierarchy (only ${data.maxDepth + 1} levels)`,
        );
        console.log(
            `      ├─ High fan-out (avg: ${avgFanout.toFixed(1)} children per parent)`,
        );
        console.log(`      ├─ Uniform importance (99% in same bucket)`);
        console.log(`      └─ Poor LoD effectiveness`);

        console.log(`\n   🎯 ALTERNATIVE LOD STRATEGIES:`);

        // Strategy 1: Child count-based importance
        console.log(`      1. CHILD COUNT-BASED IMPORTANCE:`);
        const childCountDistribution = this.analyzeChildCountDistribution(
            data.topics,
        );
        console.log(`         ├─ Use childCount as primary importance factor`);
        console.log(
            `         ├─ Topics with >100 children: ${childCountDistribution.high} (high priority)`,
        );
        console.log(
            `         ├─ Topics with 10-100 children: ${childCountDistribution.medium} (medium priority)`,
        );
        console.log(
            `         └─ Topics with <10 children: ${childCountDistribution.low} (low priority)`,
        );

        // Strategy 2: Keyword density-based importance
        console.log(`\n      2. KEYWORD DENSITY-BASED IMPORTANCE:`);
        const keywordStats = this.analyzeKeywordDistribution(data.topics);
        console.log(
            `         ├─ Use keyword count as semantic importance indicator`,
        );
        console.log(
            `         ├─ Rich topics (>5 keywords): ${keywordStats.rich} topics`,
        );
        console.log(
            `         ├─ Medium topics (2-5 keywords): ${keywordStats.medium} topics`,
        );
        console.log(
            `         └─ Sparse topics (<2 keywords): ${keywordStats.sparse} topics`,
        );

        // Strategy 3: Root-distance based LoD
        console.log(`\n      3. ROOT-DISTANCE BASED LOD:`);
        console.log(`         ├─ Always show: ${rootNodes.length} root topics`);
        console.log(
            `         ├─ Show at medium zoom: Direct children of large roots`,
        );
        console.log(`         ├─ Show at high zoom: All remaining topics`);
        console.log(`         └─ Advantage: Guarantees hierarchical structure`);

        // Strategy 4: Confidence-based clustering
        console.log(`\n      4. CONFIDENCE-BASED CLUSTERING:`);
        const confidenceStats = this.analyzeConfidenceDistribution(data.topics);
        console.log(
            `         ├─ High confidence (>0.8): ${confidenceStats.high} topics`,
        );
        console.log(
            `         ├─ Medium confidence (0.6-0.8): ${confidenceStats.medium} topics`,
        );
        console.log(
            `         ├─ Low confidence (<0.6): ${confidenceStats.low} topics`,
        );
        console.log(
            `         └─ Use confidence * childCount as hybrid importance`,
        );

        console.log(`\n   🏆 RECOMMENDED APPROACH:`);
        console.log(`      ├─ Primary: Root-distance based LoD for structure`);
        console.log(
            `      ├─ Secondary: Child count for within-level importance`,
        );
        console.log(`      ├─ Tertiary: Keyword density for semantic richness`);
        console.log(`      └─ Result: Meaningful progressive disclosure`);
    }

    /**
     * Analyze child count distribution for importance assessment
     */
    private analyzeChildCountDistribution(topics: any[]): {
        high: number;
        medium: number;
        low: number;
    } {
        const high = topics.filter((t) => t.childCount > 100).length;
        const medium = topics.filter(
            (t) => t.childCount >= 10 && t.childCount <= 100,
        ).length;
        const low = topics.filter((t) => t.childCount < 10).length;
        return { high, medium, low };
    }

    /**
     * Analyze keyword distribution for semantic importance
     */
    private analyzeKeywordDistribution(topics: any[]): {
        rich: number;
        medium: number;
        sparse: number;
    } {
        const rich = topics.filter((t) => t.keywords.length > 5).length;
        const medium = topics.filter(
            (t) => t.keywords.length >= 2 && t.keywords.length <= 5,
        ).length;
        const sparse = topics.filter((t) => t.keywords.length < 2).length;
        return { rich, medium, sparse };
    }

    /**
     * Analyze confidence distribution for clustering
     */
    private analyzeConfidenceDistribution(topics: any[]): {
        high: number;
        medium: number;
        low: number;
    } {
        const high = topics.filter((t) => (t.confidence || 0) > 0.8).length;
        const medium = topics.filter(
            (t) => (t.confidence || 0) >= 0.6 && (t.confidence || 0) <= 0.8,
        ).length;
        const low = topics.filter((t) => (t.confidence || 0) < 0.6).length;
        return { high, medium, low };
    }

    private showTopicDetails(topic: any): void {
        this.state.currentTopic = topic.id;

        this.openSidebar();

        const sidebarContent = document.getElementById("sidebarContent")!;
        sidebarContent.innerHTML = `
            <div class="topic-details">
                <div class="topic-name">${this.escapeHtml(topic.name)}</div>
                <div class="topic-meta">
                    <span class="topic-level">Level ${topic.level}</span>
                    <span class="topic-confidence">${Math.round(topic.confidence * 100)}% confidence</span>
                </div>

                <div class="topic-timeline">
                    <h6>Timeline</h6>
                    <div class="timeline-info">
                        <div class="timeline-item">
                            <span class="timeline-label">First Seen:</span>
                            <span id="topicFirstSeen" class="timeline-value">Loading...</span>
                        </div>
                        <div class="timeline-item">
                            <span class="timeline-label">Last Seen:</span>
                            <span id="topicLastSeen" class="timeline-value">Loading...</span>
                        </div>
                    </div>
                </div>

                <div class="topic-keywords">
                    <h6>Keywords</h6>
                    <div id="topicKeywords" class="keyword-tags">
                        <span class="text-muted">Loading...</span>
                    </div>
                </div>

                <div class="topic-entities">
                    <h6>Related Entities</h6>
                    <ul id="topicEntities" class="entity-list">
                        <li class="text-muted">Loading...</li>
                    </ul>
                </div>

                <div class="topic-actions">
                    <button class="btn btn-sm btn-primary" data-action="expand" data-topic-id="${topic.id}">
                        <i class="bi bi-plus-square"></i> Expand
                    </button>
                    <button class="btn btn-sm btn-outline-primary" data-action="focus" data-topic-id="${topic.id}">
                        <i class="bi bi-bullseye"></i> Focus
                    </button>
                </div>
            </div>
        `;

        this.state.sidebarOpen = true;

        this.loadTopicDetails(topic.id);
    }

    private async loadTopicDetails(topicId: string): Promise<void> {
        try {
            const result = await this.extensionService.getTopicDetails(topicId);

            if (result && result.success && result.details) {
                const details = result.details;

                const firstSeenEl = document.getElementById("topicFirstSeen");
                const lastSeenEl = document.getElementById("topicLastSeen");
                const keywordsEl = document.getElementById("topicKeywords");
                const entitiesEl = document.getElementById("topicEntities");

                if (firstSeenEl) {
                    firstSeenEl.textContent = details.firstSeen
                        ? this.formatDate(details.firstSeen)
                        : "-";
                }

                if (lastSeenEl) {
                    lastSeenEl.textContent = details.lastSeen
                        ? this.formatDate(details.lastSeen)
                        : "-";
                }

                if (keywordsEl && details.keywords && details.keywords.length > 0) {
                    keywordsEl.innerHTML = details.keywords
                        .map(
                            (keyword: string) =>
                                `<span class="keyword-tag">${this.escapeHtml(keyword)}</span>`,
                        )
                        .join("");
                } else if (keywordsEl) {
                    keywordsEl.innerHTML = '<span class="text-muted">No keywords</span>';
                }

                if (entitiesEl && details.entityReferences && details.entityReferences.length > 0) {
                    entitiesEl.innerHTML = details.entityReferences
                        .map(
                            (entity: string) =>
                                `<li class="entity-item" title="Click to view in Entity Graph">${this.escapeHtml(entity)}</li>`,
                        )
                        .join("");
                } else if (entitiesEl) {
                    entitiesEl.innerHTML = '<li class="text-muted">No related entities</li>';
                }
            }
        } catch (error) {
            console.error("Error loading topic details:", error);
            const firstSeenEl = document.getElementById("topicFirstSeen");
            const lastSeenEl = document.getElementById("topicLastSeen");
            const keywordsEl = document.getElementById("topicKeywords");
            const entitiesEl = document.getElementById("topicEntities");

            if (firstSeenEl) firstSeenEl.textContent = "-";
            if (lastSeenEl) lastSeenEl.textContent = "-";
            if (keywordsEl) keywordsEl.innerHTML = '<span class="text-muted">Error loading</span>';
            if (entitiesEl) entitiesEl.innerHTML = '<li class="text-muted">Error loading</li>';
        }
    }

    private formatDate(dateString: string | undefined | null): string {
        if (!dateString) {
            return "-";
        }
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) {
                return "-";
            }
            return date.toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
            });
        } catch {
            return "-";
        }
    }

    private handleSearch(): void {
        if (!this.visualizer || !this.state.searchQuery.trim()) {
            this.visualizer?.highlightSearchResults([]);
            return;
        }

        const results = this.visualizer.searchTopics(this.state.searchQuery);
        const topicIds = results.map((topic) => topic.id);

        this.visualizer.highlightSearchResults(topicIds);

        // Show notification with results count
        this.showNotification(
            `Found ${results.length} topics matching "${this.state.searchQuery}"`,
        );
    }

    private updateGraphStats(): void {
        const stats = this.visualizer?.getGraphStats();
        if (!stats) return;

        document.getElementById("totalTopics")!.textContent =
            stats.totalTopics.toString();
        document.getElementById("visibleTopics")!.textContent =
            stats.visibleTopics.toString();
        document.getElementById("maxDepth")!.textContent =
            stats.maxDepth.toString();
        document.getElementById("expandedCount")!.textContent =
            stats.expandedNodes.length.toString();
    }

    private updateBreadcrumb(topic: any): void {
        const topicNameBreadcrumb = document.getElementById(
            "topicNameBreadcrumb",
        );
        if (topicNameBreadcrumb) {
            if (topic && topic.name && topic.name !== "All Topics") {
                topicNameBreadcrumb.textContent = ` > ${topic.name}`;
                topicNameBreadcrumb.style.display = "inline";
            } else {
                topicNameBreadcrumb.textContent = "";
                topicNameBreadcrumb.style.display = "none";
            }
        }
    }

    private exportGraph(): void {
        if (!this.visualizer) return;

        const imageData = this.visualizer.exportAsImage("png");
        const link = document.createElement("a");
        link.download = `topic-graph-${new Date().toISOString().slice(0, 10)}.png`;
        link.href = imageData;
        link.click();

        this.showNotification("Graph exported as image");
    }

    private exportGraphologyJson(): void {
        if (!this.lastLoadedData || !this.lastLoadedData.presetLayout) {
            this.showNotification(
                "No graphology layout data available to export",
            );
            return;
        }

        const jsonData = JSON.stringify(
            this.lastLoadedData.presetLayout.elements,
            null,
            2,
        );
        const blob = new Blob([jsonData], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `graphology-topic-graph-${new Date().toISOString().slice(0, 10)}.json`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);

        this.showNotification("Cytoscape JSON exported successfully");
    }

    private toggleSidebar(): void {
        this.state.sidebarOpen = !this.state.sidebarOpen;
        this.sidebar.classList.toggle("visible", this.state.sidebarOpen);
    }

    private navigateToEntityGraph(entityName: string): void {
        window.location.href = `entityGraphView.html?entity=${encodeURIComponent(entityName)}`;
    }

    private navigateToGlobalView(): void {
        // Reset to global view
        this.state.currentTopic = null;
        this.updateBreadcrumb({ name: "All Topics" });
        this.loadInitialData();
    }

    private goBack(): void {
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.href = "knowledgeLibrary.html";
        }
    }

    private goToRoot(): void {
        this.visualizer?.fitToView();
        this.state.currentTopic = null;
        this.updateBreadcrumb({ name: "All Topics" });
    }

    public expandTopic(topicId: string): void {
        this.visualizer?.toggleTopicExpansion(topicId);
        this.updateGraphStats();
    }

    public focusOnTopic(topicId: string): void {
        this.visualizer?.focusOnTopic(topicId);
    }

    private showLoading(): void {
        this.loadingOverlay.style.display = "flex";
        this.errorOverlay.style.display = "none";
    }

    private hideLoading(): void {
        this.loadingOverlay.style.display = "none";
    }

    private showError(message: string): void {
        this.hideLoading();
        this.errorOverlay.style.display = "flex";
        document.getElementById("errorMessage")!.textContent = message;
    }

    private showNotification(message: string): void {
        const toast = document.getElementById("notification")!;
        const toastBody = document.getElementById("notificationBody")!;

        toastBody.textContent = message;

        const bsToast = new (window as any).bootstrap.Toast(toast);
        bsToast.show();
    }

    private openSidebar(): void {
        this.state.sidebarOpen = true;
        this.sidebar.classList.remove("collapsed");
    }

    private closeSidebar(): void {
        this.state.sidebarOpen = false;
        this.sidebar.classList.add("collapsed");
    }

    private escapeHtml(text: string): string {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the topic graph view
let topicGraphView: TopicGraphView;

document.addEventListener("DOMContentLoaded", () => {
    topicGraphView = new TopicGraphView();

    // Make it globally accessible for onclick handlers
    (window as any).topicGraphView = topicGraphView;
});
