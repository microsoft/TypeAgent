// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { TextDecoder } from "node:util";
import {
    check,
    text,
    hash,
    unique,
    sha256,
    clone,
    identity,
} from "./quality-contract.mjs";

export const unavailableSourceStates = [
    "dead-url",
    "paywall",
    "denied-access",
    "unresolved",
    "not-acquired",
];

export function relativeAssetPath(value) {
    text(value, "asset path");
    check(
        !/[:\0]/.test(value) &&
            !/^[\\/]/.test(value) &&
            value
                .split(/[\\/]/)
                .every(
                    (part) =>
                        part &&
                        part !== "." &&
                        part !== ".." &&
                        !/[<>:"|?*\u0000-\u001f]/.test(part) &&
                        !/[. ]$/.test(part) &&
                        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(
                            part,
                        ),
                ),
        "Asset paths must be relative without traversal",
    );
    return value.replaceAll("\\", "/");
}

export function validateTerms(license, name = "license") {
    check(license?.reviewed === true, `${name}: terms review required`);
    text(license.id, `${name}.id`);
    text(license.terms, `${name}.terms`);
    check(
        license.underlying === undefined ||
            (Array.isArray(license.underlying) &&
                license.underlying.length > 0),
        `${name}: underlying terms must be a nonempty array`,
    );
    return {
        id: license.id,
        terms: license.terms,
        reviewed: true,
        ...(license.underlying === undefined
            ? {}
            : {
                  underlying: license.underlying.map((item) =>
                      validateTerms(item, `${name}.underlying`),
                  ),
              }),
    };
}

export function validatePreparationPlan(plan, dataset) {
    check(
        plan?.schemaVersion === 1 && plan.dataset === dataset,
        "Unknown preparation plan",
    );
    check(
        ["development", "confirmation-evaluator"].includes(plan.custody),
        "Explicit preparation custody required",
    );
    text(plan.release?.repository, "release.repository");
    check(
        /^[a-f0-9]{40}$/.test(plan.release.revision),
        "Pinned full repository revision required",
    );
    const files = unique(plan.release.files, "path", "release files");
    check(files.size > 0, "No pinned release files");
    const normalized = new Set();
    for (const file of files.values()) {
        const path = relativeAssetPath(file.path);
        check(
            !normalized.has(path.toLowerCase()),
            "Duplicate normalized asset path",
        );
        normalized.add(path.toLowerCase());
        hash(file.sha256, "release file hash");
    }
    validateTerms(plan.release.license);
    check(
        Array.isArray(plan.selection) && plan.selection.length > 0,
        "No selected records",
    );
    const ids = new Set();
    for (const selected of plan.selection) {
        check(
            selected &&
                typeof selected === "object" &&
                !Array.isArray(selected),
            "Selected record must be an object",
        );
        relativeAssetPath(selected.path);
        check(
            Number.isSafeInteger(selected.recordIndex) &&
                selected.recordIndex >= 0,
            "Invalid record index",
        );
        const key = `${relativeAssetPath(selected.path)}:${selected.recordIndex}`;
        check(!ids.has(key), "Duplicate selected record");
        ids.add(key);
        check(
            selected.split ===
                (plan.custody === "development"
                    ? "development"
                    : "confirmation"),
            "Preparation split/custody mismatch",
        );
    }
    return {
        repository: plan.release.repository,
        revision: plan.release.revision,
        files: plan.release.files.map((file) => ({
            path: relativeAssetPath(file.path),
            sha256: file.sha256,
        })),
        license: validateTerms(plan.release.license),
    };
}

export function decodeUtf8(bytes) {
    check(bytes instanceof Uint8Array, "Raw UTF-8 bytes required");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
    );
}

export function retainedText(value, name) {
    text(value, name);
    check(value.isWellFormed(), `${name}: unpaired UTF-16 surrogate`);
    return value;
}

export function pinnedAsset(assets, release, path) {
    check(Array.isArray(assets), "Asset array required");
    const normalized = relativeAssetPath(path);
    const pin = release.files.find((file) => file.path === normalized);
    check(pin, `Unpinned asset: ${normalized}`);
    const matches = assets.filter(
        (asset) => relativeAssetPath(asset.path) === normalized,
    );
    check(matches.length === 1, `Missing/duplicate asset: ${normalized}`);
    const bytes = matches[0].bytes;
    check(bytes instanceof Uint8Array, "Raw asset bytes required");
    check(
        sha256(bytes) === pin.sha256,
        `Raw asset hash mismatch: ${normalized}`,
    );
    return { path: normalized, bytes, sha256: pin.sha256 };
}

