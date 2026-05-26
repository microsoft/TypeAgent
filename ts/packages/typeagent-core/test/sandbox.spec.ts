// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    InProcessEventStream,
} from "../src/events/index.js";
import type {
    SandboxLifecycleEvent,
    StudioEvent,
} from "../src/events/index.js";
import {
    InMemorySandboxManager,
    SandboxAlreadyExistsError,
    UnknownSandboxError,
    UnsupportedSandboxModeError,
    type AgentLoader,
    type SandboxConfig,
} from "../src/sandbox/index.js";

function baseConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
    return {
        id: "studio-default",
        mode: "inmemory",
        profileDir: "/tmp/typeagent-test",
        agents: [],
        ...overrides,
    };
}

function lifecycleTypes(events: StudioEvent[]): string[] {
    return events
        .filter(
            (e): e is SandboxLifecycleEvent =>
                e.type.startsWith("sandbox."),
        )
        .map((e) => e.type);
}

function lifecycleEvents(events: StudioEvent[]): SandboxLifecycleEvent[] {
    return events.filter(
        (e): e is SandboxLifecycleEvent => e.type.startsWith("sandbox."),
    );
}

describe("InMemorySandboxManager — start", () => {
    it("rejects subprocess mode until the transport stub lands", async () => {
        const stream = new InProcessEventStream();
        const mgr = new InMemorySandboxManager({ emitter: stream });
        await expect(
            mgr.start(baseConfig({ mode: "subprocess" })),
        ).rejects.toBeInstanceOf(UnsupportedSandboxModeError);
    });

    it("rejects starting the same id twice", async () => {
        const stream = new InProcessEventStream();
        const mgr = new InMemorySandboxManager({ emitter: stream });
        await mgr.start(baseConfig());
        await expect(mgr.start(baseConfig())).rejects.toBeInstanceOf(
            SandboxAlreadyExistsError,
        );
    });

    it("emits a single sandbox.start event when no initial agents are configured", async () => {
        const stream = new InProcessEventStream();
        const captured: StudioEvent[] = [];
        stream.subscribe((e) => captured.push(e));

        const mgr = new InMemorySandboxManager({ emitter: stream });
        const handle = await mgr.start(baseConfig());

        expect(handle.id).toBe("studio-default");
        expect(lifecycleTypes(captured)).toEqual(["sandbox.start"]);
        expect(lifecycleEvents(captured)[0].state).toBe("running");
    });

    it("emits agent.loaded events before the sandbox.start event for initial agents", async () => {
        const stream = new InProcessEventStream();
        const captured: StudioEvent[] = [];
        stream.subscribe((e) => captured.push(e));

        const mgr = new InMemorySandboxManager({ emitter: stream });
        await mgr.start(
            baseConfig({ agents: ["/abs/path/player.ts", "calendar"] }),
        );

        expect(lifecycleTypes(captured)).toEqual([
            "sandbox.agent.loaded",
            "sandbox.agent.loaded",
            "sandbox.start",
        ]);
        const loaded = lifecycleEvents(captured).filter(
            (e) => e.type === "sandbox.agent.loaded",
        );
        expect(loaded.map((e) => e.affectedAgent)).toEqual([
            "player",
            "calendar",
        ]);
    });

    it("emits no events and registers no sandbox when initial agent load fails", async () => {
        const stream = new InProcessEventStream();
        const captured: StudioEvent[] = [];
        stream.subscribe((e) => captured.push(e));

        const loader: AgentLoader = async () => {
            throw new Error("boom");
        };
        const mgr = new InMemorySandboxManager({
            emitter: stream,
            agentLoader: loader,
        });

        await expect(
            mgr.start(baseConfig({ agents: ["bad"] })),
        ).rejects.toThrow("boom");
        expect(lifecycleTypes(captured)).toEqual([]);
        expect(await mgr.list()).toEqual([]);
    });

    it("stamps events with the configured clock", async () => {
        const stream = new InProcessEventStream();
        const captured: StudioEvent[] = [];
        stream.subscribe((e) => captured.push(e));

        const clock = () => 1_700_000_000_000;
        const mgr = new InMemorySandboxManager({ emitter: stream, now: clock });
        await mgr.start(baseConfig());

        const ev = lifecycleEvents(captured)[0];
        expect(ev.ts).toBe(1_700_000_000_000);
        expect(ev.schemaVersion).toBe(1);
    });
});

describe("InMemorySandboxManager — status / list", () => {
    it("status returns running with loaded agents after start", async () => {
        const stream = new InProcessEventStream();
        const mgr = new InMemorySandboxManager({ emitter: stream });
        await mgr.start(baseConfig({ agents: ["player"] }));

        const status = await mgr.status("studio-default");
        expect(status.state).toBe("running");
        expect(status.agents.map((a) => a.name)).toEqual(["player"]);
        expect(status.agents[0].health).toBe("unknown");
        expect(status.startedAt).toBeGreaterThan(0);
        expect(status.pid).toBeUndefined();
    });

    it("status throws UnknownSandboxError for an unknown id", async () => {
        const stream = new InProcessEventStream();
        const mgr = new InMemorySandboxManager({ emitter: stream });
        await expect(mgr.status("does-not-exist")).rejects.toBeInstanceOf(
            UnknownSandboxError,
        );
    });

    it("list returns all registered sandboxes", async () => {
        const stream = new InProcessEventStream();
        const mgr = new InMemorySandboxManager({ emitter: stream });
        await mgr.start(baseConfig({ id: "a" }));
        await mgr.start(baseConfig({ id: "b" }));
        const all = await mgr.list();
        expect(all.map((s) => s.id).sort()).toEqual(["a", "b"]);
    });
});

