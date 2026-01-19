// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Configuration for different CLI coding assistants
 */
export interface AssistantConfig {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
}

/**
 * Predefined assistant configurations
 */
export const ASSISTANT_CONFIGS: Record<string, AssistantConfig> = {
    claude: {
        name: "Claude Code",
        command: "claude",
        args: [],
    },
    node: {
        name: "Node REPL",
        command: "node",
        args: [],
    },
    python: {
        name: "Python REPL",
        command: "python",
        args: [],
    },
    // Add more assistants as needed
    // aider: {
    //     name: "Aider",
    //     command: "aider",
    //     args: [],
    // },
    // cursor: {
    //     name: "Cursor",
    //     command: "cursor",
    //     args: [],
    // },
};

/**
 * Get assistant configuration by name or return default
 */
export function getAssistantConfig(assistantName?: string): AssistantConfig {
    const name = assistantName || "claude";
    const config = ASSISTANT_CONFIGS[name];

    if (!config) {
        throw new Error(
            `Unknown assistant: ${name}. Available: ${Object.keys(ASSISTANT_CONFIGS).join(", ")}`,
        );
    }

    return config;
}
