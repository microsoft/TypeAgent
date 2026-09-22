// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const mixedPowerShellGuidance = [
    "Prefer TypeAgent capabilities for filesystem and system operations when appropriate.",
    "For a user request delegated intact to TypeAgent, use typeagent-processCommand with the original natural language, never shell code.",
    "For an intermediate operation you select while handling a Copilot task, use typeagent-searchActions and typeagent-executeAction with concrete inputs.",
    "Do not turn an agent-selected step into a synthetic user request for processCommand.",
    "Native coding, file, search, and terminal tools remain available for Copilot-owned work.",
].join("\n");

export const mixedMcpGuidance = [
    "[TypeAgent MCP routing: mixed]",
    "Choose whether to delegate the user's request intact to TypeAgent or handle the task yourself using the request and conversation context. This is a routing judgment, not a preclassified action.",
    "For user requests for TypeAgent operations, call typeagent-processCommand with the user's exact request, preserving all wording and directives. Present its complete result without truncating or paraphrasing it.",
    'Examples: "Show my lists" and "Create a list and add these three items" are whole-request delegation, even when they require multiple actions.',
    "For coding, explanations, research, or broader tasks you coordinate, keep ownership of the task and use your normal tools. Do not force a TypeAgent call for every prompt.",
    'Example: "Review this diff, identify missing tests, and track the resulting work in a list" stays with Copilot for the review; list operations selected during that work use structured TypeAgent tools.',
    "For TypeAgent intermediate actions YOU select, use typeagent-searchActions to obtain a suitable contract, then typeagent-executeAction with the returned scopeId, exact schemaName/actionName, and concrete typed parameters.",
    "Reuse a suitable current contract within the same binding without rediscovery. Search candidates are not proof of capability or execution approval. Clarify unresolved inputs rather than guessing.",
    "Do not apply a blanket search-first rule to original user requests, and do not translate agent-selected steps into natural-language processCommand requests.",
    "Recording directives (learn:, dev:, record:, dev: learn:) must use processCommand with the original request and prefixes preserved exactly.",
    "If ownership is ambiguous, clarify with the user. Explicit @typeagent run requests delegate to TypeAgent.",
    "Show the complete prompt/form for requires_interaction and wait for the user's actual response before continueAction. Never autoapprove, supply defaults, or bypass a denial.",
    "Do not retry failed, denied, or uncertain structured execution through processCommand. Never replay uncertain delivery. Report unavailable capabilities rather than inventing actions.",
].join("\n");
