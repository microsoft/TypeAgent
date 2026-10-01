// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { AssistantMessageEvent, SessionConfig } from "@github/copilot-sdk";
import {
    BrowserReasoningAgent,
    BrowserReasoningCopilotClient,
    BrowserReasoningCopilotSession,
    createCopilotClient,
} from "../src/agent/webFlows/reasoning/browserReasoningAgent.mjs";
import type { WebFlowBrowserAPI } from "../src/agent/webFlows/webFlowBrowserApi.mjs";

function createBrowserApi(): WebFlowBrowserAPI {
    return {
        navigateTo: jest.fn(),
        goBack: jest.fn(),
        awaitPageLoad: jest.fn(),
        awaitPageInteraction: jest.fn(),
        getCurrentUrl: jest.fn(async () => "https://example.com/"),
        click: jest.fn(),
        clickAndWait: jest.fn(),
        followLink: jest.fn(),
        enterText: jest.fn(),
        enterTextOnPage: jest.fn(),
        clearAndType: jest.fn(),
        pressKey: jest.fn(),
        selectOption: jest.fn(),
        getPageText: jest.fn(async () => "Example page"),
        captureScreenshot: jest.fn(async () => ""),
        waitForNavigation: jest.fn(),
        extractComponent: jest.fn(async () => ({ cssSelector: "#search" })),
        checkPageState: jest.fn(async () => ({
            matched: true,
            explanation: "matched",
        })),
        queryContent: jest.fn(async () => ({
            answered: true,
            answerText: "answer",
        })),
    };
}

function assistantMessage(content: string): AssistantMessageEvent {
    return { data: { content } } as AssistantMessageEvent;
}

class TestSession implements BrowserReasoningCopilotSession {
    public aborted = false;
    public disconnected = false;

    constructor(
        private readonly send: () => Promise<AssistantMessageEvent | undefined>,
    ) {}

    async sendAndWait(): Promise<AssistantMessageEvent | undefined> {
        return this.send();
    }

    async abort(): Promise<void> {
        this.aborted = true;
    }

    async disconnect(): Promise<void> {
        this.disconnected = true;
    }
}

class TestClient implements BrowserReasoningCopilotClient {
    public config: SessionConfig | undefined;
    public started = false;
    public stopped = false;

    constructor(public readonly session: TestSession) {}

    async start(): Promise<void> {
        this.started = true;
    }

    async createSession(config: SessionConfig): Promise<TestSession> {
        this.config = config;
        return this.session;
    }

    async stop(): Promise<void> {
        this.stopped = true;
    }
}

describe("BrowserReasoningAgent Copilot provider", () => {
    it("starts a created client and cleans it up when startup fails", async () => {
        const session = new TestSession(async () => undefined);
        const client = new TestClient(session);

        await expect(createCopilotClient(async () => client)).resolves.toBe(
            client,
        );
        expect(client.started).toBe(true);
        expect(client.stopped).toBe(false);

        const failure = new Error("startup failed");
        client.start = async () => {
            throw failure;
        };
        await expect(createCopilotClient(async () => client)).rejects.toBe(
            failure,
        );
        expect(client.stopped).toBe(true);
    });

    it("uses GPT-5.6 Sol with only WebFlow browser tools", async () => {
        let client: TestClient;
        const session = new TestSession(async () => {
            const getPageText = client.config?.tools?.find(
                (tool) => tool.name === "getPageText",
            );
            await (
                getPageText?.handler as (
                    args: Record<string, unknown>,
                ) => Promise<unknown>
            )({});
            return assistantMessage("Goal complete");
        });
        client = new TestClient(session);
        const agent = new BrowserReasoningAgent(
            createBrowserApi(),
            undefined,
            async () => client,
        );

        const trace = await agent.executeGoal({ goal: "Read the page" });

        expect(client.config?.model).toBe("gpt-5.6-sol");
        expect(client.config?.availableTools).toEqual(
            client.config?.tools?.map((tool) => `custom:${tool.name}`),
        );
        expect(client.config?.toolSearch).toEqual({ enabled: false });
        expect(client.config?.skipCustomInstructions).toBe(true);
        expect(client.config?.tools?.every((tool) => tool.skipPermission)).toBe(
            true,
        );
        expect(trace.result).toEqual({
            success: true,
            summary: "Goal complete",
        });
        expect(trace.steps).toHaveLength(1);
        expect(trace.steps[0].action.tool).toBe("getPageText");
        expect(session.disconnected).toBe(true);
        expect(client.stopped).toBe(true);
    });

    it("aborts and cleans up an injected Copilot session", async () => {
        const session = new TestSession(
            () => new Promise<AssistantMessageEvent>(() => {}),
        );
        const client = new TestClient(session);
        const controller = new AbortController();
        const agent = new BrowserReasoningAgent(
            createBrowserApi(),
            undefined,
            async () => client,
        );

        const resultPromise = agent.executeGoal({
            goal: "Wait",
            abortSignal: controller.signal,
        });
        await Promise.resolve();
        await Promise.resolve();
        controller.abort(new Error("cancelled"));
        const trace = await resultPromise;

        expect(trace.result.success).toBe(false);
        expect(trace.result.summary).toBe("cancelled");
        expect(session.aborted).toBe(true);
        expect(session.disconnected).toBe(true);
        expect(client.stopped).toBe(true);
    });

    it("aborts and fails when the tool-call limit is exceeded", async () => {
        let client: TestClient;
        const session = new TestSession(async () => {
            const getPageText = client.config?.tools?.find(
                (tool) => tool.name === "getPageText",
            );
            const handler = getPageText?.handler as (
                args: Record<string, unknown>,
            ) => Promise<unknown>;
            await handler({});
            await handler({});
            return assistantMessage("Should not succeed");
        });
        client = new TestClient(session);
        const agent = new BrowserReasoningAgent(
            createBrowserApi(),
            undefined,
            async () => client,
        );

        const trace = await agent.executeGoal({
            goal: "Read twice",
            maxSteps: 1,
        });

        expect(trace.result).toEqual({
            success: false,
            summary: "Maximum browser reasoning steps (1) reached.",
        });
        expect(trace.steps).toHaveLength(1);
        expect(session.aborted).toBe(true);
        expect(session.disconnected).toBe(true);
        expect(client.stopped).toBe(true);
    });
});
