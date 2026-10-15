// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export const reviewTerms = ["lease-budget review", "connection-hold review"];
export const tailMarker = "Governing tail exception:";
const passages = (input) =>
    input.inputs.flatMap((source) => source.passages ?? []);
const body = (output) =>
    output.content.sections.map((section) => section.body).join("\n\n");

function traced(target, method, controls, label = method) {
    const original = target[method];
    if (typeof original !== "function" || !controls.onEvent) return () => {};
    if (controls.tracer) return controls.tracer.wrap(target, method, label);
    target[method] = async function (...args) {
        const startedEpochMs = Date.now();
        const first = args[0];
        const context =
            typeof first === "object" && first
                ? {
                      corpusId: first.corpusId,
                      viewId: first.definition?.viewId ?? first.viewId,
                      query:
                          first.definition?.wiki?.query ??
                          first.definition?.projectSummary?.query,
                      sourceIds:
                          first.sourceIds ??
                          first.inputs?.map((input) => input.sourceId),
                      terms: first.terms,
                      followSources: first.followSources,
                      fingerprint:
                          first.inputFingerprint ?? first.selectionFingerprint,
                      holdConfigured: !!(
                          controls.hold ||
                          controls.consolidationHold ||
                          controls.topicHold
                      ),
                  }
                : {
                      corpusId: first,
                      jobId: args[1],
                      targetId:
                          typeof args[2] === "string" ? args[2] : undefined,
                  };
        controls.onEvent(label, "ENTER", { ...context, startedEpochMs });
        try {
            const result = await original.apply(this, args);
            controls.onEvent(label, "EXIT", {
                ...context,
                elapsedMs: Date.now() - startedEpochMs,
                state: result?.state,
                fragments: result?.fragments?.length,
                readChars: result?.readChars,
                limited: result?.limited,
                chars: typeof result === "string" ? result.length : undefined,
            });
            return result;
        } catch (error) {
            controls.onEvent(label, "ERROR", {
                ...context,
                elapsedMs: Date.now() - startedEpochMs,
                name: error.name,
                message: error.message,
            });
            throw error;
        }
    };
    return () => {
        target[method] = original;
    };
}

export function installStoreTrace(TypedViewStore, controls) {
    const restores = [
        "admitViewBuild",
        "materializeViewBuild",
        "updateViewBuild",
        "acceptWikiConsolidation",
        "activateWikiRedirect",
        "updateViewIndex",
    ].map((method) =>
        traced(TypedViewStore.prototype, method, controls, `store.${method}`),
    );
    return () => restores.reverse().forEach((restore) => restore());
}

export function installOfflineTrace(options, controls) {
    for (const method of [
        "generate",
        "generateTopics",
        "assessWikiSubject",
        "assessWikiConsolidation",
        "checkWikiConsolidation",
        "checkEditorial",
    ])
        traced(
            options.viewSynthesisAdapter,
            method,
            controls,
            `adapter.${method}`,
        );
    if (options.sourceSynopsisModel)
        for (const method of Object.keys(options.sourceSynopsisModel))
            traced(
                options.sourceSynopsisModel,
                method,
                controls,
                `synopsis.${method}`,
            );
}

export function scopeFromOriginals(input, survivor, retiring) {
    const pair = [survivor, retiring].map((view) =>
        view.definition.wiki?.query.toLowerCase(),
    );
    const fragments = passages(input);
    const proof = fragments.findIndex((fragment) =>
        /lease-budget review and connection-hold review name the same scoped\s+Payments API reliability capacity review/.test(
            fragment.excerpt,
        ),
    );
    if (
        new Set(pair).size !== 2 ||
        !pair.every((term) => reviewTerms.includes(term)) ||
        proof < 0
    )
        return {
            relation: "distinct",
            reason: pair.some((term) => /Identity|Orders/i.test(term ?? ""))
                ? "distinct-scope"
                : "unqualified-purpose",
            scope: { system: "", initiative: "", purpose: "" },
            criticalDistinctions: [],
        };
    const original = fragments[proof].excerpt;
    const start = original.indexOf("Correction:");
    assert.ok(
        start >= 0,
        "Equivalence must be an original explicit correction",
    );
    return {
        relation: "samePurpose",
        reason: "same-scoped-purpose",
        scope: {
            system: "Payments API",
            initiative: "Reliability capacity review",
            purpose:
                "Lease lifetime and peak-load resident memory capacity review",
        },
        criticalDistinctions: [
            {
                fragmentId: `f${proof}`,
                statement: original.slice(start, start + 500),
            },
        ],
    };
}

