// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    checkRecipeCapability,
    isRecipeRunnable,
    recipeDigest,
    recipePublicationState,
    recipeRuntimeAbi,
    recipeSchemaDigest,
    sealRecipeArtifact,
    validateRecipeArtifact,
    validateRecipeValue,
    validateRuntimeJsonSchema,
    type RecipeArtifact,
    type RecipeCallContext,
    type RecipeCallOutcome,
    type RecipeCapability,
    type RecipeSemanticFunction,
    type RecipeSemanticOutcome,
    type RuntimeJsonSchema,
} from "@typeagent/copilot-macros/recipeCore";
import {
    FakeRecipeHost,
    runRecipeFixture,
} from "@typeagent/copilot-macros/recipeTesting";

const text: RuntimeJsonSchema = { type: "string" };
const titleInput: RuntimeJsonSchema = {
    type: "object",
    properties: { title: text },
    required: ["title"],
    additionalProperties: false,
};

function capability(
    id: string,
    transport: "native" | "mcp" = "native",
): RecipeCapability {
    return {
        id,
        transport,
        providerId: "fixture-provider",
        operation: id,
        contractVersion: "1",
        inputSchema: text,
        outputSchema: text,
        schemaDigest: recipeSchemaDigest(text, text),
        compatibility: "exact",
        effect: "read",
    };
}

const semantic: RecipeSemanticFunction = {
    id: "classify",
    revision: "1",
    inputSchema: text,
    outputSchema: text,
    specification: {
        id: "rubric",
        revision: "1",
        task: "Classify supplied text.",
        rubric: "Abstain if ambiguous.",
    },
    modelPolicy: { id: "host-selected", revision: "1" },
    bounds: {
        timeoutMs: 1000,
        maxInputBytes: 1000,
        maxOutputBytes: 1000,
        maxCalls: 1,
        maxRepairAttempts: 0,
        maxConcurrency: 1,
    },
    evidence: { sourceIds: "known", quotations: true },
};

function draft(): Omit<RecipeArtifact, "revision"> {
    const source = "async function execute(api, input) { return input.title; }";
    return {
        schemaVersion: 1,
        kind: "program",
        recipeId: "read-document",
        name: "Read document",
        description: "Fixture-only read by current title.",
        execution: "symbolic",
        authorization: "live_host",
        source: {
            language: "typescript",
            text: source,
            digest: recipeDigest(source),
        },
        executable: {
            language: "javascript",
            text: source,
            digest: recipeDigest(source),
            sourceDigest: recipeDigest(source),
            runtimeAbi: recipeRuntimeAbi,
            compiler: {
                name: "fixture",
                version: "1",
                optionsDigest: "fixture-options",
            },
        },
        inputSchema: titleInput,
        outputSchema: text,
        output: {
            kind: "content",
            requirements: ["Return complete current content."],
            identity: "current_run",
        },
        capabilities: [capability("lookup"), capability("read", "mcp")],
        semanticFunctions: [],
        applicability: {
            assumptions: ["Exact supported title."],
            unsupported: ["Ambiguous titles."],
        },
        generalization: [
            {
                kind: "parameter",
                name: "title",
                producer: "input.title",
                evidenceIds: ["task-output"],
            },
            {
                kind: "derived",
                name: "id",
                producer: "current lookup result",
                evidenceIds: ["task-output"],
            },
            {
                kind: "host_owned",
                name: "account",
                producer: "host binding",
                evidenceIds: ["task-output"],
            },
        ],
        specification: {
            id: "read-spec",
            revision: "1",
            intent: "Return document contents.",
            outputRequirements: ["Full current contents."],
            rubric: "No historical IDs.",
            counterexamples: ["Changed ID."],
        },
        matching: {
            grammar: ['<Start> = read document -> { title: "document" };'],
            examples: [
                {
                    request: "read document",
                    input: { title: "document" },
                    evidenceIds: ["task-output"],
                },
            ],
            negatives: ["delete document"],
            collisionEvidenceIds: [],
        },
        provenance: {
            captureId: "capture-1",
            taskId: "task-1",
            tokenId: "token-1",
            evidenceIds: ["task-output"],
        },
        fixtures: [
            {
                id: "changed-id",
                origin: "synthetic",
                result: "passed",
                specificationRevision: "1",
                noLiveEffects: true,
            },
        ],
        createdAt: "2026-10-15T20:00:00Z",
    };
}

