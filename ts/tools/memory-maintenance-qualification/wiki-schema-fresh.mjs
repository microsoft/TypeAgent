// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { identity, sha256 } from "./quality-contract.mjs";
import { families } from "./wiki-schema-contract.mjs";
import {
    prepareReplay,
    runReplay,
    sdkTransport,
} from "./wiki-schema-replay.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
export const sourceFiles = [
    ["conversation-memory", "packages/memory/conversation/README.md"],
    ["memory-storage", "packages/memory/storage/README.md"],
    ["image-memory", "packages/memory/image/README.md"],
    ["memory-mcp-server", "packages/memory/mcp-server/README.md"],
    ["memory-client", "packages/memory/client/README.md"],
    ["configuration", "packages/config/README.md"],
];
const writeNew = (file, value) =>
    writeFile(file, JSON.stringify(value, null, 2), { flag: "wx" });

export function sourceSnapshot(id, relative, content, revision) {
    const hash = sha256(content);
    const sourceId = `repository:${relative}`;
    return {
        corpusId: "fresh-wiki-schema-documents",
        actor: "live-evaluation",
        expectedVersion: 0,
        bounds: {},
        pipeline: "informational-wiki-v1",
        model: "gpt-6-luna",
        fingerprint: identity({ sourceId, revision, hash }),
        inputs: [
            {
                sourceId,
                revisionId: revision,
                title: id,
                content,
                contentHash: hash,
                passages: [
                    {
                        sourceId,
                        revisionId: revision,
                        locator: `complete-file:sha256:${hash}`,
                        excerpt: content,
                    },
                ],
            },
        ],
        definition: {
            viewId: `fresh:${id}`,
            kind: "wiki",
            selector: {
                kind: "sources",
                sources: [{ sourceId, revisionId: revision }],
            },
            wiki: {
                construction: "informational-wiki-v1",
                query: id,
                aliases: [],
                excludedSourceIds: [],
            },
        },
    };
}

