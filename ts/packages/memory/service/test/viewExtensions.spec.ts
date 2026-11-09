// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FileMemoryService } from "../src/fileMemoryService.js";
import { waitForMemoryJob } from "../src/rpcFacade.js";
import { FakeSemanticCorpusIndex } from "./fakeSemanticCorpusIndex.js";
import {
    extensionViewId,
    ViewExtensionRegistry,
    ViewExtensionDeferred,
    validateExtensionContent,
} from "../src/viewExtensions.js";
import { viewHash } from "../src/viewContent.js";
import { createExtensionExecution } from "../src/viewExtensionExecution.js";
import { validateViewDraft } from "../src/viewValidation.js";
import { viewDocumentSectionRoles } from "../src/viewTypes.js";
import type {
    ViewExtensionProvider,
    ViewPayloadSchema,
    ExtensionViewContent,
} from "../src/viewExtensionTypes.js";
import type {
    ViewBuildJob,
    ViewBuildRequest,
    ViewBuildSnapshot,
    ViewBuildTargetResult,
    ViewRelationship,
    ViewSaveRequest,
} from "../src/viewTypes.js";
import type {
    ChatModel,
    DecisionModel,
    RequestBudgetLimits,
} from "@typeagent/aiclient";
import { fetchWithRetry } from "@typeagent/aiclient";
import type { FileMemoryServiceOptions } from "../src/fileMemoryService.js";
import type {
    IndexedFragmentRequest,
    IndexedFragmentSelection,
} from "../src/types.js";

const requestBudget: RequestBudgetLimits = {
    tokenizer: "offline-char-bound",
    countTokens: (text) => text.length,
    inputTokens: 100000,
    outputTokens: 2048,
    safetyTokens: 64,
    contextTokens: 120000,
    reservedTokens: 1000000,
    chatAttempts: 6,
    embeddingAttempts: 1,
    elapsedMs: 30000,
};

class ExtensionQueryIndex extends FakeSemanticCorpusIndex {
    async readFragments(
        input: IndexedFragmentRequest,
    ): Promise<IndexedFragmentSelection> {
        const fragments = this.documents
            .filter(
                (document) =>
                    input.sourceIds.includes(document.source.sourceId) &&
                    input.terms.some((term) =>
                        document.content
                            .toLowerCase()
                            .includes(term.toLowerCase()),
                    ),
            )
            .slice(0, input.maxFragments ?? 12)
            .map((document) => ({
                sourceId: document.source.sourceId,
                revisionId: document.revision.revisionId,
                locator: `chars:0-${document.content.length}`,
                snippet: document.content,
                score: 1,
            }));
        return {
            fragments,
            readChars: fragments.reduce(
                (sum, fragment) => sum + fragment.snippet.length,
                0,
            ),
            limited: false,
        };
    }
}

function readerModel(understanding = false, onRead?: () => void): ChatModel {
    return {
        completionSettings: {},
        async complete(prompt) {
            const body =
                typeof prompt === "string"
                    ? prompt
                    : prompt.find((section) => section.role === "user")!
                          .content;
            if (typeof body !== "string")
                throw new Error("Expected serialized offline reader evidence");
            const envelope = JSON.parse(body);
            const view = envelope.evidence.find(
                (item: { kind: string }) => item.kind === "derived",
            );
            if (!view)
                throw new Error(
                    "Ordinary reader did not receive extension evidence",
                );
            const evidenceIds = [
                view.id,
                ...view.supportingEvidenceIds,
                ...view.opposingEvidenceIds,
            ];
            expect(view.requiredEvidenceIds).toEqual(evidenceIds);
            onRead?.();
            return {
                success: true,
                data: JSON.stringify(
                    understanding || "candidates" in envelope
                        ? {
                              schemaVersion: 1,
                              status: "answered",
                              title: "Copper lantern status",
                              summary: {
                                  text: "Copper lantern is marked complete, but independent verification is not established.",
                                  evidenceIds,
                                  role: "memory",
                              },
                              sections: [],
                              unknowns: [
                                  "Independent verification is not established.",
                              ],
                              followUps: [],
                              moduleSignals: [],
                              retrievalQueries: [],
                          }
                        : {
                              status: "answered",
                              answer: "Copper lantern is marked complete, but independent verification is not established.",
                              evidenceIds,
                              retrievalQueries: [],
                          },
                ),
            };
        },
    };
}

function budgetedCompletionModel(): ChatModel {
    return {
        completionSettings: {},
        async complete(prompt) {
            const response = await fetchWithRetry(
                "https://synthetic.invalid/derived",
                {
                    method: "POST",
                    body: JSON.stringify({
                        messages: [{ role: "user", content: prompt }],
                        max_tokens: 16,
                    }),
                },
                0,
            );
            if (!response.success) throw new Error(response.message);
            return {
                success: true,
                data: JSON.stringify({ items: ["retained candidate"] }),
            };
        },
    };
}

function opposingProvider() {
    const fixture = provider();
    const generate = fixture.installed.generate;
    fixture.installed.generate = async (...args) => {
        const content = await generate(...args);
        const source = args[0].inputs[1];
        const opposition = {
            sourceId: source.sourceId,
            revisionId: source.revisionId,
            locator: `chars:0-${source.content.length}`,
            excerpt: source.content,
        };
        content.citations.push(opposition);
        content.evidence[0].opposition.push(opposition);
        content.inputUse[1].disposition = "represented";
        content.inputUse[1].reason = "Original opposing qualification";
        content.fidelity.relationships.push({
            edgeId: "claim.opposition.0",
            supported: true,
            reason: "Offline exact opposing source",
        });
        content.presentation.layouts = [
            "story",
            "roles",
            "brief",
            "sources",
        ].map((id) => ({
            id,
            label: id,
            groups: [{ id: `${id}-group`, label: id, blockIds: ["claim"] }],
        }));
        return content;
    };
    return fixture;
}

const outputSchema: ViewPayloadSchema = {
    type: "object",
    properties: {
        items: {
            type: "array",
            items: { type: "string", maxLength: 200 },
            maxItems: 4,
        },
    },
    required: ["items"],
};

function provider(
    disposition: "eligible" | "ineligible" | "deferred" = "eligible",
) {
    let constructionCalls = 0;
    let authorized = true;
    const installed: ViewExtensionProvider = {
        descriptor: {
            apiVersion: 1,
            label: "Synthetic status recap",
            identity: {
                providerId: "synthetic-recap",
                version: "1",
                implementationDigest: viewHash("synthetic implementation"),
                inputContract: "synthetic-input-v1",
                outputContract: "synthetic-output-v1",
                schemaDigest: viewHash(outputSchema),
                recipeDigest: viewHash("synthetic recipe"),
            },
            outputSchema,
            definitions: [
                { id: "recap", eligibilityVersion: "1", mode: "static" },
            ],
            limits: {
                maxSources: 64,
                maxInputChars: 240000,
                maxOutputChars: 120000,
                maxModelCalls: 6,
                timeoutMs: 30000,
            },
        },
        authorize: async () => authorized,
        evaluateEligibility: async () => ({
            disposition,
            reason: `Synthetic ${disposition} source group`,
        }),
        prepare: async () => ({ items: ["prepared"] }),
        generate: async (input) => {
            constructionCalls++;
            const source = input.inputs[0];
            const citation = {
                sourceId: source.sourceId,
                revisionId: source.revisionId,
                locator: `chars:0-${source.content.length}`,
                excerpt: source.content,
            };
            return {
                kind: "extension",
                construction: "extension-v1",
                provider: installed.descriptor.identity,
                title: "Synthetic recap",
                sections: [
                    {
                        id: "claim",
                        role: "context",
                        heading: "Status",
                        body: "Copper lantern completed under stated limits.",
                    },
                ],
                citations: [citation],
                evidence: [
                    { blockId: "claim", support: [citation], opposition: [] },
                ],
                payload: { items: ["Copper lantern"] },
                presentation: {
                    schemaVersion: 1,
                    templateId: "document-v1",
                    templateVersion: 1,
                    layouts: [
                        {
                            id: "story",
                            label: "Story",
                            groups: [
                                {
                                    id: "recap",
                                    label: "Recap",
                                    blockIds: ["claim"],
                                },
                            ],
                        },
                    ],
                },
                inputUse: input.inputs.map((source, index) => ({
                    sourceId: source.sourceId,
                    revisionId: source.revisionId,
                    disposition: index === 0 ? "represented" : "unused",
                    reason:
                        index === 0
                            ? "Claim support"
                            : "Retained complete group context",
                })),
                fidelity: {
                    supported: true,
                    sections: [
                        {
                            sectionId: "claim",
                            supported: true,
                            reason: "Synthetic assessment",
                        },
                    ],
                    relationships: [
                        {
                            edgeId: "claim.support.0",
                            supported: true,
                            reason: "Synthetic assessment",
                        },
                    ],
                    missingContext: [],
                    reasons: [],
                },
            };
        },
    };
    return {
        installed,
        calls: () => constructionCalls,
        revoke: () => {
            authorized = false;
        },
    };
}

