// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isInitiativeSubject,
    normalizeInitiativeSelector,
} from "../src/initiativeDiscovery.js";
import { validateMaintenanceRequest } from "../src/viewMaintenanceValidation.js";

describe("indexed initiative nomination", () => {
    it("requires initiative identity and local goals/scope, not a service mention", () => {
        expect(
            isInitiativeSubject(
                "Atlas",
                ["project"],
                "Atlas goals: reduce deployment latency.",
            ),
        ).toBe(true);
        expect(
            isInitiativeSubject(
                "Atlas",
                ["project"],
                "# Delivery charter\n\nProject: Atlas.\n\n## Goals and scope\n\nReduce deployment latency.",
            ),
        ).toBe(true);
        expect(
            isInitiativeSubject(
                "Verifier migration",
                [],
                "Verifier migration scope: issuer checks.",
            ),
        ).toBe(true);
        expect(
            isInitiativeSubject(
                "Verifier",
                ["service"],
                "Verifier supports the migration goals.",
            ),
        ).toBe(false);
        expect(
            isInitiativeSubject(
                "Atlas",
                ["project"],
                "Atlas is mentioned in a meeting.\n\nOther project goals: capacity.",
            ),
        ).toBe(false);
        expect(
            isInitiativeSubject("2026-10-08", [], "2026-10-08 project goals"),
        ).toBe(false);
    });
    it("normalizes lexical selectors without semantic merging", () => {
        expect(normalizeInitiativeSelector(" Atlas_Migration ")).toBe(
            "atlas migration",
        );
        expect(normalizeInitiativeSelector("Atlas")).not.toBe(
            normalizeInitiativeSelector("Atlas rollout"),
        );
    });
    it("uses strict current family control contracts with no fallback", () => {
        const request = {
            corpusId: "synthetic",
            expectedHead: null,
            family: "projects",
            operation: "pause",
        } as const;
        validateMaintenanceRequest(request, true);
        expect(() =>
            validateMaintenanceRequest(
                {
                    ...request,
                    operation: "pause",
                    extra: true,
                } as typeof request,
                true,
            ),
        ).toThrow();
    });
});
