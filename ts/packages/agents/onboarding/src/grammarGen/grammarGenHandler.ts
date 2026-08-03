// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Phase 4 — Grammar Generation handler.
// Generates a .agr grammar file from the approved schema and phrase set,
// then compiles it via the action-grammar-compiler (agc) to validate.

import {
    ActionContext,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromMarkdownDisplay } from "@typeagent/agent-sdk/helpers/action";
import { createJsonTranslator } from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { GrammarGenActions } from "./grammarGenSchema.js";
import {
    loadState,
    updatePhase,
    writeArtifact,
    readArtifact,
    readArtifactJson,
    getPhasePath,
} from "../lib/workspace.js";
import { getGrammarGenModel } from "../lib/llm.js";
import { ApiSurface } from "../discovery/discoveryHandler.js";
import { PhraseSet } from "../phraseGen/phraseGenHandler.js";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

export async function executeGrammarGenAction(
    action: TypeAgentAction<GrammarGenActions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "generateGrammar":
            return handleGenerateGrammar(action.parameters.integrationName);
        case "compileGrammar":
            return handleCompileGrammar(action.parameters.integrationName);
        case "approveGrammar":
            return handleApproveGrammar(action.parameters.integrationName);
    }
}

// Bound on the generate -> compile -> repair loop: 1 initial generation plus up
// to (MAX_GRAMMAR_ATTEMPTS - 1) repair passes that feed the exact agc compiler
// error back to the model. Keeps a single flaky LLM grammar from hard-failing
// the phase on the first compile error.
const MAX_GRAMMAR_ATTEMPTS = 4;

// TypeChat response envelope for grammar generation. A valid `{ grammar }` shape
// says nothing about whether the grammar actually compiles — that is what the
// agc compile→repair loop below validates. This type just lets the LLM call go
// through TypeChat (typed extraction + a shape-repair pass) like the rest of the
// codebase, rather than a raw model.complete.
type GrammarGenResponse = { grammar: string };

const GRAMMAR_GEN_RESPONSE_SCHEMA = `export type GrammarGenResponse = {
    // The full .agr grammar file content.
    grammar: string;
};`;

