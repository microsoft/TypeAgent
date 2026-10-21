// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { reviewPacket } from "./evaluate.mjs";
import {
    check,
    readJson,
    loadFrozenFixtures,
    developmentPacket,
    sha256,
    identity,
} from "./quality-contract.mjs";
import {
    scoreArtifacts,
    compareArtifacts,
    scoreBlindedUsefulness,
} from "./quality-artifacts.mjs";
import {
    prepareLongMemEval,
    exportLongMemEvalHypotheses,
    summarizeLongMemEvalLabels,
    prepareQed,
    validateQedReviews,
} from "./quality-adapters.mjs";

export const usage = `Offline preparation only; no models, stores or credentials.
quality-cli.mjs freeze
quality-cli.mjs export-development --output <new-file.json>
quality-cli.mjs score-artifacts --run <run.json> --outputs <outputs.json> --annotations <annotations.json> --review <review.json> --output <new-scorecard.json>
quality-cli.mjs compare --input <scorecard.json> --baseline <arm> --candidate <arm> --output <new-file.json>
quality-cli.mjs score-usefulness --run <run.json> --outputs <outputs.json> --review <blinded-reviews.json> --output <new-file.json>
quality-cli.mjs prepare-longmemeval --input <official.json> --plan <plan.json> --output <new-directory>
quality-cli.mjs export-lme-hypotheses --input <prepared-directory> --outputs <attempts.json> --output <new-file.jsonl>
quality-cli.mjs summarize-lme-labels --input <prepared-directory> --labels <official-results.jsonl> --output <new-file.json>
quality-cli.mjs prepare-qed --articles <AP-raw-directory> --local <local-assertions.json> --global <global-assertions.json> --plan <plan.json> --output <new-directory>
quality-cli.mjs inventory-qed --articles <AP-raw-directory> --local <local-assertions.json> --global <global-assertions.json> --output <new-file.json>
quality-cli.mjs validate-qed-reviews --input <prepared-directory> --articles <AP-raw-directory> --review <human-reviews.json> --output <new-file.json>
quality-cli.mjs lifecycle-review --fixtures <existing-maintenance-fixture-root> --input <existing-receipt.json> --output <new-file.json>
All outputs must be new paths. Construction, reader-only and evaluator-only packets stay separate.`;

async function articleFiles(root, relative = "") {
    const records = [];
    const entries = await readdir(path.join(root, relative), {
        withFileTypes: true,
    });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        check(!entry.isSymbolicLink(), "AP import refuses symbolic links");
        const filename = path.join(relative, entry.name);
        if (entry.isDirectory())
            records.push(...(await articleFiles(root, filename)));
        else if (entry.isFile() && entry.name.endsWith(".json")) {
            const bytes = await readFile(path.join(root, filename));
            records.push({
                path: filename.replaceAll("\\", "/"),
                sha256: sha256(bytes),
                article: JSON.parse(
                    bytes.toString("utf8").replace(/^\uFEFF/, ""),
                ),
            });
        }
    }
    return records;
}

async function writeNew(filename, data) {
    await writeFile(
        filename,
        typeof data === "string" ? data : JSON.stringify(data, null, 2) + "\n",
        { flag: "wx" },
    );
}

async function qedInputs(values) {
    const records = await articleFiles(values.articles);
    const corpusInventoryHash = identity(
        records.map(({ path, sha256 }) => ({ path, sha256 })),
    );
    const localBytes = await readFile(values.local);
    const globalBytes = await readFile(values.global);
    const localSha256 = sha256(localBytes);
    const globalSha256 = sha256(globalBytes);
    return {
        records,
        localBytes,
        globalBytes,
        inventory: {
            articles: records.length,
            corpusInventoryHash,
            localSha256,
            globalSha256,
            combinedSha256: identity({
                corpusInventoryHash,
                localSha256,
                globalSha256,
            }),
            fileHashes: records.map(({ path, sha256 }) => ({ path, sha256 })),
        },
    };
}

async function writePrepared(directory, result) {
    await mkdir(directory);
    await writeNew(path.join(directory, "manifest.json"), result.manifest);
    await writeNew(
        path.join(directory, "construction.json"),
        result.construction,
    );
    if (result.readerOnly)
        await writeNew(
            path.join(directory, "reader-only.json"),
            result.readerOnly,
        );
    await writeNew(
        path.join(directory, "evaluator-only.json"),
        result.evaluatorOnly,
    );
}

async function readPrepared(directory) {
    const manifest = await readJson(path.join(directory, "manifest.json"));
    const { sha256: frozenHash, ...body } = manifest;
    check(identity(body) === frozenHash, "Prepared manifest identity mismatch");
    const evaluatorOnly = await readJson(
        path.join(directory, "evaluator-only.json"),
    );
    check(
        evaluatorOnly.evaluatorOnly === true,
        "Evaluator packet custody marker missing",
    );
    if (manifest.originalRowHashes) {
        check(
            evaluatorOnly.references.length ===
                manifest.originalRowHashes.length,
            "Prepared references missing",
        );
        for (const entry of manifest.originalRowHashes) {
            const matches = evaluatorOnly.references.filter(
                (r) => r.question_id === entry.id,
            );
            check(
                matches.length === 1 && identity(matches[0]) === entry.sha256,
                "Prepared reference identity mismatch",
            );
        }
    } else {
        check(
            evaluatorOnly.questions.length === manifest.questions.length,
            "Prepared QED questions missing",
        );
        for (const entry of manifest.questions) {
            const matches = evaluatorOnly.questions.filter(
                (r) => r.original.question_id === entry.id,
            );
            check(
                matches.length === 1 &&
                    identity(matches[0].original) === entry.sha256 &&
                    matches[0].rowHash === entry.sha256 &&
                    matches[0].split === entry.split &&
                    matches[0].kind === entry.kind,
                "Prepared QED question identity mismatch",
            );
        }
    }
    return { manifest, evaluatorOnly };
}

