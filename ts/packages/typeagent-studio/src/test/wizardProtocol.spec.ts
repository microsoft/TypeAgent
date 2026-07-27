// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { ONBOARDING_PHASE_ORDER } from "@typeagent/core/onboardingBridge";
import {
    parseWizardMessage,
    PHASE_NAMES,
} from "../webviewKit/wizardProtocol.js";

test("PHASE_NAMES matches the canonical onboarding phase order", () => {
    // The client narrows without importing the runtime value (which would drag
    // node built-ins into the browser bundle); this pins the local copy.
    assert.deepEqual([...PHASE_NAMES], [...ONBOARDING_PHASE_ORDER]);
});

test("parseWizardMessage accepts parameterless messages", () => {
    for (const type of [
        "ready",
        "runRemaining",
        "rerunStale",
        "install",
        "checkHealth",
        "clear",
    ] as const) {
        assert.deepEqual(parseWizardMessage({ type }), { type });
    }
});

test("parseWizardMessage narrows a start message and trims fields", () => {
    assert.deepEqual(
        parseWizardMessage({ type: "start", description: "  thermostat  " }),
        { type: "start", description: "thermostat" },
    );
    assert.deepEqual(
        parseWizardMessage({
            type: "start",
            description: "thermostat",
            agentName: "  my-agent ",
        }),
        { type: "start", description: "thermostat", agentName: "my-agent" },
    );
    // Empty/whitespace agentName is dropped; empty description is rejected.
    assert.deepEqual(
        parseWizardMessage({
            type: "start",
            description: "thermostat",
            agentName: "   ",
        }),
        { type: "start", description: "thermostat" },
    );
    assert.equal(
        parseWizardMessage({ type: "start", description: "   " }),
        undefined,
    );
    assert.equal(parseWizardMessage({ type: "start" }), undefined);
});

test("parseWizardMessage narrows phase-scoped messages", () => {
    for (const phase of ONBOARDING_PHASE_ORDER) {
        assert.deepEqual(parseWizardMessage({ type: "runPhase", phase }), {
            type: "runPhase",
            phase,
        });
        assert.deepEqual(parseWizardMessage({ type: "restorePhase", phase }), {
            type: "restorePhase",
            phase,
        });
    }
    // Unknown phase names are rejected.
    assert.equal(
        parseWizardMessage({ type: "runPhase", phase: "Nope" }),
        undefined,
    );
    assert.equal(parseWizardMessage({ type: "runPhase" }), undefined);
});

test("parseWizardMessage rejects malformed or unknown messages", () => {
    assert.equal(parseWizardMessage(undefined), undefined);
    assert.equal(parseWizardMessage(null), undefined);
    assert.equal(parseWizardMessage("start"), undefined);
    assert.equal(parseWizardMessage(42), undefined);
    assert.equal(parseWizardMessage({}), undefined);
    assert.equal(parseWizardMessage({ type: "bogus" }), undefined);
});