export function checkActualConsolidation(input, output, scope) {
    const fragments = passages(input);
    const prose = body(output);
    const safe =
        scope.relation === "samePurpose" &&
        scope.criticalDistinctions.length > 0 &&
        scope.criticalDistinctions.every((item) => {
            const fragment = fragments[Number(item.fragmentId.slice(1))];
            return (
                /^f\d+$/.test(item.fragmentId) &&
                fragment?.excerpt.includes(item.statement) &&
                prose.includes(item.statement)
            );
        }) &&
        /still open, not approved or complete/.test(prose) &&
        /lease lifetime and peak-load\s+resident memory/.test(prose);
    return { safe, failures: safe ? [] : ["scope-state"] };
}

export async function installP6Options(options, load, counters, controls) {
    const { parseIndexedLocator, indexedLocator } = await load(
        "packages\\memory\\service\\dist\\indexedFragments.js",
    );
    const factory = options.indexFactory;
    options.indexFactory = (id, directory) => {
        const index = factory(id, directory);
        controls.indexes ??= [];
        controls.indexes.push(index);
        for (const method of [
            "initialize",
            "readFragments",
            "resolveIndexedLocator",
            ...(controls.tracer
                ? ["append", "rebuild", "listSubjects", "getTopicOccurrences"]
                : []),
        ])
            traced(index, method, controls, `index.${method}`);
        if (controls.representativeSelection !== true) return index;
        const original = index.readFragments.bind(index);
        index.readFragments = async (request) => {
            const selection = await original(request);
            const tail = request.terms.some((term) =>
                term.toLowerCase().includes("governing tail exception"),
            );
            const navigation =
                !selection.fragments.length &&
                request.terms.some(
                    (term) => term.toLowerCase() === "overlap review",
                );
            if (!tail && !navigation) return selection;
            const occurrences = await index.getTopicOccurrences(
                new Set(request.sourceIds),
            );
            const occurrence = occurrences.find((entry) =>
                entry.citations
                    .map((citation) => citation.excerpt)
                    .join("")
                    .includes(tail ? tailMarker : "bare overlap"),
            );
            assert.ok(
                occurrence,
                "Representative selection requires actual original index incidence",
            );
            let covered = 0;
            const text = occurrence.citations
                .map((citation) => {
                    const range = parseIndexedLocator(citation.locator);
                    assert.equal(range.start, covered);
                    covered = range.end;
                    return citation.excerpt;
                })
                .join("");
            assert.equal(covered, text.length);
            const first = occurrence.citations[0];
            const range = parseIndexedLocator(first.locator);
            if (navigation)
                assert.ok(
                    text.includes("Preserve navigable context") ||
                        text.includes("Earlier bare overlap links"),
                    "Old navigation may only use original explicit prior-label context",
                );
            const start = tail ? text.indexOf(tailMarker) : 0;
            const end = Math.min(
                text.length,
                start +
                    Math.min(
                        1200,
                        request.maxCharsPerFragment ?? 2000,
                        request.maxReadChars ?? 8000,
                    ),
            );
            const locator = indexedLocator(
                {
                    sourceId: first.sourceId,
                    revisionId: first.revisionId,
                    blockOrdinal: range.blockOrdinal,
                    text,
                    score: 1,
                },
                start,
                end,
            );
            const resolved = await index.resolveIndexedLocator(
                first.sourceId,
                first.revisionId,
                locator,
            );
            assert.equal(resolved, text.slice(start, end));
            controls.representativeSelections ??= [];
            controls.representativeSelections.push({
                purpose: tail
                    ? "governing-tail-article"
                    : "explicit-prior-overlap-navigation",
                sourceId: first.sourceId,
                revisionId: first.revisionId,
                locator,
                defaultFragments: selection.fragments.length,
                suppliedChars: resolved.length,
                limitation:
                    "Injected representative original-index selection; default lexical/semantic retrieval is not certified",
            });
            // Representative selection changes no index or production behavior.
            return {
                fragments: [
                    {
                        sourceId: first.sourceId,
                        revisionId: first.revisionId,
                        locator,
                        snippet: resolved,
                        score: 1,
                    },
                ],
                readChars: resolved.length,
                limited: true,
            };
        };
        return index;
    };
    const adapter = options.viewSynthesisAdapter;
    adapter.assessWikiConsolidation = async (
        input,
        survivor,
        retiring,
        signal,
    ) => {
        signal.throwIfAborted();
        if (controls.recoveringConsolidation) {
            const committed = controls.recoveringConsolidation;
            assert.notDeepEqual(
                [survivor.viewId, retiring.viewId].sort(),
                [committed.survivorViewId, committed.retiringViewId].sort(),
                "Exact committed consolidation participants must not be judged again during recovery",
            );
        }
        counters.consolidationPurpose =
            (counters.consolidationPurpose ?? 0) + 1;
        assert.ok(
            !JSON.stringify(input).includes("MAINTENANCE_EVALUATOR_ONLY"),
        );
        return scopeFromOriginals(input, survivor, retiring);
    };
    adapter.checkWikiConsolidation = async (
        input,
        output,
        assessment,
        signal,
    ) => {
        counters.consolidationActual = (counters.consolidationActual ?? 0) + 1;
        controls.consolidationInputs ??= [];
        controls.consolidationInputs.push(structuredClone(input));
        if (controls.consolidationHold) {
            controls.consolidationEntered = true;
            await controls.consolidationHold;
        }
        signal.throwIfAborted();
        const result = checkActualConsolidation(input, output, assessment);
        if (result.safe) controls.p6Armed = true;
        return result;
    };
}

