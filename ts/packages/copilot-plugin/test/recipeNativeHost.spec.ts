// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    captureNativeRecipeBinding,
    createNativeRecipeCapabilityInspector,
    createNativeRecipeHost,
    normalizeNativeRecipeSchema,
} from "../src/extension/recipe-native-host.js";
import type {
    RecipeCapability,
    RecipeHost,
} from "@typeagent/copilot-macros/recipeCore";
import { deferred, nativeFixture } from "./recipeNativeFixtures.js";

const semantics: Pick<RecipeHost, "invokeSemantic"> = {
    invokeSemantic: async () => ({ status: "unsupported", message: "fixture" }),
};

async function setup() {
    const fixture = nativeFixture();
    const binding = await captureNativeRecipeBinding(fixture.session, "local");
    const policy = {
        timeoutMs: 30,
        readOnlyMcpTools: [{ mcpServerName: "fixture", toolName: "read" }],
    };
    const inspect = createNativeRecipeCapabilityInspector(
        fixture.session,
        binding,
        policy,
    );
    const result = await inspect({ toolName: "view" });
    if (result.status !== "available") throw new Error(result.message);
    const capability = result.capability;
    const host = createNativeRecipeHost(
        fixture.session,
        binding,
        semantics,
        policy,
    );
    await host.inspectCapability(capability, binding);
    return {
        ...fixture,
        binding,
        inspect,
        capability,
        host,
        context: {
            runId: "run",
            callId: "call",
            binding,
            signal: new AbortController().signal,
        },
    };
}

