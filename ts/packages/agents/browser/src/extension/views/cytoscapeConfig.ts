// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import cytoscape from "cytoscape";

export interface GraphSizeConfig {
    small: number;      // < 1000 nodes
    medium: number;     // 1000-5000 nodes  
    large: number;      // 5000-20000 nodes
    xlarge: number;     // > 20000 nodes
}

export interface CytoscapeConfigOptions {
    nodeCount: number;
    enableAnimations?: boolean;
    enableNodeLabels?: boolean;
    enableEdgeLabels?: boolean;
    layoutQuality?: 'draft' | 'default' | 'proof';
}

/**
 * Optimized Cytoscape configuration for different graph sizes
 */
export class CytoscapeConfigManager {
    private static readonly SIZE_THRESHOLDS: GraphSizeConfig = {
        small: 1000,
        medium: 5000,
        large: 20000,
        xlarge: Infinity
    };

    /**
     * Get optimized configuration based on graph size and options
     */
    static getOptimizedConfig(options: CytoscapeConfigOptions): cytoscape.CytoscapeOptions {
        const graphSize = this.getGraphSize(options.nodeCount);
        const baseConfig = this.getBaseConfig(graphSize);
        
        // Apply option overrides
        if (options.enableAnimations === false) {
            this.disableAnimations(baseConfig);
        }
        
        if (options.enableNodeLabels === false) {
            this.disableNodeLabels(baseConfig);
        }
        
        if (options.enableEdgeLabels === false) {
            this.disableEdgeLabels(baseConfig);
        }
        
        // Set layout quality
        this.setLayoutQuality(baseConfig, options.layoutQuality || 'default', graphSize);
        
        return baseConfig;
    }

    /**
     * Determine graph size category
     */
    private static getGraphSize(nodeCount: number): keyof GraphSizeConfig {
        if (nodeCount < this.SIZE_THRESHOLDS.small) {
            return 'small';
        } else if (nodeCount < this.SIZE_THRESHOLDS.medium) {
            return 'medium';
        } else if (nodeCount < this.SIZE_THRESHOLDS.large) {
            return 'large';
        } else {
            return 'xlarge';
        }
    }

    /**
     * Get base configuration for graph size
     */
    private static getBaseConfig(graphSize: keyof GraphSizeConfig): cytoscape.CytoscapeOptions {
        const common = this.getCommonConfig();
        
        switch (graphSize) {
            case 'small':
                return {
                    ...common,
                    ...this.getSmallGraphConfig()
                };
            case 'medium':
                return {
                    ...common,
                    ...this.getMediumGraphConfig()
                };
            case 'large':
                return {
                    ...common,
                    ...this.getLargeGraphConfig()
                };
            case 'xlarge':
                return {
                    ...common,
                    ...this.getXLargeGraphConfig()
                };
            default:
                return common;
        }
    }

