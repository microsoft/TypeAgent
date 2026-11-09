// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFile } from "node:fs/promises";
import {
    viewExtensionDigest,
    type ExtensionViewContent,
    type ViewBuildSnapshot,
    type ViewCitation,
    type ViewExtensionProvider,
    type ViewSection,
    type ViewRetainedInput,
} from "@typeagent/memory-service";
import {
    parseProcedureSource,
    orderingConflictIds,
    procedurePayloadSchema,
    type ProcedureRecord,
    type ProcedureDocument,
} from "./contract.js";

export const procedureProviderId = "typeagent-support-procedure";
export const procedureDefinitionId = "support-procedure";
export type ProcedureHostContext = {
    corpusId: string;
    sourceIds: string[];
    authorize: ViewExtensionProvider["authorize"];
};

export function hostContext(value: unknown): ProcedureHostContext {
    if (
        !value ||
        typeof value !== "object" ||
        !("corpusId" in value) ||
        typeof value.corpusId !== "string" ||
        !value.corpusId ||
        !("sourceIds" in value) ||
        !Array.isArray(value.sourceIds) ||
        !value.sourceIds.length ||
        !value.sourceIds.every(
            (source: unknown) =>
                typeof source === "string" && source.length > 0,
        ) ||
        !("authorize" in value) ||
        typeof value.authorize !== "function"
    )
        throw new Error(
            "Procedure provider requires explicit corpus, source allowlist, and authorization callback",
        );
    return value as ProcedureHostContext;
}

