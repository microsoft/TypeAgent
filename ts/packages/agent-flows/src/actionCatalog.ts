// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Action catalog parser: extract a registry of valid (schemaName, actionName)
// pairs from the LLM-facing API catalog comment block. Used for static script
// validation so the validator and the LLM see the same source of truth.
//
// Catalog format (the existing Excel convention; reasonable as a default):
//
//   1. Block form — a schema header followed by indented action signatures:
//        //   "excel.excel-range"
//        //     setCellValue   { address, value, worksheetName? }
//        //     getRangeValues { range, worksheetName? }
//
//   2. Inline form — schema header with action list on the same line:
//        //   "excel.excel-table"      — createTable, filterTable, sortTable
//
// Action lines require ≥4 spaces of indent after `//` AND a `{` after the
// action name so that "common parameter mistake" annotations (e.g.
// `//   actionName: …` with 3 spaces of indent and a `:`) don't get parsed
// as actions.
//
// Agents that don't follow this exact format can override the regexes via
// `ActionCatalogOptions.schemaHeaderRegex` / `actionLineRegex`.

export interface ActionRegistry {
    hasSchema(schemaName: string): boolean;
    hasAction(schemaName: string, actionName: string): boolean;
    listActions(schemaName: string): readonly string[];
    listSchemas(): readonly string[];
}

export interface ActionCatalogOptions {
    // Override for the schema-header regex. The first capture must be the
    // schema name; an optional second capture, when present, is split on `,`
    // to produce inline action names (each must be a valid identifier).
    schemaHeaderRegex?: RegExp;
    // Override for the action-line regex. The first capture must be the
    // action name.
    actionLineRegex?: RegExp;
}

// Default: schema header is `//   "schema-name"` optionally followed by
// `— actionA, actionB, ...`.
const DEFAULT_SCHEMA_HEADER = /^\s*\/\/\s+"([^"]+)"(?:\s+—\s+(.+))?$/;

// Default: action line is `//` + ≥4 spaces + identifier + `{`.
const DEFAULT_ACTION_LINE = /^\s*\/\/\s{4,}([a-z][A-Za-z0-9]*)\s+\{/;

// Parse a catalog comment block into schemaName → Set<actionName>.
export function parseActionCatalog(
    text: string,
    options?: ActionCatalogOptions,
): ActionRegistry {
    const schemaHeader = options?.schemaHeaderRegex ?? DEFAULT_SCHEMA_HEADER;
    const actionLine = options?.actionLineRegex ?? DEFAULT_ACTION_LINE;

    const map = new Map<string, Set<string>>();
    let currentSchema: string | undefined;

    for (const rawLine of text.split("\n")) {
        const line = rawLine.replace(/\r$/, "");

        const schemaMatch = line.match(schemaHeader);
        if (schemaMatch) {
            const schemaName = schemaMatch[1];
            currentSchema = schemaName;
            if (!map.has(schemaName)) map.set(schemaName, new Set());
            const inlineActions = schemaMatch[2];
            if (inlineActions) {
                for (const name of inlineActions
                    .split(",")
                    .map((s) => s.trim())) {
                    if (/^[a-z][A-Za-z0-9]*$/.test(name)) {
                        map.get(schemaName)!.add(name);
                    }
                }
            }
            continue;
        }

        const actionMatch = line.match(actionLine);
        if (actionMatch && currentSchema) {
            map.get(currentSchema)!.add(actionMatch[1]);
        }
    }

    return makeRegistry(map);
}

// Build an ActionRegistry from a pre-computed map. Useful when an agent
// already has the schema→actions data in another form and just wants the
// uniform interface.
export function makeRegistry(
    map: ReadonlyMap<string, ReadonlySet<string>>,
): ActionRegistry {
    return {
        hasSchema(schemaName: string): boolean {
            return map.has(schemaName);
        },
        hasAction(schemaName: string, actionName: string): boolean {
            return map.get(schemaName)?.has(actionName) === true;
        },
        listActions(schemaName: string): readonly string[] {
            const s = map.get(schemaName);
            return s ? [...s] : [];
        },
        listSchemas(): readonly string[] {
            return [...map.keys()];
        },
    };
}
