// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createReplayTape } from "./replay-tape.mjs";
import { hashBytes, hashValue } from "./replay-artifacts.mjs";

export function validateLiveAuthorization(authorization, now = Date.now()) {
    assert.equal(authorization.authorizedByUser, true);
    assert.equal(authorization.automaticFailedArmReruns, false);
    assert.equal(authorization.totalWindowHours, 6);
    assert.ok(Number.isSafeInteger(authorization.startedEpochMs));
    assert.ok(Number.isSafeInteger(authorization.deadlineEpochMs));
    assert.equal(
        authorization.deadlineEpochMs - authorization.startedEpochMs,
        6 * 60 * 60_000,
    );
    assert.ok(
        authorization.startedEpochMs <= now &&
            now < authorization.deadlineEpochMs,
        "Live authorization expired or has not started",
    );
    return authorization.deadlineEpochMs - now;
}

export async function freezeWikiRejection(product, history, targetId) {
    const load = (name) =>
        import(
            pathToFileURL(
                path.join(
                    product,
                    "packages",
                    "memory",
                    "service",
                    "dist",
                    name,
                ),
            ).href
        );
    const { ViewHistory } = await load("viewHistory.js");
    const {
        compatibleConsolidationPair,
        consolidationInput,
        preservedCanonicalOutput,
    } = await load("wikiConsolidation.js");
    const { head, state } = await new ViewHistory(history, () => ({})).read();
    const targets = Object.values(state.builds ?? {}).flatMap((job) =>
        job.results.filter(
            (target) =>
                target.viewId === targetId && target.state === "blocked",
        ),
    );
    assert.equal(
        targets.length,
        1,
        "Select exactly one retained blocked target",
    );
    assert.match(
        targets[0].reason,
        /Editorial rejection: critical-distinction/,
    );
    const pages = Object.values(state.views).map((versions) => versions.at(-1));
    const target = pages.find((page) => page.viewId === targetId);
    assert.ok(
        target,
        "Rejected target's accepted pre-consolidation article is missing",
    );
    const pairs = pages
        .filter((page) => compatibleConsolidationPair(page, target))
        .map((page) => {
            const [survivor, retiring] = [page, target].sort(
                (a, b) =>
                    a.createdAt.localeCompare(b.createdAt) ||
                    a.viewId.localeCompare(b.viewId),
            );
            const input = consolidationInput(survivor, retiring);
            return {
                survivor,
                retiring,
                input,
                ...preservedCanonicalOutput(survivor, retiring),
            };
        });
    assert.ok(pairs.length, "No retained consolidation partner");
    return {
        schemaVersion: 1,
        history: path.resolve(history),
        head,
        targetId,
        originalFailure: targets[0].reason,
        exactOriginalModelResponsesAvailable: false,
        exactRejectedPartnerAvailable: false,
        scope: "All retained compatible pairs, not a reconstruction of an unrecorded scope judgment",
        pairs,
        inputHash: hashValue(pairs),
    };
}

export async function recordWikiDiagnostics(
    product,
    inputHash,
    output,
    authorization,
    maxCalls,
    work,
) {
    validateLiveAuthorization(authorization);
    assert.ok(
        Number.isSafeInteger(maxCalls) && maxCalls > 0 && maxCalls <= 100,
    );
    const load = (location) =>
        import(pathToFileURL(path.join(product, ...location)).href);
    const config = await load(["packages", "config", "dist", "index.js"]);
    const client = await load(["packages", "aiclient", "dist", "index.js"]);
    const synthesisFile = path.join(
        product,
        "packages",
        "memory",
        "service",
        "dist",
        "viewSynthesis.js",
    );
    const { createConfiguredViewSynthesisAdapter } = await import(
        pathToFileURL(synthesisFile).href
    );
    config.loadConfigSync();
    client.initRuntimeConfigFromProcessEnv();
    const endpoint =
        process.env.TYPEAGENT_MEMORY_VIEW_MODEL_ENDPOINT?.trim() || undefined;
    const model = client.openai.createChatModel(
        endpoint,
        {
            temperature: 0,
            response_format: { type: "json_object" },
        },
        undefined,
        ["memory-views"],
    );
    const tape = await createReplayTape({
        mode: "record",
        file: path.join(output, "model-tape.json"),
        identity: {
            inputHash,
            implementationHash: hashBytes(await readFile(synthesisFile)),
            endpoint: endpoint ?? "default",
        },
        maxCalls,
        timeoutMs: Math.min(
            validateLiveAuthorization(authorization),
            30 * 60_000,
        ),
        authorizedLive: true,
    });
    const capturedModel = {
        completionSettings: model.completionSettings,
        complete: (messages, options, schema, onChunk, signal) => {
            validateLiveAuthorization(authorization);
            return tape.invoke(
                "chat",
                { messages, options, schema },
                (effectiveSignal) => {
                    validateLiveAuthorization(authorization);
                    return model.complete(
                        messages,
                        options,
                        schema,
                        onChunk,
                        effectiveSignal,
                    );
                },
                signal,
            );
        },
    };
    const adapter = createConfiguredViewSynthesisAdapter(
        endpoint,
        4000,
        capturedModel,
    );
    try {
        return await work(adapter, tape);
    } finally {
        await tape.close();
    }
}

