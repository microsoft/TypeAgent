// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The shape of the capability catalog collected from the workspace's bundled
// agents. It is serialized into the generated HTML (as an embedded reference)
// and consumed by the renderer. Every field is concrete (no optionals) so the
// data model stays simple and JSON-friendly.

export interface ParamInfo {
    name: string;
    /** Human-readable rendering of the parameter's schema type. */
    type: string;
    optional: boolean;
    description: string;
}

export interface ActionInfo {
    actionName: string;
    description: string;
    parameters: ParamInfo[];
    /** Example natural-language phrasings derived from the agent's grammar. */
    phrasings: string[];
}

export interface SchemaInfo {
    /** Fully-qualified schema name, e.g. "browser" or "browser.webFlows". */
    schemaName: string;
    description: string;
    /** Whether the schema is enabled by default in a fresh session. */
    defaultEnabled: boolean;
    /** Transient schemas are activated on demand rather than always present. */
    transient: boolean;
    actions: ActionInfo[];
}

export interface AgentInfo {
    /** Agent name, e.g. "player". */
    name: string;
    /** Top-level category this agent belongs to (see categories.ts). */
    category: string;
    emoji: string;
    description: string;
    schemas: SchemaInfo[];
}

export interface CommandArg {
    name: string;
    type: string;
    optional: boolean;
    description: string;
}

export interface CommandFlag {
    name: string;
    /** Short single-character alias, or "" when none. */
    char: string;
    type: string;
    /** Default value rendered as a string, or "" when none. */
    default: string;
    description: string;
}

export interface CommandInfo {
    /** Space-separated command path, e.g. "config agent". */
    path: string;
    description: string;
    /** True when the entry is a command group (has sub-commands). */
    group: boolean;
    args: CommandArg[];
    flags: CommandFlag[];
}

export interface CatalogCounts {
    agents: number;
    actions: number;
    commands: number;
}

export interface Catalog {
    /** ISO timestamp of when the catalog was generated. */
    generatedAt: string;
    agents: AgentInfo[];
    systemCommands: CommandInfo[];
    counts: CatalogCounts;
}
