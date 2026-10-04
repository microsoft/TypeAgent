// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    AgentEdition,
    AgentEditionInput,
    AgentEditionStep,
} from "@typeagent/memory-service";
import type {
    RunbookAsset,
    RunbookOriginal,
} from "@typeagent/browser-control-rpc/viewRpc";
import {
    rbButton,
    rbCheck,
    rbField,
    rbLines,
    rbNode,
    rbSelect,
} from "./memoryHubRunbookUi";

export type RunbookEditionEditorOptions = {
    changed: () => void;
    onBind: (stepId: string) => void;
    onEvidence: (stepId: string) => void;
    safetyReviewed: Set<string>;
    availableAssets: RunbookAsset[];
    availableOriginals: RunbookOriginal[];
    markSecret: (input: AgentEditionInput, secret: boolean) => void;
};
function optional(value: string): string | undefined {
    return value.trim() ? value : undefined;
}
function nextId(prefix: string, used: string[]) {
    let index = 1;
    while (used.includes(`${prefix}-${index}`)) index++;
    return `${prefix}-${index}`;
}
function inputEditor(
    input: AgentEditionInput,
    options: RunbookEditionEditorOptions,
    remove: () => void,
) {
    const changed = options.changed;
    const card = rbNode("article");
    const valueFields = rbNode("div");
    function renderValue() {
        valueFields.replaceChildren();
        if (input.secret) {
            valueFields.append(
                rbNode(
                    "p",
                    "Secret input: values are requested at runtime. Defaults and examples are never displayed or retained.",
                    "runbook-warning",
                ),
            );
            return;
        }
        if (input.type === "enum")
            valueFields.append(
                rbField(
                    "Allowed enum values (one per line)",
                    input.enumValues?.join("\n") ?? "",
                    (value) => {
                        input.enumValues = rbLines(value);
                        changed();
                    },
                    { multiline: true },
                ),
            );
        valueFields.append(
            rbField(
                "Default value",
                input.defaultValue === undefined
                    ? ""
                    : String(input.defaultValue),
                (value) => {
                    if (!value) delete input.defaultValue;
                    else if (input.type === "number")
                        input.defaultValue = Number(value);
                    else if (input.type === "boolean")
                        input.defaultValue =
                            value === "true"
                                ? true
                                : value === "false"
                                  ? false
                                  : value;
                    else input.defaultValue = value;
                    changed();
                },
                { name: `input-${input.id}-default` },
            ),
        );
    }
    card.append(
        rbNode("h4", `Input ${input.id}`),
        rbField(
            "Input ID",
            input.id,
            (value) => {
                input.id = value;
                changed();
            },
            { name: `input-${input.id}-id` },
        ),
        rbField(
            "Input description",
            input.description,
            (value) => {
                input.description = value;
                changed();
            },
            { name: `input-${input.id}-description` },
        ),
        rbSelect(
            "Input type",
            input.type,
            ["string", "number", "boolean", "enum"],
            (value) => {
                input.type = value;
                delete input.defaultValue;
                delete input.examples;
                if (value !== "enum") delete input.enumValues;
                renderValue();
                changed();
            },
        ),
        rbCheck("Required input", input.required, (value) => {
            input.required = value;
            changed();
        }),
        rbCheck(
            "Secret input (never store a value)",
            input.secret,
            (value) => {
                options.markSecret(input, value);
                renderValue();
                changed();
            },
            `input-${input.id}-secret`,
        ),
        valueFields,
        rbButton("Remove input", remove),
    );
    renderValue();
    return card;
}
function alternativeEditor(step: AgentEditionStep, changed: () => void) {
    const root = rbNode("div");
    const list = rbNode("div");
    function render() {
        list.replaceChildren();
        for (const [index, alternative] of (
            step.alternatives ?? []
        ).entries()) {
            const item = rbNode("div", undefined, "runbook-controls");
            item.append(
                rbField(
                    "Alternative condition",
                    alternative.condition,
                    (value) => {
                        alternative.condition = value;
                        changed();
                    },
                ),
                rbField(
                    "Alternative target step ID",
                    alternative.stepId,
                    (value) => {
                        alternative.stepId = value;
                        changed();
                    },
                ),
                rbButton("Remove alternative", () => {
                    step.alternatives?.splice(index, 1);
                    render();
                    changed();
                }),
            );
            list.append(item);
        }
    }
    root.append(
        rbNode("h4", "Alternatives"),
        list,
        rbButton("Add alternative", () => {
            step.alternatives ??= [];
            step.alternatives.push({ condition: "", stepId: "" });
            render();
            changed();
        }),
    );
    render();
    return root;
}
function citationEditor(
    step: AgentEditionStep,
    options: RunbookEditionEditorOptions,
) {
    const root = rbNode("section");
    const citations = rbNode("div");
    function render() {
        citations.replaceChildren();
        for (const [index, citation] of step.citations.entries())
            citations.append(
                rbNode(
                    "p",
                    `Exact pinned citation ${index + 1}: ${citation.excerpt ?? "no excerpt supplied"}`,
                ),
                rbField("Citation source ID", citation.sourceId, (value) => {
                    citation.sourceId = value;
                    options.changed();
                }),
                rbField(
                    "Citation exact revision ID",
                    citation.revisionId,
                    (value) => {
                        citation.revisionId = value;
                        options.changed();
                    },
                ),
                rbField(
                    "Citation locator (metadata, not resolved span)",
                    citation.locator ?? "",
                    (value) => {
                        citation.locator = optional(value);
                        options.changed();
                    },
                ),
                rbButton("Remove citation", () => {
                    step.citations.splice(index, 1);
                    render();
                    options.changed();
                }),
            );
    }
    const advanced = document.createElement("details");
    advanced.className = "runbook-advanced";
    const advancedTitle = document.createElement("summary");
    advancedTitle.textContent = "Exact citation references";
    advanced.append(
        advancedTitle,
        citations,
        rbButton(
            "Add exact citation reference",
            () => {
                step.citations.push({ sourceId: "", revisionId: "" });
                render();
                options.changed();
            },
            "add-raw-citation",
        ),
    );
    root.append(advanced);
    render();
    for (const original of options.availableOriginals)
        root.append(
            rbButton(`Use retained citation ${original.title}`, () => {
                const citation = original.citation;
                if (
                    !step.citations.some(
                        (value) =>
                            value.sourceId === citation.sourceId &&
                            value.revisionId === citation.revisionId &&
                            value.locator === citation.locator,
                    )
                ) {
                    step.citations.push(structuredClone(citation));
                    render();
                    options.changed();
                }
            }),
        );
    const assets = rbNode("div");
    function renderAssets() {
        assets.replaceChildren();
        for (const [index, asset] of (step.assets ?? []).entries())
            assets.append(
                rbNode(
                    "p",
                    options.availableAssets.find(
                        (value) =>
                            value.assetId === asset.assetId &&
                            value.sourceId === asset.sourceId &&
                            value.revisionId === asset.revisionId,
                    )?.name ?? "Retained asset reference; metadata unavailable",
                ),
                rbField(
                    "Retained asset description",
                    asset.description ?? "",
                    (value) => {
                        asset.description = optional(value);
                        options.changed();
                    },
                ),
                rbButton("Remove asset reference", () => {
                    step.assets?.splice(index, 1);
                    renderAssets();
                    options.changed();
                }),
            );
    }
    for (const asset of options.availableAssets)
        root.append(
            rbButton(`Use retained asset ${asset.name}`, () => {
                step.assets ??= [];
                if (
                    !step.assets.some(
                        (value) =>
                            value.assetId === asset.assetId &&
                            value.sourceId === asset.sourceId &&
                            value.revisionId === asset.revisionId,
                    )
                ) {
                    step.assets.push({
                        assetId: asset.assetId,
                        sourceId: asset.sourceId,
                        revisionId: asset.revisionId,
                        description: asset.description,
                    });
                    renderAssets();
                    options.changed();
                }
            }),
        );
    root.append(assets);
    renderAssets();
    return root;
}
function stepEditor(
    step: AgentEditionStep,
    options: RunbookEditionEditorOptions,
    remove: () => void,
) {
    const card = rbNode("article");
    card.dataset.stepId = step.id;
    if (step.needsAttention) card.classList.add("runbook-affected");
    const safety = rbNode("div");
    function renderSafety() {
        safety.replaceChildren();
        if (step.safety === "changesData")
            safety.append(
                rbCheck(
                    `I explicitly reviewed state-changing safety for ${step.id}`,
                    options.safetyReviewed.has(step.id),
                    (value) => {
                        if (value) options.safetyReviewed.add(step.id);
                        else options.safetyReviewed.delete(step.id);
                    },
                    `safety-${step.id}`,
                ),
            );
    }
    card.append(
        rbNode("h4", `${step.id} · ${step.title}`),
        rbField("Stable step ID", step.id, () => {}, { readonly: true }),
        rbField(
            "Step title",
            step.title,
            (value) => {
                step.title = value;
                options.changed();
            },
            { name: `step-${step.id}-title` },
        ),
        rbField(
            "Human original guide text (exact retained source is on Original tab)",
            step.humanText,
            () => {},
            { multiline: true, readonly: true, name: `step-${step.id}-human` },
        ),
        rbField(
            "Derived agent instruction",
            step.agentInstruction,
            (value) => {
                step.agentInstruction = value;
                options.changed();
            },
            { multiline: true, name: `step-${step.id}-instruction` },
        ),
        rbField("Condition", step.condition ?? "", (value) => {
            step.condition = optional(value);
            options.changed();
        }),
        rbField("Verification", step.verification ?? "", (value) => {
            step.verification = optional(value);
            options.changed();
        }),
        rbField("Rollback", step.rollback ?? "", (value) => {
            step.rollback = optional(value);
            options.changed();
        }),
        rbField("Manual reason", step.manualReason ?? "", (value) => {
            step.manualReason = optional(value);
            options.changed();
        }),
        rbSelect(
            "Safety label (does not grant execution permission)",
            step.safety,
            ["readOnly", "changesData", "unknown"],
            (value) => {
                step.safety = value;
                options.safetyReviewed.delete(step.id);
                options.changed();
                renderSafety();
            },
            `step-${step.id}-safety`,
        ),
        safety,
        alternativeEditor(step, options.changed),
        rbNode(
            "p",
            `Binding: ${step.binding?.kind ?? "unbound"} · ${step.binding?.accepted ? "explicitly accepted" : "not accepted"}. Binding changes require explicit catalog/command/manual acceptance.`,
        ),
        rbNode("p", step.attentionReasons?.join("\n") ?? "", "runbook-warning"),
        rbCheck(
            "I manually resolved this step's evidence / safety attention notices",
            !step.needsAttention,
            (value) => {
                step.needsAttention = !value;
                step.attentionReasons = value
                    ? []
                    : ["Manual review remains required"];
                options.changed();
            },
            `attention-${step.id}`,
        ),
        rbNode(
            "p",
            "Exact source citations and revision-owned assets are retained below. Uncited steps cannot be treated as reviewed.",
        ),
        citationEditor(step, options),
        rbButton("Inspect cited originals", () => options.onEvidence(step.id)),
        rbButton(
            "Choose binding / command / manual",
            () => options.onBind(step.id),
            `bind-${step.id}`,
        ),
        rbButton("Remove agent step", remove),
    );
    renderSafety();
    return card;
}

