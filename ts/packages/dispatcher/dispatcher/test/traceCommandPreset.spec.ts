// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseParams } from "../src/command/parameters.js";
import { TraceCommandHandler } from "../src/context/system/handlers/traceCommandHandler.js";
import { otel } from "@typeagent/telemetry";
import registerDebug from "debug";

const handler = new TraceCommandHandler();

describe("@trace --preset flag", () => {
    const originalDebug = process.env.DEBUG;

    afterEach(() => {
        if (originalDebug === undefined) {
            delete process.env.DEBUG;
            registerDebug.disable();
        } else {
            process.env.DEBUG = originalDebug;
            registerDebug.enable(originalDebug);
        }
    });

    it("parses a single preset flag", () => {
        const params = parseParams("--preset translation", handler.parameters);
        expect(params.flags.preset).toEqual(["translation"]);
    });

    it("parses multiple preset flags and positional namespaces together", () => {
        const params = parseParams(
            "--preset reasoning --preset actions typeagent:custom",
            handler.parameters,
        );
        expect(params.flags.preset).toEqual(["reasoning", "actions"]);
        expect(params.args.namespaces).toEqual(["typeagent:custom"]);
    });

    it("expands comma-separated preset names", () => {
        const params = parseParams(
            "--preset request,translation",
            handler.parameters,
        );
        const expansion = otel.expandTracePresets(params.flags.preset ?? []);
        expect(expansion.unknown).toEqual([]);
        expect(expansion.patterns).toEqual(
            expect.arrayContaining([
                ...otel.TRACE_PRESETS.request,
                ...otel.TRACE_PRESETS.translation,
            ]),
        );
    });

    it("known preset names all resolve to non-empty pattern lists", () => {
        for (const name of Object.keys(otel.TRACE_PRESETS)) {
            const { patterns, unknown } = otel.expandTracePresets([name]);
            expect(unknown).toEqual([]);
            expect(patterns.length).toBeGreaterThan(0);
        }
    });

    it("unknown preset names are reported without mutating patterns", () => {
        const { patterns, unknown } = otel.expandTracePresets([
            "translation",
            "nonsense",
        ]);
        expect(unknown).toEqual(["nonsense"]);
        // The known preset still expanded, but the caller (traceCommandHandler)
        // checks `unknown.length > 0` and refuses the whole update.
        expect(patterns.length).toBeGreaterThan(0);
    });

    it("clear plus preset replaces settings and propagates the final value", async () => {
        const propagated: string[] = [];
        const messages: string[] = [];
        const context = {
            actionIO: {
                appendDisplay(payload: { content?: string }) {
                    if (typeof payload.content === "string") {
                        messages.push(payload.content);
                    }
                },
            },
            sessionContext: {
                agentContext: {
                    agents: {
                        setTraceNamespaces(settings: string) {
                            propagated.push(settings);
                        },
                    },
                },
            },
        } as any;
        registerDebug.enable("typeagent:old");
        process.env.DEBUG = "typeagent:old";

        const params = parseParams(
            "--clear --preset request",
            handler.parameters,
        );
        await handler.run(context, params);

        const expected = otel.TRACE_PRESETS.request.join(",");
        expect(process.env.DEBUG).toBe(expected);
        expect(registerDebug.disable()).toBe(expected);
        registerDebug.enable(expected);
        expect(propagated).toEqual([expected]);
        expect(messages.join("\n")).toContain(
            "Cleared existing trace namespaces before applying additions",
        );
        expect(messages.join("\n")).not.toContain(
            "All trace namespaces cleared",
        );
    });

    it("clear with no additions propagates an empty setting", async () => {
        const propagated: string[] = [];
        const context = {
            actionIO: { appendDisplay() {} },
            sessionContext: {
                agentContext: {
                    agents: {
                        setTraceNamespaces(settings: string) {
                            propagated.push(settings);
                        },
                    },
                },
            },
        } as any;
        registerDebug.enable("typeagent:old");
        process.env.DEBUG = "typeagent:old";

        const params = parseParams("--clear", handler.parameters);
        await handler.run(context, params);

        expect(process.env.DEBUG ?? "").toBe("");
        expect(registerDebug.disable()).toBe("");
        expect(propagated).toEqual([""]);
    });
});
