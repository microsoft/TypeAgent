// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Tolerant parser for LLM responses that emit "a flow script + metadata".
//
// LLM emit shapes drift over time and across models (Azure OpenAI GPT-4.1,
// Claude Sonnet 4.6, …). Rather than each agent re-deriving increasingly
// permissive regexes, this module centralizes the fallthrough order observed
// to work in practice:
//
//   1. ```json fenced block with { "script": "...", "parameters": [...] }
//   2. plain ``` fenced block whose body is a JSON object containing "script"
//   3. raw JSON sliced first `{` → last `}` containing "script"
//   4. bare script in ```typescript / ```ts / ```javascript / ```js
//      (script-only fallback; caller's defaultParameters are reused)
//
// Caller supplies a validator for the parameter shape (the parameter type
// varies per agent — see ExcelFlowParameter / RecipeParameter / etc.).

export interface FlowLLMResponse<TParam> {
    script: string;
    parameters: TParam[];
    description?: string;
}

export interface FlowLLMResponseOptions<TParam> {
    // Type-narrowing validator for the parameter array. Must reject when the
    // parsed JSON's `parameters` field isn't an array of the expected shape.
    validateParameters: (p: unknown) => p is TParam[];
    // Recognized bare-script signatures. The script-only fallback (#4) only
    // fires when the extracted code matches one of these. Defaults to
    // recognizing `async function execute(...)` — agents using a different
    // entry-point convention should override.
    bareScriptSignatures?: RegExp[];
    // Tag prepended to debug() output (e.g. `[create:myFlow]`). Optional.
    debugTag?: string;
    // Debug sink. Defaults to no-op so this module stays dep-free.
    debug?: (msg: string, ...args: unknown[]) => void;
}

const DEFAULT_BARE_SCRIPT_SIGNATURES = [/async\s+function\s+execute\s*\(/];

export function parseFlowLLMResponse<TParam>(
    text: string,
    defaultParameters: TParam[],
    options: FlowLLMResponseOptions<TParam>,
): FlowLLMResponse<TParam> | undefined {
    const debug = options.debug ?? (() => {});
    const tag = options.debugTag ?? "parseFlowLLMResponse";
    const sigs = options.bareScriptSignatures ?? DEFAULT_BARE_SCRIPT_SIGNATURES;

    // Try ```json blocks first, then plain ``` blocks containing a JSON
    // object (so we don't grab ```typescript or other code blocks here).
    let jsonBlocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
    if (jsonBlocks.length === 0) {
        jsonBlocks = [...text.matchAll(/```\s*(\{[\s\S]*?)```/g)];
    }
    let parsed: any;
    if (jsonBlocks.length > 0) {
        try {
            parsed = JSON.parse(jsonBlocks[jsonBlocks.length - 1][1]);
        } catch (err: any) {
            debug(
                "%s: JSON.parse failed for fenced block — %s",
                tag,
                err?.message ?? err,
            );
            return undefined;
        }
    } else {
        const first = text.indexOf("{");
        const last = text.lastIndexOf("}");
        const looksLikeWrapped =
            first !== -1 &&
            last > first &&
            /"script"\s*:/.test(text.slice(first, last + 1));
        if (looksLikeWrapped) {
            try {
                parsed = JSON.parse(text.slice(first, last + 1));
            } catch (err: any) {
                debug(
                    "%s: JSON.parse failed for raw object — %s",
                    tag,
                    err?.message ?? err,
                );
                return undefined;
            }
        } else {
            // Bare-script fallback: extract the last ts/js code block and
            // reuse the caller's parameter definitions unchanged.
            const codeBlocks = [
                ...text.matchAll(
                    /```(?:typescript|ts|javascript|js)?\s*([\s\S]*?)```/g,
                ),
            ];
            const bareScript =
                codeBlocks.length > 0
                    ? codeBlocks[codeBlocks.length - 1][1].trim()
                    : undefined;
            if (bareScript && sigs.some((re) => re.test(bareScript))) {
                debug(
                    "%s: extracted bare script from code block (no JSON wrapper)",
                    tag,
                );
                return { script: bareScript, parameters: defaultParameters };
            }
            debug(
                "%s: no JSON block or bare script found in response (length=%d)",
                tag,
                text.length,
            );
            return undefined;
        }
    }
    if (
        typeof parsed.script !== "string" ||
        !options.validateParameters(parsed.parameters)
    ) {
        debug("%s: parsed JSON missing or invalid script/parameters", tag);
        return undefined;
    }
    const out: FlowLLMResponse<TParam> = {
        script: parsed.script,
        parameters: parsed.parameters,
    };
    if (typeof parsed.description === "string") {
        const trimmed = parsed.description.trim();
        if (trimmed) out.description = trimmed;
    }
    return out;
}