async function handleGenerateGrammar(
    integrationName: string,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) return { error: `Integration "${integrationName}" not found.` };
    if (state.phases.schemaGen.status !== "approved") {
        return {
            error: `Schema phase must be approved first. Run approveSchema.`,
        };
    }

    const surface = await readArtifactJson<ApiSurface>(
        integrationName,
        "discovery",
        "api-surface.json",
    );
    const phraseSet = await readArtifactJson<PhraseSet>(
        integrationName,
        "phraseGen",
        "phrases.json",
    );
    const schemaTs = await readArtifact(
        integrationName,
        "schemaGen",
        "schema.ts",
    );
    if (!surface || !phraseSet || !schemaTs) {
        return {
            error: `Missing required artifacts for "${integrationName}".`,
        };
    }

    await updatePhase(integrationName, "grammarGen", { status: "in-progress" });

    const model = getGrammarGenModel();
    // Route the grammar-gen call through TypeChat for consistency with the rest
    // of the codebase's structured LLM calls: it gives us typed, validated
    // extraction of the `{ grammar }` envelope plus a shape-repair pass. Our
    // prompts already carry the full instructions (including the JSON contract),
    // so suppress TypeChat's default schema-framed request prompt and drive the
    // call entirely from our own prompt sections.
    const validator = createTypeScriptJsonValidator<GrammarGenResponse>(
        GRAMMAR_GEN_RESPONSE_SCHEMA,
        "GrammarGenResponse",
    );
    const translator = createJsonTranslator(model, validator);
    translator.createRequestPrompt = () => "";

    let messages = buildGrammarPrompt(
        integrationName,
        surface,
        phraseSet,
        schemaTs,
    );

    let grammarContent = "";
    let lastOutcome: CompileOutcome | null = null;
    let attempts = 0;

    for (let attempt = 1; attempt <= MAX_GRAMMAR_ATTEMPTS; attempt++) {
        attempts = attempt;
        const result = await translator.translate("", messages);
        if (!result.success) {
            return { error: `Grammar generation failed: ${result.message}` };
        }

        grammarContent = stripUnboundOutputReferences(
            rewriteInlineUnionCaptures(result.data.grammar.trim()),
        );
        await writeArtifact(
            integrationName,
            "grammarGen",
            "schema.agr",
            grammarContent,
        );

        const outcome = await compileGrammarFile(integrationName);
        lastOutcome = outcome;
        if (outcome.ok) break;

        // Feed the EXACT compiler diagnostic back to the model for a targeted
        // repair pass. This is the robustness loop: LLM grammars frequently
        // miscompile (wrong capture types, cross-alternative unbound refs,
        // schema property mismatches) even with a perfect prompt.
        messages = buildGrammarRepairPrompt(
            integrationName,
            schemaTs,
            grammarContent,
            outcome.errorText,
        );
    }

    const issues = validateGrammar(grammarContent);
    const issuesNote =
        issues.length === 0
            ? ""
            : `\n\n**Validation warnings (${issues.length}):**\n` +
              issues.map((i) => `- ${i}`).join("\n");

    if (lastOutcome && lastOutcome.ok) {
        return createActionResultFromMarkdownDisplay(
            `## Grammar generated and compiled: ${integrationName}\n\n` +
                `Compiled successfully after ${attempts} attempt${
                    attempts === 1 ? "" : "s"
                }.\n\n` +
                "```\n" +
                grammarContent.slice(0, 2000) +
                (grammarContent.length > 2000 ? "\n// ... (truncated)" : "") +
                "\n```\n\n" +
                `Use \`approveGrammar\` to proceed to scaffolding.` +
                issuesNote,
        );
    }

    // Exhausted the repair budget — fail the phase with the REAL compiler
    // diagnostic so it is actionable (the silent/headless dispatcher would
    // otherwise mask an undefined result as "Command was cancelled").
    return {
        error:
            `Grammar generation could not produce a compiling grammar for ` +
            `"${integrationName}" after ${attempts} attempt${
                attempts === 1 ? "" : "s"
            }.\n\n` +
            `Last compiler error:\n\`\`\`\n${
                lastOutcome?.errorText ?? "unknown"
            }\n\`\`\`\n\n` +
            `Use \`refineSchema\` to adjust the schema, or re-run ` +
            `\`generateGrammar\`.` +
            issuesNote,
    };
}

/**
 * Rewrite unsupported inline union-type captures to a compilable form.
 *
 * The `.agr` compiler supports `$(name:word)`, `$(name:wildcard)`, and
 * `$(name:<SubRule>)`, but NOT an inline alternation type such as
 * `$(name:(celsius|fahrenheit))` — `agc` rejects it with
 * "Unexpected character '('. Type name expected." The grammar prompt now
 * steers the model toward sub-rules, but LLM output is not guaranteed, so as a
 * deterministic safety net we rewrite any remaining inline-union captures to
 * `$(name:word)`. Union values are single spoken tokens, so `word` compiles and
 * still binds the spoken token to the parameter (the handler coerces/validates).
 */
export function rewriteInlineUnionCaptures(grammarContent: string): string {
    return grammarContent.replace(
        /\$\((\w+)\s*:\s*\([^()]*\)\)/g,
        (_match, name: string) => `$(${name}:word)`,
    );
}

/**
 * Split a `parameters: { ... }` object body into its top-level properties,
 * respecting nesting so commas inside `[...]`, `(...)`, `{...}`, or quotes do
 * not split a property. Used by {@link stripUnboundOutputReferences}.
 */
