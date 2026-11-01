// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ExtensionViewContent,
    ViewExtensionProvider,
    ViewJsonValue,
    ViewPayloadSchema,
    ViewProviderContext,
    ViewProviderIdentity,
    ViewSourceManifest,
    ViewExtensionCapabilities,
    ViewProviderDiscoveryInput,
} from "./viewExtensionTypes.js";
import {
    RequestBudget,
    runWithRequestBudget,
    RequestAdmissionError,
} from "@typeagent/aiclient";
import type {
    ViewBuildSnapshot,
    ViewDefinitionInput,
    ViewRelationshipInput,
    ViewSynthesisOutput,
} from "./viewTypes.js";
import {
    assertViewIdentifier,
    viewHash,
    viewSourceKey,
} from "./viewContent.js";

export class ViewExtensionUnavailable extends Error {}

export { viewHash as viewExtensionDigest } from "./viewContent.js";

export function assertViewJson(
    value: unknown,
    depth = 0,
): asserts value is ViewJsonValue {
    if (depth > 24) throw new Error("Structured view exceeds nesting limit");
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value === "string" && value.length <= 1_000_000) return;
    if (Array.isArray(value)) {
        if (value.length > 4096)
            throw new Error("Structured view array overflow");
        for (const entry of value) assertViewJson(entry, depth + 1);
        return;
    }
    if (value && typeof value === "object") {
        const prototype: unknown = Object.getPrototypeOf(value);
        if (prototype !== null && Object.getPrototypeOf(prototype) !== null)
            throw new Error("Structured views require plain JSON objects");
        const entries = Object.entries(value);
        if (entries.length > 4096)
            throw new Error("Structured view object overflow");
        for (const [key, entry] of entries) {
            if (["__proto__", "constructor", "prototype"].includes(key))
                throw new Error("Unsupported structured view key");
            assertViewJson(entry, depth + 1);
        }
        return;
    }
    throw new Error("Invalid structured view JSON");
}

function validatePayload(
    schema: ViewPayloadSchema,
    value: ViewJsonValue,
): void {
    switch (schema.type) {
        case "null":
            if (value !== null) throw new Error("Expected null view field");
            return;
        case "string":
            if (typeof value !== "string" || value.length > schema.maxLength)
                throw new Error("Invalid string view field");
            return;
        case "number":
        case "boolean":
            if (typeof value !== schema.type)
                throw new Error("Invalid primitive view field");
            return;
        case "array":
            if (!Array.isArray(value) || value.length > schema.maxItems)
                throw new Error("Invalid array view field");
            for (const entry of value) validatePayload(schema.items, entry);
            return;
        case "union":
            if (
                !schema.variants.some((variant) =>
                    payloadMatches(variant, value),
                )
            )
                throw new Error(
                    "View field does not match any bounded schema variant",
                );
            return;
        case "object":
            if (!value || typeof value !== "object" || Array.isArray(value))
                throw new Error("Expected object view field");
            if (schema.required.some((key) => !(key in value)))
                throw new Error("Missing required view field");
            for (const [key, entry] of Object.entries(value)) {
                if (
                    !Object.prototype.hasOwnProperty.call(
                        schema.properties,
                        key,
                    )
                )
                    throw new Error("Unknown structured view field");
                validatePayload(schema.properties[key], entry);
            }
    }
}

function payloadMatches(
    schema: ViewPayloadSchema,
    value: ViewJsonValue,
): boolean {
    try {
        validatePayload(schema, value);
        return true;
    } catch {
        return false;
    }
}

