// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import type { SandboxStatus } from "@typeagent/core/sandbox";
import {
    buildSandboxAgentNodes,
    buildSandboxRootNodes,
    formatHealth,
    formatSandboxState,
} from "../sandboxTreePresentation.js";

function createSandbox(overrides: Partial<SandboxStatus> = {}): SandboxStatus {
    return {
        id: "studio-default",
        mode: "inmemory",
        state: "running",
        agents: [],
        ...overrides,
    };
}

test("buildSandboxRootNodes returns a placeholder when there are no sandboxes", () => {
    const nodes = buildSandboxRootNodes([]);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "empty");
    assert.equal(nodes[0].hasChildren, false);
    assert.equal(nodes[0].label, "No sandboxes running");
});

test("buildSandboxRootNodes maps each sandbox and sorts by id", () => {
    const nodes = buildSandboxRootNodes([
        createSandbox({ id: "zeta" }),
        createSandbox({ id: "alpha" }),
    ]);
    assert.deepEqual(
        nodes.map((n) => n.label),
        ["alpha", "zeta"],
    );
    assert.ok(nodes.every((n) => n.kind === "sandbox"));
    assert.ok(nodes.every((n) => n.hasChildren));
});

test("sandbox node description summarizes state and agent count", () => {
    const [node] = buildSandboxRootNodes([
        createSandbox({
            state: "running",
            agents: [
                {
                    name: "calendar",
                    schemaHash: "abc",
                    grammarHash: "def",
                    health: "healthy",
                },
            ],
        }),
    ]);
    assert.equal(node.description, "Running · 1 agent");
    assert.equal(node.contextValue, "sandbox.running");
    assert.equal(node.sandboxId, "studio-default");
});

test("sandbox node description pluralizes agents and appends non-inmemory mode", () => {
    const [node] = buildSandboxRootNodes([
        createSandbox({
            mode: "subprocess",
            state: "stopped",
            agents: [
                {
                    name: "a",
                    schemaHash: "h",
                    grammarHash: "h",
                    health: "unknown",
                },
                {
                    name: "b",
                    schemaHash: "h",
                    grammarHash: "h",
                    health: "unknown",
                },
            ],
        }),
    ]);
    assert.equal(node.description, "Stopped · 2 agents · subprocess");
});

test("buildSandboxAgentNodes returns a placeholder when no agents are loaded", () => {
    const nodes = buildSandboxAgentNodes(createSandbox({ agents: [] }));
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].kind, "empty");
    assert.equal(nodes[0].label, "No agents loaded");
    assert.equal(nodes[0].sandboxId, "studio-default");
});

test("buildSandboxAgentNodes maps agents sorted by name", () => {
    const nodes = buildSandboxAgentNodes(
        createSandbox({
            agents: [
                {
                    name: "list",
                    schemaHash: "s2",
                    grammarHash: "g2",
                    health: "warning",
                },
                {
                    name: "calendar",
                    schemaHash: "s1",
                    grammarHash: "g1",
                    health: "healthy",
                },
            ],
        }),
    );
    assert.deepEqual(
        nodes.map((n) => n.label),
        ["calendar", "list"],
    );
    assert.equal(nodes[0].kind, "agent");
    assert.equal(nodes[0].agentName, "calendar");
    assert.equal(nodes[0].description, "healthy");
    assert.equal(nodes[0].contextValue, "sandboxAgent");
    assert.equal(nodes[1].description, "warning");
});

test("formatSandboxState covers every state literal", () => {
    assert.equal(formatSandboxState("starting"), "Starting");
    assert.equal(formatSandboxState("running"), "Running");
    assert.equal(formatSandboxState("stopping"), "Stopping");
    assert.equal(formatSandboxState("stopped"), "Stopped");
    assert.equal(formatSandboxState("crashed"), "Crashed");
});

test("formatHealth maps known statuses and defaults unknown", () => {
    assert.equal(formatHealth("healthy"), "healthy");
    assert.equal(formatHealth("warning"), "warning");
    assert.equal(formatHealth("error"), "error");
    assert.equal(formatHealth("unknown"), "unknown");
});
