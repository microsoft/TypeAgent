// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
    AgentServerConfig,
    ResolvedAgentServerConfig,
    DEFAULT_CONFIG,
    mergeConfig,
} from "./agentServerConfig.js";

/**
 * Configuration file locations to search (in order)
 */
function getConfigPaths(): string[] {
    const homeDir = os.homedir();
    const paths: string[] = [];

    // 1. Environment variable
    if (process.env.AGENT_SERVER_CONFIG) {
        paths.push(process.env.AGENT_SERVER_CONFIG);
    }

    // 2. Current working directory
    paths.push(path.join(process.cwd(), "agentServerConfig.json"));
    paths.push(path.join(process.cwd(), ".agentServerConfig.json"));

    // 3. User home directory
    paths.push(path.join(homeDir, ".typeagent", "agentServerConfig.json"));
    paths.push(path.join(homeDir, ".agentServerConfig.json"));

    // 4. TypeAgent instance directory (if set)
    if (process.env.TYPEAGENT_INSTANCE_DIR) {
        paths.push(
            path.join(
                process.env.TYPEAGENT_INSTANCE_DIR,
                "agentServerConfig.json",
            ),
        );
    }

    return paths;
}

/**
 * Load configuration from a file
 */
function loadConfigFromFile(filePath: string): AgentServerConfig | null {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }

        const fileContent = fs.readFileSync(filePath, "utf-8");
        const config = JSON.parse(fileContent) as AgentServerConfig;

        return config;
    } catch (error) {
        console.warn(
            `Warning: Failed to load configuration from ${filePath}:`,
            error instanceof Error ? error.message : String(error),
        );
        return null;
    }
}

/**
 * Validate configuration structure
 */
function validateConfig(config: AgentServerConfig): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    // Validate version format
    if (config.version && !/^\d+\.\d+$/.test(config.version)) {
        errors.push(`Invalid version format: ${config.version}`);
    }

    // Validate grammar system
    if (config.cache?.grammarSystem) {
        const validSystems = ["legacy", "nfa"];
        if (!validSystems.includes(config.cache.grammarSystem)) {
            errors.push(
                `Invalid grammar system: ${config.cache.grammarSystem}. Must be one of: ${validSystems.join(", ")}`,
            );
        }
    }

    // Validate agents
    if (config.agents) {
        if (!Array.isArray(config.agents)) {
            errors.push("agents must be an array");
        } else {
            config.agents.forEach((agent, index) => {
                if (!agent.name) {
                    errors.push(`Agent at index ${index} is missing 'name'`);
                }
                if (agent.grammarFile && !fs.existsSync(agent.grammarFile)) {
                    errors.push(
                        `Agent '${agent.name}' grammar file not found: ${agent.grammarFile}`,
                    );
                }
            });
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Load agent server configuration from file system
 *
 * Searches for configuration files in the following order:
 * 1. Path specified in AGENT_SERVER_CONFIG environment variable
 * 2. ./agentServerConfig.json (current directory)
 * 3. ./.agentServerConfig.json (current directory, hidden)
 * 4. ~/.typeagent/agentServerConfig.json (user config directory)
 * 5. ~/.agentServerConfig.json (user home directory)
 * 6. $TYPEAGENT_INSTANCE_DIR/agentServerConfig.json (if set)
 *
 * @returns Merged configuration with defaults
 */
export function loadConfig(): {
    config: ResolvedAgentServerConfig;
    source: string | null;
    errors: string[];
} {
    const configPaths = getConfigPaths();
    let loadedConfig: AgentServerConfig | null = null;
    let configSource: string | null = null;

    // Try to load from each path in order
    for (const configPath of configPaths) {
        loadedConfig = loadConfigFromFile(configPath);
        if (loadedConfig !== null) {
            configSource = configPath;
            break;
        }
    }

    // If no config found, use defaults
    if (loadedConfig === null) {
        return {
            config: DEFAULT_CONFIG,
            source: null,
            errors: [],
        };
    }

    // Validate loaded config
    const validation = validateConfig(loadedConfig);
    if (!validation.valid) {
        console.warn(`Configuration validation warnings from ${configSource}:`);
        validation.errors.forEach((error) => console.warn(`  - ${error}`));
    }

    // Merge with defaults
    const mergedConfig = mergeConfig(loadedConfig);

    return {
        config: mergedConfig,
        source: configSource,
        errors: validation.errors,
    };
}

/**
 * Save configuration to file
 */
export function saveConfig(config: AgentServerConfig, filePath?: string): void {
    const targetPath =
        filePath ??
        path.join(os.homedir(), ".typeagent", "agentServerConfig.json");

    // Ensure directory exists
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Write config file
    fs.writeFileSync(targetPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Create a sample configuration file
 */
export function createSampleConfig(filePath: string): void {
    const sampleConfig: AgentServerConfig = {
        version: "1.0",
        cache: {
            enabled: true,
            grammarSystem: "nfa",
            matchWildcard: false,
            matchEntityWildcard: false,
            mergeMatchSets: true,
            cacheConflicts: false,
        },
        agents: [
            {
                name: "player",
                enabled: true,
                grammarFile:
                    "./packages/agents/player/src/agent/playerGrammar.agr",
            },
            {
                name: "calendar",
                enabled: true,
                grammarFile:
                    "./packages/agents/calendar/dist/calendarSchema.agr",
            },
        ],
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

    saveConfig(sampleConfig, filePath);
    console.log(`Sample configuration created at: ${filePath}`);
}
