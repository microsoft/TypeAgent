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
import {
    createActionResultFromTextDisplay,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
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

async function handleGenerateSchema(integrationName: string): Promise<ActionResult> {
    const state = await loadState(integrationName);
    if (!state) return { error: `Integration "${integrationName}" not found.` };
    if (state.phases.phraseGen.status !== "approved") {
        return { error: `Phrase generation phase must be approved first. Run approvePhrases.` };
    }

    const surface = await readArtifactJson<ApiSurface>(integrationName, "discovery", "api-surface.json");
    const phraseSet = await readArtifactJson<PhraseSet>(integrationName, "phraseGen", "phrases.json");
    if (!surface || !phraseSet) {
        return { error: `Missing discovery or phrase artifacts for "${integrationName}".` };
    }

    await updatePhase(integrationName, "schemaGen", { status: "in-progress" });

    const model = getSchemaGenModel();
    const prompt = buildSchemaPrompt(integrationName, surface, phraseSet, state.config.description);
    const result = await model.complete(prompt);
    if (!result.success) {
        return { error: `Schema generation failed: ${result.message}` };
    }

    const schemaTs = extractTypeScript(result.data);
    await writeArtifact(integrationName, "schemaGen", "schema.ts", schemaTs);

    return createActionResultFromMarkdownDisplay(
        `## Schema generated: ${integrationName}\n\n` +
            "```typescript\n" + schemaTs.slice(0, 2000) + (schemaTs.length > 2000 ? "\n// ... (truncated)" : "") + "\n```\n\n" +
            `Use \`refineSchema\` to adjust, or \`approveSchema\` to proceed to grammar generation.`,
    );
}

async function handleRefineSchema(
    integrationName: string,
    instructions: string,
): Promise<ActionResult> {
    const existing = await readArtifact(integrationName, "schemaGen", "schema.ts");
    if (!existing) {
        return { error: `No schema found for "${integrationName}". Run generateSchema first.` };
    }

    const model = getSchemaGenModel();
    const prompt = [
        {
            role: "system" as const,
            content:
                "You are a TypeScript expert. Modify the given TypeAgent action schema according to the instructions. " +
                "Preserve all copyright headers and existing structure. Return only the updated TypeScript file content.",
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
    await writeArtifact(integrationName, "schemaGen", `schema.v${version}.ts`, existing);
    await writeArtifact(integrationName, "schemaGen", "schema.ts", refined);

    return createActionResultFromMarkdownDisplay(
        `## Schema refined: ${integrationName}\n\n` +
            `Previous version archived as \`schema.v${version}.ts\`\n\n` +
            "```typescript\n" + refined.slice(0, 2000) + (refined.length > 2000 ? "\n// ... (truncated)" : "") + "\n```",
    );
}

async function handleApproveSchema(integrationName: string): Promise<ActionResult> {
    const schema = await readArtifact(integrationName, "schemaGen", "schema.ts");
    if (!schema) {
        return { error: `No schema found for "${integrationName}". Run generateSchema first.` };
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
    phraseSet: PhraseSet,
    description?: string,
): { role: "system" | "user"; content: string }[] {
    const actionSummary = surface.actions
        .map((a) => {
            const phrases = phraseSet.phrases[a.name] ?? [];
            return (
                `Action: ${a.name}\n` +
                `Description: ${a.description}\n` +
                (a.parameters?.length
                    ? `Parameters: ${a.parameters.map((p) => `${p.name}: ${p.type}${p.required ? "" : "?"}`).join(", ")}\n`
                    : "") +
                (phrases.length
                    ? `Sample phrases:\n${phrases.slice(0, 3).map((p) => `  - "${p}"`).join("\n")}`
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
                "Add JSDoc comments to each parameter explaining its purpose and valid values. " +
                "Follow these conventions:\n" +
                "- Export a top-level union type named `<IntegrationPascalCase>Actions`\n" +
                "- Each action type is named `<ActionPascalCase>Action`\n" +
                "- Use `actionName: \"camelCaseName\"` as a string literal type\n" +
                "- Parameters use camelCase names\n" +
                "- Optional parameters use `?: type` syntax\n" +
                "- Include the copyright header\n" +
                "Return only the TypeScript file content.",
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
    // Strip markdown code fences if present
    const fenceMatch = llmResponse.match(/```(?:typescript|ts)?\n([\s\S]*?)```/);
    if (fenceMatch) return fenceMatch[1].trim();
    return llmResponse.trim();
}
