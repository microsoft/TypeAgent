// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { ViewHistory } from "../src/viewHistory.js";
import { TypedViewStore } from "../src/viewStore.js";
import type { ViewHistoryEntry, ViewVersion } from "../src/viewTypes.js";

export interface State {
    views: Record<string, ViewVersion[]>;
    corpusSequence: number;
    unrelatedCorpusState: string;
}

export function version(viewId: string, revision: number): ViewVersion {
    const createdAt = "2026-10-19T00:00:00.000Z";
    return {
        corpusId: "corpus",
        viewId,
        revisionId: `${viewId}-${revision}`,
        version: revision,
        state: revision === 3 ? "archived" : "draft",
        actor: "human-owner",
        createdAt,
        ...(revision > 1
            ? { baseRevisionId: `${viewId}-${revision - 1}` }
            : {}),
        definition: {
            viewId,
            revisionId: "definition-revision",
            kind: "troubleshootingGuide",
            selector: {
                kind: "sources",
                sources: [
                    { sourceId: `${viewId}-source`, revisionId: "source-v1" },
                ],
            },
        },
        content: {
            kind: "troubleshootingGuide",
            title: `${viewId} title ${revision}`,
            citations: [],
            sections: [
                {
                    id: "diagnose",
                    role: "diagnostic",
                    heading: "Diagnosis",
                    body: `${viewId} body ${revision}`,
                },
            ],
        },
        provenance: "merged",
        relationships: [],
        protectedTargets: ["title"],
        edits: [
            {
                id: "editorial-edit",
                target: "title",
                actor: "human-owner",
                createdAt,
                oldHash: "original-title-hash",
                oldValue: "Original",
                newValue: "Protected",
                operation: "set",
                status: "merged",
                protection: ["title"],
                unlockedTargets: ["sections.diagnose.body"],
            },
        ],
    };
}

export function initialState(): State {
    const target = version("target", 1);
    target.generation = {
        candidateId: "candidate",
        content: structuredClone(target.content),
        fingerprint: "generation-fingerprint",
        input: {
            corpusId: "corpus",
            actor: "generator",
            definition: target.definition,
            expectedVersion: 0,
            bounds: {},
            inputs: [],
            influenceSources: [
                { sourceId: "target-source", revisionId: "source-v1" },
            ],
            pipeline: "troubleshooting-v1",
            model: "offline-model",
            fingerprint: "generation-fingerprint",
        },
    };
    const unrelated = version("unrelated", 1);
    unrelated.content.sections[0].body = "unrelated-view-body".repeat(512);
    return {
        views: { target: [target], unrelated: [unrelated] },
        corpusSequence: 0,
        unrelatedCorpusState: "unrelated-corpus-body".repeat(512),
    };
}

export function legacyEntries(
    commits: Array<{ commitId: string; state: State }>,
): ViewHistoryEntry[] {
    const seen = new Set<string>();
    return commits
        .reverse()
        .flatMap(({ commitId, state }) =>
            (state.views.target ?? []).flatMap((version) => {
                if (seen.has(version.revisionId)) return [];
                seen.add(version.revisionId);
                return [{ commitId, version }];
            }),
        )
        .reverse();
}

export function parsingCounts(calls: unknown[][]) {
    const texts = calls.map((call) => String(call[0]));
    return {
        corpus: texts.filter((text) => text.includes('"corpusSequence":'))
            .length,
        unrelated: texts.filter((text) => text.includes("unrelated-view-body"))
            .length,
        selected: texts.filter(
            (text) =>
                text.startsWith("[") && text.includes('"viewId":"target"'),
        ).length,
    };
}

export async function checkHistoryRecords(
    root: string,
    count: number,
): Promise<void> {
    const indexed = new ViewHistory<State>(
        path.join(root, "corpus", "views"),
        initialState,
        undefined,
        (state) => state.views,
    );
    const state = initialState();
    let head: string | null = null;
    const started = performance.now();
    for (let index = 0; index < count; index++) {
        state.corpusSequence = index;
        state.views.unrelated[0].content.title = `Unrelated mutation ${index}`;
        if (index === Math.floor(count / 3))
            state.views.target.push(version("target", 2));
        if (index === Math.floor(count / 2))
            state.views.target[0].actor = "later-metadata-mutation";
        if (index === Math.floor((2 * count) / 3))
            state.views.target.push(version("target", 3));
        if (index === count - 1) delete state.views.target;
        head = await indexed.commit(head, state, {}, "test", `Commit ${index}`);
    }
    const writeMs = performance.now() - started;
    const parse = import.meta.jest.spyOn(JSON, "parse");
    const baselineStart = performance.now();
    const expected = legacyEntries(await indexed.history());
    const baselineMs = performance.now() - baselineStart;
    const baselineCounts = parsingCounts(parse.mock.calls);
    expect(baselineCounts.corpus).toBe(count + 1);
    parse.mockClear();

    const store = new TypedViewStore(root);
    const queryStart = performance.now();
    const actual = await store.getViewHistory({
        corpusId: "corpus",
        viewId: "target",
    });
    const queryMs = performance.now() - queryStart;
    expect(actual).toEqual(expected);
    const counts = parsingCounts(parse.mock.calls);
    expect(counts).toEqual({ corpus: 0, unrelated: 0, selected: 4 });
    expect(expected.map((entry) => entry.version.version)).toEqual([3, 2, 1]);
    expect(expected.at(-1)?.version.actor).toBe("human-owner");
    parse.mockClear();
    expect(
        await new TypedViewStore(root).getViewHistory({
            corpusId: "corpus",
            viewId: "target",
            revisionId: "target-2",
        }),
    ).toEqual(
        expected.filter((entry) => entry.version.revisionId === "target-2"),
    );
    expect(parsingCounts(parse.mock.calls).corpus).toBe(0);
    parse.mockClear();
    expect(
        await store.getViewHistory({
            corpusId: "corpus",
            viewId: "missing",
        }),
    ).toEqual([]);
    expect(parsingCounts(parse.mock.calls)).toEqual({
        corpus: 0,
        unrelated: 0,
        selected: 0,
    });
    process.stdout.write(
        JSON.stringify({
            commits: count,
            writeMs,
            baselineMs,
            queryMs,
            baselineCorpusParses: baselineCounts.corpus,
            baselineUnrelatedParses: baselineCounts.unrelated,
            baselineSelectedRecordParses: baselineCounts.selected,
            ...counts,
        }) + "\n",
    );
}
