// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { digest, sessionSource, importHistory } from "./longmemeval-runner.mjs";
import { writeJson } from "./harness.mjs";

export const wikiAdmissionCases = Object.freeze([
    { id: "d24813b1", sessions: 44 },
    { id: "4f54b7c9", sessions: 45 },
    { id: "c8090214", sessions: 47 },
    { id: "cc5ded98", sessions: 53 },
    { id: "eeda8a6d_abs", sessions: 49 },
]);

export async function hashStore(directory) {
    const result = {};
    async function visit(relative) {
        const entries = await readdir(path.join(directory, relative), {
            withFileTypes: true,
        });
        for (const entry of entries.sort((a, b) =>
            a.name.localeCompare(b.name),
        )) {
            const next = path.join(relative, entry.name);
            assert.ok(
                !entry.isSymbolicLink(),
                "Seed stores cannot contain links",
            );
            if (entry.isDirectory()) await visit(next);
            else {
                assert.ok(entry.isFile(), "Unsupported seed store entry");
                result[next] = digest(
                    await readFile(path.join(directory, next)),
                );
            }
        }
    }
    assert.ok(!(await lstat(directory)).isSymbolicLink(), "Linked seed root");
    await visit("");
    return result;
}

export async function sourceInventory(service, corpusId) {
    const sources = await service.listSources(corpusId);
    return sources
        .map((source) => ({
            sourceId: source.sourceId,
            activeRevisionId: source.activeRevisionId,
            canonicalUri: source.canonicalUri,
            revisions: source.revisions.map((revision) => ({
                revisionId: revision.revisionId,
                contentHash: revision.contentHash,
                state: revision.state,
            })),
        }))
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

export async function sourceProbe(service, corpusId, query, retained) {
    const matches = retained
        ? retained.map((key) => {
              const [sourceId, revisionId, locator] = JSON.parse(key);
              return { sourceId, revisionId, locator };
          })
        : (
              await service.search({
                  corpusId,
                  query,
                  limit: 10,
                  indexedFragments: true,
                  retrievalPolicy: "sourcesOnly",
              })
          ).matches;
    const keys = [];
    for (const match of matches) {
        assert.ok(
            typeof match.locator === "string" &&
                match.locator.startsWith("indexed:"),
            "Source-only seed probe needs indexed-text anchors",
        );
        const expanded = await service.getSourceContent({
            corpusId,
            sourceId: match.sourceId,
            revisionId: match.revisionId,
            indexedLocator: match.locator,
        });
        assert.equal(expanded.truncated, false);
        assert.ok(expanded.content.length, "Empty indexed-text probe");
        keys.push(
            JSON.stringify([
                match.sourceId,
                match.revisionId,
                match.locator,
                digest(expanded.content),
            ]),
        );
    }
    keys.sort();
    assert.ok(keys.length, "Source-only seed probe returned no evidence");
    return keys;
}

export function selectedWikiConstruction(prepared, selection, caseIds) {
    const ids = wikiAdmissionCases.map(({ id }) => id);
    assert.ok(Array.isArray(selection.questionIds));
    assert.deepEqual(
        [...selection.questionIds].sort(),
        [...ids].sort(),
        "Historical selection differs",
    );
    const construction = wikiAdmissionCases.map(({ id, sessions }) => {
        const construction = prepared.construction.find(
            (entry) => entry.id === id,
        );
        assert.ok(construction, `Missing full supplied history ${id}`);
        assert.equal(
            construction.sessions.length,
            sessions,
            `Incomplete history ${id}`,
        );
        return construction;
    });
    if (caseIds === undefined) return construction;
    assert.ok(
        Array.isArray(caseIds) &&
            caseIds.length &&
            caseIds.every((id) => ids.includes(id)) &&
            new Set(caseIds).size === caseIds.length,
        "Preparation cases must be a nonempty distinct subset of the pinned selection",
    );
    return construction.filter((history) => caseIds.includes(history.id));
}

export async function freezeWikiSeeds(
    directory,
    prepared,
    selection,
    runtime,
    signal,
    recovery,
    caseIds,
) {
    const construction = selectedWikiConstruction(prepared, selection, caseIds);
    if (recovery) {
        assert.deepEqual(
            recovery.manifest.configuration,
            runtime.configuration,
            "Recovered source-only preparation configuration changed",
        );
        const productCheckpoint = (checkpoint) =>
            Object.fromEntries(
                Object.entries(checkpoint).filter(([file]) =>
                    file.endsWith(".js"),
                ),
            );
        assert.deepEqual(
            productCheckpoint(recovery.manifest.checkpoint),
            productCheckpoint(runtime.checkpoint),
            "Recovered production implementation changed",
        );
    }
    await mkdir(path.join(directory, "cases"));
    const manifest = {
        schemaVersion: 1,
        pagePolicy: "full-page-content-v1",
        sourceSynopsisPolicy:
            "held-during-preparation; production-default-during-build",
        questionIds: construction.map(({ id }) => id),
        validatedSelectionQuestionIds: wikiAdmissionCases.map(({ id }) => id),
        provenance: prepared.manifest,
        configuration: runtime.configuration,
        checkpoint: runtime.checkpoint,
        constructionHash: digest(JSON.stringify(construction)),
        status: "preparing",
        cases: [],
        ...(recovery
            ? {
                  recoveredPreparation: {
                      directory: recovery.directory,
                      manifestHash: digest(JSON.stringify(recovery.manifest)),
                      policy: "verified-source-only-byte-copy; new-harness-and-probe-validation",
                  },
              }
            : {}),
    };
    const manifestFile = path.join(directory, "seeds.json");
    await writeJson(manifestFile, manifest);
    for (const history of construction) {
        signal.throwIfAborted();
        const caseDirectory = path.join(directory, "cases", history.id);
        await mkdir(caseDirectory);
        const store = path.join(caseDirectory, "store");
        const recovered = recovery?.manifest.cases.find(
            (entry) => entry.id === history.id,
        );
        if (recovered) {
            assert.deepEqual(
                recovered.construction,
                history,
                "Recovered history changed",
            );
            await copySeedStore(recovery.directory, recovered, store);
        }
        const service = runtime.open(store, { maintenanceMode: "manual" });
        const started = performance.now();
        const record = recovered
            ? structuredClone(recovered.record)
            : { operations: [], mappings: {}, status: "ingesting" };
        try {
            await service.initialize();
            if (!recovered)
                record.corpusId = (
                    await service.createCorpus(`wiki-seed-${history.id}`)
                ).corpusId;
            const persist = () =>
                writeJson(path.join(caseDirectory, "ingestion.json"), record);
            await importHistory(
                service,
                history,
                history.sessions.map((session) =>
                    sessionSource(history.id, session),
                ),
                record,
                { signal, persist, role: runtime.role },
            );
            const inventory = await sourceInventory(service, record.corpusId);
            assert.equal(inventory.length, history.sessions.length);
            assert.ok(
                inventory.every((source) =>
                    source.revisions.some(
                        (r) =>
                            r.revisionId === source.activeRevisionId &&
                            r.state === "ready",
                    ),
                ),
                "Original sources are not ready",
            );
            assert.equal(
                (await service.listViews(record.corpusId)).views.length,
                0,
                "A source-only seed cannot contain maintained views",
            );
            assert.equal(
                (await service.listViewBuilds(record.corpusId)).length,
                0,
                "A source-only seed cannot contain assessment receipts",
            );
            assert.equal(service.getMaintenanceStatus().running.length, 0);
            const probeQuery = history.sessions[0].turns[0].content.slice(
                0,
                200,
            );
            const probe = await sourceProbe(
                service,
                record.corpusId,
                probeQuery,
            );
            manifest.cases.push({
                id: history.id,
                record,
                inventory,
                probeQuery,
                probe,
                preparationMs: performance.now() - started,
                ...(recovered
                    ? { recoveredPreparationMs: recovered.preparationMs }
                    : {}),
                construction: history,
            });
        } finally {
            await service.close();
        }
        const entry = manifest.cases.at(-1);
        entry.files = await hashStore(store);
        entry.storeHash = digest(JSON.stringify(entry.files));
        await writeJson(manifestFile, manifest);
        const reopened = await cloneWikiSeed(
            directory,
            entry,
            path.join(caseDirectory, "reopen-check"),
            runtime,
        );
        await reopened.service.close();
        assert.deepEqual(
            await hashStore(store),
            entry.files,
            "Seed changed during reopen",
        );
    }
    manifest.status = "frozen";
    await writeJson(manifestFile, manifest);
    return manifest;
}

export async function cloneWikiSeed(
    seedDirectory,
    seed,
    destination,
    runtime,
    options = {},
) {
    await copySeedStore(seedDirectory, seed, destination);
    const service = runtime.open(destination, options);
    const release = service.deferMaintenance();
    try {
        await service.initialize();
        assert.deepEqual(
            await sourceInventory(service, seed.record.corpusId),
            seed.inventory,
        );
        assert.deepEqual(
            await sourceProbe(
                service,
                seed.record.corpusId,
                seed.probeQuery,
                seed.probe,
            ),
            seed.probe,
            "Cold-reopen indexed source content changed",
        );
        assert.equal(
            (await service.listViews(seed.record.corpusId)).views.length,
            0,
        );
        return { service, release };
    } catch (error) {
        await service.close();
        throw error;
    }
}

async function copySeedStore(seedDirectory, seed, destination) {
    const store = path.join(seedDirectory, "cases", seed.id, "store");
    assert.deepEqual(
        await hashStore(store),
        seed.files,
        "Frozen seed store changed",
    );
    const existing = await lstat(destination).catch((error) => {
        if (error.code !== "ENOENT") throw error;
        return undefined;
    });
    assert.equal(existing, undefined, "Seed clone destination already exists");
    await cp(store, destination, {
        recursive: true,
        force: false,
        errorOnExist: true,
        filter: async (source) => {
            assert.ok(
                !(await lstat(source)).isSymbolicLink(),
                "Linked store entry",
            );
            return true;
        },
    });
    assert.deepEqual(
        await hashStore(destination),
        seed.files,
        "Clone bytes differ",
    );
}