function splitTopLevelProps(body: string): string[] {
    const props: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let current = "";
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (quote) {
            current += ch;
            if (ch === quote && body[i - 1] !== "\\") quote = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        if (ch === "," && depth === 0) {
            props.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim().length > 0) props.push(current);
    return props;
}

/**
 * Decide whether an output-object property references only captured names (and
 * is therefore safe to keep). A property is one of:
 *   - shorthand `name`                     -> keep iff `name` is captured
 *   - `key: "literal"` / `key: 'literal'`  -> keep (string literal)
 *   - `key: true|false|null|undefined`     -> keep (literal)
 *   - `key: name`                          -> keep iff `name` is captured
 *   - `key: [name]`                        -> keep iff `name` is captured (or a literal)
 * Anything we do not recognize is kept (conservative — never drop what we can't
 * classify).
 */
function outputPropIsBound(
    prop: string,
    captures: ReadonlySet<string>,
): boolean {
    const trimmed = prop.trim();
    if (trimmed.length === 0) return false;

    const colon = trimmed.indexOf(":");
    if (colon < 0) {
        // Shorthand `name` — the key IS the capture reference.
        return /^\w+$/.test(trimmed) ? captures.has(trimmed) : true;
    }

    let value = trimmed.slice(colon + 1).trim();
    // Unwrap a single-element array `[ x ]` — the element is the reference.
    const arr = value.match(/^\[\s*([\s\S]*?)\s*\]$/);
    if (arr) value = arr[1].trim();

    if (value.length === 0) return true;
    // String / template literal, or a boolean/null/undefined literal.
    if (/^["'`]/.test(value)) return true;
    if (
        value === "true" ||
        value === "false" ||
        value === "null" ||
        value === "undefined"
    ) {
        return true;
    }
    // A bare identifier value must be captured; anything else we don't
    // understand is left untouched.
    if (/^\w+$/.test(value)) return captures.has(value);
    return true;
}

/**
 * Collect the capture names bound on every match path — those appearing at
 * least once outside any optional `(...)?` group. A name captured only inside
 * an optional group is conditionally bound, which agc rejects if the output
 * references it, so it is treated here as unbound.
 */
function collectUnconditionalCaptures(patternPart: string): Set<string> {
    // Swap each capture token for a parenthesis-free marker so the remaining
    // parentheses are unambiguously grouping parens.
    const names: string[] = [];
    let work = patternPart.replace(
        /\$\((\w+)\s*:[^)]*\)/g,
        (_full, name: string) => {
            names.push(name);
            return `\uE000${names.length - 1}\uE000`;
        },
    );

    // Reduce innermost groups outward. An optional group drops the markers
    // inside it (conditionally bound); a required group is unwrapped, leaving
    // its markers in place for the surrounding context.
    const groupRe = /\(([^()]*)\)(\?)?/;
    let m: RegExpExecArray | null;
    while ((m = groupRe.exec(work)) !== null) {
        const inner = m[1];
        const optional = m[2] === "?";
        const replacement = optional
            ? inner.replace(/\uE000\d+\uE000/g, " ")
            : inner;
        work =
            work.slice(0, m.index) +
            replacement +
            work.slice(m.index + m[0].length);
    }

    const captures = new Set<string>();
    for (const mk of work.matchAll(/\uE000(\d+)\uE000/g)) {
        captures.add(names[Number(mk[1])]);
    }
    return captures;
}

/**
 * Deterministically drop output-object properties that reference a name the
 * rule's pattern does not bind on every match path. LLM grammars frequently
 * list a schema's OPTIONAL fields in the `parameters` object without binding
 * them unconditionally — either not capturing them at all, or capturing them
 * only inside an optional `(...)?` group. agc rejects both with "Variable X
 * referenced in the value but not defined in the rule". Optional fields are
 * safe to omit, so the unbound references are stripped here rather than
 * spending repair-loop attempts on them; a genuinely required field is
 * re-driven by the compiler's "missing property" diagnostic on the next pass.
 */
export function stripUnboundOutputReferences(grammarContent: string): string {
    const ruleRegex = /(<\w+>\s*[:=][\s\S]*?;)/g;
    return grammarContent.replace(ruleRegex, (block) => {
        const arrowIdx = block.indexOf("->");
        if (arrowIdx < 0) return block;
        const patternPart = block.slice(0, arrowIdx);

        const captures = collectUnconditionalCaptures(patternPart);

        return block.replace(
            /parameters\s*:\s*\{([\s\S]*?)\}/g,
            (full, body: string) => {
                const kept = splitTopLevelProps(body)
                    .map((p) => p.trim())
                    .filter((p) => p.length > 0)
                    .filter((p) => outputPropIsBound(p, captures));
                if (kept.length === 0) return "parameters: {}";
                return (
                    "parameters: {\n" +
                    kept.map((p) => "                " + p).join(",\n") +
                    "\n            }"
                );
            },
        );
    });
}

/**
 * Lightweight pre-flight validator for generated `.agr` content. Checks for
 * grammar patterns that are known to cause compile failures:
 *   - function calls in output objects (e.g. `parseInt(line)`)
 *   - output keys referencing captures that weren't bound in the rule pattern
 *   - dashes/special chars in literal phrases
 *   - first rule emitting a literal string where a capture ref was intended
 *
 * Each issue is returned as a human-readable line. The caller decides how
 * to surface them (currently rendered as warnings in the action result).
 */
export function validateGrammar(grammarContent: string): string[] {
    const issues: string[] = [];

    // Split the content into top-level rule blocks. A rule block starts with
    // `<Name>` at column 0 (whitespace allowed) and ends with the next `;`
    // outside of a quoted string. We only need a coarse split to scan
    // captures-vs-references, so a regex-based extractor is sufficient.
    const ruleRegex = /(<\w+>\s*[:=][\s\S]*?;)/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRegex.exec(grammarContent)) !== null) {
        const block = m[1];
        const ruleNameMatch = block.match(/^<(\w+)>/);
        const ruleName = ruleNameMatch ? ruleNameMatch[1] : "<unknown>";

        // Captured names live in the pattern part (left of `->`); output
        // object lives on the right.
        const arrowIdx = block.indexOf("->");
        if (arrowIdx < 0) continue;
        const patternPart = block.slice(0, arrowIdx);
        const outputPart = block.slice(arrowIdx + 2);

        // 1. function calls inside output objects (e.g. parseInt(line)). The
        //    .agr parser only supports literals and bare capture references,
        //    so any `name(args)` inside the output block is a bug.
        const fnCallMatch = outputPart.match(/\b([A-Za-z_]\w*)\s*\([^)]*\)/g);
        if (fnCallMatch) {
            for (const call of fnCallMatch) {
                issues.push(
                    `<${ruleName}>: function call "${call}" in output object — ` +
                        `the .agr parser only supports string captures.`,
                );
            }
        }

        const captures = new Set<string>();
        const capRegex = /\$\((\w+)\s*:[^)]*\)/g;
        let c: RegExpExecArray | null;
        while ((c = capRegex.exec(patternPart)) !== null) {
            captures.add(c[1]);
        }

        // 3. Bare-identifier references inside the parameters object that
        //    were never captured. A bare reference looks like `name,` or
        //    `name }` or `key: name` (RHS) where `name` is unquoted.
        const paramsMatch = outputPart.match(/parameters\s*:\s*\{([\s\S]*?)\}/);
        if (paramsMatch) {
            const paramsBody = paramsMatch[1];
            // RHS bare identifiers: after `: ` not in quotes, and not a
            // boolean/numeric literal or array literal.
            const rhsRegex = /:\s*([A-Za-z_]\w*)(?=\s*[,}\n])/g;
            let r: RegExpExecArray | null;
            while ((r = rhsRegex.exec(paramsBody)) !== null) {
                const ident = r[1];
                if (
                    ident === "true" ||
                    ident === "false" ||
                    ident === "null" ||
                    ident === "undefined"
                )
                    continue;
                if (!captures.has(ident)) {
                    issues.push(
                        `<${ruleName}>: parameters references "${ident}" but ` +
                            `that name was not captured in the rule's pattern.`,
                    );
                }
            }
            // Object-property shorthand: `{ name, foo }` — name must be captured.
            const shorthandRegex =
                /(?:^|[{,]\s*\n?\s*)([A-Za-z_]\w*)(?=\s*[,}\n])/g;
            let s: RegExpExecArray | null;
            while ((s = shorthandRegex.exec(paramsBody)) !== null) {
                const ident = s[1];
                // Skip if this is the LHS of a `key: value` pair (handled by
                // a different check) — detect by looking ahead for `:`.
                const tail = paramsBody.slice(s.index + s[0].length);
                if (/^\s*:/.test(tail)) continue;
                if (!captures.has(ident)) {
                    issues.push(
                        `<${ruleName}>: parameters shorthand references "${ident}" ` +
                            `but that name was not captured in the rule's pattern.`,
                    );
                }
            }
        }

        // 4. Literal phrases containing characters that need escaping. Look
        //    for words in the pattern that contain `-`, `:`, `(`, `)`, `/`,
        //    `.` outside of capture syntax `$(...)` and group syntax `(...)`.
        // Strip out captures and parenthesized groups before scanning.
        const scrub = patternPart
            .replace(/\$\([^)]*\)/g, " ")
            .replace(/\([^)]*\)\??/g, " ");
        const badLiteralRegex = /\b[A-Za-z0-9]*[-:/.][\w\-:/.]*\b/g;
        let bl: RegExpExecArray | null;
        while ((bl = badLiteralRegex.exec(scrub)) !== null) {
            issues.push(
                `<${ruleName}>: literal phrase "${bl[0]}" contains a special character ` +
                    `(- : / .) — reword or split into separate tokens.`,
            );
        }

        // 5. Literal-quoted self-reference: e.g. `commandName: "commandName"`
        //    when `commandName` was captured. Almost always a mistake.
        if (paramsMatch) {
            const selfLit = /(\w+)\s*:\s*"\1"/g;
            let q: RegExpExecArray | null;
            while ((q = selfLit.exec(paramsMatch[1])) !== null) {
                if (captures.has(q[1])) {
                    issues.push(
                        `<${ruleName}>: "${q[1]}: \"${q[1]}\"" looks like a missing ` +
                            `capture reference — drop the quotes to reference the capture.`,
                    );
                }
            }
        }
    }

    return issues;
}

