// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Re-export protocol types from shell package
 * In the future, these types will be extracted to a shared protocol package
 */

// For now, we'll duplicate the essential types here to avoid circular dependencies
// This will be refactored in Phase 2

// Base message structure
export interface BaseMessage {
    type: string;
    timestamp: string;
    sessionId?: string;
}

// Request Messages (Client � Server)
export interface InitSessionMessage extends BaseMessage {
    type: "initSession";
    sessionId: string;
    userInfo?: {
        displayName?: string;
        email?: string;
        locale?: string;
    };
}

export interface UserRequestMessage extends BaseMessage {
    type: "userRequest";
    sessionId: string;
    requestId: string;
    message: string;
    context?: {
        conversationHistory?: Array<{
            role: "user" | "assistant";
            content: string;
        }>;
        userInfo?: Record<string, any>;
        metadata?: Record<string, any>;
    };
}

export interface PingMessage extends BaseMessage {
    type: "ping";
    sessionId: string;
}

export interface CloseSessionMessage extends BaseMessage {
    type: "closeSession";
    sessionId: string;
    reason?: string;
}

/**
 * Completion request message
 * Requests autocomplete/intellisense suggestions for partial input
 */
export interface CompletionRequestMessage extends BaseMessage {
    type: "completionRequest";
    sessionId: string;
    requestId: string;
    prefix: string; // The partial input text to get completions for
}

// Response Messages (Server � Client)
export interface ResponseMessage extends BaseMessage {
    type: "response";
    sessionId: string;
    requestId: string;
    content: string;
    contentType: "text" | "markdown" | "html";
    metadata?: {
        agentUsed?: string;
        executionTime?: number;
        confidence?: number;
        suggestions?: string[];
        [key: string]: any;
    };
}

export interface ErrorMessage extends BaseMessage {
    type: "error";
    sessionId: string;
    requestId?: string;
    error: {
        code: string;
        message: string;
        details?: any;
    };
}

export interface PongMessage extends BaseMessage {
    type: "pong";
    sessionId: string;
    serverTime?: string;
}

export interface StatusMessage extends BaseMessage {
    type: "status";
    sessionId?: string;
    status: "ready" | "busy" | "error" | "initializing";
    message?: string;
    metadata?: {
        version?: string;
        availableAgents?: string[];
        capabilities?: string[];
        [key: string]: any;
    };
}

export interface ProgressMessage extends BaseMessage {
    type: "progress";
    sessionId: string;
    requestId: string;
    progress: {
        current: number;
        total: number;
        message?: string;
        percentage?: number;
    };
}

export interface SessionAckMessage extends BaseMessage {
    type: "sessionAck";
    sessionId: string;
    message?: string;
    capabilities?: string[];
}

export interface InvokeExternalChatMessage extends BaseMessage {
    type: "invoke_external_chat";
    sessionId: string;
    requestId: string;
    query: string;
    context?: {
        conversationHistory?: Array<{
            role: "user" | "assistant";
            content: string;
        }>;
        userLocation?: string;
        locale?: string;
        metadata?: Record<string, any>;
    };
}

/**
 * Completion group - represents a category of autocomplete suggestions
 * Matches the CompletionGroup type from agent-dispatcher
 */
export interface CompletionGroup {
    name: string;              // Group name (e.g., "Commands", "Artist Names")
    completions: string[];     // List of completion strings
    needQuotes?: boolean;      // If true, quote values with spaces
    emojiChar?: string;        // Optional icon for the category
    sorted?: boolean;          // If true, completions are already sorted
}

/**
 * Completion response message
 * Returns autocomplete suggestions from dispatcher
 */
export interface CompletionResponseMessage extends BaseMessage {
    type: "completionResponse";
    sessionId: string;
    requestId: string;
    result?: {
        startIndex: number;        // Index where completion starts in the input
        space: boolean;            // Whether space is required before completion
        completions: CompletionGroup[]; // Array of completion groups
    };
    error?: {
        code: string;
        message: string;
    };
}

// Union Types
export type TypeAgentRequestMessage =
    | InitSessionMessage
    | UserRequestMessage
    | PingMessage
    | CloseSessionMessage
    | CompletionRequestMessage;

export type TypeAgentResponseMessage =
    | ResponseMessage
    | ErrorMessage
    | PongMessage
    | StatusMessage
    | ProgressMessage
    | SessionAckMessage
    | InvokeExternalChatMessage
    | CompletionResponseMessage;

export type TypeAgentMessage =
    | TypeAgentRequestMessage
    | TypeAgentResponseMessage;

// Helper Types
export type ContentType = "text" | "markdown" | "html";
export type StatusValue = "ready" | "busy" | "error" | "initializing";
export type MessageRole = "user" | "assistant";

export interface ConversationEntry {
    role: MessageRole;
    content: string;
    timestamp?: string;
}
