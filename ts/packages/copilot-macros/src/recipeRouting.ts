// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    globalEntityRegistry,
    loadGrammarRules,
    matchGrammar,
    registerBuiltInEntities,
    type EntityConverter,
    type Grammar,
    type GrammarMatchResult,
} from "@typeagent/action-grammar/runtime";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { DurableRecipeCatalog } from "./recipeCatalog.js";
import type {
    JsonValue,
    RecipeArtifact,
    RecipeBindingScope,
    RecipeCallContext,
    RecipeHost,
    RecipeRevisionRef,
    RecipeRunResult,
    RecipeScope,
} from "./recipeContracts.js";
import { validateRecipeValue } from "./recipeValidation.js";

export interface RecipeRoute extends RecipeRevisionRef {
    scope: RecipeScope;
    catalogRevision: number;
    input: JsonValue;
}

export type RecipeRouteDecision =
    | { status: "matched"; route: RecipeRoute }
    | {
          status: "miss";
          originalPrompt: string;
          reason: "no_match" | "ambiguous" | "unsupported";
      };

export interface RecipeExecutionContext {
    runId: string;
    binding: RecipeBindingScope;
    signal: AbortSignal;
    host: RecipeHost;
}

// P3 supplies a contained executor. P2 never evaluates artifact source/text.
export type RecipeExecutor = (
    artifact: RecipeArtifact,
    input: JsonValue,
    context: RecipeExecutionContext,
) => Promise<RecipeRunResult>;

export interface RecipeRouterOptions {
    entityConverters?: Record<string, EntityConverter<JsonValue>>;
    // Explicit output-path bindings handle grammars with several entity types.
    entityBindings?: (artifact: RecipeArtifact) => Record<string, string>;
}

interface CompiledRecipe {
    artifact: RecipeArtifact;
    grammar: Grammar;
}

function replaceEntity(
    value: JsonValue,
    propertyPath: string,
    converter: EntityConverter<JsonValue>,
) {
    const keys = propertyPath.split(".");
    let parent: JsonValue = value;
    for (const key of keys.slice(0, -1)) {
        if (!parent || typeof parent !== "object" || !(key in parent))
            throw new Error("Unknown entity output path.");
        parent = (parent as Record<string, JsonValue>)[key];
    }
    if (!parent || typeof parent !== "object")
        throw new Error("Invalid entity output.");
    const target = parent as Record<string, JsonValue>;
    const key = keys[keys.length - 1];
    const raw = target[key];
    if (typeof raw !== "string" || !converter.validate(raw))
        throw new Error("Unsupported entity value.");
    const converted = converter.convert(raw);
    if (converted === undefined) throw new Error("Entity conversion failed.");
    target[key] = converted;
}

function bindInput(
    compiled: CompiledRecipe,
    result: GrammarMatchResult,
    options: RecipeRouterOptions,
): JsonValue | undefined {
    // JSON round-tripping rejects undefined and non-data matcher results.
    const input: JsonValue = JSON.parse(JSON.stringify(result.match));
    const bindings = options.entityBindings?.(compiled.artifact) ?? {};
    for (const propertyPath of result.entityWildcardPropertyNames) {
        const type =
            bindings[propertyPath] ??
            (compiled.grammar.entities?.length === 1
                ? compiled.grammar.entities[0]
                : undefined);
        const converter =
            type &&
            (options.entityConverters?.[type] ??
                globalEntityRegistry.getConverter<JsonValue>(type));
        if (!converter) return undefined;
        replaceEntity(input, propertyPath, converter);
    }
    return validateRecipeValue(compiled.artifact.inputSchema, input).length
        ? undefined
        : input;
}

