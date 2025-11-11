// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import WebSocket from "ws";
import type { ConversationEntry } from "../types/protocol.js";
import registerDebug from "debug";

const debug = registerDebug("typeagent:chat-rpc-server:sessionManager");

/**
 * Represents an active chat session
 */
export interface ChatSession {
    sessionId: string;
    ws: WebSocket;
    createdAt: Date;
    lastActivity: Date;
    userInfo?: {
        displayName?: string;
        email?: string;
        locale?: string;
    };
    conversationHistory: ConversationEntry[];
}

/**
 * Manages chat sessions with session tracking, cleanup, and conversation history
 */
export class SessionManager {
    private sessions = new Map<string, ChatSession>();
    private wsToSessionId = new Map<WebSocket, string>();
    private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Start cleanup interval
        this.startCleanup();
    }

    /**
     * Start automatic cleanup of inactive sessions
     */
    private startCleanup(): void {
        this.cleanupInterval = setInterval(
            () => {
                this.cleanupInactiveSessions();
            },
            5 * 60 * 1000,
        ); // Check every 5 minutes
    }

    /**
     * Stop automatic cleanup
     */
    public stopCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Create a new session
     */
    public createSession(
        sessionId: string,
        ws: WebSocket,
        userInfo?: any,
    ): ChatSession {
        const now = new Date();
        const session: ChatSession = {
            sessionId,
            ws,
            createdAt: now,
            lastActivity: now,
            userInfo,
            conversationHistory: [],
        };

        this.sessions.set(sessionId, session);
        this.wsToSessionId.set(ws, sessionId);

        debug(`Session created: ${sessionId}`);
        debug(`Total active sessions: ${this.sessions.size}`);

        return session;
    }

    /**
     * Get a session by session ID
     */
    public getSession(sessionId: string): ChatSession | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Get a session by WebSocket connection
     */
    public getSessionByWebSocket(ws: WebSocket): ChatSession | undefined {
        const sessionId = this.wsToSessionId.get(ws);
        return sessionId ? this.sessions.get(sessionId) : undefined;
    }

    /**
     * Update activity timestamp for a session
     */
    public updateActivity(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.lastActivity = new Date();
            debug(`Session activity updated: ${sessionId}`);
        }
    }

    /**
     * Remove a session
     */
    public removeSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            this.wsToSessionId.delete(session.ws);
            this.sessions.delete(sessionId);
            debug(`Session removed: ${sessionId}`);
            debug(`Total active sessions: ${this.sessions.size}`);
        }
    }

    /**
     * Remove a session by WebSocket connection
     */
    public removeSessionByWebSocket(ws: WebSocket): void {
        const sessionId = this.wsToSessionId.get(ws);
        if (sessionId) {
            this.removeSession(sessionId);
        }
    }

    /**
     * Clean up inactive sessions
     */
    public cleanupInactiveSessions(): void {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [sessionId, session] of this.sessions.entries()) {
            const inactiveTime = now - session.lastActivity.getTime();
            if (inactiveTime > this.SESSION_TIMEOUT) {
                debug(
                    `Cleaning up inactive session: ${sessionId} (inactive for ${Math.round(inactiveTime / 1000 / 60)} minutes)`,
                );
                this.removeSession(sessionId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            debug(`Cleaned up ${cleanedCount} inactive sessions`);
        }
    }

    /**
     * Add a message to session conversation history
     */
    public addToHistory(
        sessionId: string,
        role: "user" | "assistant",
        content: string,
    ): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.conversationHistory.push({
                role,
                content,
                timestamp: new Date().toISOString(),
            });
            debug(
                `Added ${role} message to session ${sessionId} history (total: ${session.conversationHistory.length})`,
            );
        }
    }

    /**
     * Get conversation history for a session
     */
    public getHistory(sessionId: string): ConversationEntry[] {
        const session = this.sessions.get(sessionId);
        return session ? [...session.conversationHistory] : [];
    }

    /**
     * Clear conversation history for a session
     */
    public clearHistory(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.conversationHistory = [];
            debug(`Cleared history for session ${sessionId}`);
        }
    }

    /**
     * Get all active session IDs
     */
    public getActiveSessions(): string[] {
        return Array.from(this.sessions.keys());
    }

    /**
     * Get session count
     */
    public getSessionCount(): number {
        return this.sessions.size;
    }

    /**
     * Check if a session exists
     */
    public hasSession(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    /**
     * Clean up all sessions (for shutdown)
     */
    public shutdown(): void {
        debug(
            `Shutting down session manager. Active sessions: ${this.sessions.size}`,
        );
        this.stopCleanup();
        this.sessions.clear();
        this.wsToSessionId.clear();
    }
}
