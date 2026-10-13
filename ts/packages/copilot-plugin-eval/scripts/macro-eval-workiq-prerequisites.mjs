// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
    validateMacro,
    resolveMacroExpression,
} from "../../copilot-macros/dist/index.js";
import {
    WorkiqEvidenceError,
    createWorkiqEvidenceVerifier,
} from "./macro-eval-workiq-evidence.mjs";
import {
    workiqReadArguments,
    workiqJsonHash,
    readWorkiqOwnedJson,
    createWorkiqCurrentEvidenceLoader,
    assertWorkiqHost,
} from "./macro-eval-workiq-adapter.mjs";

const check = (condition, code) => {
    if (!condition) throw new WorkiqEvidenceError("blocked", code);
};
const id = (value) =>
    typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const lookupKey = "application/vnd.ms-workiq.retrieval";

function assertArgumentBinding(step, index, firstId, admission) {
    const expression = step.arguments;
    check(
        expression?.kind === "template" && Array.isArray(expression.bindings),
        "workiqDraftBindingMismatch",
    );
    const bindings = expression.bindings;
    if (index === 0) {
        const required = [
            {
                path: ["query"],
                expression: { kind: "input", name: "documentQuery" },
            },
            {
                path: ["capabilities", "0", "items_by_url", "0", "url"],
                expression: { kind: "input", name: "documentUrl" },
            },
        ];
        check(
            bindings.length === 2 &&
                required.every((binding) =>
                    bindings.some((value) => isDeepStrictEqual(value, binding)),
                ),
            "workiqDraftInputBindingMismatch",
        );
    } else {
        const recipe = admission.workflow.recipe[index];
        const source =
            index === 2
                ? recipe.argumentTemplate.path
                : recipe.argumentTemplate.entityUrls[0];
        check(
            isDeepStrictEqual(bindings, [
                {
                    path: index === 2 ? ["path"] : ["entityUrls", "0"],
                    expression: { ...source, stepId: firstId },
                },
            ]),
            "workiqDraftResultBindingMismatch",
        );
    }
}

/**
 * Deterministic external-review contract, not publication or consent. Frozen
 * identity metadata below is used ONLY to exercise argument independence for
 * both inputs; it never supplies original file bytes or a live content verdict.
 */
export function reviewWorkiqDraftContract({
    draft,
    trace,
    discovery,
    admission,
}) {
    check(
        draft?.state === "draft" &&
            draft.schemaVersion === 2 &&
            isDeepStrictEqual(draft.capabilities, ["result-path-v1"]) &&
            draft.sourceTraceId === trace.traceId,
        "workiqDraftSourceMismatch",
    );
    check(validateMacro(draft, trace).valid, "workiqDraftInvalid");
    check(
        draft.steps.length === 4 &&
            draft.inputs.length === 2 &&
            ["documentUrl", "documentQuery"].every((name) =>
                draft.inputs.some(
                    (input) =>
                        input.name === name &&
                        input.required === true &&
                        input.valueType === "string",
                ),
            ),
        "workiqDraftInputsMismatch",
    );
    for (const [index, step] of draft.steps.entries()) {
        const tool = discovery.tools.find(
            (entry) =>
                entry.advertisedName ===
                admission.workflow.recipe[index].advertisedTool,
        );
        check(
            tool &&
                step.toolName === tool.callableName &&
                step.mcpServerName === tool.mcpServerName &&
                step.sourceToolCallId === trace.toolCalls[index].toolCallId,
            "workiqDraftToolMismatch",
        );
        assertArgumentBinding(step, index, draft.steps[0].id, admission);
        for (const entity of admission.entities) {
            const lookup = {
                content: [],
                isError: false,
                structuredContent: {
                    [lookupKey]: {
                        markdown: "",
                        resultCount: 1,
                        stoppedReason: "completed",
                        retrievalHits: [
                            {
                                itemId: entity.itemId,
                                driveId: entity.driveId,
                                entityUrl: entity.entityPath,
                                webUrl: entity.canonicalWebUrl,
                                resourceMetadata: {},
                            },
                        ],
                    },
                },
            };
            const actual = resolveMacroExpression(
                step.arguments,
                entity.inputs,
                new Map([[draft.steps[0].id, lookup]]),
            );
            check(
                isDeepStrictEqual(
                    actual,
                    workiqReadArguments(admission, entity.key, index, lookup),
                ),
                "workiqDraftSourceArgumentLeak",
            );
        }
    }
    return Object.freeze({
        scope: "deterministic-workiq-draft-contract-only",
        sourceTraceId: trace.traceId,
        macroId: draft.macroId,
        version: draft.version,
        draftSha256: workiqJsonHash(draft),
        publicationApproved: false,
        executionConsentVerified: false,
    });
}

export function createWorkiqDraftReviewer(options) {
    check(
        options.scope.phase === "capture-a" && options.entityKey === "A",
        "workiqReviewNeedsCaptureA",
    );
    const load = createWorkiqCurrentEvidenceLoader(options);
    const trial = structuredClone(options.trial);
    return Object.freeze({
        async review(reference) {
            check(
                id(reference?.macroId) &&
                    Number.isSafeInteger(reference.version) &&
                    reference.version > 0,
                "workiqDraftReferenceInvalid",
            );
            const current = await load(trial);
            const verifier = createWorkiqEvidenceVerifier({
                artifactRoot: options.artifactRoot,
                admission: options.admission,
                trial,
                readCurrent: async () => current,
            });
            const original = await verifier.verify({ entityKey: "A" });
            check(
                original.status === "passed" && original.originalBytesVerified,
                "workiqCaptureAOriginalUnproved",
            );
            const draft = await readWorkiqOwnedJson(
                options.artifactRoot,
                path.join(
                    "macros",
                    reference.macroId,
                    "versions",
                    `${reference.version}.json`,
                ),
            );
            check(
                draft.macroId === reference.macroId &&
                    draft.version === reference.version,
                "workiqDraftReferenceMismatch",
            );
            const report = reviewWorkiqDraftContract({
                draft,
                trace: current.trace,
                discovery: current.discovery,
                admission: options.admission,
            });
            return {
                ...report,
                originalReceipt: original.receipt,
                sessionId: trial.sessionId,
            };
        },
    });
}

