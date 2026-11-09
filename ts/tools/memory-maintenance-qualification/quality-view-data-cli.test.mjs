// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
    mkdir,
    writeFile,
    readFile,
    readdir,
    rm,
    symlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sha256, identity } from "./quality-contract.mjs";
import {
    runPreparation,
    parsePreparationArguments,
    authorizeAcquisition,
    ownershipMarker,
    runAcquisition,
    validateAcquisitionManifest,
} from "./quality-view-data-cli.mjs";

const cliPath = fileURLToPath(
    new URL("./quality-view-data-cli.mjs", import.meta.url),
);

async function workspace(t, dataset = "freshwiki") {
    const root = path.join(
        process.cwd(),
        `.quality-view-data-test-${randomUUID()}`,
    );
    await mkdir(root);
    t.after(() => rm(root, { recursive: true, force: true }));
    const input = path.join(root, "assets");
    await mkdir(input);
    await writeFile(
        path.join(input, ownershipMarker),
        JSON.stringify({ schemaVersion: 1, purpose: "pinned-local-assets" }),
    );
    const license = {
        id: "original-fixture",
        terms: "Original data only",
        reviewed: true,
    };
    let values;
    let extras;
    if (dataset === "freshwiki") {
        values = {
            "article.json": JSON.stringify({
                title: "Original fixture",
                url: "https://example.org/article",
                summary: "SECRET EVALUATOR REFERENCE",
                content: [],
            }),
        };
        extras = {};
    } else {
        values = {
            "data/Product/jsonl/train.jsonl":
                JSON.stringify({
                    meeting_transcripts: [
                        {
                            speaker: "A",
                            content: "Original meeting 😀\r\ntext.",
                        },
                    ],
                    general_query_list: [
                        {
                            query: "Summarize.",
                            answer: "SECRET EVALUATOR ANSWER",
                        },
                    ],
                    specific_query_list: [],
                }) + "\n",
            "schema.txt": "Original fixture spans are zero-based inclusive.",
            "project-order.txt":
                "Reviewed original fixture AMI series and a-d meeting order.",
        };
        values["data/Product/train/ES2002a.json"] =
            values["data/Product/jsonl/train.jsonl"].trim();
        extras = {
            spanConvention: {
                kind: "zero-based-inclusive",
                evidenceVerified: true,
                evidencePath: "schema.txt",
                evidenceSha256: sha256(values["schema.txt"]),
            },
            projectGrouping: {
                kind: "ami-scenario-series",
                evidenceVerified: true,
                evidencePath: "project-order.txt",
                evidenceSha256: sha256(values["project-order.txt"]),
            },
        };
        license.underlying = [{ ...license }];
    }
    for (const [name, value] of Object.entries(values)) {
        const filename = path.join(input, ...name.split("/"));
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, value);
    }
    const plan = {
        schemaVersion: 1,
        dataset,
        custody: "development",
        release: {
            repository: "https://example.org/original-fixture",
            revision: "a".repeat(40),
            files: Object.entries(values).map(([path, value]) => ({
                path,
                sha256: sha256(value),
            })),
            license,
        },
        selection: [
            {
                path: Object.keys(values)[0],
                recordIndex: 0,
                split: "development",
                ...(dataset === "qmsum-product"
                    ? { meetingIdentityPath: "data/Product/train/ES2002a.json" }
                    : {}),
            },
        ],
        ...extras,
    };
    const planPath = path.join(root, "plan.json");
    await writeFile(planPath, JSON.stringify(plan));
    const options = {
        command:
            dataset === "freshwiki" ? "prepare-freshwiki" : "prepare-qmsum",
        input: "assets",
        plan: "plan.json",
        output: path.join(".quality-view-data", "run"),
    };
    return { root, input, plan, planPath, options };
}

