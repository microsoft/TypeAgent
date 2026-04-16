// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Phase 3 — Schema Generation handler.
// Uses the approved API surface and generated phrases to produce a
// TypeScript action schema file with appropriate comments.

import {
    ActionContext,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import { createActionResultFromMarkdownDisplay } from "@typeagent/agent-sdk/helpers/action";
import { SchemaGenActions } from "./schemaGenSchema.js";
import {
    loadState,
    updatePhase,
    writeArtifact,
    readArtifact,
    readArtifactJson,
} from "../lib/workspace.js";
import { getSchemaGenModel } from "../lib/llm.js";
import { ApiSurface } from "../discovery/discoveryHandler.js";
import { PhraseSet } from "../phraseGen/phraseGenHandler.js";

// Shared schema authoring guidelines injected into every schema gen/refine prompt.
const SCHEMA_GUIDELINES = `
COMMENT STRUCTURE RULES:
1. Action-level block (above the action type declaration): use only for a short "what it does" description and example user/agent phrase pairs. No rules or constraints here.
2. Property-level comments (inside the parameters object, above each property declaration): ALL guidance lives here, co-located with the property it constrains. Do NOT put constraints at the action level.
3. No inline end-of-line comments on property declarations. All commentary goes in the line(s) above the property.

PROPERTY COMMENT ORDERING (top = least important, bottom = most important — the LLM reads top-to-bottom, so put the critical constraint last, immediately before the property):
// General description of what this parameter is.
// Supplementary guidance / common aliases / optional tips.
// NOTE: or IMPORTANT: The hard constraint the model must not violate.
propertyName: type;

CRITICAL CONSTRAINT FORMAT — embed a concrete WRONG/RIGHT example for any hard constraint; the WRONG case should be the exact failure mode you have observed:
// The data range in A1 notation.
// NOTE: Must be a literal cell range — do NOT use named ranges or structured references.
//   WRONG: "SalesData[ActualSales]"  ← structured table reference, will fail
//   WRONG: "ActualSales"             ← column name, will fail
//   RIGHT: "C1:C7"                  ← literal A1 range
dataRange: string;

BEST PRACTICES:
- Enum-like properties: always define the type as an explicit union of string literals instead of \`string\`. The comment above the property should name the underlying API enum it maps to and explain the default value and why.
  Example:
  // Label position relative to the data point. Maps to Office.js ChartDataLabelPosition enum.
  // Default is "BestFit" — Office.js automatically chooses the best placement.
  position?: "Top" | "Bottom" | "Center" | "InsideEnd" | "InsideBase" | "OutsideEnd" | "Left" | "Right" | "BestFit" | "Callout" | "None";
`;

export async function executeSchemaGenAction(
    action: TypeAgentAction<SchemaGenActions>,
    _context: ActionContext<unknown>,
): Promise<ActionResult> {
    switch (action.actionName) {
        case "generateSchema":
            return handleGenerateSchema(action.parameters.integrationName);

        case "refineSchema":
            return handleRefineSchema(
                action.parameters.integrationName,
                action.parameters.instructions,
            );

        case "approveSchema":
            return handleApproveSchema(action.parameters.integrationName);
    }
}

async function handleGenerateSchema(
    integrationName: string,
): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) return { error: `Integration "${integrationName}" not found.` };
    if (state.phases.discovery.status !== "approved") {
        return {
            error: `Discovery phase must be approved first. Run approveApiSurface.`,
        };
    }

    const surface = await readArtifactJson<ApiSurface>(
        integrationName,
        "discovery",
        "api-surface.json",
    );
    if (!surface) {
        return {
            error: `Missing discovery artifact for "${integrationName}".`,
        };
    }
    // phraseSet is optional — we can still generate a schema without sample phrases
    const phraseSet = await readArtifactJson<PhraseSet>(
        integrationName,
        "phraseGen",
        "phrases.json",
    );

    await updatePhase(integrationName, "schemaGen", { status: "in-progress" });

    const model = getSchemaGenModel();
    const prompt = buildSchemaPrompt(
        integrationName,
        surface,
        phraseSet ?? null,
        state.config.description,
    );
    const result = await model.complete(prompt);
    if (!result.success) {
        return { error: `Schema generation failed: ${result.message}` };
    }

    const schemaTs = extractTypeScript(result.data);
    await writeArtifact(integrationName, "schemaGen", "schema.ts", schemaTs);

    return createActionResultFromMarkdownDisplay(
        `## Schema generated: ${integrationName}\n\n` +
            "```typescript\n" +
            schemaTs.slice(0, 2000) +
            (schemaTs.length > 2000 ? "\n// ... (truncated)" : "") +
            "\n```\n\n" +
            `Use \`refineSchema\` to adjust, or \`approveSchema\` to proceed to grammar generation.`,
    );
}

