// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Class for handling the visualization of the web plan
 */
import cytoscape from "cytoscape";

import cytoscapeDagre from "cytoscape-dagre";

// Register the extension
cytoscape.use(cytoscapeDagre as any);

import CONFIG from "./config.js";
import CytoscapeConfig from "./cytoscapeConfig.js";
import {
    WebPlanData,
    PlanLink,
    NodeSelectCallback,
} from "../../shared/types.js";

class Visualizer {
    private container: HTMLElement;
    private webPlanData: WebPlanData;
    private cy: cytoscape.Core | null;
    public pathHighlighted: boolean;
    private tempAnimInterval: number | null;
    private _resizeObserver: ResizeObserver | null;

    /**
     * Create a new Visualizer
     * @param {HTMLElement} container - The container element for Cytoscape
     * @param {WebPlanData} webPlanData - The web plan data
     */
    constructor(container: HTMLElement, webPlanData: WebPlanData) {
        this.container = container;
        this.webPlanData = webPlanData;
        this.cy = null;
        this.pathHighlighted = false;
        this.tempAnimInterval = null;
        this._resizeObserver = null;
    }

    /**
     * Initialize the Cytoscape visualization
     */
    initialize(): void {
        // Handle empty plan case
        if (this.webPlanData.nodes.length === 0) {
            // Just create an empty Cytoscape instance
            this.cy = cytoscape({
                container: this.container,
                elements: [],
                style: CytoscapeConfig.getStyles(),
            });
            return;
        }

        // Convert data to Cytoscape format
        const elements = this._convertDataToElements();

        // Create Cytoscape instance
        this.cy = cytoscape({
            container: this.container,
            elements: elements,
            style: CytoscapeConfig.getStyles(),
        });

        // Apply layout
        this.applyLayout();

        // Start temporary node animation if there are any temporary nodes
        this.startTemporaryNodeAnimation();
    }

    /**
     * Convert web plan data to Cytoscape elements format
     * @returns {Array<cytoscape.ElementDefinition>} Array of Cytoscape elements
     * @private
     */
    private _convertDataToElements(): Array<cytoscape.ElementDefinition> {
        const elements: Array<cytoscape.ElementDefinition> = [];

        // Add nodes
        this.webPlanData.nodes.forEach((node) => {
            const nodeData: any = {
                id: node.id,
                label: node.label,
                type: node.type,
                isActive: node.id === this.webPlanData.currentNode,
                isTemporary: node.isTemporary || false,
            };

            // Only add screenshot data if it exists
            if (node.screenshot) {
                nodeData.screenshot = node.screenshot;
                nodeData.hasScreenshot = true;
            }
            if (node.label && node.label.startsWith("__")) {
                // set to empty string for display
                nodeData.label = " ";
            }

            elements.push({
                data: nodeData,
            });
        });

        // Add edges
        this.webPlanData.links.forEach((link, index) => {
            elements.push({
                data: {
                    id: `edge-${index}`,
                    source: link.source,
                    target: link.target,
                    label: link.label || "",
                    edgeType: this._getEdgeType(link),
                },
            });
        });

        return elements;
    }

    /**
     * Determine edge type based on connection
     * @param {PlanLink} link - The link object
     * @returns {string} Edge type
     * @private
     */
    private _getEdgeType(link: PlanLink): string {
        if (link.label === "Yes") {
            return CONFIG.EDGE_TYPES.DECISION_YES;
        } else if (link.label === "No") {
            return CONFIG.EDGE_TYPES.DECISION_NO;
        } else {
            return CONFIG.EDGE_TYPES.STANDARD;
        }
    }

    /**
     * Apply layout to the graph
     */
    applyLayout(): void {
        if (!this.cy) return;

        try {
            const dagreLayout = this.cy.layout(
                CytoscapeConfig.getDagreLayoutOptions(),
            );
            dagreLayout.run();
        } catch (e) {
            console.error("Error running dagre layout:", e);

            // Use breadthfirst as fallback
            const fallbackLayout = this.cy.layout(
                CytoscapeConfig.getFallbackLayoutOptions(),
            );
            fallbackLayout.run();
        }
    }

