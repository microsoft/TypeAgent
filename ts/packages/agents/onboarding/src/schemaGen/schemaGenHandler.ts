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
1. All commentary lives ABOVE the thing it applies to, on its own line(s). No inline end-of-line comments on property declarations.
2. Action-level block (above the action type declaration): user/agent example pairs, IMPORTANT/NOTE rules, then a one-sentence "what it does" description directly above the type.
3. Property-level comments (above each property): supplementary guidance and any IMPORTANT/NOTE rules, then a one-sentence identity line directly above the property.

THE IDENTITY LINE IS CLOSEST TO THE DECLARATION. Readers (human and LLM) always need the "what is this" answer first. Put the one-sentence identity line immediately above the type or property. Everything else — examples, IMPORTANT constraints, aliases, context — goes above that identity line. Broader context furthest away, specific rules closer.

PROPERTY COMMENT ORDERING (top = broadest context, bottom = identity — the LLM reads top-to-bottom, then locks onto the identity line as it reaches the declaration):
// Supplementary guidance / common aliases / optional tips.
// NOTE: or IMPORTANT: The hard constraint the model must not violate.
// One-sentence identity — what this parameter is.
propertyName: type;

CRITICAL CONSTRAINT FORMAT — embed a concrete WRONG/RIGHT example for any hard constraint; the WRONG case should be the exact failure mode you have observed. Put it ABOVE the identity line, not below:
// NOTE: Must be a literal cell range — do NOT use named ranges or structured references.
//   WRONG: "SalesData[ActualSales]"  ← structured table reference, will fail
//   WRONG: "ActualSales"             ← column name, will fail
//   RIGHT: "C1:C7"                  ← literal A1 range
// The data range in A1 notation.
dataRange: string;

SCHEMA SHAPE — WORK WITH THE LLM'S INTENT, NOT AGAINST IT:
When the LLM keeps picking the "wrong" action for a class of queries, the fix is almost always to widen the right action so it can absorb the intent, not to scold the LLM away from the wrong one. Anti-examples ("DO NOT use this for …") fight priors and rarely hold; positive parameters channel priors.

- Shape the schema into the form the LLM wants to produce. Expand parameters along the direction the LLM is already reaching.
- Where the action truly cannot deliver on a request, have the handler detect that deterministically and escalate to the reasoning loop — don't rely on the LLM to have read a prohibition.
- Anti-examples are a last resort. Only add a "DO NOT use for" line when (1) you've already expanded the schema to absorb the intent where possible, and (2) the handler cannot detect the bad case at runtime. Most of the time, one of those two isn't met yet — so fix that first. An anti-example the LLM never reads is free entropy in the prompt.
- Never lift sheet names, column names, cell ranges, or exact phrasing from real user queries or benchmark data into schema examples — doing so overfits the schema. Use generic placeholders (SalesData, Profit, Inventory, Category, Stock).

BEST PRACTICES:
- Enum-like properties: always define the type as an explicit union of string literals instead of \`string\`. The identity line should name the underlying API enum it maps to and explain the default value and why (supplementary context, if needed, goes above the identity line).
  Example:
  // Default is "BestFit" — Office.js automatically chooses the best placement.
  // Label position relative to the data point. Maps to Office.js ChartDataLabelPosition enum.
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