function approvalBody(definition) {
    const copy = structuredClone(definition);
    delete copy.version;
    delete copy.state;
    delete copy.createdAt;
    for (const step of copy.steps) delete step.schemaFingerprint;
    return copy;
}

async function publicationSnapshot(storeRoot, pin) {
    check(
        id(pin?.macroId) &&
            Number.isSafeInteger(pin.draftVersion) &&
            Number.isSafeInteger(pin.approvedVersion) &&
            pin.draftVersion > 0 &&
            pin.approvedVersion > pin.draftVersion,
        "workiqPublicationMissing",
    );
    const directory = path.join("macros", pin.macroId, "versions");
    const draft = await readWorkiqOwnedJson(
        storeRoot,
        path.join(directory, `${pin.draftVersion}.json`),
    );
    const approved = await readWorkiqOwnedJson(
        storeRoot,
        path.join(directory, `${pin.approvedVersion}.json`),
    );
    const catalog = await readWorkiqOwnedJson(storeRoot, "index.json");
    check(
        draft.state === "draft" &&
            draft.macroId === pin.macroId &&
            draft.version === pin.draftVersion &&
            workiqJsonHash(draft) === pin.draftSha256,
        "workiqReviewedDraftDrift",
    );
    check(
        approved.state === "approved" &&
            approved.macroId === pin.macroId &&
            approved.version === pin.approvedVersion &&
            approved.schemaVersion === 2 &&
            workiqJsonHash(approved) === pin.approvedSha256 &&
            isDeepStrictEqual(approvalBody(draft), approvalBody(approved)),
        "workiqApprovedVersionDrift",
    );
    const matches = Array.isArray(catalog)
        ? catalog.filter((entry) => entry.macroId === pin.macroId)
        : [];
    check(
        matches.length === 1 &&
            matches[0].version === pin.approvedVersion &&
            matches[0].state === "approved",
        "workiqApprovedCatalogMissing",
    );
    return { draft, approved, catalogSha256: workiqJsonHash(catalog) };
}

/**
 * Trusted controller callbacks must validate actual native control/lease/current
 * consent, external review/publication and OS restart receipts. There are no
 * default-positive flags and no inferred/inherited approval. This module never
 * calls approval, inspect_macro, learning/model APIs or native launch controls.
 */
export function createWorkiqPilotPrerequisites(options) {
    const { host, storeRoot, workspace, admission } = options;
    check(
        path.isAbsolute(storeRoot) && path.isAbsolute(workspace),
        "workiqOwnedStoreMissing",
    );
    for (const name of [
        "assertNativeReadinessAndExclusiveSlot",
        "assertCurrentExecutionConsent",
        "readLearningPreference",
    ])
        check(
            typeof host?.[name] === "function",
            "workiqTrustedControllerMissing",
        );
    return Object.freeze({
        async assertPrerequisites(scope) {
            await assertWorkiqHost(
                (value) => host.assertNativeReadinessAndExclusiveSlot(value),
                structuredClone(scope),
            );
            await assertWorkiqHost(
                (value) => host.assertCurrentExecutionConsent(value),
                {
                    ...structuredClone(scope),
                    tools: ["retrieve", "fetch", "fetch_blob"],
                },
            );
            const preference = await host.readLearningPreference(workspace);
            check(
                preference?.cwd === workspace &&
                    preference.mode === "prepare" &&
                    Number.isInteger(preference.revision),
                "workiqPrepareModeUnproved",
            );
            if (scope.phase === "capture-a") {
                check(scope.runId === null, "workiqCaptureRunMismatch");
                return;
            }
            check(
                typeof host.readPublicationPin === "function" &&
                    typeof host.assertExternalReviewAndPublication ===
                        "function",
                "workiqExternalPublicationUnproved",
            );
            const pin = await host.readPublicationPin();
            const snapshot = await publicationSnapshot(storeRoot, pin);
            await assertWorkiqHost(
                (value) => host.assertExternalReviewAndPublication(value),
                {
                    scope: structuredClone(scope),
                    pin: structuredClone(pin),
                    draft: snapshot.draft,
                    approved: snapshot.approved,
                },
            );
            check(
                typeof scope.runId === "string" && scope.runId.length > 0,
                "workiqReuseRunMissing",
            );
            if (scope.phase === "restart-b") {
                check(
                    typeof host.assertPhysicalRestart === "function" &&
                        pin.catalogSha256 === snapshot.catalogSha256,
                    "workiqSameStoreRestartUnproved",
                );
                await assertWorkiqHost(
                    (value) => host.assertPhysicalRestart(value),
                    {
                        scope: structuredClone(scope),
                        storeRoot,
                        workspace,
                        macroId: pin.macroId,
                        version: pin.approvedVersion,
                        approvedSha256: pin.approvedSha256,
                        catalogSha256: snapshot.catalogSha256,
                    },
                );
            }
            check(
                admission.entities.some((entity) => entity.key === "B"),
                "workiqReplacementMissing",
            );
        },
    });
}
