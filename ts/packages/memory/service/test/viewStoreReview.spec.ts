// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mergeView, recordViewEdits } from "../src/viewMerge.js";
import type {
    ProjectBriefContent,
    ViewSynthesisOutput,
    ViewVersion,
} from "../src/viewTypes.js";

describe("project brief item deletion merge regressions", () => {
    function fixture() {
        const content: ProjectBriefContent = {
            kind: "projectBrief",
            title: "Project risks",
            citations: [],
            sections: [
                {
                    id: "risks",
                    role: "risks",
                    heading: "Risks",
                    body: "Risk inventory",
                    details: {
                        kind: "risks",
                        items: [
                            { inventoryId: "retained", status: "open" },
                            { inventoryId: "removed", status: "open" },
                        ],
                    },
                },
            ],
        };
        const current: ViewVersion = {
            corpusId: "merge-corpus",
            viewId: "brief",
            revisionId: "human-revision",
            version: 2,
            state: "draft",
            createdAt: "2026-10-09T00:00:00.000Z",
            actor: "human",
            provenance: "human",
            definition: {
                viewId: "brief",
                revisionId: "definition",
                kind: "projectBrief",
                selector: { kind: "sources", sources: [] },
            },
            content: structuredClone(content),
            relationships: [],
            generation: {
                candidateId: "generated-base",
                fingerprint: "base-fingerprint",
                content,
                relationships: [],
            },
        };
        const human = structuredClone(content);
        const candidate: ViewSynthesisOutput = {
            content: structuredClone(content),
            relationships: [],
            outcome: "diagnosticOnly",
            missingEvidence: [],
        };
        return { current, human, candidate };
    }

    test.each(["generated", "human"])(
        "%s deletion of an unchanged item merges with another item's edit",
        (deletingSide) => {
            const { current, human, candidate } = fixture();
            const generated = candidate.content as ProjectBriefContent;
            const deleted = deletingSide === "generated" ? generated : human;
            const edited = deletingSide === "generated" ? human : generated;
            deleted.sections[0].details = {
                kind: "risks",
                items: [{ inventoryId: "retained", status: "open" }],
            };
            edited.sections[0].details = {
                kind: "risks",
                items: [
                    { inventoryId: "retained", status: "blocked" },
                    { inventoryId: "removed", status: "open" },
                ],
            };
            current.edits = recordViewEdits(current, human, [], "human");
            current.content = human;
            const merged = mergeView(current, candidate);
            expect(merged.conflicts).toEqual([]);
            expect(merged.output.content.sections[0].details).toEqual({
                kind: "risks",
                items: [{ inventoryId: "retained", status: "blocked" }],
            });
        },
    );

    test.each(["generated", "human"])(
        "%s deletion conflicts with an edit to that same item",
        (deletingSide) => {
            const { current, human, candidate } = fixture();
            const generated = candidate.content as ProjectBriefContent;
            const deleted = deletingSide === "generated" ? generated : human;
            const edited = deletingSide === "generated" ? human : generated;
            deleted.sections[0].details = {
                kind: "risks",
                items: [{ inventoryId: "retained", status: "open" }],
            };
            edited.sections[0].details = {
                kind: "risks",
                items: [
                    { inventoryId: "retained", status: "open" },
                    { inventoryId: "removed", status: "blocked" },
                ],
            };
            current.edits = recordViewEdits(current, human, [], "human");
            current.content = human;
            expect(mergeView(current, candidate).conflicts).toEqual([
                "section:risks",
            ]);
        },
    );
});
