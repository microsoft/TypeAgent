// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AssistantMessageEvent,
    MessageOptions,
    SessionConfig,
} from "@github/copilot-sdk";
import {
    CopilotGrammarClient,
    CopilotGrammarGenerator,
    CopilotGrammarSession,
    defaultCopilotGrammarModel,
} from "../src/generation/copilotGrammarGenerator.js";
import { SchemaInfo } from "../src/generation/schemaReader.js";

const schemaInfo: SchemaInfo = {
    schemaName: "test",
    actions: new Map([
        [
            "listCategories",
            {
                actionName: "listCategories",
                parameters: new Map(),
            },
        ],
    ]),
    entityTypes: new Set(),
    converters: new Map(),
};

const analysis = {
    shouldGenerateGrammar: true,
    requestAnalysis: {
        sentences: [
            {
                text: "list categories",
                parse: "(verb list) (noun categories)",
                tokens: [],
            },
        ],
    },
    parameterMappings: [],
    fixedPhrases: ["list", "categories"],
    grammarPattern: {
        matchPattern: "list categories",
        actionParameters: [],
    },
    reasoning: "The request contains only fixed action words.",
};

class TestSession implements CopilotGrammarSession {
    public disconnected = false;
    public prompt: string | undefined;

    constructor(private readonly content: string | undefined) {}

    async sendAndWait(
        promptOrOptions: string | MessageOptions,
    ): Promise<AssistantMessageEvent | undefined> {
        this.prompt =
            typeof promptOrOptions === "string"
                ? promptOrOptions
                : promptOrOptions.prompt;
        return this.content === undefined
            ? undefined
            : ({
                  data: { content: this.content },
              } as AssistantMessageEvent);
    }

    async disconnect(): Promise<void> {
        this.disconnected = true;
    }
}

class TestClient implements CopilotGrammarClient {
    public config: SessionConfig | undefined;
    public stopped = false;

    constructor(public readonly session: TestSession) {}

    async createSession(config: SessionConfig): Promise<CopilotGrammarSession> {
        this.config = config;
        return this.session;
    }

    async stop(): Promise<void> {
        this.stopped = true;
    }
}

describe("CopilotGrammarGenerator", () => {
    it("uses GPT-5.6 Sol and cleans up the Copilot session", async () => {
        const session = new TestSession(JSON.stringify(analysis));
        const client = new TestClient(session);
        const generator = new CopilotGrammarGenerator(
            undefined,
            async () => client,
        );

        const result = await generator.generateGrammar(
            {
                request: "list categories",
                schemaName: "test",
                action: {
                    actionName: "listCategories",
                    parameters: {},
                },
            },
            schemaInfo,
        );

        expect(result).toEqual(analysis);
        expect(client.config?.model).toBe(defaultCopilotGrammarModel);
        expect(client.config?.streaming).toBe(false);
        expect(session.prompt).toContain("grammar pattern generator");
        expect(session.disconnected).toBe(true);
        expect(client.stopped).toBe(true);
    });

    it("reports an empty Copilot response and still cleans up", async () => {
        const session = new TestSession(undefined);
        const client = new TestClient(session);
        const generator = new CopilotGrammarGenerator(
            undefined,
            async () => client,
        );

        await expect(
            generator.generateGrammar(
                {
                    request: "list categories",
                    schemaName: "test",
                    action: {
                        actionName: "listCategories",
                        parameters: {},
                    },
                },
                schemaInfo,
            ),
        ).rejects.toThrow("No response from Copilot");
        expect(session.disconnected).toBe(true);
        expect(client.stopped).toBe(true);
    });
});
