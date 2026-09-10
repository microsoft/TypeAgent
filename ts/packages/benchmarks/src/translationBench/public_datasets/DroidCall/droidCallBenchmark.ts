// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

import type {
    OpenAIFunctionTool,
    TranslationBenchBenchmarkAction,
    TranslationBenchOrder,
    TranslationBenchParameterScoreSpec,
    TranslationBenchPublicTurnLineage,
    TranslationBenchTargetAction,
} from "../../synthesizer/benchmark.js";

const DROIDCALL_SCHEMA_NAME = "droidcall";
const DROIDCALL_SOURCE = {
    dataset: "mllmTeam/DroidCall",
    revision: "42563ae614280d2891d57f1e7057c4bc50dd27bd",
    config: "default",
} as const;
const RESULT_REFERENCE = /^#\d+$/;

const CONTACT_INFO_SCHEMA = {
    type: "object",
    properties: Object.fromEntries(
        ["email", "phone", "name", "company", "address"].map((name) => [
            name,
            { type: "string" },
        ]),
    ),
    required: [],
    additionalProperties: false,
};

const JSON_TYPES = {
    str: { type: "string" },
    int: { type: "integer" },
    bool: { type: "boolean" },
    "List[str]": { type: "array", items: { type: "string" } },
    "list[str]": { type: "array", items: { type: "string" } },
    "Optional[List[str]]": { type: "array", items: { type: "string" } },
    "Dict[str, Any]": CONTACT_INFO_SCHEMA,
    "Optional[Dict[str, Any]]": CONTACT_INFO_SCHEMA,
} satisfies Record<string, Record<string, unknown>>;

export interface DroidCallArgumentSpec {
    type: keyof typeof JSON_TYPES;
    description?: string;
    required?: boolean;
    default?: unknown;
}

export interface DroidCallTool {
    name: string;
    description: string;
    arguments: Record<string, DroidCallArgumentSpec>;
}

export interface DroidCallAction {
    id: number;
    name: string;
    arguments: Record<string, unknown>;
}

export interface DroidCallSourceRow {
    query: string;
    answers: DroidCallAction[];
    tools: DroidCallTool[];
}

export interface DroidCallBenchmarkCase {
    id: string;
    utterance: string;
    schemaName: string;
    tools: OpenAIFunctionTool[];
    droidCallGoldActions: DroidCallAction[];
    expectedActions: TranslationBenchBenchmarkAction[];
    order: TranslationBenchOrder;
    parameterScore: TranslationBenchParameterScoreSpec[];
    targetAction: TranslationBenchTargetAction;
    dimensions: Record<string, string | number | boolean>;
    lineage: TranslationBenchPublicTurnLineage;
}

// Convert the finite DroidCall type vocabulary into closed JSON schemas.
export function toDroidCallFunctionTool(
    tool: DroidCallTool,
): OpenAIFunctionTool {
    const properties = Object.create(null) as Record<
        string,
        Record<string, unknown>
    >;
    const required: string[] = [];
    for (const [name, spec] of Object.entries(tool.arguments)) {
        const jsonType = JSON_TYPES[spec.type];
        if (jsonType === undefined) {
            throw new Error(
                `Unsupported DroidCall type '${spec.type}' for ${tool.name}.${name}`,
            );
        }
        properties[name] = {
            ...jsonType,
            ...(spec.description === undefined
                ? {}
                : { description: spec.description }),
            ...(Object.prototype.hasOwnProperty.call(spec, "default")
                ? { default: spec.default }
                : {}),
        };
        if (spec.required === true) required.push(name);
    }
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: "object",
                properties,
                required,
                additionalProperties: false,
            },
        },
    };
}

// Keep parameter matching exact; corpus-specific scoring stays in the scorer.
function createParameterScore(
    actions: TranslationBenchBenchmarkAction[],
): TranslationBenchParameterScoreSpec[] {
    return actions.map(() => ({ defaultMode: "exact", fields: {} }));
}

// Result references can occur inside nested argument values.
function hasResultReference(value: unknown): boolean {
    if (typeof value === "string") return RESULT_REFERENCE.test(value);
    if (Array.isArray(value)) return value.some(hasResultReference);
    if (typeof value === "object" && value !== null) {
        return Object.values(value).some(hasResultReference);
    }
    return false;
}

// Convert one source row without requiring the downloader or code parser.
export function toDroidCallBenchmarkCase(
    row: DroidCallSourceRow,
    split: "train" | "test",
    rowIndex: number,
): DroidCallBenchmarkCase | undefined {
    if (row.answers.length < 2) return undefined;

    // Exclude gold actions that the row's candidate tools cannot produce.
    const toolNames = new Set(row.tools.map((tool) => tool.name));
    if (row.answers.some((answer) => !toolNames.has(answer.name))) {
        return undefined;
    }

    const tools = row.tools.map(toDroidCallFunctionTool);
    const expectedActions = row.answers.map((answer) => ({
        schemaName: DROIDCALL_SCHEMA_NAME,
        actionName: answer.name,
        parameters: structuredClone(answer.arguments),
    }));
    const order: TranslationBenchOrder = row.answers.some((answer) =>
        hasResultReference(answer.arguments),
    )
        ? "strict"
        : "any";
    const id = `droidcall-${split}-${rowIndex}`;
    const canonical = JSON.stringify({
        utterance: row.query,
        expectedActions,
        order,
    });
    const hash = (text: string): string =>
        createHash("sha256").update(text).digest("hex");
    const lineage: TranslationBenchPublicTurnLineage = {
        ...DROIDCALL_SOURCE,
        split,
        rowIndex,
        rowId: id,
        sourceUrl: `https://huggingface.co/datasets/${DROIDCALL_SOURCE.dataset}`,
        sourcePart: "query+answers+tools",
        rawRowHash: hash(JSON.stringify(row)),
        sourceSliceHash: hash(
            JSON.stringify([row.query, row.answers, row.tools]),
        ),
        canonicalPayloadHash: hash(canonical),
        transformVersion: 1,
    };

    // Preserve the source action order and corpus fields for later rescoring.
    return {
        id,
        utterance: row.query,
        schemaName: DROIDCALL_SCHEMA_NAME,
        tools,
        droidCallGoldActions: structuredClone(row.answers),
        expectedActions,
        order,
        parameterScore: createParameterScore(expectedActions),
        targetAction: {
            schemaName: DROIDCALL_SCHEMA_NAME,
            actionName: expectedActions[0]!.actionName,
        },
        dimensions: {
            source: "droidcall",
            split,
            arity: expectedActions.length,
            dependency: order === "strict" ? "sequential" : "parallel",
        },
        lineage,
    };
}

// Keep only DroidCall's multi-action rows; single actions already have broader
// benchmark coverage.
export function buildDroidCallMultiActionCases(
    rows: readonly DroidCallSourceRow[],
    split: "train" | "test",
): DroidCallBenchmarkCase[] {
    return rows
        .map((row, index) => toDroidCallBenchmarkCase(row, split, index))
        .filter((row): row is DroidCallBenchmarkCase => row !== undefined);
}
