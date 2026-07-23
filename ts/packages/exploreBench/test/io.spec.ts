// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
    appendResult,
    readResults,
    readRunManifest,
    writeJsonAtomic,
} from "../src/io.js";
import { normalizeBenchmarkVariant, type RunResult } from "../src/types.js";

test("accepts the legacy TypeAgent spelling only as an input alias", () => {
    assert.equal(normalizeBenchmarkVariant("typeagent-mcp"), "typeagent");
    assert.equal(normalizeBenchmarkVariant("typeagent"), "typeagent");
    assert.throws(
        () => normalizeBenchmarkVariant("other"),
        /Unsupported benchmark variant/,
    );
});

test("normalizes legacy persisted variants without rewriting source files", async (t) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "explore-io-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const manifestPath = path.join(directory, "manifest.json");
    const resultsPath = path.join(directory, "results.jsonl");
    const legacyManifest = `${JSON.stringify(
        { runId: "legacy", variants: ["baseline", "typeagent-mcp"] },
        null,
        2,
    )}\n`;
    const legacyResults = `${JSON.stringify({
        runId: "legacy",
        variant: "typeagent-mcp",
    })}\n`;
    await writeFile(manifestPath, legacyManifest, "utf8");
    await writeFile(resultsPath, legacyResults, "utf8");

    const manifest = await readRunManifest(manifestPath);
    const results = await readResults(resultsPath);

    assert.deepEqual(manifest.variants, ["baseline", "typeagent"]);
    assert.equal(results[0].variant, "typeagent");
    assert.equal(await readFile(manifestPath, "utf8"), legacyManifest);
    assert.equal(await readFile(resultsPath, "utf8"), legacyResults);

    const canonicalManifestPath = path.join(
        directory,
        "canonical-manifest.json",
    );
    const canonicalResultsPath = path.join(
        directory,
        "canonical-results.jsonl",
    );
    await writeJsonAtomic(canonicalManifestPath, manifest);
    await appendResult(canonicalResultsPath, {
        runId: "new",
        variant: "typeagent",
    } as RunResult);
    const emittedManifest = JSON.parse(
        await readFile(canonicalManifestPath, "utf8"),
    ) as { variants: string[] };
    const emittedResult = JSON.parse(
        (await readFile(canonicalResultsPath, "utf8")).trim(),
    ) as { variant: string };
    assert.deepEqual(emittedManifest.variants, ["baseline", "typeagent"]);
    assert.equal(emittedResult.variant, "typeagent");
});