async function handleCompileGrammar(
    integrationName: string,
): Promise<ActionResult> {
    const grammarContent = await readArtifact(
        integrationName,
        "grammarGen",
        "schema.agr",
    );
    if (!grammarContent) {
        return {
            error: `No grammar file found for "${integrationName}". Run generateGrammar first.`,
        };
    }

    const outcome = await compileGrammarFile(integrationName);
    if (outcome.ok) {
        return createActionResultFromMarkdownDisplay(
            `## Grammar compiled successfully: ${integrationName}\n\n` +
                `Output: \`schema.ag.json\`\n\n` +
                (outcome.stdout
                    ? `Compiler output:\n\`\`\`\n${outcome.stdout}\n\`\`\``
                    : "") +
                `\n\nUse \`approveGrammar\` to proceed to scaffolding.`,
        );
    }
    return {
        error:
            `Grammar compilation failed${
                outcome.code !== null ? ` (exit code ${outcome.code})` : ""
            }.\n\n` +
            outcome.errorText +
            `\n\nUse \`generateGrammar\` or \`refineSchema\` to fix the grammar.`,
    };
}

/** Result of invoking the action-grammar-compiler (agc) on schema.agr. */
type CompileOutcome = {
    ok: boolean;
    /** Process exit code, or null if agc could not be spawned. */
    code: number | null;
    stdout: string;
    stderr: string;
    /** Best single diagnostic string (stderr, else stdout). */
    errorText: string;
};