export function preparationPackets(dataset, release) {
    return {
        construction: {
            schemaVersion: 1,
            purpose: "construction-only",
            dataset,
            release,
            bundles: [],
        },
        evaluator: {
            schemaVersion: 1,
            purpose: "evaluator-only",
            dataset,
            release: clone(release),
            cases: [],
        },
        availability: [],
        manifest: {
            schemaVersion: 1,
            dataset,
            release: clone(release),
            cases: [],
        },
    };
}

export function finishPreparation(result, plan) {
    result.manifest.custody = plan.custody;
    result.manifest.planHash = identity(plan);
    result.manifest.constructionHash = identity(result.construction);
    result.manifest.evaluatorHash = identity(result.evaluator);
    result.manifest.availabilityHash = identity(result.availability);
    return result;
}

function webUrl(value) {
    try {
        const url = new URL(value);
        return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password
        );
    } catch {
        return false;
    }
}

function referenceResolver(plan, assets, release) {
    const schema = plan.referenceSchema;
    if (schema === undefined)
        return (ref) => ({
            status:
                ref === null || ref === undefined || ref === ""
                    ? "malformed-ref"
                    : "opaque-ref",
        });
    check(
        ["url-string-array", "id-string-array"].includes(schema.format),
        "Unsupported reference schema; provide pinned schema evidence",
    );
    check(
        schema.evidenceVerified === true,
        "Reference schema evidence verification required",
    );
    pinnedAsset(assets, release, schema.evidencePath);
    const evidencePin = release.files.find(
        (file) => file.path === relativeAssetPath(schema.evidencePath),
    );
    check(
        evidencePin.sha256 ===
            hash(schema.evidenceSha256, "schema evidence hash"),
        "Schema evidence pin mismatch",
    );
    if (schema.format === "id-string-array") {
        check(
            schema.idToUrl &&
                typeof schema.idToUrl === "object" &&
                !Array.isArray(schema.idToUrl),
            "Reference ID map required",
        );
    }
    return (ref) => {
        if (typeof ref !== "string" || !ref.trim())
            return { status: "malformed-ref" };
        const url =
            schema.format === "url-string-array"
                ? ref
                : Object.hasOwn(schema.idToUrl, ref)
                  ? schema.idToUrl[ref]
                  : undefined;
        if (url === undefined) return { status: "unresolved" };
        return webUrl(url)
            ? { status: "resolved", url }
            : { status: "malformed-ref" };
    };
}

function validateArticle(article) {
    check(
        article && typeof article === "object" && !Array.isArray(article),
        "Article must be an object",
    );
    retainedText(article?.title, "article title");
    check(webUrl(article.url), "Article URL required");
    check(typeof article.summary === "string", "Article summary required");
    check(Array.isArray(article.content), "Article sections required");
    for (const section of article.content) {
        check(
            section && typeof section === "object" && !Array.isArray(section),
            "Article section must be an object",
        );
        text(section.section_title, "section title");
        check(
            Array.isArray(section.section_content),
            "Section sentences required",
        );
        for (const sentence of section.section_content) {
            check(
                sentence &&
                    typeof sentence === "object" &&
                    !Array.isArray(sentence),
                "Reference sentence must be an object",
            );
            retainedText(sentence.sentence, "reference sentence");
        }
    }
}

function sourceInventory(plan, assets, release) {
    const rows = plan.sources ?? [];
    unique(rows, "id", "supporting sources");
    const urls = unique(rows, "url", "supporting source URLs");
    for (const row of rows) {
        check(webUrl(row.url), "Supporting source URL invalid");
        check(
            row.availability === "available" ||
                unavailableSourceStates.includes(row.availability),
            "Unknown source availability",
        );
        if (row.availability !== "available") {
            text(row.reason, "unavailable source reason");
            continue;
        }
        check(
            !plan.selection.some(
                (selected) =>
                    relativeAssetPath(selected.path) ===
                    relativeAssetPath(row.path),
            ),
            "Target reference article asset cannot be construction evidence",
        );
        text(row.version, "source version");
        retainedText(row.title, "source title");
        validateTerms(row.license, "source license");
        const asset = pinnedAsset(assets, release, row.path);
        check(
            asset.sha256 === hash(row.sha256, "source raw hash"),
            "Source pin mismatch",
        );
        retainedText(decodeUtf8(asset.bytes), "supporting source text");
        if (row.authoredAt !== undefined) {
            check(
                /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(
                    row.authoredAt,
                ) && Number.isFinite(Date.parse(row.authoredAt)),
                "Verified authoredAt must be an explicit timestamp",
            );
            pinnedAsset(assets, release, row.authoredAtEvidencePath);
        }
    }
    return urls;
}

