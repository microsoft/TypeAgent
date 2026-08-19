// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getMacroFeatures } from "../src/shared/macro-features.js";

const names = [
    "TYPEAGENT_MACRO_RECORDING_ENABLED",
    "TYPEAGENT_MACRO_INDUCTION_ENABLED",
    "TYPEAGENT_MACRO_REPLAY_ENABLED",
    "TYPEAGENT_MACRO_AGENT_HANDOFF_ENABLED",
] as const;

describe("macro feature flags", () => {
    const original = Object.fromEntries(
        names.map((name) => [name, process.env[name]]),
    );

    afterEach(() => {
        for (const name of names) {
            const value = original[name];
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    });

    it("enables every boundary by default", () => {
        for (const name of names) delete process.env[name];

        expect(getMacroFeatures()).toEqual({
            recording: true,
            induction: true,
            replay: true,
            agentHandoff: true,
        });
    });

    it.each(["0", "false", "off"])("recognizes %s as disabled", (value) => {
        for (const name of names) process.env[name] = value;

        expect(getMacroFeatures()).toEqual({
            recording: false,
            induction: false,
            replay: false,
            agentHandoff: false,
        });
    });
});
