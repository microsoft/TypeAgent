// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChatModel } from "@typeagent/aiclient";
import type {
    ExtensionViewContent,
    ViewBuildSnapshot,
    ViewCitation,
    ViewDefinitionInput,
    ViewSupportReport,
    ViewSynthesisOutput,
} from "./viewTypes.js";
import { viewHash } from "./viewContent.js";

import {
    assertViewProviderJson,
    validateViewProviderIdentity,
    type ViewProviderIdentity,
    type ViewProviderJson,
} from "./viewProviderValidation.js";
export * from "./viewProviderValidation.js";

export interface ViewProviderStatement {
    id: string;
    text: string;
    citations: ViewCitation[];
}

export interface ViewProviderDocument {
    title: string;
    data: ViewProviderJson;
    statements: ViewProviderStatement[];
    missingEvidence: string[];
}

export type ViewProviderResult =
    | {
          state: "accepted";
          document: ViewProviderDocument;
          support: ViewSupportReport;
      }
    | { state: "rejected"; reason: string; candidate?: ViewProviderJson }
    | { state: "deferred"; reason: string };

export interface ViewProviderContext {
    input: Readonly<ViewBuildSnapshot>;
    modelIdentity: string;
    signal: AbortSignal;
    previous: Readonly<Record<string, ViewProviderJson>>;
    assertEligible(operation: "construct" | "model" | "return"): Promise<void>;
    complete(
        stage: string,
        ...request: Parameters<ChatModel["complete"]>
    ): ReturnType<ChatModel["complete"]>;
    checkpoint(stage: string, state: ViewProviderJson): Promise<void>;
    recordCandidate(stage: string, candidate: ViewProviderJson): Promise<void>;
}

export interface HostViewProvider {
    identity: Readonly<ViewProviderIdentity>;
    validateInput(input: Readonly<ViewBuildSnapshot>): void | Promise<void>;
    validateDocument(
        document: ViewProviderDocument,
        input: Readonly<ViewBuildSnapshot>,
    ): void | Promise<void>;
    construct(context: ViewProviderContext): Promise<ViewProviderResult>;
}

export interface ViewProviderAuthorization {
    assertAuthorized(request: {
        operation: "build" | "model" | "publish" | "read";
        input: Readonly<ViewProviderInputReference>;
    }): Promise<void>;
}

export type ViewProviderInputReference = Pick<
    ViewBuildSnapshot,
    | "corpusId"
    | "actor"
    | "definition"
    | "definitionRevisionId"
    | "targetRevisionId"
    | "expectedVersion"
    | "bounds"
    | "pipeline"
    | "model"
    | "fingerprint"
    | "influenceSources"
    | "influenceEvents"
> & {
    inputs: Array<
        Pick<
            ViewBuildSnapshot["inputs"][number],
            | "sourceId"
            | "revisionId"
            | "contentHash"
            | "evidence"
            | "learnedAt"
            | "occurredAt"
        >
    >;
};

export function viewProviderInputReference(
    input: ViewProviderInputReference,
): ViewProviderInputReference {
    return structuredClone({
        corpusId: input.corpusId,
        actor: input.actor,
        definition: input.definition,
        ...(input.definitionRevisionId === undefined
            ? {}
            : {
                  definitionRevisionId: input.definitionRevisionId,
              }),
        ...(input.targetRevisionId === undefined
            ? {}
            : {
                  targetRevisionId: input.targetRevisionId,
              }),
        expectedVersion: input.expectedVersion,
        bounds: input.bounds,
        pipeline: input.pipeline,
        model: input.model,
        fingerprint: input.fingerprint,
        ...(input.influenceSources === undefined
            ? {}
            : {
                  influenceSources: input.influenceSources,
              }),
        ...(input.influenceEvents === undefined
            ? {}
            : {
                  influenceEvents: input.influenceEvents,
              }),
        inputs: input.inputs.map((source) => ({
            sourceId: source.sourceId,
            revisionId: source.revisionId,
            contentHash: source.contentHash,
            ...(source.evidence === undefined
                ? {}
                : { evidence: source.evidence }),
            ...(source.learnedAt === undefined
                ? {}
                : { learnedAt: source.learnedAt }),
            ...(source.occurredAt === undefined
                ? {}
                : { occurredAt: source.occurredAt }),
        })),
    });
}

export class ViewProviderRegistry {
    private readonly providers = new Map<string, HostViewProvider>();

    public constructor(providers: readonly HostViewProvider[] = []) {
        for (const provider of providers) {
            validateViewProviderIdentity(provider.identity);
            if (
                typeof provider.validateInput !== "function" ||
                typeof provider.validateDocument !== "function" ||
                typeof provider.construct !== "function"
            )
                throw new Error(
                    "View providers require input, document and construction hooks",
                );
            if (this.providers.has(provider.identity.id))
                throw new Error(
                    `Duplicate view provider: ${provider.identity.id}`,
                );
            const identity = Object.freeze({ ...provider.identity });
            this.providers.set(
                identity.id,
                Object.freeze({
                    identity,
                    validateInput: provider.validateInput.bind(provider),
                    validateDocument: provider.validateDocument.bind(provider),
                    construct: provider.construct.bind(provider),
                }),
            );
        }
    }

    public identities(): ViewProviderIdentity[] {
        return [...this.providers.values()].map((provider) => ({
            ...provider.identity,
        }));
    }