    /**
     * Common configuration for all graph sizes
     */
    private static getCommonConfig(): Partial<cytoscape.CytoscapeOptions> {
        return {
            wheelSensitivity: 0.2,
            minZoom: 0.1,
            maxZoom: 10,
            zoomingEnabled: true,
            userZoomingEnabled: true,
            panningEnabled: true,
            userPanningEnabled: true,
            selectionType: 'single',
            touchTapThreshold: 8,
            desktopTapThreshold: 4,
            autolock: false,
            autoungrabify: false,
            autounselectify: false,
            
            style: [
                // Node styles
                {
                    selector: 'node',
                    style: {
                        'width': 'data(size)',
                        'height': 'data(size)',
                        'background-color': 'data(color)',
                        'border-width': 2,
                        'border-color': '#666',
                        'label': 'data(label)',
                        'font-size': '12px',
                        'font-weight': 'normal',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'color': '#333',
                        'text-outline-width': 1,
                        'text-outline-color': '#fff',
                        'text-wrap': 'wrap',
                        'text-max-width': '80px',
                        'min-zoomed-font-size': 8,
                        'z-index': 10
                    }
                },
                
                // Hub node styles (high degree)
                {
                    selector: 'node[size > 30]',
                    style: {
                        'border-width': 3,
                        'border-color': '#e74c3c',
                        'font-weight': 'bold',
                        'z-index': 20
                    }
                },
                
                // Community node styles
                {
                    selector: 'node.community',
                    style: {
                        'shape': 'round-rectangle',
                        'background-color': '#3498db',
                        'border-color': '#2980b9',
                        'opacity': 0.8
                    }
                },
                
                // Edge styles
                {
                    selector: 'edge',
                    style: {
                        'width': 'mapData(weight, 0, 1, 1, 4)',
                        'line-color': 'data(color)',
                        'target-arrow-color': 'data(color)',
                        'target-arrow-shape': 'triangle-backcurve',
                        'arrow-scale': 1.2,
                        'curve-style': 'haystack',
                        'haystack-radius': 0.3,
                        'opacity': 0.6,
                        'z-index': 1
                    }
                },
                
                // High confidence edges
                {
                    selector: 'edge[confidence > 0.8]',
                    style: {
                        'width': 3,
                        'opacity': 0.9
                    }
                },
                
                // Selected element styles
                {
                    selector: ':selected',
                    style: {
                        'border-width': 4,
                        'border-color': '#f39c12',
                        'z-index': 30
                    }
                },
                
                // Highlighted elements
                {
                    selector: '.highlighted',
                    style: {
                        'background-color': '#e74c3c',
                        'line-color': '#e74c3c',
                        'target-arrow-color': '#e74c3c',
                        'opacity': 1,
                        'z-index': 25
                    }
                },
                
                // Faded elements
                {
                    selector: '.faded',
                    style: {
                        'opacity': 0.3,
                        'z-index': 1
                    }
                }
            ]
        };
    }

    /**
     * Configuration for small graphs (< 1000 nodes)
     */
    private static getSmallGraphConfig(): Partial<cytoscape.CytoscapeOptions> {
        return {
            // Enable all visual features for small graphs
            pixelRatio: window.devicePixelRatio || 1,
            motionBlur: true,
            textureOnViewport: false,
            hideEdgesOnViewport: false,
            hideLabelsOnViewport: false,
            
            layout: {
                name: 'cose-bilkent',
                animationDuration: 1000,
                animationEasing: 'ease-out',
                fit: true,
                padding: 50,
                idealEdgeLength: 80,
                nodeRepulsion: 5000,
                edgeElasticity: 100,
                nestingFactor: 0.1,
                gravity: 0.25,
                numIterations: 2500,
                tile: true,
                tilingPaddingVertical: 20,
                tilingPaddingHorizontal: 20
            } as any
        };
    }

    /**
     * Configuration for medium graphs (1000-5000 nodes)
     */
    private static getMediumGraphConfig(): Partial<cytoscape.CytoscapeOptions> {
        return {
            pixelRatio: 1,
            motionBlur: false,
            textureOnViewport: true,
            hideEdgesOnViewport: false,
            hideLabelsOnViewport: false,
            
            layout: {
                name: 'cose-bilkent',
                fit: true,
                padding: 30,
                idealEdgeLength: 60,
                nodeRepulsion: 4500,
                edgeElasticity: 80,
                nestingFactor: 0.1,
                gravity: 0.2,
                numIterations: 1000,
                tile: true,
                tilingPaddingVertical: 15,
                tilingPaddingHorizontal: 15
            } as any
        };
    }

    /**
     * Configuration for large graphs (5000-20000 nodes)
     */
    private static getLargeGraphConfig(): Partial<cytoscape.CytoscapeOptions> {
        return {
            pixelRatio: 1,
            motionBlur: false,
            textureOnViewport: true,
            hideEdgesOnViewport: true, // Hide edges during viewport changes
            hideLabelsOnViewport: true, // Hide labels during viewport changes
            
            layout: {
                name: 'cose-bilkent',
                fit: true,
                padding: 20,
                idealEdgeLength: 50,
                nodeRepulsion: 4000,
                edgeElasticity: 60,
                nestingFactor: 0.05,
                gravity: 0.15,
                numIterations: 500,
                tile: true,
                tilingPaddingVertical: 10,
                tilingPaddingHorizontal: 10
            } as any
        };
    }