function validateSchema(value: ViewPayloadSchema, depth = 0): void {
    if (!value || depth > 24) throw new Error("Invalid provider output schema");
    const fields: Record<ViewPayloadSchema["type"], readonly string[]> = {
        null: ["type"],
        number: ["type"],
        boolean: ["type"],
        string: ["type", "maxLength"],
        array: ["type", "items", "maxItems"],
        union: ["type", "variants"],
        object: ["type", "properties", "required"],
    };
    const allowed = fields[value.type];
    if (!allowed || Object.keys(value).some((key) => !allowed.includes(key)))
        throw new Error(
            "Unsupported provider schema field or remote reference",
        );
    switch (value.type) {
        case "null":
        case "number":
        case "boolean":
            return;
        case "string":
            bounded(value.maxLength, 1_000_000, "schema string bound");
            return;
        case "array":
            bounded(value.maxItems, 4096, "schema array bound");
            validateSchema(value.items, depth + 1);
            return;
        case "union":
            if (
                !Array.isArray(value.variants) ||
                value.variants.length < 2 ||
                value.variants.length > 8
            )
                throw new Error(
                    "Provider schema unions require 2 to 8 bounded variants",
                );
            for (const variant of value.variants)
                validateSchema(variant, depth + 1);
            return;
        case "object":
            if (
                !value.properties ||
                !Array.isArray(value.required) ||
                value.required.some(
                    (key) =>
                        !Object.prototype.hasOwnProperty.call(
                            value.properties,
                            key,
                        ),
                ) ||
                new Set(value.required).size !== value.required.length
            )
                throw new Error("Invalid provider object schema");
            for (const field of Object.values(value.properties))
                validateSchema(field, depth + 1);
            return;
        default:
            throw new Error("Unsupported provider output schema");
    }
}

function bounded(value: number, maximum: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
        throw new Error(`Invalid ${label}`);
}

export function assertProviderIdentity(identity: ViewProviderIdentity): void {
    for (const key of [
        "providerId",
        "version",
        "inputContract",
        "outputContract",
    ] as const)
        assertViewIdentifier(key, identity?.[key]);
    for (const key of [
        "implementationDigest",
        "schemaDigest",
        "recipeDigest",
    ] as const)
        if (!/^[a-f0-9]{64}$/.test(identity?.[key]))
            throw new Error(`Invalid provider ${key}`);
}

export function validateExtensionDefinition(
    definition: ViewDefinitionInput,
): void {
    const extension = definition.extension;
    if ((definition.kind === "extension") !== !!extension)
        throw new Error(
            "Extension views require an installed provider definition",
        );
    if (!extension) return;
    if (
        definition.viewId !==
        extensionViewId(
            extension.providerId,
            extension.definitionId,
            extension.targetKey,
        )
    )
        throw new Error(
            "Extension view ID must identify its stable provider/definition/group target",
        );
    assertProviderIdentity(extension);
    for (const key of [
        "definitionId",
        "targetKey",
        "eligibilityVersion",
    ] as const)
        assertViewIdentifier(key, extension[key]);
    if (!/^[a-f0-9]{64}$/.test(extension.policyDigest))
        throw new Error("Invalid extension approval policy digest");
    assertViewJson(extension.parameters);
    if (JSON.stringify(extension.parameters).length > 120000)
        throw new Error("Extension instance parameters overflow");
    if (
        definition.maintenance ||
        definition.wiki ||
        definition.projectSummary ||
        definition.schemaView
    )
        throw new Error("Extension qualification owns its exact target scope");
    if (
        Object.keys(extension).some(
            (key) =>
                ![
                    "providerId",
                    "version",
                    "implementationDigest",
                    "inputContract",
                    "outputContract",
                    "schemaDigest",
                    "recipeDigest",
                    "definitionId",
                    "targetKey",
                    "eligibilityVersion",
                    "policyDigest",
                    "parameters",
                ].includes(key),
        )
    )
        throw new Error("Unsupported provider definition field");
}

export function extensionViewId(
    providerId: string,
    definitionId: string,
    targetKey: string,
): string {
    return `extension:${viewHash([providerId, definitionId, targetKey])}`;
}

