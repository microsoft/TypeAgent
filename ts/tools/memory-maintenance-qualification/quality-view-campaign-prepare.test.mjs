// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { identity, sha256 } from "./quality-contract.mjs";
import { prepareReviewPackage } from "./quality-view-campaign-prepare.mjs";
import {
    captureCitationResolutions,
    validateCitationCapture,
} from "./quality-view-campaign-capture.mjs";

async function fixture(t) {
    const root = path.resolve(`.quality-review-test-${randomUUID()}`);
    const inputRoot = path.join(root, "input");
    const outputRoot = path.join(root, "output");
    await mkdir(inputRoot, { recursive: true });
    t.after(() => rm(root, { recursive: true, force: true }));
    const put = async (name, value) => {
        const destination = path.join(inputRoot, name);
        await mkdir(path.dirname(destination), { recursive: true });
        const raw =
            typeof value === "string"
                ? value
                : JSON.stringify(value, null, 2) + "\n";
        await writeFile(destination, raw);
        return raw;
    };
    await put(".wiki-views-owned.json", {
        schemaVersion: 1,
        owner: "wiki-views",
    });
    const frozen = await put("frozen-cases.json", {
        schemaVersion: 1,
        scenarios: [
            {
                id: "alpha",
                query: "Alpha project",
                sources: ["Owner unknown.", "Mira is owner."],
                expectations: [
                    ["Do not invent an owner"],
                    ["Preserve assigned owner"],
                ],
            },
        ],
        schedule: [
            {
                id: "alpha-wiki",
                scenario: "alpha",
                kind: "wiki",
                checkpoints: 2,
            },
        ],
    });
    await put("identity.json", {
        live: true,
        confirmation: false,
        frozenCasesHash: sha256(frozen),
    });
    await put("results.json", [
        {
            caseId: "alpha-wiki",
            checkpoints: [{ checkpoint: 0, status: "saved" }],
        },
    ]);
    const saved = await put(
        path.join("alpha-wiki", "checkpoint-0-saved.json"),
        {
            corpusId: "corpus",
            content: {
                title: "Alpha",
                summary: "Owner unknown.",
                sections: [],
            },
            provenance: { model: "must-not-be-in-blinded-output" },
        },
    );
    await put(
        path.join("alpha-wiki", "checkpoint-0-rendered.txt"),
        "Owner unknown.\n",
    );
    await put(path.join("alpha-wiki", "checkpoint-0-ingestion.json"), {
        sourceId: "alpha-0",
        corpusId: "corpus",
    });
    await put(path.join("alpha-wiki", "checkpoint-0-source-mapping.json"), [
        { sourceId: "alpha-0", revisionId: "revision-0" },
    ]);
    await put(path.join("alpha-wiki", "provider-events.json"), [
        { ordinal: 1, status: "failed", startedAt: "2026-01-01T10:00:00Z" },
    ]);
    return { inputRoot, outputRoot, seed: "test-custodian-seed", saved, put };
}

test("preparation preserves exact originals, drafts unknown labels and keeps all scheduled attempts", async (t) => {
    const f = await fixture(t);
    const report = await prepareReviewPackage(f);
    assert.equal(report.scheduledAttempts, 2);
    assert.equal(report.independentScenarioClusters, 1);
    assert.equal(report.qualityMatrixEligible, false);
    const read = async (name) =>
        JSON.parse(
            await readFile(
                path.join(f.outputRoot, ...name.split("\\")),
                "utf8",
            ),
        );
    const gold = await read("custodian\\gold-draft.json");
    assert.equal(gold.cases[0].expectations[0].accessible, null);
    assert.equal(gold.cases[0].expectations[0].witnesses.length, 0);
    assert.equal(
        gold.cases[0].expectations[0].candidateWitnesses[0].revisionId,
        "revision-0",
    );
    assert.equal(gold.cases[1].tasks[0].previousSavedHash, undefined);
    assert.equal(gold.cases[1].tasks[0].applicability, null);
    const attempts = await read("custodian\\attempts.json");
    assert.deepEqual(
        attempts.map((row) => row.status),
        ["saved", "missing"],
    );
    assert.equal(attempts[0].hashes.savedHash, identity(f.saved));
    assert.equal(
        attempts[1].taskBindings[0].previousSavedHash,
        identity(f.saved),
    );
    const original = await readFile(
        path.join(
            f.outputRoot,
            "custodian",
            "originals",
            "alpha-wiki",
            "checkpoint-0-saved.json",
        ),
        "utf8",
    );
    assert.equal(original, f.saved);
    const blinded = await read("reviewer\\annotations-draft.json");
    assert.equal(blinded.records.length, 2);
    assert.ok(
        !JSON.stringify(blinded).includes("must-not-be-in-blinded-output"),
    );
    assert.equal(blinded.records[0].allVerifiableClaimsReviewed, null);
    await assert.rejects(prepareReviewPackage(f), /already exists/);
});

test("the bounded runner's scenarios/schedule identity is explicit and original byte hashes remain retained", async (t) => {
    const f = await fixture(t);
    const frozen = JSON.parse(
        await readFile(path.join(f.inputRoot, "frozen-cases.json"), "utf8"),
    );
    await f.put("identity.json", {
        live: true,
        confirmation: false,
        frozenCasesHash: identity({
            scenarios: frozen.scenarios,
            schedule: frozen.schedule,
        }),
    });
    const report = await prepareReviewPackage(f);
    assert.equal(report.frozenHashEncoding, "identity-scenarios-and-schedule");
    const ledger = JSON.parse(
        await readFile(
            path.join(f.outputRoot, "custodian", "artifact-ledger.json"),
            "utf8",
        ),
    );
    const original = await readFile(
        path.join(f.inputRoot, "frozen-cases.json"),
        "utf8",
    );
    assert.equal(ledger["frozen-cases.json"].sha256, sha256(original));
});

