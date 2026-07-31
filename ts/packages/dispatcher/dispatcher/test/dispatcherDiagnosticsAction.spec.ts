// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { executeDispatcherDiagnosticsAction } from "../src/context/dispatcher/diagnosticsActionHandler.js";

function makeHandlers(calls: Record<string, unknown[][]>) {
    const handler = (name: string, result?: object) => ({
        run: async (...args: unknown[]) => {
            calls[name].push(args);
            return result;
        },
    });
    return {
        request: handler("request"),
        match: handler("match"),
        translate: handler("translate"),
        reason: handler("reason", { entities: [] }),
        explain: handler("explain"),
    } as any;
}

function emptyCalls() {
    return {
        request: [] as unknown[][],
        match: [] as unknown[][],
        translate: [] as unknown[][],
        reason: [] as unknown[][],
        explain: [] as unknown[][],
    };
}

describe("dispatcher diagnostics actions", () => {
    it("maps request, match, and translate parameters", async () => {
        const calls = emptyCalls();
        const handlers = makeHandlers(calls);
        const context = { id: "context" } as any;

        await executeDispatcherDiagnosticsAction(
            {
                schemaName: "dispatcher.diagnostics",
                actionName: "dispatchRequest",
            },
            context,
            handlers,
        );
        await executeDispatcherDiagnosticsAction(
            {
                schemaName: "dispatcher.diagnostics",
                actionName: "matchDispatcherRequest",
                parameters: { request: "play jazz" },
            },
            context,
            handlers,
        );
        await executeDispatcherDiagnosticsAction(
            {
                schemaName: "dispatcher.diagnostics",
                actionName: "translateDispatcherRequest",
                parameters: { request: "play jazz", useHistory: true },
            },
            context,
            handlers,
        );

        expect(calls.request[0]).toEqual([
            context,
            { args: { request: undefined }, flags: undefined },
        ]);
        expect(calls.match[0]).toEqual([
            context,
            { args: { request: "play jazz" }, flags: undefined },
        ]);
        expect(calls.translate[0]).toEqual([
            context,
            {
                args: { request: "play jazz" },
                flags: { history: true },
            },
        ]);
    });

    it("maps reasoning defaults and returns the handler result", async () => {
        const calls = emptyCalls();
        const handlers = makeHandlers(calls);
        const context = { id: "context" } as any;

        const result = await executeDispatcherDiagnosticsAction(
            {
                schemaName: "dispatcher.diagnostics",
                actionName: "reasonAboutRequest",
                parameters: { request: "plan my afternoon" },
            },
            context,
            handlers,
        );

        expect(calls.reason[0]).toEqual([
            context,
            {
                args: { request: "plan my afternoon" },
                flags: { engine: "" },
            },
        ]);
        expect(result).toEqual({ entities: [] });
    });

    it("maps explanation defaults exactly", async () => {
        const calls = emptyCalls();
        const handlers = makeHandlers(calls);
        const context = { id: "context" } as any;

        await executeDispatcherDiagnosticsAction(
            {
                schemaName: "dispatcher.diagnostics",
                actionName: "explainDispatcherRequest",
                parameters: { requestAction: "play jazz => player.playMusic" },
            },
            context,
            handlers,
        );

        expect(calls.explain[0]).toEqual([
            context,
            {
                args: { requestAction: "play jazz => player.playMusic" },
                flags: {
                    repeat: 1,
                    filterValueInRequest: false,
                    filterReference: false,
                    concurrency: 5,
                },
            },
        ]);
    });
});
