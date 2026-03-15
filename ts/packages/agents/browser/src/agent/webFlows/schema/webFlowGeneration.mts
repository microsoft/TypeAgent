// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The LLM should generate a response conforming to this type.

export type WebFlowGenerationResult = {
    // camelCase name for the flow (e.g., "searchForProduct", "customizeDrinkOptions")
    name: string;
    // What this flow does
    description: string;
    version: number;
    // Parameters that should be extracted from user input.
    // Search terms, product names, prices should become parameters.
    // Fixed UI element names (button text, labels) should NOT be parameters.
    parameters: { [paramName: string]: WebFlowParameterDef };
    // The script body as a string. Must be an async function with signature:
    //   async function execute(browser, params) { ... }
    // The script can ONLY use browser.* methods and params.* values. No other globals.
    script: string;
    // 3-5 natural language patterns for grammar matching.
    // Use $(paramName:wildcard) for string captures,
    // $(paramName:number) for number captures,
    // (optional word)? for optional words,
    // word1 | word2 for alternatives.
    grammarPatterns: string[];
    scope: WebFlowScopeDef;
    source: WebFlowSourceDef;
};

export type WebFlowParameterDef = {
    type: "string" | "number" | "boolean";
    required: boolean;
    // Always include the list of allowed values in the description when the parameter
    // maps to a fixed-choice control (dropdown, radio buttons, toggle group).
    // Example: "Foam level to select. Options: No Foam, Light Foam, Extra Foam"
    description: string;
    default?: string | number | boolean;
    // The exact display-text values accepted by this parameter. Populate this whenever
    // the recorded steps interact with a fixed-choice control (dropdown, radio buttons,
    // segmented toggle, etc.). Include ALL available options, not just the one selected
    // during the recording. The runtime uses this list for case-insensitive fuzzy matching.
    valueOptions?: string[];
};

export type WebFlowScopeDef = {
    // "site" if the flow only works on specific domains, "global" otherwise
    type: "site" | "global";
    // Domains this flow is scoped to (e.g., ["starbucks.com"])
    domains?: string[];
};

export type WebFlowSourceDef = {
    type: "goal-driven" | "recording" | "discovered" | "manual";
    timestamp: string;
};
