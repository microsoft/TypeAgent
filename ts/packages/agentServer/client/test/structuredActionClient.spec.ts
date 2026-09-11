// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import {
    StructuredActionClient,
    StructuredActionClientError,
    type AgentServerConnection,
    type ConversationDispatcher,
} from "../src/index.js";

function fakeConnection() {
    const dispatcher = {
        searchActions: async () => ({
            protocolVersion: 1,
            scopeId: "scope",
            actions: [],
            total: 0,
        }),
    } as unknown as ConversationDispatcher["dispatcher"];
    const joinConversation = jest.fn<AgentServerConnection["joinConversation"]>(
        async (_io, options) => ({
            conversationId: options!.conversationId!,
            name: "Test",
            connectionId: "connection",
            structuredActions: { resumeToken: "private-test-capability" },
            dispatcher,
        }),
    );
    const createConversation = jest.fn<
        AgentServerConnection["createConversation"]
    >(
        async (name) =>
            ({ conversationId: name, name }) as Awaited<
                ReturnType<AgentServerConnection["createConversation"]>
            >,
    );
    const close = jest.fn(async () => {});
    const connection = {
        joinConversation,
        createConversation,
        close,
        listConversations: async () => [],
    } as unknown as AgentServerConnection;
    return {
        connection,
        dispatcher,
        joinConversation,
        createConversation,
        close,
    };
}