/**
 * Compile the on-disk schema.agr for an integration via agc, returning a plain
 * data outcome (never throws). Copies the approved schema.ts into grammarGen/
 * first so the grammar's `import` resolves. Shared by handleCompileGrammar and
 * the generate->compile->repair loop in handleGenerateGrammar.
 */
async function compileGrammarFile(
    integrationName: string,
): Promise<CompileOutcome> {
    const grammarPath = path.join(
        getPhasePath(integrationName, "grammarGen"),
        "schema.agr",
    );
    const outputPath = path.join(
        getPhasePath(integrationName, "grammarGen"),
        "schema.ag.json",
    );

    // Copy the schema .ts file into grammarGen/ so the agr import resolves
    const schemaSrc = path.join(
        getPhasePath(integrationName, "schemaGen"),
        "schema.ts",
    );
    const schemaDst = path.join(
        getPhasePath(integrationName, "grammarGen"),
        "schema.ts",
    );
    try {
        await fs.copyFile(schemaSrc, schemaDst);
    } catch {
        return {
            ok: false,
            code: null,
            stdout: "",
            stderr: "",
            errorText:
                "Could not copy schema.ts into grammarGen/ for compilation. Ensure schema is approved.",
        };
    }

    return new Promise<CompileOutcome>((resolve) => {
        // Resolve agc from the package's own node_modules/.bin
        const pkgDir = path.resolve(
            fileURLToPath(import.meta.url),
            "..",
            "..",
            "..",
        );
        const binDir = path.join(pkgDir, "node_modules", ".bin");
        const env = {
            ...process.env,
            PATH: binDir + path.delimiter + (process.env.PATH ?? ""),
        };

        const proc = spawn("agc", ["-i", grammarPath, "-o", outputPath], {
            stdio: ["ignore", "pipe", "pipe"],
            env,
            windowsHide: true,
            shell: true,
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (outcome: CompileOutcome) => {
            if (settled) return;
            settled = true;
            resolve(outcome);
        };
        const finishWithCode = (code: number | null) =>
            finish({
                ok: code === 0,
                code,
                stdout,
                stderr,
                errorText: (
                    stderr ||
                    stdout ||
                    "No output from compiler."
                ).trim(),
            });

        proc.stdout?.on("data", (d: Buffer) => {
            stdout += d.toString();
        });
        proc.stderr?.on("data", (d: Buffer) => {
            stderr += d.toString();
        });

        // Fast path: stdout/stderr fully flushed and pipes closed cleanly.
        proc.on("close", (code) => finishWithCode(code));

        // Safety net: `agc` runs through a shell on Windows, so a grandchild can
        // inherit and hold the stdout/stderr pipes open after the process itself
        // has exited — in which case `"close"` never fires and this compile would
        // hang forever (wedging the whole GrammarGen phase). Resolve on `"exit"`
        // after a brief grace period for any trailing `"close"`.
        proc.on("exit", (code) => {
            setTimeout(() => finishWithCode(code), 500);
        });

        proc.on("error", (err) => {
            finish({
                ok: false,
                code: null,
                stdout: "",
                stderr: err.message,
                errorText: `Failed to run agc: ${err.message}. Is action-grammar-compiler installed?`,
            });
        });
    });
}

async function handleApproveGrammar(
    integrationName: string,
): Promise<ActionResult> {
    const grammar = await readArtifact(
        integrationName,
        "grammarGen",
        "schema.agr",
    );
    if (!grammar) {
        return {
            error: `No grammar found for "${integrationName}". Run generateGrammar first.`,
        };
    }

    await updatePhase(integrationName, "grammarGen", { status: "approved" });

    return createActionResultFromMarkdownDisplay(
        `## Grammar approved: ${integrationName}\n\n` +
            `**Next step:** Phase 5 — use \`scaffoldAgent\` to create the agent package.`,
    );
}

function buildGrammarPrompt(
    integrationName: string,
    surface: ApiSurface,
    phraseSet: PhraseSet,
    schemaTs: string,
): { role: "system" | "user"; content: string }[] {
    const actionExamples = surface.actions
        .map((a) => {
            const phrases = phraseSet.phrases[a.name] ?? [];
            return `Action: ${a.name}\nPhrases:\n${phrases
                .slice(0, 4)
                .map((p) => `  - "${p}"`)
                .join("\n")}`;
        })
        .join("\n\n");

    return [
        {
            role: "system",
            content:
                "You are an expert in TypeAgent grammar files (.agr format). " +
                "Grammar rules use this syntax:\n" +
                '  <RuleName> = pattern -> { actionName: "name", parameters: { ... } }\n' +
                "  | alternative -> { ... };\n\n" +
                "Pattern syntax:\n" +
                "  - $(paramName:wildcard) captures 1+ words into a variable\n" +
                "  - $(paramName:word) captures exactly 1 word into a variable\n" +
                "  - (optional)? makes tokens optional\n" +
                "  - word matches a literal word\n" +
                "  - | separates alternatives\n\n" +
                "IMPORTANT: In the action output object after ->, reference captured parameters by BARE NAME only, NOT with $() syntax.\n" +
                "Example:\n" +
                "  <AddItems> = add $(item:wildcard) to (the)? $(listName:wildcard) list -> {\n" +
                '    actionName: "addItems",\n' +
                "    parameters: {\n" +
                "        items: [item],\n" +
                "        listName\n" +
                "    }\n" +
                "  };\n\n" +
                "The action output must use multi-line format with proper indentation as shown above.\n\n" +
                "STRICT RULES — violations cause compile failures:\n" +
                "1. NEVER emit function calls, method calls, or expressions in the action output object. The .agr parser does NOT support `parseInt(x)`, `Number(x)`, `String(x)`, `x.split(',')`, ternaries (`x ? a : b`), arithmetic, or ANY code — only bare capture references, string literals, and single-element arrays `[capture]`. For a schema field typed `number`, capture it with the numeric capture type `$(name:number)` (matches a numeric token like `68` or `3`) and reference it by bare name — the compiler type-checks captures against the schema, so a `wildcard`/`word` (string) capture bound to a `number` field FAILS to compile. Do NOT coerce; use `$(name:number)`. For a field typed as an array (e.g. `string[]`), wrap a single capture in brackets: `items: [item]` — do NOT split a captured string into multiple elements.\n" +
                "2. Every key in the parameters output object must reference EITHER a captured name (no $-prefix) OR a string literal — never a name that wasn't captured in the same rule's pattern.\n" +
                "3. The captured name in the pattern MUST match the schema field name EXACTLY. If the schema field is `text`, capture `$(text:wildcard)` (NOT `$(searchTerm:wildcard)`). Check the schema before naming captures.\n" +
                "4. Literal phrases in patterns may contain ONLY alphanumeric characters and spaces. Words containing `-`, `:`, `(`, `)`, `/`, `.`, etc. MUST be reworded (e.g. `compiler generated` instead of `compiler-generated`) or split into separate tokens.\n" +
                '5. For schema fields whose type is a string union (e.g. `"text" | "code" | "designer"`), DO NOT use `$(name:wildcard)` (accepts any value) and DO NOT use an inline alternation type like `$(name:(text|code|designer))` — the compiler does NOT support inline union types (it fails with "Type name expected"). Instead, define a sub-rule that maps each spoken literal to its canonical value, then reference the sub-rule by name:\n' +
                "     <Mode> = 'text' -> \"text\" | 'code' -> \"code\" | 'designer' -> \"designer\";\n" +
                "   and capture with `$(name:<Mode>)`. The capture name MUST equal the schema field name; the sub-rule name is your choice (e.g. `<Mode>`).\n" +
                '6. Every literal value in the output object must be a string in double quotes. NEVER write `commandName: "commandName"` when you intended a capture reference — that emits the literal string. Use `commandName` (bare, no quotes) to reference the capture.\n' +
                "7. If a rule has no capture for a field, do NOT include that field in the output object — omit it entirely.\n\n" +
                "The file must start with a copyright header comment and end with:\n" +
                '  import { ActionType } from "./schemaFile.ts";\n' +
                "  <Start> : ActionType = <Rule1> | <Rule2> | ...;\n\n" +
                "Respond in JSON format. Return a JSON object with a single `grammar` key containing the .agr file content as a string.",
        },
        {
            role: "user",
            content:
                `Generate a TypeAgent .agr grammar file for the "${integrationName}" integration.\n\n` +
                `TypeScript schema:\n\`\`\`typescript\n${schemaTs.slice(0, 3000)}\n\`\`\`\n\n` +
                `Sample phrases for each action:\n${actionExamples}\n\n` +
                `The schema file will be imported as "./schema.ts". The entry type is the main union type from the schema.`,
        },
    ];
}

function buildGrammarRepairPrompt(
    integrationName: string,
    schemaTs: string,
    failingGrammar: string,
    compilerError: string,
): { role: "system" | "user"; content: string }[] {
    return [
        {
            role: "system",
            content:
                "You are an expert in TypeAgent grammar files (.agr format), fixing a grammar that FAILED to compile.\n" +
                'Grammar rules use: `<RuleName> = pattern -> { actionName: "name", parameters: { ... } } | alt -> { ... };`\n' +
                "Capture types: $(name:word) one word, $(name:wildcard) 1+ words, $(name:number) a numeric token, $(name:<SubRule>) a named sub-rule. In the output object reference captures by BARE name (no $()).\n" +
                "Return ONLY corrected grammar as JSON: an object with a single `grammar` key whose value is the full .agr file content as a string.",
        },
        {
            role: "user",
            content:
                `The .agr grammar you generated for the "${integrationName}" integration FAILED to compile.\n\n` +
                `TypeScript schema — every output object must satisfy these types EXACTLY (all required fields present, no extras):\n` +
                "```typescript\n" +
                schemaTs.slice(0, 3000) +
                "\n```\n\n" +
                `The grammar that failed to compile:\n` +
                "```\n" +
                failingGrammar.slice(0, 4000) +
                "\n```\n\n" +
                `The action-grammar-compiler (agc) reported:\n` +
                "```\n" +
                compilerError.slice(0, 2000) +
                "\n```\n\n" +
                `Fix ONLY what the compiler requires while preserving the same phrase coverage. Common causes and the required fix:\n` +
                `- function call / ternary / expression in the output (e.g. parseInt(x), x.split(','), x ? a : b): the .agr parser supports ONLY bare capture references, string literals, and single-element arrays [capture] — NO code. Remove all of them: for a number field use $(name:number); for an array field use [capture]; drop any field you cannot express this way.\n` +
                `- "expected number, got string": the schema field is a number — capture it with $(name:number) (matches a numeric token like 68), NOT $(name:wildcard)/$(name:word).\n` +
                `- "Variable X referenced ... but not defined" (a.k.a. not defined in rule): every name used in an alternative's parameters output MUST be captured in THAT SAME alternative's pattern. Either capture it there, drop it from that alternative's output, or split into separate rules so each alternative only outputs what it captures.\n` +
                `- "Type name expected" near $(name:(a|b)): inline union types are unsupported — define a named sub-rule (e.g. <Mode> = 'a' -> "a" | 'b' -> "b";) and capture with $(name:<Mode>).\n` +
                `- extraneous/missing property: include exactly the schema's required fields in the output object — no extras, none missing.\n` +
                `- literal phrases may contain only alphanumerics and spaces — reword tokens with - : / . etc.\n\n` +
                `Return the corrected full grammar in the JSON format described above.`,
        },
    ];
}
