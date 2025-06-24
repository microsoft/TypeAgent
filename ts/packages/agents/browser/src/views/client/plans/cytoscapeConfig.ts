// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Cytoscape configuration and style definitions
 */
import CONFIG from "./config.js";

// Define cytoscape style types
export interface CytoscapeStylesheet {
    selector: string;
    style: Record<string, any>;
}

export interface DagreLayoutOptions {
    name: string;
    rankDir: string;
    rankSep: number;
    nodeSep: number;
    edgeSep: number;
    ranker: string;
    padding: number;
    animate: boolean;
    animationDuration: number;
    fit: boolean;
}

export interface FallbackLayoutOptions {
    name: string;
    directed: boolean;
    spacingFactor: number;
    animate: boolean;
}

// Add the animation keyframes
const addTemporaryNodeAnimation = (): void => {
    const tempNodeAnimation = `
  @keyframes pulse {
    0% {
      background-color: ${CONFIG.COLORS.TEMPORARY};
      opacity: 0.7;
    }
    50% {
      background-color: ${CONFIG.COLORS.HIGHLIGHT};
      opacity: 1;
    }
    100% {
      background-color: ${CONFIG.COLORS.TEMPORARY};
      opacity: 0.7;
    }
  }
  `;

    // Add the style tag to the document head
    const styleTag = document.createElement("style");
    styleTag.innerHTML = tempNodeAnimation;
    document.head.appendChild(styleTag);
};

// Execute the style addition when this module is imported
if (typeof document !== "undefined") {
    addTemporaryNodeAnimation();
}

/**
 * Cytoscape configuration and style definitions
 */
