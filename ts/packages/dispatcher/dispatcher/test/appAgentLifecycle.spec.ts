// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, it } from "@jest/globals";
import { AppAgent, AppAgentEvent, SessionContext } from "@typeagent/agent-sdk";
import { AppAgentProvider } from "../src/agentProvider/agentProvider.js";
import { AppAgentManager } from "../src/context/appAgentManager.js";
import {
    CommandHandlerContext,
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

function createLifecycleHarness(appAgent: AppAgent) {
    const portRegistrar = new PortRegistrar();
    const manager = new AppAgentManager(undefined, portRegistrar);
    const record = {
        name: "lifecycle",
        schemas: new Set<string>(),
        actions: new Set<string>(),
        commands: false,
        manifest: { commandDefaultEnabled: true },
        appAgent,
        sessionContext: undefined as SessionContext | undefined,
        sessionContextP: undefined as Promise<SessionContext> | undefined,
        sessionContextId: undefined as string | undefined,
        schemaErrors: new Map(),
    };
    (manager as any).agents.set(record.name, record);
    const context = {
        agents: manager,
        portRegistrar,
        session: {
            getSessionDirPath: () => undefined,
        },
    } as unknown as CommandHandlerContext;
    return { context, manager, portRegistrar, record };
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

describe("AppAgentManager startup rollback", () => {
    it("stops and closes a partially started agent before releasing its ports", async () => {
        const startupError = new Error("startup failed");
        const calls: string[] = [];
        let portRegistrar: PortRegistrar;
        const harness = createLifecycleHarness({
            startBackgroundTasks: async (sessionContext) => {
                calls.push("start");
                sessionContext.registerPort("background", 43123);
                throw startupError;
            },
            stopBackgroundTasks: async () => {
                calls.push("stop");
                expect(portRegistrar.lookup("lifecycle", "background")).toBe(
                    43123,
                );
            },
            closeAgentContext: async () => {
                calls.push("close");
                expect(portRegistrar.lookup("lifecycle", "background")).toBe(
                    43123,
                );
            },
        });
        portRegistrar = harness.portRegistrar;
        const { context, manager } = harness;

        const result = await manager.setState(context);

        expect(result.failed.commands).toEqual([
            ["lifecycle", true, startupError],
        ]);
        expect(calls).toEqual(["start", "stop", "close"]);
        expect(portRegistrar.lookup("lifecycle", "background")).toBeUndefined();
    });

    it("does not replace the startup error when rollback cleanup fails", async () => {
        const startupError = new Error("startup failed");
        const calls: string[] = [];
        const { context, manager, portRegistrar } = createLifecycleHarness({
            startBackgroundTasks: async () => {
                throw startupError;
            },
            stopBackgroundTasks: async () => {
                calls.push("stop");
                throw new Error("stop failed");
            },
            closeAgentContext: async () => {
                calls.push("close");
                throw new Error("close failed");
            },
        });
        portRegistrar.releaseAllForSession = () => {
            calls.push("release");
            throw new Error("release failed");
        };

        const result = await manager.setState(context);

        expect(result.failed.commands[0]?.[2]).toBe(startupError);
        expect(calls).toEqual(["stop", "close", "release"]);
    });

    it("retries startup with a fresh context after rollback", async () => {
        const startupError = new Error("startup failed");
        const startedContexts: SessionContext[] = [];
        let initializeCount = 0;
        const { context, manager } = createLifecycleHarness({
            initializeAgentContext: async () => ({
                attempt: ++initializeCount,
            }),
            startBackgroundTasks: async (sessionContext) => {
                startedContexts.push(sessionContext);
                if (startedContexts.length === 1) {
                    throw startupError;
                }
            },
        });

        const first = await manager.setState(context);
        const second = await manager.setState(context);

        expect(first.failed.commands[0]?.[2]).toBe(startupError);
        expect(second.failed.commands).toEqual([]);
        expect(second.changed.commands).toEqual([["lifecycle", true]]);
        expect(startedContexts).toHaveLength(2);
        expect(startedContexts[1]).not.toBe(startedContexts[0]);
        expect(startedContexts.map((item) => item.agentContext)).toEqual([
            { attempt: 1 },
            { attempt: 2 },
        ]);
        expect(manager.getSessionContext("lifecycle")).toBe(startedContexts[1]);
    });

    it("preserves cached failures before a session context is created", async () => {
        const initializationError = new Error("initialization failed");
        let initializeCount = 0;
        const { context, manager } = createLifecycleHarness({
            initializeAgentContext: async () => {
                initializeCount++;
                throw initializationError;
            },
        });

        const first = await manager.setState(context);
        const second = await manager.setState(context);

        expect(first.failed.commands[0]?.[2]).toBe(initializationError);
        expect(second.failed.commands[0]?.[2]).toBe(initializationError);
        expect(initializeCount).toBe(1);
    });

    it("does not clear a newer session when an older startup fails", async () => {
        const startupError = new Error("older startup failed");
        let rejectOlderStartup: (() => void) | undefined;
        let startCount = 0;
        let olderSessionContextId: string | undefined;
        const rolledBackIds: string[] = [];
        const { context, manager, portRegistrar, record } =
            createLifecycleHarness({
                startBackgroundTasks: async (sessionContext) => {
                    startCount++;
                    sessionContext.registerPort(
                        "background",
                        43123 + startCount,
                    );
                    if (startCount === 1) {
                        olderSessionContextId = sessionContext.sessionContextId;
                        await new Promise<void>((resolve) => {
                            rejectOlderStartup = resolve;
                        });
                        throw startupError;
                    }
                },
                stopBackgroundTasks: async (sessionContext) => {
                    rolledBackIds.push(sessionContext.sessionContextId);
                },
            });

        const older = (manager as any).initializeSessionContext(
            record,
            context,
        ) as Promise<SessionContext>;
        while (rejectOlderStartup === undefined) {
            await Promise.resolve();
        }
        const newer = await (manager as any).initializeSessionContext(
            record,
            context,
        );
        rejectOlderStartup();

        await expect(older).rejects.toBe(startupError);
        expect(record.sessionContext).toBe(newer);
        expect(record.sessionContextId).toBe(newer.sessionContextId);
        expect(portRegistrar.lookup("lifecycle", "background")).toBe(43125);
        expect(rolledBackIds).toEqual([olderSessionContextId]);
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