export function expandViewManifest(
    input: string,
    corpusId: string,
    maximum: number,
): ViewSourceManifest {
    const parsed: unknown = JSON.parse(input);
    assertViewJson(parsed);
    if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        parsed.schemaVersion !== 1 ||
        parsed.corpusId !== corpusId ||
        !Array.isArray(parsed.members) ||
        !parsed.members.length ||
        parsed.members.length > maximum ||
        Object.keys(parsed).some(
            (key) => !["schemaVersion", "corpusId", "members"].includes(key),
        )
    )
        throw new Error("Invalid, cross-corpus or overflowing source manifest");
    const members: ViewSourceManifest["members"] = [];
    const ids = new Set<string>();
    for (const member of parsed.members) {
        if (
            !member ||
            typeof member !== "object" ||
            Array.isArray(member) ||
            typeof member.sourceId !== "string" ||
            typeof member.revisionId !== "string" ||
            typeof member.contentHash !== "string" ||
            !/^[a-f0-9]{64}$/.test(member.contentHash) ||
            Object.keys(member).some(
                (key) =>
                    !["sourceId", "revisionId", "contentHash"].includes(key),
            )
        )
            throw new Error("Invalid source manifest member");
        assertViewIdentifier("source ID", member.sourceId);
        assertViewIdentifier("revision ID", member.revisionId);
        if (ids.has(member.sourceId))
            throw new Error("Duplicate source manifest member");
        ids.add(member.sourceId);
        members.push({
            sourceId: member.sourceId,
            revisionId: member.revisionId,
            contentHash: member.contentHash,
        });
    }
    return { schemaVersion: 1, corpusId, members };
}

export class ViewExtensionRegistry {
    private readonly installed = new Map<string, ViewExtensionProvider>();

    public constructor(providers: readonly ViewExtensionProvider[] = []) {
        if (providers.length > 64)
            throw new Error("Provider registration bound exceeded");
        for (const provider of providers) {
            const { descriptor } = provider;
            if (
                typeof descriptor.label !== "string" ||
                !descriptor.label.trim() ||
                descriptor.label.length > 200 ||
                !Array.isArray(descriptor.definitions) ||
                !descriptor.definitions.length ||
                descriptor.definitions.length > 64
            )
                throw new Error(
                    "Invalid provider label or definition inventory",
                );
            if (descriptor.apiVersion !== 1)
                throw new ViewExtensionUnavailable(
                    "Unsupported provider API version",
                );
            assertProviderIdentity(descriptor.identity);
            assertViewJson(descriptor.outputSchema);
            validateSchema(descriptor.outputSchema);
            if (
                viewHash(descriptor.outputSchema) !==
                descriptor.identity.schemaDigest
            )
                throw new Error("Provider output schema digest mismatch");
            const id = descriptor.identity.providerId;
            if (this.installed.has(id))
                throw new Error("Duplicate provider identity");
            const definitions = new Set<string>();
            for (const definition of descriptor.definitions) {
                assertViewIdentifier("definition ID", definition.id);
                assertViewIdentifier(
                    "eligibility version",
                    definition.eligibilityVersion,
                );
                if (
                    !["static", "decision"].includes(definition.mode) ||
                    definitions.has(definition.id)
                )
                    throw new Error("Invalid or duplicate provider definition");
                definitions.add(definition.id);
            }

            bounded(
                descriptor.limits.maxSources,
                4096,
                "provider source bound",
            );
            bounded(
                descriptor.limits.maxInputChars,
                8_000_000,
                "provider input bound",
            );
            bounded(
                descriptor.limits.maxOutputChars,
                1_000_000,
                "provider output bound",
            );
            bounded(
                descriptor.limits.maxModelCalls,
                64,
                "provider model-call bound",
            );
            bounded(
                descriptor.limits.timeoutMs,
                3_600_000,
                "provider deadline",
            );
            this.installed.set(id, provider);
        }
    }

