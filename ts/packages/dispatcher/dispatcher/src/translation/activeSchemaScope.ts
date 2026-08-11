// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ActiveSchemaScope = {
    schemaNames: string[];
    unavailable: string[];
};

export function resolveActiveSchemaScope(
    activeSchemaNames: readonly string[],
    requestedSchemaNames?: readonly string[],
): ActiveSchemaScope {
    if (requestedSchemaNames === undefined) {
        return { schemaNames: [...activeSchemaNames], unavailable: [] };
    }

    const requested = [...new Set(requestedSchemaNames)];
    const active = new Set(activeSchemaNames);
    return {
        schemaNames: requested.filter((name) => active.has(name)),
        unavailable: requested.filter((name) => !active.has(name)),
    };
}
