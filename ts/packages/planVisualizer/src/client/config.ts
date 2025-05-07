// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Global configuration and constants for the Web Plan Visualizer
 */

// Define types for configuration
export interface ApiConfig {
    GET_PLAN: string;
    ADD_TRANSITION: string;
    RESET_PLAN: string;
    SET_TITLE: string;
    UPLOAD_SCREENSHOT: string;
}

export interface NodeTypes {
    START: string;
    ACTION: string;
    DECISION: string;
    TEMPORARY: string;
    END: string;
}

export interface ViewModes {
    STATIC: string;
    DYNAMIC: string;
    SCREENSHOT: string;
}

export interface Colors {
    START: string;
    ACTION: string;
    DECISION: string;
    END: string;
    DEFAULT: string;
    HIGHLIGHT: string;
    TEMPORARY: string;
}

export interface EdgeTypes {
    STANDARD: string;
    DECISION_YES: string;
    DECISION_NO: string;
}

export interface AnimationDurations {
    LAYOUT: number;
    HOVER: number;
    HIGHLIGHT: number;
    ZOOM: number;
}

export interface Config {
    API: ApiConfig;
    NODE_TYPES: NodeTypes;
    VIEW_MODES: ViewModes;
    COLORS: Colors;
    EDGE_TYPES: EdgeTypes;
    ANIMATION: AnimationDurations;
}

const CONFIG: Config = {
    // API endpoints
    API: {
        GET_PLAN: "/api/plan",
        ADD_TRANSITION: "/api/transition",
        RESET_PLAN: "/api/reset",
        SET_TITLE: "/api/title",
        UPLOAD_SCREENSHOT: "/api/screenshot",
    },

    // Node types
    NODE_TYPES: {
        START: "start",
        ACTION: "action",
        DECISION: "decision",
        TEMPORARY: "temporary",
        END: "end",
    },

    // View modes
    VIEW_MODES: {
        STATIC: "static",
        DYNAMIC: "dynamic",
        SCREENSHOT: "screenshot",
    },

    // Node colors - Updated to lighter pastel colors for a more pleasant visualization
    COLORS: {
        START: "#8adfb2", // Light pastel green
        ACTION: "#80c5ff", // Light pastel blue
        DECISION: "#d7b0ff", // Light pastel purple
        END: "#ff9e9e", // Light pastel red/pink
        DEFAULT: "#aaaaaa", // Light gray
        HIGHLIGHT: "#ffc56e", // Light pastel orange
        TEMPORARY: "#ffed8a", // Light pastel yellow
    },

    // Edge types
    EDGE_TYPES: {
        STANDARD: "standard",
        DECISION_YES: "decision-yes",
        DECISION_NO: "decision-no",
    },

    // Animation durations
    ANIMATION: {
        LAYOUT: 500,
        HOVER: 200,
        HIGHLIGHT: 300,
        ZOOM: 300,
    },
};

export default CONFIG;