    public async discover(
        input: ViewProviderDiscoveryInput,
    ): Promise<ViewDefinitionInput[]> {
        const found = new Map<string, ViewDefinitionInput>();
        for (const provider of this.installed.values()) {
            if (!provider.discover) continue;
            const targets = await runWithRequestBudget(
                new RequestBudget({
                    tokenizer: "discovery-inference-disabled",
                    countTokens: () => {
                        throw new RequestAdmissionError(
                            "Target discovery cannot dispatch inference",
                        );
                    },
                    chatAttempts: 1,
                    embeddingAttempts: 1,
                    inputTokens: 1,
                    outputTokens: 1,
                    reservedTokens: 1,
                    safetyTokens: 1,
                    elapsedMs: 60000,
                }),
                () => provider.discover!(structuredClone(input)),
            );
            if (!Array.isArray(targets) || targets.length > 4096)
                throw new Error(
                    "Provider target discovery overflow or invalid result",
                );
            for (const definition of targets) {
                validateExtensionDefinition(definition);
                if (
                    definition.extension!.providerId !==
                    provider.descriptor.identity.providerId
                )
                    throw new Error(
                        "Provider cannot discover targets for another provider",
                    );
                const previous = found.get(definition.viewId);
                if (previous && viewHash(previous) !== viewHash(definition))
                    throw new Error(
                        "Conflicting discovered definitions for one stable group target",
                    );
                found.set(definition.viewId, definition);
            }
        }
        return [...found.values()];
    }

    public capabilities(): ViewExtensionCapabilities {
        return {
            apiVersion: 1,
            sourceManifestVersion: 1,
            templateVersion: 1,
            providers: [...this.installed.values()].map(({ descriptor }) => ({
                identity: structuredClone(descriptor.identity),
                label: descriptor.label,
                definitions: structuredClone(descriptor.definitions),
            })),
        };
    }

    public resolve(input: ViewBuildSnapshot): ViewExtensionProvider {
        const definition = input.definition.extension;
        const provider =
            definition && this.installed.get(definition.providerId);
        if (
            !definition ||
            !provider ||
            viewHash(provider.descriptor.identity) !==
                viewHash({
                    providerId: definition.providerId,
                    version: definition.version,
                    implementationDigest: definition.implementationDigest,
                    inputContract: definition.inputContract,
                    outputContract: definition.outputContract,
                    schemaDigest: definition.schemaDigest,
                    recipeDigest: definition.recipeDigest,
                }) ||
            !provider.descriptor.definitions.some(
                (entry) =>
                    entry.id === definition.definitionId &&
                    entry.eligibilityVersion === definition.eligibilityVersion,
            )
        )
            throw new ViewExtensionUnavailable(
                "Missing or mismatched installed view provider",
            );
        return provider;
    }

    public async authorize(
        input: ViewBuildSnapshot,
        operation: Parameters<ViewExtensionProvider["authorize"]>[1],
    ): Promise<void> {
        const provider = this.resolve(input);
        if (!(await provider.authorize(structuredClone(input), operation)))
            throw new ViewExtensionUnavailable(
                "Provider scope is not authorized",
            );
    }

    public async generate(
        input: ViewBuildSnapshot,
        context: ViewProviderContext,
    ): Promise<ViewSynthesisOutput> {
        await this.authorize(input, "build");
        const provider = this.resolve(input);
        const prepared = await provider.prepare(structuredClone(input));
        assertViewJson(prepared);
        await context.checkpoint("prepared");
        const content = await provider.generate(
            structuredClone(input),
            prepared,
            context,
        );
        assertViewJson(content.payload);
        validatePayload(provider.descriptor.outputSchema, content.payload);
        if (
            content.kind !== "extension" ||
            content.construction !== "extension-v1" ||
            viewHash(content.provider) !==
                viewHash(provider.descriptor.identity) ||
            JSON.stringify(content).length >
                provider.descriptor.limits.maxOutputChars
        )
            throw new Error(
                "Invalid provider artifact identity or output overflow",
            );
        validateExtensionContent(input, content);
        await context.checkpoint("constructed");
        await this.authorize(input, "accept");
        const relationships: ViewRelationshipInput[] = content.evidence.flatMap(
            (binding) =>
                [
                    ...binding.support.map((citation, index) => ({
                        citation,
                        index,
                        role: "support" as const,
                    })),
                    ...binding.opposition.map((citation, index) => ({
                        citation,
                        index,
                        role: "opposition" as const,
                    })),
                ].map(({ citation, index, role }) => ({
                    id: `${binding.blockId}.${role}.${index}`,
                    predicate: role === "support" ? "supportedBy" : "dependsOn",
                    from: {
                        kind: "section",
                        viewId: input.definition.viewId,
                        sectionId: binding.blockId,
                    },
                    to: {
                        kind: "source",
                        sourceId: citation.sourceId,
                        revisionId: citation.revisionId,
                    },
                    citations: [citation],
                })),
        );
        return {
            content,
            relationships: coalesceExtensionRelationships(relationships),
            outcome: "extensionArtifact",
            missingEvidence: [],
        };
    }
}