describe("InMemorySandboxManager — load / unload agent", () => {
    it("loadAgent emits agent.loaded and updates status", async () => {
        const stream = new InProcessEventStream();
        const captured: StudioEvent[] = [];
        stream.subscribe((e) => captured.push(e));

        const mgr = new InMemorySandboxManager({ emitter: stream });
        await mgr.start(baseConfig());
        captured.length = 0;

        await mgr.loadAgent("studio-default", "/abs/email.ts");
        expect(lifecycleTypes(captured)).toEqual(["sandbox.agent.loaded"]);
        const status = await mgr.status("studio-default");
        expect(status.agents.map((a) => a.name)).toEqual(["email"]);
    });

    it("unloadAgent emits agent.unloaded when the agent is present", async () => {
        const stream = new InProcessEventStream();
        const captured: StudioEvent[] = [];
        stream.subscribe((e) => captured.push(e));

        const mgr = new InMemorySandboxManager({ emitter: stream });
        await mgr.start(baseConfig({ agents: ["player"] }));
        captured.length = 0;

        await mgr.unloadAgent("studio-default", "player");
        expect(lifecycleTypes(captured)).toEqual(["sandbox.agent.unloaded"]);
        const status = await mgr.status("studio-default");
        expect(status.agents).toEqual([]);
    });

    it("unloadAgent is a no-op for an unknown agent name", async () => {
        const stream = new InProcessEventStream();
        const captured: StudioEvent[] = [];
        stream.subscribe((e) => captured.push(e));

        const mgr = new InMemorySandboxManager({ emitter: stream });
        await mgr.start(baseConfig());
        captured.length = 0;

        await mgr.unloadAgent("studio-default", "ghost");
        expect(lifecycleTypes(captured)).toEqual([]);
    });

    it("loadAgent on unknown sandbox throws", async () => {
        const stream = new InProcessEventStream();
        const mgr = new InMemorySandboxManager({ emitter: stream });
        await expect(mgr.loadAgent("nope", "x")).rejects.toBeInstanceOf(
            UnknownSandboxError,
        );
    });

    it("uses a custom agent loader when provided", async () => {
        const stream = new InProcessEventStream();
        const calls: Array<[string, string]> = [];
        const loader: AgentLoader = async (id, ref) => {
            calls.push([id, ref]);
            return {
                name: `loaded:${ref}`,
                schemaHash: "sh",
                grammarHash: "gh",
                health: "healthy",
                sourcePath: ref,
            };
        };

        const mgr = new InMemorySandboxManager({
            emitter: stream,
            agentLoader: loader,
        });
        await mgr.start(baseConfig({ agents: ["player"] }));

        const status = await mgr.status("studio-default");
        expect(status.agents[0].name).toBe("loaded:player");
        expect(status.agents[0].health).toBe("healthy");
        expect(calls).toEqual([["studio-default", "player"]]);
    });
});

describe("InMemorySandboxManager — restart / stop", () => {
    it("restart emits unload of old agents, load of new agents, then sandbox.restart", async () => {
        const stream = new InProcessEventStream();
        const captured: StudioEvent[] = [];
        stream.subscribe((e) => captured.push(e));

        const mgr = new InMemorySandboxManager({ emitter: stream });
        await mgr.start(baseConfig({ agents: ["player"] }));
        captured.length = 0;

        await mgr.restart("studio-default");

        expect(lifecycleTypes(captured)).toEqual([
            "sandbox.agent.unloaded",
            "sandbox.agent.loaded",
            "sandbox.restart",
        ]);
        const restart = lifecycleEvents(captured).find(
            (e) => e.type === "sandbox.restart",
        );
        expect(restart?.state).toBe("running");
    });

    it("stop emits agent.unloaded for each agent then sandbox.stop and removes the sandbox", async () => {
        const stream = new InProcessEventStream();
        const captured: StudioEvent[] = [];
        stream.subscribe((e) => captured.push(e));

        const mgr = new InMemorySandboxManager({ emitter: stream });
        await mgr.start(baseConfig({ agents: ["player", "calendar"] }));
        captured.length = 0;

        await mgr.stop("studio-default");

        expect(lifecycleTypes(captured)).toEqual([
            "sandbox.agent.unloaded",
            "sandbox.agent.unloaded",
            "sandbox.stop",
        ]);
        await expect(mgr.status("studio-default")).rejects.toBeInstanceOf(
            UnknownSandboxError,
        );
        expect(await mgr.list()).toEqual([]);
    });

    it("stop and restart reject unknown sandbox ids", async () => {
        const stream = new InProcessEventStream();
        const mgr = new InMemorySandboxManager({ emitter: stream });
        await expect(mgr.stop("nope")).rejects.toBeInstanceOf(
            UnknownSandboxError,
        );
        await expect(mgr.restart("nope")).rejects.toBeInstanceOf(
            UnknownSandboxError,
        );
    });
});