test("CLI parser requires explicit command and rejects unapproved acquisition", () => {
    assert.deepEqual(parsePreparationArguments(["--help"]), { help: true });
    assert.deepEqual(
        parsePreparationArguments([
            "prepare-freshwiki",
            "--input",
            "assets",
            "--plan",
            "plan.json",
            "--output",
            ".quality-view-data\\run",
        ]),
        {
            command: "prepare-freshwiki",
            input: "assets",
            plan: "plan.json",
            output: ".quality-view-data\\run",
        },
    );
    for (const args of [
        [],
        ["acquire-freshwiki"],
        ["prepare-qmsum", "--download"],
        ["prepare-qmsum", "--input"],
        ["prepare-qmsum", "--input", "x", "--input", "y"],
    ]) {
        assert.throws(
            () => parsePreparationArguments(args),
            /Acquisition|Unknown preparation option|Missing value|Duplicate preparation option/,
        );
    }
    assert.throws(
        () => parsePreparationArguments(["prepare-qmsum", "--input", "x"]),
        /Required --plan/,
    );
    assert.throws(
        () => authorizeAcquisition({}),
        /Separate dataset acquisition and source-terms authorization required/,
    );
    assert.throws(
        () =>
            authorizeAcquisition({
                approved: true,
                identity: "test",
                scope: "dataset-acquisition",
                datasetAcquisition: true,
                sourceTermsApproved: true,
            }),
        /acquisition approval requestHash: SHA-256 required/,
    );
});

test("CLI prepares FreshWiki and QMSum into separate durable construction/evaluator files", async (t) => {
    for (const dataset of ["freshwiki", "qmsum-product"]) {
        const f = await workspace(t, dataset);
        const result = await runPreparation(f.options, { projectRoot: f.root });
        assert.equal(result.bundles, 1);
        assert.deepEqual(
            (await readdir(result.output)).sort(),
            [
                ownershipMarker,
                "availability.json",
                "construction.json",
                "evaluator-only.json",
                "manifest.json",
            ].sort(),
        );
        const construction = JSON.parse(
            await readFile(
                path.join(result.output, "construction.json"),
                "utf8",
            ),
        );
        const evaluator = JSON.parse(
            await readFile(
                path.join(result.output, "evaluator-only.json"),
                "utf8",
            ),
        );
        const manifest = JSON.parse(
            await readFile(path.join(result.output, "manifest.json"), "utf8"),
        );
        assert.doesNotMatch(JSON.stringify(construction), /SECRET EVALUATOR/);
        assert.match(JSON.stringify(evaluator), /SECRET EVALUATOR/);
        assert.equal(construction.purpose, "construction-only");
        assert.equal(evaluator.purpose, "evaluator-only");
        assert.equal(manifest.constructionHash, identity(construction));
        assert.equal(result.constructionHash, identity(construction));
        assert.equal(result.manifestHash, identity(manifest));
        await assert.rejects(
            runPreparation(f.options, { projectRoot: f.root }),
            /Output already exists/,
        );
    }
});

test("default QMSum preparation requires project identities; query variants need the explicit command", async (t) => {
    const f = await workspace(t, "qmsum-product");
    delete f.plan.projectGrouping;
    await writeFile(f.planPath, JSON.stringify(f.plan));
    await assert.rejects(
        runPreparation(f.options, { projectRoot: f.root }),
        /Canonical briefs require verified AMI project grouping/,
    );
    const result = await runPreparation(
        { ...f.options, command: "prepare-qmsum-queries" },
        { projectRoot: f.root },
    );
    const construction = JSON.parse(
        await readFile(path.join(result.output, "construction.json"), "utf8"),
    );
    assert.equal(construction.bundles.length, 1);
    assert.equal(construction.bundles[0].project, undefined);
});

test("acquisition permits pinned named training identities but not all/validation/test copies", async (t) => {
    const f = await acquisitionWorkspace(t);
    const asset = f.manifest.release.files[0];
    for (const identityPath of [
        "data/Product/train/ES2002a.json",
        "data/Product/train/IS1008d.json",
    ]) {
        asset.path = identityPath;
        asset.url = `https://raw.githubusercontent.com/Yale-LILY/QMSum/${f.manifest.release.revision}/${identityPath}`;
        assert.doesNotThrow(() => validateAcquisitionManifest(f.manifest));
    }
    for (const identityPath of [
        "data/Product/all/ES2002a.json",
        "data/Product/val/ES2002a.json",
        "data/Product/test/ES2002a.json",
        "data/Product/train/unverified.json",
    ]) {
        asset.path = identityPath;
        asset.url = `https://raw.githubusercontent.com/Yale-LILY/QMSum/${f.manifest.release.revision}/${identityPath}`;
        assert.throws(
            () => validateAcquisitionManifest(f.manifest),
            /supported development dataset asset/,
        );
    }
});

