// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Type definitions for the Web Plan Visualizer
 */

declare global {
    interface Window {
        webPlanData?: any;
        showScreenshotUploadModal?: (nodeId: string, nodeLabel: string) => void;
        uploadScreenshot?: () => void;
    }
}

// Node in the web plan
export interface PlanNode {
    id: string;
    label: string;
    type: string;
    isTemporary?: boolean;
    screenshot?: string;
}

// Link between nodes in the web plan
export interface PlanLink {
    source: string;
    target: string;
    label?: string;
}

// Complete web plan data structure
export interface WebPlanData {
    nodes: PlanNode[];
    links: PlanLink[];
    currentNode: string | null;
    title: string;
}

// Form data for transition API
export interface TransitionFormData {
    currentState: string;
    action: string;
    nodeType: string;
    screenshot?: string | null;
}

// API transition response
export interface TransitionResponse {
    oldData: WebPlanData;
    newData: WebPlanData;
}

// SSE event data structure
export interface SSEEvent {
    type: string;
    data?: WebPlanData;
    timestamp?: string;
}

// Cytoscape node data
export interface CytoscapeNodeData {
    id: string;
    label: string;
    type: string;
    isActive?: boolean;
    isTemporary?: boolean;
    originalId?: string;
}

// Cytoscape edge data
export interface CytoscapeEdgeData {
    id: string;
    source: string;
    target: string;
    label?: string;
    edgeType: string;
}

// Cytoscape element data (either node or edge)
export type CytoscapeElementData = CytoscapeNodeData | CytoscapeEdgeData;

// NodeSelector callback type
export type NodeSelectCallback = (nodeId: string) => void;

// Callback for animation completion
export type AnimationCallback = () => void;

// Position interface for node placement
export interface Position {
    x: number;
    y: number;
}

// Animation options
export interface AnimationOptions {
    duration?: number;
    easing?: string;
    complete?: AnimationCallback;
}

// Layout options base interface
export interface LayoutOptions {
    name: string;
    animate?: boolean;
    fit?: boolean;
    padding?: number;
    [key: string]: any;
}

// Title update request
export interface TitleUpdateRequest {
    title: string;
}

// State and execution handlers
export type StateChangeHandler = (state: WebPlanData) => void;
export type ErrorHandler = (error: Error) => void;

// DOM event handlers
export interface GenericEvent {
    preventDefault: () => void;
    stopPropagation: () => void;
    target: any;
    [key: string]: any;
}

export type NodeClickHandler = (nodeId: string, event: GenericEvent) => void;
export type EdgeClickHandler = (edgeId: string, event: GenericEvent) => void;

// Events that can be emitted by the system
export type EventType =
    | "transition"
    | "reset"
    | "title"
    | "connected"
    | "focus"
    | "error";

// Event listener type
export type EventListener = (data: any) => void;

// Event emitter interface
export interface EventEmitter {
    on(event: EventType, listener: EventListener): void;
    off(event: EventType, listener: EventListener): void;
    emit(event: EventType, data: any): void;
}