function compile(
    artifact: RecipeArtifact,
    options: RecipeRouterOptions,
): CompiledRecipe {
    const grammar = loadGrammarRules(
        "recipe.agr",
        artifact.matching.grammar.join("\n"),
        { enableValueExpressions: false },
    );
    const compiled = { artifact, grammar };
    for (const negative of artifact.matching.negatives) {
        if (
            matchGrammar(grammar, negative).some((result) => {
                try {
                    return bindInput(compiled, result, options) !== undefined;
                } catch {
                    return false;
                }
            })
        )
            throw new Error("Grammar matches a negative example.");
    }
    for (const example of artifact.matching.examples) {
        const matches = matchGrammar(grammar, example.request).map((result) =>
            bindInput(compiled, result, options),
        );
        if (
            !matches.length ||
            matches.some(
                (input) =>
                    input === undefined ||
                    !isDeepStrictEqual(input, example.input),
            )
        )
            throw new Error("Grammar does not reproduce typed example inputs.");
    }
    return compiled;
}

function failedRun(
    route: RecipeRevisionRef,
    runId: string,
    message: string,
): RecipeRunResult {
    return {
        recipeId: route.recipeId,
        revision: route.revision,
        runId,
        accepted: true,
        status: "failed",
        message,
        checkpoints: [],
        completedCallIds: [],
        semanticEvidence: [],
        fallback: "never",
    };
}

/**
 * Hook, explicit-command and recipe-tool adapters must call this same router.
 * Every match reads a durable snapshot; acceptance uses its revision as a CAS.
 * Local notifications evict eagerly, but correctness never depends on delivery
 * of an in-process notification from another process.
 */
export class RecipeRouter {
    private readonly cache = new Map<string, CompiledRecipe[]>();
    private readonly unsubscribe: () => void;

    constructor(
        private readonly catalog: DurableRecipeCatalog,
        private readonly options: RecipeRouterOptions = {},
    ) {
        registerBuiltInEntities();
        this.unsubscribe = catalog.subscribe(() => this.cache.clear());
    }

    close() {
        this.unsubscribe();
        this.cache.clear();
    }

    async match(
        scope: RecipeScope,
        originalPrompt: string,
    ): Promise<RecipeRouteDecision> {
        const snapshot = await this.catalog.snapshot(scope);
        const key = JSON.stringify([scope, snapshot.catalogRevision]);
        let entries = this.cache.get(key);
        let unsupported = false;
        if (!entries) {
            entries = [];
            for (const entry of snapshot.entries) {
                if (entry.state !== "ready") continue;
                try {
                    entries.push(compile(entry.artifact, this.options));
                } catch {
                    unsupported = true;
                }
            }
            this.cache.clear();
            this.cache.set(key, entries);
        }
        const routes = new Map<string, RecipeRoute>();
        for (const entry of entries) {
            try {
                for (const result of matchGrammar(
                    entry.grammar,
                    originalPrompt,
                )) {
                    const input = bindInput(entry, result, this.options);
                    if (input === undefined) {
                        unsupported = true;
                        continue;
                    }
                    const route: RecipeRoute = {
                        scope: structuredClone(scope),
                        catalogRevision: snapshot.catalogRevision,
                        recipeId: entry.artifact.recipeId,
                        revision: entry.artifact.revision,
                        input,
                    };
                    routes.set(
                        JSON.stringify([route.recipeId, route.revision, input]),
                        route,
                    );
                }
            } catch {
                unsupported = true;
            }
        }
        if (routes.size === 1)
            return { status: "matched", route: routes.values().next().value! };
        return {
            status: "miss",
            originalPrompt,
            reason:
                routes.size > 1
                    ? "ambiguous"
                    : unsupported
                      ? "unsupported"
                      : "no_match",
        };
    }

    async explicit(
        scope: RecipeScope,
        ref: RecipeRevisionRef,
        input: JsonValue,
    ): Promise<RecipeRoute | undefined> {
        const snapshot = await this.catalog.snapshot(scope);
        const entry = snapshot.entries.find(
            (e) =>
                e.state === "ready" &&
                e.artifact.recipeId === ref.recipeId &&
                e.artifact.revision === ref.revision,
        );
        if (
            !entry ||
            validateRecipeValue(entry.artifact.inputSchema, input).length
        )
            return undefined;
        return {
            scope: structuredClone(scope),
            recipeId: ref.recipeId,
            revision: ref.revision,
            input: structuredClone(input),
            catalogRevision: snapshot.catalogRevision,
        };
    }

