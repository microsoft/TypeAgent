// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Request, Response } from "express";

export interface SSEClient extends Response {}

export interface SSEEvent {
    type: string;
    data?: any;
    timestamp?: string;
}

// Feature route configuration
export interface FeatureConfig {
    name: string;
    basePath: string;
    setupRoutes: (app: any) => void;
    setupSSE?: (sseManager: SSEManager) => void;
}

export interface SSEManager {
    addClient(namespace: string, client: SSEClient): void;
    removeClient(namespace: string, client: SSEClient): void;
    broadcast(namespace: string, event: SSEEvent): void;
    getClientCount(namespace: string): number;
    getNamespaces(): string[];
}

export type RouteHandler = (
    req: Request,
    res: Response,
) => void | Promise<void>;

export interface APIResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp: string;
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
}

export interface ServerConfig {
    port: number;
    enableCors?: boolean;
    rateLimitWindow?: number;
    rateLimitMax?: number;
    bodyLimit?: string;
}