export function installCanonicalCrash(
    TypedViewStore,
    controls,
    receipt,
    persist,
    writeCrash,
) {
    const original = TypedViewStore.prototype.acceptWikiConsolidation;
    assert.equal(
        typeof original,
        "function",
        "Current compiled P6 acceptance hook required",
    );
    TypedViewStore.prototype.acceptWikiConsolidation = async function (
        ...args
    ) {
        const saved = await original.apply(this, args);
        if (
            controls.p6Armed &&
            receipt.phase === "t1" &&
            !receipt.actions.crash &&
            args[0] === receipt.corpusId
        ) {
            const job = await this.getViewBuild(args[0], args[1]);
            const result = job.results.find(
                (item) => item.wikiConsolidation?.stage === "accepted",
            );
            assert.ok(result, "Actual durable accepted receipt required");
            const consolidation = result.wikiConsolidation;
            const view = await this.getView({
                corpusId: args[0],
                viewId: consolidation.survivorViewId,
            });
            const alias = await this.getView({
                corpusId: args[0],
                viewId: consolidation.retiringViewId,
            });
            const publication = await this.getViewPublication({
                corpusId: args[0],
                viewId: view.viewId,
            });
            assert.equal(alias.redirect, undefined);
            assert.notEqual(publication.indexedRevisionId, view.revisionId);
            receipt.actions.crash = {
                boundary:
                    "P6 canonical commit before alias redirect/index/final acknowledgement",
                phase: receipt.phase,
                workerPid: process.pid,
                epochMs: Date.now(),
                viewId: view.viewId,
                revisionId: view.revisionId,
                version: view.version,
                retiringViewId: alias.viewId,
                jobId: job.jobId,
                publication,
                targetSynthesisCalls: receipt.counters.callsByView[view.viewId],
                counters: structuredClone(receipt.counters),
                consolidation,
            };
            receipt.outcome = "INTERRUPTED_AFTER_CANONICAL_COMMIT";
            await writeCrash(receipt.actions.crash);
            await persist();
            process.exit(86);
        }
        return saved;
    };
    return () => {
        TypedViewStore.prototype.acceptWikiConsolidation = original;
    };
}

