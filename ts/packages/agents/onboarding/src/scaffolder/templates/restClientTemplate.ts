// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// REST client bridge for __agentName__.
// Calls the target API and returns results to the TypeAgent handler.

export class __AgentName__Bridge {
    constructor(
        private readonly baseUrl: string,
        private readonly apiKey?: string,
    ) {}

    async executeCommand(
        actionName: string,
        parameters: Record<string, unknown>,
    ): Promise<unknown> {
        // TODO: map actionName to HTTP endpoint and method
        throw new Error(`Not implemented: ${actionName}`);
    }

    private get headers(): Record<string, string> {
        const h: Record<string, string> = {
            "Content-Type": "application/json",
        };
        if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
        return h;
    }
}
