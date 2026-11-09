// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { MemoryQuestion } from "@typeagent/memory-service";

export function question(id = "slot", viewId = "view"): MemoryQuestion {
    return {
        corpusId: "corpus",
        viewId,
        viewTitle: viewId,
        viewVersion: 2,
        viewRevisionId: "revision",
        definitionRevision: "question-contract-revision",
        attentionScore: 10,
        fingerprint: `${id}:1`,
        slot: {
            id,
            question: "What is the name?",
            cardinality: "singleton",
            schema: { type: "string" },
            approval: "approved",
            discoveryCitations: [],
            rubric: {
                version: 1,
                selection: "manual",
                requireConfirmation: true,
                authoritySourceIds: [],
            },
        },
        details: {
            kind: "question",
            slotId: id,
            candidates: [],
            selectedCandidateIds: [],
            answerState: "pending",
            reviewState: "unreviewed",
            freshness: "current",
            coverage: "unknown",
            evaluatedSources: [],
            scopeFingerprint: "scope",
        },
    };
}