const CytoscapeConfig = {
    /**
     * Get Cytoscape style definitions
     * @returns {Array<CytoscapeStylesheet>} Array of style definitions
     */
    getStyles(): Array<CytoscapeStylesheet> {
        return [
            // Node styles
            {
                selector: "node",
                style: {
                    label: "data(label)",
                    "text-valign": "center",
                    "text-halign": "center",
                    "text-margin-y": 10,
                    color: "#000",
                    "font-size": "14px",
                    "font-weight": "bold",
                    width: 120,
                    height: 60,
                    "text-wrap": "wrap",
                    "text-max-width": 120,
                    "border-width": 3,
                    "border-color": "#fff",
                    "background-color": "#666",
                    shape: "rectangle",
                    "shadow-blur": 10,
                    "shadow-color": "rgba(0,0,0,0.2)",
                    "shadow-offset-x": 0,
                    "shadow-offset-y": 2,
                    "shadow-opacity": 0.8,
                },
            },
            // Nodes with screenshots - add background image
            {
                selector: "node[?hasScreenshot]",
                style: {
                    "background-image": function (ele: {
                        data: (arg0: string) => any;
                    }) {
                        let base64Str = ele.data("screenshot");
                        if (base64Str) {
                            const hasPrefix =
                                /^data:image\/[a-zA-Z]+;base64,/.test(
                                    base64Str,
                                );
                            return hasPrefix
                                ? base64Str
                                : `data:image/png;base64,${base64Str}`;
                        }
                        return "none";
                    },
                    "background-fit": "contain",
                    // Position the label outside the node at the top-left
                    "text-valign": "top",
                    "text-halign": "center",
                    // Add background to make text more readable
                    "text-background-color": "rgba(255,255,255,0.8)",
                    "text-background-opacity": 0.5,
                    "text-background-padding": 3,
                    "text-background-shape": "roundrectangle",
                    // Adjust the margin to move text above the node
                    "text-margin-y": -6,
                    "text-margin-x": 0, // Set to 0 to align with the left edge
                    // Make font smaller
                    "font-weight": "lighter",
                    "font-size": "12px",
                    // Ensure text is above the node visually
                    "z-index": 10,
                },
            },

            // Temporary nodes
            {
                selector: "node[?isTemporary]",
                style: {
                    "background-color": CONFIG.COLORS.TEMPORARY,
                    "border-style": "dashed",
                    "border-width": 3,
                    "border-color": "#000",
                    "border-opacity": 0.5,
                    shape: "roundrectangle",
                    "font-style": "italic",
                    "text-opacity": 0.7,
                    animation: "pulse 1.5s infinite ease-in-out",
                },
            },
            // Start node style
            {
                selector: `node[type="${CONFIG.NODE_TYPES.START}"]`,
                style: {
                    "background-color": CONFIG.COLORS.START,
                },
            },
            // Action node style
            {
                selector: `node[type="${CONFIG.NODE_TYPES.ACTION}"]`,
                style: {
                    "background-color": CONFIG.COLORS.ACTION,
                },
            },
            // Decision node style
            {
                selector: `node[type="${CONFIG.NODE_TYPES.DECISION}"]`,
                style: {
                    "background-color": CONFIG.COLORS.DECISION,
                },
            },
            // End node style
            {
                selector: `node[type="${CONFIG.NODE_TYPES.END}"]`,
                style: {
                    "background-color": CONFIG.COLORS.END,
                },
            },
            // Active node style
            {
                selector: "node[?isActive]",
                style: {
                    "border-color": CONFIG.COLORS.HIGHLIGHT,
                    "border-width": 5,
                    "shadow-blur": 20,
                    "shadow-color": "rgba(255, 152, 0, 0.6)",
                    "shadow-opacity": 1,
                },
            },
            // Edge styles - base
            {
                selector: "edge",
                style: {
                    width: 3,
                    "line-color": "#999",
                    "target-arrow-color": "#999",
                    "target-arrow-shape": "triangle",
                    "curve-style": "unbundled-bezier",
                    "control-point-distances": [0],
                    "control-point-weights": [0.5],
                    label: "data(label)",
                    "font-size": "12px",
                    "text-background-color": "white",
                    "text-background-opacity": 1,
                    "text-background-padding": 3,
                    "text-background-shape": "roundrectangle",
                    "text-margin-y": -10,
                },
            },
            // Decision "Yes" path
            {
                selector: `edge[edgeType="${CONFIG.EDGE_TYPES.DECISION_YES}"]`,
                style: {
                    "curve-style": "unbundled-bezier",
                    "control-point-distances": [100],
                    "control-point-weights": [0.5],
                    "line-color": CONFIG.COLORS.START,
                    "target-arrow-color": CONFIG.COLORS.START,
                },
            },
            // Decision "No" path
            {
                selector: `edge[edgeType="${CONFIG.EDGE_TYPES.DECISION_NO}"]`,
                style: {
                    "curve-style": "unbundled-bezier",
                    "control-point-distances": [-100],
                    "control-point-weights": [0.5],
                    "line-color": CONFIG.COLORS.END,
                    "target-arrow-color": CONFIG.COLORS.END,
                },
            },
            // Nodes with blank labels
            {
                selector: 'node[label = ""]',
                style: {
                    label: function (ele: any) {
                        return ele.data("isTemporary") ? "..." : "";
                    },
                    "text-opacity": 0.6,
                    "font-style": "italic",
                },
            },
        ];
    },

    /**
     * Get Dagre layout options
     * @returns {DagreLayoutOptions} Layout options
     */
    getDagreLayoutOptions(): DagreLayoutOptions {
        return {
            name: "dagre",
            rankDir: "TB",
            rankSep: 100,
            nodeSep: 50,
            edgeSep: 50,
            ranker: "network-simplex",
            padding: 30,
            animate: true,
            animationDuration: CONFIG.ANIMATION.LAYOUT,
            fit: true,
        };
    },

    /**
     * Get fallback layout options (in case Dagre fails)
     * @returns {FallbackLayoutOptions} Layout options
     */
    getFallbackLayoutOptions(): FallbackLayoutOptions {
        return {
            name: "breadthfirst",
            directed: true,
            spacingFactor: 1.75,
            animate: true,
        };
    },
};

export default CytoscapeConfig;