function recordText(record: ProcedureRecord): string {
    switch (record.kind) {
        case "transition":
            return `${record.from} -> ${record.to}\nCondition: ${record.condition}`;
        case "step":
            return `${record.text}\nRequired inputs: ${record.requiredInputs.join(", ") || "none specified"}\nExpected observation: ${record.expectedObservation ?? "unknown; do not infer"}`;
        case "outcome":
            return `${record.text}\nTerminal outcome: ${record.result}`;
        case "actionCollection":
            return `${record.text}\nOption ordering: ${record.order === "any-order" ? "any order; not a mandatory checklist" : "not specified by the source"}`;
        case "workflow":
            return `${record.text}\nSource ordering constraints only; node listing is not execution order or a mandatory checklist.`;
        case "orderingConstraint":
            return `${record.before} before ${record.after}\nSource condition: ${record.condition}`;
        case "decisionTable":
            return `${record.text}\n${record.rows.map((row) => row.map((cell, index) => `${record.columns[index]}: ${cell}`).join("\n")).join("\n\n")}`;
        case "action":
            return [
                record.text,
                `Source action: ${record.canonicalAction ?? "not specified"}`,
                `Information requests: ${record.informationRequests === null ? "not specified" : record.informationRequests.join(", ") || "explicitly none"}`,
                `Form instruction: ${record.formInstruction ?? "not specified"}`,
                ...(record.sequence?.length
                    ? [
                          `Within-option ordering:\n${record.sequence.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
                      ]
                    : []),
                ...(record.selectionCondition
                    ? [`Selection condition: ${record.selectionCondition}`]
                    : []),
                ...(record.expectedObservation
                    ? [`Expected observation: ${record.expectedObservation}`]
                    : []),
            ].join("\n");
        default:
            return record.text;
    }
}
function role(record: ProcedureRecord): ViewSection["role"] {
    switch (record.kind) {
        case "prerequisite":
            return "prerequisites";
        case "guard":
        case "policy":
        case "transition":
        case "orderingConstraint":
            return "guard";
        case "step":
        case "action":
        case "actionCollection":
        case "workflow":
        case "decisionTable":
            return "diagnostic";
        case "description":
            return "description";
        case "outcome":
            return record.result === "resolved" ? "verification" : "recovery";
        default:
            return "context";
    }
}

export function constructProcedureContent(
    snapshot: ViewBuildSnapshot,
    identity: ViewExtensionProvider["descriptor"]["identity"],
): ExtensionViewContent {
    if (!snapshot.inputs.length || snapshot.inputs.length > 4)
        throw new Error(
            "Procedure view requires 1 to 4 exact retained sources",
        );
    const inputs = snapshot.inputs.map((source) => {
        if (source.passages || source.evidence)
            throw new Error(
                "Procedure-v1 requires full retained document text, not indexed or event passages",
            );
        return { source, document: parseProcedureSource(source.content) };
    });
    return renderProcedureDocuments(snapshot, identity, inputs);
}

export function renderProcedureDocuments(
    snapshot: ViewBuildSnapshot,
    identity: ViewExtensionProvider["descriptor"]["identity"],
    inputs: Array<{ source: ViewRetainedInput; document: ProcedureDocument }>,
): ExtensionViewContent {
    const procedureId = inputs[0].document.header.procedureId;
    if (
        snapshot.definition.extension?.targetKey !== procedureId ||
        inputs.some(
            ({ document }) => document.header.procedureId !== procedureId,
        )
    )
        throw new Error(
            "Procedure target must match every selected source procedureId",
        );
    const signatures = inputs.map(({ document }) =>
        viewExtensionDigest({
            header: document.header,
            records: document.records.map(({ record }) => record),
        }),
    );
    const conflicted =
        new Set(signatures).size > 1 ||
        inputs.some(
            ({ document }) =>
                document.records.some((entry) => entry.opposition?.length) ||
                orderingConflictIds(
                    document.records.map(({ record }) => record),
                ).length > 0,
        );
    const sections: ViewSection[] = [];
    const evidence: ExtensionViewContent["evidence"] = [];
    const relationships: ExtensionViewContent["fidelity"]["relationships"] = [];
    const citations: ViewCitation[] = [];
    const procedures = inputs.map(({ source, document }, sourceIndex) => {
        const cite = (span: { start: number; end: number }): ViewCitation => ({
            sourceId: source.sourceId,
            revisionId: source.revisionId,
            locator: `chars:${span.start}-${span.end}`,
            excerpt: source.content.slice(span.start, span.end),
        });
        function block(
            blockId: string,
            section: Omit<ViewSection, "id">,
            support: ViewCitation[],
            opposition: ViewCitation[],
        ): void {
            sections.push({ id: blockId, ...section });
            citations.push(...support, ...opposition);
            evidence.push({ blockId, support, opposition });
            relationships.push({
                edgeId: `${blockId}.support.0`,
                supported: true,
                reason: "Retained procedure record with exact source evidence",
            });
            // The host coalesces repeated block-to-source relationships.
            const distinct = new Map<string, number>();
            opposition.forEach((citation, index) => {
                const key = `${citation.sourceId}:${citation.revisionId}`;
                if (!distinct.has(key)) {
                    distinct.set(key, index);
                    relationships.push({
                        edgeId: `${blockId}.opposition.${index}`,
                        supported: true,
                        reason: "Conflicting retained alternative; unresolved",
                    });
                }
            });
        }
        const prefix = `source-${sourceIndex}`;
        block(
            `${prefix}-goal`,
            {
                role: "description",
                heading: document.header.title,
                body: `Procedure: ${procedureId}\nEntry step: ${document.header.entryStep}\n${conflicted ? "Retained evidence conflicts. Alternatives are preserved; obtain human review before use." : "Documented procedure; guidance only, not execution."}`,
            },
            document.headerSupport ?? [cite(document.headerSpan)],
            conflicted
                ? inputs
                      .filter(
                          (_, index) =>
                              index !== sourceIndex &&
                              signatures[index] !== signatures[sourceIndex],
                      )
                      .map(({ source: other, document: otherDocument }) => ({
                          sourceId: other.sourceId,
                          revisionId: other.revisionId,
                          locator: `chars:${otherDocument.headerSpan.start}-${otherDocument.headerSpan.end}`,
                          excerpt: other.content.slice(
                              otherDocument.headerSpan.start,
                              otherDocument.headerSpan.end,
                          ),
                      }))
                : [],
        );
        const records = document.records.map((entry) => {
            const blockId = `${prefix}-record-${entry.record.id}`;
            const opposition = inputs.flatMap(
                ({ source: other, document: otherDocument }, index) => {
                    if (index === sourceIndex) return [];
                    const otherEntry = otherDocument.records.find(
                        ({ record }) => record.id === entry.record.id,
                    );
                    if (
                        !otherEntry ||
                        viewExtensionDigest(otherEntry.record) ===
                            viewExtensionDigest(entry.record)
                    )
                        return [];
                    return [
                        {
                            sourceId: other.sourceId,
                            revisionId: other.revisionId,
                            locator: `chars:${otherEntry.start}-${otherEntry.end}`,
                            excerpt: other.content.slice(
                                otherEntry.start,
                                otherEntry.end,
                            ),
                        },
                    ];
                },
            );
            block(
                blockId,
                {
                    role: role(entry.record),
                    heading:
                        entry.record.kind === "action" ||
                        entry.record.kind === "decisionTable"
                            ? entry.record.title
                            : entry.record.id,
                    body: recordText(entry.record),
                },
                entry.support ?? [cite(entry)],
                [...opposition, ...(entry.opposition ?? [])],
            );
            return { blockId, record: entry.record };
        });
        return {
            sourceId: source.sourceId,
            revisionId: source.revisionId,
            procedureId,
            title: document.header.title,
            entryStep: document.header.entryStep,
            records,
        };
    });
    return {
        kind: "extension",
        construction: "extension-v1",
        provider: identity,
        title: inputs[0].document.header.title,
        summary: conflicted
            ? "Conflicting source alternatives; no resolved procedure."
            : "Source-grounded support guidance; no automatic execution.",
        sections,
        citations,
        evidence,
        payload: {
            status: conflicted ? "conflicted" : "documented",
            procedures,
        },
        presentation: {
            schemaVersion: 1,
            templateId: "grouped-cards-v1",
            templateVersion: 1,
            layouts: [
                {
                    id: "procedure",
                    label: "Procedure alternatives",
                    groups: inputs.map((_, index) => ({
                        id: `source-${index}`,
                        label: `Retained source ${index + 1}`,
                        blockIds: sections
                            .filter((section) =>
                                section.id.startsWith(`source-${index}-`),
                            )
                            .map((section) => section.id),
                    })),
                },
            ],
        },
        inputUse: snapshot.inputs.map(({ sourceId, revisionId }) => ({
            sourceId,
            revisionId,
            disposition: "represented",
            reason: "Procedure blocks retain exact selected-source evidence",
        })),
        fidelity: {
            supported: true,
            sections: sections.map(({ id }) => ({
                sectionId: id,
                supported: true,
                reason: "Projection of evidence-bound retained procedure record",
            })),
            relationships,
            missingContext: [],
            reasons: conflicted
                ? ["Conflicting source alternatives require human review"]
                : [],
        },
    };
}

export async function createProcedureProvider(
    context: unknown,
): Promise<ViewExtensionProvider> {
    const host = hostContext(context);
    const [implementation, contract, recipe] = await Promise.all([
        readFile(new URL(import.meta.url), "utf8"),
        readFile(new URL("./contract.js", import.meta.url), "utf8"),
        readFile(new URL("./recipe.txt", import.meta.url), "utf8"),
    ]);
    const provider: ViewExtensionProvider = {
        descriptor: {
            apiVersion: 1,
            label: "Source-grounded support procedure (structured source format)",
            identity: {
                providerId: procedureProviderId,
                version: "1",
                implementationDigest: viewExtensionDigest([
                    implementation,
                    contract,
                ]),
                inputContract: "procedure-jsonl-v1",
                outputContract: "support-procedure-graph-v1",
                schemaDigest: viewExtensionDigest(procedurePayloadSchema),
                recipeDigest: viewExtensionDigest(recipe),
            },
            outputSchema: procedurePayloadSchema,
            definitions: [
                {
                    id: procedureDefinitionId,
                    eligibilityVersion: "1",
                    mode: "static",
                },
            ],
            limits: {
                maxSources: 4,
                maxInputChars: 120000,
                maxOutputChars: 1000000,
                maxModelCalls: 1,
                timeoutMs: 30000,
            },
        },
        authorize: async (snapshot, operation) =>
            operation !== "model" &&
            snapshot.corpusId === host.corpusId &&
            snapshot.inputs.length > 0 &&
            snapshot.inputs.every((input) =>
                host.sourceIds.includes(input.sourceId),
            ) &&
            (await host.authorize(snapshot, operation)),
        evaluateEligibility: async (snapshot) => {
            constructProcedureContent(snapshot, provider.descriptor.identity);
            return {
                disposition: "eligible",
                reason: "Validated bounded procedure-v1 source and acyclic graph",
            };
        },
        prepare: async (snapshot) => {
            constructProcedureContent(snapshot, provider.descriptor.identity);
            return { inputFingerprint: snapshot.fingerprint };
        },
        generate: async (snapshot, _prepared, execution) => {
            execution.signal.throwIfAborted();
            await execution.assertEligible?.();
            await execution.checkpoint("procedure-projection", {
                inputFingerprint: snapshot.fingerprint,
            });
            const content = constructProcedureContent(
                snapshot,
                provider.descriptor.identity,
            );
            await execution.recordCandidate?.(
                "procedure-projection",
                content.payload,
            );
            return content;
        },
        validateContent: (snapshot, content) => {
            const expected = constructProcedureContent(
                snapshot,
                provider.descriptor.identity,
            );
            if (viewExtensionDigest(content) !== viewExtensionDigest(expected))
                throw new Error(
                    "Procedure content differs from exact source-grounded projection",
                );
        },
    };
    return provider;
}
