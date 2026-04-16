// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for executeSessionAction in sessionActionHandler.ts.
 *
 * processCommandNoLock is an ESM module export, so we use
 * jest.unstable_mockModule to mock it before dynamically importing
 * the module under test.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// ── Mock processCommandNoLock before importing the handler ────────────────────

const mockProcessCommandNoLock = jest.fn<() => Promise<void>>();

jest.unstable_mockModule("../src/command/command.js", () => ({
    processCommandNoLock: mockProcessCommandNoLock,
}));

// ── Dynamic import after mocks are installed ──────────────────────────────────

const { executeSessionAction } = await import(
    "../src/context/system/action/sessionActionHandler.js"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Minimal ActionContext stub — only agentContext path is needed. */
function makeContext() {
    return {
        sessionContext: {
            agentContext: {},
        },
    } as any;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    mockProcessCommandNoLock.mockResolvedValue(undefined);
    mockProcessCommandNoLock.mockClear();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("executeSessionAction — newSession", () => {
    it("calls @session new with name when name is provided", async () => {
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "newSession",
                parameters: { name: "research" },
            },
            makeContext(),
        );
        expect(mockProcessCommandNoLock).toHaveBeenCalledWith(
            "@session new research",
            expect.anything(),
        );
    });

    it("calls @session new without trailing space when name is omitted", async () => {
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "newSession",
                parameters: {},
            },
            makeContext(),
        );
        expect(mockProcessCommandNoLock).toHaveBeenCalledWith(
            "@session new",
            expect.anything(),
        );
    });

    it("preserves session names that contain spaces", async () => {
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "newSession",
                parameters: { name: "my work project" },
            },
            makeContext(),
        );
        expect(mockProcessCommandNoLock).toHaveBeenCalledWith(
            "@session new my work project",
            expect.anything(),
        );
    });
});

describe("executeSessionAction — listSession", () => {
    it("calls @session list", async () => {
        await executeSessionAction(
            { schemaName: "system.session", actionName: "listSession" },
            makeContext(),
        );
        expect(mockProcessCommandNoLock).toHaveBeenCalledWith(
            "@session list",
            expect.anything(),
        );
    });
});

describe("executeSessionAction — showSessionInfo", () => {
    it("calls @session info", async () => {
        await executeSessionAction(
            { schemaName: "system.session", actionName: "showSessionInfo" },
            makeContext(),
        );
        expect(mockProcessCommandNoLock).toHaveBeenCalledWith(
            "@session info",
            expect.anything(),
        );
    });
});

describe("executeSessionAction — switchSession", () => {
    it("calls @session open with the given name", async () => {
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "switchSession",
                parameters: { name: "work" },
            },
            makeContext(),
        );
        expect(mockProcessCommandNoLock).toHaveBeenCalledWith(
            "@session open work",
            expect.anything(),
        );
    });

    it("preserves session names that contain spaces", async () => {
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "switchSession",
                parameters: { name: "my work project" },
            },
            makeContext(),
        );
        expect(mockProcessCommandNoLock).toHaveBeenCalledWith(
            "@session open my work project",
            expect.anything(),
        );
    });
});

describe("executeSessionAction — deleteSession", () => {
    it("calls @session delete with the given name", async () => {
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "deleteSession",
                parameters: { name: "old-project" },
            },
            makeContext(),
        );
        expect(mockProcessCommandNoLock).toHaveBeenCalledWith(
            "@session delete old-project",
            expect.anything(),
        );
    });

    it("preserves session names that contain spaces", async () => {
        await executeSessionAction(
            {
                schemaName: "system.session",
                actionName: "deleteSession",
                parameters: { name: "old work project" },
            },
            makeContext(),
        );
        expect(mockProcessCommandNoLock).toHaveBeenCalledWith(
            "@session delete old work project",
            expect.anything(),
        );
    });
});

describe("executeSessionAction — invalid action", () => {
    it("throws on an unrecognized action name", async () => {
        await expect(
            executeSessionAction(
                {
                    schemaName: "system.session",
                    actionName: "unknownAction",
                } as any,
                makeContext(),
            ),
        ).rejects.toThrow("Invalid action name: unknownAction");
    });
});
