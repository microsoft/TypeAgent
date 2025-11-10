// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * TypeAgent WebSocket Protocol for ChatUIClient Integration
 * Message definitions for bi-directional communication between ChatUIClient agent and TypeAgent Shell
 */

// Base message structure
export interface BaseMessage {
    type: string;
    timestamp: string;
    sessionId?: string;
}

// ============================================================================
// Request Messages (ChatUIClient → TypeAgent)
// ============================================================================

/**
 * Initialize a new session
 * Sent when ChatUIClient first connects to TypeAgent Shell
 */
export interface InitSessionMessage extends BaseMessage {
    type: "initSession";
    sessionId: string;
    userInfo?: {
        displayName?: string;
        email?: string;
        locale?: string;
    };
}

/**
 * User request message
 * Sent when user submits a message in ChatUIClient UI
 */
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

/**
 * Ping message for connection health check
 */
export interface PingMessage extends BaseMessage {
    type: "ping";
    sessionId: string;
}

/**
 * Session close message
 * Sent when ChatUIClient agent is closing the session
 */
export interface CloseSessionMessage extends BaseMessage {
    type: "closeSession";
    sessionId: string;
    reason?: string;
}

// ============================================================================
// Response Messages (TypeAgent → ChatUIClient)
// ============================================================================

/**
 * Response to user request
 * Contains the TypeAgent's response to the user's message
 */
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

/**
 * Error message
 * Sent when an error occurs during processing
 */
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

/**
 * Pong message in response to ping
 */
export interface PongMessage extends BaseMessage {
    type: "pong";
    sessionId: string;
    serverTime?: string;
}

/**
 * Status message
 * Provides information about TypeAgent Shell status
 */
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

/**
 * Progress message
 * Sent during long-running operations to show progress
 */
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

/**
 * Session acknowledged message
 * Sent in response to initSession
 */
export interface SessionAckMessage extends BaseMessage {
    type: "sessionAck";
    sessionId: string;
    message?: string;
    capabilities?: string[];
}

// ============================================================================
// Union Types
// ============================================================================

/**
 * All request message types (ChatUIClient → TypeAgent)
 */
export type TypeAgentRequestMessage =
    | InitSessionMessage
    | UserRequestMessage
    | PingMessage
    | CloseSessionMessage;

/**
 * All response message types (TypeAgent → ChatUIClient)
 */
export type TypeAgentResponseMessage =
    | ResponseMessage
    | ErrorMessage
    | PongMessage
    | StatusMessage
    | ProgressMessage
    | SessionAckMessage;

/**
 * All message types in the protocol
 */
export type TypeAgentMessage =
    | TypeAgentRequestMessage
    | TypeAgentResponseMessage;

// ============================================================================
// Error Codes
// ============================================================================

/**
 * Standard error codes used in ErrorMessage
 */
export enum ErrorCode {
    // Connection errors
    INVALID_SESSION = "INVALID_SESSION",
    SESSION_NOT_FOUND = "SESSION_NOT_FOUND",
    SESSION_EXPIRED = "SESSION_EXPIRED",

    // Message errors
    INVALID_MESSAGE = "INVALID_MESSAGE",
    PARSE_ERROR = "PARSE_ERROR",
    UNKNOWN_MESSAGE_TYPE = "UNKNOWN_MESSAGE_TYPE",

    // Processing errors
    PROCESSING_ERROR = "PROCESSING_ERROR",
    TIMEOUT = "TIMEOUT",
    AGENT_NOT_AVAILABLE = "AGENT_NOT_AVAILABLE",
    DISPATCHER_ERROR = "DISPATCHER_ERROR",

    // Server errors
    INTERNAL_ERROR = "INTERNAL_ERROR",
    SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",

    // Validation errors
    VALIDATION_ERROR = "VALIDATION_ERROR",
    MISSING_REQUIRED_FIELD = "MISSING_REQUIRED_FIELD",
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Content type for response messages
 */
export type ContentType = "text" | "markdown" | "html";

/**
 * Status values for status messages
 */
export type StatusValue = "ready" | "busy" | "error" | "initializing";

/**
 * Message role in conversation history
 */
export type MessageRole = "user" | "assistant";

/**
 * Conversation history entry
 */
export interface ConversationEntry {
    role: MessageRole;
    content: string;
    timestamp?: string;
}
