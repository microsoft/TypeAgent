// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { otel } from "@typeagent/telemetry";
import {
    buildLocalGrafanaTraceUrl,
    getLogCommandHandlers,
    LOCAL_GRAFANA_BASE_URL,
    openLogTrace,
    type OpenLogTraceDependencies,
} from "../src/context/system/handlers/logCommandHandler.js";
import { parseParams } from "../src/command/parameters.js";

type Captured = { kind: string | undefined; content: unknown };

function makeContext(agentContextOverrides?: Record<string, unknown>): {
    context: any;
    captured: Captured[];
    agentContext: Record<string, unknown>;
} {
    const captured: Captured[] = [];
    const agentContext: Record<string, unknown> = {
        sessionTraceHistory: [],
        ...agentContextOverrides,
    };
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
        sessionContext: { agentContext },
    };
    return { context, captured, agentContext };
}

async function runSub(
    name: "status" | "profile" | "clear" | "open",
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

function joinText(captured: Captured[]): string {
    return captured
        .map((c) => (typeof c.content === "string" ? c.content : ""))
        .join("\n");
}

function makeTraceResponse(): Response {
    return Response.json({
        batches: [
            {
                scopeSpans: [
                    {
                        spans: [{ name: "typeagent.request" }],
                    },
                ],
            },
        ],
    });
}

function makeReadyDeps(overrides?: {
    fetch?: OpenLogTraceDependencies["fetch"];
    openUrl?: OpenLogTraceDependencies["openUrl"];
}) {
    const fetchMock = jest.fn(async (input: string | URL) =>
        String(input).endsWith("/api/health")
            ? new Response(null, { status: 200 })
            : makeTraceResponse(),
    );
    const openMock = jest.fn<OpenLogTraceDependencies["openUrl"]>(
        async (_url) => undefined,
    );
    const waitMock = jest.fn(async () => undefined);
    const deps: OpenLogTraceDependencies = {
        fetch: overrides?.fetch ?? fetchMock,
        openUrl: overrides?.openUrl ?? openMock,
        wait: waitMock,
    };
    return { deps, fetchMock, openMock, waitMock };
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

        const text = joinText(captured);
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
        const text = joinText(captured);
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
            ["clear", "open", "profile", "status"].sort(),
        );
        expect(table.defaultSubCommand).toBeDefined();
    });
});