    public require(
        identity: Readonly<ViewProviderIdentity>,
    ): Readonly<HostViewProvider> {
        validateViewProviderIdentity(identity);
        const provider = this.providers.get(identity.id);
        if (!provider) throw new Error(`Unknown view provider: ${identity.id}`);
        if (
            provider.identity.version !== identity.version ||
            provider.identity.implementationSha256 !==
                identity.implementationSha256 ||
            provider.identity.schemaSha256 !== identity.schemaSha256
        )
            throw new Error(
                `Installed view provider identity changed: ${identity.id}`,
            );
        return provider;
    }

    public async construct(
        identity: Readonly<ViewProviderIdentity>,
        context: ViewProviderContext,
    ): Promise<ViewProviderResult> {
        const provider = this.require(identity);
        const input = structuredClone(context.input);
        if (
            input.pipeline !== "host-defined-v1" ||
            typeof context.modelIdentity !== "string" ||
            !context.modelIdentity.trim() ||
            input.definition.kind !== "extension" ||
            viewHash(input.definition.extension?.provider) !==
                viewHash(identity)
        )
            throw new Error(
                "Provider construction requires its pinned extension snapshot",
            );
        const inputIdentity = viewHash(input);
        const assertPinnedInput = () => {
            if (viewHash(input) !== inputIdentity)
                throw new Error("View provider changed its frozen input");
        };
        context.signal.throwIfAborted();
        await context.assertEligible("construct");
        await provider.validateInput(input);
        assertPinnedInput();
        const result = await provider.construct({
            ...context,
            input,
            async complete(stage, ...request) {
                validateProviderStage(stage);
                assertPinnedInput();
                context.signal.throwIfAborted();
                await context.assertEligible("model");
                const response = await context.complete(stage, ...request);
                context.signal.throwIfAborted();
                await context.assertEligible("model");
                return response;
            },
            async checkpoint(stage, state) {
                validateProviderStage(stage);
                assertPinnedInput();
                assertViewProviderJson(state);
                context.signal.throwIfAborted();
                await context.assertEligible("return");
                await context.checkpoint(stage, structuredClone(state));
            },
            async recordCandidate(stage, candidate) {
                validateProviderStage(stage);
                assertPinnedInput();
                assertViewProviderJson(candidate);
                context.signal.throwIfAborted();
                await context.assertEligible("return");
                await context.recordCandidate(
                    stage,
                    structuredClone(candidate),
                );
            },
        });
        context.signal.throwIfAborted();
        await context.assertEligible("return");
        assertPinnedInput();
        await provider.validateInput(input);
        if (result.state === "accepted") {
            assertViewProviderJson(result.document.data);
            await provider.validateDocument(result.document, input);
        } else if (
            !["rejected", "deferred"].includes(result.state) ||
            typeof result.reason !== "string" ||
            !result.reason.trim()
        )
            throw new Error(
                "A nonaccepted provider result requires an explicit reason",
            );
        if (result.state === "rejected" && result.candidate !== undefined)
            assertViewProviderJson(result.candidate);
        assertPinnedInput();
        context.signal.throwIfAborted();
        await context.assertEligible("return");
        return structuredClone(result);
    }
}

function validateProviderStage(stage: string): void {
    if (typeof stage !== "string" || !/^[a-z][a-z0-9.-]{0,127}$/.test(stage))
        throw new Error("Invalid view provider stage");
}

export function validateExtensionDefinition(
    definition: ViewDefinitionInput,
): void {
    if (definition.kind !== "extension") {
        if (definition.extension !== undefined)
            throw new Error(
                "Provider configuration requires an extension view",
            );
        return;
    }
    const extension = definition.extension;
    if (
        !extension ||
        Object.keys(extension).some(
            (key) => !["provider", "configuration"].includes(key),
        )
    )
        throw new Error(
            "An extension view requires a pinned provider and data-only configuration",
        );
    validateViewProviderIdentity(extension.provider);
    assertViewProviderJson(extension.configuration);
}

export function validateExtensionContent(
    definition: ViewDefinitionInput,
    content: ExtensionViewContent,
): void {
    validateExtensionDefinition(definition);
    validateViewProviderIdentity(content.provider);
    if (viewHash(content.provider) !== viewHash(definition.extension?.provider))
        throw new Error(
            "Extension content provider differs from its pinned definition",
        );
    assertViewProviderJson(content.data);
}

export function viewProviderOutput(
    input: Readonly<ViewBuildSnapshot>,
    document: ViewProviderDocument,
): ViewSynthesisOutput {
    if (!input.definition.extension)
        throw new Error(
            "Provider output requires a pinned extension definition",
        );
    const relationships: ViewSynthesisOutput["relationships"] =
        document.statements.flatMap((statement) =>
            statement.citations.map((citation, index) => ({
                id: `support:${statement.id}:${index}`,
                predicate: "supportedBy" as const,
                from: {
                    kind: "section" as const,
                    viewId: input.definition.viewId,
                    sectionId: statement.id,
                },
                to: {
                    kind: "source" as const,
                    sourceId: citation.sourceId,
                    revisionId: citation.revisionId,
                    ...(citation.evidence
                        ? { evidence: citation.evidence }
                        : {}),
                },
                citations: [citation],
            })),
        );
    return {
        content: {
            kind: "extension",
            provider: input.definition.extension.provider,
            title: document.title,
            data: document.data,
            sections: document.statements.map((statement) => ({
                id: statement.id,
                role: "context",
                heading: statement.id,
                body: statement.text,
            })),
            citations: [
                ...new Map(
                    relationships.flatMap((edge) =>
                        edge.citations.map(
                            (citation) =>
                                [viewHash(citation), citation] as const,
                        ),
                    ),
                ).values(),
            ],
        },
        relationships,
        outcome: "structuredExplanation",
        missingEvidence: document.missingEvidence,
    };
}