test("CLI preflight rejects dangerous paths before reading assets or creating output", async (t) => {
    const f = await workspace(t);
    for (const options of [
        { ...f.options, output: path.join("..", "outside") },
        { ...f.options, output: path.join("packages", "data") },
        { ...f.options, input: "quality-fixtures" },
        { ...f.options, plan: "holdout.json" },
        { ...f.options, plan: "evaluator-only.json" },
        { ...f.options, input: f.root },
        {
            ...f.options,
            output: path.join(".quality-view-data", "nested", "run"),
        },
    ]) {
        await assert.rejects(
            runPreparation(options, { projectRoot: f.root }),
            /Path must be below|Output must be|Frozen\/evaluator\/profile paths/,
        );
    }
    assert.deepEqual((await readdir(f.root)).sort(), ["assets", "plan.json"]);
});

test("CLI preflight rejects backslash traversal before reading assets or creating output", async (t) => {
    const f = await workspace(t);
    for (const field of ["input", "output"]) {
        await assert.rejects(
            runPreparation(
                { ...f.options, [field]: "..\\outside" },
                { projectRoot: f.root },
            ),
            path.sep === "\\"
                ? /Path must be below/
                : /Asset paths must be relative without traversal/,
        );
    }
    assert.deepEqual((await readdir(f.root)).sort(), ["assets", "plan.json"]);
});

test("CLI rejects marker, pin and custody failures without partial output", async (t) => {
    const f = await workspace(t);
    await writeFile(path.join(f.input, ownershipMarker), "{}");
    await assert.rejects(
        runPreparation(f.options, { projectRoot: f.root }),
        /Input ownership marker required/,
    );
    await writeFile(
        path.join(f.input, ownershipMarker),
        JSON.stringify({ schemaVersion: 1, purpose: "pinned-local-assets" }),
    );
    f.plan.release.files[0].sha256 = "b".repeat(64);
    await writeFile(f.planPath, JSON.stringify(f.plan));
    await assert.rejects(
        runPreparation(f.options, { projectRoot: f.root }),
        /Raw asset hash mismatch/,
    );
    f.plan.custody = "confirmation-evaluator";
    f.plan.selection[0].split = "confirmation";
    await writeFile(f.planPath, JSON.stringify(f.plan));
    await assert.rejects(
        runPreparation(f.options, { projectRoot: f.root }),
        /does not read confirmation\/evaluator holdout assets/,
    );
    assert.deepEqual((await readdir(f.root)).sort(), ["assets", "plan.json"]);
});

test("CLI reads only required pinned development assets, never unused validation/test metadata", async (t) => {
    const f = await workspace(t, "qmsum-product");
    f.plan.release.files.push(
        { path: "data/Product/jsonl/val.jsonl", sha256: "b".repeat(64) },
        { path: "data/Product/jsonl/test.jsonl", sha256: "c".repeat(64) },
    );
    await writeFile(f.planPath, JSON.stringify(f.plan));
    assert.equal(
        (await runPreparation(f.options, { projectRoot: f.root })).bundles,
        1,
    );
    const other = {
        ...f.options,
        output: path.join(".quality-view-data", "other"),
    };
    f.plan.spanConvention.evidencePath = "data/Product/jsonl/val.jsonl";
    f.plan.spanConvention.evidenceSha256 = "b".repeat(64);
    await writeFile(f.planPath, JSON.stringify(f.plan));
    await assert.rejects(
        runPreparation(other, { projectRoot: f.root }),
        /does not read official validation\/test assets/,
    );
});

