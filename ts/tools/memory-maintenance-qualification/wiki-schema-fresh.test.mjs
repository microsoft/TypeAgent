// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import {
    freshEvaluation,
    freshRequests,
    sourceSnapshot,
} from "./wiki-schema-fresh.mjs";
import { families } from "./wiki-schema-contract.mjs";
import { sdkTransport } from "./wiki-schema-replay.mjs";

test("fresh cohort preserves complete original sources, freezes new bounded roles and declares variants", () => {
    const snapshots = Array.from({ length: 6 }, (_, index) =>
        sourceSnapshot(
            `subject-${index}`,
            `docs/${index}.md`,
            `Original complete source ${index}\nFinal qualification must remain.`,
            "a".repeat(40),
        ),
    );
    const outputs = snapshots.map((snapshot) => ({
        content: {
            title: snapshot.definition.wiki.query,
            summary: "Supported summary.",
            sections: [
                { id: "s0", heading: "Definition", body: "First explanation." },
                {
                    id: "s1",
                    heading: "Qualification",
                    body: "Final qualification must remain.",
                },
            ],
            citations: [],
        },
    }));
    const before = JSON.stringify({ snapshots, outputs });
    const packets = freshRequests(snapshots, outputs, {
        purpose: "Purpose rules",
        editorial: "Editorial rules",
        consolidation: "Consolidation rules",
    });
    assert.equal(packets.length, 36);
    for (const family of families)
        assert.equal(packets.filter((p) => p.family === family).length, 6);
    assert.equal(JSON.stringify({ snapshots, outputs }), before);
    for (const packet of packets) {
        const request = JSON.parse(packet.requestJson);
        assert.ok(
            request.state.fragments[0].excerpt.endsWith(
                "Final qualification must remain.",
            ),
        );
        assert.ok(
            Object.values(request.questions).every((q) => q.type === "choice"),
        );
        assert.equal(packet.cohort, "fresh-main-document-wiki-v1");
    }
    const deleted = JSON.parse(
        packets.find((p) => p.id === "editorial-2").requestJson,
    );
    assert.ok(
        deleted.state.currentArticle.content.sections.every(
            (s) => s.body === "",
        ),
    );
    assert.equal(deleted.state.priorArticle.content.sections.length, 2);
    const lastDeleted = JSON.parse(
        packets.find((p) => p.id === "editorial-3").requestJson,
    );
    assert.equal(lastDeleted.state.currentArticle.content.sections.length, 1);
    assert.equal(lastDeleted.state.priorArticle.content.sections.length, 2);
    assert.equal(
        packets.find((p) => p.id === "admission-0").sourceGroups.length,
        6,
    );
});

test("fresh inference requires approval and a bounded absolute deadline before creating files", async () => {
    await assert.rejects(freshEvaluation({ live: false }), /--live approval/);
    await assert.rejects(
        freshEvaluation({ live: true, deadline: "invalid" }),
        /deadline/,
    );
});

test("Responses API inspection verifies exact content/schema and distinguishes admission allowance from a wire cap", async () => {
    const packet = {
        requestJson: JSON.stringify({
            state: "Complete source",
            questions: {
                q: {
                    type: "choice",
                    instructions: "Judge",
                    criteria: { yes: "Supported", no: "Unsupported" },
                },
            },
        }),
        nativeAnswers: {
            q: {
                type: "choice",
                choice: "yes",
                probabilities: { yes: 1, no: 0 },
            },
        },
    };
    const client = {
        createDecisionModel: () => ({
            success: true,
            data: { provider: "azure", model: "decision-1" },
        }),
        openai: {
            GPT_6_LUNA: "gpt-6-luna",
            getChatModelSettings: () => ({ provider: "azure" }),
            createChatModel(_alias, completionSettings) {
                return {
                    completionSettings,
                    inspectRequest(prompt, schema) {
                        return {
                            serializedRequest: JSON.stringify({
                                instructions: prompt[0].content,
                                input: [
                                    {
                                        role: "user",
                                        content: [
                                            {
                                                type: "input_text",
                                                text: prompt[1].content,
                                            },
                                        ],
                                    },
                                ],
                                text: {
                                    format: { ...schema, type: "json_schema" },
                                },
                                temperature: 1,
                            }),
                            estimatedInputTokens: 100,
                            constraints: { outputTokens: 4096 },
                        };
                    },
                };
            },
        },
    };
    const transport = await sdkTransport(client);
    for (const arm of ["luna-full", "luna-choice"]) {
        const inspection = transport.inspect(packet, arm);
        assert.equal(inspection.wireApi, "responses");
        assert.equal(inspection.wireOutputLimit, null);
        assert.equal(inspection.outputLimit, 4096);
        assert.equal(
            inspection.outputLimitKind,
            "admission-allowance-not-wire-cap",
        );
        assert.equal(inspection.body.text.format.strict, true);
    }
});
