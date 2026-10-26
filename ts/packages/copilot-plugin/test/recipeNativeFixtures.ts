// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { SessionEvent } from "@github/copilot-sdk";
import type { NativeRecipeSession } from "../src/extension/recipe-native-host.js";

export function nativeEvent(
    type: string,
    data: Record<string, unknown> = {},
    agentId?: string,
): SessionEvent {
    return {
        type,
        data,
        id: `${type}-event`,
        parentId: null,
        timestamp: new Date().toISOString(),
        ...(agentId ? { agentId } : {}),
    } as unknown as SessionEvent;
}

type FixtureTool = {
    name: string;
    description: string;
    mcpServerName?: string;
    mcpToolName?: string;
    input_schema: {
        type: string;
        properties: { path: { type: string; description: string } };
        required: string[];
        additionalProperties: boolean;
    };
};

interface NativeFixture {
    session: NativeRecipeSession;
    emit(type: string, data?: Record<string, unknown>, agentId?: string): void;
    execute: jest.Mock<
        (input: {
            name: string;
            arguments: unknown;
            toolCallId?: string;
        }) => Promise<unknown>
    >;
    tools: FixtureTool[];
    schema: FixtureTool["input_schema"];
    metadata: {
        sessionId: string;
        workingDirectory: string;
        startTime: string;
        isRemote: boolean;
    };
    auth: {
        isAuthenticated: boolean;
        authType: string;
        login: string;
        host: string;
    };
    abort: jest.Mock<() => Promise<void>>;
    shutdown: jest.Mock<() => Promise<void>>;
    snapshot: jest.Mock<() => Promise<NativeFixture["metadata"]>>;
    getStatus: jest.Mock<() => Promise<NativeFixture["auth"]>>;
    getCurrentMetadata: jest.Mock<() => Promise<{ tools: FixtureTool[] }>>;
}

export function nativeFixture(id = "root"): NativeFixture {
    const listeners = new Set<(event: SessionEvent) => void>();
    const emit = (
        type: string,
        data: Record<string, unknown> = {},
        agentId?: string,
    ) => {
        for (const listener of listeners)
            listener(nativeEvent(type, data, agentId));
    };
    const schema = {
        type: "object",
        properties: { path: { type: "string", description: "Fixture path" } },
        required: ["path"],
        additionalProperties: false,
    };
    const tools = [
        { name: "view", description: "Read", input_schema: schema },
        {
            name: "mcp_fixture_read",
            description: "Read",
            mcpServerName: "fixture",
            mcpToolName: "read",
            input_schema: schema,
        },
    ];
    const metadata = {
        sessionId: id,
        workingDirectory: process.cwd(),
        startTime: "2026-10-15T00:00:00Z",
        isRemote: false,
    };
    const auth = {
        isAuthenticated: true,
        authType: "user",
        login: "fixture-account",
        host: "https://github.com",
    };
    const execute = jest.fn(
        async (_input: {
            name: string;
            arguments: unknown;
            toolCallId?: string;
        }): Promise<unknown> => ({
            resultType: "success",
            textResultForLlm: "fixture-read",
        }),
    );
    const snapshot = jest.fn(async () => metadata);
    const getStatus = jest.fn(async () => auth);
    const getCurrentMetadata = jest.fn(async () => ({ tools }));
    const abort = jest.fn(async () => {});
    const shutdown = jest.fn(async () => {});
    const session = {
        sessionId: id,
        on: (listener: (event: SessionEvent) => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        rpc: {
            metadata: { snapshot },
            gitHubAuth: { getStatus },
            tools: {
                initializeAndValidate: jest.fn(async () => ({})),
                getCurrentMetadata,
                execute,
            },
            shutdown,
        },
        abort,
    } as unknown as NativeRecipeSession;
    return {
        session,
        emit,
        execute,
        tools,
        schema,
        metadata,
        auth,
        abort,
        shutdown,
        snapshot,
        getStatus,
        getCurrentMetadata,
    };
}

export function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