function supportingSource(row, assets, release) {
    const asset = pinnedAsset(assets, release, row.path);
    const value = decodeUtf8(asset.bytes);
    return {
        id: row.id,
        version: row.version,
        title: row.title,
        text: value,
        sha256: sha256(Buffer.from(value, "utf8")),
        ...(row.authoredAt === undefined ? {} : { authoredAt: row.authoredAt }),
        provenance: {
            repository: release.repository,
            revision: release.revision,
            snapshots: [
                {
                    id: row.id,
                    url: row.url,
                    path: asset.path,
                    rawSha256: asset.sha256,
                    version: row.version,
                    license: validateTerms(row.license),
                    ...(row.authoredAt === undefined
                        ? {}
                        : {
                              authoredAt: row.authoredAt,
                              authoredAtEvidencePath: relativeAssetPath(
                                  row.authoredAtEvidencePath,
                              ),
                          }),
                },
            ],
            chronology:
                row.authoredAt === undefined
                    ? "unknown"
                    : "verified-source-metadata",
            temporalConfound:
                row.authoredAt === undefined ? "unknown" : "not-assessed",
        },
        coordinateMap: [
            {
                coordinate: { kind: "source", start: 0, end: value.length },
                retainedStart: 0,
                retainedEnd: value.length,
            },
        ],
    };
}

export function prepareFreshWiki(assets, plan) {
    const release = validatePreparationPlan(plan, "freshwiki");
    const result = preparationPackets("freshwiki", release);
    const resolve = referenceResolver(plan, assets, release);
    const inventory = sourceInventory(plan, assets, release);
    for (const selected of plan.selection) {
        const asset = pinnedAsset(assets, release, selected.path);
        check(
            selected.recordIndex === 0,
            "FreshWiki article asset has exactly one record",
        );
        const article = JSON.parse(
            decodeUtf8(asset.bytes).replace(/^\uFEFF/, ""),
        );
        validateArticle(article);
        const id = `freshwiki:${release.revision}:${asset.path}`;
        const bundle = {
            id,
            kind: "wiki",
            query: article.title,
            aliases: [],
            sources: [],
        };
        const byHash = new Map();
        const references = [];
        article.content.forEach((section, sectionIndex) => {
            section.section_content.forEach((sentence, sentenceIndex) => {
                const locator = { caseId: id, sectionIndex, sentenceIndex };
                if (
                    !Array.isArray(sentence.refs) ||
                    sentence.refs.length === 0
                ) {
                    result.availability.push({
                        ...locator,
                        status: Array.isArray(sentence.refs)
                            ? "empty-refs"
                            : "malformed-refs",
                    });
                    return;
                }
                sentence.refs.forEach((ref, referenceIndex) => {
                    const resolved = resolve(ref);
                    const row = resolved.url && inventory.get(resolved.url);
                    const status =
                        resolved.status !== "resolved"
                            ? resolved.status
                            : !row
                              ? "not-acquired"
                              : row.availability;
                    const available = { ...locator, referenceIndex, status };
                    references.push({
                        ...locator,
                        referenceIndex,
                        ref: clone(ref),
                    });
                    if (resolved.url) available.url = resolved.url;
                    if (row?.reason) available.reason = row.reason;
                    if (status === "available") {
                        check(
                            row.url !== article.url,
                            "Target reference article cannot be construction evidence",
                        );
                        const source = supportingSource(row, assets, release);
                        const existing = byHash.get(source.sha256);
                        if (existing) {
                            const snapshot = source.provenance.snapshots[0];
                            if (
                                !existing.provenance.snapshots.some(
                                    (item) => item.id === snapshot.id,
                                )
                            ) {
                                existing.provenance.snapshots.push(snapshot);
                            }
                            available.sourceId = existing.id;
                        } else {
                            byHash.set(source.sha256, source);
                            bundle.sources.push(source);
                            available.sourceId = source.id;
                        }
                    }
                    result.availability.push(available);
                });
            });
        });
        result.construction.bundles.push(bundle);
        result.evaluator.cases.push({
            id,
            reference: {
                title: article.title,
                url: article.url,
                summary: article.summary,
                content: clone(article.content),
            },
            references,
        });
        result.manifest.cases.push({
            id,
            split: selected.split,
            clusterId: id,
            path: asset.path,
            rawSha256: asset.sha256,
            availability: bundle.sources.length
                ? "available-evidence"
                : "no-available-evidence",
        });
    }
    return finishPreparation(result, plan);
}
