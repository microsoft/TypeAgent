// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import type { HealthStatus, SandboxStatus } from "@typeagent/core/sandbox";
import { summarizeAgentHealth } from "../healthStatusPresentation.js";

function sandbox(id: string, agentHealth: HealthStatus[]): SandboxStatus {
    return {
        id,
        mode: "inmemory",
        state: "running",
        agents: agentHealth.map((health, i) => ({
            name: `${id}-agent-${i}`,
            schemaHash: "s",
            grammarHash: "g",
            health,
        })),
    };
}

test("summarizeAgentHealth reports 'none' when there are no sandboxes", () => {
    const summary = summarizeAgentHealth([]);
    assert.equal(summary.level, "none");
    assert.equal(summary.label, "Studio: no agents");
    assert.equal(summary.icon, "circle-slash");
    assert.equal(summary.agentsTotal, 0);
    assert.equal(summary.sandboxesTotal, 0);
});

test("summarizeAgentHealth reports 'none' when sandboxes have no agents", () => {
    const summary = summarizeAgentHealth([sandbox("a", [])]);
    assert.equal(summary.level, "none");
    assert.equal(summary.sandboxesTotal, 1);
    assert.match(summary.tooltip, /No agents loaded/);
});

test("summarizeAgentHealth reports healthy when all agents are healthy", () => {
    const summary = summarizeAgentHealth([
        sandbox("a", ["healthy", "healthy"]),
    ]);
    assert.equal(summary.level, "healthy");
    assert.equal(summary.label, "Studio: healthy");
    assert.equal(summary.icon, "pass");
    assert.equal(summary.agentsTotal, 2);
});

test("summarizeAgentHealth lets error dominate warning and unknown", () => {
    const summary = summarizeAgentHealth([
        sandbox("a", ["healthy", "warning"]),
        sandbox("b", ["unknown", "error"]),
    ]);
    assert.equal(summary.level, "error");
    assert.equal(summary.label, "Studio: 1 error");
    assert.equal(summary.icon, "error");
    assert.deepEqual(summary.counts, {
        healthy: 1,
        warning: 1,
        error: 1,
        unknown: 1,
    });
});

test("summarizeAgentHealth pluralizes the dominant count", () => {
    const summary = summarizeAgentHealth([
        sandbox("a", ["warning", "warning", "healthy"]),
    ]);
    assert.equal(summary.level, "warning");
    assert.equal(summary.label, "Studio: 2 warnings");
    assert.equal(summary.icon, "warning");
});

test("summarizeAgentHealth surfaces unknown when it is the worst", () => {
    const summary = summarizeAgentHealth([
        sandbox("a", ["healthy", "unknown"]),
    ]);
    assert.equal(summary.level, "unknown");
    assert.equal(summary.label, "Studio: health unknown");
    assert.equal(summary.icon, "question");
});

test("summarizeAgentHealth tooltip omits zero-count rows", () => {
    const summary = summarizeAgentHealth([sandbox("a", ["healthy"])]);
    assert.match(summary.tooltip, /healthy: 1/);
    assert.doesNotMatch(summary.tooltip, /error:/);
    assert.doesNotMatch(summary.tooltip, /warning:/);
});
