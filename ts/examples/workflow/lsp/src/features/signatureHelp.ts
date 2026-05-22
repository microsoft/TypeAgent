// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDocument } from "vscode-languageserver-textdocument";
import {
    SignatureHelp,
    SignatureInformation,
    ParameterInformation,
    Position,
} from "vscode-languageserver/node.js";
import type { TaskSchema } from "../taskSchemas.js";

const IDENT_TAIL = /[A-Za-z0-9_.]/;
const IDENT_HEAD = /[A-Za-z_]/;

interface CallContext {
    name: string;
    activeParameter: number;
}

/**
 * Walks back from `cursorOffset` through the document text counting
 * parentheses to locate the innermost unclosed `(`. Then reads the
 * identifier immediately before it and counts commas between `(` and
 * the cursor at the original depth to compute the active parameter.
 *
 * Strings (single and double quoted) and template-literal text are
 * skipped so commas/parens inside them don't confuse the parser.
 */
function locateCall(text: string, cursorOffset: number): CallContext | null {
    let depth = 0;
    let commaCount = 0;
    let openParen = -1;

    // Build a quick "is inside string" map up to cursorOffset.
    const inString = scanStrings(text, cursorOffset);

    for (let i = cursorOffset - 1; i >= 0; i--) {
        if (inString[i]) continue;
        const c = text[i];
        if (c === ")") depth++;
        else if (c === "(") {
            if (depth === 0) {
                openParen = i;
                break;
            }
            depth--;
        } else if (c === "," && depth === 0) {
            commaCount++;
        }
    }

    if (openParen < 0) return null;

    // Read identifier (dotted) just before openParen, ignoring whitespace.
    let end = openParen;
    while (end > 0 && /\s/.test(text[end - 1]!)) end--;
    if (end === 0 || !IDENT_TAIL.test(text[end - 1]!)) return null;
    let start = end;
    while (start > 0 && IDENT_TAIL.test(text[start - 1]!)) start--;
    if (!IDENT_HEAD.test(text[start]!)) return null;

    return {
        name: text.slice(start, end),
        activeParameter: commaCount,
    };
}

function scanStrings(text: string, until: number): boolean[] {
    const flags = new Array(until).fill(false);
    let i = 0;
    while (i < until) {
        const c = text[i]!;
        if (c === "/" && text[i + 1] === "/") {
            while (i < until && text[i] !== "\n") {
                flags[i] = true;
                i++;
            }
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            flags[i] = true;
            i++;
            while (i < until && text[i] !== quote) {
                if (text[i] === "\\" && i + 1 < until) {
                    flags[i] = true;
                    flags[i + 1] = true;
                    i += 2;
                    continue;
                }
                flags[i] = true;
                i++;
            }
            if (i < until) {
                flags[i] = true;
                i++;
            }
            continue;
        }
        i++;
    }
    return flags;
}

function describeJsonType(schema: unknown): string {
    if (!schema || typeof schema !== "object") return "any";
    const s = schema as { type?: unknown };
    if (typeof s.type === "string") return s.type;
    if (Array.isArray(s.type)) return s.type.join(" | ");
    return "any";
}

function buildSignature(schema: TaskSchema): SignatureInformation {
    const input = schema.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
    };
    const props = input.properties ?? {};
    const required = input.required ?? Object.keys(props);
    const params: ParameterInformation[] = required.map((name) => ({
        label: `${name}: ${describeJsonType(props[name])}`,
    }));
    const label = `${schema.name}(${params.map((p) => p.label).join(", ")})`;
    return {
        label,
        parameters: params,
        documentation: {
            kind: "markdown",
            value: `Built-in task \`${schema.name}\`.`,
        },
    };
}

export function computeSignatureHelp(
    doc: TextDocument,
    position: Position,
    schemas: TaskSchema[],
): SignatureHelp | null {
    const text = doc.getText();
    const cursorOffset = doc.offsetAt(position);
    const ctx = locateCall(text, cursorOffset);
    if (!ctx) return null;

    const schema = schemas.find((s) => s.name === ctx.name);
    if (!schema) return null;

    const sig = buildSignature(schema);
    const activeParameter = Math.min(
        ctx.activeParameter,
        Math.max(0, (sig.parameters?.length ?? 1) - 1),
    );
    return {
        signatures: [sig],
        activeSignature: 0,
        activeParameter,
    };
}
