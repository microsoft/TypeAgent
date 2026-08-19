// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { otel } from "@typeagent/telemetry";
import { getLogCommandHandlers } from "../src/context/system/handlers/logCommandHandler.js";
import { parseParams } from "../src/command/parameters.js";

type Captured = { kind: string | undefined; content: unknown };

function makeContext(): {
    context: any;
    captured: Captured[];
} {
    const captured: Captured[] = [];
    const context = {
        actionIO: {
            appendDisplay(payload: any) {
                if (
                    payload &&
                    typeof payload === "object" &&
                    "type" in payload &&
                    payload.type === "text"
                ) {
                    captured.push({
                        kind: (payload as any).kind,
                        content: (payload as any).content,
                    });
                } else {
                    captured.push({ kind: undefined, content: payload });
                }
            },
        },
        sessionContext: { agentContext: {} },
    };
    return { context, captured };
}

async function runSub(
    name: "status" | "profile" | "debug-copy" | "clear",
    argv: string,
    ctx: any,
) {
    const table = getLogCommandHandlers();
    const cmd: any = (table.commands as any)[name];
    if (cmd.parameters !== undefined) {
        const params = parseParams(argv, cmd.parameters);
        await cmd.run(ctx, params);
    } else {
        await cmd.run(ctx);
    }
}

describe("@log command handler", () => {
    beforeEach(() => {
        // Each test gets a fresh state singleton to avoid cross-test bleed.
        otel.setLocalTelemetryState(
            otel.createLocalTelemetryState({
                debugBridgeAvailable: true,
                localLogAvailable: true,
            }),
        );
    });

    afterAll(() => {
        otel.setLocalTelemetryState(undefined);
    });

    it("status prints profile, debug-copy, and preset registry", async () => {
        const { context, captured } = makeContext();
        await runSub("status", "", context);

        const text = captured
            .map((c) => (typeof c.content === "string" ? c.content : ""))
            .join("\n");
        expect(text).toContain("Local OTel profile: focused");
        expect(text).toContain("debug-copy:         off");
        expect(text).toContain("debug bridge:       available");
        expect(text).toContain("local JSONL:        configured");
        expect(text).toContain(
            "focused, diagnostic, and verbose are equivalent in Phase 1",
        );
        expect(text).toContain("Trace preset registry");
        for (const name of Object.keys(otel.TRACE_PRESETS)) {
            expect(text).toContain(`  ${name}:`);
        }
    });

    it("profile <name> updates state", async () => {
        const { context } = makeContext();
        await runSub("profile", "diagnostic", context);
        expect(otel.getLocalTelemetryState().getSnapshot().profile).toBe(
            "diagnostic",
        );
        await runSub("profile", "off", context);
        expect(otel.getLocalTelemetryState().getSnapshot().profile).toBe("off");
    });

    it("profile rejects unknown values without mutating state", async () => {
        const { context, captured } = makeContext();
        await runSub("profile", "chatty", context);
        expect(otel.getLocalTelemetryState().getSnapshot().profile).toBe(
            "focused",
        );
        const errored = captured.find((c) => c.kind === "error");
        expect(errored).toBeDefined();
    });

    it("debug-copy on/off toggles state", async () => {
        const { context } = makeContext();
        await runSub("debug-copy", "on", context);
        expect(otel.getLocalTelemetryState().getSnapshot().debugCopy).toBe(
            true,
        );
        await runSub("debug-copy", "off", context);
        expect(otel.getLocalTelemetryState().getSnapshot().debugCopy).toBe(
            false,
        );
    });

    it("debug-copy rejects invalid state without mutating", async () => {
        const { context, captured } = makeContext();
        await runSub("debug-copy", "yes", context);
        expect(otel.getLocalTelemetryState().getSnapshot().debugCopy).toBe(
            false,
        );
        expect(captured.some((c) => c.kind === "error")).toBe(true);
    });

    it("debug-copy on reports missing local capabilities", async () => {
        otel.setLocalTelemetryState(otel.createLocalTelemetryState());
        const { context, captured } = makeContext();
        await runSub("debug-copy", "on", context);
        expect(otel.getLocalTelemetryState().getSnapshot().debugCopy).toBe(
            false,
        );
        expect(captured.some((c) => c.kind === "error")).toBe(true);
    });

    it("clear resets to focused + debug-copy off", async () => {
        const { context } = makeContext();
        await runSub("profile", "verbose", context);
        await runSub("debug-copy", "on", context);
        expect(otel.getLocalTelemetryState().getSnapshot().profile).toBe(
            "verbose",
        );

        await runSub("clear", "", context);
        const snap = otel.getLocalTelemetryState().getSnapshot();
        expect(snap.profile).toBe("focused");
        expect(snap.debugCopy).toBe(false);
    });

    it("registers the expected subcommands and defaults to status", () => {
        const table = getLogCommandHandlers();
        expect(Object.keys(table.commands ?? {}).sort()).toEqual(
            ["clear", "debug-copy", "profile", "status"].sort(),
        );
        expect(table.defaultSubCommand).toBeDefined();
    });
});
