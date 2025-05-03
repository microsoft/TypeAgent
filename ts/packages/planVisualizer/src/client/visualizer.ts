// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Class for handling the visualization of the web plan
 */
import cytoscape from "cytoscape";
import dagre from "dagre";
import cytoscapeDagre from "cytoscape-dagre";

// Register the extension
cytoscape.use(cytoscapeDagre as any);

import CONFIG from "./config";
import CytoscapeConfig from "./cytoscapeConfig.js";
import {
    WebPlanData,
    PlanNode,
    PlanLink,
    NodeSelectCallback,
} from "../shared/types.js";

class Visualizer {
    private container: HTMLElement;
    private webPlanData: WebPlanData;
    private cy: cytoscape.Core | null;
    public pathHighlighted: boolean;
    private tempAnimInterval: number | null;
    private screenshotMode: boolean = false;

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
                // nodeData.screenshot = node.screenshot.split(',')[1]; // remove data prefix
                nodeData.screenshot = node.screenshot;
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

        // Find the temporary node in the old data
        const oldTempNode = oldData.nodes.find((node) => node.isTemporary);

        // Find the temporary node in the new data
        const newTempNode = newData.nodes.find((node) => node.isTemporary);

        // Find the node that was replaced (temporary node)
        const replacedNodeId = this._findReplacedNodeId(oldData, newData);