test("offline captures and changed frozen bytes cannot become review evidence", async (t) => {
    const f = await fixture(t);
    await f.put("identity.json", {
        live: false,
        confirmation: false,
        frozenCasesHash: "0".repeat(64),
    });
    await assert.rejects(prepareReviewPackage(f), /Only retained live/);
    await f.put("identity.json", {
        live: true,
        confirmation: false,
        frozenCasesHash: "0".repeat(64),
    });
    await assert.rejects(prepareReviewPackage(f), /byte identity mismatch/);
});

test("path traversal in scheduled case identities is refused before output creation", async (t) => {
    const f = await fixture(t);
    const frozen = await f.put("frozen-cases.json", {
        scenarios: [{ id: "alpha", sources: ["safe"] }],
        schedule: [
            { id: "..", scenario: "alpha", kind: "wiki", checkpoints: 1 },
        ],
    });

    function citationFixture() {
        const text = "Owner unknown.";
        const citation = {
            sourceId: "source",
            revisionId: "revision",
            locator: `indexed:0:${sha256(text)}:0-${text.length}`,
            excerpt: text,
        };
        const view = {
            corpusId: "corpus",
            viewId: "view",
            revisionId: "accepted",
            content: { citations: [citation] },
            generation: {
                input: { inputs: [{ passages: [citation, citation] }] },
            },
        };
        const requests = [];
        const service = {
            async getSourceContent(request) {
                requests.push(request);
                return {
                    corpusId: request.corpusId,
                    sourceId: request.sourceId,
                    revisionId: request.revisionId,
                    truncated: false,
                    content: text,
                };
            },
        };
        return { saved: JSON.stringify(view), service, requests, view };
    }

    test("citation capture resolves unique accepted selections and binds exact saved bytes", async () => {
        const f = citationFixture();
        const capture = await captureCitationResolutions(f.service, f.saved);
        assert.equal(f.requests.length, 2);
        assert.equal(capture.citationResolutions.length, 1);
        validateCitationCapture(capture, f.saved);
        assert.throws(
            () =>
                validateCitationCapture(
                    {
                        ...capture,
                        revisionId: "another-accepted-revision",
                    },
                    f.saved,
                ),
            /Unbound/,
        );
        assert.throws(
            () => validateCitationCapture(capture, f.saved + "\n"),
            /Unbound/,
        );
        for (const alter of [
            (row) => {
                row.response.revisionId = "stale";
            },
            (row) => {
                row.response.truncated = true;
            },
            (row) => {
                row.response.content = "Invented";
            },
            (row) => {
                row.request.indexedLocator = "wrong";
            },
            (row) => {
                row.blockText = "Other";
            },
            (row) => {
                row.sourceRead.response.content = "Other";
            },
        ]) {
            const changed = structuredClone(capture);
            alter(changed.citationResolutions[0]);
            assert.throws(() => validateCitationCapture(changed, f.saved));
        }
        const missing = structuredClone(capture);
        missing.citationResolutions = [];
        assert.throws(
            () => validateCitationCapture(missing, f.saved),
            /Incomplete/,
        );
    });

    test("unselected citations and stale service resolutions cannot become captured evidence", async () => {
        const f = citationFixture();
        f.view.content.citations.push({
            ...f.view.content.citations[0],
            sourceId: "unselected",
        });
        await assert.rejects(
            captureCitationResolutions(f.service, JSON.stringify(f.view)),
            /absent from original selection/,
        );
        await assert.rejects(
            captureCitationResolutions(
                {
                    async getSourceContent() {
                        throw new Error("Source revision stale");
                    },
                },
                f.saved,
            ),
            /Source revision stale/,
        );
    });

    test("preparation retains bound citation and operation receipts without approving their judgments", async (t) => {
        const f = await fixture(t);
        const citation = citationFixture();
        const saved = await f.put(
            path.join("alpha-wiki", "checkpoint-0-saved.json"),
            {
                ...citation.view,
                content: {
                    ...JSON.parse(f.saved).content,
                    citations: citation.view.content.citations,
                },
            },
        );
        await f.put(
            path.join("alpha-wiki", "checkpoint-0-evidence.json"),
            await captureCitationResolutions(citation.service, saved),
        );
        await f.put(path.join("alpha-wiki", "checkpoint-0-operations.json"), [
            {
                kind: "source-removal",
                state: "complete",
                checks: {
                    sourceRemoved: true,
                    currentViewPurged: true,
                    sourceIndexEmpty: true,
                },
            },
            {
                kind: "human-edit",
                state: "complete",
                checks: { protectedTextSaved: true },
            },
        ]);
        const report = await prepareReviewPackage(f);
        assert.ok(!report.missingExperiments.includes("source-removal"));
        assert.ok(report.missingExperiments.includes("protected-human-edits"));
        assert.equal(report.semanticQualityEvaluated, false);
        const attempts = JSON.parse(
            await readFile(
                path.join(f.outputRoot, "custodian", "attempts.json"),
                "utf8",
            ),
        );
        assert.ok(
            !attempts[0].blockers.includes(
                "citation-resolution-receipts-not-retained",
            ),
        );
        assert.equal(attempts[0].evidenceCapture.savedHash, identity(saved));
    });
    await f.put("identity.json", {
        live: true,
        confirmation: false,
        frozenCasesHash: sha256(frozen),
    });
    await f.put("results.json", []);
    await assert.rejects(prepareReviewPackage(f), /Unsafe case/);
});