    /**
     * Configuration for extra large graphs (> 20000 nodes)
     */
    private static getXLargeGraphConfig(): Partial<cytoscape.CytoscapeOptions> {
        return {
            pixelRatio: 1,
            motionBlur: false,
            textureOnViewport: true,
            hideEdgesOnViewport: true,
            hideLabelsOnViewport: true,
            
            layout: {
                name: 'preset', // Use preset positions for very large graphs
                fit: true,
                padding: 10
            }
        };
    }

    /**
     * Disable animations in configuration
     */
    private static disableAnimations(config: cytoscape.CytoscapeOptions): void {
        // Animation properties are handled by specific layout options
    }

    /**
     * Disable node labels in configuration
     */
    private static disableNodeLabels(config: cytoscape.CytoscapeOptions): void {
        if (config.style) {
            const nodeStyle = (config.style as any[]).find(s => s.selector === 'node');
            if (nodeStyle) {
                nodeStyle.style.label = '';
                nodeStyle.style['text-opacity'] = 0;
            }
        }
    }

    /**
     * Disable edge labels in configuration
     */
    private static disableEdgeLabels(config: cytoscape.CytoscapeOptions): void {
        if (config.style) {
            const edgeStyle = (config.style as any[]).find(s => s.selector === 'edge');
            if (edgeStyle) {
                edgeStyle.style.label = '';
                edgeStyle.style['text-opacity'] = 0;
            }
        }
    }

    /**
     * Set layout quality based on graph size and preference
     */
    private static setLayoutQuality(
        config: cytoscape.CytoscapeOptions,
        quality: 'draft' | 'default' | 'proof',
        graphSize: keyof GraphSizeConfig
    ): void {
        if (!config.layout) return;

        const layout = config.layout as any;
        
        switch (quality) {
            case 'draft':
                layout.numIterations = Math.min(layout.numIterations || 100, 100);
                // Draft quality settings applied via iterations
                break;
            case 'proof':
                if (graphSize === 'small' || graphSize === 'medium') {
                    layout.numIterations = Math.max(layout.numIterations || 1000, 2000);
                    // Proof quality settings applied via iterations
                }
                break;
            default:
                // Keep existing values
                break;
        }
    }

    /**
     * Get configuration for specific use cases
     */
    static getEntitySpecificConfig(nodeCount: number): cytoscape.CytoscapeOptions {
        return this.getOptimizedConfig({
            nodeCount,
            enableAnimations: nodeCount < 1000,
            enableNodeLabels: true,
            enableEdgeLabels: nodeCount < 500,
            layoutQuality: nodeCount < 1000 ? 'proof' : 'default'
        });
    }

    static getGlobalViewConfig(nodeCount: number): cytoscape.CytoscapeOptions {
        return this.getOptimizedConfig({
            nodeCount,
            enableAnimations: false,
            enableNodeLabels: nodeCount < 200,
            enableEdgeLabels: false,
            layoutQuality: 'draft'
        });
    }

    static getCommunityViewConfig(nodeCount: number): cytoscape.CytoscapeOptions {
        const config = this.getOptimizedConfig({
            nodeCount,
            enableAnimations: nodeCount < 500,
            enableNodeLabels: true,
            enableEdgeLabels: nodeCount < 200,
            layoutQuality: 'default'
        });

        // Adjust for community visualization
        if (config.layout) {
            const layout = config.layout as any;
            layout.idealEdgeLength = 100; // Larger spacing for communities
            layout.nodeRepulsion = 6000;  // More separation
        }

        return config;
    }

    /**
     * Performance monitoring configuration
     */
    static enablePerformanceMonitoring(config: cytoscape.CytoscapeOptions): void {
        // Add performance event handlers
        (config as any).ready = function(event: any) {
            console.log('Cytoscape ready:', event.cy.elements().length, 'elements');
        };

        (config as any).layoutstart = function(event: any) {
            console.time('layout-duration');
        };

        (config as any).layoutstop = function(event: any) {
            console.timeEnd('layout-duration');
        };
    }
}