export async function verifyConsolidation(service, corpusId) {
    const jobs = await service.listViewBuilds(corpusId);
    const results = jobs.flatMap((job) =>
        job.results.map((result) => ({ jobId: job.jobId, ...result })),
    );
    const merged = results.find(
        (result) => result.wikiConsolidation?.stage === "ready",
    );
    assert.ok(merged, "Unused merge cannot pass final offline preflight");
    assert.equal(merged.state, "merged");
    const receipt = merged.wikiConsolidation;
    const canonical = await service.getView({
        corpusId,
        viewId: receipt.survivorViewId,
    });
    const alias = await service.getView({
        corpusId,
        viewId: receipt.retiringViewId,
    });
    assert.equal(alias.redirect.viewId, canonical.viewId);
    assert.deepEqual(alias.content, canonical.content);
    assert.ok(receipt.anchors.length);
    for (const anchor of receipt.anchors)
        assert.ok(
            canonical.content.sections.some(
                (section) => section.id === anchor.to,
            ),
        );
    for (const section of receipt.output.content.sections)
        assert.ok(
            canonical.content.sections.some(
                (current) =>
                    current.id === section.id && current.body === section.body,
            ),
        );
    const originals = await Promise.all([
        service.getView({
            corpusId,
            viewId: receipt.survivorViewId,
            revisionId: receipt.input.targetRevisionId,
        }),
        service.getView({
            corpusId,
            viewId: receipt.retiringViewId,
            revisionId: receipt.retiringRevisionId,
        }),
    ]);
    let preservedOriginalSections = 0;
    let preservedOriginalCitations = 0;
    for (const original of originals) {
        assert.ok(
            original,
            "Actual participating historical revision must remain eligible",
        );
        for (const section of original.content.sections) {
            assert.ok(
                canonical.content.sections.some(
                    (current) =>
                        current.id === section.id &&
                        current.body === section.body,
                ),
                "Each unique participating original section must survive exactly",
            );
            preservedOriginalSections++;
        }
        for (const citation of original.content.citations) {
            assert.ok(
                canonical.content.citations.some(
                    (current) =>
                        current.sourceId === citation.sourceId &&
                        current.revisionId === citation.revisionId &&
                        current.locator === citation.locator &&
                        current.excerpt === citation.excerpt,
                ),
                "Participating original indexed citation must survive exactly",
            );
            preservedOriginalCitations++;
        }
    }
    for (const distinction of receipt.assessment.criticalDistinctions)
        assert.ok(
            body({ content: canonical.content }).includes(
                distinction.statement,
            ),
        );
    for (const citation of canonical.content.citations) {
        const resolved = await service.getSourceContent({
            corpusId,
            sourceId: citation.sourceId,
            revisionId: citation.revisionId,
            indexedLocator: citation.locator,
        });
        assert.equal(resolved.content, citation.excerpt);
    }
    const publication = await service.getViewPublication({
        corpusId,
        viewId: canonical.viewId,
    });
    assert.equal(publication.indexState, "ready");
    assert.equal(publication.indexedRevisionId, canonical.revisionId);
    return {
        jobId: merged.jobId,
        survivorViewId: canonical.viewId,
        retiringViewId: receipt.retiringViewId,
        acceptedRevisionId: receipt.acceptedRevisionId,
        currentRevisionId: canonical.revisionId,
        stage: receipt.stage,
        anchors: receipt.anchors,
        sections: canonical.content.sections.length,
        exactCitations: canonical.content.citations.length,
        preservedOriginalSections,
        preservedOriginalCitations,
        publication,
    };
}

export async function verifyTailArticle(
    service,
    corpusId,
    viewId,
    file,
    reference,
) {
    const original = await readFile(file, "utf8");
    const expected = original.slice(
        original.indexOf(tailMarker),
        original.indexOf(tailMarker) + 822,
    );
    assert.equal(expected.length, 822);
    const view = await service.getView({ corpusId, viewId });
    assert.ok(
        body({ content: view.content }).includes(expected),
        "Actual article must contain full original governing tail",
    );
    const citation = view.content.citations.find(
        (entry) =>
            entry.excerpt.includes(expected) &&
            (!reference ||
                (entry.sourceId === reference.sourceId &&
                    entry.revisionId === reference.revisionId)),
    );
    assert.ok(
        citation,
        "Article must cite the complete tail, not merely an index/synopsis proxy",
    );
    const resolved = await service.getSourceContent({
        corpusId,
        sourceId: citation.sourceId,
        revisionId: citation.revisionId,
        indexedLocator: citation.locator,
    });
    assert.equal(resolved.content, citation.excerpt);
    assert.ok(
        view.content.sections.some((section) =>
            section.body.includes("Coverage limits:"),
        ),
    );
    return {
        viewId,
        revisionId: view.revisionId,
        sourceId: citation.sourceId,
        sourceRevisionId: citation.revisionId,
        locator: citation.locator,
        exactTailChars: expected.length,
        selection:
            "Actual product article and resolved original indexed citation; caller records default versus diagnostic selection",
    };
}
