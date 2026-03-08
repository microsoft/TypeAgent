// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { RecipeParameter } from "./types/recipe.js";

export type LLMCallback = (prompt: string) => Promise<string>;

/**
 * Generate grammar patterns for a recipe using an optional LLM callback.
 * If no LLM callback is provided, returns an empty array (user can add
 * patterns manually before compilation).
 */
export async function generateGrammarPatterns(
    actionName: string,
    description: string,
    parameters: RecipeParameter[],
    llm?: LLMCallback,
): Promise<string[]> {
    if (!llm) {
        return [];
    }

    const paramList = parameters
        .map((p) => `  - ${p.name} (${p.type}): ${p.description}`)
        .join("\n");

    const prompt = `Generate 3-5 natural language grammar patterns for a task flow action.

Action: ${actionName}
Description: ${description}
Parameters:
${paramList || "  (none)"}

Rules:
- Each pattern is a natural language phrase users might say
- Use $(paramName:wildcard) for string parameters, $(paramName:number) for number parameters
- Keep patterns concise and varied
- Do NOT include quotes around words
- Do NOT include the action name literally

Return ONLY the patterns, one per line, no numbering or bullets.`;

    const result = await llm(prompt);
    const lines = result
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#") && !l.startsWith("-"));

    // Validate that pattern parameter references match actual parameters
    const paramNames = new Set(parameters.map((p) => p.name));
    return lines.filter((line) => {
        const refs = [...line.matchAll(/\$\((\w+):/g)].map((m) => m[1]);
        return refs.every((ref) => paramNames.has(ref));
    });
}
