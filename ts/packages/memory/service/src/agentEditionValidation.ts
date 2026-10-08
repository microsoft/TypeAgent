// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ProcedureDocument,
    ProcedureSaveRequest,
    ProcedureSourceCitation,
} from "./types.js";
import { redactRunbookText, redactRunbookValue } from "./runbookRedaction.js";
import {
    normalizeRunbookBindingArguments,
    validateRunbookBindingArguments,
    validateRunbookArgumentReadiness,
    type RunbookBindingArguments,
} from "./runbookArguments.js";
export { redactRunbookText, redactRunbookValue } from "./runbookRedaction.js";
export * from "./runbookArguments.js";

export interface RunbookAssetReference {
    sourceId: string;
    revisionId: string;
    assetId: string;
    description?: string;
}

export interface ProcedureEvidenceReferences {
    citations: ProcedureSourceCitation[];
    assets: RunbookAssetReference[];
}

export type RunbookBinding =
    | {
          kind: "mcp";
          accepted: boolean;
          serverId: string;
          targetId: string;
          version: string;
          fingerprint: string;
          arguments?: RunbookBindingArguments;
      }
    | {
          kind: "macro";
          accepted: boolean;
          targetId: string;
          version: number;
          fingerprint: string;
          arguments?: RunbookBindingArguments;
      }
    | {
          kind: "flow";
          accepted: boolean;
          targetId: string;
          version: string;
          fingerprint: string;
          arguments?: RunbookBindingArguments;
      }
    | { kind: "command"; accepted: boolean; text: string }
    | { kind: "manual"; accepted: boolean; reason: string };

export type CatalogRunbookBinding = Extract<
    RunbookBinding,
    { kind: "mcp" | "macro" | "flow" }
>;

export interface RunbookBindingValidation {
    binding: CatalogRunbookBinding;
    status: "accepted" | "unavailable" | "rejected" | "drifted";
    reason?: string;
    argumentsValidated?: boolean;
}

export interface RunbookBindingValidationContext {
    inputs: readonly AgentEditionInput[];
}

// Acceptance must check the actual target schema, including required arguments.
export type RunbookBindingValidator = (
    bindings: readonly CatalogRunbookBinding[],
    context: RunbookBindingValidationContext,
) => Promise<readonly RunbookBindingValidation[]>;

export interface AgentEditionInput {
    id: string;
    description: string;
    type: "string" | "number" | "boolean" | "enum";
    required: boolean;
    secret: boolean;
    enumValues?: string[];
    defaultValue?: string | number | boolean;
    examples?: Array<string | number | boolean>;
}

export interface AgentEditionStep {
    id: string;
    title: string;
    humanText: string;
    agentInstruction: string;
    binding?: RunbookBinding;
    safety: "readOnly" | "changesData" | "unknown";
    needsAttention?: boolean;
    attentionReasons?: string[];
    manualReason?: string;
    condition?: string;
    alternatives?: Array<{ condition: string; stepId: string }>;
    verification?: string;
    rollback?: string;
    citations: ProcedureSourceCitation[];
    assets?: RunbookAssetReference[];
}

export interface AgentEditionSynthesis {
    sourceReferences: ProcedureSourceCitation[];
    linkedDocuments?: ProcedureSourceCitation[];
    synthesizedAt?: string;
    model?: string;
    promptVersion?: string;
}

export type AgentEditionReview =
    | { state: "draft"; reason?: string }
    | {
          state: "reviewed";
          procedureVersion: number;
          contentHash: string;
          reviewedAt: string;
          safetyConfirmed: true;
          bindingValidation: "accepted";
          argumentsValidation?: "accepted";
      };

export interface AgentEdition {
    schemaVersion: 1;
    goal: string;
    applicability: string[];
    inputs: AgentEditionInput[];
    preconditions: string[];
    steps: AgentEditionStep[];
    verification: string[];
    rollback: string[];
    synthesis: AgentEditionSynthesis;
    review: AgentEditionReview;
}

export const agentEditionMarkdownMarker = "<!-- typeagent-agent-edition:1 -->";

function sortedJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortedJson);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, sortedJson(child)]),
        );
    }
    return value;
}

export function canonicalizeProcedure(value: unknown): string {
    return `${JSON.stringify(sortedJson(value), undefined, 2)}\n`;
}

export function getProcedureEvidenceReferences(
    document: Pick<ProcedureDocument, "citations" | "agentEdition">,
): ProcedureEvidenceReferences {
    const edition = document.agentEdition;
    const citations = [
        ...document.citations,
        ...(edition?.steps.flatMap((step) => step.citations) ?? []),
        ...(edition?.synthesis.sourceReferences ?? []),
        ...(edition?.synthesis.linkedDocuments ?? []),
    ];
    const assets = edition?.steps.flatMap((step) => step.assets ?? []) ?? [];
    return structuredClone({
        citations: [
            ...new Map(
                citations.map((citation) => [
                    canonicalizeProcedure(citation),
                    citation,
                ]),
            ).values(),
        ],
        assets: [
            ...new Map(
                assets.map((asset) => [canonicalizeProcedure(asset), asset]),
            ).values(),
        ],
    });
}

function record(value: unknown, field: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${field} must be an object`);
    }
    return value as Record<string, unknown>;
}

function text(value: unknown, field: string): asserts value is string {
    if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 1_000_000
    ) {
        throw new Error(`${field} must be non-empty bounded text`);
    }
}

function identifier(value: unknown, field: string): void {
    text(value, field);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
        throw new Error(`${field} must be a stable identifier`);
    }
}

export function validateRunbookCatalogIdentity(
    value: unknown,
): asserts value is string {
    text(value, "catalog identity");
    if (value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value))
        throw new Error(
            "Catalog identity must be bounded text without control characters",
        );
}

function list(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value) || value.length > 10_000) {
        throw new Error(`${field} must be a bounded array`);
    }
    return value;
}

function textList(value: unknown, field: string): void {
    list(value, field).forEach((entry) => text(entry, field));
}

function optionalText(value: unknown, field: string): void {
    if (value !== undefined) text(value, field);
}

function knownKeys(
    value: Record<string, unknown>,
    keys: readonly string[],
    field: string,
): void {
    if (Object.keys(value).some((key) => !keys.includes(key))) {
        throw new Error(`${field} contains unsupported fields`);
    }
}

function boolean(value: unknown, field: string): void {
    if (typeof value !== "boolean") throw new Error(`${field} must be boolean`);
}

function validateCitations(value: unknown, field: string): void {
    for (const entry of list(value, field)) {
        const citation = record(entry, field);
        knownKeys(
            citation,
            ["sourceId", "revisionId", "locator", "excerpt"],
            field,
        );
        identifier(citation.sourceId, "sourceId");
        identifier(citation.revisionId, "revisionId");
        optionalText(citation.locator, "locator");
        optionalText(citation.excerpt, "excerpt");
    }
}

function validateAssets(value: unknown): void {
    for (const entry of list(value, "assets")) {
        const asset = record(entry, "asset");
        knownKeys(
            asset,
            ["sourceId", "revisionId", "assetId", "description"],
            "asset",
        );
        identifier(asset.sourceId, "sourceId");
        identifier(asset.revisionId, "revisionId");
        identifier(asset.assetId, "assetId");
        optionalText(asset.description, "description");
    }
}

export function validateRunbookBinding(
    value: unknown,
): asserts value is RunbookBinding {
    const binding = record(value, "binding");
    boolean(binding.accepted, "binding.accepted");
    if (binding.kind === "manual") {
        knownKeys(binding, ["kind", "accepted", "reason"], "binding");
        text(binding.reason, "manual reason");
        return;
    }
    if (binding.kind === "command") {
        knownKeys(binding, ["kind", "accepted", "text"], "binding");
        text(binding.text, "command text");
        return;
    }
    if (!["mcp", "macro", "flow"].includes(String(binding.kind))) {
        throw new Error("Unsupported runbook binding kind");
    }
    knownKeys(
        binding,
        [
            "kind",
            "accepted",
            "targetId",
            "version",
            "fingerprint",
            "arguments",
            ...(binding.kind === "mcp" ? ["serverId"] : []),
        ],
        "binding",
    );
    if (binding.kind === "mcp")
        validateRunbookCatalogIdentity(binding.targetId);
    else identifier(binding.targetId, "binding.targetId");
    text(binding.fingerprint, "binding.fingerprint");
    if (binding.kind === "macro") {
        if (
            !Number.isSafeInteger(binding.version) ||
            Number(binding.version) < 1
        ) {
            throw new Error("Macro binding version must be a positive integer");
        }
    } else {
        text(binding.version, "binding.version");
    }
    if (binding.kind === "mcp")
        validateRunbookCatalogIdentity(binding.serverId);
    if (binding.arguments !== undefined)
        validateRunbookBindingArguments(binding.arguments);
}

export function validateAgentEditionInput(
    value: unknown,
): asserts value is AgentEditionInput {
    validateInput(value);
}

function validateInput(value: unknown): string {
    const input = record(value, "input");
    knownKeys(
        input,
        [
            "id",
            "description",
            "type",
            "required",
            "secret",
            "enumValues",
            "defaultValue",
            "examples",
        ],
        "input",
    );
    identifier(input.id, "input.id");
    text(input.description, "input.description");
    boolean(input.required, "input.required");
    boolean(input.secret, "input.secret");
    if (!["string", "number", "boolean", "enum"].includes(String(input.type))) {
        throw new Error("Unsupported input type");
    }
    if (
        input.secret === true &&
        (input.examples !== undefined ||
            input.defaultValue !== undefined ||
            input.enumValues !== undefined)
    ) {
        throw new Error(
            "Secret inputs cannot retain example, default, or enum literals",
        );
    }
    if (input.enumValues !== undefined)
        textList(input.enumValues, "enumValues");
    if (
        input.type === "enum" &&
        input.secret !== true &&
        list(input.enumValues, "enumValues").length === 0
    ) {
        throw new Error("Enum inputs require values");
    }
    const examples =
        input.examples === undefined ? [] : list(input.examples, "examples");
    for (const literal of [
        ...examples,
        ...(input.defaultValue === undefined ? [] : [input.defaultValue]),
    ]) {
        const expectedType = input.type === "enum" ? "string" : input.type;
        if (
            typeof literal !== expectedType ||
            (typeof literal === "number" && !Number.isFinite(literal))
        ) {
            throw new Error("Input literal does not match its type");
        }
        if (
            input.type === "enum" &&
            !(input.enumValues as string[]).includes(literal as string)
        ) {
            throw new Error("Input literal is not an enum value");
        }
    }
    return input.id as string;
}

function validateStep(value: unknown): string {
    const step = record(value, "step");
    knownKeys(
        step,
        [
            "id",
            "title",
            "humanText",
            "agentInstruction",
            "binding",
            "safety",
            "needsAttention",
            "attentionReasons",
            "manualReason",
            "condition",
            "alternatives",
            "verification",
            "rollback",
            "citations",
            "assets",
        ],
        "step",
    );
    identifier(step.id, "step.id");
    for (const field of ["title", "humanText", "agentInstruction"])
        text(step[field], `step.${field}`);
    if (!["readOnly", "changesData", "unknown"].includes(String(step.safety))) {
        throw new Error("Unsupported step safety");
    }
    if (step.binding !== undefined) validateRunbookBinding(step.binding);
    if (step.needsAttention !== undefined)
        boolean(step.needsAttention, "needsAttention");
    if (step.attentionReasons !== undefined)
        textList(step.attentionReasons, "attentionReasons");
    for (const field of [
        "manualReason",
        "condition",
        "verification",
        "rollback",
    ])
        optionalText(step[field], field);
    validateCitations(step.citations, "step citations");
    if (step.assets !== undefined) validateAssets(step.assets);
    if (step.alternatives !== undefined) {
        for (const value of list(step.alternatives, "alternatives")) {
            const alternative = record(value, "alternative");
            knownKeys(alternative, ["condition", "stepId"], "alternative");
            text(alternative.condition, "alternative condition");
            identifier(alternative.stepId, "alternative stepId");
        }
    }
    return step.id as string;
}

function uniqueIds(ids: string[], field: string): void {
    if (new Set(ids).size !== ids.length)
        throw new Error(`Duplicate ${field} IDs`);
}

function validateSynthesis(value: unknown): void {
    const synthesis = record(value, "synthesis");
    knownKeys(
        synthesis,
        [
            "sourceReferences",
            "linkedDocuments",
            "synthesizedAt",
            "model",
            "promptVersion",
        ],
        "synthesis",
    );
    validateCitations(synthesis.sourceReferences, "synthesis sourceReferences");
    if (synthesis.linkedDocuments !== undefined)
        validateCitations(synthesis.linkedDocuments, "linkedDocuments");
    for (const field of ["synthesizedAt", "model", "promptVersion"])
        optionalText(synthesis[field], field);
}

function validateReview(value: unknown): void {
    const review = record(value, "review");
    if (review.state === "draft") {
        knownKeys(review, ["state", "reason"], "review");
        optionalText(review.reason, "review reason");
        return;
    }
    knownKeys(
        review,
        [
            "state",
            "procedureVersion",
            "contentHash",
            "reviewedAt",
            "safetyConfirmed",
            "bindingValidation",
            "argumentsValidation",
        ],
        "review",
    );
    if (
        review.state !== "reviewed" ||
        review.safetyConfirmed !== true ||
        review.bindingValidation !== "accepted" ||
        (review.argumentsValidation !== undefined &&
            review.argumentsValidation !== "accepted")
    ) {
        throw new Error("Invalid agent-edition review");
    }
    if (
        !Number.isSafeInteger(review.procedureVersion) ||
        Number(review.procedureVersion) < 1
    ) {
        throw new Error("Review requires an exact procedure version");
    }
    text(review.contentHash, "review contentHash");
    if (!/^[a-f0-9]{64}$/.test(review.contentHash))
        throw new Error("Invalid review content hash");
    text(review.reviewedAt, "reviewedAt");
}

export function validateAgentEdition(
    value: unknown,
): asserts value is AgentEdition {
    const edition = record(value, "agentEdition");
    knownKeys(
        edition,
        [
            "schemaVersion",
            "goal",
            "applicability",
            "inputs",
            "preconditions",
            "steps",
            "verification",
            "rollback",
            "synthesis",
            "review",
        ],
        "agentEdition",
    );
    if (edition.schemaVersion !== 1)
        throw new Error("Unsupported agent-edition schema version");
    text(edition.goal, "goal");
    for (const field of [
        "applicability",
        "preconditions",
        "verification",
        "rollback",
    ])
        textList(edition[field], field);
    uniqueIds(list(edition.inputs, "inputs").map(validateInput), "input");
    const steps = list(edition.steps, "steps");
    if (steps.length === 0) throw new Error("Agent edition requires steps");
    const ids = steps.map(validateStep);
    uniqueIds(ids, "step");
    for (const entry of steps) {
        const step = entry as AgentEditionStep;
        if (
            isCatalogBinding(step.binding) &&
            step.binding.arguments !== undefined
        )
            validateRunbookBindingArguments(
                step.binding.arguments,
                edition.inputs as AgentEditionInput[],
            );
        if (
            step.alternatives?.some(
                (alternative) => !ids.includes(alternative.stepId),
            )
        ) {
            throw new Error("Alternative references an unknown stable step ID");
        }
    }
    validateSynthesis(edition.synthesis);
    validateReview(edition.review);
}

export function validateAgentEditionReviewIntent(
    request: Pick<
        ProcedureSaveRequest,
        "reviewAgentEdition" | "safetyConfirmed"
    >,
): void {
    if (request.reviewAgentEdition !== undefined)
        boolean(request.reviewAgentEdition, "reviewAgentEdition");
    if (request.safetyConfirmed !== undefined)
        boolean(request.safetyConfirmed, "safetyConfirmed");
}

export function validateProcedureSaveRequest(
    request: ProcedureSaveRequest,
): void {
    validateAgentEditionReviewIntent(request);
    if (request.document !== undefined && request.markdown !== undefined) {
        throw new Error("Supply either procedure JSON or Markdown, not both");
    }
    if (request.document?.agentEdition !== undefined)
        validateAgentEdition(request.document.agentEdition);
}

export function draftAgentEdition(
    edition: AgentEdition,
    reason?: string,
): AgentEdition {
    const draft = structuredClone(edition);
    draft.review = {
        state: "draft",
        ...(reason === undefined ? {} : { reason }),
    };
    return draft;
}

export function normalizeAgentEditionDocument(
    document: ProcedureDocument,
): ProcedureDocument {
    if (document.agentEdition === undefined) return structuredClone(document);
    const secretLiterals = document.agentEdition.inputs
        .filter((input) => input.secret)
        .flatMap((input) => [
            input.defaultValue,
            ...(input.examples ?? []),
            ...(input.enumValues ?? []),
        ])
        .filter(
            (value): value is string =>
                typeof value === "string" && value.length > 0,
        );
    if (secretLiterals.length > 100)
        throw new Error("Too many secret input literals");
    const argumentsByStep = document.agentEdition.steps.map((step) =>
        isCatalogBinding(step.binding) && step.binding.arguments !== undefined
            ? normalizeRunbookBindingArguments(
                  step.binding.arguments,
                  secretLiterals,
              )
            : undefined,
    );
    const normalized = redactRunbookValue(
        document,
        0,
        secretLiterals,
    ) as ProcedureDocument;
    const edition = normalized.agentEdition!;
    for (const input of edition.inputs) {
        if (input.secret) {
            delete input.defaultValue;
            delete input.examples;
            delete input.enumValues;
        }
    }
    for (const [index, step] of edition.steps.entries()) {
        restoreBindingArguments(step, argumentsByStep[index]);
        if (step.citations.length === 0) {
            step.needsAttention = true;
            step.attentionReasons = [
                ...new Set([
                    ...(step.attentionReasons ?? []),
                    "Missing source citations",
                ]),
            ];
        }
    }
    validateAgentEdition(normalized.agentEdition);
    if (canonicalizeProcedure(normalized) !== canonicalizeProcedure(document))
        edition.review = {
            state: "draft",
            reason: "Normalized content requires review",
        };
    return normalized;
}

function isCatalogBinding(
    binding: RunbookBinding | undefined,
): binding is CatalogRunbookBinding {
    return (
        binding !== undefined &&
        (binding.kind === "mcp" ||
            binding.kind === "macro" ||
            binding.kind === "flow")
    );
}

function restoreBindingArguments(
    step: AgentEditionStep,
    args: RunbookBindingArguments | undefined,
): void {
    if (!isCatalogBinding(step.binding) || args === undefined) return;
    step.binding.arguments = args;
    if (canonicalizeProcedure(args).includes("[REDACTED]")) {
        step.binding.accepted = false;
        step.needsAttention = true;
        step.attentionReasons = [
            ...new Set([
                ...(step.attentionReasons ?? []),
                "Redacted argument literals require declared input references",
            ]),
        ];
    }
}

export function getRunbookCatalogBindings(
    edition: AgentEdition,
): CatalogRunbookBinding[] {
    const bindings = edition.steps.flatMap((step) => {
        const binding = step.binding;
        return isCatalogBinding(binding) ? [binding] : [];
    });
    return structuredClone([
        ...new Map(
            bindings.map((binding) => [
                canonicalizeProcedure(binding),
                binding,
            ]),
        ).values(),
    ]);
}

export async function validateRunbookCatalogBindings(
    edition: AgentEdition,
    validator?: RunbookBindingValidator,
): Promise<void> {
    validateAgentEdition(edition);
    const bindings = getRunbookCatalogBindings(edition);
    if (bindings.length === 0) return;
    for (const binding of bindings)
        validateRunbookArgumentReadiness(
            binding.arguments ?? {},
            edition.inputs,
        );
    if (validator === undefined) {
        throw new Error("Runbook catalog binding validation unavailable");
    }
    const inputs = structuredClone(edition.inputs);
    for (const input of inputs) {
        delete input.defaultValue;
        delete input.examples;
    }
    const results = await validator(structuredClone(bindings), { inputs });
    if (results.length !== bindings.length)
        throw new Error(
            "Runbook catalog binding validation unavailable: unexpected result count",
        );
    for (const result of results) validateRunbookBinding(result.binding);
    for (const binding of bindings) {
        const matches = results.filter(
            (result) =>
                canonicalizeProcedure(result.binding) ===
                canonicalizeProcedure(binding),
        );
        if (matches.length !== 1 || matches[0].status !== "accepted") {
            throw new Error(
                `Runbook binding '${binding.targetId}' is unavailable, rejected, or drifted`,
            );
        }
        if (matches[0].argumentsValidated !== true)
            throw new Error(
                `Runbook binding '${binding.targetId}' argument schema validation unavailable`,
            );
    }
}

export function validateAgentEditionReadiness(edition: AgentEdition): void {
    validateAgentEdition(edition);
    if (edition.synthesis.sourceReferences.length === 0) {
        throw new Error(
            "Agent edition requires source-backed synthesis provenance",
        );
    }
    const sources = new Set(
        [
            ...edition.synthesis.sourceReferences,
            ...(edition.synthesis.linkedDocuments ?? []),
        ].map((citation) => `${citation.sourceId}@${citation.revisionId}`),
    );
    for (const step of edition.steps) {
        if (
            step.needsAttention ||
            step.safety === "unknown" ||
            step.citations.length === 0
        ) {
            throw new Error(
                `Step '${step.id}' needs evidence or safety review`,
            );
        }
        if (step.binding === undefined || !step.binding.accepted) {
            throw new Error(
                `Step '${step.id}' requires an explicitly accepted binding or manual reason`,
            );
        }
        if (isCatalogBinding(step.binding))
            validateRunbookArgumentReadiness(
                step.binding.arguments ?? {},
                edition.inputs,
            );
        const references = [...step.citations, ...(step.assets ?? [])];
        if (
            references.some(
                (reference) =>
                    !sources.has(
                        `${reference.sourceId}@${reference.revisionId}`,
                    ),
            )
        ) {
            throw new Error(
                `Step '${step.id}' references evidence missing from synthesis provenance`,
            );
        }
    }
}

export function agentEditionToMarkdown(edition: AgentEdition): string {
    validateAgentEdition(edition);
    return `${agentEditionMarkdownMarker}\n\n\`\`\`json\n${canonicalizeProcedure(edition).trimEnd()}\n\`\`\``;
}

