// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AutomationCatalogSources } from "@typeagent/agent-flows/catalog";
import type { MacroManager } from "@typeagent/copilot-macros";

// The browser agent runs in its own process, and agent options cross that
// boundary through agent-rpc, which accepts only plain objects whose functions
// it proxies. A MacroManager instance is rejected, so the calls the catalog
// needs are exposed as plain functions. Typing the result as
// AutomationCatalogSources also makes the compiler check that MacroManager
// still satisfies what the Automations page calls on it.
export function createAutomationSources(
    instanceDir: string,
    macros: MacroManager,
): AutomationCatalogSources {
    return {
        instanceDir,
        macros: {
            listMacros: () => macros.listMacros(),
            inspectMacro: (request) => macros.inspectMacro(request),
            validateMacro: (request) => macros.validateMacro(request),
            approveMacro: (request) => macros.approveMacro(request),
            disableMacro: (request) => macros.disableMacro(request),
            deleteMacro: (request) => macros.deleteMacro(request),
        },
    };
}

// The browser agent accepts either a bare BrowserControl or an options object
// (see normalizeBrowserAgentInitOptions), so a bare value is wrapped.
export function withAutomationSources(
    agentInitOptions: Record<string, unknown> | undefined,
    automations: AutomationCatalogSources,
): Record<string, unknown> {
    const browser = agentInitOptions?.browser;
    const isOptionsObject =
        typeof browser === "object" &&
        browser !== null &&
        ("browserControl" in browser ||
            "memoryServiceClient" in browser ||
            "automations" in browser ||
            "runbookCapabilities" in browser);
    return {
        ...agentInitOptions,
        browser:
            browser === undefined
                ? { automations }
                : isOptionsObject
                  ? { ...browser, automations }
                  : { browserControl: browser, automations },
    };
}