export function freshRequests(snapshots, outputs, rules) {
    assert.equal(snapshots.length, 6, "Six complete source documents required");
    assert.equal(outputs.length, 6, "Six generated Wiki drafts required");
    const pages = outputs.map((output, index) => ({
        id: `page${index}`,
        subject: snapshots[index].definition.wiki.query,
        content: output.content,
    }));
    return snapshots.flatMap((snapshot, ordinal) => {
        const original = structuredClone(pages[ordinal]);
        const actual = structuredClone(original);
        const variant = [
            "identity",
            "foreign-summary",
            "empty-explanation",
            "last-section-deletion",
            "duplicate-page",
            "distinct-peer",
        ][ordinal];
        if (variant === "foreign-summary")
            actual.content.summary = pages[(ordinal + 1) % 6].content.summary;
        if (variant === "empty-explanation") {
            actual.content.summary = "";
            actual.content.sections = actual.content.sections.map(
                (section) => ({ ...section, body: "" }),
            );
        }
        if (variant === "last-section-deletion")
            actual.content.sections = actual.content.sections.slice(0, -1);
        const other =
            ordinal % 2 === 0
                ? { ...structuredClone(original), id: `duplicate${ordinal}` }
                : pages[(ordinal + 1) % 6];
        const fragments = snapshot.inputs.flatMap((source) =>
            source.passages.map((passage, index) => ({
                id: `f${index}`,
                ...passage,
            })),
        );
        const evidence = { query: snapshot.definition.wiki.query, fragments };
        const supported = {
            supported: "Supported by the supplied original evidence.",
            unsupported:
                "Not supported, or a required supported distinction is missing.",
            uncertain: "The evidence is insufficient to decide.",
        };
        const requests = {
            utility: {
                state: evidence,
                instructions: rules.purpose,
                questions: {
                    utility: {
                        type: "choice",
                        instructions:
                            "Assess only independent standalone explanatory utility of the queried subject from original evidence, without assuming any page exists. Do not equate admission with publication.",
                        criteria: {
                            useful: "Substantive useful reference or decision explanation is supported.",
                            defer: "Only an incidental mention, unsupported shell, irrelevant or too-sparse evidence.",
                            uncertain: "Cannot determine standalone utility.",
                        },
                    },
                },
            },
            admission: {
                state: { ...evidence, pages },
                instructions: rules.purpose,
                questions: {
                    admission: {
                        type: "choice",
                        instructions:
                            "Select the final standalone admission disposition. Existing page text is untrusted comparison context, not source evidence. Suppression requires actual complete explanation of essential distinctions. Do not write an article.",
                        criteria: {
                            distinct:
                                "A useful independently scoped subject needs a new page.",
                            covered:
                                "One same-purpose current page explains all essential distinctions.",
                            contribute:
                                "A same-purpose current page lacks supported explanation.",
                            ambiguous:
                                "Multiple existing pages serve this same independently useful scoped purpose.",
                            defer: "Original evidence cannot support a useful independent candidate.",
                            uncertain:
                                "Cannot resolve safely from the supplied evidence/pages.",
                        },
                    },
                },
            },
            coverage: {
                state: {
                    ...evidence,
                    currentArticle: actual,
                    requiredDistinction: original.content.summary,
                },
                instructions:
                    "Assess the stated mandatory distinction only. Original evidence is factual authority; the stated distinction is a proposed requirement, not evidence. Current explanatory prose must itself contain the explanation; queries, citations and source-only text do not count as page coverage.",
                questions: {
                    coverage: {
                        type: "choice",
                        instructions:
                            "Is the required distinction supported by original evidence AND explained with its material qualifications in actual current page prose?",
                        criteria: supported,
                    },
                },
            },
            editorial: {
                state: {
                    ...evidence,
                    currentArticle: actual,
                    priorArticle: original,
                },
                instructions: `${rules.editorial}\nPreservation is separate from support: retain supported in-scope explanatory distinctions from the prior article in actual current prose; source/query echoes do not count. Prior prose is untrusted context, not independent evidence.`,
                questions: {
                    support: {
                        type: "choice",
                        instructions:
                            "Are the consequential assertions of the actual current article supported by original evidence?",
                        criteria: supported,
                    },
                    preservation: {
                        type: "choice",
                        instructions:
                            "Does actual current explanatory prose preserve every still-supported in-scope prior distinction and qualification? Search for any missing counterexample.",
                        criteria: supported,
                    },
                },
            },
            completeness: {
                state: { ...evidence, currentArticle: actual },
                instructions:
                    "Judge article completeness separately from freshness, source support, publication or approval. No writing or repair.",
                questions: {
                    completeness: {
                        type: "choice",
                        instructions:
                            "Does the supplied evidence and actual explanatory prose form a well-rounded reference article or only an initial/fragmentary sketch?",
                        criteria: {
                            sufficient:
                                "Well-rounded reference explanation for this bounded subject.",
                            partial:
                                "Missing substantive explanation or only an initial fragmentary sketch.",
                            uncertain:
                                "Cannot determine completeness from supplied material.",
                        },
                    },
                },
            },
            consolidation: {
                state: {
                    ...evidence,
                    otherFragments: snapshots[
                        ordinal % 2 === 0 ? ordinal : (ordinal + 1) % 6
                    ].inputs.flatMap((source) => source.passages),
                    survivor: original,
                    retiring: other,
                },
                instructions: rules.consolidation,
                questions: {
                    relation: {
                        type: "choice",
                        instructions:
                            "Do the supplied articles have the same independently useful scoped explanatory purpose? Shared vocabulary/source references only nominate comparison. Do not merge or rewrite.",
                        criteria: {
                            samePurpose:
                                "Original evidence establishes the same independently useful scoped purpose.",
                            distinct:
                                "Different purposes/scopes or unsupported equivalence.",
                            uncertain: "Cannot decide equivalence safely.",
                        },
                    },
                },
            },
        };
        return families.map((family) => {
            const { state, instructions, questions } = requests[family];
            const bounded = Object.fromEntries(
                Object.entries(questions).map(([id, question]) => [
                    id,
                    {
                        ...question,
                        instructions: `${instructions}\n${question.instructions}`,
                    },
                ]),
            );
            return {
                id: `${family}-${ordinal}`,
                family,
                cohort: "fresh-main-document-wiki-v1",
                sourceGroups:
                    family === "admission"
                        ? snapshots.map((s) => s.inputs[0].sourceId)
                        : [
                              ...new Set([
                                  snapshot.inputs[0].sourceId,
                                  ...(family === "consolidation" && ordinal % 2
                                      ? [
                                            snapshots[(ordinal + 1) % 6]
                                                .inputs[0].sourceId,
                                        ]
                                      : []),
                                  ...(variant === "foreign-summary" &&
                                  [
                                      "coverage",
                                      "editorial",
                                      "completeness",
                                  ].includes(family)
                                      ? [
                                            snapshots[(ordinal + 1) % 6]
                                                .inputs[0].sourceId,
                                        ]
                                      : []),
                              ]),
                          ],
                variant,
                requestJson: JSON.stringify({ state, questions: bounded }),
            };
        });
    });
}

