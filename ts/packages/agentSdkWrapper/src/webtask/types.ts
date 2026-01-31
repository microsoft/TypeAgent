// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Generic task definition for web automation
 * Works with any benchmark (WebBench, WebArena, Mind2Web, etc.)
 */
export interface WebTask {
    id: string;
    description: string;
    startingUrl: string;
    category: TaskCategory;
    difficulty: TaskDifficulty;
    metadata?: TaskMetadata;
}

export type TaskCategory =
    | "READ"           // Extract information from page
    | "CREATE"         // Create new entity (account, post, etc.)
    | "UPDATE"         // Modify existing entity
    | "DELETE"         // Remove entity
    | "NAVIGATE"       // Navigation-only tasks
    | "SEARCH"         // Search operations
    | "FORM_FILL"      // Form interaction
    | "FILE_MANIPULATION" // File upload/download
    | "CUSTOM";        // Benchmark-specific category

export type TaskDifficulty = "easy" | "medium" | "hard";

/**
 * Extensible metadata for benchmark-specific information
 */
export interface TaskMetadata {
    benchmark?: string;
    domain?: string;
    requiresAuth?: boolean;
    estimatedSteps?: number;
    tags?: string[];
    [key: string]: any; // Allow any benchmark-specific fields
}

/**
 * Task file structure (JSON format)
 */
export interface TaskFile {
    metadata: FileMetadata;
    tasks: WebTask[];
}

export interface FileMetadata {
    benchmark: string;
    version: string;
    created?: string;
    totalTasks: number;
    description?: string;
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
    taskId: string;
    success: boolean;
    data?: any;
    error?: string;
    duration: number;
    steps?: string[];
}

/**
 * Task execution options
 */
export interface TaskExecutionOptions {
    collectTraces?: boolean | undefined;
    traceDir?: string | undefined;
    captureScreenshots?: boolean | undefined;
    captureHTML?: boolean | undefined;
}