    /**
     * Update current node and zoom to show its context
     * @param {string} nodeId - The ID of the node to make active
     */
    updateCurrentNode(nodeId: string): void {
        if (!this.cy) return;

        // Reset all nodes
        this.cy.nodes().forEach((node) => {
            node.data("isActive", false);
        });

        // Set the active node
        const activeNode = this.cy.getElementById(nodeId);
        if (activeNode.length > 0) {
            activeNode.data("isActive", true);

            // Update webPlanData reference
            this.webPlanData.currentNode = nodeId;

            const focusElements = this.cy.collection().merge(activeNode);

            // Center the viewport on the active node with animation
            // Include padding to ensure all connected elements are visible
            this.cy.animate({
                fit: {
                    eles: focusElements,
                    padding: 200, // Increased padding to ensure visibility of all elements
                },
                duration: CONFIG.ANIMATION.LAYOUT,
                easing: "ease-in-out-cubic",
            });
        }
    }

    /**
     * Update the visualization when replacing a temporary node
     * @param {WebPlanData} oldData - Previous graph data
     * @param {WebPlanData} newData - New graph data after replacement
     * @returns {boolean} True if update was successful, false otherwise
     */
    updateWithoutRedraw(oldData: WebPlanData, newData: WebPlanData): boolean {
        if (
            !this.cy ||
            !oldData ||
            !newData ||
            !oldData.nodes ||
            !newData.nodes ||
            !Array.isArray(oldData.nodes) ||
            !Array.isArray(newData.nodes)
        ) {
            console.error("Invalid data for incremental update");
            return false;
        }

        // Track which node to focus on at the end
        let nodeToFocus: string | null = null;

        // Special case for the first node being added
        if (oldData.nodes.length === 0 && newData.nodes.length > 0) {
            // This is the first node - we need a complete initialization
            this.webPlanData = newData;

            // Completely reinitialize BUT don't apply layout yet
            this.cy.remove("*"); // Remove all elements
            const elements = this._convertDataToElements();
            this.cy.add(elements);

            // Focus on the last node before applying layout
            nodeToFocus = newData.nodes[newData.nodes.length - 1].id;

            // Apply layout once without animation
            this.cy
                .layout({
                    name: "dagre",
                    rankDir: "TB",
                    rankSep: 100,
                    nodeSep: 50,
                    fit: false, // Don't auto-fit as we'll do that manually with the focus
                    animate: false,
                } as any)
                .run();

            // Focus on the node after layout is applied
            if (nodeToFocus) {
                this._focusOnNodeContext(nodeToFocus);
            }

            this.startTemporaryNodeAnimation();

            return true;
        }

        // Find the temporary nodes in the old and new data
        const oldTempNodes = oldData.nodes.filter((node) => node.isTemporary);
        const newTempNodes = newData.nodes.filter((node) => node.isTemporary);

        // Case 1: A temporary node was replaced with a final state (the temporary node exists in old data but not in new data)
        // or it has the same ID but is no longer temporary
        const replacedTempNodes = oldTempNodes.filter((oldTempNode) => {
            // Check if this temp node no longer exists or is no longer temporary in new data
            const matchingNewNode = newData.nodes.find(
                (newNode) => newNode.id === oldTempNode.id,
            );
            return !matchingNewNode || !matchingNewNode.isTemporary;
        });

        if (replacedTempNodes.length > 0) {
            // Process each replaced temporary node
            let allReplacementsSuccessful = true;

            for (const oldTempNode of replacedTempNodes) {
                // Find the replacement node in new data
                const replacementNode = newData.nodes.find(
                    (node) => node.id === oldTempNode.id && !node.isTemporary,
                );

                if (replacementNode) {
                    // Update the temporary node in-place
                    const tempNode = this.cy.getElementById(oldTempNode.id);

                    if (tempNode.length > 0) {
                        try {
                            // Stop any existing animations
                            (tempNode as any).animation().stop();
                        } catch (animError) {
                            console.warn(
                                "Error stopping animation:",
                                animError,
                            );
                        }

                        // Update the node's data
                        tempNode.data({
                            label: replacementNode.label || "",
                            type: replacementNode.type,
                            isTemporary: false,
                            isActive:
                                replacementNode.id === newData.currentNode,
                            screenshot: replacementNode.screenshot,
                            hasScreenshot: !!replacementNode.screenshot,
                        });

                        // Get the proper color for the node type
                        const nodeColor = Visualizer.getNodeColor(
                            replacementNode.type,
                        );

                        // Animate the node to highlight the change
                        tempNode.animate({
                            style: {
                                "background-color": CONFIG.COLORS.HIGHLIGHT,
                                "border-color": CONFIG.COLORS.HIGHLIGHT,
                                "border-width": 5,
                                opacity: 1,
                                "border-style": "solid",
                            },
                            duration: 300,
                            complete: () => {
                                tempNode.animate({
                                    style: {
                                        "background-color": nodeColor,
                                        "border-color": CONFIG.COLORS.HIGHLIGHT,
                                        "border-width": 3,
                                        opacity: 1,
                                        "border-style": "solid",
                                    },
                                    duration: 300,
                                });
                            },
                        });

                        // Set as node to focus
                        nodeToFocus = oldTempNode.id;
                    } else {
                        allReplacementsSuccessful = false;
                    }
                } else {
                    // The temporary node was removed but not replaced
                    const tempNode = this.cy.getElementById(oldTempNode.id);

                    if (tempNode.length > 0) {
                        // Fade out and remove the node
                        tempNode.animate({
                            style: { opacity: 0 },
                            duration: 300,
                            complete: () => {
                                this.cy?.remove(tempNode);
                            },
                        });
                    }
                }
            }

            if (!allReplacementsSuccessful) {
                return false;
            }
        }

        // Case 2: A new temporary node was added (exists in new data but not in old data)
        const newlyAddedTempNodes = newTempNodes.filter(
            (newTempNode) =>
                !oldData.nodes.some(
                    (oldNode) =>
                        oldNode.id === newTempNode.id && oldNode.isTemporary,
                ),
        );

        if (newlyAddedTempNodes.length > 0) {
            let allAdditionsSuccessful = true;

            for (const newTempNode of newlyAddedTempNodes) {
                // Find the link to this new temporary node
                const tempNodeLink = newData.links.find(
                    (link) => link.target === newTempNode.id,
                );

                if (tempNodeLink) {
                    const sourceNodeId = tempNodeLink.source;

                    // Check if the source node exists in the graph
                    const sourceCyNode = this.cy.getElementById(sourceNodeId);

                    if (sourceCyNode.length > 0) {
                        // Use the actual node ID instead of generating a new one to maintain consistency
                        const nodeId = newTempNode.id;

                        // Add the temporary node
                        const addedNode = this.cy.add({
                            group: "nodes",
                            data: {
                                id: nodeId,
                                label: newTempNode.label || "",
                                type: newTempNode.type || "temporary",
                                isTemporary: true,
                                isActive:
                                    newData.currentNode === newTempNode.id,
                                screenshot: newTempNode.screenshot,
                                hasScreenshot: !!newTempNode.screenshot,
                            },
                        });

                        // Add the edge
                        this.cy.add({
                            group: "edges",
                            data: {
                                id: `edge-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                                source: sourceNodeId,
                                target: nodeId,
                                label: tempNodeLink.label || "",
                                edgeType: this._getEdgeType(tempNodeLink),
                            },
                        });

                        // Position the node
                        const position =
                            this._findOptimalNodePosition(addedNode);
                        addedNode.position(position);

                        // Set as node to focus
                        nodeToFocus = nodeId;

                        // Start the animation
                        setTimeout(() => {
                            try {
                                this.startTemporaryNodeAnimation();
                            } catch (pulseError) {
                                console.warn(
                                    "Error starting pulse animation:",
                                    pulseError,
                                );
                            }
                        }, 100);
                    } else {
                        allAdditionsSuccessful = false;
                    }
                } else {
                    allAdditionsSuccessful = false;
                }
            }

            if (!allAdditionsSuccessful) {
                return false;
            }
        }

        // Case 3: Existing nodes were updated
        const updatedNonTempNodes = newData.nodes.filter(
            (newNode) =>
                !newNode.isTemporary &&
                oldData.nodes.some(
                    (oldNode) =>
                        oldNode.id === newNode.id &&
                        (oldNode.label !== newNode.label ||
                            oldNode.type !== newNode.type ||
                            oldNode.screenshot !== newNode.screenshot),
                ),
        );

        if (updatedNonTempNodes.length > 0) {
            for (const updatedNode of updatedNonTempNodes) {
                const cyNode = this.cy.getElementById(updatedNode.id);

                if (cyNode.length > 0) {
                    // Update the node's data
                    cyNode.data({
                        label: updatedNode.label || "",
                        type: updatedNode.type,
                        isActive: updatedNode.id === newData.currentNode,
                        screenshot: updatedNode.screenshot,
                        hasScreenshot: !!updatedNode.screenshot,
                    });

                    // Refresh the node style
                    this.refreshNodeStyle(updatedNode.id);
                }
            }
        }

        // Handle current node changes
        if (
            oldData.currentNode !== newData.currentNode &&
            newData.currentNode
        ) {
            const currentCyNode = this.cy.getElementById(newData.currentNode);

            if (currentCyNode.length > 0) {
                // Reset active status for all nodes
                this.cy.nodes().forEach((node) => {
                    node.data("isActive", false);
                });

                // Set the new current node as active
                currentCyNode.data("isActive", true);

                // Set as node to focus
                nodeToFocus = newData.currentNode;
            }
        }

        // Update links - add any new links
        const oldLinkKeys = oldData.links.map(
            (link) => `${link.source}-${link.target}`,
        );
        const newLinks = newData.links.filter(
            (newLink) =>
                !oldLinkKeys.includes(`${newLink.source}-${newLink.target}`),
        );

        if (newLinks.length > 0) {
            for (const newLink of newLinks) {
                // Check if both source and target nodes exist
                const sourceNode = this.cy.getElementById(newLink.source);
                const targetNode = this.cy.getElementById(newLink.target);

                if (sourceNode.length > 0 && targetNode.length > 0) {
                    // Add the edge
                    this.cy.add({
                        group: "edges",
                        data: {
                            id: `edge-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                            source: newLink.source,
                            target: newLink.target,
                            label: newLink.label || "",
                            edgeType: this._getEdgeType(newLink),
                        },
                    });
                }
            }
        }

        // Update the web plan data reference
        this.webPlanData = newData;

        // Focus on the identified node
        if (nodeToFocus) {
            this._focusOnNodeContext(nodeToFocus);
        }

        return true;
    }

    /**
     * Find the optimal position for a new node
     * @param {any} node - The node to position
     * @returns {cytoscape.Position} The x,y coordinates for the node
     * @private
     */
    private _findOptimalNodePosition(node: any): cytoscape.Position {
        // Default position in the center
        let position: cytoscape.Position = {
            x: this.cy ? this.cy.width() / 2 : 0,
            y: this.cy ? this.cy.height() / 2 : 0,
        };

        // Get connected edges
        const connectedEdges = node.connectedEdges();
        if (connectedEdges.length === 0) {
            // No connections, place in center
            return position;
        }

        // Check for incoming edges
        const incomingEdges = node.incomers("edge");
        if (incomingEdges.length > 0) {
            // Get the source nodes of incoming edges
            const sourceNodes = incomingEdges.sources();

            if (sourceNodes.length > 0) {
                // Position below the first source node
                const sourceNode = sourceNodes[0];
                return {
                    x: sourceNode.position("x"),
                    y: sourceNode.position("y") + 150,
                };
            }
        }

        // Check for outgoing edges
        const outgoingEdges = node.outgoers("edge");
        if (outgoingEdges.length > 0) {
            // Get the target nodes of outgoing edges
            const targetNodes = outgoingEdges.targets();

            if (targetNodes.length > 0) {
                // Position above the first target node
                const targetNode = targetNodes[0];
                return {
                    x: targetNode.position("x"),
                    y: targetNode.position("y") - 150,
                };
            }
        }

        // If we have other nodes, place this one below the furthest bottom node
        if (this.cy && this.cy.nodes().length > 1) {
            let maxY = -Infinity;
            let centerX = 0;

            this.cy.nodes().forEach((n) => {
                if (n.id() !== node.id()) {
                    maxY = Math.max(maxY, n.position("y"));
                    centerX += n.position("x");
                }
            });

            centerX = centerX / (this.cy.nodes().length - 1);

            if (maxY > -Infinity) {
                return {
                    x: centerX,
                    y: maxY + 150,
                };
            }
        }

        return position;
    }

    /**
     * Apply a partial layout with optional animation
     * @param {boolean} animate - Whether to animate the layout transition
     */
    applyPartialLayout(animate: boolean = true): void {
        if (!this.cy) return;

        // Use a modified layout that keeps nodes in relatively the same positions
        const layoutOptions = {
            name: "dagre",
            rankDir: "TB",
            rankSep: 100,
            nodeSep: 50,
            edgeSep: 50,
            ranker: "network-simplex",
            // Only animate if requested
            animate: animate,
            animationDuration: animate ? CONFIG.ANIMATION.LAYOUT : 0,
            // Don't automatically fit, we'll do that separately
            fit: false,
            padding: 30,
        };

        try {
            // Run the layout
            const layout = this.cy.layout(layoutOptions as any);
            layout.run();

            // Fit to view after layout completes
            if (animate) {
                setTimeout(() => {
                    this.fitToView();
                }, CONFIG.ANIMATION.LAYOUT + 50);
            } else {
                this.fitToView();
            }
        } catch (e) {
            console.error("Error running layout:", e);
            // Use breadthfirst as fallback with no animation
            this.cy
                .layout({
                    name: "breadthfirst",
                    directed: true,
                    spacingFactor: 1.75,
                    animate: false,
                })
                .run();

            this.fitToView();
        }
    }

    /**
     * Handle container resize events
     * This ensures the graph layout updates when the container size changes
     */
    handleContainerResize(): void {
        if (!this.cy) return;

        // Use requestAnimationFrame to avoid performance issues on rapid resize
        window.requestAnimationFrame(() => {
            if (!this.cy) return;

            // First make sure the style dimensions are updated
            this.cy.resize();

            // Then apply the layout if needed
            if (this.cy.nodes().length > 1) {
                this.applyPartialLayout(false);
            }
        });
    }

    /**
     * Focus the view on a node and its immediate context
     * @param {string} nodeId - The ID of the node to focus on
     * @public
     */
    _focusOnNodeContext(nodeId: string): void {
        if (!this.cy) return;

        const node = this.cy.getElementById(nodeId);
        if (node.length === 0) return;

        // Get the incoming and outgoing edges for context
        const incomingEdges = node.incomers("edge");
        const outgoingEdges = node.outgoers("edge");

        // Get the source nodes of incoming edges
        const sourceNodes = incomingEdges.sources();

        // Get the target nodes of outgoing edges
        const targetNodes = outgoingEdges.targets();

        // Create a collection containing the active node and its connected context
        const focusElements = this.cy
            .collection()
            .merge(node)
            .merge(incomingEdges)
            .merge(outgoingEdges)
            .merge(sourceNodes)
            .merge(targetNodes);

        // Center the viewport on the node with animation
        this.cy.animate({
            fit: {
                eles: focusElements,
                padding: 75,
            },
            duration: CONFIG.ANIMATION.LAYOUT,
            easing: "ease-in-out-cubic",
        });
    }

    /**
     * Highlight path from start to current node
     * @param {string} nodeId - The ID of the target node
     */
    highlightPath(nodeId: string): void {
        if (!this.cy) return;

        try {
            // Find the path from start to the current node
            const paths = this.cy.elements().dijkstra({
                root: this.cy.getElementById("start"),
                directed: true,
            });

            // Get the path to the current node
            const pathToCurrentNode = paths.pathTo(
                this.cy.getElementById(nodeId),
            );

            // Highlight the path
            pathToCurrentNode.forEach((ele: any) => {
                if (ele.isEdge()) {
                    ele.animate({
                        style: {
                            width: 5,
                            "line-color": CONFIG.COLORS.HIGHLIGHT,
                            "target-arrow-color": CONFIG.COLORS.HIGHLIGHT,
                            opacity: 1,
                        },
                        duration: CONFIG.ANIMATION.HIGHLIGHT,
                    });
                }
            });

            // Dim other edges
            this.cy
                .edges()
                .difference(pathToCurrentNode.filter("edge"))
                .animate({
                    style: {
                        opacity: 0.3,
                    },
                    duration: CONFIG.ANIMATION.HIGHLIGHT,
                });

            this.pathHighlighted = true;
        } catch (e) {
            console.error("Error highlighting path:", e);
        }
    }

    /**
     * Reset edge styles
     */
    resetEdgeStyles(): void {
        if (!this.cy) return;

        this.cy.edges().animate({
            style: {
                width: 3,
                opacity: 0.8,
                "line-color": "#999",
                "target-arrow-color": "#999",
            },
            duration: CONFIG.ANIMATION.HIGHLIGHT,
        });

        // Restore edge colors based on their type
        this.cy
            .edges(`[edgeType="${CONFIG.EDGE_TYPES.DECISION_YES}"]`)
            .animate({
                style: {
                    "line-color": CONFIG.COLORS.START,
                    "target-arrow-color": CONFIG.COLORS.START,
                },
                duration: CONFIG.ANIMATION.HIGHLIGHT,
            });

        this.cy.edges(`[edgeType="${CONFIG.EDGE_TYPES.DECISION_NO}"]`).animate({
            style: {
                "line-color": CONFIG.COLORS.END,
                "target-arrow-color": CONFIG.COLORS.END,
            },
            duration: CONFIG.ANIMATION.HIGHLIGHT,
        });

        this.pathHighlighted = false;
    }

    /**
     * Fit the graph to view
     */
    fitToView(): void {
        if (!this.cy) return;

        // First check if we need to fit - only do it if nodes are outside the viewport
        this.cy.extent();
        const nodes = this.cy.nodes();

        if (nodes.length === 0) return;

        // Get the current viewport
        const viewport = {
            x1: this.cy.extent().x1,
            y1: this.cy.extent().y1,
            x2: this.cy.extent().x2,
            y2: this.cy.extent().y2,
            w: this.cy.width(),
            h: this.cy.height(),
        };

        // Check if all nodes are within the viewport with padding
        const padding = 50;
        let needsFit = false;

        // Loop through nodes to see if any are outside the visible area
        nodes.forEach((node) => {
            const pos = node.position();
            if (
                pos.x < viewport.x1 + padding ||
                pos.x > viewport.x2 - padding ||
                pos.y < viewport.y1 + padding ||
                pos.y > viewport.y2 - padding
            ) {
                needsFit = true;
            }
        });

        // If we need to fit or the graph is very small, adjust the view
        if (needsFit || nodes.length <= 3) {
            this.cy.fit(undefined, 50);
            this.cy.center();
        }

        // Animate the reset with a slight zoom effect for better UX
        this.cy.animate({
            zoom: {
                level: this.cy.zoom() * 0.95,
                position: this.cy.center(),
            } as any,
            duration: 200,
            complete: () => {
                this.cy?.animate({
                    zoom: {
                        level: this.cy.zoom() * 1.05,
                        position: this.cy.center(),
                    },
                    duration: 300,
                } as any);
            },
        });
    }

    /**
     * Animate highlight for a newly added node
     * @param {string} nodeId - The ID of the node to highlight
     */
    animateNewNode(nodeId: string): void {
        if (!this.cy) return;

        setTimeout(() => {
            const newNode = this?.cy?.getElementById(nodeId);

            if (newNode && newNode.length > 0) {
                newNode.animate({
                    style: {
                        "background-color": CONFIG.COLORS.HIGHLIGHT,
                        "border-color": CONFIG.COLORS.HIGHLIGHT,
                        "border-width": 8,
                    },
                    duration: 300,
                    complete: function () {
                        const nodeType = newNode.data("type");
                        const color = Visualizer.getNodeColor(nodeType);

                        newNode.animate({
                            style: {
                                "background-color": color,
                                "border-color": CONFIG.COLORS.HIGHLIGHT,
                                "border-width": 5,
                            },
                            duration: 500,
                        });
                    },
                });
            }
        }, 500);
    }

    /**
     * Get color for a node type
     * @param {string} nodeType - Type of the node
     * @returns {string} Color for the node type
     * @static
     */
    static getNodeColor(nodeType: string): string {
        switch (nodeType) {
            case CONFIG.NODE_TYPES.START:
                return CONFIG.COLORS.START;
            case CONFIG.NODE_TYPES.ACTION:
                return CONFIG.COLORS.ACTION;
            case CONFIG.NODE_TYPES.DECISION:
                return CONFIG.COLORS.DECISION;
            case CONFIG.NODE_TYPES.TEMPORARY:
                return CONFIG.COLORS.TEMPORARY;
            case CONFIG.NODE_TYPES.END:
                return CONFIG.COLORS.END;
            default:
                return CONFIG.COLORS.DEFAULT;
        }
    }

    updateNodeScreenshot(nodeId: string, screenshot: string): void {
        if (!this.cy) return;

        const node = this.cy.getElementById(nodeId);
        if (node.length > 0) {
            node.data("screenshot", screenshot);
            node.data("hasScreenshot", true);

            // Apply screenshot-specific styling
            this.refreshNodeStyle(nodeId);

            // Force a redraw
            this.cy.style().update();
        }
    }
    // Helper method to check if a node has a screenshot
    hasScreenshot(nodeId: string): boolean {
        if (!this.cy) return false;

        const node = this.cy.getElementById(nodeId);
        return node.length > 0 && node.data("hasScreenshot") === true;
    }

    /**
     * Ensure the proper stylesheet is applied when a node gets a screenshot
     * This addresses label positioning for screenshot nodes
     */
    refreshNodeStyle(nodeId: string): void {
        if (!this.cy) return;

        const node = this.cy.getElementById(nodeId);
        if (node.length > 0) {
            // Force a style recalculation
            this.cy.style().update();

            // Apply screenshot-specific styling if needed
            if (node.data("hasScreenshot")) {
                // For better performance, only animate this specific node
                // rather than all nodes
                node.style("z-index", 10); // Ensure label is above other elements
            }
        }
    }

    /**
     * Set up event listeners for Cytoscape
     * @param {NodeSelectCallback} onNodeSelect - Callback for node selection
     * @param {HTMLElement} tooltip - Tooltip element
     */
    setupEventListeners(
        onNodeSelect: NodeSelectCallback,
        tooltip: HTMLElement,
    ): void {
        if (!this.cy) return;

        // Node click handler
        this.cy.on("tap", "node", (evt: any) => {
            const nodeId = evt.target.id();
            this.updateCurrentNode(nodeId);
            if (onNodeSelect) {
                onNodeSelect(nodeId);
            }
        });

        // Node double-click handler for screenshot upload
        this.cy.on("dblclick", "node", (evt: any) => {
            const nodeId = evt.target.id();
            const node = this.webPlanData.nodes.find((n) => n.id === nodeId);

            if (node) {
                // Call the global function, which is now properly defined
                if (typeof window.showScreenshotUploadModal === "function") {
                    window.showScreenshotUploadModal(
                        nodeId,
                        node.label || nodeId,
                    );
                } else {
                    console.error(
                        "showScreenshotUploadModal function not found in global scope",
                    );
                }
            }
        });

        // Show tooltip on hover
        this.cy.on("mouseover", "node, edge", (evt: any) => {
            const element = evt.target;
            const position = evt.renderedPosition || element.renderedPosition();

            // Content for tooltip
            let content = "";
            if (element.isNode()) {
                content = `${element.data("label")} (${element.data("type")})`;
            } else if (element.isEdge()) {
                const source = this.cy
                    ?.getElementById(element.data("source"))
                    .data("label");
                const target = this.cy
                    ?.getElementById(element.data("target"))
                    .data("label");
                const label = element.data("label")
                    ? ` - ${element.data("label")}`
                    : "";
                content = `${source} → ${target}${label}`;
            }

            // Show tooltip
            tooltip.textContent = content;
            tooltip.style.left = `${position.x + 10}px`;
            tooltip.style.top = `${position.y + 10}px`;
            tooltip.style.opacity = "1";
        });

        // Hide tooltip
        this.cy.on("mouseout", "node, edge", () => {
            tooltip.style.opacity = "0";
        });

        // Hide tooltip on pan/zoom, update labels
        this.cy.on("pan zoom", () => {
            tooltip.style.opacity = "0";
        });

        // Node hover effects
        this.cy.on("mouseover", "node", (evt: any) => {
            const node = evt.target;
            if (!node.data("isActive")) {
                node.animate({
                    style: { width: 140, height: 70 },
                    duration: CONFIG.ANIMATION.HOVER,
                });
            }
        });

        this.cy.on("mouseout", "node", (evt: any) => {
            const node = evt.target;
            if (!node.data("isActive")) {
                node.animate({
                    style: { width: 120, height: 60 },
                    duration: CONFIG.ANIMATION.HOVER,
                });
            }
        });

        // Edge hover effects
        this.cy.on("mouseover", "node", (evt: any) => {
            const node = evt.target;
            const connectedEdges = node.connectedEdges();

            connectedEdges.animate({
                style: { width: 5, opacity: 1 },
                duration: CONFIG.ANIMATION.HOVER,
            });
        });

        this.cy.on("mouseout", "node", (evt: any) => {
            const node = evt.target;
            const connectedEdges = node.connectedEdges();

            connectedEdges.animate({
                style: { width: 3, opacity: 0.8 },
                duration: CONFIG.ANIMATION.HOVER,
            });
        });

        // Add container resize observer for responsive behavior
        if (this.container && window.ResizeObserver) {
            const resizeObserver = new ResizeObserver((entries) => {
                this.handleContainerResize();
            });

            resizeObserver.observe(this.container);

            // Store observer reference so it can be disconnected later
            this._resizeObserver = resizeObserver;
        } else {
            // Fallback for browsers without ResizeObserver
            window.addEventListener("resize", () => {
                this.handleContainerResize();
            });
        }
    }

    /**
     * Start continuous pulse animation for temporary nodes
     */
    startTemporaryNodeAnimation(): void {
        if (!this.cy) return;

        // Clear any existing animation interval
        this.stopTemporaryNodeAnimation();

        // Set up animation interval
        this.tempAnimInterval = window.setInterval(() => {
            const tempNodes = this.cy
                ?.nodes()
                .filter((node: any) => node.data("isTemporary"));

            if (!tempNodes || tempNodes.length === 0) {
                // No temporary nodes, stop the animation
                this.stopTemporaryNodeAnimation();
                return;
            }

            // Apply the pulse animation
            tempNodes.animate({
                style: {
                    "background-color": CONFIG.COLORS.HIGHLIGHT,
                    "border-color": CONFIG.COLORS.HIGHLIGHT,
                    opacity: 1,
                },
                duration: 750,
                complete: function () {
                    // Animate back to original state
                    tempNodes.animate({
                        style: {
                            "background-color": CONFIG.COLORS.TEMPORARY,
                            "border-color": "#000",
                            opacity: 0.7,
                        },
                        duration: 750,
                    });
                },
            });
        }, 1500); // Full cycle takes 1.5 seconds
    }

    /**
     * Stop temporary node animation
     */
    stopTemporaryNodeAnimation(): void {
        if (this.tempAnimInterval) {
            window.clearInterval(this.tempAnimInterval);
            this.tempAnimInterval = null;
        }
    }

    /**
     * Destroy the Cytoscape instance
     */
    destroy(): void {
        this.stopTemporaryNodeAnimation();

        // Clean up resize observer if it exists
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }

        if (this.cy) {
            this.cy.destroy();
            this.cy = null;
        }
    }
}

export default Visualizer;
