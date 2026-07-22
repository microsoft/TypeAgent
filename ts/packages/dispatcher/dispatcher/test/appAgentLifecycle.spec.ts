// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { AppAgentEvent } from "@typeagent/agent-sdk";
import { AppAgentProvider } from "../src/agentProvider/agentProvider.js";
import { AppAgentManager } from "../src/context/appAgentManager.js";
import {
    emitAgentChangeNotification,
    reconcileKnownAgents,
} from "../src/context/commandHandlerContext.js";
import { PortRegistrar } from "../src/context/portRegistrar.js";

function fakeProvider(name: string): AppAgentProvider {
    return {
        getAppAgentNames: () => [name],
        getAppAgentManifest: async () => ({}) as any,
        loadAppAgent: async () => ({}) as any,
        unloadAppAgent: async () => {},
    };
}

describe("AppAgentManager.removeProvider", () => {
    it("is a no-op for a provider whose agent was never registered", async () => {
        const manager = new AppAgentManager(undefined, new PortRegistrar());

        await expect(
            manager.removeProvider(fakeProvider("never-registered")),
        ).resolves.toBeUndefined();
        expect(manager.getAppAgentNames()).toEqual([]);
    });

    it("tears down a registered single-agent provider", async () => {
        const manager = new AppAgentManager(undefined, new PortRegistrar());
        let unloaded: string | undefined;
        const provider: AppAgentProvider = {
            getAppAgentNames: () => ["foo"],
            getAppAgentManifest: async () => ({}) as any,
            loadAppAgent: async () => ({}) as any,
            unloadAppAgent: async (name: string) => {
                unloaded = name;
            },
        };

        (manager as any).agents.set("foo", {
            name: "foo",
            provider,
            schemas: new Set<string>(["foo"]),
            actions: new Set<string>(),
            commands: false,
            manifest: { description: "foo", emojiChar: "🤖" },
            appAgent: {},
            schemaErrors: new Map(),
        });
        (manager as any).actionConfigs.set("foo", {
            schemaName: "foo",
            transient: false,
        });

        await manager.removeProvider(provider);

        expect(manager.getAppAgentNames()).toEqual([]);
        expect(manager.getSchemaNames()).not.toContain("foo");
        expect(unloaded).toBe("foo");
    });
});

describe("emitAgentChangeNotification", () => {
    function captureClientIO() {
        const messages: string[] = [];
        const events: string[] = [];
        return {
            messages,
            events,
            clientIO: {
                notify: (
                    _requestId: unknown,
                    event: string,
                    message: string,
                ) => {
                    events.push(event);
                    messages.push(message);
                },
            } as any,
        };
    }

    it("reports a disabled add with the enable command", () => {
        const { messages, clientIO } = captureClientIO();
        emitAgentChangeNotification(
            clientIO,
            "add",
            fakeProvider("foo"),
            false,
        );
        expect(messages).toEqual([
            "Agent 'foo' was added — disabled (`@config agent foo` to enable).",
        ]);
    });

    it("reports an enabled add", () => {
        const { messages, clientIO } = captureClientIO();
        emitAgentChangeNotification(clientIO, "add", fakeProvider("foo"), true);
        expect(messages).toEqual(["Agent 'foo' was added — enabled."]);
    });

    it("uses an inline event", () => {
        const { events, clientIO } = captureClientIO();
        emitAgentChangeNotification(clientIO, "add", fakeProvider("foo"), true);
        expect(events).toEqual([AppAgentEvent.Inline]);
    });

    it("reports removal", () => {
        const { messages, clientIO } = captureClientIO();
        emitAgentChangeNotification(
            clientIO,
            "remove",
            fakeProvider("foo"),
            false,
        );
        expect(messages).toEqual(["Agent 'foo' was removed."]);
    });

    it("reports enabled and disabled updates", () => {
        const enabled = captureClientIO();
        emitAgentChangeNotification(
            enabled.clientIO,
            "update",
            fakeProvider("foo"),
            true,
        );
        expect(enabled.messages).toEqual(["Agent 'foo' was updated."]);

        const disabled = captureClientIO();
        emitAgentChangeNotification(
            disabled.clientIO,
            "update",
            fakeProvider("foo"),
            false,
        );
        expect(disabled.messages).toEqual([
            "Agent 'foo' was updated — disabled (`@config agent foo` to enable).",
        ]);
    });
});

describe("reconcileKnownAgents", () => {
    function makeContext(options: {
        available: string[];
        known: string[] | undefined;
        enabled?: string[];
    }) {
        const enabled = new Set(options.enabled ?? options.available);
        const messages: string[] = [];
        let saved: string[] | undefined;
        const context = {
            agents: {
                getAppAgentNames: () => options.available,
                isCommandEnabled: (name: string) => enabled.has(name),
                getSchemaNames: () => [] as string[],
                isSchemaEnabled: () => false,
            },
            session: {
                getKnownAgents: () => options.known,
                setKnownAgents: (names: readonly string[]) => {
                    saved = [...names];
                },
            },
            clientIO: {
                notify: (
                    _requestId: unknown,
                    _event: unknown,
                    message: string,
                ) => {
                    messages.push(message);
                },
            },
        } as any;
        return { context, messages, getSaved: () => saved };
    }

    it("records a silent baseline when no known set exists", () => {
        const { context, messages, getSaved } = makeContext({
            available: ["browser", "email"],
            known: undefined,
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual([]);
        expect(getSaved()).toEqual(["browser", "email"]);
    });

    it("reports agents that appeared while offline", () => {
        const { context, messages, getSaved } = makeContext({
            available: ["browser", "email"],
            known: ["browser"],
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual(["Agent set changed: email added — enabled."]);
        expect(getSaved()).toEqual(["browser", "email"]);
    });

    it("reports a disabled appeared agent with the enable command", () => {
        const { context, messages } = makeContext({
            available: ["browser", "email"],
            known: ["browser"],
            enabled: ["browser"],
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual([
            "Agent set changed: email added — disabled (`@config agent email` to enable).",
        ]);
    });

    it("reports agents that disappeared while offline", () => {
        const { context, messages, getSaved } = makeContext({
            available: ["browser"],
            known: ["browser", "email"],
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual(["Agent set changed: email removed."]);
        expect(getSaved()).toEqual(["browser"]);
    });

    it("summarizes mixed changes", () => {
        const { context, messages } = makeContext({
            available: ["browser", "player"],
            known: ["browser", "email"],
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual([
            "Agent set changed: player added — enabled; email removed.",
        ]);
    });

    it("stays silent when nothing changed", () => {
        const { context, messages, getSaved } = makeContext({
            available: ["browser", "email"],
            known: ["browser", "email"],
        });
        reconcileKnownAgents(context);
        expect(messages).toEqual([]);
        expect(getSaved()).toEqual(["browser", "email"]);
    });
});
