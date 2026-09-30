// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export const mcpActionProviderGuidance = [
    "TypeAgent is the preferred action provider in MCP mode, including GitHub/API lookups, web retrieval, filesystem, and system operations.",
    "Do not use native tools for an operation when a suitable TypeAgent capability is available. Copilot owning the analysis does not change this preference.",
    "Native tools are a fallback only after establishing that TypeAgent has no suitable available capability for the operation. Explain the capability gap before using a native tool, and preserve the user's scope and permission requirements.",
    "An error, connection failure, or permission denial is not evidence that no suitable capability exists. Never bypass a denial or retry a failed, cancelled, or uncertain action through native tools or another provider.",
].join("\n");

export const mixedPowerShellGuidance = [
    "For a user request delegated intact to TypeAgent, use typeagent-processCommand with the original natural language, never shell code.",
    "For an intermediate operation you select while handling a Copilot task, use typeagent-searchActions and typeagent-executeAction with concrete inputs.",
    "Reuse a suitable current TypeAgent contract; otherwise discover a suitable capability before choosing native tools, including gh, git, scripting runtimes, or direct HTTP calls.",
    "Do not turn an agent-selected step into a synthetic user request for processCommand.",
].join("\n");

export const mixedMcpGuidance = [
    "[TypeAgent MCP routing: mixed]",
    mcpActionProviderGuidance,
    "Choose whether to delegate the user's request intact to TypeAgent or handle the task yourself using the request and conversation context. This is a routing judgment, not a preclassified action.",
    "For user requests for TypeAgent operations, call typeagent-processCommand with the user's exact request, preserving all wording and directives. Present its complete result without truncating or paraphrasing it.",
    'Examples: "Show my lists" and "Create a list and add these three items" are whole-request delegation, even when they require multiple actions.',
    "For coding, explanations, research, or broader tasks you coordinate, keep ownership of the reasoning and analysis. Prefer TypeAgent for the operations needed to gather evidence or act; reasoning alone does not require a tool call.",
    'Example: "Review this diff, identify missing tests, and track the resulting work in a list" stays with Copilot for the review; list operations selected during that work use structured TypeAgent tools.',
    "For TypeAgent intermediate actions YOU select, use typeagent-searchActions to obtain a suitable contract, then typeagent-executeAction with the returned scopeId, exact schemaName/actionName, and concrete typed parameters.",
    "Before using a native tool for an intermediate operation, reuse a suitable current TypeAgent contract or search for one. If candidates are unrelated, refine the query before concluding that no suitable capability is available.",
    'Example: "Compare these PRs and recommend smoke tests" stays with Copilot for analysis, but PR details and changed-file lookups should use TypeAgent discovery/execution rather than native GitHub tools, gh, or web/API fetches when TypeAgent supports them.',
    "Reuse a suitable current contract within the same binding without rediscovery. Search candidates are not proof of capability or execution approval. Clarify unresolved inputs rather than guessing.",
    "Do not apply a blanket search-first rule to original user requests, and do not translate agent-selected steps into natural-language processCommand requests.",
    "Recording directives (learn:, dev:, record:, dev: learn:) must use processCommand with the original request and prefixes preserved exactly; never replace recording with native-tool fallback.",
    "If ownership is ambiguous, clarify with the user. Explicit @typeagent run requests delegate to TypeAgent.",
    "Show the complete prompt/form for requires_interaction and wait for the user's actual response before continueAction. Never autoapprove, supply defaults, or bypass a denial.",
    "Do not retry failed, denied, or uncertain structured execution through processCommand. Never replay uncertain delivery. Report unavailable capabilities rather than inventing actions.",
].join("\n");