async function handleRefineSchema(
    integrationName: string,
    instructions: string,
): Promise<ActionResult> {
    const existing = await readArtifact(
        integrationName,
        "schemaGen",
        "schema.ts",
    );
    if (!existing) {
        return {
            error: `No schema found for "${integrationName}". Run generateSchema first.`,
        };
    }

    const model = getSchemaGenModel();
    const prompt = [
        {
            role: "system" as const,
            content:
                "You are a TypeScript expert. Modify the given TypeAgent action schema according to the instructions. " +
                "Preserve all copyright headers and existing structure.\n" +
                SCHEMA_GUIDELINES +
                "Respond in JSON format. Return a JSON object with a single `schema` key containing the updated TypeScript file content as a string.",
        },
        {
            role: "user" as const,
            content:
                `Refine this TypeAgent action schema for "${integrationName}".\n\n` +
                `Instructions: ${instructions}\n\n` +
                `Current schema:\n\`\`\`typescript\n${existing}\n\`\`\``,
        },
    ];

    const result = await model.complete(prompt);
    if (!result.success) {
        return { error: `Schema refinement failed: ${result.message}` };
    }

    const refined = extractTypeScript(result.data);
    // Archive the previous version
    const version = Date.now();
    await writeArtifact(
        integrationName,
        "schemaGen",
        `schema.v${version}.ts`,
        existing,
    );
    await writeArtifact(integrationName, "schemaGen", "schema.ts", refined);

    return createActionResultFromMarkdownDisplay(
        `## Schema refined: ${integrationName}\n\n` +
            `Previous version archived as \`schema.v${version}.ts\`\n\n` +
            "```typescript\n" +
            refined.slice(0, 2000) +
            (refined.length > 2000 ? "\n// ... (truncated)" : "") +
            "\n```",
    );
}

async function handleApproveSchema(
    integrationName: string,
): Promise<ActionResult> {
    const schema = await readArtifact(
        integrationName,
        "schemaGen",
        "schema.ts",
    );
    if (!schema) {
        return {
            error: `No schema found for "${integrationName}". Run generateSchema first.`,
        };
    }

    await updatePhase(integrationName, "schemaGen", { status: "approved" });

    return createActionResultFromMarkdownDisplay(
        `## Schema approved: ${integrationName}\n\n` +
            `Schema saved to \`~/.typeagent/onboarding/${integrationName}/schemaGen/schema.ts\`\n\n` +
            `**Next step:** Phase 4 — use \`generateGrammar\` to produce the .agr grammar file.`,
    );
}

function buildSchemaPrompt(
    integrationName: string,
    surface: ApiSurface,
    phraseSet: PhraseSet | null,
    description?: string,
): { role: "system" | "user"; content: string }[] {
    const actionSummary = surface.actions
        .map((a) => {
            const phrases = phraseSet?.phrases[a.name] ?? [];
            return (
                `Action: ${a.name}\n` +
                `Description: ${a.description}\n` +
                (a.parameters?.length
                    ? `Parameters: ${a.parameters.map((p) => `${p.name}: ${p.type}${p.required ? "" : "?"}`).join(", ")}\n`
                    : "") +
                (phrases.length
                    ? `Sample phrases:\n${phrases
                          .slice(0, 3)
                          .map((p) => `  - "${p}"`)
                          .join("\n")}`
                    : "")
            );
        })
        .join("\n\n");

    return [
        {
            role: "system",
            content:
                "You are a TypeScript expert generating TypeAgent action schemas. " +
                "TypeAgent action schemas are TypeScript union types where each member has an `actionName` discriminant and a `parameters` object. " +
                "Follow these file-level conventions:\n" +
                "- Start the file with:\n  // Copyright (c) Microsoft Corporation.\n  // Licensed under the MIT License.\n" +
                "- Export a top-level union type named `<IntegrationPascalCase>Actions`\n" +
                "- Each action type is named `<ActionPascalCase>Action`\n" +
                '- Use `actionName: "camelCaseName"` as a string literal type\n' +
                "- Parameters use camelCase names\n" +
                "- Optional parameters use `?: type` syntax\n" +
                SCHEMA_GUIDELINES +
                "Respond in JSON format. Return a JSON object with a single `schema` key containing the TypeScript file content as a string.",
        },
        {
            role: "user",
            content:
                `Generate a TypeAgent action schema for the "${integrationName}" integration` +
                (description ? ` (${description})` : "") +
                `.\n\n` +
                `Actions to include:\n\n${actionSummary}`,
        },
    ];
}

function extractTypeScript(llmResponse: string): string {
    // Try to parse as JSON first (when using json_object response format)
    try {
        const parsed = JSON.parse(llmResponse);
        if (parsed.schema) return parsed.schema.trim();
    } catch {
        // Not JSON, fall through to other extraction methods
    }
    // Strip markdown code fences if present
    const fenceMatch = llmResponse.match(
        /```(?:typescript|ts)?\n([\s\S]*?)```/,
    );
    if (fenceMatch) return fenceMatch[1].trim();
    return llmResponse.trim();
}
