// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type AppAgentStateConfig = {
    schemas: Record<string, boolean>;
    actions: Record<string, boolean>;
    commands: Record<string, boolean>;
};

export const appAgentStateKeys = ["schemas", "actions", "commands"] as const;