export async function qualifyWikiPairs(product, frozen, output, authorization) {
    assert.equal(
        hashValue(frozen.pairs),
        frozen.inputHash,
        "Frozen Wiki inputs changed",
    );
    const base = path.join(product, "packages", "memory", "service", "dist");
    const { verifyOrRepairWikiConsolidation } = await import(
        pathToFileURL(path.join(base, "viewSynthesis.js")).href
    );
    const { viewHash } = await import(
        pathToFileURL(path.join(base, "viewMerge.js")).href
    );
    return recordWikiDiagnostics(
        product,
        frozen.inputHash,
        output,
        authorization,
        frozen.pairs.length * 5,
        async (adapter, tape) => {
            const results = [];
            for (const pair of frozen.pairs) {
                tape.signal.throwIfAborted();
                const started = performance.now();
                const input = structuredClone(pair.input);
                const assessment = await adapter.assessWikiConsolidation(
                    input,
                    pair.survivor,
                    pair.retiring,
                    tape.signal,
                );
                const result = {
                    survivor: pair.survivor.viewId,
                    retiring: pair.retiring.viewId,
                    assessment,
                };
                if (assessment.relation === "samePurpose") {
                    input.wikiContribution.purpose = assessment.scope.purpose;
                    input.wikiContribution.essentialDistinctions =
                        assessment.criticalDistinctions.map((distinction) => ({
                            ...distinction,
                            canonicalExcerpt: "",
                        }));
                    const { fingerprint: _fingerprint, ...body } = input;
                    input.fingerprint = viewHash(body);
                    try {
                        result.verification =
                            await verifyOrRepairWikiConsolidation(
                                adapter,
                                input,
                                pair.output,
                                assessment,
                                tape.signal,
                            );
                        result.outcome = "verified-same-purpose";
                    } catch (error) {
                        if (error?.name !== "EditorialRejection") throw error;
                        result.outcome = "rejected-unsafe-consolidation";
                        result.error = {
                            name: error.name,
                            message: error.message,
                            failures: error.failures,
                        };
                    }
                } else result.outcome = "distinct-scopes-retained";
                result.elapsedMs = performance.now() - started;
                results.push(result);
                await writeFile(
                    path.join(output, "results.json"),
                    JSON.stringify(
                        {
                            frozenInputHash: frozen.inputHash,
                            originalFailure: frozen.originalFailure,
                            results,
                            complete: results.length === frozen.pairs.length,
                            providerCalls: tape.providerCalls,
                        },
                        null,
                        2,
                    ),
                );
            }
            return results;
        },
    );
}

async function main() {
    const { values } = parseArgs({
        options: {
            product: { type: "string" },
            history: { type: "string" },
            target: { type: "string" },
            output: { type: "string" },
            input: { type: "string" },
            authorization: { type: "string" },
        },
    });
    assert.ok(values.product && values.output);
    await mkdir(values.output);
    if (values.input) {
        assert.ok(values.authorization, "Live mode requires authorization");
        const frozen = JSON.parse(await readFile(values.input, "utf8"));
        const authorization = JSON.parse(
            await readFile(values.authorization, "utf8"),
        );
        await qualifyWikiPairs(
            path.resolve(values.product),
            frozen,
            values.output,
            authorization,
        );
    } else {
        assert.ok(values.history && values.target);
        const frozen = await freezeWikiRejection(
            path.resolve(values.product),
            values.history,
            values.target,
        );
        await writeFile(
            path.join(values.output, "frozen.json"),
            JSON.stringify(frozen),
            { flag: "wx" },
        );
    }
}

if (
    process.argv[1] &&
    pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
)
    await main();
