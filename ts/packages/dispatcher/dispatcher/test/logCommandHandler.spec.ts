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
    name: "status" | "profile" | "clear",
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

    it("status prints profile, behavior, and preset registry", async () => {
        const { context, captured } = makeContext();
        await runSub("status", "", context);

        const text = captured
            .map((c) => (typeof c.content === "string" ? c.content : ""))
            .join("\n");
        expect(text).toContain("Local OTel profile: focused");
        expect(text).toContain("debug bridge:       available");
        expect(text).toContain("local JSONL:        configured");
        expect(text).toContain(
            "profile behavior:   structured events only (no debug logs)",
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

    it.each([
        ["focused", "structured events only (no debug logs)"],
        ["diagnostic", "structured events + error/warn/info debug logs"],
        ["verbose", "structured events + all debug logs"],
        ["off", "local OTel sink disabled"],
    ])("status describes %s profile behavior", async (profile, behavior) => {
        const { context: setCtx } = makeContext();
        await runSub("profile", profile, setCtx);
        const { context, captured } = makeContext();
        await runSub("status", "", context);
        const text = captured
            .map((c) => (typeof c.content === "string" ? c.content : ""))
            .join("\n");
        expect(text).toContain(`profile behavior:   ${behavior}`);
    });

    it("clear resets to focused", async () => {
        const { context } = makeContext();
        await runSub("profile", "verbose", context);
        expect(otel.getLocalTelemetryState().getSnapshot().profile).toBe(
            "verbose",
        );

        await runSub("clear", "", context);
        const snap = otel.getLocalTelemetryState().getSnapshot();
        expect(snap.profile).toBe("focused");
    });

    it("registers the expected subcommands and defaults to status", () => {
        const table = getLogCommandHandlers();
        expect(Object.keys(table.commands ?? {}).sort()).toEqual(
            ["clear", "profile", "status"].sort(),
        );
        expect(table.defaultSubCommand).toBeDefined();
    });
});