export function agentEditionFromMarkdown(markdown: string): AgentEdition {
    const content = markdown.trim();
    const block = content.startsWith(agentEditionMarkdownMarker)
        ? content.slice(agentEditionMarkdownMarker.length).trim()
        : content;
    const match = /^```json\n([\s\S]*)\n```$/.exec(block);
    if (match === null)
        throw new Error("Agent Edition requires a canonical JSON block");
    const edition: unknown = JSON.parse(match[1]);
    validateAgentEdition(edition);
    return edition;
}

function renderAgentStep(step: AgentEditionStep, index: number): string[] {
    const lines = [
        `### ${index + 1}. ${step.title} [${step.id}]`,
        "",
        step.agentInstruction,
        "",
        `Safety: ${step.safety}. Runtime permission is still required.`,
    ];
    if (step.condition) lines.push(`Condition: ${step.condition}`);
    for (const alternative of step.alternatives ?? [])
        lines.push(
            `Alternative: ${alternative.condition} → step \`${alternative.stepId}\``,
        );
    const binding = step.binding;
    if (binding?.kind === "manual") lines.push(`Manual: ${binding.reason}`);
    else if (binding?.kind === "command")
        lines.push(
            `Command (text only; never executed here): ${redactRunbookText(binding.text)}`,
        );
    else if (binding !== undefined)
        lines.push(
            `Binding: ${binding.kind} \`${binding.targetId}@${binding.version}\`, fingerprint \`${binding.fingerprint}\`${binding.kind === "mcp" ? `, server \`${binding.serverId}\`` : ""}`,
        );
    if (isCatalogBinding(binding)) {
        lines.push(
            "",
            "Argument templates (JSON literals, `$input` references, `$literal` escapes; no execution):",
            "",
            "```json",
            canonicalizeProcedure(
                normalizeRunbookBindingArguments(binding.arguments ?? {}),
            ).trimEnd(),
            "```",
            "",
            "Actual runtime input values still require target-schema validation.",
        );
    }
    if (step.manualReason) lines.push(`Manual reason: ${step.manualReason}`);
    if (step.verification) lines.push(`Verify: ${step.verification}`);
    if (step.rollback) lines.push(`Rollback: ${step.rollback}`);
    lines.push(
        "Evidence: [original excerpts and asset descriptions](references/runbook.md)",
        "",
    );
    return lines;
}