function context(signal = new AbortController().signal): RecipeCallContext {
    return {
        runId: "run-1",
        callId: "call-1",
        signal,
        binding: {
            workspaceId: "workspace",
            profileId: "profile",
            providerId: "fixture-provider",
            accountId: "opaque-account",
            sessionId: "session",
            generation: "1",
        },
    };
}

describe("program recipe core v1", () => {
    it("validates JSON schemas without permissive text or keyword fallbacks", () => {
        expect(validateRecipeValue(titleInput, { title: "fresh" })).toEqual([]);
        for (const value of [
            {},
            { title: 1 },
            { title: "fresh", extra: true },
            "plain text",
            new Date(),
        ])
            expect(validateRecipeValue(titleInput, value)[0].code).toBe(
                "schema_mismatch",
            );
        for (const schema of [
            { type: "string", pattern: ".*" },
            { type: "toString" },
            { $ref: "#/$defs/X" },
            { type: "object", properties: {}, additionalProperties: true },
        ])
            expect(validateRuntimeJsonSchema(schema)[0].code).toBe(
                "invalid_schema",
            );
    });

    it.each([
        [{ type: "integer", minimum: 1, maximum: 3 }, 2, true],
        [{ type: "integer" }, 1.5, false],
        [{ type: "number" }, NaN, false],
        [{ type: "number" }, Infinity, false],
        [{ type: "string", enum: ["a"] }, "b", false],
        [{ type: "boolean", enum: [true] }, false, false],
        [{ type: "null" }, null, true],
        [
            {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 2,
            },
            ["a"],
            true,
        ],
        [{ type: "array", items: { type: "string" } }, [undefined], false],
    ])("checks schema %j against %j", (schema, value, valid) => {
        expect(
            validateRecipeValue(schema as RuntimeJsonSchema, value).length ===
                0,
        ).toBe(valid);
    });

    it("rejects invalid schema bounds and required/enum declarations", () => {
        for (const schema of [
            { type: "integer", minimum: 5, maximum: 1 },
            { type: "string", minLength: -1 },
            { type: "array", items: text, maxItems: 1.5 },
            { type: "string", enum: ["a", "a"] },
            { ...titleInput, required: ["absent"] },
        ])
            expect(validateRuntimeJsonSchema(schema)).not.toEqual([]);
    });

    it("seals content-addressed immutable revisions without mutating caller data", () => {
        const input = draft();
        const artifact = sealRecipeArtifact(input);
        input.name = "changed";
        expect(artifact.name).toBe("Read document");
        expect(Object.isFrozen(artifact)).toBe(true);
        expect(Object.isFrozen(artifact.source)).toBe(true);
        expect(() => {
            artifact.name = "mutated";
        }).toThrow();
        expect(sealRecipeArtifact(draft()).revision).toBe(artifact.revision);
        expect(
            sealRecipeArtifact({ ...draft(), name: "new revision" }).revision,
        ).not.toBe(artifact.revision);
        const tampered = structuredClone(artifact);
        tampered.source.text += "// changed";
        expect(
            validateRecipeArtifact(tampered).map((issue) => issue.path),
        ).toEqual(expect.arrayContaining(["executable", "revision"]));
    });

    it("rejects unsupported ABI, incomplete grounding, and undeclared semantic work", () => {
        expect(
            validateRecipeArtifact({
                schemaVersion: 99,
            } as unknown as RecipeArtifact)[0].message,
        ).toBe("Unsupported recipe artifact version or kind.");
        expect(
            validateRecipeArtifact({
                schemaVersion: 1,
                kind: "program",
            } as RecipeArtifact)[0].message,
        ).toBe("Malformed recipe artifact or non-JSON content.");
        const input = draft();
        input.executable.runtimeAbi = "future-abi";
        expect(() => sealRecipeArtifact(input)).toThrow(
            "Unsupported runtime ABI.",
        );
        const ungrounded = draft();
        ungrounded.provenance.evidenceIds = [];
        expect(() => sealRecipeArtifact(ungrounded)).toThrow(
            "known grounding evidence",
        );
        const symbolic = draft();
        symbolic.semanticFunctions = [semantic];
        expect(() => sealRecipeArtifact(symbolic)).toThrow("Symbolic recipes");
    });

    it("preflights exact dependency identity and schema compatibility", () => {
        const required = capability("read");
        expect(
            checkRecipeCapability(required, structuredClone(required)),
        ).toEqual([]);
        for (const available of [
            { ...required, providerId: "other" },
            { ...required, contractVersion: "2" },
            { ...required, effect: "write" as const },
            { ...required, outputSchema: titleInput },
        ])
            expect(checkRecipeCapability(required, available)[0].code).toBe(
                "incompatible",
            );
    });

    it("keeps publication state separate from content and learning mode", () => {
        const artifact = sealRecipeArtifact(draft());
        expect(recipePublicationState(artifact, "off")).toBe("candidate");
        expect(recipePublicationState(artifact, "prepare")).toBe("prepared");
        expect(recipePublicationState(artifact, "read-only")).toBe("ready");
        for (const effect of ["write", "unknown"] as const) {
            const input = draft();
            input.capabilities[0].effect = effect;
            expect(
                recipePublicationState(sealRecipeArtifact(input), "read-only"),
            ).toBe("prepared");
            expect(
                recipePublicationState(sealRecipeArtifact(input), "all"),
            ).toBe("ready");
        }
        for (const state of [
            "candidate",
            "prepared",
            "disabled",
            "superseded",
            "deleted",
        ] as const)
            expect(isRecipeRunnable(state)).toBe(false);
        expect(isRecipeRunnable("ready")).toBe(true);
        expect(artifact.revision).toBe(sealRecipeArtifact(draft()).revision);
        const failed = draft();
        failed.fixtures[0].result = "failed";
        expect(() =>
            recipePublicationState(sealRecipeArtifact(failed), "all"),
        ).toThrow("passing specification-bound fixtures");
    });
});