        // Case 1: A temporary node was replaced and a new temporary node was added
        if (
            oldTempNode &&
            (!newTempNode || newTempNode.id !== oldTempNode.id)
        ) {
            // Get the replacement node data
            const replacementNode = newData.nodes.find(
                (node) => node.id === oldTempNode.id && !node.isTemporary,
            );

            if (replacementNode) {
                // In-place update of the temporary node
                const tempNode = this.cy.getElementById(oldTempNode.id);
                console.log("Replacing node: " + oldTempNode.id);

                if (tempNode.length > 0) {
                    // Stop any existing animations to prevent errors
                    try {
                        (tempNode as any).animation().stop();
                    } catch (animError) {
                        console.warn("Error stopping animation:", animError);
                    }

                    // Update the node's data
                    tempNode.data({
                        label: replacementNode.label || "",
                        type: replacementNode.type,
                        isTemporary: false,
                        isActive: true,
                        screenshot: replacementNode.screenshot,
                    });

                    // Animate the node in place
                    tempNode.animate({
                        style: {
                            "background-color": CONFIG.COLORS.HIGHLIGHT,
                            "border-color": CONFIG.COLORS.HIGHLIGHT,
                            "border-width": 5,
                            opacity: 1,
                        },
                        duration: 300,
                        complete: () => {
                            // Get the proper color for the node type
                            const nodeColor = Visualizer.getNodeColor(
                                replacementNode.type,
                            );

                            tempNode.animate({
                                style: {
                                    "background-color": nodeColor,
                                    "border-color": CONFIG.COLORS.HIGHLIGHT,
                                    "border-width": 3,
                                    opacity: 1,
                                },
                                duration: 300,
                            });
                        },
                    });

                    // Set this as the node to focus on
                    nodeToFocus = replacedNodeId;

                    this.startTemporaryNodeAnimation();

                    // Update data reference
                    this.webPlanData = newData;
                }
            }

            // Now add the new temporary node if present
            if (newTempNode) {
                // Find the source node and link for this temporary node
                const tempNodeLink = newData.links.find(
                    (link) => link.target === newTempNode.id,
                );

                if (tempNodeLink) {
                    const sourceNodeId = tempNodeLink.source;

                    // Make sure the source node exists in the graph
                    const sourceCyNode = this.cy.getElementById(sourceNodeId);

                    if (sourceCyNode.length > 0) {
                        // Generate a unique ID for this node to avoid collisions
                        const newUniqueId = `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

                        // Add the temporary node
                        const addedNode = this.cy.add({
                            group: "nodes",
                            data: {
                                id: newUniqueId,
                                originalId: newTempNode.id,
                                label: newTempNode.label || "",
                                type: newTempNode.type || "temporary",
                                isTemporary: true,
                                isActive: false,
                                screenshot: newTempNode.screenshot,
                            },
                        });

                        // Add the edge to the temporary node
                        this.cy.add({
                            group: "edges",
                            data: {
                                id: `edge-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                                source: sourceNodeId,
                                target: newUniqueId,
                                label: tempNodeLink.label || "",
                                edgeType: this._getEdgeType(tempNodeLink),
                            },
                        });

                        // Position the temporary node
                        const position =
                            this._findOptimalNodePosition(addedNode);
                        addedNode.position(position);

                        // Start the temporary node animation
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

                        // Set the replacement node as the node to focus on
                        nodeToFocus = replacementNode
                            ? replacementNode.id
                            : null;
                    }
                }
            }
        }
        // Case 2: Only a new temporary node was added (no replacement)
        else if (
            newTempNode &&
            (!oldTempNode || newTempNode.id !== oldTempNode.id)
        ) {
            // Find the link to the new temporary node
            const tempNodeLink = newData.links.find(
                (link) => link.target === newTempNode.id,
            );

            if (tempNodeLink) {
                const sourceNodeId = tempNodeLink.source;

                // Check if the source node exists in the graph
                const sourceCyNode = this.cy.getElementById(sourceNodeId);

                if (sourceCyNode.length > 0) {
                    // Generate a unique ID for this node
                    const newUniqueId = `temp-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

                    // Add the temporary node
                    const addedNode = this.cy.add({
                        group: "nodes",
                        data: {
                            id: newUniqueId,
                            originalId: newTempNode.id,
                            label: newTempNode.label || "",
                            type: newTempNode.type || "temporary",
                            isTemporary: true,
                            isActive: false,
                            screenshot: newTempNode.screenshot,
                        },
                    });

                    // Add the edge
                    this.cy.add({
                        group: "edges",
                        data: {
                            id: `edge-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                            source: sourceNodeId,
                            target: newUniqueId,
                            label: tempNodeLink.label || "",
                            edgeType: this._getEdgeType(tempNodeLink),
                        },
                    });

                    // Position the node
                    const position = this._findOptimalNodePosition(addedNode);
                    addedNode.position(position);

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

                    // Focus on the source node
                    nodeToFocus = sourceNodeId;
                }
            }
        }
        // Case 3: A new non-temporary node was added
        else if (newData.nodes.length > oldData.nodes.length) {
            // Find nodes that are in the new data but not in the old data
            const newNodes = newData.nodes.filter(
                (newNode) =>
                    !oldData.nodes.some((oldNode) => oldNode.id === newNode.id),
            );

            // Process each new node
            for (const newNode of newNodes) {
                // Skip temporary nodes as they're handled separately
                if (newNode.isTemporary) continue;

                // Find links to this node
                const nodeLinks = newData.links.filter(
                    (link) =>
                        link.target === newNode.id ||
                        link.source === newNode.id,
                );

                // Only proceed if we have links
                if (nodeLinks.length > 0) {
                    // Generate a unique ID
                    const newUniqueId = `node-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

                    // Add the node
                    const addedNode = this.cy.add({
                        group: "nodes",
                        data: {
                            id: newUniqueId,
                            originalId: newNode.id,
                            label: newNode.label || "",
                            type: newNode.type,
                            isTemporary: false,
                            isActive: newData.currentNode === newNode.id,
                            screenshot: newNode.screenshot,
                        },
                    });

                    // Add all connecting edges
                    for (const link of nodeLinks) {
                        const isSource = link.source === newNode.id;
                        const connectedNodeId = isSource
                            ? link.target
                            : link.source;

                        // Check if the connected node exists
                        const connectedNode =
                            this.cy.getElementById(connectedNodeId);

                        if (connectedNode.length > 0) {
                            this.cy.add({
                                group: "edges",
                                data: {
                                    id: `edge-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                                    source: isSource
                                        ? newUniqueId
                                        : connectedNodeId,
                                    target: isSource
                                        ? connectedNodeId
                                        : newUniqueId,
                                    label: link.label || "",
                                    edgeType: this._getEdgeType(link),
                                },
                            });
                        }
                    }

                    // Position the node
                    const position = this._findOptimalNodePosition(addedNode);
                    addedNode.position(position);

                    // Set as node to focus
                    nodeToFocus = newUniqueId;
                }
            }
        }
        // Case 4: A temporary node was simply replaced with an end node (no new temp node)
        else if (
            oldTempNode &&
            !newTempNode &&
            oldData.nodes.length === newData.nodes.length
        ) {
            // Find the node that replaced the old temporary node
            const replacementNode = newData.nodes.find(
                (node) => node.id === oldTempNode.id && !node.isTemporary,
            );

            if (replacementNode && replacementNode.type === "end") {
                console.log("Found end node");
                // Update the temporary node in place
                const tempCyNode = this.cy.getElementById(oldTempNode.id);
                if (tempCyNode.length > 0) {
                    // Stop any existing animations
                    try {
                        (tempCyNode as any).animation().stop();
                    } catch (animError) {
                        console.warn("Error stopping animation:", animError);
                    }

                    // Update the node data
                    tempCyNode.data({
                        label: replacementNode.label || "",
                        type: replacementNode.type,
                        isTemporary: false,
                        isActive: true,
                        screenshot: replacementNode.screenshot,
                    });

                    // Update the node style - use end node style
                    try {
                        const nodeColor = Visualizer.getNodeColor("end");
                        tempCyNode.animate({
                            style: {
                                "background-color": nodeColor,
                                "border-color": CONFIG.COLORS.HIGHLIGHT,
                                "border-width": 3,
                                opacity: 1,
                                "border-style": "solid",
                            },
                            duration: 300,
                        });
                    } catch (styleError) {
                        console.warn(
                            "Error updating end node style:",
                            styleError,
                        );
                    }

                    // Set this as node to focus
                    nodeToFocus = tempCyNode.id();
                }
            }
        }

        // Update the web plan data reference
        this.webPlanData = newData;

        // Focus on the identified node
        if (nodeToFocus) {
            this._focusOnNodeContext(nodeToFocus);
            return true;
        }

        // Fall back to full redraw if everything else failed
        return false;
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
     * Apply a partial layout to position new nodes without disrupting the entire graph
     */
    applyPartialLayout(): void {
        if (!this.cy) return;

        // Simple positioning update that keeps existing node positions stable
        // and only adjusts the new or changed nodes
        const layout = this.cy.layout({
            name: "preset",
            fit: false, // Don't change zoom level
            animate: true,
            animationDuration: 300,
            positions: (node: any) => {
                // If node already has a position, keep it there
                if (
                    node.position("x") !== undefined &&
                    node.position("y") !== undefined
                ) {
                    return node.position();
                }

                // For new nodes, position them based on their connections
                const connectedEdges = node.connectedEdges();
                if (connectedEdges.length > 0) {
                    // Find all connected nodes that have positions
                    const connectedNodes = connectedEdges
                        .connectedNodes()
                        .filter(
                            (n: any) =>
                                n.id() !== node.id() &&
                                n.position("x") !== undefined &&
                                n.position("y") !== undefined,
                        );

                    if (connectedNodes.length > 0) {
                        // Find incoming edges (where this node is the target)
                        const incomers = node.incomers("edge");
                        if (incomers.length > 0) {
                            // Position below the source node
                            const sourceNode = incomers
                                .connectedNodes()
                                .filter((n: any) => n.id() !== node.id());
                            if (sourceNode.length > 0) {
                                return {
                                    x: sourceNode[0].position("x"),
                                    y: sourceNode[0].position("y") + 150,
                                };
                            }
                        }

                        // If no incoming edges, use average position of connected nodes
                        let avgX = 0,
                            avgY = 0;
                        connectedNodes.forEach((n: any) => {
                            avgX += n.position("x");
                            avgY += n.position("y");
                        });
                        return {
                            x: avgX / connectedNodes.length,
                            y: avgY / connectedNodes.length + 150,
                        };
                    }
                }

                // Default position if no connections or no positioned connections
                return {
                    x: this?.cy?.width() ?? 0 / 2,
                    y: this?.cy?.height() ?? 0 / 2,
                };
            },
        });

        layout.run();
    }

    /**
     * Helper method to find the node that was replaced
     * @param {WebPlanData} oldData - Previous graph data
     * @param {WebPlanData} newData - New graph data after replacement
     * @returns {string|null} The ID of the replaced node, or null if none found
     * @private
     */
    private _findReplacedNodeId(
        oldData: WebPlanData,
        newData: WebPlanData,
    ): string | null {
        // Find the temporary node in old data that's no longer temporary in new data
        const tempNode = oldData.nodes.find(
            (oldNode) =>
                oldNode.isTemporary &&
                newData.nodes.some(
                    (newNode) =>
                        newNode.id === oldNode.id && !newNode.isTemporary,
                ),
        );

        return tempNode ? tempNode.id : null;
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

        this.cy.fit();
        this.cy.center();

        // Animate the reset with a slight zoom effect
        this.cy.animate({
            zoom: {
                level: this.cy.zoom() * 0.9,
                position: this.cy.center(),
            } as any,
            duration: 200,
            complete: () => {
                this?.cy?.animate({
                    zoom: {
                        level: this.cy.zoom() * 1.1,
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

    setScreenshotMode(enabled: boolean): void {
        this.screenshotMode = enabled;

        if (!this.cy) return;

        if (enabled) {
            // Add screenshot-mode class to all nodes
            this.cy.nodes().addClass("screenshot-mode");
        } else {
            // Remove screenshot-mode class from all nodes
            this.cy.nodes().removeClass("screenshot-mode");
        }
    }

    updateNodeScreenshot(nodeId: string, screenshot: string): void {
        if (!this.cy) return;

        const node = this.cy.getElementById(nodeId);
        if (node.length > 0) {
            node.data("screenshot", screenshot);
            node.data("hasScreenshot", true);

            // Force a redraw
            // this.cy.elements().style('visibility', 'visible');
            this.cy.style().update();
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

        // Hide tooltip on pan/zoom
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
        if (this.cy) {
            this.cy.destroy();
            this.cy = null;
        }
    }
}

export default Visualizer;