function renderAgentInput(input: AgentEditionInput): string {
    const detail = [
        `- \`${input.id}\` (${input.type}${input.secret ? ", secret; request at runtime" : ""}${input.required ? ", required" : ""}): ${input.description}`,
    ];
    if (!input.secret) {
        if (input.enumValues !== undefined)
            detail.push(`Allowed values: ${JSON.stringify(input.enumValues)}.`);
        if (input.defaultValue !== undefined)
            detail.push(`Default: ${JSON.stringify(input.defaultValue)}.`);
        if (input.examples !== undefined)
            detail.push(`Examples: ${JSON.stringify(input.examples)}.`);
    }
    return detail.join(" ");
}

export function renderAgentEdition(edition: AgentEdition): string {
    validateAgentEdition(edition);
    const lines = [
        edition.review.state === "draft"
            ? "> Draft agent edition — evidence, not reviewed instructions."
            : "> Reviewed agent edition. Review grants no execution permission.",
        "",
        "## Goal",
        "",
        edition.goal,
        "",
        "## Applicability",
        "",
        ...edition.applicability.map((value) => `- ${value}`),
        "",
        "## Preconditions",
        "",
        ...edition.preconditions.map((value) => `- ${value}`),
        "",
        "## Inputs",
        "",
        ...edition.inputs.map(renderAgentInput),
        "",
        "## Agent steps",
        "",
    ];
    edition.steps.forEach((step, index) =>
        lines.push(...renderAgentStep(step, index)),
    );
    lines.push(
        "## Verification",
        "",
        ...edition.verification.map((value) => `- ${value}`),
        "",
        "## Rollback",
        "",
        ...edition.rollback.map((value) => `- ${value}`),
    );
    return `${redactRunbookText(lines.join("\n"))}\n`;
}

