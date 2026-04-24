// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TypeChat schema for CLI discovery LLM extraction.
// This file is loaded as text by TypeChat's validator — keep it
// self-contained with no runtime imports.

/** Result of extracting CLI actions from help output. */
export type CliDiscoveryResult = {
    /** Leaf CLI actions (commands that perform an action, not command groups). */
    actions: CliAction[];
    /** Domain entities referenced across the CLI (e.g. repos, issues, users). */
    entities?: CliEntity[];
};

export type CliAction = {
    /** camelCase name derived from the command path (e.g. "gh repo create" → "repoCreate"). */
    name: string;
    /** Brief description of what the command does. */
    description: string;
    /** Full CLI command path (e.g. "gh repo create"). */
    path: string;
    /** Discovered parameters (flags and positional arguments). */
    parameters?: CliParameter[];
};

export type CliParameter = {
    /** Parameter name (e.g. "--limit" or "<owner>"). */
    name: string;
    /** Data type (string, number, boolean, etc.). */
    type: string;
    /** Brief description of the parameter. */
    description?: string;
    /** Whether the parameter is required. */
    required?: boolean;
};

export type CliEntity = {
    /** Singular noun for this entity (e.g. "repository", "issue", "user"). */
    name: string;
    /** Brief description of the entity. */
    description?: string;
    /** Example values that appear in help text (e.g. "owner/repo", "#123"). */
    examples?: string[];
};
