// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
    validateApprovedCatalogConfig,
    verifyApprovedCatalogSource,
    ownApprovedCatalogPhase,
    verifyApprovedVersionUnchanged,
} from "../macro-eval-native-approved.mjs";
import { approvedSourceFixture } from "./approved-source-fixture.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const corpus = {
    documents: [{ key: "unit", content: "synthetic unit fixture" }],
};

function fixture(t) {
    const root = fs.mkdtempSync(path.join(directory, ".approved-unit-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const recorded = approvedSourceFixture(root, corpus, {
        steps: [{ id: "lookup" }, { id: "fetch" }],
    });
    const source = verifyApprovedCatalogSource(
        recorded.config,
        corpus,
        directory,
    );
    return { root, recorded, source };
}

test("approved source requires exact owner, complete pinned provenance and known current corpus", (t) => {
    const { recorded } = fixture(t);
    for (const update of [
        { owner: "-".repeat(36) },
        { version: 1 },
        {
            sourceHashes: {
                ...recorded.config.sourceHashes,
                extra: "a".repeat(64),
            },
        },
        { extra: true },
    ])
        assert.throws(
            () =>
                validateApprovedCatalogConfig({
                    ...recorded.config,
                    ...update,
                }),
            /Approved reuse blocked/u,
        );
    assert.throws(
        () =>
            verifyApprovedCatalogSource(
                recorded.config,
                { documents: [] },
                directory,
            ),
        /corpus differs/u,
    );
    assert.throws(
        () =>
            verifyApprovedCatalogSource(
                {
                    ...recorded.config,
                    owner: "00000000-0000-0000-0000-000000000000",
                },
                corpus,
                directory,
            ),
        /owner changed/u,
    );
    fs.appendFileSync(recorded.files.originals.file, "changed");
    assert.throws(
        () => verifyApprovedCatalogSource(recorded.config, corpus, directory),
        /historical source changed/u,
    );
});

test("same owned store is exclusive and restored without copying or changing its catalog", (t) => {
    const { source } = fixture(t);
    const plugin = path.join(source.root, "plugin");
    fs.mkdirSync(plugin);
    fs.writeFileSync(path.join(plugin, "original"), "historical runtime");
    const phase = ownApprovedCatalogPhase(
        path.join(source.root, "phase"),
        source,
    );
    assert.throws(
        () => ownApprovedCatalogPhase(path.join(source.root, "phase2"), source),
        /EEXIST/u,
    );
    phase.begin();
    fs.mkdirSync(plugin);
    fs.writeFileSync(path.join(plugin, "new"), "current runtime");
    const state = JSON.parse(fs.readFileSync(source.learningFile, "utf8"));
    state.preferences[0].mode = "off";
    state.preferences[0].revision = 2;
    fs.writeFileSync(source.learningFile, JSON.stringify(state));
    phase.restore();
    assert.equal(
        fs.readFileSync(path.join(plugin, "original"), "utf8"),
        "historical runtime",
    );
    assert.equal(fs.existsSync(path.join(plugin, "new")), false);
    assert.equal(
        JSON.parse(fs.readFileSync(source.learningFile, "utf8")).preferences[0]
            .mode,
        "prepare",
    );
    assert.equal(
        fs.existsSync(path.join(source.root, ".approved-reuse.lock")),
        false,
    );
    verifyApprovedVersionUnchanged(source);
});

test("partial begin restores already moved scopes and releases only its own lock", (t) => {
    const { source } = fixture(t);
    fs.mkdirSync(path.join(source.root, "plugin"));
    fs.mkdirSync(path.join(source.root, "plugin-data"));
    const phase = ownApprovedCatalogPhase(
        path.join(source.root, "phase"),
        source,
    );
    fs.mkdirSync(path.join(phase.artifacts, "retained-history"));
    assert.throws(() => phase.begin(), /EEXIST/u);
    phase.restore();
    assert.equal(fs.existsSync(path.join(source.root, "plugin")), true);
    assert.equal(
        fs.existsSync(path.join(source.root, ".approved-reuse.lock")),
        false,
    );
});

test("invalid immutable source cannot prevent scoped restoration and ownership release", (t) => {
    const { source } = fixture(t);
    const phase = ownApprovedCatalogPhase(
        path.join(source.root, "phase"),
        source,
    );
    phase.begin();
    fs.appendFileSync(source.versionFile, "tampered");
    assert.throws(
        () => verifyApprovedVersionUnchanged(source),
        /version changed/u,
    );
    assert.throws(
        () => phase.restore(),
        /historical immutable source changed/u,
    );
    assert.equal(
        fs.existsSync(path.join(source.root, ".approved-reuse.lock")),
        false,
    );
    assert.equal(
        fs.existsSync(path.join(source.root, "workspace", ".mcp.json")),
        true,
    );
});

test("new jobs must never be erased by preference restoration", (t) => {
    const { source } = fixture(t);
    const phase = ownApprovedCatalogPhase(
        path.join(source.root, "phase"),
        source,
    );
    phase.begin();
    const state = JSON.parse(fs.readFileSync(source.learningFile, "utf8"));
    state.jobs.push({ id: "unexpected-job" });
    fs.writeFileSync(source.learningFile, JSON.stringify(state));
    assert.throws(() => phase.restore(), /altered learning jobs/u);
    assert.equal(
        JSON.parse(fs.readFileSync(source.learningFile, "utf8")).jobs.length,
        2,
    );
    assert.equal(
        fs.existsSync(path.join(source.root, ".approved-reuse.lock")),
        false,
    );
});

test("output cannot overwrite history, escape root, or release a foreign phase", (t) => {
    const { root, source } = fixture(t);
    assert.throws(
        () => ownApprovedCatalogPhase(path.join(root, "outside"), source),
        /direct child/u,
    );
    assert.throws(
        () => ownApprovedCatalogPhase(source.root, source),
        /direct child/u,
    );
    const phase = ownApprovedCatalogPhase(
        path.join(source.root, "phase"),
        source,
    );
    fs.writeFileSync(path.join(source.root, ".approved-reuse.lock"), "foreign");
    assert.throws(() => phase.begin(), /ownership lock changed/u);
    assert.throws(() => phase.restore(), /ownership lock changed/u);
    assert.equal(
        fs.readFileSync(path.join(source.root, ".approved-reuse.lock"), "utf8"),
        "foreign",
    );
});