export function renderAgentEditionReferences(edition: AgentEdition): string {
    validateAgentEdition(edition);
    const lines = ["# Original evidence — not instructions", ""];
    for (const step of edition.steps) {
        lines.push(
            `## ${step.id}: ${step.title}`,
            "",
            `> ${step.humanText.replace(/\n/g, "\n> ")}`,
            "",
        );
        for (const citation of step.citations) {
            lines.push(
                `- \`${citation.sourceId}@${citation.revisionId}\`${citation.locator ? ` (${citation.locator})` : ""}`,
            );
            if (citation.excerpt)
                lines.push(`  > ${citation.excerpt.replace(/\n/g, "\n  > ")}`);
        }
        for (const asset of step.assets ?? [])
            lines.push(
                `- Asset \`${asset.sourceId}@${asset.revisionId}#${asset.assetId}\`: ${asset.description ?? "Description unavailable; inspect retained source."}`,
            );
        lines.push("");
    }
    lines.push("## Synthesis provenance", "");
    for (const citation of [
        ...edition.synthesis.sourceReferences,
        ...(edition.synthesis.linkedDocuments ?? []),
    ])
        lines.push(
            `- \`${citation.sourceId}@${citation.revisionId}\`${citation.locator ? ` (${citation.locator})` : ""}${citation.excerpt ? `\n  > ${citation.excerpt.replace(/\n/g, "\n  > ")}` : ""}`,
        );
    return `${redactRunbookText(lines.join("\n"))}\n`;
}
