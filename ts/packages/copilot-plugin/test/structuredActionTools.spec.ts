// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type {
    ActionContractResult,
    ActionSearchResult,
    ExecuteActionRequest,
    StructuredActionExecutionResult,
    StructuredActionResponse,
} from "@typeagent/dispatcher-types";
import { TypeAgentMcpServer } from "../src/mcp/agentServer.js";
import { StructuredActionClient } from "@typeagent/agent-server-client";
import {
    structuredFixture,
    oddValue,
    form,
} from "./structuredActionFixture.js";

type Pending = Extract<
    StructuredActionExecutionResult,
    { status: "requires_interaction" }
>;
function pending(result: StructuredActionExecutionResult): Pending {
    if (result.status !== "requires_interaction") {
        throw new Error(`Expected pending, got ${JSON.stringify(result)}`);
    }
    return result;
}
const parameters = {
    text: oddValue,
    ids: [oddValue, "007", ""],
    nested: { name: oddValue, count: 42 },
};
const formResponse: StructuredActionResponse = {
    type: "form",
    value: {
        answers: {
            [oddValue]: { kind: "pick", selected: -1, text: oddValue },
            many: { kind: "multiChoice", selected: [0, 1] },
            yes: { kind: "yesNo", value: false },
        },
    },
};

describe("real MCP protocol over the shared real structured Dispatcher", () => {
    let fixture: Awaited<ReturnType<typeof structuredFixture>>;
    let connector: StructuredActionClient;
    let server: TypeAgentMcpServer;
    let client: Client;
    const oldMode = process.env.TYPEAGENT_MODE;
    beforeEach(async () => {
        process.env.TYPEAGENT_MODE = "direct";
        fixture = await structuredFixture();
        connector = new StructuredActionClient({
            connect: fixture.connect,
            conversationId: "explicit-public-conversation",
        });
        server = new TypeAgentMcpServer(connector);
        client = new Client({ name: "real-plugin-test", version: "1" });
        const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
        await server.server.connect(serverTransport);
        await client.connect(clientTransport);
    });
    afterEach(async () => {
        fixture.release();
        await client.close();
        await server.close();
        await fixture.close();
        if (oldMode === undefined) delete process.env.TYPEAGENT_MODE;
        else process.env.TYPEAGENT_MODE = oldMode;
    });

    async function call<T>(
        name: string,
        args: Record<string, unknown>,
    ): Promise<T> {
        const response = await client.callTool({
            name: `typeagent-${name}`,
            arguments: args,
        });
        const status = (
            response.structuredContent as { status?: string } | undefined
        )?.status;
        expect(response.isError).toBe(
            status !== undefined &&
                !["completed", "requires_interaction", "found"].includes(status)
                ? true
                : undefined,
        );
        expect(response.content).toEqual([
            {
                type: "text",
                text: JSON.stringify(response.structuredContent, null, 2),
            },
        ]);
        return response.structuredContent as T;
    }
    async function request(
        actionName = "read",
        mode?: string,
    ): Promise<ExecuteActionRequest> {
        const found = await call<ActionContractResult>("getActionContract", {
            schemaName: "fixture",
            actionName,
        });
        if (found.status !== "found")
            throw new Error("Missing fixture contract");
        return {
            protocolVersion: 1,
            scopeId: found.scopeId,
            schemaName: "fixture",
            actionName,
            fingerprint: found.contract.fingerprint,
            ...(actionName === "clear"
                ? {}
                : { parameters: { ...parameters, ...(mode ? { mode } : {}) } }),
        };
    }
    const execute = (input: ExecuteActionRequest) =>
        call<StructuredActionExecutionResult>("executeAction", input);
    const answer = (input: Pending, response: StructuredActionResponse) =>
        call<StructuredActionExecutionResult>("continueAction", {
            protocolVersion: 1,
            scopeId: input.scopeId,
            operationId: input.operationId,
            interactionId: input.interactionId,
            response,
        });

    it.each(["direct", "mcp"] as const)(
        "exposes real fixed tools in %s mode and preserves nested typed values",
        async (mode) => {
            process.env.TYPEAGENT_MODE = mode;
            const tools = await client.listTools();
            expect(tools.tools.map((tool) => tool.name)).toEqual(
                expect.arrayContaining([
                    "typeagent-processCommand",
                    "typeagent-searchActions",
                    "typeagent-getActionContract",
                    "typeagent-executeAction",
                    "typeagent-continueAction",
                    "typeagent-cancelAction",
                ]),
            );
            const summaries = await call<ActionSearchResult>("searchActions", {
                query: "write",
                limit: 1,
            });
            expect(summaries.actions).toHaveLength(1);
            expect(summaries).toMatchObject({
                binding: {
                    conversationId: "explicit-public-conversation",
                    connected: true,
                },
            });
            expect(summaries.actions[0]).toMatchObject({
                schemaName: "fixture",
                actionName: "write",
            });
            const found = await call<ActionContractResult>(
                "getActionContract",
                {
                    schemaName: "fixture",
                    actionName: "write",
                },
            );
            if (found.status !== "found") throw new Error("Missing contract");
            expect(found.contract.input.schemaText).toContain("Nested");
            expect(found.contract.input.schemaText).not.toContain("unrelated");
            const input = await request("write");
            const confirmation = pending(await execute(input));
            expect(confirmation.prompt.type).toBe("confirmation");
            expect(fixture.effects).toBe(0);
            expect(fixture.handlers).toBe(0);
            // Represents a separate user turn, not an adapter-supplied default.
            const completed = await answer(confirmation, {
                type: "confirmation",
                approved: true,
            });
            expect(completed.status).toBe("completed");
            expect(fixture.submitted).toEqual([
                expect.objectContaining({
                    actionName: "write",
                    parameters,
                }),
            ]);
            expect(completed.results[0].result).toMatchObject({
                resultEntity: { uniqueId: oddValue },
                entities: [{ uniqueId: oddValue }],
                resultValue: {
                    ids: [oddValue, "", "007"],
                    nested: { values: [null, true, { name: oddValue }] },
                },
                displayContent: { type: "html", content: `<b>${oddValue}</b>` },
            });
            expect(fixture.joins).toHaveLength(1);
            expect(fixture.joins[0]).toEqual({
                conversationId: "explicit-public-conversation",
                structuredActions: {},
            });
        },
    );

    it("unknown-policy clear requires consent even with no parameters", async () => {
        const confirmation = pending(await execute(await request("clear")));
        expect(confirmation.prompt).toMatchObject({
            type: "confirmation",
            contract: {
                policy: { effects: "unknown", confirmation: "required" },
            },
        });
        expect(fixture.effects).toBe(0);
        expect(
            (
                await answer(confirmation, {
                    type: "confirmation",
                    approved: false,
                })
            ).status,
        ).toBe("cancelled");
        expect(fixture.effects).toBe(0);
    });

    it.each(["stale", "invalid", "disabled", "readiness", "scope"] as const)(
        "%s rejects before any handler or effect",
        async (kind) => {
            const input = await request();
            if (kind === "stale") input.fingerprint += "stale";
            if (kind === "invalid")
                input.parameters = { ...parameters, ids: 42 };
            if (kind === "disabled") fixture.disable();
            if (kind === "readiness") await fixture.unready();
            if (kind === "scope") input.scopeId += "foreign";
            const actual = await execute(input);
            expect(actual.status).toBe(
                kind === "stale"
                    ? "contract_stale"
                    : kind === "disabled" || kind === "readiness"
                      ? "unavailable"
                      : "failed",
            );
            expect(fixture.handlers).toBe(0);
            expect(fixture.effects).toBe(0);
        },
    );

    it.each(["question", "choice", "form", "blockingForm"] as const)(
        "returns full %s prompt and resumes only a USER response",
        async (mode) => {
            const interaction = pending(
                await execute(await request("read", mode)),
            );
            expect(interaction.interactionId).toEqual(expect.any(String));
            expect(interaction.operationId).toEqual(expect.any(String));
            expect(fixture.effects).toBe(0);
            if (mode === "question") {
                expect(interaction.prompt).toEqual({
                    type: "question",
                    message: oddValue,
                    choices: [oddValue, "No"],
                    defaultId: 0,
                });
            } else if (mode === "choice") {
                expect(interaction.prompt).toMatchObject({
                    type: "multiChoice",
                    message: oddValue,
                    choices: [oddValue, "second"],
                });
            } else {
                expect(interaction.prompt).toEqual({ type: "form", ...form });
            }
            const response: StructuredActionResponse =
                mode === "question"
                    ? { type: "question", selected: 1 }
                    : mode === "choice"
                      ? { type: "multiChoice", selected: [1] }
                      : formResponse;
            const completed = await answer(interaction, response);
            expect(completed.status).toBe("completed");
            expect(fixture.effects).toBe(1);
            // Finished operations return their retained terminal result. This
            // does not invoke the handler or consume the response a second time.
            expect(await answer(interaction, response)).toEqual(completed);
            expect(fixture.effects).toBe(1);
        },
    );

    it("rejects wrong interaction ids without consuming the choice, then cancels by exact id", async () => {
        const interaction = pending(
            await execute(await request("read", "choice")),
        );
        const wrong = { ...interaction, interactionId: "wrong" };
        expect(
            (await answer(wrong, { type: "multiChoice", selected: [0] }))
                .status,
        ).toBe("failed");
        expect(fixture.callbacks).toBe(0);
        const cancelled = await call<StructuredActionExecutionResult>(
            "cancelAction",
            {
                protocolVersion: 1,
                scopeId: interaction.scopeId,
                operationId: interaction.operationId,
                interactionId: interaction.interactionId,
            },
        );
        // The service cannot promise no effects after entering the handler,
        // even though this offline fixture knows its callback has not run.
        expect(cancelled.status).toBe("execution_uncertain");
        expect(fixture.effects).toBe(0);
        expect(fixture.callbacks).toBe(0);
    });

    it("cancels confirmation before any effect is possible", async () => {
        const interaction = pending(await execute(await request("write")));
        const cancelled = await call<StructuredActionExecutionResult>(
            "cancelAction",
            {
                protocolVersion: 1,
                scopeId: interaction.scopeId,
                operationId: interaction.operationId,
                interactionId: interaction.interactionId,
            },
        );
        expect(cancelled.status).toBe("cancelled");
        expect(fixture.handlers).toBe(0);
        expect(fixture.effects).toBe(0);
    });

    it("rejects a fresh owner on the same public conversation and resumes the original owner", async () => {
        const interaction = pending(await execute(await request("write")));
        const foreign = new StructuredActionClient({
            connect: fixture.connect,
            conversationId: connector.binding.conversationId!,
        });
        try {
            const rejected = await foreign.continueAction({
                protocolVersion: 1,
                scopeId: interaction.scopeId,
                operationId: interaction.operationId,
                interactionId: interaction.interactionId,
                response: { type: "confirmation", approved: true },
            });
            expect(rejected.status).toBe("failed");
            await foreign.close();
            expect(fixture.effects).toBe(0);
            expect(
                (
                    await answer(interaction, {
                        type: "confirmation",
                        approved: true,
                    })
                ).status,
            ).toBe("completed");
        } finally {
            await foreign.close();
        }
    });

    it("reconnects with the SAME id and private token, preserving scope and pending operations", async () => {
        const interaction = pending(await execute(await request("write")));
        fixture.disconnect();
        const resumed = await call<ActionSearchResult>("searchActions", {});
        expect(resumed.scopeId).toBe(interaction.scopeId);
        expect(fixture.joins[1].conversationId).toBe(
            fixture.joins[0].conversationId,
        );
        expect(fixture.joins[1].structuredActions?.resumeToken).toEqual(
            expect.any(String),
        );
        expect(JSON.stringify(resumed)).not.toContain(
            fixture.joins[1].structuredActions!.resumeToken!,
        );
        expect(
            (
                await answer(interaction, {
                    type: "confirmation",
                    approved: true,
                })
            ).status,
        ).toBe("completed");
        expect(fixture.owners).toBe(1);
    });

    it("fails closed on rejected resume without leaking token or creating a fresh owner", async () => {
        await request();
        fixture.disconnect();
        fixture.rejectResume();
        const actual = await client.callTool({
            name: "typeagent-searchActions",
            arguments: {},
        });
        expect(actual.isError).toBe(true);
        expect(fixture.owners).toBe(1);
        const token = fixture.joins[1].structuredActions!.resumeToken!;
        expect(JSON.stringify(actual)).not.toContain(token);
        expect(actual.structuredContent).toMatchObject({
            error: { code: "resume_failed" },
        });
    });

    it("exposes authoritative resume rejection as a safe reason, not a generic transport error", async () => {
        await request();
        fixture.disconnect();
        fixture.rejectResume(
            "Structured action resume state is unavailable; do not replay an interrupted action",
        );
        const actual = await client.callTool({
            name: "typeagent-searchActions",
            arguments: {},
        });
        expect(actual.structuredContent).toMatchObject({
            status: "unavailable",
            error: {
                code: "resume_rejected",
                message: expect.stringContaining("session or host restart"),
            },
        });
        expect(fixture.owners).toBe(1);
        expect(JSON.stringify(actual)).not.toContain(
            fixture.joins[1].structuredActions!.resumeToken!,
        );
    });

    it("reports an ambiguous effect reply without replaying", async () => {
        const input = await request();
        fixture.loseEffectReply();
        const actual = await client.callTool({
            name: "typeagent-executeAction",
            arguments: input,
        });
        expect(actual.structuredContent).toMatchObject({
            status: "execution_uncertain",
            source: "copilot-transport",
        });
        expect(fixture.effects).toBe(1);
        expect(fixture.handlers).toBe(1);
        expect(fixture.joins).toHaveLength(1);
    });

    it("does not replay when the MCP caller times out during execution", async () => {
        const input = await request("read", "hold");
        const held = fixture.held();
        const abort = new AbortController();
        const callResult = client
            .callTool(
                { name: "typeagent-executeAction", arguments: input },
                undefined,
                { signal: abort.signal },
            )
            .catch((error: unknown) => error);
        await held;
        abort.abort();
        await callResult;
        fixture.release();
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(fixture.handlers).toBe(1);
        expect(fixture.joins).toHaveLength(1);
    });

    it("preserves authoritative execution failure instead of inventing completion", async () => {
        expect((await execute(await request("read", "throw"))).status).toBe(
            "failed",
        );
        expect(fixture.effects).toBe(0);
    });

    it("retains parent and child ActionResult envelopes without synthesizing display data", async () => {
        const completed = await execute(await request("read", "child"));
        expect(completed.status).toBe("completed");
        expect(completed.results).toHaveLength(2);
        for (const entry of completed.results) {
            expect(entry.result).toMatchObject({
                resultValue: {
                    ids: [oddValue, "", "007"],
                    nested: { values: [null, true, { name: oddValue }] },
                },
            });
        }
        expect(fixture.handlers).toBe(2);
        expect(fixture.effects).toBe(2);
    });

    it.each(["dev", "bypass"])(
        "does not dispatch structured tools in %s mode",
        async (mode) => {
            process.env.TYPEAGENT_MODE = mode;
            const actual = await client.callTool({
                name: "typeagent-searchActions",
                arguments: {},
            });
            expect(actual.isError).toBe(true);
            expect(fixture.joins).toHaveLength(0);
        },
    );
});
