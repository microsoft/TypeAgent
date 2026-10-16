// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DurableRecipeCatalog } from "@typeagent/copilot-macros/recipeCatalog";
import {
    recipeSchemaDigest,
    type RecipeArtifact,
    type RecipeRunResult,
} from "@typeagent/copilot-macros/recipeCore";
import {
    RecipeRouter,
    type RecipeExecutionContext,
} from "@typeagent/copilot-macros/recipeRouting";
import { FakeRecipeHost } from "@typeagent/copilot-macros/recipeTesting";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import {
    recipeArtifact,
    recipeCapture,
    recipeJob,
    recipeScope,
} from "./recipeCatalogFixtures.js";

let directory: string;
let catalog: DurableRecipeCatalog;
let router: RecipeRouter;
const binding = {
    ...recipeScope,
    providerId: "fixture",
    accountId: "account",
    sessionId: "session",
    generation: "1",
};

beforeEach(async () => {
    directory = path.resolve(".recipe-routing-tests", randomUUID());
    await mkdir(directory, { recursive: true });
    catalog = new DurableRecipeCatalog(directory);
    router = new RecipeRouter(catalog);
});
afterEach(async () => {
    router.close();
    catalog.close();
    await rm(directory, { recursive: true, force: true });
});

async function publish(
    artifact = recipeArtifact(),
    state: "prepared" | "ready" = "ready",
) {
    const revision = (await catalog.snapshot(recipeScope)).catalogRevision;
    await catalog.transact(recipeScope, revision, (tx) => {
        tx.enqueueCapture(
            recipeCapture(artifact.provenance.captureId),
            recipeJob(artifact.provenance.captureId),
        );
        tx.putImmutable(artifact);
        tx.publish(artifact, artifact.provenance.captureId, state);
    });
    return artifact;
}

function completed(
    artifact: RecipeArtifact,
    context: RecipeExecutionContext,
): RecipeRunResult {
    return {
        recipeId: artifact.recipeId,
        revision: artifact.revision,
        runId: context.runId,
        accepted: true,
        status: "completed",
        output: "fixture",
        checkpoints: [],
        completedCallIds: [],
        semanticEvidence: [],
        fallback: "never",
    };
}

test("clean miss preserves exact prompt with no host/backend access", async () => {
    const prompt = "  Unknown Request\nKeep this text. ";
    expect(await router.match(recipeScope, prompt)).toEqual({
        status: "miss",
        originalPrompt: prompt,
        reason: "no_match",
    });
});

test("isolates grammars and rejects inter-recipe collisions", async () => {
    await publish();
    expect((await router.match(recipeScope, "read document")).status).toBe(
        "matched",
    );
    await publish(recipeArtifact("other", "other"));
    expect(await router.match(recipeScope, "read document")).toEqual({
        status: "miss",
        originalPrompt: "read document",
        reason: "ambiguous",
    });
});

test("prepared candidates cannot execute through matching or explicit entry", async () => {
    const artifact = await publish(recipeArtifact(), "prepared");
    expect((await router.match(recipeScope, "read document")).status).toBe(
        "miss",
    );
    expect(
        await router.explicit(recipeScope, artifact, { title: "document" }),
    ).toBeUndefined();
    await catalog.approve(recipeScope, artifact);
    expect(
        await router.explicit(recipeScope, artifact, { title: "document" }),
    ).toBeDefined();
    expect(
        await router.explicit(recipeScope, artifact, { title: 9 }),
    ).toBeUndefined();
});

test("negative examples and unsafe grammar expressions fail closed", async () => {
    const artifact = recipeArtifact("negative", "negative", {
        matching: {
            grammar: ['<Start> = read document -> { title: "document" };'],
            examples: [],
            negatives: ["read document"],
            collisionEvidenceIds: [],
        },
    });
    await publish(artifact);
    expect((await router.match(recipeScope, "read document")).status).toBe(
        "miss",
    );
    await publish(
        recipeArtifact("expression", "expression", {
            matching: {
                grammar: [
                    "<Start> = unsafe -> { title: globalThis.process.exit() };",
                ],
                examples: [],
                negatives: [],
                collisionEvidenceIds: [],
            },
        }),
    );
    expect((await router.match(recipeScope, "unsafe")).status).toBe("miss");
});

test("numeric and built-in entity values bind to typed inputs", async () => {
    await publish(
        recipeArtifact("count", "count", {
            inputSchema: {
                type: "object",
                properties: { count: { type: "integer" } },
                required: ["count"],
                additionalProperties: false,
            },
            matching: {
                grammar: ["<Start> = count $(count:Cardinal) -> { count };"],
                examples: [
                    {
                        request: "count three",
                        input: { count: 3 },
                        evidenceIds: ["evidence"],
                    },
                ],
                negatives: ["count nonsense"],
                collisionEvidenceIds: [],
            },
        }),
    );
    const decision = await router.match(recipeScope, "count three");
    expect(decision.status).toBe("matched");
    if (decision.status === "matched")
        expect(decision.route.input).toEqual({ count: 3 });
});

