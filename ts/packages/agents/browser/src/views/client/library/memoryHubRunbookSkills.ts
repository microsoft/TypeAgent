// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    RunbookDetail,
    RunbookSkill,
    RunbookSkillIdentity,
    RunbookSkillPreview,
} from "@typeagent/browser-control-rpc/viewRpc";
import { invokeView } from "./viewClient";
import {
    rbButton,
    rbError,
    rbField,
    rbNode,
    rbSelect,
} from "./memoryHubRunbookUi";

function skillActionLabel(action: string) {
    return action === "draft" ? "Return to DRAFT (correction)" : action;
}
export function runbookPublicationReason(
    detail: RunbookDetail,
    dirty: boolean,
): string | undefined {
    if (dirty) return "Save or discard edits before previewing a skill.";
    const procedure = detail.procedure;
    if (!procedure)
        return "Save this candidate as a procedure before previewing a skill.";
    if (procedure.state !== "saved")
        return `Publication is unavailable for this ${procedure.state} procedure.`;
    const edition = procedure.document.agentEdition;
    if (
        edition &&
        (edition.review.state !== "reviewed" ||
            edition.review.procedureVersion !== procedure.version)
    )
        return "Agent edition must be explicitly reviewed for this exact procedure version.";
    if (
        edition?.review.state === "reviewed" &&
        edition.steps.some(
            (step) =>
                step.binding &&
                ["mcp", "macro", "flow"].includes(step.binding.kind),
        ) &&
        edition.review.argumentsValidation !== "accepted"
    )
        return "Catalog binding arguments require explicit re-review with current input-schema validation for this version.";
    return undefined;
}
export function mountRunbookSkills(
    host: HTMLElement,
    options: {
        detail: RunbookDetail;
        dirty: () => boolean;
        onError: (error: unknown) => void;
        onChanged: () => Promise<void>;
        selectedRevisionId?: string;
        readOnly?: boolean;
    },
) {
    const root = rbNode("section");
    root.setAttribute(
        "aria-label",
        "Immutable skill publication and lifecycle",
    );
    const status = rbNode("p");
    status.setAttribute("role", "status");
    const previews = rbNode("div");
    const skills = rbNode("div");
    const identity: RunbookSkillIdentity = {
        scope: "user",
        origin: "personal",
        name: "",
    };
    const controls = rbNode("div", undefined, "runbook-controls");
    const previewButton = rbButton(
        "Preview skill files and findings",
        () => {
            void preview();
        },
        "preview-skill",
    );
    const publishButton = rbButton(
        "Publish as skill DRAFT",
        () => {
            void publish();
        },
        "publish-skill",
    );
    previewButton.classList.add("hub-secondary");
    publishButton.classList.add("primary");
    controls.append(previewButton, publishButton);
    const stepper = rbNode("ol", undefined, "hub-steps");
    const stepItems = ["Name the skill", "Review files", "Publish draft"].map(
        (label) => {
            const item = rbNode("li", label);
            stepper.append(item);
            return item;
        },
    );
    function refreshStepper() {
        const named = Boolean(identity.name.trim() && identity.origin.trim());
        const reviewed = Boolean(
            cachedPreview?.valid && previewIdentity === key(),
        );
        const done = [named, reviewed, false];
        const current = done.indexOf(false);
        stepItems.forEach((item, index) => {
            item.classList.toggle("done", done[index]);
            if (index === current) item.setAttribute("aria-current", "step");
            else item.removeAttribute("aria-current");
        });
    }
    const form = rbNode("div", undefined, "runbook-fields");
    let cachedPreview: RunbookSkillPreview | undefined;
    let previewIdentity = "";
    let version = 0;
    let disposed = false;
    let working = false;
    let selectionErrorReported = false;
    function key() {
        return JSON.stringify(identity);
    }
    function invalidate() {
        cachedPreview = undefined;
        previews.replaceChildren();
        refreshEligibility();
    }
    form.append(
        rbSelect(
            "Skill scope",
            identity.scope,
            ["user", "project", "package"],
            (value) => {
                identity.scope = value;
                invalidate();
            },
            "skill-scope",
        ),
        rbField(
            "Skill origin",
            identity.origin,
            (value) => {
                identity.origin = value;
                invalidate();
            },
            { name: "skill-origin" },
        ),
        rbField(
            "Skill name",
            identity.name,
            (value) => {
                identity.name = value;
                invalidate();
            },
            { name: "skill-name" },
        ),
    );
    root.append(
        rbNode("h3", "Skill publication"),
        stepper,
        form,
        controls,
        rbNode(
            "small",
            "Publish creates an immutable DRAFT only. Approval, activation and bindings never authorize execution; runtime permissions still apply.",
            "hub-hint",
        ),
        status,
        previews,
        rbNode("h3", "Linked catalog revisions and exact lineage"),
        skills,
    );
    host.append(root);
    form.hidden = controls.hidden = Boolean(options.readOnly);
    function eligibilityReason() {
        return options.readOnly
            ? "Historical version is read-only; no publication or lifecycle mutation is available."
            : runbookPublicationReason(options.detail, options.dirty());
    }
    function refreshEligibility() {
        const reason = eligibilityReason();
        previewButton.disabled =
            working ||
            Boolean(reason) ||
            !identity.name.trim() ||
            !identity.origin.trim();
        publishButton.disabled =
            working ||
            Boolean(reason) ||
            !cachedPreview?.valid ||
            previewIdentity !== key();
        status.textContent =
            reason ??
            "The service validates exact saved version, hashes, bindings and package eligibility.";
        refreshStepper();
    }
    function renderPreview(preview: RunbookSkillPreview) {
        previews.replaceChildren(
            rbNode(
                "p",
                preview.valid
                    ? "Service validation: eligible to publish a draft."
                    : "Service validation: not eligible to publish.",
                preview.valid ? "" : "runbook-warning",
            ),
            rbNode(
                "p",
                preview.findings.length
                    ? preview.findings.join("\n")
                    : "Service returned no validation findings.",
            ),
            rbNode(
                "p",
                `Published snapshot would use procedure version ${preview.lineage.version}. Current saved version: ${options.detail.procedure?.version ?? "unsaved"}.`,
            ),
        );
        for (const file of preview.files) {
            const card = rbNode("details", undefined, "runbook-card");
            card.append(
                rbNode("summary", file.path),
                rbNode("pre", file.content, "runbook-text"),
            );
            previews.append(card);
        }
    }
    function isRequestedSkill(skill: RunbookSkill) {
        return (
            skill.revisionId === options.selectedRevisionId &&
            skill.lineage?.corpusId === options.detail.corpusId &&
            skill.lineage?.procedureId === options.detail.procedure?.procedureId
        );
    }
    function skillCard(skill: RunbookSkill) {
        const card = rbNode("article");
        card.dataset.skillRevisionId = skill.revisionId;
        card.tabIndex = -1;
        if (isRequestedSkill(skill)) {
            card.classList.add("runbook-selected");
            card.setAttribute("aria-current", "true");
            card.setAttribute(
                "aria-label",
                `Selected immutable revision: ${skill.displayName}`,
            );
        }
        const actions = rbNode("div", undefined, "runbook-controls");
        card.append(
            rbNode("h4", skill.displayName),
            rbNode(
                "p",
                `Scope: ${skill.identity.scope} · Origin: ${skill.identity.origin}`,
            ),
            rbNode(
                "p",
                `Catalog state: ${skill.state} · ${skill.active ? "active revision" : "not active"} · procedure state remains ${options.detail.procedure?.state ?? "candidate"}`,
            ),
            rbNode(
                "p",
                `Published procedure version ${skill.lineage?.version ?? "lineage unavailable"}; current guide version ${options.detail.procedure?.version ?? "unsaved"}. Editing the guide does not alter this skill.`,
            ),
            rbNode("p", skill.findings.join("\n"), "runbook-warning"),
        );
        for (const action of options.readOnly ? [] : skill.allowedActions) {
            actions.append(
                rbButton(skillActionLabel(action), () => {
                    void transition(skill, action);
                }),
            );
        }
        for (const file of skill.files) {
            actions.append(
                rbButton(`Read immutable file ${file.path}`, () => {
                    void readFile(skill, file.path, card);
                }),
            );
        }
        card.append(actions);
        return card;
    }
    function renderSkills() {
        skills.replaceChildren(...options.detail.skills.map(skillCard));
        if (!options.detail.skills.length)
            skills.append(
                rbNode(
                    "p",
                    "No linked catalog revisions were returned. No skill is created or activated implicitly.",
                ),
            );
        if (options.selectedRevisionId) {
            const matches = [
                ...skills.querySelectorAll<HTMLElement>("article"),
            ].filter((card) => card.getAttribute("aria-current") === "true");
            if (matches.length === 1) matches[0].focus();
            else {
                const warning = rbNode(
                    "p",
                    matches.length
                        ? "Requested revision matches multiple catalog identities; choose the explicitly qualified identity below. No identity was selected automatically."
                        : options.detail.skills.some(
                                (skill) =>
                                    skill.revisionId ===
                                    options.selectedRevisionId,
                            )
                          ? "Requested immutable skill revision is not linked to this corpus/procedure. No latest revision is substituted."
                          : "Requested immutable skill revision is unavailable. No latest revision is substituted.",
                    "runbook-warning",
                );
                warning.setAttribute("role", "alert");
                skills.prepend(warning);
                if (!selectionErrorReported) {
                    selectionErrorReported = true;
                    options.onError(
                        new Error(
                            warning.textContent ??
                                "Exact skill revision selection failed.",
                        ),
                    );
                }
            }
        }
    }
    async function request<T>(
        operation: () => Promise<T>,
    ): Promise<T | undefined> {
        const requestVersion = ++version;
        working = true;
        refreshEligibility();
        status.textContent = "Waiting for the skill service response…";
        try {
            const value = await operation();
            if (disposed || requestVersion !== version) return undefined;
            return value;
        } catch (error) {
            if (!disposed && requestVersion === version) {
                status.textContent = `Skill service request failed: ${rbError(error)}. Outcome may be unavailable; refresh before retrying.`;
                options.onError(error);
            }
            return undefined;
        } finally {
            working = false;
            if (!disposed && requestVersion === version) {
                previewButton.disabled =
                    Boolean(eligibilityReason()) ||
                    !identity.name.trim() ||
                    !identity.origin.trim();
                publishButton.disabled =
                    Boolean(eligibilityReason()) ||
                    !cachedPreview?.valid ||
                    previewIdentity !== key();
            }
        }
    }
    async function preview() {
        if (working || options.readOnly) return;
        const procedure = options.detail.procedure;
        if (!procedure || eligibilityReason()) return;
        const requestedIdentity = { ...identity };
        const requestedKey = key();
        cachedPreview = undefined;
        const value = await request(() =>
            invokeView("memoryHubPreviewSkill", {
                corpusId: procedure.corpusId,
                procedureId: procedure.procedureId,
                version: procedure.version,
                identity: requestedIdentity,
            }),
        );
        if (!value || requestedKey !== key()) return;
        if (
            value.identity.scope !== requestedIdentity.scope ||
            value.identity.origin !== requestedIdentity.origin ||
            value.identity.name !== requestedIdentity.name ||
            value.lineage.corpusId !== procedure.corpusId ||
            value.lineage.procedureId !== procedure.procedureId ||
            value.lineage.version !== procedure.version ||
            value.lineage.jsonHash !== procedure.jsonHash ||
            value.lineage.markdownHash !== procedure.markdownHash
        ) {
            const error = new Error(
                "Preview identity, exact procedure version or content hashes do not match the saved guide. Publication is unavailable.",
            );
            status.textContent = error.message;
            options.onError(error);
            return;
        }
        cachedPreview = value;
        previewIdentity = requestedKey;
        renderPreview(value);
        refreshEligibility();
    }
    async function publish() {
        if (working || options.readOnly) return;
        const procedure = options.detail.procedure;
        if (
            !procedure ||
            !cachedPreview?.valid ||
            previewIdentity !== key() ||
            eligibilityReason()
        )
            return;
        if (
            !confirm(
                "Publish this exact saved procedure version as a new immutable skill DRAFT? Nothing will be approved, activated or executed.",
            )
        )
            return;
        cachedPreview = undefined;
        const value = await request(() =>
            invokeView("memoryHubPublishSkill", {
                corpusId: procedure.corpusId,
                procedureId: procedure.procedureId,
                version: procedure.version,
                identity: { ...identity },
            }),
        );
        if (!value) return;
        if (value.state !== "draft" || value.active) {
            status.textContent =
                "Publication returned an unexpected non-DRAFT or active catalog state. This UI never requested approval or activation; refresh the catalog before continuing.";
            options.onError(new Error(status.textContent));
            await options.onChanged();
            return;
        }
        options.detail.skills = [...options.detail.skills, value];
        cachedPreview = undefined;
        renderSkills();
        refreshEligibility();
        status.textContent = `Published catalog state: ${value.state}. Publication does not grant execution permission.`;
        await options.onChanged();
    }
    async function transition(
        skill: RunbookSkill,
        action: RunbookSkill["allowedActions"][number],
    ) {
        if (
            working ||
            options.readOnly ||
            !skill.allowedActions.includes(action)
        )
            return;
        if (
            !confirm(
                `${skillActionLabel(action)} for this exact immutable skill revision in state ${skill.state}? Runtime execution permissions are unchanged.`,
            )
        )
            return;
        const value = await request(() =>
            invokeView("memoryHubSkillAction", {
                identity: skill.identity,
                revisionId: skill.revisionId,
                expectedState: skill.state,
                expectedActive: skill.active,
                action,
            }),
        );
        if (!value) return;
        options.detail.skills = options.detail.skills.map((entry) =>
            entry.revisionId === skill.revisionId &&
            JSON.stringify(entry.identity) === JSON.stringify(skill.identity)
                ? value
                : entry,
        );
        renderSkills();
        await options.onChanged();
        status.textContent = `Catalog revision is ${value.state}; the procedure remains unchanged.`;
    }
    async function readFile(
        skill: RunbookSkill,
        path: string,
        card: HTMLElement,
    ) {
        if (working) return;
        const value = await request(() =>
            invokeView("memoryHubSkillFile", {
                identity: skill.identity,
                revisionId: skill.revisionId,
                path,
            }),
        );
        if (value)
            card.append(
                rbNode("h4", value.path),
                rbNode("pre", value.content, "runbook-text"),
            );
    }
    refreshEligibility();
    renderSkills();
    return {
        refreshEligibility,
        dispose() {
            disposed = true;
            version++;
            root.remove();
        },
    };
}