export async function main(argv = process.argv.slice(2)) {
    if (argv.length === 0 || argv.includes("--help")) return usage;
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: Object.fromEntries(
            [
                "input",
                "output",
                "plan",
                "run",
                "outputs",
                "annotations",
                "review",
                "baseline",
                "candidate",
                "articles",
                "local",
                "global",
                "labels",
                "fixtures",
            ].map((name) => [name, { type: "string" }]),
        ),
    });
    check(positionals.length === 1, "Exactly one command required");
    const command = positionals[0];
    if (command === "freeze") {
        const frozen = await loadFrozenFixtures();
        return {
            manifestHash: frozen.manifestHash,
            bundles: frozen.bundles.length,
            splits: frozen.contract.splits,
            goldReviewStatus: frozen.manifest.goldReviewStatus,
        };
    }
    check(values.output, "--output required");
    let result;
    switch (command) {
        case "export-development":
            result = developmentPacket(await loadFrozenFixtures());
            break;
        case "score-artifacts":
            result = scoreArtifacts(
                await loadFrozenFixtures(),
                await readJson(values.run),
                await readJson(values.outputs),
                await readJson(values.annotations),
                await readJson(values.review),
            );
            break;
        case "compare":
            result = compareArtifacts(
                await readJson(values.input),
                values.baseline,
                values.candidate,
            );
            break;
        case "score-usefulness":
            result = scoreBlindedUsefulness(
                await loadFrozenFixtures(),
                await readJson(values.run),
                await readJson(values.outputs),
                await readJson(values.review),
            );
            break;
        case "prepare-longmemeval": {
            const bytes = await readFile(values.input);
            const plan = await readJson(values.plan);
            check(
                sha256(bytes) === plan.provenance?.sha256,
                "Official dataset raw-file hash mismatch",
            );
            result = prepareLongMemEval(
                JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")),
                plan,
            );
            await writePrepared(values.output, result);
            return {
                prepared: true,
                manifestHash: result.manifest.sha256,
                scheduledQuestions: 50,
                execution: "not run",
            };
        }
        case "prepare-qed": {
            const { records, localBytes, globalBytes, inventory } =
                await qedInputs(values);
            const inventoryHash = inventory.corpusInventoryHash;
            const plan = await readJson(values.plan);
            check(
                plan.corpusInventoryHash === inventoryHash,
                `AP inventory hash mismatch; observed ${inventoryHash}`,
            );
            check(
                sha256(localBytes) === plan.localSha256 &&
                    sha256(globalBytes) === plan.globalSha256,
                "QED question export hash mismatch",
            );
            check(
                plan.provenance?.sha256 ===
                    identity({
                        corpusInventoryHash: inventoryHash,
                        localSha256: plan.localSha256,
                        globalSha256: plan.globalSha256,
                    }),
                "QED combined provenance hash mismatch",
            );
            result = prepareQed(
                records.map((r) => r.article),
                JSON.parse(localBytes.toString("utf8").replace(/^\uFEFF/, "")),
                JSON.parse(globalBytes.toString("utf8").replace(/^\uFEFF/, "")),
                plan,
            );
            await writePrepared(values.output, result);
            return {
                prepared: true,
                manifestHash: result.manifest.sha256,
                execution: "not run",
                gold: result.manifest.goldReviewStatus,
            };
        }
        case "inventory-qed":
            result = (await qedInputs(values)).inventory;
            break;
        case "export-lme-hypotheses":
            result = exportLongMemEvalHypotheses(
                await readPrepared(values.input),
                await readJson(values.outputs),
            );
            break;
        case "summarize-lme-labels": {
            const data = (await readFile(values.labels, "utf8")).trim();
            check(data.length > 0, "Absent official score outputs");
            result = summarizeLongMemEvalLabels(
                await readPrepared(values.input),
                data.split(/\r?\n/).map((line) => JSON.parse(line)),
            );
            break;
        }
        case "validate-qed-reviews":
            result = validateQedReviews(
                await readPrepared(values.input),
                await readJson(values.review),
                (await articleFiles(values.articles)).map((r) => r.article),
            );
            break;
        case "lifecycle-review":
            result = await reviewPacket(
                values.fixtures,
                await readJson(values.input),
            );
            break;
        default:
            throw new Error(`Unknown command: ${command}`);
    }
    await writeNew(values.output, result);
    return {
        written: values.output,
        execution: "offline tooling only; not benchmark execution",
    };
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    main().then(
        (result) =>
            console.log(
                typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
            ),
        (error) => {
            console.error(error.message);
            process.exitCode = 1;
        },
    );
}
