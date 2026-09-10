// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { OpenAIFunctionTool } from "../../synthesizer/benchmark.js";
import {
    parsePythonLiteral,
    parsePythonLiteralAt,
    type PythonLiteral,
} from "../pythonLiteral.js";
import {
    downloadHuggingFaceRows,
    type HuggingFaceRowsSource,
} from "../huggingFaceRows.js";

export const sealToolsSource: HuggingFaceRowsSource = {
    dataset: "casey-martin/Seal-Tools",
    revision: "d0fe2245740d01a22b8fdd22ec1f49e48fcb1fbf",
    config: "default",
    split: "validation",
};

const sealToolsRowSchema = z.object({
    id: z.string(),
    conversations: z.array(
        z.object({
            from: z.string(),
            value: z.string(),
        }),
    ),
    domain: z.string(),
});

export async function downloadSealTools(outputPath: string): Promise<number> {
    return downloadHuggingFaceRows({
        source: sealToolsSource,
        outputPath,
        parseRow: (value) => sealToolsRowSchema.parse(value),
        onProgress: (downloaded, total) => {
            process.stderr.write(`Downloaded ${downloaded}/${total}\r`);
        },
    });
}

async function main(): Promise<void> {
    const outputPath = process.argv[2];
    if (!outputPath || process.argv.length !== 3) {
        throw new Error("Usage: getDataset <output.jsonl>");
    }
    const rows = await downloadSealTools(outputPath);
    process.stderr.write(`Downloaded ${rows} rows to ${outputPath}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}

const API_LIST_MARKER = "api_list = ";
const TASK_MARKER = "task_instruction = ";
const OUTPUT_MARKER = "\nOutput:";

const JSON_TYPES: Readonly<Record<string, string>> = {
    str: "string",
    string: "string",
    int: "integer",
    integer: "integer",
    float: "number",
    number: "number",
    double: "number",
    bool: "boolean",
    boolean: "boolean",
    list: "array",
    array: "array",
    dict: "object",
    object: "object",
};

export interface SealToolsSourceRow {
    id: string;
    conversations: { from: string; value: string }[];
    domain: string;
}

export interface SealToolsParameter {
    type: string;
    description?: string;
}

export interface SealToolsTool {
    name: string;
    description: string;
    parameters: Record<string, SealToolsParameter>;
    required: string[];
}

export interface SealToolsCall {
    api: string;
    parameters: Record<string, PythonLiteral>;
    responses: string[];
}

export interface SealToolsCase {
    id: string;
    domain: string;
    utterance: string;
    tools: SealToolsTool[];
    calls: SealToolsCall[];
}

// Reject scalar and list values before reading a corpus object.
function asRecord(
    value: PythonLiteral,
    label: string,
): Record<string, PythonLiteral> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as Record<string, PythonLiteral>;
}

// Parse one tool declaration from the Python-literal catalog.
function parseTool(value: PythonLiteral): SealToolsTool {
    const source = asRecord(value, "tool");
    if (typeof source.api_name !== "string") {
        throw new Error("tool api_name must be a string");
    }
    const parameters = Object.create(null) as Record<
        string,
        SealToolsParameter
    >;
    if (source.parameters !== undefined) {
        const rawParameters = asRecord(source.parameters, "tool parameters");
        for (const [name, value] of Object.entries(rawParameters)) {
            const parameter = asRecord(value, `parameter ${name}`);
            const type =
                typeof parameter.type === "string" ? parameter.type : "str";
            parameters[name] = {
                type,
                ...(typeof parameter.description === "string"
                    ? { description: parameter.description }
                    : {}),
            };
        }
    }
    return {
        name: source.api_name,
        description:
            typeof source.api_description === "string"
                ? source.api_description
                : "",
        parameters,
        required: Array.isArray(source.required)
            ? source.required.filter(
                  (name): name is string => typeof name === "string",
              )
            : [],
    };
}

// Use the line delimiters because corpus text can contain unescaped quotes.
function parseTaskInstruction(value: string, offset: number): string {
    const outputIndex = value.indexOf(OUTPUT_MARKER, offset);
    if (outputIndex < 0) throw new Error("human turn has no output marker");
    const literal = value.slice(offset, outputIndex).trim();
    const quote = literal[0];
    if (
        literal.length < 2 ||
        (quote !== "'" && quote !== '"') ||
        literal.at(-1) !== quote
    ) {
        throw new Error("task instruction has invalid delimiters");
    }

    // Escape interior delimiters, then reuse the Python escape decoder.
    let escaped = quote;
    let backslashes = 0;
    for (const character of literal.slice(1, -1)) {
        if (character === quote && backslashes % 2 === 0) escaped += "\\";
        escaped += character;
        backslashes = character === "\\" ? backslashes + 1 : 0;
    }
    const instruction = parsePythonLiteral(escaped + quote);
    if (typeof instruction !== "string") {
        throw new Error("task instruction must be a string");
    }
    return instruction;
}

// Parse the catalog and utterance embedded in the human turn.
function parseHumanTurn(value: string): {
    tools: SealToolsTool[];
    utterance: string;
} {
    const catalogIndex = value.indexOf(API_LIST_MARKER);
    if (catalogIndex < 0) throw new Error("human turn has no API catalog");
    const catalog = parsePythonLiteralAt(value, {
        offset: catalogIndex + API_LIST_MARKER.length,
    });
    if (!Array.isArray(catalog.value)) {
        throw new Error("human turn API catalog must be an array");
    }

    const taskIndex = value.indexOf(TASK_MARKER, catalog.end);
    if (taskIndex < 0) throw new Error("human turn has no task instruction");
    const instructionStart = taskIndex + TASK_MARKER.length;

    return {
        tools: catalog.value.map(parseTool),
        utterance: parseTaskInstruction(value, instructionStart),
    };
}

// Parse the assistant's Python-repr list while preserving number lexemes for
// exact corpus scoring.
function parseAssistantTurn(value: string): SealToolsCall[] {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "-1") return [];
    const parsed = parsePythonLiteral(trimmed, {
        preserveNumberLexemes: true,
    });
    if (!Array.isArray(parsed)) {
        throw new Error("assistant turn must be an array");
    }
    return parsed.map((value) => {
        const call = asRecord(value, "assistant call");
        if (typeof call.api !== "string") {
            throw new Error("assistant call api must be a string");
        }
        const parameters =
            call.parameters === undefined
                ? {}
                : asRecord(call.parameters, "assistant call parameters");
        return {
            api: call.api,
            parameters,
            responses: Array.isArray(call.responses)
                ? call.responses.filter(
                      (response): response is string =>
                          typeof response === "string",
                  )
                : [],
        };
    });
}

// Parse one source row. Rows with missing turns or no gold calls are not
// benchmark cases and return undefined.
export function parseSealToolsRow(
    row: SealToolsSourceRow,
): SealToolsCase | undefined {
    const human = row.conversations.find(
        (conversation) => conversation.from === "human",
    )?.value;
    const assistant = row.conversations.find(
        (conversation) => conversation.from === "gpt",
    )?.value;
    if (human === undefined || assistant === undefined) return undefined;

    const parsedHuman = parseHumanTurn(human);
    const calls = parseAssistantTurn(assistant);
    if (calls.length === 0) return undefined;
    return {
        id: row.id,
        domain: row.domain,
        utterance: parsedHuman.utterance,
        tools: parsedHuman.tools,
        calls,
    };
}

// Convert a parsed source tool to the closed function schema used by the
// translation benchmark.
export function toSealToolsFunctionTool(
    tool: SealToolsTool,
): OpenAIFunctionTool {
    for (const name of tool.required) {
        if (!Object.prototype.hasOwnProperty.call(tool.parameters, name)) {
            throw new Error(`Required parameter '${name}' is not declared`);
        }
    }
    const properties = Object.fromEntries(
        Object.entries(tool.parameters).map(([name, parameter]) => {
            const type =
                JSON_TYPES[parameter.type.trim().toLocaleLowerCase("en-US")] ??
                "string";
            return [
                name,
                {
                    type,
                    ...(parameter.description === undefined
                        ? {}
                        : { description: parameter.description }),
                },
            ];
        }),
    );
    return {
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: "object",
                properties,
                required: [...tool.required],
                additionalProperties: false,
            },
        },
    };
}
