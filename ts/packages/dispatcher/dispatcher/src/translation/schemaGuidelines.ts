// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared schema-authoring guidelines. The canonical text governing how
// TypeAgent action schemas should be written.
//
// Consumed by two paths:
//   1. The onboarding agent's `schemaGen` handler (system prompt for
//      generateSchema / refineSchema).
//   2. The dispatcher's optimize loop (system prompt for caseAnalyzer
//      classification and every lever's hypothesis-generation prompt). The
//      "WORK WITH THE LLM'S INTENT, NOT AGAINST IT" principle is the
//      load-bearing instruction for collision-fix hypotheses.
//
// Phase 9 (`@collision optimize distill`) periodically proposes new
// candidate entries here, distilled from winning attempts across runs.
// Operator reviews and promotes by hand.

export const schemaGuidelines = `
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