async function settled(
    service: FileMemoryService,
    job: ViewBuildJob,
): Promise<ViewBuildJob> {
    for (let attempt = 0; attempt < 2000; attempt++) {
        const current = await service.getViewBuild({
            corpusId: job.corpusId,
            jobId: job.jobId,
        });
        if (!current) throw new Error("Build disappeared");
        if (current.state !== "running") return current;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error("Synthetic provider build did not settle");
}

test("procedure presentation preserves all claims and rejects hidden evidence or missing agent data", async () => {
    const fixture = provider();
    const input: ViewBuildSnapshot = {
        corpusId: "fixture",
        actor: "test",
        expectedVersion: 0,
        bounds: {},
        pipeline: "extension-v1",
        model: "test",
        fingerprint: viewHash("fixture"),
        definition: {
            viewId: "test-view",
            kind: "extension",
            selector: {
                kind: "sources",
                sources: [{ sourceId: "source", revisionId: "revision" }],
            },
        },
        inputs: [
            {
                sourceId: "source",
                revisionId: "revision",
                title: "Source",
                content: "Retained source",
                contentHash: viewHash("Retained source"),
            },
        ],
    };
    const content = await fixture.installed.generate(
        input,
        {},
        {
            signal: AbortSignal.timeout(1000),
            deadline: Date.now() + 1000,
            checkpoint: async () => {},
            complete: async () => {
                throw new Error("No model expected");
            },
        },
    );
    content.payload = { agentRepresentation: { actions: [] } };
    content.presentation.templateId = "procedure-guide-v1";
    const groups = [
        "overview",
        "options",
        "rules",
        "outcomes",
        "gaps",
        "technical",
    ].map((id) => ({
        id,
        label: id,
        blockIds: id === "options" ? ["claim"] : [],
    }));
    content.presentation.layouts = ["guide", "agent", "evidence"].map((id) => ({
        id,
        label: id,
        groups: structuredClone(groups),
    }));
    expect(() => validateExtensionContent(input, content)).not.toThrow();
    const hidden = structuredClone(content);
    hidden.presentation.layouts[2].groups.find(
        ({ id }) => id === "options",
    )!.blockIds = [];
    expect(() => validateExtensionContent(input, hidden)).toThrow(
        "every evidence-bound claim",
    );
    const duplicated = structuredClone(content);
    duplicated.presentation.layouts[0].groups[0].blockIds.push("claim");
    expect(() => validateExtensionContent(input, duplicated)).toThrow(
        "every evidence-bound claim",
    );
    content.payload = { agentRepresentation: null };
    expect(() => validateExtensionContent(input, content)).toThrow(
        "agent representation",
    );
});

describe("registered extension service lifecycle", () => {
    let root: string;
    let service: FileMemoryService;

    afterEach(async () => {
        await service?.close();
        if (root) await rm(root, { recursive: true, force: true });
    });

    test("managed content validators run before acceptance and on exact cold reads without regeneration", async () => {
        const fixture = provider();
        let validations = 0;
        let accepted = true;
        fixture.installed.validateContent = async (input, content) => {
            validations++;
            expect(input.inputs[0].content).toContain("Retained");
            expect(content.payload).toEqual({ items: ["Copper lantern"] });
            if (!accepted)
                throw new Error("Independent artifact validation failed");
        };
        const { corpus, request, options } = await setup(fixture.installed);
        const job = await settled(service, await service.buildViews(request));
        expect(job.state).toBe("complete");
        const read = {
            corpusId: corpus.corpusId,
            viewId: request.targets[0].definition.viewId,
            includeContext: false,
        };
        expect(await service.getView(read)).toBeDefined();
        await service.close();
        service = new FileMemoryService(root, options);
        expect(await service.getView(read)).toBeDefined();
        expect(validations).toBeGreaterThanOrEqual(3);
        accepted = false;
        await expect(service.getView(read)).rejects.toThrow(
            "Independent artifact validation failed",
        );
        expect(fixture.calls()).toBe(1);
    });

    test("identified model changes during construction cannot accept a stale candidate", async () => {
        const fixture = provider();
        fixture.installed.descriptor.modelIdentity = "synthetic-model-v1";
        const generate = fixture.installed.generate;
        fixture.installed.generate = async (...args) => {
            const content = await generate(...args);
            fixture.installed.descriptor.modelIdentity = "synthetic-model-v2";
            return content;
        };
        const { corpus, request } = await setup(fixture.installed);
        const job = await settled(service, await service.buildViews(request));
        expect(job.state).toBe("failed");
        expect(job.results[0].snapshot.model).toMatch(/^[a-f0-9]{64}$/);
        expect(job.results[0].reason).toMatch(/changed/);
        expect((await service.listViews(corpus.corpusId)).views).toHaveLength(
            0,
        );
    });

    test.each([false, true])(
        "nonaccepted construction retains its candidate without materializing a draft (deferred=%s)",
        async (deferred) => {
            const fixture = provider();
            fixture.installed.generate = async (_input, _prepared, context) => {
                await context.recordCandidate!("full.explanation", {
                    accepted: false,
                    statement: "Unverified synthetic claim",
                });
                await context.checkpoint("full.review", { accepted: false });
                throw deferred
                    ? new ViewExtensionDeferred("Independent review deferred")
                    : new Error(
                          "Independent full review rejected the candidate",
                      );
            };
            const { corpus, request } = await setup(fixture.installed);
            const job = await settled(
                service,
                await service.buildViews(request),
            );
            expect(job.state).toBe("failed");
            expect(job.results[0].state).toBe(deferred ? "blocked" : "failed");
            expect(job.publication).toBe(false);
            expect(job.request.publication).toBe(false);
            expect(job.results[0].providerCandidates).toMatchObject([
                { stage: "full.explanation", value: { accepted: false } },
            ]);
            expect(job.results[0].providerCheckpoints).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        stage: "full.review",
                        state: { accepted: false },
                    }),
                ]),
            );
            expect(
                (await service.listViews(corpus.corpusId)).views,
            ).toHaveLength(0);
        },
    );

    test("legacy managed-provider records require an explicit rebuild instead of reinterpretation", async () => {
        const fixture = provider();
        const { corpus, request } = await setup(fixture.installed);
        const job = await settled(service, await service.buildViews(request));
        const registry = new ViewExtensionRegistry([fixture.installed]);
        const legacy = structuredClone(job.results[0].snapshot);
        Object.assign(legacy, { pipeline: "host-defined-v1" });
        expect(() => registry.resolve(legacy)).toThrow(
            /Legacy.*explicit rebuild/,
        );
        const view = await service.getView({
            corpusId: corpus.corpusId,
            viewId: request.targets[0].definition.viewId,
        });
        const content = Object.assign({}, view!.content, {
            construction: "legacy",
        }) as unknown as ExtensionViewContent;
        await expect(
            registry.validateContent(job.results[0].snapshot, content),
        ).rejects.toThrow(/Legacy.*explicit rebuild/);
        expect(fixture.calls()).toBe(1);
    });

    test("queued model dispatch rechecks eligibility and retains a failed attempt without inference", async () => {
        const fixture = provider();
        const { request } = await setup(fixture.installed);
        const job = await settled(service, await service.buildViews(request));
        const result: ViewBuildTargetResult = {
            viewId: job.results[0].viewId,
            snapshot: structuredClone(job.results[0].snapshot),
            state: "pending",
            reason: "Synthetic queued admission",
        };
        let eligible = true;
        let calls = 0;
        fixture.installed.model = {
            completionSettings: {},
            async complete() {
                calls++;
                return { success: true, data: "Must not run" };
            },
        };
        const context = await createExtensionExecution({
            input: result.snapshot,
            result,
            provider: fixture.installed,
            registry: new ViewExtensionRegistry([fixture.installed]),
            signal: new AbortController().signal,
            requestBudget,
            models: async (call) => {
                eligible = false;
                return call();
            },
            update: async (operation) => {
                operation(result);
            },
            errorText: String,
            assertEligible: async () => {
                if (!eligible) throw new Error("Queued source grant revoked");
            },
        });
        await expect(
            context.complete("explanation", "Retained original"),
        ).rejects.toThrow("Queued source grant revoked");
        expect(calls).toBe(0);
        expect(result.providerAttempts).toMatchObject([
            { stage: "explanation", state: "failed" },
        ]);
    });

    test("provider registration rejects remote schema references", () => {
        const fixture = provider();
        const remoteSchema = {
            ...outputSchema,
            $ref: "https://example.invalid/schema",
        };
        fixture.installed.descriptor.outputSchema = remoteSchema;
        fixture.installed.descriptor.identity.schemaDigest =
            viewHash(remoteSchema);
        expect(() => new ViewExtensionRegistry([fixture.installed])).toThrow(
            /remote reference/,
        );
        expect(fixture.calls()).toBe(0);
    });

    test("complete-source registration retains a finite opt-in ceiling", () => {
        const fixture = provider();
        fixture.installed.descriptor.limits.maxInputChars = 8_000_000;
        expect(
            () => new ViewExtensionRegistry([fixture.installed]),
        ).not.toThrow();
        fixture.installed.descriptor.limits.maxInputChars = 8_000_001;
        expect(() => new ViewExtensionRegistry([fixture.installed])).toThrow(
            /provider input bound/,
        );
        expect(fixture.calls()).toBe(0);
    });

    test.each([4_000_000, 8_000_000])(
        "complete source proof remains untruncated under the declared %i-character bound",
        async (bound) => {
            const fixture = provider();
            fixture.installed.descriptor.limits.maxInputChars = bound;
            let preparedChars = 0;
            fixture.installed.prepare = async (snapshot) => {
                preparedChars = snapshot.inputs[0].content.length;
                expect(viewHash(snapshot.inputs[0].content)).toBe(
                    viewHash(text),
                );
                return { items: ["prepared"] };
            };
            const generate = fixture.installed.generate;
            fixture.installed.generate = async (...args) => {
                const content = await generate(...args);
                const original = content.citations[0];
                const citation = {
                    ...original,
                    locator: "chars:0-9",
                    excerpt: args[0].inputs[0].content.slice(0, 9),
                };
                content.citations = [citation];
                content.evidence[0].support = [citation];
                return content;
            };
            const text = "x".repeat(4_000_001);
            let approved = true;
            const { corpus, request } = await setup(
                fixture.installed,
                1,
                {
                    sourceAuthorization: async () => approved,
                },
                [text],
            );
            if (bound < text.length) {
                await expect(service.buildViews(request)).rejects.toThrow(
                    /Complete extension input exceeds provider bounds/,
                );
                expect(preparedChars).toBe(0);
                expect(fixture.calls()).toBe(0);
            } else {
                const job = await settled(
                    service,
                    await service.buildViews(request),
                );
                expect(job.state).toBe("complete");
                expect(preparedChars).toBe(text.length);
                expect(fixture.calls()).toBe(1);
                const target = {
                    corpusId: corpus.corpusId,
                    viewId: request.targets[0].definition.viewId,
                };
                const full = await service.getView(target);
                const first = await service.getViewDetailPage(target);
                expect(first).toBeDefined();
                if (!first) throw new Error("Missing first detail page");
                const parts = [first.text];
                let page = first;
                while (page.nextOffset !== undefined) {
                    const next = await service.getViewDetailPage({
                        ...target,
                        revisionId: first.revisionId,
                        digest: first.digest,
                        offset: page.nextOffset,
                    });
                    if (!next) throw new Error("Missing continuation");
                    expect(next.text.length).toBeLessThanOrEqual(256 * 1024);
                    parts.push(next.text);
                    page = next;
                }
                expect(JSON.parse(parts.join(""))).toEqual(full);
                expect(parts.length).toBeGreaterThan(1);
                const presentation = await service.getViewDetailPage({
                    ...target,
                    projection: "presentation",
                });
                if (!presentation)
                    throw new Error("Missing presentation detail");
                expect(presentation.nextOffset).toBeUndefined();
                const rendered = JSON.parse(presentation.text);
                expect(rendered.content).toEqual(full?.content);
                expect(rendered.relationships).toEqual(full?.relationships);
                expect(rendered.generation.input).toBeUndefined();
                expect(await service.getView(target)).toEqual(full);
                approved = false;
                await expect(
                    service.getViewDetailPage({
                        ...target,
                        revisionId: first.revisionId,
                        digest: first.digest,
                        offset: first.nextOffset,
                    }),
                ).resolves.toBeUndefined();
            }
            approved = true;
            const source = request.targets[0].definition.selector.sources[0];
            const retained = await service.getSource(
                corpus.corpusId,
                source.sourceId,
            );
            expect(
                retained?.revisions.find(
                    (revision) => revision.revisionId === source.revisionId,
                )?.contentHash,
            ).toBe(createHash("sha256").update(text).digest("hex"));
        },
    );

    test("static qualification cannot spend model calls and leaves a failed receipt", async () => {
        const fixture = provider();
        fixture.installed.evaluateEligibility = async (_input, context) => {
            await context.complete("classify", "This must not execute");
            return { disposition: "eligible", reason: "Must not qualify" };
        };
        const { corpus, request } = await setup(fixture.installed);
        const job = await settled(service, await service.buildViews(request));
        expect(job.state).toBe("failed");
        expect(job.results[0].eligibility?.disposition).toBe("failed");
        expect(job.results[0].providerAttempts).toBeUndefined();
        expect(fixture.calls()).toBe(0);
        expect((await service.listViews(corpus.corpusId)).views).toHaveLength(
            0,
        );
    });

    test.each([false, true])(
        "same-source field citations retain exact bindings and strict coalesced fidelity acceptance (stale receipt=%s)",
        async (staleReceipt) => {
            const fixture = provider();
            const generate = fixture.installed.generate;
            let generated: ExtensionViewContent | undefined;
            const edgeIds = [
                "claim.support.0",
                "claim.support.2",
                "claim.opposition.0",
                "claim.opposition.1",
                "history.support.0",
            ];
            fixture.installed.generate = async (...args) => {
                const content = await generate(...args);
                const [source, other] = args[0].inputs;
                const fields = [
                    [0, 9],
                    [10, 15],
                    [16, 24],
                    [25, 35],
                    [36, 47],
                ].map(([start, end]) => ({
                    sourceId: source.sourceId,
                    revisionId: source.revisionId,
                    locator: `chars:${start}-${end}`,
                    excerpt: source.content.slice(start, end),
                }));
                const otherCitation = {
                    sourceId: other.sourceId,
                    revisionId: other.revisionId,
                    locator: `chars:0-${other.content.length}`,
                    excerpt: other.content,
                };
                content.citations = [...fields, otherCitation];
                content.evidence[0].support = [
                    fields[0],
                    fields[1],
                    otherCitation,
                    ...fields.slice(2),
                ];
                content.evidence[0].opposition = [
                    fields[3],
                    otherCitation,
                    fields[4],
                ];
                content.sections.push({
                    id: "history",
                    role: "context",
                    heading: "Hypothesis history",
                    body: "Statement, scope, next test, assessment and uncertainty remain qualified.",
                });
                content.evidence.push({
                    blockId: "history",
                    support: [fields[0]],
                    opposition: [],
                });
                content.presentation.layouts[0].groups[0].blockIds.push(
                    "history",
                );
                content.inputUse[1].disposition = "represented";
                content.inputUse[1].reason = "Additional exact qualification";
                content.fidelity.sections = content.sections.map((section) => ({
                    sectionId: section.id,
                    supported: true,
                    reason: "All exact fields inspected in the offline fixture",
                }));
                content.fidelity.relationships = [
                    ...edgeIds,
                    ...(staleReceipt ? ["claim.support.1"] : []),
                ].map((edgeId) => ({
                    edgeId,
                    supported: true,
                    reason: "All bound citations inspected in the offline fixture",
                }));
                generated = structuredClone(content);
                return content;
            };
            const { corpus, request } = await setup(fixture.installed, 2, {}, [
                "statement scope nextTest assessment uncertainty",
                "Additional observed qualification.",
            ]);
            const result = await settled(
                service,
                await service.buildViews(request),
            );
            expect(fixture.calls()).toBe(1);
            if (staleReceipt) {
                expect(result.results[0].state).toBe("failed");
                expect(result.results[0].reason).toMatch(
                    /every exact relationship/,
                );
                expect(
                    (await service.listViews(corpus.corpusId)).views,
                ).toEqual([]);
                return;
            }
            expect(result.state).toBe("complete");
            expect(result.results[0].state).toBe("draft");
            const artifact = await service.getView({
                corpusId: corpus.corpusId,
                viewId: request.targets[0].definition.viewId,
            });
            if (
                !artifact ||
                artifact.content.kind !== "extension" ||
                !generated
            )
                throw new Error("Expected accepted exact extension artifact");
            expect(artifact.content.citations).toEqual(generated.citations);
            expect(artifact.content.evidence).toEqual(generated.evidence);
            const projected = artifact.relationships.filter(
                (
                    edge,
                ): edge is Extract<
                    ViewRelationship,
                    { origin: "human" | "generator" }
                > => edge.origin !== "system" && edge.from.kind === "section",
            );
            expect(projected.map((edge) => edge.id)).toEqual(edgeIds);
            expect(projected[0].citations).toEqual([
                ...generated.citations.slice(0, 5),
            ]);
            expect(projected[1].citations).toEqual([generated.citations[5]]);
            expect(projected[2].citations).toEqual(
                generated.citations.slice(3, 5),
            );
            expect(projected[3].citations).toEqual([generated.citations[5]]);
            expect(projected[4].citations).toEqual([generated.citations[0]]);
        },
    );

    test.each(["eligible", "ineligible", "deferred"] as const)(
        "native decision eligibility records %s under shared admission",
        async (disposition) => {
            const fixture = provider();
            let calls = 0;
            fixture.installed.descriptor.definitions[0].mode = "decision";
            const decision: DecisionModel = {
                provider: "azure",
                providerSource: "factory",
                model: "offline-choice",
                configGeneration: 1,
                async decide() {
                    calls++;
                    return {
                        success: true,
                        data: {
                            provider: "azure",
                            requestedModel: "offline-choice",
                            answers: {
                                qualification: {
                                    type: "choice",
                                    choice: disposition,
                                    probabilities: {
                                        eligible:
                                            disposition === "eligible" ? 1 : 0,
                                        ineligible:
                                            disposition === "ineligible"
                                                ? 1
                                                : 0,
                                        deferred:
                                            disposition === "deferred" ? 1 : 0,
                                    },
                                },
                            },
                        },
                    };
                },
            };
            fixture.installed.decisionModel = decision;
            fixture.installed.evaluateEligibility = async (_input, context) => {
                const response = await context.decide!("qualify", {
                    state: { family: "installed-status-family" },
                    questions: {
                        qualification: {
                            type: "choice",
                            instructions: "Evaluate this approved group only.",
                            criteria: {
                                eligible: "Concluded and complete",
                                ineligible: "Unrelated",
                                deferred: "Incomplete",
                            },
                        },
                    },
                });
                const answer = response.answers.qualification;
                if (answer.type !== "choice")
                    throw new Error("Invalid native decision");
                return {
                    disposition: answer.choice as typeof disposition,
                    reason: `Native choice: ${answer.choice}`,
                };
            };
            const { request } = await setup(fixture.installed, 1, {
                informationalBudget: requestBudget,
            });
            const job = await settled(
                service,
                await service.buildViews(request),
            );
            expect(job.results[0].eligibility).toMatchObject({
                disposition,
                mode: "decision",
            });
            expect(job.results[0].providerAttempts).toHaveLength(1);
            expect(
                JSON.parse(job.results[0].providerAttempts![0].output!).answers
                    .qualification.choice,
            ).toBe(disposition);
            expect(calls).toBe(1);
            expect(fixture.calls()).toBe(disposition === "eligible" ? 1 : 0);
        },
    );

    test("accounted continuation persists candidates and replays returned stages after restart", async () => {
        const fixture = provider();
        const construct = fixture.installed.generate;
        let failed = true,
            modelCalls = 0;
        fixture.installed.model = {
            completionSettings: {},
            complete: async () => ({
                success: true,
                data: `candidate-${++modelCalls}`,
            }),
        };
        fixture.installed.generate = async (input, prepared, context) => {
            const output = await context.complete(
                "construct",
                "Exact approved group prompt",
            );
            await context.recordCandidate!("story", {
                output,
                decisionId: null,
            });
            await context.checkpoint("review", { accepted: !failed });
            if (failed)
                throw new Error(
                    "Offline interruption after a durable returned stage",
                );
            await context.complete(
                "fidelity",
                "Review exact candidate with qualifications",
            );
            return construct(input, prepared, context);
        };
        const { request, options, corpus } = await setup(fixture.installed, 1, {
            informationalBudget: requestBudget,
        });
        const first = await settled(service, await service.buildViews(request));
        expect(first.state).toBe("failed");
        expect(first.results[0].providerCandidates?.[0].value).toEqual({
            output: "candidate-1",
            decisionId: null,
        });
        expect(first.results[0].providerCheckpoints).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    stage: "review",
                    state: { accepted: false },
                }),
            ]),
        );
        expect(modelCalls).toBe(1);
        await service.close();
        service = new FileMemoryService(root, options);
        failed = false;
        const expectedHead = (await service.listViews(corpus.corpusId)).head;
        const resumed = await service.continueViewBuild({
            corpusId: corpus.corpusId,
            jobId: first.jobId,
            expectedHead,
        });
        const duplicate = await service.continueViewBuild({
            corpusId: corpus.corpusId,
            jobId: first.jobId,
            expectedHead,
        });
        expect(duplicate.jobId).toBe(first.jobId);
        const result = await settled(service, resumed);
        expect(result.state).toBe("complete");
        expect(result.jobId).toBe(first.jobId);
        expect(modelCalls).toBe(2);
        expect(result.results[0].providerAttempts).toHaveLength(2);
        expect(result.results[0].providerCandidates).toHaveLength(1);
        expect(result.results[0].continuations).toHaveLength(1);
        await expect(
            service.continueViewBuild({
                corpusId: corpus.corpusId,
                jobId: result.jobId,
                expectedHead: (await service.listViews(corpus.corpusId)).head,
            }),
        ).rejects.toThrow("no resumable");
    });

    test("persists actual nullable structured payload and rejects bounded union overflow", async () => {
        const fixture = provider();
        const schema: ViewPayloadSchema = {
            type: "object",
            properties: {
                decisionId: {
                    type: "union",
                    variants: [
                        { type: "string", maxLength: 100 },
                        { type: "null" },
                    ],
                },
            },
            required: ["decisionId"],
        };
        fixture.installed.descriptor.outputSchema = schema;
        fixture.installed.descriptor.identity.schemaDigest = viewHash(schema);
        const construct = fixture.installed.generate;
        fixture.installed.generate = async (...args) => ({
            ...(await construct(...args)),
            payload: { decisionId: null },
        });
        const { request, corpus } = await setup(fixture.installed);
        const result = await settled(
            service,
            await service.buildViews(request),
        );
        expect(result.state).toBe("complete");
        expect(
            (
                await service.getView({
                    corpusId: corpus.corpusId,
                    viewId: request.targets[0].definition.viewId,
                })
            )?.content,
        ).toHaveProperty("payload.decisionId", null);
        const invalid = {
            type: "union",
            variants: Array.from({ length: 9 }, () => ({ type: "null" })),
        } as ViewPayloadSchema;
        fixture.installed.descriptor.outputSchema = invalid;
        fixture.installed.descriptor.identity.schemaDigest = viewHash(invalid);
        expect(() => new ViewExtensionRegistry([fixture.installed])).toThrow(
            "union",
        );
    });

    test("opted-in post-ingestion discovery creates one group target, ignores spoofed sources and refreshes changed inputs", async () => {
        const fixture = provider();
        const identity = fixture.installed.descriptor.identity;
        fixture.installed.discover = async (input) => {
            const selected = input.sources.filter(
                (source) => source.sourceId === "source-0",
            );
            if (!selected.length) return [];
            const definition = {
                viewId: extensionViewId(
                    identity.providerId,
                    "recap",
                    "approved-group",
                ),
                kind: "extension" as const,
                selector: {
                    kind: "sources" as const,
                    sources: selected.map(({ sourceId, revisionId }) => ({
                        sourceId,
                        revisionId,
                    })),
                },
                extension: {
                    ...identity,
                    definitionId: "recap",
                    targetKey: "approved-group",
                    eligibilityVersion: "1",
                    policyDigest: viewHash("synthetic approval"),
                    parameters: {},
                },
            };
            return [definition, structuredClone(definition)];
        };
        const { corpus } = await setup(fixture.installed, 1, {
            extensionDiscovery: true,
            maintenanceMode: "automatic",
        });
        async function waitForCalls(count: number) {
            for (let probe = 0; probe < 500; probe++) {
                if (
                    fixture.calls() === count &&
                    (await service.listViewBuilds(corpus.corpusId)).every(
                        (job) => job.state !== "running",
                    )
                )
                    return;
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            throw new Error("Automatic extension maintenance did not settle");
        }
        await waitForCalls(1);
        expect(await service.listViewBuilds(corpus.corpusId)).toHaveLength(1);
        const spoof = await service.ingestDocument({
            corpusId: corpus.corpusId,
            pipeline: { mode: "content" },
            source: {
                sourceId: "unrelated-spoof",
                sourceType: "text",
                title: "Copied metadata",
                text: "Unrelated record",
                metadata: {
                    family: "offline-approved-status",
                    concluded: true,
                },
            },
        });
        await waitForMemoryJob(service, spoof.jobId, { pollIntervalMs: 10 });
        await service.refreshExtensionViews({ corpusId: corpus.corpusId });
        expect(fixture.calls()).toBe(1);
        const updated = await service.ingestDocument({
            corpusId: corpus.corpusId,
            pipeline: {
                mode: "content",
                updatePolicy: "replaceActiveRevision",
            },
            source: {
                sourceId: "source-0",
                sourceType: "text",
                title: "Updated status",
                text: "Completed status with a new qualification.",
            },
        });
        await waitForMemoryJob(service, updated.jobId, { pollIntervalMs: 10 });
        await waitForCalls(2);
        const views = await service.listViews(corpus.corpusId);
        expect(views.views).toHaveLength(1);
        expect(views.views[0].version).toBe(3);
        expect(await service.listViewBuilds(corpus.corpusId)).toHaveLength(2);
    }, 20000);

    test("ordinary Search and Ask plus rich Explain select extension evidence with exact original support and opposition", async () => {
        const fixture = opposingProvider();
        let reads = 0;
        const { corpus, request } = await setup(
            fixture.installed,
            2,
            {
                indexFactory: (_id, directory) => {
                    const index = new ExtensionQueryIndex(directory);
                    const search = index.search.bind(index);
                    index.search = (query, limit) =>
                        query.length > 40
                            ? Promise.resolve([])
                            : search(query, limit);
                    return index;
                },
                indexedAnswerModel: readerModel(false, () => reads++),
                understanding: true,
            },
            [
                "Copper lantern was marked complete.",
                "Copper lantern completion was not independently verified.",
            ],
        );
        const completed = await settled(
            service,
            await service.buildViews(request),
        );
        expect(completed.results).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ state: "draft" }),
            ]),
        );
        const search = { corpusId: corpus.corpusId, query: "Copper lantern" };
        expect((await service.search(search)).derivedViews).toEqual([]);
        const view = (await service.getView({
            corpusId: corpus.corpusId,
            viewId: request.targets[0].definition.viewId,
        }))!;
        await service.publishView({
            corpusId: corpus.corpusId,
            viewId: view.viewId,
            revisionId: view.revisionId,
            expectedVersion: view.version,
            expectedHead: (await service.listViews(corpus.corpusId)).head!,
        });
        const found = await service.search(search);
        expect(found.derivedViews).toHaveLength(1);
        expect(found.derivedViews![0].opposingSources[0].sourceId).toBe(
            "source-1",
        );
        const answer = await service.answer({
            corpusId: corpus.corpusId,
            question: `Summarize the generated analyst interpretation "${view.content.title}", its original evidence and its limits.`,
            retrievalPolicy: "sourcesAndViews",
            answerMode: "synthesized",
            includeDiagnostics: true,
        });
        expect(answer.answer).toContain("not established");
        expect(
            answer.readerContext?.integratedAnswer?.suppliedEvidence,
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: "derived",
                    text: expect.stringContaining(view.content.title),
                }),
            ]),
        );
        expect(
            answer.citations.map((source) => source.sourceId).sort(),
        ).toEqual(["source-0", "source-1"]);
        expect(answer.derivedReferences).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    viewId: view.viewId,
                    revisionId: view.revisionId,
                    sectionId: "claim",
                    extension: fixture.installed.descriptor.identity,
                }),
            ]),
        );
        const understanding = await service.understand({
            corpusId: corpus.corpusId,
            question: `Summarize the generated analyst interpretation "${view.content.title}", its original evidence and its limits.`,
            retrievalPolicy: "sourcesAndViews",
        });
        expect(understanding.modules).toEqual(
            expect.arrayContaining([
                { kind: "derivedViews", status: "planned" },
            ]),
        );
        const readCount = reads;
        for (const layoutId of ["story", "roles", "brief", "sources"]) {
            const module = await service.understandingModule({
                corpusId: corpus.corpusId,
                snapshotId: understanding.snapshotId,
                kind: "derivedViews",
                viewId: view.viewId,
                revisionId: view.revisionId,
                layoutId,
            });
            expect(module.derivedViews?.[0].selectedBlockIds).toEqual([
                "claim",
            ]);
            expect(
                module.derivedViews?.[0].blocks[0].citations.map(
                    (citation) => citation.role,
                ),
            ).toEqual(["support", "opposition"]);
        }
        expect(reads).toBe(readCount);
        const original = await service.understandingModule({
            corpusId: corpus.corpusId,
            snapshotId: understanding.snapshotId,
            kind: "derivedViews",
            viewId: view.viewId,
            revisionId: view.revisionId,
            blockId: "claim",
            citationId: "claim.opposition.0",
        });
        expect(original.derivedViews?.[0].sourceFragment).toMatchObject({
            blockId: "claim",
            role: "opposition",
            source: { sourceId: "source-1" },
            text: "Copper lantern completion was not independently verified.",
        });
        expect(reads).toBe(readCount);
        await expect(
            service.understandingModule({
                corpusId: corpus.corpusId,
                snapshotId: understanding.snapshotId,
                kind: "derivedViews",
                viewId: "outside-snapshot",
                revisionId: view.revisionId,
            }),
        ).rejects.toThrow("outside");
    });

    test.each([false, true])(
        "default Explain validates one view revision per boundary with external source authorization (revoked dependency=%s)",
        async (revoke) => {
            const fixture = opposingProvider();
            const generate = fixture.installed.generate;
            const blockIds = ["claim", "context", "limits", "review"];
            fixture.installed.generate = async (...args) => {
                const content = await generate(...args);
                content.sections = blockIds.map((id) => ({
                    ...content.sections[0],
                    id,
                    heading: id,
                    body: `Copper lantern ${id}: completion has bounded support and opposition.`,
                }));
                content.evidence = blockIds.map((blockId) => ({
                    ...content.evidence[0],
                    blockId,
                }));
                content.fidelity.sections = blockIds.map((sectionId) => ({
                    sectionId,
                    supported: true,
                    reason: "Synthetic exact section support",
                }));
                content.fidelity.relationships = blockIds.flatMap((id) =>
                    ["support", "opposition"].map((role) => ({
                        edgeId: `${id}.${role}.0`,
                        supported: true,
                        reason: "Synthetic exact original field",
                    })),
                );
                for (const layout of content.presentation.layouts)
                    layout.groups[0].blockIds = blockIds;
                return content;
            };
            let reads = 0;
            let postReaderChecks = 0;
            let deniedSource: string | undefined;
            let denyModuleRead = false;
            let onModuleRead: (() => void) | undefined;
            const authorize = fixture.installed.authorize;
            fixture.installed.authorize = async (snapshot, operation) => {
                if (operation === "read") {
                    if (denyModuleRead) return false;
                    onModuleRead?.();
                }
                if (operation === "publish" && reads) {
                    postReaderChecks++;
                    if (revoke && postReaderChecks === 2)
                        deniedSource = "source-2";
                }
                return authorize(snapshot, operation);
            };
            const texts = [
                "Copper lantern was marked complete.",
                "Copper lantern completion was not independently verified.",
                "Retained qualification dependency outside the query.",
            ];
            const approvals = texts.map((text, index) => ({
                sourceId: `source-${index}`,
                contentHash: createHash("sha256").update(text).digest("hex"),
                retainedContentHash: viewHash(text),
            }));
            const nativeCheck = promisify(execFile);
            const gates: Array<{ operation: string; sourceId: string }> = [];
            const { corpus, request, options } = await setup(
                fixture.installed,
                3,
                {
                    indexFactory: (_id, directory) =>
                        new ExtensionQueryIndex(directory),
                    indexedAnswerModel: readerModel(false, () => reads++),
                    understanding: true,
                    sourceAuthorization: async (input) => {
                        gates.push(input);
                        const { stdout } = await nativeCheck(process.execPath, [
                            "-e",
                            `const [request, approvals, denied] = process.argv.slice(1).map(JSON.parse);
const allowed = approvals.some(source => source.sourceId === request.sourceId &&
    source.contentHash === request.contentHash && source.retainedContentHash === request.retainedContentHash);
process.stdout.write(JSON.stringify(allowed && request.sourceId !== denied));`,
                            JSON.stringify(input),
                            JSON.stringify(approvals),
                            JSON.stringify(deniedSource ?? null),
                        ]);
                        return JSON.parse(stdout) === true;
                    },
                },
                texts,
            );
            const built = await settled(
                service,
                await service.buildViews(request),
            );
            expect(built.state).toBe("complete");
            const view = (await service.getView({
                corpusId: corpus.corpusId,
                viewId: request.targets[0].definition.viewId,
            }))!;
            await service.publishView({
                corpusId: corpus.corpusId,
                viewId: view.viewId,
                revisionId: view.revisionId,
                expectedVersion: view.version,
                expectedHead: (await service.listViews(corpus.corpusId)).head!,
            });
            await service.close();
            service = new FileMemoryService(root, options);
            const explaining = service.understand({
                corpusId: corpus.corpusId,
                question: "Copper lantern",
                retrievalPolicy: "sourcesAndViews",
            });
            if (revoke) {
                await expect(explaining).rejects.toThrow("influence changed");
                expect(postReaderChecks).toBe(2);
                expect(reads).toBe(1);
                return;
            }
            const result = await explaining;
            expect(postReaderChecks).toBe(2);
            expect(reads).toBe(1);
            expect(result.answer?.status).toBe("answered");
            expect(result.modules).toEqual(
                expect.arrayContaining([
                    { kind: "explanation", status: "ready" },
                    { kind: "derivedViews", status: "planned" },
                ]),
            );
            expect(result.answer?.summary.evidenceIds).toHaveLength(3);
            expect(
                result.citations.flatMap((item) =>
                    item.kind === "source"
                        ? [[item.source.sourceId, item.source.snippet]]
                        : [],
                ),
            ).toEqual([
                ["source-0", texts[0]],
                ["source-1", texts[1]],
            ]);
            expect(
                result.citations.filter((item) => item.kind === "derived"),
            ).toHaveLength(4);
            expect(gates).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        sourceId: "source-0",
                        operation: "reader",
                    }),
                    expect.objectContaining({
                        sourceId: "source-2",
                        operation: "read",
                    }),
                ]),
            );
            const beforeModuleChecks = postReaderChecks;
            gates.length = 0;
            const moduleRequest = {
                corpusId: corpus.corpusId,
                snapshotId: result.snapshotId,
                kind: "derivedViews" as const,
                viewId: view.viewId,
                revisionId: view.revisionId,
                layoutId: "story",
                limit: 4,
            };
            const module = await service.understandingModule(moduleRequest);
            expect(module.derivedViews?.[0].selectedBlockIds).toEqual([
                "claim",
            ]);
            expect(module.derivedViews?.[0].blocks).toHaveLength(4);
            expect(reads).toBe(1);
            expect(postReaderChecks - beforeModuleChecks).toBe(2);
            expect(
                gates.filter(
                    (gate) =>
                        gate.operation === "read" &&
                        gate.sourceId === "source-2",
                ),
            ).toHaveLength(2);
            gates.length = 0;
            await service.understandingModule({
                ...moduleRequest,
                layoutId: "roles",
            });
            expect(
                gates.filter(
                    (gate) =>
                        gate.operation === "read" &&
                        gate.sourceId === "source-2",
                ),
            ).toHaveLength(2);
            denyModuleRead = true;
            await expect(
                service.understandingModule(moduleRequest),
            ).rejects.toThrow("not authorized");
            denyModuleRead = false;
            onModuleRead = () => {
                deniedSource = "source-2";
            };
            await expect(
                service.understandingModule(moduleRequest),
            ).rejects.toThrow(/changed|forgotten|revoked/);
            expect(reads).toBe(1);
        },
        30000,
    );

    test("native approval revocation blocks warmed originals, cached modules and in-flight ordinary reader return", async () => {
        const fixture = opposingProvider();
        let approved = true,
            revokeOnReturn = false,
            reads = 0;
        const { corpus, request } = await setup(fixture.installed, 2, {
            indexFactory: (_id, directory) =>
                new ExtensionQueryIndex(directory),
            sourceAuthorization: async () => approved,
            indexedAnswerModel: readerModel(false, () => {
                reads++;
                if (revokeOnReturn) approved = false;
            }),
            understanding: true,
        });
        const completed = await settled(
            service,
            await service.buildViews(request),
        );
        expect(completed.results).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ state: "draft" }),
            ]),
        );
        const view = (await service.getView({
            corpusId: corpus.corpusId,
            viewId: request.targets[0].definition.viewId,
        }))!;
        await service.publishView({
            corpusId: corpus.corpusId,
            viewId: view.viewId,
            revisionId: view.revisionId,
            expectedVersion: view.version,
            expectedHead: (await service.listViews(corpus.corpusId)).head!,
        });
        const snapshot = await service.understand({
            corpusId: corpus.corpusId,
            question: "Copper lantern",
            retrievalPolicy: "sourcesAndViews",
        });
        await service.understandingModule({
            corpusId: corpus.corpusId,
            snapshotId: snapshot.snapshotId,
            kind: "derivedViews",
        });
        await service.warmViewIndexes(corpus.corpusId);
        const previousReads = reads;
        approved = false;
        await expect(
            service.getSourceContent({
                corpusId: corpus.corpusId,
                ...request.targets[0].definition.selector.sources[0],
            }),
        ).rejects.toThrow("not authorized");
        expect(
            (
                await service.search({
                    corpusId: corpus.corpusId,
                    query: "Retained",
                    retrievalPolicy: "sourcesOnly",
                })
            ).matches,
        ).toEqual([]);
        const denied = await service.answer({
            corpusId: corpus.corpusId,
            question: "Retained",
            retrievalPolicy: "sourcesOnly",
        });
        expect(denied.citations).toEqual([]);
        expect(reads).toBe(previousReads);
        await expect(
            service.understandingModule({
                corpusId: corpus.corpusId,
                snapshotId: snapshot.snapshotId,
                kind: "derivedViews",
            }),
        ).rejects.toThrow();
        approved = true;
        revokeOnReturn = true;
        await expect(
            service.answer({
                corpusId: corpus.corpusId,
                question: "Copper lantern",
                retrievalPolicy: "sourcesAndViews",
            }),
        ).rejects.toThrow();
        expect(reads).toBe(previousReads + 1);
    });

    test.each(["informationalBudget", "maintenanceBudget"] as const)(
        "physical attempt receipts and intermediate candidates survive accounted host-budget continuation without replay spend (%s)",
        async (budgetScope) => {
            const budgetOptions = (
                chatAttempts: number,
            ): FileMemoryServiceOptions =>
                budgetScope === "informationalBudget"
                    ? {
                          informationalBudget: {
                              ...requestBudget,
                              chatAttempts,
                          },
                      }
                    : {
                          maintenanceLimits: {
                              requestBudget: { ...requestBudget, chatAttempts },
                          },
                      };
            const fixture = provider();
            fixture.installed.descriptor.limits.maxModelCalls = 1;
            const generate = fixture.installed.generate;
            fixture.installed.generate = async (input, prepared, context) => {
                const candidate = await context.complete(
                    "draft",
                    "Synthetic draft",
                );
                await context.recordCandidate?.("draft", JSON.parse(candidate));
                await context.checkpoint("draft-retained", {
                    candidate: "draft",
                });
                await context.complete("review", "Synthetic review");
                return generate(input, prepared, context);
            };
            let dispatches = 0;
            const previous = globalThis.fetch;
            globalThis.fetch = async () => {
                dispatches++;
                return new Response("{}");
            };
            const model = budgetedCompletionModel();
            fixture.installed.model = model;
            try {
                const { corpus, request } = await setup(fixture.installed, 1, {
                    indexedAnswerModel: model,
                    ...budgetOptions(1),
                });
                const failed = await settled(
                    service,
                    await service.buildViews(request),
                );
                expect(failed.state).toBe("failed");
                expect(failed.results[0].providerRequests).toHaveLength(1);
                expect(failed.results[0].providerCandidates?.[0].value).toEqual(
                    {
                        items: ["retained candidate"],
                    },
                );
                expect(dispatches).toBe(1);
                await service.close();
                service = new FileMemoryService(root, {
                    viewDrafts: false,
                    informationalViews: false,
                    sourceSynopses: false,
                    discoveryPolicy: "off",
                    maintenanceMode: "manual",
                    extensionBuilds: true,
                    extensionProviders: [fixture.installed],
                    ...budgetOptions(3),
                    indexFactory: (_id, directory) =>
                        new FakeSemanticCorpusIndex(directory),
                });
                const resumed = await settled(
                    service,
                    await service.continueViewBuild({
                        corpusId: corpus.corpusId,
                        jobId: failed.jobId,
                        expectedHead: (await service.listViews(corpus.corpusId))
                            .head,
                    }),
                );
                expect(resumed.jobId).toBe(failed.jobId);
                expect(resumed.state).toBe("complete");
                expect(dispatches).toBe(2);
                expect(
                    resumed.results[0].providerRequests?.map(
                        (attempt) => attempt.reservation.attempt,
                    ),
                ).toEqual([1, 2]);
                expect(resumed.results[0].providerCandidates).toHaveLength(1);
                expect(
                    resumed.results[0].providerBudgetAmendments,
                ).toHaveLength(1);
                expect(
                    resumed.results[0].providerBudgetElapsedMs,
                ).toBeGreaterThanOrEqual(
                    failed.results[0].providerBudgetElapsedMs!,
                );
            } finally {
                globalThis.fetch = previous;
            }
        },
    );

    async function setup(
        installed: ViewExtensionProvider,
        count = 1,
        extra: FileMemoryServiceOptions = {},
        texts: string[] = [],
    ) {
        root = path.resolve(".extension-fixtures", randomUUID());
        await mkdir(root, { recursive: true });
        const options = {
            viewDrafts: false,
            extensionBuilds: true,
            extensionProviders: [installed],
            informationalViews: false,
            discoveryPolicy: "off" as const,
            maintenanceMode: "manual" as const,
            sourceSynopses: false,
            indexFactory: (_id: unknown, directory: string) =>
                new FakeSemanticCorpusIndex(directory),
            ...extra,
        };
        service = new FileMemoryService(root, options);
        const corpus = await service.createCorpus("Synthetic extension corpus");
        const sources: ViewBuildSnapshot["definition"]["selector"]["sources"] =
            [];
        for (let index = 0; index < count; index++) {
            const job = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: `source-${index}`,
                    sourceType: "text",
                    title: `Status ${index}`,
                    text:
                        texts[index] ??
                        "Retained completed status with limitations.",
                    metadata: {
                        family: "offline-approved-status",
                        concluded: true,
                    },
                },
                pipeline: { mode: "content" },
            });
            await waitForMemoryJob(service, job.jobId, { pollIntervalMs: 10 });
            const source = await service.getSource(
                corpus.corpusId,
                `source-${index}`,
            );
            sources.push({
                sourceId: source!.sourceId,
                revisionId: source!.activeRevisionId!,
            });
        }
        const targetKey = "approved-group";
        const request: ViewBuildRequest = {
            corpusId: corpus.corpusId,
            expectedHead: (await service.listViews(corpus.corpusId)).head,
            targets: [
                {
                    expectedVersion: 0,
                    definition: {
                        viewId: extensionViewId(
                            installed.descriptor.identity.providerId,
                            "recap",
                            targetKey,
                        ),
                        kind: "extension",
                        selector: { kind: "sources", sources },
                        extension: {
                            ...installed.descriptor.identity,
                            definitionId: "recap",
                            eligibilityVersion: "1",
                            targetKey,
                            policyDigest: viewHash("synthetic approval"),
                            parameters: {},
                        },
                    },
                },
            ],
            publication: false,
        };
        return { corpus, request, options };
    }

    test("admitted view frame declarations backfill validated block evidence without regeneration", async () => {
        const fake = provider();
        const payloadSchema: ViewPayloadSchema = {
            type: "object",
            properties: {
                items: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string", maxLength: 100 },
                            blockId: { type: "string", maxLength: 100 },
                            duration: { type: "number" },
                        },
                        required: ["id", "blockId", "duration"],
                    },
                    maxItems: 10,
                },
            },
            required: ["items"],
        };
        fake.installed.descriptor.outputSchema = payloadSchema;
        fake.installed.descriptor.identity.schemaDigest =
            viewHash(payloadSchema);
        fake.installed.descriptor.indexProjection = [
            {
                schema: {
                    id: "synthetic-recap.duration",
                    revision: 1,
                    description: "Retained synthetic durations",
                    fields: { duration: { type: "number", unit: "ms" } },
                },
                rowsPointer: "/items",
                itemKeyPointer: "/id",
                blockIdPointer: "/blockId",
                fields: { duration: "/duration" },
            },
        ];
        const generate = fake.installed.generate;
        fake.installed.generate = async (...args) => ({
            ...(await generate(...args)),
            payload: {
                items: [{ id: "sample", blockId: "claim", duration: 40 }],
            },
        });
        const { corpus, request, options } = await setup(
            fake.installed,
            1,
            {},
            ["Retained completed status with limitations; duration is 40 ms."],
        );
        expect(
            (await settled(service, await service.buildViews(request))).state,
        ).toBe("complete");
        await service.close();
        service = new FileMemoryService(root, {
            ...options,
            frameProjections: true,
        });
        const result = await service.queryFrame({
            corpusId: corpus.corpusId,
            schemaId: "synthetic-recap.duration",
            schemaRevision: 1,
            predicate: {
                and: [
                    { fieldId: "duration", op: "gte", value: 30, unit: "ms" },
                ],
            },
            includeUnconfirmed: true,
        });
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].eligible).toBe(false);
        expect(result.rows[0].evidence[0].sourceId).toBe("source-0");
        expect(result.rows[0].granularity).toBe("record");
        expect(fake.calls()).toBe(1);
        fake.revoke();
        expect(
            (await service.listFrameSchemas(corpus.corpusId)).some(
                (schema) => schema.id === "synthetic-recap.duration",
            ),
        ).toBe(false);
    });

    test("failed materialization replays retained model stages after restart without another request", async () => {
        const fake = provider();
        const generate = fake.installed.generate;
        let validRole = false;
        fake.installed.model = budgetedCompletionModel();
        fake.installed.generate = async (...args) => {
            await args[2].complete("draft", "Retained synthetic draft");
            const content = await generate(...args);
            Object.assign(content.sections[0], {
                role: validRole ? "decisions" : "invented",
            });
            return content;
        };
        let dispatches = 0;
        const previousFetch = globalThis.fetch;
        globalThis.fetch = async () => {
            dispatches++;
            return new Response("{}");
        };
        try {
            const { corpus, request, options } = await setup(
                fake.installed,
                1,
                {
                    maintenanceLimits: { requestBudget },
                },
            );
            const failed = await settled(
                service,
                await service.buildViews(request),
            );
            expect(failed.state).toBe("failed");
            expect(failed.results[0].reason).toBe(
                "Unsupported guide section role",
            );
            expect(failed.results[0].providerRequests).toHaveLength(1);
            expect(failed.results[0].providerAttempts?.[0].state).toBe(
                "returned",
            );
            expect(dispatches).toBe(1);
            validRole = true;
            await service.close();
            service = new FileMemoryService(root, options);
            const resumed = await settled(
                service,
                await service.continueViewBuild({
                    corpusId: corpus.corpusId,
                    jobId: failed.jobId,
                    expectedHead: (await service.listViews(corpus.corpusId))
                        .head,
                }),
            );
            expect(resumed.state).toBe("complete");
            expect(resumed.jobId).toBe(failed.jobId);
            expect(resumed.results[0].providerRequests).toEqual(
                failed.results[0].providerRequests,
            );
            expect(dispatches).toBe(1);
            expect(
                (
                    await service.getView({
                        corpusId: corpus.corpusId,
                        viewId: request.targets[0].definition.viewId,
                    })
                )?.content.sections[0].role,
            ).toBe("decisions");
        } finally {
            globalThis.fetch = previousFetch;
        }
    });

    test.each(viewDocumentSectionRoles)(
        "extension document section role %s survives native build and read",
        async (role) => {
            const fake = provider();
            const generate = fake.installed.generate;
            fake.installed.generate = async (...args) => {
                const content = await generate(...args);
                content.sections[0].role = role;
                return content;
            };
            const { corpus, request } = await setup(fake.installed, 1);
            const result = await settled(
                service,
                await service.buildViews(request),
            );
            expect(result.state).toBe("complete");
            const view = await service.getView({
                corpusId: corpus.corpusId,
                viewId: request.targets[0].definition.viewId,
            });
            expect(view?.content.sections[0].role).toBe(role);
        },
    );

    test.each(["event", "page", "question", "invented"] as const)(
        "non-document extension section role %s fails without an artifact",
        async (role) => {
            const fake = provider();
            const generate = fake.installed.generate;
            fake.installed.generate = async (...args) => {
                const content = await generate(...args);
                Object.assign(content.sections[0], { role });
                return content;
            };
            const { corpus, request } = await setup(fake.installed, 1);
            const result = await settled(
                service,
                await service.buildViews(request),
            );
            expect(result.state).toBe("failed");
            expect(result.results[0].reason).toBe(
                "Unsupported guide section role",
            );
            expect(await service.listViews(corpus.corpusId)).toMatchObject({
                views: [],
            });
        },
    );

    test("extension roles do not widen troubleshooting guide roles", () => {
        const request: ViewSaveRequest = {
            corpusId: "synthetic-corpus",
            viewId: "synthetic-guide",
            expectedVersion: 0,
            expectedHead: null,
            definition: {
                viewId: "synthetic-guide",
                kind: "troubleshootingGuide",
                selector: {
                    kind: "sources",
                    sources: [
                        { sourceId: "synthetic-source", revisionId: "r1" },
                    ],
                },
            },
            content: {
                kind: "troubleshootingGuide",
                title: "Synthetic guide",
                sections: [
                    {
                        id: "context",
                        role: "context",
                        heading: "Context",
                        body: "Retained context.",
                    },
                ],
                citations: [],
            },
            relationships: [],
        };
        expect(() => validateViewDraft(request)).not.toThrow();
        request.content.sections[0].role = "decisions";
        expect(() => validateViewDraft(request)).toThrow(
            "Unsupported guide section role",
        );
    });

    test("stores nested corpus artifact and eligibility, deduplicates admission, and reauthorizes reads", async () => {
        const fake = provider();
        const { corpus, request, options } = await setup(fake.installed);
        const first = await service.buildViews(request);
        const result = await settled(service, first);
        expect(result.state).toBe("complete");
        expect(result.results[0].eligibility?.disposition).toBe("eligible");
        expect(result.results[0].state).toBe("draft");
        expect((await service.buildViews(request)).jobId).toBe(first.jobId);
        expect(fake.calls()).toBe(1);
        const read = {
            corpusId: corpus.corpusId,
            viewId: request.targets[0].definition.viewId,
        };
        const artifact = await service.getView(read);
        expect(artifact?.content.kind).toBe("extension");
        expect(artifact?.content).toHaveProperty("payload.items", [
            "Copper lantern",
        ]);
        await service.close();
        service = new FileMemoryService(root, options);
        expect((await service.getView(read))?.revisionId).toBe(
            artifact?.revisionId,
        );
        expect(
            (
                await service.getViewBuild({
                    corpusId: corpus.corpusId,
                    jobId: first.jobId,
                })
            )?.results[0].eligibility,
        ).toEqual(result.results[0].eligibility);
        fake.revoke();
        expect(await service.getView(read)).toBeUndefined();
        expect((await service.listViews(corpus.corpusId)).views).toEqual([]);
    });

    test.each(["ineligible", "deferred"] as const)(
        "%s input cannot construct an artifact",
        async (disposition) => {
            const fake = provider(disposition);
            const { request, corpus } = await setup(fake.installed);
            const result = await settled(
                service,
                await service.buildViews(request),
            );
            expect(result.results[0].eligibility?.disposition).toBe(
                disposition,
            );
            expect(fake.calls()).toBe(0);
            expect((await service.listViews(corpus.corpusId)).views).toEqual(
                [],
            );
            expect(result.results[0].state).toBe(
                disposition === "ineligible" ? "skipped" : "blocked",
            );
        },
    );

    test("unknown provider and oversized legacy selector are rejected without construction", async () => {
        const fake = provider();
        const { request } = await setup(fake.installed);
        const changed = structuredClone(request);
        changed.targets[0].definition.extension!.version = "missing";
        await expect(service.buildViews(changed)).rejects.toThrow(
            "Missing or mismatched installed view provider",
        );
        const overflowing = structuredClone(request);
        overflowing.targets[0].definition.selector.sources = Array.from(
            { length: 33 },
            (_, index) => ({
                sourceId: `missing-${index}`,
                revisionId: "revision",
            }),
        );
        await expect(service.buildViews(overflowing)).rejects.toThrow(
            "overflowing",
        );
        expect(fake.calls()).toBe(0);
    });

    test("drafts stay outside retrieval and published generated wording is withdrawn after warmed access revocation", async () => {
        const fake = provider();
        const { request, corpus } = await setup(fake.installed);
        await settled(service, await service.buildViews(request));
        const query = {
            corpusId: corpus.corpusId,
            query: "Copper lantern",
            freshness: "current" as const,
        };
        expect(await service.searchViews(query)).toEqual([]);
        const artifact = (await service.getView({
            corpusId: corpus.corpusId,
            viewId: request.targets[0].definition.viewId,
        }))!;
        const publication = await service.publishView({
            corpusId: corpus.corpusId,
            viewId: artifact.viewId,
            revisionId: artifact.revisionId,
            expectedVersion: artifact.version,
            expectedHead: (await service.listViews(corpus.corpusId)).head!,
        });
        expect(publication.indexState).toBe("ready");
        expect((await service.searchViews(query))[0].view.revisionId).toBe(
            artifact.revisionId,
        );
        await service.warmViewIndexes(corpus.corpusId);
        fake.revoke();
        await expect(service.searchViews(query)).rejects.toThrow(
            "Provider scope is not authorized",
        );
    });

    test.each([33, 65])(
        "a complete manifest preserves all dependencies with bounded source authorization (sources=%i)",
        async (count) => {
            const fake = provider();
            fake.installed.descriptor.limits.maxSources = 128;
            let active = 0;
            let peak = 0;
            let denied = false;
            let failed = false;
            const checked = new Set<string>();
            const { request, corpus } = await setup(fake.installed, count, {
                sourceAuthorization: async (source) => {
                    active++;
                    peak = Math.max(peak, active);
                    try {
                        if (active > 64)
                            throw new Error(
                                "Synthetic source authorization queue is full",
                            );
                        if (failed)
                            throw new Error("Synthetic authorization failure");
                        await new Promise<void>((resolve) =>
                            setImmediate(resolve),
                        );
                        checked.add(source.sourceId);
                        return !denied;
                    } finally {
                        active--;
                    }
                },
            });
            const members = [];
            for (const source of request.targets[0].definition.selector
                .sources) {
                const content = await service.getSourceContent({
                    corpusId: corpus.corpusId,
                    ...source,
                });
                members.push({
                    ...source,
                    contentHash: viewHash(content.content),
                });
            }
            const manifest = JSON.stringify({
                schemaVersion: 1,
                corpusId: corpus.corpusId,
                members,
            });
            const ingestion = await service.ingestDocument({
                corpusId: corpus.corpusId,
                source: {
                    sourceId: "group-manifest",
                    sourceType: "text",
                    title: "Complete input manifest",
                    text: manifest,
                },
                pipeline: { mode: "content" },
            });
            await waitForMemoryJob(service, ingestion.jobId, {
                pollIntervalMs: 10,
            });
            const root = (await service.getSource(
                corpus.corpusId,
                "group-manifest",
            ))!;
            request.targets[0].definition.selector = {
                kind: "sourceManifest",
                sources: members.map(({ sourceId, revisionId }) => ({
                    sourceId,
                    revisionId,
                })),
                manifest: {
                    sourceId: root.sourceId,
                    revisionId: root.activeRevisionId!,
                    contentHash: viewHash(manifest),
                },
            };
            request.expectedHead = (
                await service.listViews(corpus.corpusId)
            ).head;
            fake.installed.discover = async () =>
                request.targets.map((target) => target.definition);
            const admitted = await service.refreshExtensionViews({
                corpusId: corpus.corpusId,
            });
            expect(admitted).toHaveLength(1);
            const result = await settled(service, admitted[0]);
            expect(result.state).toBe("complete");
            expect(result.results[0].snapshot.inputs).toHaveLength(count);
            expect(result.results[0].snapshot.influenceSources).toHaveLength(
                count + 1,
            );
            expect(
                (
                    await service.getSourceViewUsage({
                        corpusId: corpus.corpusId,
                        sourceId: `source-${count - 1}`,
                    })
                ).total,
            ).toBe(1);
            expect(
                (
                    await service.getSourceViewUsage({
                        corpusId: corpus.corpusId,
                        sourceId: "group-manifest",
                    })
                ).total,
            ).toBe(1);
            expect(fake.calls()).toBe(1);
            expect(peak).toBe(1);
            expect(checked.size).toBe(count + 1);
            denied = true;
            expect(
                await service.getSource(corpus.corpusId, "source-0"),
            ).toBeUndefined();
            denied = false;
            failed = true;
            await expect(
                service.getSource(corpus.corpusId, "source-0"),
            ).rejects.toThrow("Synthetic authorization failure");
            failed = false;
            expect(
                await service.getSource(corpus.corpusId, "source-0"),
            ).toMatchObject({ sourceId: "source-0" });
        },
    );
});

test("registration rejects duplicate identity and schema mismatch without executing the provider", () => {
    const fake = provider();
    expect(
        () => new ViewExtensionRegistry([fake.installed, fake.installed]),
    ).toThrow("Duplicate provider identity");
    const changed = {
        ...fake.installed,
        descriptor: {
            ...fake.installed.descriptor,
            identity: {
                ...fake.installed.descriptor.identity,
                schemaDigest: viewHash("wrong schema"),
            },
        },
    };
    expect(() => new ViewExtensionRegistry([changed])).toThrow(
        "schema digest mismatch",
    );
    expect(fake.calls()).toBe(0);
});
