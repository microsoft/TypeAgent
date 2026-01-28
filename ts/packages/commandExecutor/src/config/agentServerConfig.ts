// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Agent Server Configuration
 *
 * This file defines the configuration structure for the agent server,
 * including grammar system selection, cache options, and dispatcher settings.
 */

/**
 * Grammar system implementation to use for request matching
 */
export type GrammarSystem = "completionBased" | "nfa";

/**
 * Cache configuration options
 */
export interface CacheConfig {
    /**
     * Enable or disable the cache system
     * @default true
     */
    enabled?: boolean;

    /**
     * Grammar system to use for matching
     * - "completionBased": Use the existing completion-based construction cache system
     * - "nfa": Use the new NFA-based agent grammar registry
     * @default "completionBased"
     */
    grammarSystem?: GrammarSystem;

    /**
     * Enable wildcard matching in cache queries
     * @default false
     */
    matchWildcard?: boolean;

    /**
     * Enable entity wildcard matching in cache queries
     * @default false
     */
    matchEntityWildcard?: boolean;

    /**
     * Merge multiple match sets when multiple patterns match
     * @default true
     */
    mergeMatchSets?: boolean;

    /**
     * Cache conflicting translations (for debugging/analysis)
     * @default false
     */
    cacheConflicts?: boolean;
}

/**
 * Agent-specific configuration
 */
export interface AgentConfig {
    /**
     * Agent identifier (e.g., "player", "calendar", "email")
     */
    name: string;

    /**
     * Enable or disable this agent
     * @default true
     */
    enabled?: boolean;

    /**
     * Agent-specific initialization options
     */
    options?: Record<string, unknown>;

    /**
     * Path to agent grammar file (for NFA system)
     * If not specified, will look in standard locations
     */
    grammarFile?: string;
}

/**
 * Dispatcher configuration options
 */
export interface DispatcherConfig {
    /**
     * Enable session persistence
     * @default true
     */
    persistSession?: boolean;

    /**
     * Directory for persisting session data
     * @default "~/.typeagent"
     */
    persistDir?: string;

    /**
     * Enable metrics collection
     * @default true
     */
    metrics?: boolean;

    /**
     * Enable database logging
     * @default false
     */
    dbLogging?: boolean;

    /**
     * Enable knowledge extraction from conversations
     */
    conversationMemory?: {
        /**
         * Extract knowledge from user requests
         * @default false
         */
        requestKnowledgeExtraction?: boolean;

        /**
         * Extract knowledge from action results
         * @default false
         */
        actionResultKnowledgeExtraction?: boolean;
    };
}

/**
 * Complete agent server configuration
 */
export interface AgentServerConfig {
    /**
     * Configuration format version
     * @default "1.0"
     */
    version?: string;

    /**
     * Cache configuration
     */
    cache?: CacheConfig;

    /**
     * Agent-specific configurations
     */
    agents?: AgentConfig[];

    /**
     * Dispatcher configuration
     */
    dispatcher?: DispatcherConfig;
}

/**
 * Default configuration values (concrete type without optional)
 */
export interface ResolvedAgentServerConfig {
    version: string;
    cache: {
        enabled: boolean;
        grammarSystem: GrammarSystem;
        matchWildcard: boolean;
        matchEntityWildcard: boolean;
        mergeMatchSets: boolean;
        cacheConflicts: boolean;
    };
    agents: AgentConfig[];
    dispatcher: {
        persistSession: boolean;
        persistDir: string;
        metrics: boolean;
        dbLogging: boolean;
        conversationMemory: {
            requestKnowledgeExtraction: boolean;
            actionResultKnowledgeExtraction: boolean;
        };
    };
}

export const DEFAULT_CONFIG: ResolvedAgentServerConfig = {
    version: "1.0",
    cache: {
        enabled: true,
        grammarSystem: "completionBased",
        matchWildcard: false,
        matchEntityWildcard: false,
        mergeMatchSets: true,
        cacheConflicts: false,
    },
    agents: [],
    dispatcher: {
        persistSession: true,
        persistDir: "~/.typeagent",
        metrics: true,
        dbLogging: false,
        conversationMemory: {
            requestKnowledgeExtraction: false,
            actionResultKnowledgeExtraction: false,
        },
    },
};

/**
 * Merge user configuration with defaults
 */
export function mergeConfig(
    userConfig: AgentServerConfig,
): ResolvedAgentServerConfig {
    return {
        version: userConfig.version ?? DEFAULT_CONFIG.version,
        cache: {
            enabled: userConfig.cache?.enabled ?? DEFAULT_CONFIG.cache.enabled,
            grammarSystem:
                userConfig.cache?.grammarSystem ??
                DEFAULT_CONFIG.cache.grammarSystem,
            matchWildcard:
                userConfig.cache?.matchWildcard ??
                DEFAULT_CONFIG.cache.matchWildcard,
            matchEntityWildcard:
                userConfig.cache?.matchEntityWildcard ??
                DEFAULT_CONFIG.cache.matchEntityWildcard,
            mergeMatchSets:
                userConfig.cache?.mergeMatchSets ??
                DEFAULT_CONFIG.cache.mergeMatchSets,
            cacheConflicts:
                userConfig.cache?.cacheConflicts ??
                DEFAULT_CONFIG.cache.cacheConflicts,
        },
        agents: userConfig.agents ?? DEFAULT_CONFIG.agents,
        dispatcher: {
            persistSession:
                userConfig.dispatcher?.persistSession ??
                DEFAULT_CONFIG.dispatcher.persistSession,
            persistDir:
                userConfig.dispatcher?.persistDir ??
                DEFAULT_CONFIG.dispatcher.persistDir,
            metrics:
                userConfig.dispatcher?.metrics ??
                DEFAULT_CONFIG.dispatcher.metrics,
            dbLogging:
                userConfig.dispatcher?.dbLogging ??
                DEFAULT_CONFIG.dispatcher.dbLogging,
            conversationMemory: {
                requestKnowledgeExtraction:
                    userConfig.dispatcher?.conversationMemory
                        ?.requestKnowledgeExtraction ??
                    DEFAULT_CONFIG.dispatcher.conversationMemory
                        .requestKnowledgeExtraction,
                actionResultKnowledgeExtraction:
                    userConfig.dispatcher?.conversationMemory
                        ?.actionResultKnowledgeExtraction ??
                    DEFAULT_CONFIG.dispatcher.conversationMemory
                        .actionResultKnowledgeExtraction,
            },
        },
    };
}