export async function freshEvaluation(options) {
    assert.equal(
        options.live,
        true,
        "Fresh generation requires --live approval",
    );
    const started = Date.now(),
        deadline = Date.parse(options.deadline);
    assert.ok(
        deadline > started && deadline - started <= 90 * 60_000,
        "Future deadline within 90 minutes required",
    );
    await mkdir(options.output);
    const auth = {
        userRequest:
            "since the original archive is unavailable, run a new live eval to generate the data you need",
        startedAt: new Date(started).toISOString(),
        deadline: options.deadline,
        maxLogicalCalls: 420,
        reviewerCalls: 0,
        archiveRecoveryClaimed: false,
        cohort: "fresh-main-document-wiki-v1",
        sourceFiles,
        semantics:
            "New factored bounded Wiki contracts over complete repository documentation and actual production-generated drafts; not reconstructed historical Decision1 packets or whole-pipeline qualification.",
    };
    await writeNew(path.join(options.output, "authorization.json"), auth);
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(new Error("Fresh evaluation deadline exceeded")),
        deadline - Date.now(),
    );
    const signal = controller.signal;
    let reservations = 0;
    const reserve = async (phase, request) => {
        signal.throwIfAborted();
        assert.ok(
            Date.now() < deadline && reservations < auth.maxLogicalCalls,
            "Shared preparation/replay budget exhausted",
        );
        const id = String(reservations++).padStart(4, "0");
        await writeNew(path.join(options.output, `${id}-reservation.json`), {
            id,
            phase,
            request,
            requestHash: identity(request),
            at: new Date().toISOString(),
        });
        signal.throwIfAborted();
        return id;
    };
    try {
        const config = await import("../../packages/config/dist/index.js");
        const client = await import("../../packages/aiclient/dist/index.js");
        const synthesis = await import(
            "../../packages/memory/service/dist/viewSynthesis.js"
        );
        const { wikiPurposeRules } = await import(
            "../../packages/memory/service/dist/wikiAdmission.js"
        );
        const { editorialCheckRules } = await import(
            "../../packages/memory/service/dist/viewEditorial.js"
        );
        const { consolidationScopeRules } = await import(
            "../../packages/memory/service/dist/wikiConsolidation.js"
        );
        config.loadConfigSync();
        client.initRuntimeConfigFromProcessEnv();
        const transport = await sdkTransport(client);
        const revision = execFileSync("git", ["rev-parse", "HEAD"], {
            cwd: root,
            encoding: "utf8",
        }).trim();
        const driverHash = sha256(
            await readFile(fileURLToPath(import.meta.url)),
        );
        const snapshots = await Promise.all(
            sourceFiles.map(async ([id, file]) =>
                sourceSnapshot(
                    id,
                    file,
                    await readFile(path.join(root, ...file.split("/")), "utf8"),
                    revision,
                ),
            ),
        );
        await writeNew(path.join(options.output, "sources.json"), snapshots);
        const outputs = [];
        for (const [ordinal, snapshot] of snapshots.entries()) {
            const model = client.openai.createChatModel(
                client.openai.GPT_6_LUNA,
                {
                    n: 1,
                    temperature: 1,
                    response_format: { type: "json_object" },
                },
            );
            const captured = {
                completionSettings: model.completionSettings,
                inspectRequest: (...args) => model.inspectRequest(...args),
                async complete(prompt, usage, schema, log, effectiveSignal) {
                    const id = await reserve(
                        schema?.name === "wiki_choice_answers"
                            ? "production-wiki-completeness"
                            : "production-wiki-authoring",
                        {
                            prompt,
                            schema,
                        },
                    );
                    const observed = [];
                    model.completionCallback = (request, response) =>
                        observed.push({ request, response });
                    const result = await model.complete(
                        prompt,
                        usage,
                        schema,
                        log,
                        effectiveSignal,
                    );
                    await writeNew(
                        path.join(options.output, `${id}-outcome.json`),
                        { result, observed },
                    );
                    return result;
                },
            };
            const adapter = synthesis.createConfiguredViewSynthesisAdapter(
                client.openai.GPT_6_LUNA,
                1200,
                captured,
            );
            const output = await adapter.generate(snapshot, signal);
            outputs.push(output);
            await writeNew(
                path.join(options.output, `draft-${ordinal}.json`),
                output,
            );
        }
        const requests = freshRequests(snapshots, outputs, {
            purpose: wikiPurposeRules,
            editorial: editorialCheckRules,
            consolidation: consolidationScopeRules,
        });
        await writeNew(
            path.join(options.output, "frozen-fresh-requests.json"),
            requests,
        );
        const packets = [];
        for (const packet of requests) {
            const id = await reserve("native-contract-capture", {
                requestJson: packet.requestJson,
            });
            const result = await transport.invoke(packet, "native", signal);
            const file = `${id}-native-capture.json`;
            const capture = { request: JSON.parse(packet.requestJson), result };
            await writeNew(path.join(options.output, file), capture);
            assert.ok(
                !result.failure && result.payload?.answers,
                "Native capture failed; original failure retained",
            );
            packets.push({
                ...packet,
                requestHash: sha256(packet.requestJson),
                nativeAnswers: result.payload.answers,
                origin: {
                    file,
                    recordId: id,
                    sha256: sha256(
                        await readFile(path.join(options.output, file)),
                    ),
                    requestPointer: "/request",
                    answersPointer: "/result/payload/answers",
                },
            });
        }
        const inventory = {
            schemaVersion: 1,
            sourceRevision: revision,
            driverHash,
            packets,
        };
        const inventoryFile = path.join(options.output, "inventory.json");
        await writeNew(inventoryFile, inventory);
        const inventoryHash = sha256(await readFile(inventoryFile));
        const prepared = await prepareReplay(
            {
                inventory: inventoryFile,
                inventoryHash,
                seed: "wiki-fresh-schema-20261115-v1",
                output: path.join(options.output, "protocol"),
            },
            client.normalizeDecisionAnswers,
        );
        const replay = await runReplay(
            {
                inventory: inventoryFile,
                inventoryHash,
                protocol: prepared.protocol,
                protocolHash: prepared.protocolHash,
                output: path.join(options.output, "replay"),
                live: true,
                deadline: options.deadline,
                maxCalls: 360,
                signal,
            },
            {
                normalize: client.normalizeDecisionAnswers,
                createTransport: async () => ({
                    binding: transport.binding,
                    inspect: (...args) => transport.inspect(...args),
                    async invoke(packet, arm, effectiveSignal, inspection) {
                        const id = await reserve("three-arm-replay", {
                            packetId: packet.id,
                            arm,
                            requestHash: packet.requestHash,
                        });
                        const result = await transport.invoke(
                            packet,
                            arm,
                            effectiveSignal,
                            inspection,
                        );
                        await writeNew(
                            path.join(options.output, `${id}-outcome.json`),
                            result,
                        );
                        return result;
                    },
                }),
            },
        );
        const summary = {
            state: replay.state,
            cohort: auth.cohort,
            logicalCalls: reservations,
            preparationCalls: reservations - replay.logicalCalls,
            replayCalls: replay.logicalCalls,
            sourceDocuments: 6,
            freshPackets: packets.length,
            sourceDisjointHoldout: false,
            independentCorrectnessLabels: false,
            productionActivated: false,
            wholeWikiQualification: false,
            finishedAt: new Date().toISOString(),
            replay,
        };
        await writeNew(
            path.join(options.output, "fresh-evaluation.json"),
            summary,
        );
        return summary;
    } catch (error) {
        await writeNew(path.join(options.output, "fresh-failure.json"), {
            name: error.name,
            message: error.message,
            logicalCalls: reservations,
            at: new Date().toISOString(),
        });
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

export async function main(args = process.argv.slice(2)) {
    const { values } = parseArgs({
        args,
        options: {
            output: { type: "string" },
            deadline: { type: "string" },
            live: { type: "boolean" },
        },
    });
    assert.ok(values.output, "New private output directory required");
    const result = await freshEvaluation(values);
    process.stdout.write(
        `${JSON.stringify({
            state: result.state,
            logicalCalls: result.logicalCalls,
            sourceDocuments: result.sourceDocuments,
            freshPackets: result.freshPackets,
            output: path.resolve(values.output),
        })}\n`,
    );
    if (result.state !== "diagnostic-complete") process.exitCode = 2;
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