test("stale/disabled cross-instance snapshot cannot accept a new run", async () => {
    const artifact = await publish();
    const decision = await router.match(recipeScope, "read document");
    expect(decision.status).toBe("matched");
    const independent = new DurableRecipeCatalog(directory);
    try {
        await independent.disable(recipeScope, artifact);
    } finally {
        independent.close();
    }
    if (decision.status !== "matched") throw new Error("Expected route.");
    expect(
        await router.invoke(
            decision.route,
            binding,
            new FakeRecipeHost(),
            async (a, _i, ctx) => completed(a, ctx),
        ),
    ).toEqual({ status: "rejected", reason: "stale" });
    expect((await router.match(recipeScope, "read document")).status).toBe(
        "miss",
    );
    expect(await catalog.listRuns(recipeScope)).toHaveLength(0);
});

test("accepted failure is durable and never falls back or silently reruns", async () => {
    const artifact = await publish();
    const route = await router.explicit(recipeScope, artifact, {
        title: "document",
    });
    const result = await router.invoke(
        route!,
        binding,
        new FakeRecipeHost(),
        async () => {
            throw new Error("accepted fixture failure");
        },
    );
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted")
        throw new Error("Expected accepted failure.");
    expect(result.result).toMatchObject({
        accepted: true,
        status: "failed",
        fallback: "never",
    });
    expect((await catalog.listRuns(recipeScope))[0].result).toEqual(
        result.result,
    );
    expect(
        await router.invoke(
            route!,
            binding,
            new FakeRecipeHost(),
            async (a, _i, ctx) => completed(a, ctx),
        ),
    ).toEqual({ status: "rejected", reason: "stale" });
});

test("disable pins immutable revision, retains completed effects and blocks future calls", async () => {
    const schema = { type: "string" as const };
    const capability = {
        id: "read",
        transport: "native" as const,
        providerId: "fixture",
        operation: "read",
        contractVersion: "1",
        inputSchema: schema,
        outputSchema: schema,
        schemaDigest: recipeSchemaDigest(schema, schema),
        compatibility: "exact" as const,
        effect: "read" as const,
    };
    const artifact = await publish(
        recipeArtifact("calls", "calls", { capabilities: [capability] }),
    );
    const host = new FakeRecipeHost();
    host.registerCapability(capability, async () => ({
        status: "completed",
        value: "current",
    }));
    const route = await router.explicit(recipeScope, artifact, {
        title: "document",
    });
    const result = await router.invoke(
        route!,
        binding,
        host,
        async (a, _input, context) => {
            const call = {
                runId: context.runId,
                callId: "first",
                binding,
                signal: context.signal,
            };
            expect(
                (await context.host.invokeCapability(capability, "first", call))
                    .status,
            ).toBe("completed");
            const independent = new DurableRecipeCatalog(directory);
            try {
                await independent.disable(recipeScope, artifact);
            } finally {
                independent.close();
            }
            expect(
                (
                    await context.host.invokeCapability(capability, "second", {
                        ...call,
                        callId: "second",
                    })
                ).status,
            ).toBe("cancelled");
            return { ...completed(a, context), status: "cancelled" };
        },
    );
    expect(host.calls).toHaveLength(1);
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("Expected acceptance.");
    expect(result.result.revision).toBe(artifact.revision);
    expect(result.result.completedCallIds).toEqual(["first"]);
    expect(result.result.checkpoints).toMatchObject([
        { callId: "first", phase: "completed" },
    ]);
    expect((await catalog.listRuns(recipeScope))[0].cancelRequested).toBe(true);
});

test("throw after a host effect retains its durable checkpoint", async () => {
    const schema = { type: "string" as const };
    const capability = {
        id: "read",
        transport: "native" as const,
        providerId: "fixture",
        operation: "read",
        contractVersion: "1",
        inputSchema: schema,
        outputSchema: schema,
        schemaDigest: recipeSchemaDigest(schema, schema),
        compatibility: "exact" as const,
        effect: "read" as const,
    };
    const artifact = await publish(
        recipeArtifact("effect", "effect", { capabilities: [capability] }),
    );
    const host = new FakeRecipeHost();
    host.registerCapability(capability, async () => ({
        status: "completed",
        value: "current",
    }));
    const route = await router.explicit(recipeScope, artifact, {
        title: "document",
    });
    const result = await router.invoke(
        route!,
        binding,
        host,
        async (_a, _input, context) => {
            await context.host.invokeCapability(capability, "first", {
                runId: context.runId,
                callId: "effect",
                binding,
                signal: context.signal,
            });
            throw new Error("fixture crashed after effect");
        },
    );
    if (result.status !== "accepted")
        throw new Error("Expected accepted failure.");
    expect(result.result.status).toBe("failed");
    expect(result.result.completedCallIds).toEqual(["effect"]);
    expect(result.result.checkpoints[0].phase).toBe("completed");
});
