// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type ActiveSchemaScope = {
    schemaNames: string[];
    unavailable: string[];
};

export function resolveActiveSchemaScope(
    activeSchemaNames: readonly string[],
    requestedSchemaNames?: readonly string[],
    requestedSchemaFamilies?: readonly string[],
): ActiveSchemaScope {
    if (
        requestedSchemaNames === undefined &&
        requestedSchemaFamilies === undefined
    ) {
        return { schemaNames: [...activeSchemaNames], unavailable: [] };
    }

    const requested = [...new Set(requestedSchemaNames ?? [])];
    const families = [...new Set(requestedSchemaFamilies ?? [])];
    const active = new Set(activeSchemaNames);
    const familyMatches = new Map(
        families.map((family) => [
            family,
            activeSchemaNames.filter(
                (name) => name === family || name.startsWith(`${family}.`),
            ),
        ]),
    );
    const schemaNames = [
        ...requested.filter((name) => active.has(name)),
        ...families.flatMap((family) => familyMatches.get(family) ?? []),
    ];
    return {
        schemaNames: [...new Set(schemaNames)],
        unavailable: [
            ...requested.filter((name) => !active.has(name)),
            ...families.filter(
                (family) => familyMatches.get(family)?.length === 0,
            ),
        ],
    };
}
