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
    const prompt = buildGrammarPrompt(
        integrationName,
        surface,
        phraseSet,
        schemaTs,
    );
    const result = await model.complete(prompt);
    if (!result.success) {
        return { error: `Grammar generation failed: ${result.message}` };
    }

    const grammarContent = extractGrammarContent(result.data);
    const issues = validateGrammar(grammarContent);
    await writeArtifact(
        integrationName,
        "grammarGen",
        "schema.agr",
        grammarContent,
    );

    const issuesNote =
        issues.length === 0
            ? ""
            : `\n\n**Validation warnings (${issues.length}):**\n` +
              issues.map((i) => `- ${i}`).join("\n") +
              `\n\nThese patterns are known to cause grammar compile failures. ` +
              `Use \`refineSchema\` or regenerate the grammar to fix them.`;

    return createActionResultFromMarkdownDisplay(
        `## Grammar generated: ${integrationName}\n\n` +
            "```\n" +
            grammarContent.slice(0, 2000) +
            (grammarContent.length > 2000 ? "\n// ... (truncated)" : "") +
            "\n```\n\n" +
            `Use \`compileGrammar\` to validate, or \`approveGrammar\` if it looks correct.` +
            issuesNote,
    );
}

/**
 * Lightweight pre-flight validator for generated `.agr` content. Checks for
 * the bug patterns observed in the visualStudio onboarding run (2026-05-03):
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
    const grammarPath = path.join(
        getPhasePath(integrationName, "grammarGen"),
        "schema.agr",
    );
    const outputPath = path.join(
        getPhasePath(integrationName, "grammarGen"),
        "schema.ag.json",
    );

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
            error: `Could not copy schema.ts into grammarGen/ for compilation. Ensure schema is approved.`,
        };
    }

    return new Promise((resolve) => {
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
            shell: true,
        });

        let stdout = "";
        let stderr = "";
        proc.stdout?.on("data", (d: Buffer) => {
            stdout += d.toString();
        });
        proc.stderr?.on("data", (d: Buffer) => {
            stderr += d.toString();
        });

        proc.on("close", (code) => {
            if (code === 0) {
                resolve(
                    createActionResultFromMarkdownDisplay(
                        `## Grammar compiled successfully: ${integrationName}\n\n` +
                            `Output: \`schema.ag.json\`\n\n` +
                            (stdout
                                ? `Compiler output:\n\`\`\`\n${stdout}\n\`\`\``
                                : "") +
                            `\n\nUse \`approveGrammar\` to proceed to scaffolding.`,
                    ),
                );
            } else {
                resolve({
                    error:
                        `Grammar compilation failed (exit code ${code}).\n\n` +
                        (stderr || stdout || "No output from compiler.") +
                        `\n\nUse \`generateGrammar\` or \`refineSchema\` to fix the grammar.`,
                });
            }
        });

        proc.on("error", (err) => {
            resolve({
                error: `Failed to run agc: ${err.message}. Is action-grammar-compiler installed?`,
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
                "1. NEVER emit function calls in the action output object. The .agr parser does NOT support `parseInt(x)`, `Number(x)`, `String(x)`, etc. All captured values are STRINGS. If the schema field is typed `number`, just pass the captured string — handler-side code will coerce.\n" +
                "2. Every key in the parameters output object must reference EITHER a captured name (no $-prefix) OR a string literal — never a name that wasn't captured in the same rule's pattern.\n" +
                "3. The captured name in the pattern MUST match the schema field name EXACTLY. If the schema field is `text`, capture `$(text:wildcard)` (NOT `$(searchTerm:wildcard)`). Check the schema before naming captures.\n" +
                "4. Literal phrases in patterns may contain ONLY alphanumeric characters and spaces. Words containing `-`, `:`, `(`, `)`, `/`, `.`, etc. MUST be reworded (e.g. `compiler generated` instead of `compiler-generated`) or split into separate tokens.\n" +
                '5. For schema fields whose type is a string union (e.g. `"text" | "code" | "designer"`), DO NOT use `$(name:wildcard)` — that would accept any value. Instead, capture using an alternation: `$(name:(text|code|designer))`. The capture name MUST equal the schema field name.\n' +
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

function extractGrammarContent(llmResponse: string): string {
    let body = llmResponse.trim();

    // Strip an outer markdown fence (any language tag) before attempting JSON
    // parse. Without this, a response like ```json\n{ "grammar": "..." }\n```
    // fails JSON.parse on the literal backticks.
    const outerFence = body.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```\s*$/);
    if (outerFence) body = outerFence[1].trim();

    try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed.grammar === "string") {
            return parsed.grammar.trim();
        }
    } catch {
        // Fall through to template-literal salvage.
    }

    // Salvage backtick-template-literal style: { "grammar": `...` }.
    const tmplMatch = body.match(/["']?grammar["']?\s*:\s*`([\s\S]*?)`\s*[,}]/);
    if (tmplMatch) return tmplMatch[1].trim();

    // Inner agr fence (no JSON wrapper).
    const agrFence = body.match(/```(?:agr)\s*\n([\s\S]*?)```/);
    if (agrFence) return agrFence[1].trim();

    return body;
}
