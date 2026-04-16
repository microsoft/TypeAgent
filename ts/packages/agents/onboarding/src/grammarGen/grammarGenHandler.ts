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
    await writeArtifact(
        integrationName,
        "grammarGen",
        "schema.agr",
        grammarContent,
    );

    return createActionResultFromMarkdownDisplay(
        `## Grammar generated: ${integrationName}\n\n` +
            "```\n" +
            grammarContent.slice(0, 2000) +
            (grammarContent.length > 2000 ? "\n// ... (truncated)" : "") +
            "\n```\n\n" +
            `Use \`compileGrammar\` to validate, or \`approveGrammar\` if it looks correct.`,
    );
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
                "The action output must use multi-line format with proper indentation as shown above.\n" +
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
    // Try to parse as JSON first (when using json_object response format)
    try {
        const parsed = JSON.parse(llmResponse);
        if (parsed.grammar) return parsed.grammar.trim();
    } catch {
        // Not JSON, fall through to other extraction methods
    }
    const fenceMatch = llmResponse.match(/```(?:agr)?\n([\s\S]*?)```/);
    if (fenceMatch) return fenceMatch[1].trim();
    return llmResponse.trim();
}