function coalesceExtensionRelationships(
    relationships: ViewRelationshipInput[],
): ViewRelationshipInput[] {
    const unique = new Map<string, ViewRelationshipInput>();
    for (const edge of relationships) {
        const key = JSON.stringify([edge.predicate, edge.from, edge.to]);
        const previous = unique.get(key);
        if (previous) previous.citations.push(...edge.citations);
        else unique.set(key, edge);
    }
    return [...unique.values()];
}

export function validateExtensionContent(
    input: ViewBuildSnapshot,
    content: ExtensionViewContent,
): void {
    validateInputUse(input, content);
    validateBlockEvidence(content);
    validatePresentation(content);
}

function validateInputUse(
    input: ViewBuildSnapshot,
    content: ExtensionViewContent,
): void {
    const members = new Set(input.inputs.map(viewSourceKey));
    const used = new Set(
        content.evidence.flatMap((entry) =>
            [...entry.support, ...entry.opposition].map(viewSourceKey),
        ),
    );
    if (
        content.inputUse.length !== members.size ||
        new Set(content.inputUse.map(viewSourceKey)).size !== members.size ||
        content.inputUse.some(
            (entry) =>
                !members.has(viewSourceKey(entry)) ||
                entry.disposition !==
                    (used.has(viewSourceKey(entry))
                        ? "represented"
                        : "unused") ||
                typeof entry.reason !== "string" ||
                !entry.reason.trim() ||
                entry.reason.length > 2000,
        )
    )
        throw new Error("Provider did not account for every exact input");
}

function validateBlockEvidence(content: ExtensionViewContent): void {
    const blocks = new Set(content.sections.map((section) => section.id));
    if (blocks.size !== content.sections.length || !blocks.size)
        throw new Error("Invalid provider readable block identities");
    for (const section of content.sections)
        assertViewIdentifier("readable block ID", section.id);
    if (
        content.evidence.length !== blocks.size ||
        new Set(content.evidence.map((binding) => binding.blockId)).size !==
            blocks.size ||
        content.evidence.some(
            (binding) =>
                !blocks.has(binding.blockId) || !binding.support.length,
        )
    )
        throw new Error("Missing exact provider block evidence");
}

function validatePresentation(content: ExtensionViewContent): void {
    const blocks = new Set(content.sections.map((section) => section.id));
    const presentation = content.presentation;
    if (
        presentation.schemaVersion !== 1 ||
        presentation.templateVersion !== 1 ||
        !["document-v1", "grouped-cards-v1", "table-v1", "sources-v1"].includes(
            presentation.templateId,
        ) ||
        !presentation.layouts.length ||
        presentation.layouts.length > 16 ||
        presentation.layouts.some((layout) =>
            layout.groups.some((group) =>
                group.blockIds.some((id) => !blocks.has(id)),
            ),
        )
    )
        throw new Error("Unsupported or invalid view presentation");
    const layoutIds = new Set<string>();
    for (const layout of presentation.layouts) {
        assertViewIdentifier("layout ID", layout.id);
        if (
            layoutIds.has(layout.id) ||
            !layout.label?.trim() ||
            layout.label.length > 240 ||
            layout.groups.length > 4096
        )
            throw new Error("Invalid or duplicate layout identity");
        layoutIds.add(layout.id);
        const groupIds = new Set<string>();
        for (const group of layout.groups) {
            assertViewIdentifier("layout group ID", group.id);
            if (
                groupIds.has(group.id) ||
                !group.label?.trim() ||
                group.label.length > 240 ||
                group.blockIds.length > 4096 ||
                new Set(group.blockIds).size !== group.blockIds.length
            )
                throw new Error("Invalid or duplicate presentation group");
            groupIds.add(group.id);
        }
    }
}