function provenanceEditor(
    edition: AgentEdition,
    options: RunbookEditionEditorOptions,
) {
    const root = rbNode("section");
    const list = rbNode("div");
    function render() {
        list.replaceChildren();
        const groups: Array<
            [
                "source" | "linked document",
                typeof edition.synthesis.sourceReferences,
            ]
        > = [
            ["source", edition.synthesis.sourceReferences],
            ["linked document", edition.synthesis.linkedDocuments ?? []],
        ];
        for (const [kind, references] of groups) {
            for (const [index, citation] of references.entries()) {
                const title =
                    options.availableOriginals.find(
                        (original) =>
                            original.citation.sourceId === citation.sourceId &&
                            original.citation.revisionId ===
                                citation.revisionId,
                    )?.title ??
                    "Exact reference; retained preview metadata unavailable";
                list.append(
                    rbNode("p", `${kind}: ${title}`),
                    rbButton(`Remove ${kind} reference ${index + 1}`, () => {
                        references.splice(index, 1);
                        render();
                        options.changed();
                    }),
                );
            }
        }
    }
    root.append(
        rbNode("h4", "Source-backed synthesis provenance and linked documents"),
        rbNode(
            "p",
            "Adding provenance is explicit and does not review a step. Source/revision availability is verified by the service.",
        ),
        list,
    );
    for (const original of options.availableOriginals) {
        root.append(
            rbButton(`Add synthesis source: ${original.title}`, () => {
                if (
                    !edition.synthesis.sourceReferences.some(
                        (citation) =>
                            citation.sourceId === original.citation.sourceId &&
                            citation.revisionId ===
                                original.citation.revisionId,
                    )
                ) {
                    edition.synthesis.sourceReferences.push(
                        structuredClone(original.citation),
                    );
                    render();
                    options.changed();
                }
            }),
            rbButton(`Link supporting document: ${original.title}`, () => {
                edition.synthesis.linkedDocuments ??= [];
                if (
                    !edition.synthesis.linkedDocuments.some(
                        (citation) =>
                            citation.sourceId === original.citation.sourceId &&
                            citation.revisionId ===
                                original.citation.revisionId,
                    )
                ) {
                    edition.synthesis.linkedDocuments.push(
                        structuredClone(original.citation),
                    );
                    render();
                    options.changed();
                }
            }),
        );
    }
    render();
    return root;
}
export function mountRunbookEdition(
    host: HTMLElement,
    edition: AgentEdition,
    options: RunbookEditionEditorOptions,
) {
    const root = rbNode("section", undefined, "runbook-fields");
    root.setAttribute("aria-label", "Agent edition draft editor");
    const inputs = rbNode("div");
    const steps = rbNode("div");
    const reviewStatus = rbNode(
        "p",
        edition.review.state === "reviewed"
            ? `Reviewed for exact procedure version ${edition.review.procedureVersion}. Content edits invalidate this review.`
            : "Unreviewed draft; no approval or execution permission.",
    );
    reviewStatus.dataset.editionReviewState = "true";
    function renderInputs() {
        inputs.replaceChildren(
            ...edition.inputs.map((input, index) =>
                inputEditor(input, options, () => {
                    edition.inputs.splice(index, 1);
                    renderInputs();
                    options.changed();
                }),
            ),
        );
    }
    function renderSteps() {
        steps.replaceChildren(
            ...edition.steps.map((step, index) =>
                stepEditor(step, options, () => {
                    edition.steps.splice(index, 1);
                    renderSteps();
                    options.changed();
                }),
            ),
        );
    }
    root.append(
        rbNode(
            "h3",
            "Agent edition (derived instructions; review is per procedure version)",
        ),
        reviewStatus,
        rbField(
            "Goal",
            edition.goal,
            (value) => {
                edition.goal = value;
                options.changed();
            },
            { name: "edition-goal" },
        ),
        rbField(
            "Applicability (one per line)",
            edition.applicability.join("\n"),
            (value) => {
                edition.applicability = rbLines(value);
                options.changed();
            },
            { multiline: true },
        ),
        rbField(
            "Preconditions (one per line)",
            edition.preconditions.join("\n"),
            (value) => {
                edition.preconditions = rbLines(value);
                options.changed();
            },
            { multiline: true },
        ),
        rbField(
            "Overall verification (one per line)",
            edition.verification.join("\n"),
            (value) => {
                edition.verification = rbLines(value);
                options.changed();
            },
            { multiline: true },
        ),
        rbField(
            "Overall rollback (one per line)",
            edition.rollback.join("\n"),
            (value) => {
                edition.rollback = rbLines(value);
                options.changed();
            },
            { multiline: true },
        ),
        rbNode("h3", "Typed inputs"),
        inputs,
        rbButton("Add typed input", () => {
            edition.inputs.push({
                id: nextId(
                    "input",
                    edition.inputs.map((value) => value.id),
                ),
                description: "",
                type: "string",
                required: true,
                secret: false,
            });
            renderInputs();
            options.changed();
        }),
        rbNode("h3", "Stable-ID agent steps"),
        steps,
        rbButton("Add agent step", () => {
            const id = nextId(
                "step",
                edition.steps.map((value) => value.id),
            );
            edition.steps.push({
                id,
                title: "New step",
                humanText: "Manual authoring; no source passage supplied.",
                agentInstruction: "",
                safety: "unknown",
                citations: [],
            });
            renderSteps();
            options.changed();
        }),
        provenanceEditor(edition, options),
    );
    renderInputs();
    renderSteps();
    host.append(root);
    return {
        dispose() {
            root.remove();
        },
    };
}
