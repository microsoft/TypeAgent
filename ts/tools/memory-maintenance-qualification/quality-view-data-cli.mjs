// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { lstat, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { check, identity, text, hash, sha256 } from "./quality-contract.mjs";
import {
    prepareFreshWiki,
    relativeAssetPath,
    validatePreparationPlan,
    pinnedAsset,
    validateTerms,
} from "./quality-freshwiki.mjs";
import { prepareQMSum, prepareQMSumQueries } from "./quality-qmsum.mjs";

export const ownershipMarker = ".quality-view-data-owned.json";
export const acquisitionBoundaryMessage =
    "Acquisition supports only acquire-pinned-assets: exact approved HTTPS dataset assets, never crawling, publisher copies or replacement searches.";

export function authorizeAcquisition(authorization, requestHash) {
    check(
        authorization?.approved === true &&
            authorization?.datasetAcquisition === true &&
            authorization?.sourceTermsApproved === true,
        "Separate dataset acquisition and source-terms authorization required",
    );
    text(authorization.identity, "acquisition approval identity");
    check(
        authorization.scope === "dataset-acquisition" &&
            hash(
                authorization.requestHash,
                "acquisition approval requestHash",
            ) === requestHash,
        "Acquisition approval must bind the exact manifest request",
    );
}

export function parsePreparationArguments(args) {
    if (args.length === 1 && ["--help", "-h"].includes(args[0]))
        return { help: true };
    const command = args[0];
    check(
        [
            "prepare-freshwiki",
            "prepare-qmsum",
            "prepare-qmsum-queries",
            "acquire-pinned-assets",
        ].includes(command),
        acquisitionBoundaryMessage,
    );
    const options = { command };
    for (let index = 1; index < args.length; index += 2) {
        const flag = args[index];
        check(
            (command === "acquire-pinned-assets"
                ? ["--manifest", "--authorization", "--output"]
                : ["--input", "--plan", "--output"]
            ).includes(flag),
            `Unknown preparation option: ${flag}`,
        );
        const key = flag.slice(2);
        check(
            !Object.hasOwn(options, key),
            `Duplicate preparation option: ${flag}`,
        );
        check(
            typeof args[index + 1] === "string" &&
                !args[index + 1].startsWith("--"),
            `Missing value: ${flag}`,
        );
        options[key] = args[index + 1];
    }
    for (const key of command === "acquire-pinned-assets"
        ? ["manifest", "authorization", "output"]
        : ["input", "plan", "output"])
        check(options[key], `Required --${key}`);
    return options;
}

export function validateAcquisitionManifest(manifest) {
    check(
        manifest?.schemaVersion === 1 &&
            manifest.purpose === "pinned-dataset-acquisition" &&
            ["freshwiki", "qmsum-product"].includes(manifest.dataset),
        "Unknown pinned dataset acquisition manifest",
    );
    const release = manifest.release;
    check(
        release && /^[a-f0-9]{40}$/.test(release.revision),
        "Pinned full repository revision required",
    );
    const repository =
        manifest.dataset === "freshwiki"
            ? "https://huggingface.co/datasets/EchoShao8899/FreshWiki"
            : "https://github.com/Yale-LILY/QMSum";
    check(
        release.repository === repository,
        "Acquisition repository must be the primary dataset publisher",
    );
    validateTerms(release.license);
    if (manifest.dataset === "qmsum-product") {
        check(
            Array.isArray(release.license.underlying) &&
                release.license.underlying.length > 0,
            "Underlying QMSum meeting corpus terms review required",
        );
    }
    check(
        Array.isArray(release.files) &&
            release.files.length > 0 &&
            release.files.length <= 16,
        "Acquisition requires 1-16 explicitly pinned files, not a corpus mirror",
    );
    const paths = new Set();
    let maximumBytes = 0;
    for (const file of release.files) {
        check(
            file && typeof file === "object" && !Array.isArray(file),
            "Acquisition file must be an object",
        );
        const assetPath = relativeAssetPath(file.path);
        check(
            !paths.has(assetPath.toLowerCase()),
            "Duplicate acquisition asset path",
        );
        paths.add(assetPath.toLowerCase());
        hash(file.sha256, "acquisition raw file hash");
        validateTerms(file.license, "acquisition asset license");
        check(
            Number.isSafeInteger(file.maxBytes) &&
                file.maxBytes > 0 &&
                file.maxBytes <= 64 * 1024 * 1024,
            "Explicit acquisition maxBytes must be between 1 and 64 MiB",
        );
        maximumBytes += file.maxBytes;
        const allowed =
            manifest.dataset === "freshwiki"
                ? /^(?:json\/[^/]+\.json|topic_list\.csv|README\.md)$/
                : /^(?:data\/Product\/jsonl\/train\.jsonl|data\/Product\/train\/(?:ES|IS|TS)\d{4}[a-d]\.json|README\.md|LICENSE)$/;
        check(
            allowed.test(assetPath),
            "Acquisition path is not a supported development dataset asset",
        );
        const encodedPath = assetPath
            .split("/")
            .map(encodeURIComponent)
            .join("/");
        const expected =
            manifest.dataset === "freshwiki"
                ? `${repository}/resolve/${release.revision}/${encodedPath}`
                : `https://raw.githubusercontent.com/Yale-LILY/QMSum/${release.revision}/${encodedPath}`;
        let url;
        try {
            url = new URL(file.url);
        } catch {
            throw new Error("Exact HTTPS dataset URL required");
        }
        check(
            url.protocol === "https:" &&
                !url.username &&
                !url.password &&
                !url.search &&
                !url.hash &&
                url.href === expected &&
                file.url === expected,
            "Exact HTTPS dataset URL/revision/path required; redirects and publisher sources are unsupported",
        );
    }
    check(
        maximumBytes <= 128 * 1024 * 1024,
        "Acquisition request exceeds the 128 MiB bounded envelope",
    );
    return identity(manifest);
}

