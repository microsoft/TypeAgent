// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface PlanNode {
    id: string;
    label: string;
    type: string;
    isTemporary?: boolean;
    screenshot?: string;
}

export interface PlanLink {
    source: string;
    target: string;
    label?: string;
}

export interface WebPlanData {
    nodes: PlanNode[];
    links: PlanLink[];
    currentNode: string | null;
    title: string;
}

export interface TransitionRequest {
    currentState: string;
    action: string;
    nodeType: string;
    screenshot?: string;
}

export interface TitleRequest {
    title: string;
}

export interface ScreenshotRequest {
    nodeId: string;
    screenshot: string; // Base64-encoded screenshot
}

export interface PlansSSEEvent {
    type: string;
    data?: WebPlanData;
    timestamp?: string;
}
