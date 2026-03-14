// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { WebFlowDefinition, WebFlowParameter } from "./types.js";

/**
 * Generates an .agr grammar rule from a WebFlowDefinition's grammar patterns.
 *
 * Example output:
 *   <searchAndAddToCart> =
 *       add $(product:wildcard) to (my)? cart
 *       | buy $(product:wildcard) (under|for less than) $(maxPrice:number) dollars
 *     -> { actionName: "searchAndAddToCart", parameters: { product, maxPrice } };
 */
export function generateAgrRule(
    name: string,
    parameters: Record<string, WebFlowParameter>,
    grammarPatterns: string[],
): string {
    if (grammarPatterns.length === 0) {
        return "";
    }

    const paramNames = Object.keys(parameters);
    const paramList = paramNames.length > 0 ? paramNames.join(", ") : "";
    const actionBody =
        paramNames.length > 0
            ? `{ actionName: "${name}", parameters: { ${paramList} } }`
            : `{ actionName: "${name}" }`;

    const patterns = grammarPatterns
        .map((p, i) => (i === 0 ? `    ${p}` : `    | ${p}`))
        .join("\n");

    return `<${name}> =\n${patterns}\n  -> ${actionBody};`;
}

/**
 * Generates a complete .agr text from multiple WebFlowDefinitions,
 * including a <Start> rule that combines all flow rules.
 */
export function generateAgrText(flows: WebFlowDefinition[]): string {
    if (flows.length === 0) {
        return "";
    }

    const rules: string[] = [];
    const startAlternatives: string[] = [];

    for (const flow of flows) {
        if (flow.grammarPatterns.length === 0) continue;

        const rule = generateAgrRule(
            flow.name,
            flow.parameters,
            flow.grammarPatterns,
        );
        if (rule) {
            rules.push(rule);
            startAlternatives.push(`<${flow.name}>`);
        }
    }

    if (rules.length === 0) {
        return "";
    }

    const startRule = `<Start> = ${startAlternatives.join(" | ")};`;
    return [...rules, startRule].join("\n\n");
}

/**
 * Generates an .agr rule for a single flow being added incrementally.
 * The caller is responsible for updating the <Start> rule separately.
 */
export function generateIncrementalAgrRule(flow: WebFlowDefinition): string {
    return generateAgrRule(flow.name, flow.parameters, flow.grammarPatterns);
}