async function pinnedAssetResponse(file, fetchAsset) {
    const options = {
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
    };
    const response = await fetchAsset(file.url, options);
    const match =
        /^https:\/\/huggingface\.co\/datasets\/EchoShao8899\/FreshWiki\/resolve\/([a-f0-9]{40})\//.exec(
            file.url,
        );
    if (response.status !== 307 || !match) return { response, url: file.url };
    try {
        const location = response.headers.get("location");
        check(location, `Missing pinned dataset cache location: ${file.path}`);
        const target = new URL(location, file.url);
        check(
            response.url === file.url &&
                !response.redirected &&
                target.origin === "https://huggingface.co" &&
                !target.username &&
                !target.password &&
                !target.hash &&
                target.pathname ===
                    `/api/resolve-cache/datasets/EchoShao8899/FreshWiki/${match[1]}/${encodeURIComponent(file.path)}`,
            `Unapproved pinned dataset cache redirect: ${file.path}`,
        );
        await response.body?.cancel();
        return {
            response: await fetchAsset(target.href, options),
            url: target.href,
        };
    } catch (error) {
        await response.body?.cancel().catch(() => {});
        throw error;
    }
}

async function downloadPinnedAsset(file, fetchAsset) {
    const { response, url } = await pinnedAssetResponse(file, fetchAsset);
    try {
        check(
            response.status === 200 &&
                !response.redirected &&
                response.url === url,
            `Dataset access/redirect failure: ${file.path} (HTTP ${response.status})`,
        );
        const length = response.headers.get("content-length");
        check(
            length === null ||
                (/^\d+$/.test(length) && Number(length) <= file.maxBytes),
            `Dataset content-length exceeds approved limit: ${file.path}`,
        );
        check(response.body, `Missing dataset response body: ${file.path}`);
        const chunks = [];
        let count = 0;
        for await (const chunk of response.body) {
            count += chunk.byteLength;
            check(
                count <= file.maxBytes,
                `Dataset response exceeds approved limit: ${file.path}`,
            );
            chunks.push(Buffer.from(chunk));
        }
        const bytes = Buffer.concat(chunks);
        check(
            sha256(bytes) === file.sha256,
            `Acquired raw asset hash mismatch: ${file.path}`,
        );
        return bytes;
    } catch (error) {
        await response.body?.cancel().catch(() => {});
        throw error;
    }
}