describe("native recipe host", () => {
    it("binds actual workspace/session/account and normalizes exact schema identity", async () => {
        const f = await setup();
        expect(f.binding.sessionId).toBe("root");
        expect(f.binding.accountId).toContain("fixture-account");
        expect(f.binding.workspaceId).toBe(
            process.platform === "win32"
                ? process.cwd().toLowerCase()
                : process.cwd(),
        );
        expect(f.binding.profileId).toBe("local");
        expect(f.capability.inputSchema).toEqual({
            ...f.schema,
            properties: { path: { type: "string" } },
        });
        const before = f.capability.schemaDigest;
        f.schema.properties.path.description = "Changed documentation only";
        const result = await f.inspect({ toolName: "view" });
        expect(
            result.status === "available" && result.capability.schemaDigest,
        ).toBe(before);
    });

    it("uses exact MCP server/raw-tool mapping, never a similarly named tool", async () => {
        const f = await setup();
        const result = await f.inspect({
            mcpServerName: "fixture",
            toolName: "read",
        });
        expect(result.status).toBe("available");
        if (result.status !== "available") return;
        await f.host.inspectCapability(result.capability, f.binding);
        expect(
            (
                await f.host.invokeCapability(
                    result.capability,
                    { path: "x" },
                    f.context,
                )
            ).status,
        ).toBe("completed");
        expect(f.execute.mock.calls[0]?.[0].name).toBe("mcp_fixture_read");
        expect(
            (await f.inspect({ mcpServerName: "other", toolName: "read" }))
                .status,
        ).toBe("unavailable");
    });

    it.each(["oneOf", "$ref", "pattern", "format"])(
        "refuses unsupported schema constraint %s",
        (key) => {
            expect(() =>
                normalizeNativeRecipeSchema({
                    type: "string",
                    [key]: "unsafe-to-ignore",
                }),
            ).toThrow(/Unsupported/);
        },
    );

    it("rejects open schemas and unclassified effects", async () => {
        expect(() =>
            normalizeNativeRecipeSchema({
                type: "object",
                additionalProperties: true,
            }),
        ).toThrow(/Open/);
        const f = await setup();
        const inspect = createNativeRecipeCapabilityInspector(
            f.session,
            f.binding,
        );
        expect(
            (await inspect({ mcpServerName: "fixture", toolName: "read" }))
                .status,
        ).toBe("unsupported");
        expect((await inspect({ toolName: "powershell" })).status).toBe(
            "unavailable",
        );
    });

    it.each(["typeagent_run_macro", "recipe_run", "macro_inspect"])(
        "denies recursion through %s",
        async (toolName) => {
            const f = await setup();
            expect((await f.inspect({ toolName })).status).toBe("unsupported");
            expect(f.execute).not.toHaveBeenCalled();
        },
    );

    it("requires exact preflight and validates input before native dispatch", async () => {
        const f = await setup();
        const changed: RecipeCapability = { ...f.capability, effect: "write" };
        expect(
            (await f.host.invokeCapability(changed, { path: "x" }, f.context))
                .status,
        ).toBe("unsupported");
        expect(
            (
                await f.host.invokeCapability(
                    f.capability,
                    { path: 5 },
                    f.context,
                )
            ).status,
        ).toBe("unsupported");
        f.schema.required.push("new-field");
        f.emit("session.tools_updated");
        expect(
            (
                await f.host.invokeCapability(
                    f.capability,
                    { path: "x" },
                    f.context,
                )
            ).status,
        ).toBe("unsupported");
        expect(f.execute).not.toHaveBeenCalled();
    });

    it.each([
        [{ textResultForLlm: "plain native result" }, "plain native result"],
        [{ textResultForLlm: '{"value":"native"}' }, { value: "native" }],
        [
            {
                textResultForLlm: "host rendering",
                structuredContent: { value: "mcp" },
            },
            { value: "mcp" },
        ],
        [{ textResultForLlm: "host rendering", structuredContent: null }, null],
    ])(
        "returns the captured model-visible value rather than transport metadata: %j",
        async (result, expected) => {
            const f = await setup();
            f.execute.mockResolvedValue({ resultType: "success", ...result });
            await expect(
                f.host.invokeCapability(f.capability, { path: "x" }, f.context),
            ).resolves.toEqual({
                status: "completed",
                value: expected,
            });
        },
    );

    it("preserves native denial without retry or permission approval", async () => {
        const f = await setup();
        f.execute.mockResolvedValue({
            resultType: "denied",
            textResultForLlm: "Content excluded by host.",
        });
        expect(
            (
                await f.host.invokeCapability(
                    f.capability,
                    { path: "x" },
                    f.context,
                )
            ).status,
        ).toBe("denied");
        expect(f.execute).toHaveBeenCalledTimes(1);
        expect(f.abort).not.toHaveBeenCalled();
    });

    it.each(["account", "root", "generation"])(
        "fails closed on a changed %s binding",
        async (kind) => {
            const f = await setup();
            if (kind === "account") f.auth.login = "another-account";
            if (kind === "root") f.metadata.workingDirectory += "\\other";
            if (kind === "generation") f.emit("session.permissions_changed");
            expect(
                (
                    await f.host.invokeCapability(
                        f.capability,
                        { path: "x" },
                        f.context,
                    )
                ).status,
            ).toBe("unsupported");
            expect(f.execute).not.toHaveBeenCalled();
        },
    );

    it("does not dispatch pre-cancelled calls", async () => {
        const f = await setup();
        const controller = new AbortController();
        controller.abort();
        expect(
            (
                await f.host.invokeCapability(
                    f.capability,
                    { path: "x" },
                    { ...f.context, signal: controller.signal },
                )
            ).status,
        ).toBe("cancelled");
        expect(f.execute).not.toHaveBeenCalled();
    });

    it("bounds uncertain dispatch and suppresses late results without parent abort", async () => {
        const f = await setup();
        const late = deferred<unknown>();
        f.execute.mockImplementation(() => late.promise);
        const result = await f.host.invokeCapability(
            f.capability,
            { path: "x" },
            f.context,
        );
        expect(result.status).toBe("execution_uncertain");
        expect(f.execute.mock.calls[0]?.[0].toolCallId).toMatch(
            /^recipe-native-/,
        );
        late.resolve({ resultType: "success", textResultForLlm: "late" });
        await Promise.resolve();
        expect(result.status).toBe("execution_uncertain");
        expect(f.abort).not.toHaveBeenCalled();
        expect(f.shutdown).not.toHaveBeenCalled();
    });

    it("cancels only its own wait when exact native tool cancellation is unavailable", async () => {
        const f = await setup();
        const started = deferred<void>();
        const late = deferred<unknown>();
        f.execute.mockImplementation(() => {
            started.resolve();
            return late.promise;
        });
        const controller = new AbortController();
        const call = f.host.invokeCapability(
            f.capability,
            { path: "x" },
            { ...f.context, signal: controller.signal },
        );
        await started.promise;
        controller.abort();
        expect((await call).status).toBe("execution_uncertain");
        late.resolve({ resultType: "success", textResultForLlm: "late" });
        expect(f.abort).not.toHaveBeenCalled();
    });

    it("bounds inspection and prevents a late preflight from dispatching after cancellation", async () => {
        const f = await setup();
        const observed = deferred<typeof f.metadata>();
        const started = deferred<void>();
        f.snapshot.mockImplementation(() => {
            started.resolve();
            return observed.promise;
        });
        const controller = new AbortController();
        const call = f.host.invokeCapability(
            f.capability,
            { path: "x" },
            {
                ...f.context,
                signal: controller.signal,
            },
        );
        await started.promise;
        controller.abort();
        expect((await call).status).toBe("execution_uncertain");
        observed.resolve(f.metadata);
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(f.execute).not.toHaveBeenCalled();
        expect(f.abort).not.toHaveBeenCalled();
    });

    it("reuses discovery within the bound host while retaining live binding checks", async () => {
        const f = await setup();
        const discoveries = f.getCurrentMetadata.mock.calls.length;
        const bindings = f.snapshot.mock.calls.length;
        for (let i = 0; i < 3; i++) {
            expect(
                (await f.host.inspectCapability(f.capability, f.binding))
                    .status,
            ).toBe("available");
            expect(
                (
                    await f.host.invokeCapability(
                        f.capability,
                        { path: "x" },
                        f.context,
                    )
                ).status,
            ).toBe("completed");
        }
        expect(f.getCurrentMetadata).toHaveBeenCalledTimes(discoveries);
        expect(f.snapshot.mock.calls.length).toBeGreaterThan(bindings);
        f.emit("session.permissions_changed");
        expect(
            (
                await f.host.invokeCapability(
                    f.capability,
                    { path: "x" },
                    f.context,
                )
            ).status,
        ).toBe("unsupported");
        expect(f.execute).toHaveBeenCalledTimes(3);
    });

    it("retries failed discovery instead of caching an unavailable inventory", async () => {
        const f = await setup();
        const host = createNativeRecipeHost(f.session, f.binding, semantics);
        f.getCurrentMetadata.mockRejectedValueOnce(
            new Error("Discovery failed"),
        );
        await expect(
            host.inspectCapability(f.capability, f.binding),
        ).resolves.toEqual({
            status: "unavailable",
            message: "Error: Discovery failed",
        });
        expect(
            (await host.inspectCapability(f.capability, f.binding)).status,
        ).toBe("available");
        expect(
            (
                await host.invokeCapability(
                    f.capability,
                    { path: "x" },
                    f.context,
                )
            ).status,
        ).toBe("completed");
        expect(f.execute).toHaveBeenCalledTimes(1);
    });

    it("keeps returned descriptors separate from the approved contract", async () => {
        const f = await setup();
        const inspection = await f.host.inspectCapability(
            f.capability,
            f.binding,
        );
        expect(inspection.status).toBe("available");
        if (inspection.status !== "available")
            throw new Error("Expected preflight");
        inspection.capability.operation = "different";
        expect(
            (
                await f.host.invokeCapability(
                    f.capability,
                    { path: "x" },
                    f.context,
                )
            ).status,
        ).toBe("completed");
    });

    it("rejects inventory captured across a generation change", async () => {
        const f = await setup();
        const host = createNativeRecipeHost(f.session, f.binding, semantics);
        const observed = deferred<{ tools: typeof f.tools }>();
        f.getCurrentMetadata.mockImplementation(() => observed.promise);
        const inspection = host.inspectCapability(f.capability, f.binding);
        f.emit("session.tools_updated");
        observed.resolve({ tools: f.tools });
        expect((await inspection).status).toBe("unsupported");
        expect(
            (
                await host.invokeCapability(
                    f.capability,
                    { path: "x" },
                    f.context,
                )
            ).status,
        ).toBe("unsupported");
        expect(f.execute).not.toHaveBeenCalled();
    });
});
