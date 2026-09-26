// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AssistantMessageEvent,
    MessageOptions,
    SessionConfig,
} from "@github/copilot-sdk";
import registerDebug from "debug";
import { GrammarGenerator } from "./grammarGenerator.js";

const debug = registerDebug("typeagent:actionGrammar:copilotGrammarGenerator");

export const defaultCopilotGrammarModel = "gpt-5.6-sol";

export interface CopilotGrammarSession {
    sendAndWait(
        promptOrOptions: string | MessageOptions,
        timeout?: number,
    ): Promise<AssistantMessageEvent | undefined>;
    disconnect(): Promise<void>;
}

export interface CopilotGrammarClient {
    createSession(config: SessionConfig): Promise<CopilotGrammarSession>;
    stop(): Promise<unknown>;
}

export type CopilotGrammarClientFactory = () => Promise<CopilotGrammarClient>;

async function createCopilotGrammarClient(): Promise<CopilotGrammarClient> {
    const { CopilotClient } = await import("@github/copilot-sdk");
    const client = new CopilotClient();
    await client.start();
    return client;
}

export class CopilotGrammarGenerator extends GrammarGenerator {
    constructor(
        private readonly model: string = defaultCopilotGrammarModel,
        private readonly clientFactory: CopilotGrammarClientFactory = createCopilotGrammarClient,
    ) {
        super("Copilot");
    }

    protected async queryModel(fullPrompt: string): Promise<string> {
        const client = await this.clientFactory();
        let session: CopilotGrammarSession | undefined;
        try {
            session = await client.createSession({
                model: this.model,
                streaming: false,
            });
            const response = await session.sendAndWait({
                prompt: fullPrompt,
            });
            return response?.data?.content ?? "";
        } finally {
            if (session !== undefined) {
                try {
                    await session.disconnect();
                } catch (error) {
                    debug("Failed to disconnect Copilot session: %O", error);
                }
            }
            try {
                await client.stop();
            } catch (error) {
                debug("Failed to stop Copilot client: %O", error);
            }
        }
    }
}