describe("offline host and fixtures", () => {
    it("supports a declared hybrid semantic fixture without a live provider", async () => {
        const input = draft();
        input.execution = "hybrid";
        input.capabilities = [];
        input.semanticFunctions = [semantic];
        const artifact = sealRecipeArtifact(input);
        const host = new FakeRecipeHost();
        host.registerSemantic(semantic, (value) => ({
            status: "completed",
            value: `classified:${value}`,
            evidence: {
                functionId: semantic.id,
                functionRevision: semantic.revision,
                resolvedModel: "offline-fixture",
                latencyMs: 0,
                validation: "passed",
                sourceIds: ["source-1"],
            },
        }));
        const result = await runRecipeFixture(
            artifact,
            { title: "fresh" },
            host,
            context(),
            async (api, value, ctx) => {
                const result = await api.invokeSemantic(
                    semantic,
                    (value as { title: string }).title,
                    ctx,
                );
                if (result.status !== "completed")
                    throw new Error(result.status);
                return result.value;
            },
        );
        expect(result).toMatchObject({
            status: "passed",
            output: "classified:fresh",
        });
        expect(host.calls.map((call) => call.kind)).toEqual(["semantic"]);
    });

    it("uses changed inputs and current native-to-MCP results, preserving nested ownership", async () => {
        const artifact = sealRecipeArtifact(draft());
        const host = new FakeRecipeHost();
        host.registerCapability(artifact.capabilities[0], (input) => ({
            status: "completed",
            value: `fresh-id:${input}`,
        }));
        host.registerCapability(artifact.capabilities[1], (input) => ({
            status: "completed",
            value: `full contents:${input}`,
        }));
        const result = await runRecipeFixture(
            artifact,
            { title: "new title" },
            host,
            context(),
            async (api, input, ctx) => {
                const lookup = await api.invokeCapability(
                    artifact.capabilities[0],
                    (input as { title: string }).title,
                    ctx,
                );
                if (lookup.status !== "completed")
                    throw new Error(lookup.status);
                const read = await api.invokeCapability(
                    artifact.capabilities[1],
                    lookup.value,
                    { ...ctx, callId: "call-2", parentCallId: ctx.callId },
                );
                if (read.status !== "completed") throw new Error(read.status);
                return read.value;
            },
        );
        expect(result.status).toBe("passed");
        if (result.status !== "passed") throw new Error(result.message);
        expect(result.output).toBe("full contents:fresh-id:new title");
        expect(result.calls.map((call) => call.id)).toEqual(["lookup", "read"]);
        expect(result.calls[1].parentCallId).toBe("call-1");
    });

    it("runs no fixture calls on missing dependencies or invalid input", async () => {
        const artifact = sealRecipeArtifact(draft());
        const host = new FakeRecipeHost();
        let executions = 0;
        const execute = async () => {
            executions++;
            return "should not run";
        };
        expect(
            (
                await runRecipeFixture(
                    artifact,
                    { title: "new" },
                    host,
                    context(),
                    execute,
                )
            ).status,
        ).toBe("failed");
        expect(
            (await runRecipeFixture(artifact, {}, host, context(), execute))
                .status,
        ).toBe("failed");
        expect(executions).toBe(0);
        expect(host.calls).toEqual([]);
    });

    it.each<RecipeCallOutcome>([
        {
            status: "requires_interaction",
            interactionId: "interaction-1",
            prompt: "Choose explicitly.",
        },
        {
            status: "execution_uncertain",
            operationId: "operation-1",
            message: "Reply lost after dispatch.",
        },
        { status: "denied", code: "host_denied", message: "Denied." },
        { status: "cancelled", code: "cancelled", message: "Cancelled." },
        { status: "unavailable", code: "offline", message: "Unavailable." },
        { status: "failed", code: "failure", message: "Failed." },
        { status: "unsupported", code: "host_gap", message: "Unsupported." },
    ])(
        "preserves explicit capability outcome %j without retry",
        async (outcome) => {
            const host = new FakeRecipeHost();
            const definition = {
                ...capability("write", "mcp"),
                effect: "write" as const,
            };
            host.registerCapability(definition, () => outcome);
            expect(
                await host.invokeCapability(definition, "input", context()),
            ).toEqual(outcome);
            expect(host.calls).toHaveLength(1);
        },
    );

    it("does not dispatch cancelled calls or treat malformed outputs as success", async () => {
        const host = new FakeRecipeHost();
        const definition = capability("read");
        host.registerCapability(definition, () => ({
            status: "completed",
            value: 1,
        }));
        const abort = new AbortController();
        abort.abort();
        expect(
            (
                await host.invokeCapability(
                    definition,
                    "input",
                    context(abort.signal),
                )
            ).status,
        ).toBe("cancelled");
        expect(host.calls).toHaveLength(0);
        expect(
            await host.invokeCapability(definition, "input", context()),
        ).toMatchObject({ status: "failed", code: "invalid_output" });
    });

    it.each<RecipeSemanticOutcome>([
        { status: "abstained", reason: "Insufficient evidence." },
        { status: "provider_error", message: "Provider unavailable." },
        { status: "limit_exceeded", message: "Bound exceeded." },
        { status: "invalid_output", message: "Invalid JSON." },
        { status: "unsupported", message: "No approved model seam." },
    ])("preserves semantic outcome %j", async (outcome) => {
        const host = new FakeRecipeHost();
        host.registerSemantic(semantic, () => outcome);
        expect(await host.invokeSemantic(semantic, "input", context())).toEqual(
            outcome,
        );
        expect(host.calls).toHaveLength(1);
    });

    it("validates semantic schema and suppresses late cancelled results", async () => {
        const host = new FakeRecipeHost();
        const evidence = {
            functionId: semantic.id,
            functionRevision: semantic.revision,
            resolvedModel: "fixture-model",
            latencyMs: 1,
            validation: "passed" as const,
            sourceIds: ["source-1"],
        };
        host.registerSemantic(semantic, () => ({
            status: "completed",
            value: 1,
            evidence,
        }));
        expect(
            (await host.invokeSemantic(semantic, "input", context())).status,
        ).toBe("invalid_output");
        const abort = new AbortController();
        host.registerSemantic(semantic, () => {
            abort.abort();
            return { status: "completed", value: "valid", evidence };
        });
        expect(
            (
                await host.invokeSemantic(
                    semantic,
                    "input",
                    context(abort.signal),
                )
            ).status,
        ).toBe("cancelled");
    });
});
