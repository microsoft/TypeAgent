// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function withAutomationSources(
    agentInitOptions: Record<string, unknown> | undefined,
    instanceDir: string,
): Record<string, unknown> {
    const browser = agentInitOptions?.browser;
    const isOptions =
        typeof browser === "object" &&
        browser !== null &&
        ("browserControl" in browser ||
            "memoryServiceClient" in browser ||
            "automations" in browser ||
            "runbookCapabilities" in browser);
    const automations = { instanceDir };
    return {
        ...agentInitOptions,
        browser:
            browser === undefined
                ? { automations }
                : isOptions
                  ? { ...browser, automations }
                  : { browserControl: browser, automations },
    };
}