test("CLI rejects source and output junctions without following or removing them", async (t) => {
    const f = await workspace(t);
    const linkedInput = path.join(f.root, "linked-assets");
    await symlink(
        f.input,
        linkedInput,
        process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
        runPreparation(
            { ...f.options, input: "linked-assets" },
            { projectRoot: f.root },
        ),
        /Symlinks\/junctions are forbidden/,
    );
    const linkedOutput = path.join(f.root, ".quality-view-data");
    await symlink(
        f.input,
        linkedOutput,
        process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(
        runPreparation(f.options, { projectRoot: f.root }),
        /Symlinks\/junctions are forbidden/,
    );
    assert.ok(
        (await readFile(path.join(f.input, "article.json"), "utf8")).includes(
            "Original fixture",
        ),
    );
});

test("Standalone CLI help and preparation do not depend on product modules, models or network", async (t) => {
    const f = await workspace(t);
    const help = spawnSync(process.execPath, [cliPath, "--help"], {
        cwd: f.root,
        encoding: "utf8",
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Offline pinned-local preparation only/);
    const prepared = spawnSync(
        process.execPath,
        [
            cliPath,
            "prepare-freshwiki",
            "--input",
            "assets",
            "--plan",
            "plan.json",
            "--output",
            path.join(".quality-view-data", "cli-run"),
        ],
        { cwd: f.root, encoding: "utf8" },
    );
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(JSON.parse(prepared.stdout).bundles, 1);
    const refused = spawnSync(
        process.execPath,
        [cliPath, "acquire-freshwiki"],
        { cwd: f.root, encoding: "utf8" },
    );
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Acquisition supports only/);
});

async function acquisitionWorkspace(t, dataset = "qmsum-product") {
    const f = await workspace(t, dataset);
    await mkdir(path.join(f.root, "examples", "viewExamples"), {
        recursive: true,
    });
    const assetPath =
        dataset === "qmsum-product" ? "README.md" : "topic_list.csv";
    const value = Buffer.from("Original acquisition fixture bytes.\r\né😀");
    const repository =
        dataset === "qmsum-product"
            ? "https://github.com/Yale-LILY/QMSum"
            : "https://huggingface.co/datasets/EchoShao8899/FreshWiki";
    const revision = "a".repeat(40);
    const url =
        dataset === "qmsum-product"
            ? `https://raw.githubusercontent.com/Yale-LILY/QMSum/${revision}/${assetPath}`
            : `${repository}/resolve/${revision}/${assetPath}`;
    const manifest = {
        schemaVersion: 1,
        purpose: "pinned-dataset-acquisition",
        dataset,
        release: {
            repository,
            revision,
            license: structuredClone(f.plan.release.license),
            files: [
                {
                    path: assetPath,
                    url,
                    sha256: sha256(value),
                    maxBytes: 1024,
                    license: structuredClone(f.plan.release.license),
                },
            ],
        },
    };
    const approval = {
        approved: true,
        identity: "original-test-approval",
        scope: "dataset-acquisition",
        datasetAcquisition: true,
        sourceTermsApproved: true,
        requestHash: identity(manifest),
    };
    const manifestPath = path.join(f.root, "acquisition.json");
    const approvalPath = path.join(f.root, "approval.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(approvalPath, JSON.stringify(approval));
    return {
        ...f,
        manifest,
        approval,
        manifestPath,
        approvalPath,
        value,
        url,
        acquisitionOptions: {
            command: "acquire-pinned-assets",
            manifest: "acquisition.json",
            authorization: "approval.json",
            output: path.join("examples", "viewExamples", ".data", "acquired"),
        },
    };
}

function mockedResponse(url, bytes, options = {}) {
    const response = new Response(bytes, {
        status: options.status ?? 200,
        headers: options.headers,
    });
    Object.defineProperty(response, "url", {
        value: options.responseUrl ?? url,
    });
    Object.defineProperty(response, "redirected", {
        value: options.redirected ?? false,
    });
    return response;
}

test("Explicit acquisition command parses separate manifest/approval and is never preparation fallback", () => {
    assert.deepEqual(
        parsePreparationArguments([
            "acquire-pinned-assets",
            "--manifest",
            "request.json",
            "--authorization",
            "approval.json",
            "--output",
            "out",
        ]),
        {
            command: "acquire-pinned-assets",
            manifest: "request.json",
            authorization: "approval.json",
            output: "out",
        },
    );
    assert.throws(
        () =>
            parsePreparationArguments([
                "acquire-pinned-assets",
                "--input",
                "assets",
            ]),
        /Unknown preparation option/,
    );
    assert.throws(
        () =>
            parsePreparationArguments([
                "acquire-pinned-assets",
                "--manifest",
                "request.json",
            ]),
        /Required --authorization/,
    );
});

test("Acquisition downloads only exact explicitly approved dataset assets through mocked fetch", async (t) => {
    for (const dataset of ["freshwiki", "qmsum-product"]) {
        const f = await acquisitionWorkspace(t, dataset);
        const calls = [];
        const fetchAsset = async (url, options) => {
            calls.push({ url, options });
            return mockedResponse(url, f.value);
        };
        const receipt = await runAcquisition(f.acquisitionOptions, {
            projectRoot: f.root,
            fetchAsset,
        });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, f.url);
        assert.equal(calls[0].options.redirect, "manual");
        assert.equal(calls[0].options.credentials, "omit");
        assert.equal(calls[0].options.cache, "no-store");
        assert.ok(calls[0].options.signal instanceof AbortSignal);
        assert.equal(receipt.requestHash, identity(f.manifest));
        assert.deepEqual(
            await readFile(
                path.join(receipt.output, f.manifest.release.files[0].path),
            ),
            f.value,
        );
        const record = JSON.parse(
            await readFile(
                path.join(receipt.output, "acquisition-receipt.json"),
                "utf8",
            ),
        );
        assert.deepEqual(record.approval, f.approval);
        assert.deepEqual(record.manifest, f.manifest);
        assert.equal(
            JSON.parse(
                await readFile(
                    path.join(receipt.output, ownershipMarker),
                    "utf8",
                ),
            ).purpose,
            "pinned-local-assets",
        );
        await assert.rejects(
            runAcquisition(f.acquisitionOptions, {
                projectRoot: f.root,
                fetchAsset,
            }),
            /output already exists/,
        );
        assert.equal(calls.length, 1);
    }
});

test("Acquisition rejects missing/mismatched approval and unsafe paths before any HTTP", async (t) => {
    const f = await acquisitionWorkspace(t);
    let calls = 0;
    const fetchAsset = async () => {
        calls++;
        throw new Error("HTTP must not be reached");
    };
    f.approval.approved = false;
    await writeFile(f.approvalPath, JSON.stringify(f.approval));
    await assert.rejects(
        runAcquisition(f.acquisitionOptions, {
            projectRoot: f.root,
            fetchAsset,
        }),
        /Separate dataset acquisition and source-terms authorization required/,
    );
    f.approval.approved = true;
    f.approval.requestHash = "b".repeat(64);
    await writeFile(f.approvalPath, JSON.stringify(f.approval));
    await assert.rejects(
        runAcquisition(f.acquisitionOptions, {
            projectRoot: f.root,
            fetchAsset,
        }),
        /bind the exact manifest request/,
    );
    await assert.rejects(
        runAcquisition(
            { ...f.acquisitionOptions, output: ".quality-view-data\\wrong" },
            { projectRoot: f.root, fetchAsset },
        ),
        /Acquisition output must be/,
    );
    assert.equal(calls, 0);
});

test("Acquisition validates exact HTTPS primary URL, raw hash, revision, reviewed terms and bounded inventory", async (t) => {
    const f = await acquisitionWorkspace(t);
    for (const [mutate, expected] of [
        [
            (m) => {
                m.release.revision = "main";
            },
            /Pinned full repository revision required/,
        ],
        [
            (m) => {
                m.release.files[0].url =
                    "https://publisher.example/full-article";
            },
            /Exact HTTPS dataset URL/,
        ],
        [
            (m) => {
                m.release.files[0].url = m.release.files[0].url.replace(
                    "https:",
                    "http:",
                );
            },
            /Exact HTTPS dataset URL/,
        ],
        [
            (m) => {
                m.release.files[0].url += "?token=not-allowed";
            },
            /Exact HTTPS dataset URL/,
        ],
        [
            (m) => {
                m.release.files[0].path = "data/Product/jsonl/val.jsonl";
            },
            /supported development dataset asset/,
        ],
        [
            (m) => {
                m.release.files[0].path = "../unsafe";
            },
            /relative without traversal/,
        ],
        [
            (m) => {
                m.release.files[0].sha256 = "unknown";
            },
            /SHA-256 required/,
        ],
        [
            (m) => {
                m.release.files[0].license.reviewed = false;
            },
            /terms review required/,
        ],
        [
            (m) => {
                m.release.files[0].maxBytes = 0;
            },
            /Explicit acquisition maxBytes/,
        ],
        [
            (m) => {
                m.release.files.push(structuredClone(m.release.files[0]));
            },
            /Duplicate acquisition asset path/,
        ],
    ]) {
        const manifest = structuredClone(f.manifest);
        mutate(manifest);
        assert.throws(() => validateAcquisitionManifest(manifest), expected);
    }
});

test("Acquisition fails closed on redirects, access errors, network errors, hashes and byte limits", async (t) => {
    for (const [respond, expected] of [
        [
            (f) => mockedResponse(f.url, f.value, { status: 403 }),
            /Dataset access\/redirect failure/,
        ],
        [
            (f) => mockedResponse(f.url, f.value, { status: 302 }),
            /Dataset access\/redirect failure/,
        ],
        [
            (f) => mockedResponse(f.url, f.value, { redirected: true }),
            /Dataset access\/redirect failure/,
        ],
        [
            (f) =>
                mockedResponse(f.url, f.value, {
                    responseUrl: "https://other.example/replacement",
                }),
            /Dataset access\/redirect failure/,
        ],
        [
            (f) => mockedResponse(f.url, Buffer.from("wrong hash")),
            /Acquired raw asset hash mismatch/,
        ],
        [
            (f) => mockedResponse(f.url, Buffer.alloc(1025)),
            /response exceeds approved limit/,
        ],
        [
            (f) =>
                mockedResponse(f.url, f.value, {
                    headers: { "content-length": "1025" },
                }),
            /content-length exceeds approved limit/,
        ],
        [
            () => {
                throw new Error("original mocked network refusal");
            },
            /original mocked network refusal/,
        ],
    ]) {
        const f = await acquisitionWorkspace(t);
        let calls = 0;
        await assert.rejects(
            runAcquisition(f.acquisitionOptions, {
                projectRoot: f.root,
                fetchAsset: async () => {
                    calls++;
                    return respond(f);
                },
            }),
            expected,
        );
        assert.equal(calls, 1);
        assert.deepEqual(
            await readdir(
                path.join(f.root, "examples", "viewExamples", ".data"),
            ),
            [],
        );
    }
});

test("FreshWiki acquisition accepts only one same-publisher immutable cache redirect", async (t) => {
    const f = await acquisitionWorkspace(t, "freshwiki");
    const cache = `https://huggingface.co/api/resolve-cache/datasets/EchoShao8899/FreshWiki/${f.manifest.release.revision}/topic_list.csv?etag=original`;
    const calls = [];
    const receipt = await runAcquisition(f.acquisitionOptions, {
        projectRoot: f.root,
        fetchAsset: async (url) => {
            calls.push(url);
            return calls.length === 1
                ? mockedResponse(url, "", {
                      status: 307,
                      headers: { location: cache },
                  })
                : mockedResponse(url, f.value);
        },
    });
    assert.deepEqual(calls, [f.url, cache]);
    assert.deepEqual(
        await readFile(path.join(receipt.output, "topic_list.csv")),
        f.value,
    );
});

test("FreshWiki cache redirects cannot change host, revision, asset, credentials or chain redirects", async (t) => {
    for (const mutate of [
        (url) => url.replace("huggingface.co", "other.example"),
        (url) => url.replace("a".repeat(40), "b".repeat(40)),
        (url) => url.replace("topic_list.csv", "README.md"),
        (url) => url.replace("https://", "https://user@"),
        (url) => `${url}#fragment`,
        (url) => url,
    ]) {
        const f = await acquisitionWorkspace(t, "freshwiki");
        const cache = `https://huggingface.co/api/resolve-cache/datasets/EchoShao8899/FreshWiki/${f.manifest.release.revision}/topic_list.csv`;
        let calls = 0;
        await assert.rejects(
            runAcquisition(f.acquisitionOptions, {
                projectRoot: f.root,
                fetchAsset: async (url) => {
                    calls++;
                    return mockedResponse(url, "", {
                        status: 307,
                        headers: { location: mutate(cache) },
                    });
                },
            }),
            /cache redirect|access\/redirect failure/,
        );
        assert.ok(calls <= 2);
    }
});

test("Acquisition rejects source/output junctions and unpinned confirmation paths before HTTP", async (t) => {
    const f = await acquisitionWorkspace(t, "freshwiki");
    const original = path.join(f.root, "examples", "viewExamples", ".data");
    await symlink(
        f.input,
        original,
        process.platform === "win32" ? "junction" : "dir",
    );
    let calls = 0;
    const fetchAsset = async () => {
        calls++;
        throw new Error("Never fetch through junction");
    };
    await assert.rejects(
        runAcquisition(f.acquisitionOptions, {
            projectRoot: f.root,
            fetchAsset,
        }),
        /Symlinks\/junctions are forbidden/,
    );
    assert.equal(calls, 0);
    assert.ok(
        (await readFile(path.join(f.input, "article.json"), "utf8")).includes(
            "Original fixture",
        ),
    );
});