describe("@log open", () => {
    const VALID_ID = "0123456789abcdef0123456789abcdef";

    it("opens an explicit 32 hex trace id in local Grafana", async () => {
        const { context, captured } = makeContext();
        const { deps, fetchMock, openMock } = makeReadyDeps();
        await openLogTrace(VALID_ID, context, deps);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const fetchArgs = fetchMock.mock.calls[0];
        expect(fetchArgs[0]).toBe(`${LOCAL_GRAFANA_BASE_URL}/api/health`);
        expect(fetchMock.mock.calls[1][0]).toBe(
            `${LOCAL_GRAFANA_BASE_URL}/api/datasources/proxy/uid/tempo/api/traces/${VALID_ID}`,
        );

        expect(openMock).toHaveBeenCalledTimes(1);
        expect(openMock.mock.calls[0][0]).toBe(
            buildLocalGrafanaTraceUrl(VALID_ID),
        );

        const success = captured.find((c) => c.kind === "success");
        expect(success).toBeDefined();
        expect(String(success!.content)).toContain(VALID_ID);
        expect(String(success!.content)).toContain(LOCAL_GRAFANA_BASE_URL);
    });

    it("normalizes uppercase hex trace ids to lowercase", async () => {
        const upper = VALID_ID.toUpperCase();
        const { context, captured } = makeContext();
        const { deps, openMock } = makeReadyDeps();
        await openLogTrace(upper, context, deps);

        expect(openMock).toHaveBeenCalledTimes(1);
        expect(openMock.mock.calls[0][0]).toBe(
            buildLocalGrafanaTraceUrl(VALID_ID),
        );
        const success = captured.find((c) => c.kind === "success");
        expect(String(success!.content)).toContain(VALID_ID);
    });

    it("resolves 'last' to the stored previous trace id", async () => {
        const { context, captured } = makeContext({
            sessionTraceHistory: [
                {
                    traceId: VALID_ID,
                    requestId: "request-1",
                    kind: "request",
                    isTraceOpen: false,
                    completedAt: 1,
                },
            ],
        });
        const { deps, openMock } = makeReadyDeps();
        await openLogTrace("last", context, deps);

        expect(openMock).toHaveBeenCalledTimes(1);
        expect(openMock.mock.calls[0][0]).toBe(
            buildLocalGrafanaTraceUrl(VALID_ID),
        );
        const success = captured.find((c) => c.kind === "success");
        expect(success).toBeDefined();
    });

    it("ignores newer command and trace-open entries when resolving the last request", async () => {
        const commandTraceId = "fedcba9876543210fedcba9876543210";
        const traceOpenId = "11111111111111111111111111111111";
        const { context } = makeContext({
            sessionTraceHistory: [
                {
                    traceId: VALID_ID,
                    requestId: "request-1",
                    kind: "request",
                    isTraceOpen: false,
                    completedAt: 1,
                },
                {
                    traceId: commandTraceId,
                    requestId: "command-1",
                    kind: "command",
                    isTraceOpen: false,
                    completedAt: 2,
                },
                {
                    traceId: traceOpenId,
                    requestId: "request-2",
                    kind: "request",
                    isTraceOpen: true,
                    completedAt: 3,
                },
            ],
        });
        const { deps, openMock } = makeReadyDeps();
        await openLogTrace("last", context, deps);

        expect(openMock).toHaveBeenCalledWith(
            buildLocalGrafanaTraceUrl(VALID_ID),
        );
    });

    it("shows a clear error when 'last' has no stored trace id", async () => {
        const { context, captured } = makeContext();
        const { deps, fetchMock, openMock } = makeReadyDeps();
        await openLogTrace("last", context, deps);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(openMock).not.toHaveBeenCalled();
        const error = captured.find((c) => c.kind === "error");
        expect(error).toBeDefined();
        expect(String(error!.content)).toMatch(
            /Tracing is not active|No previous completed request/,
        );
    });

    it("rejects invalid trace ids without touching Grafana", async () => {
        const { context, captured } = makeContext();
        const { deps, fetchMock, openMock } = makeReadyDeps();
        await openLogTrace("not-a-trace-id", context, deps);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(openMock).not.toHaveBeenCalled();
        const error = captured.find((c) => c.kind === "error");
        expect(error).toBeDefined();
        expect(String(error!.content)).toContain("Invalid trace id");
    });

    it("does not open when local Grafana is unavailable", async () => {
        const { context, captured } = makeContext();
        const fetchMock = jest.fn(async () => {
            throw new TypeError("fetch failed");
        });
        const openMock = jest.fn(async () => undefined);
        await openLogTrace(VALID_ID, context, {
            fetch: fetchMock,
            openUrl: openMock,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(openMock).not.toHaveBeenCalled();
        const error = captured.find((c) => c.kind === "error");
        expect(error).toBeDefined();
        expect(String(error!.content)).toContain("pnpm run telemetry:grafana");
    });

    it("does not open when health endpoint returns non-ok", async () => {
        const { context, captured } = makeContext();
        const fetchMock = jest.fn(
            async () => new Response(null, { status: 503 }),
        );
        const openMock = jest.fn(async () => undefined);
        await openLogTrace(VALID_ID, context, {
            fetch: fetchMock,
            openUrl: openMock,
        });

        expect(openMock).not.toHaveBeenCalled();
        const error = captured.find((c) => c.kind === "error");
        expect(String(error!.content)).toContain("pnpm run telemetry:grafana");
    });

    it("waits for a recently exported trace to become available", async () => {
        const { context } = makeContext();
        const fetchMock = jest
            .fn<OpenLogTraceDependencies["fetch"]>()
            .mockResolvedValueOnce(new Response(null, { status: 200 }))
            .mockResolvedValueOnce(new Response(null, { status: 404 }))
            .mockResolvedValueOnce(makeTraceResponse());
        const openMock = jest.fn(async () => undefined);
        const waitMock = jest.fn(async () => undefined);
        await openLogTrace(VALID_ID, context, {
            fetch: fetchMock,
            openUrl: openMock,
            wait: waitMock,
        });

        expect(waitMock).toHaveBeenCalledTimes(1);
        expect(openMock).toHaveBeenCalledTimes(1);
    });

    it("waits until the root request span has been exported", async () => {
        const { context } = makeContext();
        const partialTrace = Response.json({
            batches: [
                {
                    scopeSpans: [
                        { spans: [{ name: "typeagent.translation" }] },
                    ],
                },
            ],
        });
        const fetchMock = jest
            .fn<OpenLogTraceDependencies["fetch"]>()
            .mockResolvedValueOnce(new Response(null, { status: 200 }))
            .mockResolvedValueOnce(partialTrace)
            .mockResolvedValueOnce(makeTraceResponse());
        const openMock = jest.fn(async () => undefined);
        const waitMock = jest.fn(async () => undefined);
        await openLogTrace(VALID_ID, context, {
            fetch: fetchMock,
            openUrl: openMock,
            wait: waitMock,
        });

        expect(waitMock).toHaveBeenCalledTimes(1);
        expect(openMock).toHaveBeenCalledTimes(1);
    });

    it("does not open when the trace was not captured by Tempo", async () => {
        const { context, captured } = makeContext();
        const fetchMock = jest
            .fn<OpenLogTraceDependencies["fetch"]>()
            .mockResolvedValueOnce(new Response(null, { status: 200 }))
            .mockResolvedValue(new Response(null, { status: 404 }));
        const openMock = jest.fn(async () => undefined);
        const waitMock = jest.fn(async () => undefined);
        await openLogTrace(VALID_ID, context, {
            fetch: fetchMock,
            openUrl: openMock,
            wait: waitMock,
        });

        expect(waitMock).toHaveBeenCalledTimes(19);
        expect(openMock).not.toHaveBeenCalled();
        const error = captured.find((c) => c.kind === "error");
        expect(String(error!.content)).toContain(
            "is not available in local Tempo",
        );
    });

    it("distinguishes a persistently unavailable Tempo data source", async () => {
        const { context, captured } = makeContext();
        const fetchMock = jest
            .fn<OpenLogTraceDependencies["fetch"]>()
            .mockResolvedValueOnce(new Response(null, { status: 200 }))
            .mockResolvedValue(new Response(null, { status: 503 }));
        const openMock = jest.fn(async () => undefined);
        const waitMock = jest.fn(async () => undefined);
        await openLogTrace(VALID_ID, context, {
            fetch: fetchMock,
            openUrl: openMock,
            wait: waitMock,
        });

        expect(waitMock).toHaveBeenCalledTimes(19);
        expect(openMock).not.toHaveBeenCalled();
        const error = captured.find((c) => c.kind === "error");
        expect(String(error!.content)).toContain(
            "Tempo data source is not responding",
        );
    });

    it("reports opener errors via displayError", async () => {
        const { context, captured } = makeContext();
        const fetchMock = jest.fn(async (input: string | URL) =>
            String(input).endsWith("/api/health")
                ? new Response(null, { status: 200 })
                : makeTraceResponse(),
        );
        const openMock = jest.fn(async () => {
            throw new Error("browser missing");
        });
        await openLogTrace(VALID_ID, context, {
            fetch: fetchMock,
            openUrl: openMock,
        });

        expect(openMock).toHaveBeenCalledTimes(1);
        const error = captured.find((c) => c.kind === "error");
        expect(error).toBeDefined();
        expect(String(error!.content)).toContain("browser missing");
        const success = captured.find((c) => c.kind === "success");
        expect(success).toBeUndefined();
    });

    it("stops polling and does not open after cancellation", async () => {
        const { context } = makeContext();
        const abortController = new AbortController();
        context.abortSignal = abortController.signal;
        const fetchMock = jest
            .fn<OpenLogTraceDependencies["fetch"]>()
            .mockResolvedValueOnce(new Response(null, { status: 200 }))
            .mockResolvedValueOnce(new Response(null, { status: 404 }));
        const openMock = jest.fn(async () => undefined);
        const waitMock = jest.fn(async () => {
            abortController.abort();
        });

        await expect(
            openLogTrace(VALID_ID, context, {
                fetch: fetchMock,
                openUrl: openMock,
                wait: waitMock,
            }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(openMock).not.toHaveBeenCalled();
    });

    it("builds the Grafana 13 Explore URL with schemaVersion, orgId, and tempo panes", () => {
        const url = buildLocalGrafanaTraceUrl(VALID_ID);
        const parsed = new URL(url);
        expect(parsed.origin).toBe(LOCAL_GRAFANA_BASE_URL);
        expect(parsed.pathname).toBe("/explore");
        expect(parsed.searchParams.get("schemaVersion")).toBe("1");
        expect(parsed.searchParams.get("orgId")).toBe("1");
        const panesRaw = parsed.searchParams.get("panes");
        expect(panesRaw).not.toBeNull();
        const panes = JSON.parse(panesRaw!);
        const paneIds = Object.keys(panes);
        expect(paneIds).toHaveLength(1);
        const pane = panes[paneIds[0]];
        expect(pane.datasource).toBe("tempo");
        expect(pane.queries).toHaveLength(1);
        const query = pane.queries[0];
        expect(query.refId).toBe("A");
        expect(query.queryType).toBe("traceql");
        expect(query.query).toBe(VALID_ID);
        expect(query.filters).toEqual([]);
        expect(query.datasource).toEqual({ type: "tempo", uid: "tempo" });
        expect(pane.range).toEqual({ from: "now-1h", to: "now" });
    });

    it("open command delegates to the shared openLogTrace via the ActionContext", async () => {
        const { deps, fetchMock, openMock } = makeReadyDeps();
        const table = getLogCommandHandlers(deps);
        const cmd: any = (table.commands as any).open;
        const { context } = makeContext();
        const params = parseParams(VALID_ID, cmd.parameters);
        await cmd.run(context, params);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(openMock).toHaveBeenCalledWith(
            buildLocalGrafanaTraceUrl(VALID_ID),
        );
    });

    it("registers a 'last' parameter completion", async () => {
        const table = getLogCommandHandlers();
        const cmd: any = (table.commands as any).open;
        const groups = await cmd.getCompletion(
            { agentContext: {} } as any,
            {},
            ["traceId"],
        );
        expect(
            groups.groups.some((g: any) => g.completions.includes("last")),
        ).toBe(true);
    });

    it("returns no completions when the traceId slot is not being edited", async () => {
        const table = getLogCommandHandlers();
        const cmd: any = (table.commands as any).open;
        const groups = await cmd.getCompletion(
            { agentContext: {} } as any,
            {},
            [],
        );
        expect(groups.groups).toHaveLength(0);
    });
});