describe("private structured connector binding lifecycle", () => {
    it("uses a supplied name once and never defaults an out-of-band question", async () => {
        const fake = fakeConnection();
        const createConversationName = jest.fn(
            () => "Dedicated embedded caller",
        );
        const client = new StructuredActionClient({
            connect: async () => fake.connection,
            createConversationName,
        });
        try {
            await client.searchActions();
            await client.searchActions();
            expect(createConversationName).toHaveBeenCalledTimes(1);
            expect(fake.createConversation).toHaveBeenCalledWith(
                "Dedicated embedded caller",
            );
            const io = fake.joinConversation.mock.calls[0][0];
            await expect(
                io.question(undefined, "Allow?", ["yes", "no"], 0),
            ).rejects.toThrow("explicit user response");
        } finally {
            await client.close();
        }
    });
    it("forwards all five operations unchanged and never calls the NL command path", async () => {
        const fake = fakeConnection();
        const result = {
            protocolVersion: 1 as const,
            scopeId: "scope",
            operationId: "operation",
            status: "completed" as const,
            output: [],
            results: [],
        };
        const search = jest.fn(fake.dispatcher.searchActions);
        const contract = jest.fn<
            ConversationDispatcher["dispatcher"]["getActionContract"]
        >(async () => ({
            protocolVersion: 1,
            scopeId: "scope",
            status: "not-found",
        }));
        const execute = jest.fn<
            ConversationDispatcher["dispatcher"]["executeAction"]
        >(async () => result);
        const continuation = jest.fn<
            ConversationDispatcher["dispatcher"]["continueAction"]
        >(async () => result);
        const cancellation = jest.fn<
            ConversationDispatcher["dispatcher"]["cancelAction"]
        >(async () => result);
        Object.assign(fake.dispatcher, {
            searchActions: search,
            getActionContract: contract,
            executeAction: execute,
            continueAction: continuation,
            cancelAction: cancellation,
            submitCommand: () => {
                throw new Error("NL must never be called");
            },
        });
        const client = new StructuredActionClient({
            connect: async () => fake.connection,
        });
        const identity = {
            schemaName: "exact.schema",
            actionName: "exactAction",
        };
        const envelope = { protocolVersion: 1 as const, scopeId: "scope" };
        const request = {
            ...identity,
            ...envelope,
            fingerprint: "fingerprint",
            parameters: {
                ids: ["007", '東京\n"quoted"'],
                nested: { value: [null, true] },
            },
        };
        const response = {
            ...envelope,
            operationId: "operation",
            interactionId: "interaction",
            response: { type: "confirmation" as const, approved: true },
        };
        try {
            await client.searchActions({ query: "exact", limit: 2 });
            await client.getActionContract(identity);
            expect(await client.executeAction(request)).toBe(result);
            expect(await client.continueAction(response)).toBe(result);
            expect(await client.cancelAction(response)).toBe(result);
            expect(search).toHaveBeenCalledWith({ query: "exact", limit: 2 });
            expect(contract).toHaveBeenCalledWith(identity);
            expect(execute).toHaveBeenCalledWith(request);
            expect(continuation).toHaveBeenCalledWith(response);
            expect(cancellation).toHaveBeenCalledWith(response);
            expect(fake.joinConversation).toHaveBeenCalledTimes(1);
            expect(client.binding.connected).toBe(true);
        } finally {
            await client.close();
        }
    });

    it("retains the capability privately on same-id reconnect and rejects resume failure without fallback", async () => {
        const fake = fakeConnection();
        let disconnect: (() => void) | undefined;
        const client = new StructuredActionClient({
            conversationId: "public-id",
            connect: async (callback) => {
                disconnect = callback;
                return fake.connection;
            },
        });
        try {
            await client.searchActions();
            disconnect!();
            expect(client.binding).toEqual({
                conversationId: "public-id",
                connected: false,
            });
            await client.searchActions();
            expect(fake.joinConversation.mock.calls[1][1]).toEqual({
                conversationId: "public-id",
                structuredActions: { resumeToken: "private-test-capability" },
            });
            expect(JSON.stringify(client.binding)).not.toContain(
                "private-test-capability",
            );
            disconnect!();
            fake.joinConversation.mockRejectedValue(
                new Error("Bad capability private-test-capability"),
            );
            const error: unknown = await client
                .searchActions()
                .catch((failure: unknown) => failure);
            expect(error).toBeInstanceOf(StructuredActionClientError);
            expect((error as StructuredActionClientError).dispatched).toBe(
                false,
            );
            expect((error as StructuredActionClientError).reason).toBe(
                "resume_failed",
            );
            expect(String(error)).not.toContain("private-test-capability");
            expect(fake.createConversation).not.toHaveBeenCalled();
            expect(
                fake.joinConversation.mock.calls[2][1]?.structuredActions,
            ).toEqual({
                resumeToken: "private-test-capability",
            });
        } finally {
            await client.close();
        }
    });

    it.each([
        ["invalid", "Invalid structured action resume capability"],
        [
            "wrong-conversation",
            "Structured action resume state is unavailable; do not replay an interrupted action",
        ],
        [
            "expired",
            "Structured action resume state is unavailable; do not replay an interrupted action",
        ],
        [
            "restarted-host",
            "Structured action resume state is unavailable; do not replay an interrupted action",
        ],
    ])(
        "preserves a safe explicit reason for %s resume rejection",
        async (_kind, serverMessage) => {
            const fake = fakeConnection();
            let disconnect: (() => void) | undefined;
            const client = new StructuredActionClient({
                conversationId: "public-id",
                connect: async (callback) => {
                    disconnect = callback;
                    return fake.connection;
                },
            });
            try {
                await client.searchActions();
                disconnect!();
                fake.joinConversation.mockRejectedValue(
                    new Error(serverMessage),
                );
                const outcome = await client
                    .searchActions()
                    .catch((error: unknown) => error);
                expect(outcome).toMatchObject({
                    dispatched: false,
                    reason: "resume_rejected",
                });
                expect(String(outcome)).toContain(
                    "No replacement owner was created",
                );
                expect(String(outcome)).not.toContain(
                    "private-test-capability",
                );
                expect(fake.createConversation).not.toHaveBeenCalled();
                expect(
                    fake.joinConversation.mock.calls[1][1]?.structuredActions,
                ).toEqual({
                    resumeToken: "private-test-capability",
                });
            } finally {
                await client.close();
            }
        },
    );

    it("does not connect or dispatch for an already-aborted call", async () => {
        const connect = jest.fn(async () => fakeConnection().connection);
        const client = new StructuredActionClient({ connect });
        const abort = new AbortController();
        abort.abort();
        await expect(
            client.searchActions({}, abort.signal),
        ).rejects.toMatchObject({ dispatched: false });
        expect(connect).not.toHaveBeenCalled();
        await client.close();
    });

    it("reports uncertain delivery on cancellation after dispatch without retrying", async () => {
        const fake = fakeConnection();
        let entered: (() => void) | undefined;
        let resolve: (() => void) | undefined;
        const started = new Promise<void>((done) => {
            entered = done;
        });
        const execute = jest.fn<
            ConversationDispatcher["dispatcher"]["executeAction"]
        >(async () => {
            entered!();
            await new Promise<void>((done) => {
                resolve = done;
            });
            throw new Error("Lost result containing private-test-capability");
        });
        fake.dispatcher.executeAction = execute;
        const client = new StructuredActionClient({
            connect: async () => fake.connection,
        });
        const abort = new AbortController();
        const pending = client.executeAction(
            {
                protocolVersion: 1,
                scopeId: "scope",
                fingerprint: "fingerprint",
                schemaName: "schema",
                actionName: "action",
            },
            abort.signal,
        );
        const outcome = pending.catch((error: unknown) => error);
        await started;
        abort.abort();
        expect(await outcome).toMatchObject({ dispatched: true });
        resolve!();
        await new Promise<void>((done) => setImmediate(done));
        expect(execute).toHaveBeenCalledTimes(1);
        expect(fake.joinConversation).toHaveBeenCalledTimes(1);
        await client.close();
    });

    it("singleflights concurrent connects and gives new processes different explicit named conversations", async () => {
        const fake = fakeConnection();
        const connect = jest.fn(async () => fake.connection);
        const first = new StructuredActionClient({ connect });
        const second = new StructuredActionClient({ connect });
        try {
            await Promise.all([
                first.searchActions(),
                first.searchActions(),
                first.searchActions(),
            ]);
            expect(connect).toHaveBeenCalledTimes(1);
            expect(fake.joinConversation).toHaveBeenCalledTimes(1);
            await second.searchActions();
            const firstOptions = fake.joinConversation.mock.calls[0][1]!;
            const secondOptions = fake.joinConversation.mock.calls[1][1]!;
            expect(firstOptions.conversationId).not.toBe(
                secondOptions.conversationId,
            );
            expect(firstOptions.structuredActions).toEqual({});
            expect(secondOptions.structuredActions).toEqual({});
            expect(JSON.stringify(first)).not.toContain(
                "private-test-capability",
            );
        } finally {
            await first.close();
            await second.close();
        }
    });

    it("never creates a replacement owner after losing the initial join reply", async () => {
        const fake = fakeConnection();
        fake.joinConversation.mockRejectedValue(new Error("Reply lost"));
        const connect = jest.fn(async () => fake.connection);
        const client = new StructuredActionClient({
            connect,
            conversationId: "explicit",
        });
        await expect(client.searchActions()).rejects.toThrow("not dispatched");
        await expect(client.searchActions()).rejects.toThrow(
            "No replacement owner was created",
        );
        expect(connect).toHaveBeenCalledTimes(1);
        expect(fake.createConversation).not.toHaveBeenCalled();
        await client.close();
    });

    it("does not fallback an explicit id on missing conversation or transport errors", async () => {
        const fake = fakeConnection();
        fake.joinConversation.mockRejectedValue(
            new Error("Conversation not found: configured"),
        );
        const client = new StructuredActionClient({
            connect: async () => fake.connection,
            conversationId: "configured",
        });
        await expect(client.searchActions()).rejects.toMatchObject({
            dispatched: false,
            reason: "conversation_not_found",
        });
        expect(fake.createConversation).not.toHaveBeenCalled();
        await client.close();
    });

    it("closes once and refuses new requests without asserting cancellation", async () => {
        const fake = fakeConnection();
        const client = new StructuredActionClient({
            connect: async () => fake.connection,
        });
        await client.searchActions();
        await client.close();
        await client.close();
        await expect(client.searchActions()).rejects.toBeInstanceOf(
            StructuredActionClientError,
        );
        expect(fake.close).toHaveBeenCalledTimes(1);
    });
});