    async invoke(
        route: RecipeRoute,
        binding: RecipeBindingScope,
        host: RecipeHost,
        execute: RecipeExecutor,
        signal?: AbortSignal,
    ): Promise<
        | { status: "rejected"; reason: "stale" | "invalid_input" }
        | { status: "accepted"; result: RecipeRunResult }
    > {
        if (
            route.scope.workspaceId !== binding.workspaceId ||
            route.scope.profileId !== binding.profileId
        )
            return { status: "rejected", reason: "stale" };
        const snapshot = await this.catalog.snapshot(route.scope);
        const artifact = snapshot.entries.find(
            (entry) =>
                entry.state === "ready" &&
                entry.artifact.recipeId === route.recipeId &&
                entry.artifact.revision === route.revision,
        )?.artifact;
        if (!artifact || snapshot.catalogRevision !== route.catalogRevision)
            return { status: "rejected", reason: "stale" };
        if (validateRecipeValue(artifact.inputSchema, route.input).length)
            return { status: "rejected", reason: "invalid_input" };
        const runId = randomUUID();
        const accepted = await this.catalog.acceptRun(
            route.scope,
            route,
            route.catalogRevision,
            runId,
        );
        if (accepted.status === "conflict")
            return { status: "rejected", reason: "stale" };
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        const guardedHost = this.guardHost(
            route.scope,
            runId,
            host,
            controller,
        );
        let result: RecipeRunResult;
        try {
            result = await execute(structuredClone(artifact), route.input, {
                runId,
                binding,
                signal: controller.signal,
                host: guardedHost,
            });
            if (
                !result.accepted ||
                result.runId !== runId ||
                result.recipeId !== route.recipeId ||
                result.revision !== route.revision ||
                result.fallback !== "never"
            )
                throw new Error("Executor returned an invalid run identity.");
        } catch (error) {
            result = failedRun(
                route,
                runId,
                error instanceof Error ? error.message : "Executor failed.",
            );
        } finally {
            signal?.removeEventListener("abort", abort);
        }
        await this.catalog.finishRun(route.scope, result);
        return { status: "accepted", result };
    }

    private guardHost(
        scope: RecipeScope,
        runId: string,
        host: RecipeHost,
        controller: AbortController,
    ): RecipeHost {
        const allowed = async () => {
            if (!(await this.catalog.mayCall(scope, runId))) controller.abort();
            return !controller.signal.aborted;
        };
        const context = (value: RecipeCallContext): RecipeCallContext => ({
            ...value,
            runId,
            signal: controller.signal,
        });
        return {
            inspectCapability: async (capability, binding) =>
                (await allowed())
                    ? host.inspectCapability(capability, binding)
                    : { status: "unavailable", message: "Run invalidated." },
            invokeCapability: async (capability, input, call) => {
                const checkpoint = {
                    callId: call.callId,
                    ...(call.parentCallId
                        ? { parentCallId: call.parentCallId }
                        : {}),
                    capabilityId: capability.id,
                    effect: capability.effect,
                    phase: "dispatched" as const,
                };
                if (
                    controller.signal.aborted ||
                    !(await this.catalog.beginCall(scope, runId, checkpoint))
                )
                    return {
                        status: "cancelled",
                        code: "invalidated",
                        message:
                            "Future calls stopped; completed effects remain.",
                    };
                try {
                    const result = await host.invokeCapability(
                        capability,
                        input,
                        context(call),
                    );
                    await this.catalog.completeCall(scope, runId, {
                        ...checkpoint,
                        phase:
                            result.status === "completed"
                                ? "completed"
                                : "uncertain",
                        ...(result.status === "execution_uncertain"
                            ? { operationId: result.operationId }
                            : {}),
                    });
                    return result;
                } catch (error) {
                    await this.catalog.completeCall(scope, runId, {
                        ...checkpoint,
                        phase: "uncertain",
                    });
                    throw error;
                }
            },
            invokeSemantic: async (definition, input, call) =>
                (await allowed())
                    ? host.invokeSemantic(definition, input, context(call))
                    : { status: "cancelled", message: "Run invalidated." },
        };
    }
}