export async function runAcquisition(
    options,
    { projectRoot = process.cwd(), fetchAsset = globalThis.fetch } = {},
) {
    const root = path.resolve(projectRoot);
    const manifestPath = projectPath(root, options.manifest);
    const approvalPath = projectPath(root, options.authorization);
    const output = projectPath(root, options.output);
    const dataRoot = path.join(root, "examples", "viewExamples", ".data");
    check(
        path.dirname(output) === dataRoot,
        "Acquisition output must be a new direct child of examples\\viewExamples\\.data",
    );
    check(
        !manifestPath.startsWith(`${output}${path.sep}`) &&
            !approvalPath.startsWith(`${output}${path.sep}`),
        "Acquisition inputs/output must not overlap",
    );
    await inspectPath(root, manifestPath);
    await inspectPath(root, approvalPath);
    await inspectPath(root, output, true);
    try {
        await lstat(output);
        throw new Error(
            "Acquisition output already exists; never overwrite assets",
        );
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    const manifest = JSON.parse(
        (await readFile(manifestPath, "utf8")).replace(/^\uFEFF/, ""),
    );
    const requestHash = validateAcquisitionManifest(manifest);
    const approval = JSON.parse(
        (await readFile(approvalPath, "utf8")).replace(/^\uFEFF/, ""),
    );
    authorizeAcquisition(approval, requestHash);
    check(
        typeof fetchAsset === "function",
        "HTTPS fetch unavailable; acquisition blocked",
    );
    await inspectPath(root, path.dirname(dataRoot));
    await mkdir(dataRoot, { recursive: true });
    await inspectPath(root, dataRoot);
    await mkdir(output);
    try {
        await writeFile(
            path.join(output, ownershipMarker),
            JSON.stringify({
                schemaVersion: 1,
                purpose: "pinned-local-assets",
                acquisitionRequestHash: requestHash,
            }) + "\n",
            { flag: "wx" },
        );
        for (const file of manifest.release.files) {
            const bytes = await downloadPinnedAsset(file, fetchAsset);
            const filename = path.join(
                output,
                ...relativeAssetPath(file.path).split("/"),
            );
            await mkdir(path.dirname(filename), { recursive: true });
            await writeFile(filename, bytes, { flag: "wx" });
        }
        await writeFile(
            path.join(output, "acquisition-receipt.json"),
            JSON.stringify(
                {
                    schemaVersion: 1,
                    purpose: "pinned-dataset-acquisition-receipt",
                    requestHash,
                    manifest,
                    approval,
                },
                null,
                2,
            ) + "\n",
            { flag: "wx" },
        );
    } catch (error) {
        await rm(output, { recursive: true, force: true });
        throw error;
    }
    return { output, files: manifest.release.files.length, requestHash };
}

function projectPath(root, supplied) {
    check(
        typeof supplied === "string" && supplied.length > 0,
        "Explicit project-local path required",
    );
    const resolved = path.resolve(root, supplied);
    const relative = path.relative(root, resolved);
    check(
        relative &&
            !relative.startsWith(`..${path.sep}`) &&
            relative !== ".." &&
            !path.isAbsolute(relative),
        "Path must be below the explicit project root",
    );
    relativeAssetPath(relative);
    check(
        !relative
            .split(/[\\/]/)
            .some((part) =>
                /^(?:quality-fixtures|evaluator(?:-only)?(?:[.-].*)?|holdout(?:[.-].*)?|\.typeagent|\.git|node_modules|credentials)$/i.test(
                    part,
                ),
            ),
        "Frozen/evaluator/profile paths are forbidden",
    );
    return resolved;
}

async function inspectPath(root, target, allowMissing = false) {
    const rootStat = await lstat(root);
    check(
        rootStat.isDirectory() && !rootStat.isSymbolicLink(),
        "Project root must be a real directory",
    );
    const parts = path.relative(root, target).split(path.sep);
    let current = root;
    for (const part of parts) {
        current = path.join(current, part);
        let stat;
        try {
            stat = await lstat(current);
        } catch (error) {
            if (allowMissing && error.code === "ENOENT") return;
            throw error;
        }
        check(
            !stat.isSymbolicLink(),
            "Symlinks/junctions are forbidden for preparation paths",
        );
    }
}

function requiredAssets(plan, canonicalProjects) {
    const paths = new Set(plan.selection.map((selected) => selected.path));
    if (plan.referenceSchema) paths.add(plan.referenceSchema.evidencePath);
    if (plan.spanConvention) paths.add(plan.spanConvention.evidencePath);
    if (canonicalProjects) {
        check(
            plan.projectGrouping,
            "Canonical briefs require verified AMI project grouping and meeting order",
        );
        paths.add(plan.projectGrouping.evidencePath);
        for (const selected of plan.selection)
            paths.add(selected.meetingIdentityPath);
    }
    for (const source of plan.sources ?? []) {
        if (source.availability === "available") {
            paths.add(source.path);
            if (source.authoredAt !== undefined)
                paths.add(source.authoredAtEvidencePath);
        }
    }
    return [...new Set([...paths].map(relativeAssetPath))];
}

export async function runPreparation(
    options,
    { projectRoot = process.cwd() } = {},
) {
    const root = path.resolve(projectRoot);
    const dataset =
        options.command === "prepare-freshwiki"
            ? "freshwiki"
            : ["prepare-qmsum", "prepare-qmsum-queries"].includes(
                    options.command,
                )
              ? "qmsum-product"
              : undefined;
    check(dataset, acquisitionBoundaryMessage);
    const input = projectPath(root, options.input);
    const planPath = projectPath(root, options.plan);
    const output = projectPath(root, options.output);
    const outputRoot = path.join(root, ".quality-view-data");
    const exampleDataRoot = path.join(
        root,
        "examples",
        "viewExamples",
        ".data",
    );
    const selectedOutputRoot =
        path.dirname(output) === exampleDataRoot ? exampleDataRoot : outputRoot;
    check(
        path.dirname(output) === selectedOutputRoot,
        "Output must be a new direct child of project-local .quality-view-data or examples\\viewExamples\\.data",
    );
    check(
        !input.startsWith(`${output}${path.sep}`) &&
            input !== output &&
            !output.startsWith(`${input}${path.sep}`) &&
            !planPath.startsWith(`${output}${path.sep}`),
        "Input/plan/output must not overlap",
    );
    await inspectPath(root, input);
    await inspectPath(root, planPath);
    await inspectPath(root, output, true);
    try {
        await lstat(output);
        throw new Error(
            "Output already exists; never overwrite preparation artifacts",
        );
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    const markerPath = path.join(input, ownershipMarker);
    await inspectPath(root, markerPath);
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    check(
        marker.schemaVersion === 1 && marker.purpose === "pinned-local-assets",
        "Input ownership marker required",
    );
    const plan = JSON.parse(
        (await readFile(planPath, "utf8")).replace(/^\uFEFF/, ""),
    );
    const release = validatePreparationPlan(plan, dataset);
    check(
        plan.custody === "development",
        "This preparation CLI does not read confirmation/evaluator holdout assets",
    );
    const assets = [];
    for (const assetPath of requiredAssets(
        plan,
        options.command === "prepare-qmsum",
    )) {
        check(
            !/(?:^|\/)(?:val|test)(?:\/|\.jsonl$)/i.test(assetPath),
            "This preparation CLI does not read official validation/test assets",
        );
        check(
            release.files.some((file) => file.path === assetPath),
            `Unpinned asset: ${assetPath}`,
        );
        const filename = projectPath(
            root,
            path.join(input, ...assetPath.split("/")),
        );
        await inspectPath(root, filename);
        assets.push({ path: assetPath, bytes: await readFile(filename) });
        pinnedAsset(assets, release, assetPath);
    }
    const result =
        dataset === "freshwiki"
            ? prepareFreshWiki(assets, plan)
            : options.command === "prepare-qmsum-queries"
              ? prepareQMSumQueries(assets, plan)
              : prepareQMSum(assets, plan);
    await mkdir(selectedOutputRoot, { recursive: true });
    await inspectPath(root, selectedOutputRoot);
    await mkdir(output);
    try {
        const files = {
            [ownershipMarker]: {
                schemaVersion: 1,
                purpose: "prepared-view-data",
            },
            "construction.json": result.construction,
            "evaluator-only.json": result.evaluator,
            "availability.json": result.availability,
            "manifest.json": result.manifest,
        };
        for (const [name, value] of Object.entries(files)) {
            await writeFile(
                path.join(output, name),
                `${JSON.stringify(value, null, 2)}\n`,
                { flag: "wx" },
            );
        }
    } catch (error) {
        await rm(output, { recursive: true, force: true });
        throw error;
    }
    return {
        output,
        bundles: result.construction.bundles.length,
        constructionHash: result.manifest.constructionHash,
        manifestHash: identity(result.manifest),
    };
}

export async function main(args = process.argv.slice(2)) {
    const options = parsePreparationArguments(args);
    if (options.help) {
        process.stdout.write(
            "Offline pinned-local preparation only:\n" +
                "  prepare-freshwiki|prepare-qmsum|prepare-qmsum-queries --input <owned-assets> --plan <plan.json> --output .quality-view-data\\<new-run>\n" +
                "  prepare-qmsum emits canonical projects; prepare-qmsum-queries explicitly emits evaluation variants.\n" +
                "  acquire-pinned-assets --manifest <manifest.json> --authorization <approval.json> --output examples\\viewExamples\\.data\\<new-run>\n" +
                acquisitionBoundaryMessage +
                "\n",
        );
        return;
    }
    process.stdout.write(
        JSON.stringify(
            await (options.command === "acquire-pinned-assets"
                ? runAcquisition(options)
                : runPreparation(options)),
        ) + "\n",
    );
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
