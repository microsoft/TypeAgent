// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    buildCorpus,
    buildTrialSchedule,
    corpusVersion,
    protocolVersion,
} from "./ghcp-eval-corpus.mjs";
import {
    buildListCorpus,
    listCandidates,
    listCorpusVersion,
    listPreparation,
} from "./ghcp-eval-lists.mjs";

export function evaluationCategory(name = "common-files") {
    if (!["common-files", "lists"].includes(name))
        throw new Error("Unknown evaluation category");
    return {
        name,
        corpusVersion: name === "lists" ? listCorpusVersion : corpusVersion,
        candidates: name === "lists" ? listCandidates : [1, 2, 3, 4, 5, 6, 7],
        preparation:
            name === "lists"
                ? listPreparation
                : "Discover available contracts for file inventory, reading, writing/appending and copying files, GitHub pull-request files/checks and issue details, and read-only IP configuration. Do not execute actions, inspect contents, establish preferred targets, or guess future requests.",
    };
}

export function categoryCorpus(category, files, repo, prA, prB, issue) {
    return category.name === "lists"
        ? buildListCorpus(files, repo, issue)
        : buildCorpus(files, repo, prA, prB, issue);
}

export function categorySchedule(category, cases, candidates, repetitions) {
    if (
        !candidates.length ||
        new Set(candidates).size !== candidates.length ||
        candidates.some((id) => !category.candidates.includes(id)) ||
        new Set(cases.map(({ id }) => id)).size !== cases.length ||
        cases.some(
            ({ id }) =>
                !(
                    category.name === "lists"
                        ? /^list-[SMRA][1-5]$/
                        : /^[SMRA][1-5]$/
                ).test(id),
        )
    )
        throw new Error(
            "Candidate or case belongs to another evaluation category",
        );
    const schedule = buildTrialSchedule(cases, candidates, repetitions);
    return {
        ...schedule,
        order: schedule.order.map((entry) => ({
            ...entry,
            category: category.name,
        })),
    };
}

export function assertCategoryReadiness(readiness, category) {
    if (
        readiness?.protocolVersion !== protocolVersion ||
        readiness.category !== category.name ||
        readiness.corpusVersion !== category.corpusVersion ||
        readiness.status !== "passed"
    )
        throw new Error("Fresh category-specific preflight is required");
    if (category.name === "lists" && readiness.listOperationsVerified !== true)
        throw new Error(
            "List preflight must verify live list operations and reset",
        );
}

export function assertCategoryResults(results, order, category) {
    if (
        results.some((result, i) => {
            const expected = order[i];
            return (
                !expected ||
                result.protocolVersion !== protocolVersion ||
                result.category !== category.name ||
                result.corpusVersion !== category.corpusVersion ||
                result.caseId !== expected.caseId ||
                result.candidate !== expected.candidate ||
                result.repetition !== expected.repetition
            );
        })
    )
        throw new Error(
            "Stored results differ from the category schedule; never pool or replay",
        );
}
