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
            construction: "informational-project-summary-v1",
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
                            { id: "retained", status: "open" },
                            { id: "removed", status: "open" },
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
                projectSummary: {
                    construction: "informational-project-summary-v1",
                    query: "Project risks",
                    aliases: [],
                    excludedSourceIds: [],
                },
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
            outcome: "projectSummary",
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
                items: [{ id: "retained", status: "open" }],
            };
            edited.sections[0].details = {
                kind: "risks",
                items: [
                    { id: "retained", status: "blocked" },
                    { id: "removed", status: "open" },
                ],
            };
            current.edits = recordViewEdits(current, human, [], "human");
            current.content = human;
            const merged = mergeView(current, candidate);
            expect(merged.conflicts).toEqual([]);
            expect(merged.output.content.sections[0].details).toEqual({
                kind: "risks",
                items: [{ id: "retained", status: "blocked" }],
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
                items: [{ id: "retained", status: "open" }],
            };
            edited.sections[0].details = {
                kind: "risks",
                items: [
                    { id: "retained", status: "open" },
                    { id: "removed", status: "blocked" },
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
