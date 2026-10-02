// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ProcedureVersion,
    RunbookJobResult,
} from "@typeagent/memory-service";
import type {
    RunbookDetail,
    RunbookDetailRequest,
    RunbookListRequest,
    RunbookOriginal,
    RunbookReadiness,
    RunbookSummary,
} from "@typeagent/browser-control-rpc/viewRpc";
import { invokeMemory, invokeView } from "./viewClient";
import { createRunbookDraft, type RunbookDraft } from "./memoryHubRunbookModel";
import { mountRunbookEdition } from "./memoryHubRunbookEdition";
import { mountRunbookOriginals } from "./memoryHubRunbookOriginals";
import { mountRunbookBinding } from "./memoryHubRunbookBinding";
import { mountRunbookSkills } from "./memoryHubRunbookSkills";
import { mountRunbookSynthesis } from "./memoryHubRunbookSynthesis";
import { createRunbookNavigation } from "./memoryHubRunbookNavigation";
import {
    rbButton,
    rbCheck,
    rbError,
    rbField,
    rbMarkdown,
    rbNode,
    rbReadOnlyEdition,
    rbSelect,
} from "./memoryHubRunbookUi";
import "./memoryHubRunbooks.css";

export type MemoryHubRunbooksOptions = {
    scope: () => string | undefined;
    onError: (error: unknown) => void;
    onChanged: () => void | Promise<void>;
    onOpenSource: (corpusId: string, sourceId: string) => void;
    onRouteChanged?: (request: RunbookDetailRequest | undefined) => void;
};
type DetailTab = "Overview" | "Steps" | "Original" | "Skill" | "History";
let mountId = 0;
export function mountMemoryHubRunbooks(
    host: HTMLElement,
    options: MemoryHubRunbooksOptions,
) {
    const instanceId = ++mountId;
    const root = rbNode("section", undefined, "memory-runbooks runbook-root");
    root.setAttribute("aria-label", "Runbook workspace");
    const list = rbNode("section");
    const detailHost = rbNode("section");
    detailHost.hidden = true;
    const listStatus = rbNode("p");
    listStatus.setAttribute("role", "status");
    const rows = rbNode("div", undefined, "runbook-list");
    const paging = rbNode("div", undefined, "runbook-controls");
    const query = rbNode("input");
    query.name = "runbook-query";
    query.type = "search";
    const queryLabel = rbNode("label", "Search runbooks");
    queryLabel.append(query);
    const filterForm = rbNode("form", undefined, "runbook-controls");
    let state: RunbookSummary["state"] | "all" = "all";
    let readiness: RunbookReadiness | "all" = "all";
    let needsReview = false;
    let appliedFilters: Omit<
        RunbookListRequest,
        "corpusId" | "pageSize" | "continuationToken"
    > = {};
    const submit = rbNode("button", "Apply runbook filters");
    submit.type = "submit";
    filterForm.append(
        queryLabel,
        rbSelect(
            "Procedure state (separate from skill state)",
            state,
            ["all", "detected", "draft", "saved", "stale", "archived"],
            (value) => {
                state = value;
            },
            "runbook-state",
        ),
        rbSelect(
            "Readiness",
            readiness,
            [
                "all",
                "detected",
                "howto",
                "runbook",
                "toolsBound",
                "skill",
                "active",
            ],
            (value) => {
                readiness = value;
            },
            "runbook-readiness",
        ),
        rbCheck(
            "Needs review",
            needsReview,
            (value) => {
                needsReview = value;
            },
            "runbook-needs-review",
        ),
        submit,
    );
    const create = rbButton(
        "New human how-to",
        () => newGuide(),
        "new-runbook",
    );
    list.append(
        rbNode("h2", "Runbooks", "runbook-list-heading"),
        rbNode(
            "p",
            "Human guides, derived agent editions and linked immutable skills have separate states. Bindings and lifecycle changes never grant execution permission.",
        ),
        create,
        filterForm,
        listStatus,
        rows,
        paging,
    );
    root.append(list, detailHost);
    host.append(root);
    let disposed = false;
    let epoch = 0;
    let listSequence = 0;
    let detailSequence = 0;
    let evidenceSequence = 0;
    let items: RunbookSummary[] = [];
    const navigationCursor = createRunbookNavigation();
    let pageIndex = 0;
    let tokens: Array<string | undefined> = [undefined];
    let listLoaded = false;
    let activeRequest: RunbookDetailRequest | undefined;
    let detail: RunbookDetail | undefined;
    let draft: RunbookDraft | undefined;
    let tab: DetailTab = "Overview";
    let editorMode: "Structured human guide" | "Compatible Markdown" =
        "Structured human guide";
    let detailStatus: HTMLElement | undefined;
    let saving = false;
    let pendingChanges = 0;
    const cleanups: Array<() => void> = [];
    const synthesisJobs = new Map<string, RunbookJobResult>();
    function report(error: unknown, target?: HTMLElement) {
        if (disposed) return;
        if (target)
            target.textContent = `Operation unavailable or failed: ${rbError(error)}. No success is assumed.`;
        options.onError(error);
    }
    async function notifyChanged(label = "Change committed") {
        try {
            await options.onChanged();
        } catch (error) {
            report(
                new Error(
                    `${label}; workspace/snapshot refresh unavailable: ${rbError(error)}`,
                ),
                detailStatus ?? listStatus,
            );
        }
    }
    function cleanupDetail() {
        for (const cleanup of cleanups.splice(0)) cleanup();
        detailHost.replaceChildren();
    }
    function readonly() {
        return activeRequest?.version !== undefined;
    }
    function changed() {
        evidenceSequence++;
        draft?.changed();
        for (const control of detailHost.querySelectorAll<HTMLInputElement>(
            'input[name="review-edition"],input[name="review-safety"],input[name^="safety-"]',
        ))
            control.checked = false;
        if (detailStatus)
            detailStatus.textContent =
                "Unsaved draft. Any prior version review is invalidated; linked skills remain unchanged.";
        detailHost
            .querySelector("[data-runbook-preview]")
            ?.replaceChildren(draftPreview());
        const reviewLabel = detailHost.querySelector(
            "[data-edition-review-state]",
        );
        if (reviewLabel)
            reviewLabel.textContent =
                "Unreviewed draft; save and explicitly review the new procedure version.";
    }
    function discardChanges(): boolean {
        const dialogOpen = Boolean(root.querySelector("dialog[open]"));
        if (saving || pendingChanges > 0) {
            report(
                new Error(
                    "Wait for the pending runbook change to complete before leaving this draft.",
                ),
                detailStatus,
            );
            return false;
        }
        if (!draft?.dirty && !dialogOpen) return true;
        if (
            !confirm(
                "Discard unsaved runbook edits and close open review dialogs? Saved versions and linked skills are unchanged.",
            )
        )
            return false;
        if (detail) draft = createRunbookDraft(detail);
        renderDetail();
        return true;
    }
    function openSource(corpusId: string, sourceId: string) {
        if (discardChanges()) options.onOpenSource(corpusId, sourceId);
    }
    function requestFor(item: RunbookSummary): RunbookDetailRequest {
        return {
            corpusId: item.corpusId,
            kind: item.kind,
            objectId: item.objectId,
        };
    }
    function listRequest(): RunbookListRequest {
        return {
            corpusId: options.scope(),
            ...appliedFilters,
            pageSize: 25,
            continuationToken: tokens[pageIndex],
        };
    }
    async function loadList() {
        const sequence = ++listSequence;
        const generation = epoch;
        create.disabled = !options.scope();
        listStatus.textContent = "Loading runbooks…";
        try {
            const page = await invokeView("memoryHubRunbooks", listRequest());
            if (disposed || sequence !== listSequence || generation !== epoch)
                return;
            items = page.items;
            navigationCursor.load(items);
            listLoaded = true;
            listStatus.textContent = `${page.total} matching runbooks (server total). ${page.errors.length ? "Partial corpus results; unavailable corpora are not empty success. " + page.errors.map((error) => `${error.operation}: ${error.message}`).join(" · ") : ""}${page.warnings.join(" · ")}`;
            rows.replaceChildren(...items.map(row));
            if (!items.length)
                rows.append(
                    rbNode(
                        "p",
                        page.errors.length
                            ? "No items are available from responding corpora; see partial errors above."
                            : page.total > 0
                              ? "This page has no items; other matching runbooks exist. Return to the previous page or apply filters to restart."
                              : "No runbooks match these filters.",
                    ),
                );
            const previous = rbButton("Previous runbook page", () => {
                if (pageIndex > 0) {
                    pageIndex--;
                    void loadList();
                }
            });
            previous.disabled = pageIndex === 0;
            const next = rbButton("Next runbook page", () => {
                if (page.nextContinuationToken) {
                    tokens[++pageIndex] = page.nextContinuationToken;
                    void loadList();
                }
            });
            next.disabled = !page.nextContinuationToken;
            paging.replaceChildren(
                previous,
                rbNode("span", `Page ${pageIndex + 1}`),
                next,
            );
        } catch (error) {
            if (sequence === listSequence && generation === epoch)
                report(error, listStatus);
        }
    }
    function row(item: RunbookSummary) {
        const card = rbNode("article");
        card.append(
            rbButton(item.title, () => {
                void openDetail(requestFor(item));
            }),
            rbNode(
                "p",
                `${item.corpusName} · procedure ${item.state} · readiness ${item.readiness} · agent edition ${item.editionState ?? "not created"} · ${item.boundSteps}/${item.totalSteps} bound steps`,
            ),
            rbNode(
                "p",
                `Linked catalog states: ${item.skills.length ? item.skills.map((skill) => skill.state).join(", ") : "no linked revisions returned; see catalog availability notices"}${item.drift.length ? ` · ${item.drift.length} changed binding/source notices` : ""}`,
            ),
            rbNode(
                "p",
                `${item.corpusId} · ${item.objectId} · version ${item.latestVersion ?? "candidate"}`,
                "runbook-inspector",
            ),
        );
        return card;
    }
    filterForm.addEventListener("submit", (event) => {
        event.preventDefault();
        appliedFilters = {
            query: query.value.trim() || undefined,
            ...(state !== "all" ? { states: [state] } : {}),
            ...(readiness !== "all" ? { readiness: [readiness] } : {}),
            ...(needsReview ? { needsReview: true } : {}),
        };
        pageIndex = 0;
        tokens = [undefined];
        void loadList();
    });
    async function openDetail(input: RunbookDetailRequest, position?: number) {
        if (!discardChanges()) return;
        const request = { ...input };
        const sequence = ++detailSequence;
        const generation = epoch;
        list.hidden = true;
        detailHost.hidden = false;
        cleanupDetail();
        const loading = rbNode("p", "Loading exact runbook detail…");
        loading.setAttribute("role", "status");
        detailHost.append(
            loading,
            rbButton("Back to runbooks", () => {
                void show();
            }),
        );
        try {
            const value = await invokeView("memoryHubRunbook", request);
            if (disposed || generation !== epoch || sequence !== detailSequence)
                return;
            if (value.corpusId !== request.corpusId)
                throw new Error(
                    "Runbook response corpus does not match the requested corpus.",
                );
            if (
                request.kind === "candidate" &&
                value.candidate?.candidateId !== request.objectId
            )
                throw new Error(
                    "Runbook candidate response identity does not match.",
                );
            if (
                request.kind === "procedure" &&
                (value.procedure?.procedureId !== request.objectId ||
                    (request.version !== undefined &&
                        value.procedure.version !== request.version))
            )
                throw new Error(
                    "Runbook procedure response identity/version does not match.",
                );
            detail = value;
            activeRequest = { ...request };
            navigationCursor.open(request, position);
            draft = createRunbookDraft(value);
            tab = request.skillRevisionId ? "Skill" : "Overview";
            editorMode = "Structured human guide";
            renderDetail();
            options.onRouteChanged?.(activeRequest);
        } catch (error) {
            if (generation === epoch && sequence === detailSequence)
                report(error, loading);
        }
    }
    function newGuide() {
        const corpusId = options.scope();
        if (!corpusId) {
            report(
                new Error(
                    "Choose a corpus before creating a runbook. All memory never guesses a mutation target.",
                ),
                listStatus,
            );
            return;
        }
        if (!discardChanges()) return;
        detailSequence++;
        detail = {
            corpusId,
            corpusName:
                items.find((item) => item.corpusId === corpusId)?.corpusName ??
                "Selected corpus",
            originals: [],
            history: [],
            skills: [],
            drift: [],
            warnings: [],
        };
        activeRequest = undefined;
        navigationCursor.clearSelection();
        draft = createRunbookDraft(detail);
        draft.changed();
        tab = "Overview";
        editorMode = "Structured human guide";
        list.hidden = true;
        detailHost.hidden = false;
        renderDetail();
        options.onRouteChanged?.(undefined);
    }
    function navigation() {
        const controls = rbNode("div", undefined, "runbook-controls");
        const previousEntry = navigationCursor.adjacent(-1);
        const nextEntry = navigationCursor.adjacent(1);
        const previous = rbButton(
            "Previous runbook",
            () => {
                if (previousEntry)
                    void openDetail(
                        previousEntry.request,
                        previousEntry.position,
                    );
            },
            "previous-runbook",
        );
        previous.disabled = !previousEntry;
        const next = rbButton(
            "Next runbook",
            () => {
                if (nextEntry)
                    void openDetail(nextEntry.request, nextEntry.position);
            },
            "next-runbook",
        );
        next.disabled = !nextEntry;
        controls.append(
            rbButton("Back to runbooks", () => {
                void show();
            }),
            previous,
            next,
        );
        if (!navigationCursor.hasPosition)
            controls.append(
                rbNode("span", "Previous/Next use the loaded list page."),
            );
        return controls;
    }
    function renderDetail() {
        if (!detail || !draft || disposed) return;
        cleanupDetail();
        detailStatus = rbNode(
            "p",
            readonly()
                ? "Exact historical version: read-only."
                : draft.dirty
                  ? "Unsaved draft; review invalidated."
                  : "Saved data loaded. No review, binding or lifecycle change is automatic.",
        );
        detailStatus.setAttribute("role", "status");
        const tabs = rbNode("div", undefined, "runbook-controls");
        tabs.setAttribute("role", "tablist");
        tabs.setAttribute("aria-label", "Runbook detail views");
        for (const name of [
            "Overview",
            "Steps",
            "Original",
            "Skill",
            "History",
        ] satisfies DetailTab[]) {
            const button = rbButton(name, () => {
                tab = name;
                renderDetail();
                detailHost
                    .querySelector<HTMLButtonElement>(`[data-tab="${name}"]`)
                    ?.focus();
            });
            button.setAttribute("role", "tab");
            button.setAttribute("aria-selected", String(tab === name));
            button.id = `runbook-${instanceId}-${name}`;
            button.dataset.tab = name;
            button.tabIndex = tab === name ? 0 : -1;
            button.setAttribute("aria-controls", `runbook-${instanceId}-panel`);
            button.addEventListener("keydown", (event) => {
                const names: DetailTab[] = [
                    "Overview",
                    "Steps",
                    "Original",
                    "Skill",
                    "History",
                ];
                let index = names.indexOf(tab);
                if (event.key === "ArrowRight")
                    index = (index + 1) % names.length;
                else if (event.key === "ArrowLeft")
                    index = (index + names.length - 1) % names.length;
                else if (event.key === "Home") index = 0;
                else if (event.key === "End") index = names.length - 1;
                else return;
                event.preventDefault();
                tab = names[index];
                renderDetail();
                detailHost
                    .querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)
                    ?.focus();
            });
            tabs.append(button);
        }
        const body = rbNode("div");
        body.setAttribute("role", "tabpanel");
        body.setAttribute("aria-label", tab);
        body.id = `runbook-${instanceId}-panel`;
        body.setAttribute("aria-labelledby", `runbook-${instanceId}-${tab}`);
        detailHost.append(
            navigation(),
            rbNode("h2", draft.document.title || "New human how-to"),
            rbNode(
                "p",
                `${detail.corpusName} · procedure state ${detail.procedure?.state ?? detail.candidate?.state ?? "new draft"} · version ${detail.procedure?.version ?? "not saved"}`,
            ),
            rbNode("p", detail.warnings.join("\n"), "runbook-warning"),
            detailStatus,
            tabs,
            body,
        );
        if (!readonly()) detailHost.append(mutations());
        if (tab === "Overview") overview(body);
        if (tab === "Steps") steps(body);
        if (tab === "Original") originals(body);
        if (tab === "Skill") {
            const panel = mountRunbookSkills(body, {
                detail,
                dirty: () => Boolean(draft?.dirty),
                readOnly: readonly(),
                selectedRevisionId: activeRequest?.skillRevisionId,
                onError: options.onError,
                onChanged: async () => {
                    await notifyChanged("Catalog change committed");
                },
            });
            cleanups.push(panel.dispose);
        }
        if (tab === "History") history(body);
    }
    function overview(body: HTMLElement) {
        if (!draft || !detail) return;
        if (readonly()) {
            body.append(draftPreview());
            return;
        }
        const columns = rbNode(
            "div",
            undefined,
            detail.candidate ? "runbook-columns" : "",
        );
        const editor = rbNode("div", undefined, "runbook-fields");
        editor.append(
            rbSelect(
                "Human guide editor",
                editorMode,
                ["Structured human guide", "Compatible Markdown"],
                (value) => {
                    try {
                        if (value === "Structured human guide")
                            draft?.useStructured();
                        else draft?.markdown();
                        editorMode = value;
                        renderDetail();
                    } catch (error) {
                        renderDetail();
                        report(error, detailStatus);
                    }
                },
                "human-editor-mode",
            ),
        );
        if (editorMode === "Compatible Markdown")
            editor.append(
                rbField(
                    "Compatible Markdown (canonical round-trip; citations and extra sections retained)",
                    draft.markdown(),
                    (value) => {
                        draft?.editMarkdown(value);
                        changed();
                    },
                    { multiline: true, name: "runbook-markdown" },
                ),
            );
        else {
            editor.append(
                rbField(
                    "Title",
                    draft.document.title,
                    (value) => {
                        if (draft) draft.document.title = value;
                        changed();
                    },
                    { name: "runbook-title" },
                ),
                rbField(
                    "Summary",
                    draft.document.summary ?? "",
                    (value) => {
                        if (draft) draft.document.summary = value;
                        changed();
                    },
                    { multiline: true, name: "runbook-summary" },
                ),
            );
            humanSteps(editor);
            for (const section of draft.document.additionalSections ?? [])
                editor.append(
                    rbField(
                        `Additional section: ${section.heading}`,
                        section.content,
                        (value) => {
                            section.content = value;
                            changed();
                        },
                        { multiline: true },
                    ),
                );
            editor.append(
                rbNode(
                    "p",
                    `${draft.document.citations.length} retained citations. Structured edits preserve citations, extra sections and unknown document fields.`,
                ),
            );
        }
        const preview = rbNode("div");
        preview.dataset.runbookPreview = "true";
        preview.append(draftPreview());
        editor.append(preview);
        columns.append(editor);
        if (detail.candidate) {
            const originalHost = rbNode("div");
            columns.append(originalHost);
            const originalPanel = mountRunbookOriginals(
                originalHost,
                detail.originals,
                {
                    corpusId: detail.corpusId,
                    onOpenSource: openSource,
                    onError: options.onError,
                },
            );
            cleanups.push(originalPanel.dispose);
        }
        body.append(columns);
        if (detail.procedure?.state === "stale")
            body.append(
                rbButton(
                    "Compare previous, updated and current agent edition",
                    () => {
                        void compare(body);
                    },
                    "compare-runbook",
                ),
            );
    }
    function draftPreview() {
        const preview = draft?.preview();
        return preview?.content !== undefined
            ? rbMarkdown(preview.content)
            : rbNode(
                  "p",
                  `Markdown preview unavailable until the draft is complete: ${preview?.error ?? "no draft"}. Edits are retained.`,
                  "runbook-warning",
              );
    }
    function humanSteps(editor: HTMLElement) {
        if (!draft) return;
        const container = rbNode("div");
        for (const [index, text] of draft.document.steps.entries())
            container.append(
                rbField(
                    `Human step ${index + 1}`,
                    text,
                    (value) => {
                        if (draft) draft.document.steps[index] = value;
                        changed();
                    },
                    { multiline: true, name: `human-step-${index + 1}` },
                ),
                rbButton(`Remove human step ${index + 1}`, () => {
                    draft?.document.steps.splice(index, 1);
                    changed();
                    renderDetail();
                }),
            );
        container.append(
            rbButton("Add human step", () => {
                draft?.document.steps.push("");
                changed();
                renderDetail();
            }),
        );
        editor.append(container);
    }
    function steps(body: HTMLElement) {
        if (!draft || !detail) return;
        const edition = draft.document.agentEdition;
        if (readonly()) {
            body.append(rbReadOnlyEdition(draft.document));
            return;
        }
        if (!edition) {
            body.append(
                rbNode(
                    "p",
                    "This existing human guide has no agent edition. It remains a valid how-to. Model synthesis is unavailable in this workspace; create a manual derived draft explicitly.",
                ),
                rbButton(
                    "Create manual agent edition draft",
                    () => {
                        draft?.addEdition();
                        renderDetail();
                    },
                    "create-edition",
                ),
            );
            return;
        }
        const bindings = mountRunbookBinding(root, {
            procedure: () => detail?.procedure,
            dirty: () => Boolean(draft?.dirty),
            onSaved: acceptSaved,
            onError: options.onError,
            onPendingChanged: (pending) => {
                pendingChanges = Math.max(
                    0,
                    pendingChanges + (pending ? 1 : -1),
                );
            },
        });
        cleanups.push(bindings.dispose);
        mountRunbookEdition(body, edition, {
            changed,
            onBind: (stepId) => {
                void bindings.open(stepId);
            },
            onEvidence: (stepId) => {
                const step = edition.steps.find((step) => step.id === stepId);
                if (!step || !detail) return;
                void loadStepEvidence(body, step.citations);
            },
            safetyReviewed: draft.safetyReviewed,
            availableAssets: detail.originals.flatMap(
                (original) => original.assets,
            ),
            availableOriginals: detail.originals,
            markSecret: (input, secret) => {
                draft?.markSecret(input, secret);
                renderDetail();
            },
        });
        body.append(
            rbCheck(
                "Explicitly review agent edition for the newly saved procedure version",
                draft.reviewRequested,
                (value) => draft?.setReview(value),
                "review-edition",
            ),
            rbCheck(
                "I reviewed applicability, citations, inputs, all binding choices, verification and state-changing safety",
                draft.safetyConfirmed,
                (value) => draft?.setSafety(value),
                "review-safety",
            ),
        );
    }
    async function loadStepEvidence(
        body: HTMLElement,
        citations: RunbookDraft["document"]["citations"],
    ) {
        if (!detail) return;
        const generation = epoch;
        const sequence = detailSequence;
        const corpusId = detail.corpusId;
        const originals = detail.originals;
        const evidenceVersion = ++evidenceSequence;
        const values = await Promise.all(
            citations.map(async (citation) => {
                const retained = originals.find(
                    (original) =>
                        original.citation.sourceId === citation.sourceId &&
                        original.citation.revisionId === citation.revisionId &&
                        original.citation.locator === citation.locator,
                );
                if (retained) return retained;
                try {
                    return await invokeView("memoryHubRunbookOriginal", {
                        corpusId,
                        sourceId: citation.sourceId,
                        revisionId: citation.revisionId,
                        locator: citation.locator,
                    });
                } catch (error) {
                    if (
                        !disposed &&
                        generation === epoch &&
                        sequence === detailSequence &&
                        evidenceVersion === evidenceSequence &&
                        body.isConnected
                    )
                        report(error, detailStatus);
                    return undefined;
                }
            }),
        );
        if (
            disposed ||
            generation !== epoch ||
            sequence !== detailSequence ||
            evidenceVersion !== evidenceSequence ||
            !body.isConnected
        )
            return;
        const available = values.filter(
            (value): value is RunbookOriginal => value !== undefined,
        );
        const panel = mountRunbookOriginals(body, available, {
            corpusId,
            onOpenSource: openSource,
            onError: options.onError,
        });
        cleanups.push(panel.dispose);
        if (available.length !== citations.length)
            body.append(
                rbNode(
                    "p",
                    "Some exact cited originals are unavailable. Review is not inferred from partial evidence.",
                    "runbook-warning",
                ),
            );
    }
    function mutations() {
        const controls = rbNode("div", undefined, "runbook-controls");
        const save = rbButton(
            "Save runbook version",
            () => {
                void saveDraft();
            },
            "save-runbook",
        );
        save.disabled = saving;
        controls.append(
            save,
            rbButton(
                "Reload latest / discard draft",
                () => {
                    if (activeRequest)
                        void openDetail({
                            ...activeRequest,
                            version: undefined,
                        });
                    else if (discardChanges()) newGuide();
                },
                "reload-runbook",
            ),
        );
        if (detail?.candidate)
            controls.append(
                rbButton(
                    "Reject candidate",
                    () => {
                        void reject();
                    },
                    "reject-candidate",
                ),
            );
        if (detail?.procedure && detail.procedure.state !== "archived")
            controls.append(
                rbButton(
                    "Archive human how-to",
                    () => {
                        void archive();
                    },
                    "archive-runbook",
                ),
            );
        return controls;
    }
    async function acceptSaved(
        procedure: ProcedureVersion,
        allowDirty = false,
    ) {
        if (!detail || disposed) return;
        if (
            procedure.corpusId !== detail.corpusId ||
            (detail.procedure &&
                procedure.procedureId !== detail.procedure.procedureId)
        ) {
            report(
                new Error(
                    "Mutation response identity does not match the selected runbook; draft retained.",
                ),
                detailStatus,
            );
            return;
        }
        if (draft?.dirty && !allowDirty) {
            report(
                new Error(
                    "A concurrent operation committed, but unsaved edits are retained. Reload explicitly to obtain its version.",
                ),
                detailStatus,
            );
            await notifyChanged();
            return;
        }
        detail = { ...detail, candidate: undefined, procedure };
        activeRequest = {
            corpusId: procedure.corpusId,
            kind: "procedure",
            objectId: procedure.procedureId,
            ...(activeRequest?.skillRevisionId
                ? { skillRevisionId: activeRequest.skillRevisionId }
                : {}),
        };
        navigationCursor.replace(activeRequest);
        draft = createRunbookDraft(detail);
        renderDetail();
        options.onRouteChanged?.(activeRequest);
        listLoaded = false;
        await notifyChanged("Runbook version committed");
    }
    async function saveDraft() {
        if (!draft || !detail || readonly() || saving) return;
        let request;
        try {
            request = draft.saveRequest();
        } catch (error) {
            report(error, detailStatus);
            return;
        }
        const generation = epoch;
        const sequence = detailSequence;
        const controls = [
            ...detailHost.querySelectorAll<
                | HTMLInputElement
                | HTMLButtonElement
                | HTMLSelectElement
                | HTMLTextAreaElement
            >("input,button,select,textarea"),
        ].map((control) => ({ control, disabled: control.disabled }));
        saving = true;
        for (const { control } of controls) control.disabled = true;
        const button = detailHost.querySelector<HTMLButtonElement>(
            '[name="save-runbook"]',
        );
        if (button) button.disabled = true;
        try {
            const procedure = await invokeView("memoryHubSaveRunbook", request);
            if (disposed) return;
            if (generation !== epoch || sequence !== detailSequence) {
                await notifyChanged();
                return;
            }
            await acceptSaved(procedure, true);
        } catch (error) {
            if (generation === epoch && sequence === detailSequence)
                report(
                    new Error(
                        `Save failed; your draft and expected version are retained. ${rbError(error)}. Reload latest / discard is available; no overwrite is attempted.`,
                    ),
                    detailStatus,
                );
        } finally {
            saving = false;
            for (const { control, disabled } of controls)
                if (control.isConnected) control.disabled = disabled;
            const currentButton = detailHost.querySelector<HTMLButtonElement>(
                '[name="save-runbook"]',
            );
            if (currentButton) currentButton.disabled = false;
        }
    }
    async function reject() {
        const candidate = detail?.candidate;
        if (
            !candidate ||
            !discardChanges() ||
            !confirm(
                "Reject this exact candidate? No procedure or skill will be created.",
            )
        )
            return;
        const generation = epoch;
        const sequence = detailSequence;
        try {
            await invokeMemory("memoryRejectProcedureCandidate", {
                corpusId: candidate.corpusId,
                candidateId: candidate.candidateId,
            });
            if (disposed) return;
            if (generation !== epoch || sequence !== detailSequence) {
                await notifyChanged();
                return;
            }
            draft = undefined;
            const adjacent = navigationCursor.remove();
            listLoaded = false;
            await notifyChanged("Candidate rejection committed");
            if (adjacent) await openDetail(adjacent.request, adjacent.position);
            else await show();
        } catch (error) {
            if (generation === epoch && sequence === detailSequence)
                report(error, detailStatus);
        }
    }
    async function archive() {
        const procedure = detail?.procedure;
        if (
            !procedure ||
            !discardChanges() ||
            !confirm(
                "Archive this human how-to version? Linked skills are unchanged and may require separate lifecycle management.",
            )
        )
            return;
        const generation = epoch;
        const sequence = detailSequence;
        try {
            const archived = await invokeMemory("memoryArchiveProcedure", {
                corpusId: procedure.corpusId,
                procedureId: procedure.procedureId,
                expectedVersion: procedure.version,
            });
            if (disposed) return;
            if (generation !== epoch || sequence !== detailSequence) {
                await notifyChanged();
                return;
            }
            await acceptSaved(archived);
        } catch (error) {
            if (generation === epoch && sequence === detailSequence)
                report(error, detailStatus);
        }
    }
    function originals(body: HTMLElement) {
        if (!detail) return;
        const panel = mountRunbookOriginals(body, detail.originals, {
            corpusId: detail.corpusId,
            onOpenSource: openSource,
            onError: options.onError,
        });
        cleanups.push(panel.dispose);
        for (const sourceId of new Set(
            detail.originals.map((original) => original.citation.sourceId),
        ))
            body.append(
                rbButton(
                    "Used by: guides and linked skills for this source",
                    () => {
                        void usedBy(body, sourceId);
                    },
                ),
            );
    }
    async function usedBy(
        body: HTMLElement,
        sourceId: string,
        continuationToken?: string,
    ) {
        if (!detail) return;
        const generation = epoch;
        const sequence = detailSequence;
        const corpusId = detail.corpusId;
        try {
            const page = await invokeView("memoryHubRunbookUsedBy", {
                corpusId,
                sourceId,
                continuationToken,
                pageSize: 25,
            });
            if (
                disposed ||
                generation !== epoch ||
                sequence !== detailSequence ||
                !body.isConnected
            )
                return;
            const card = rbNode("article");
            card.append(
                rbNode(
                    "h3",
                    `Used by: ${page.total} procedures (server total)`,
                ),
                rbNode("p", page.warnings.join("\n"), "runbook-warning"),
            );
            for (const item of page.items)
                card.append(
                    rbButton(
                        `${item.procedure.document.title} · version ${item.procedure.version} · ${item.skills.length} linked catalog revisions`,
                        () => {
                            void openDetail({
                                corpusId: item.procedure.corpusId,
                                kind: "procedure",
                                objectId: item.procedure.procedureId,
                                version: item.procedure.version,
                            });
                        },
                    ),
                );
            if (page.nextContinuationToken)
                card.append(
                    rbButton("More source dependencies", () => {
                        void usedBy(body, sourceId, page.nextContinuationToken);
                    }),
                );
            body.append(card);
        } catch (error) {
            if (generation === epoch && sequence === detailSequence)
                report(error, detailStatus);
        }
    }
    function history(body: HTMLElement) {
        if (!detail?.procedure) {
            body.append(
                rbNode(
                    "p",
                    "Candidates and unsaved guides do not have procedure version history.",
                ),
            );
            return;
        }
        body.append(
            rbNode(
                "p",
                "Version history is read-only. Sources retain their own exact revision identity; published skills remain linked to the version they snapshot.",
            ),
            rbButton(
                "Load saved version history",
                () => {
                    void loadHistory(body);
                },
                "load-history",
            ),
        );
        for (const version of detail.history)
            body.append(historyLink(version.version, version.state));
    }
    function historyLink(version: number, state: string) {
        return rbButton(`Read exact version ${version} · ${state}`, () => {
            if (detail?.procedure)
                void openDetail({
                    corpusId: detail.corpusId,
                    kind: "procedure",
                    objectId: detail.procedure.procedureId,
                    version,
                });
        });
    }
    async function loadHistory(body: HTMLElement, beforeVersion?: number) {
        const procedure = detail?.procedure;
        if (!procedure) return;
        const generation = epoch;
        const sequence = detailSequence;
        try {
            const page = await invokeView("memoryHubRunbookHistory", {
                corpusId: procedure.corpusId,
                procedureId: procedure.procedureId,
                beforeVersion,
                pageSize: 25,
            });
            if (
                disposed ||
                generation !== epoch ||
                sequence !== detailSequence ||
                !body.isConnected
            )
                return;
            const card = rbNode("article");
            card.append(
                rbNode("h3", `History: ${page.total} versions (server total)`),
                ...page.items.map((version) =>
                    historyLink(version.version, version.state),
                ),
            );
            if (page.items.length && page.nextContinuationToken)
                card.append(
                    rbButton("Older versions", () => {
                        void loadHistory(
                            body,
                            Math.min(
                                ...page.items.map((version) => version.version),
                            ),
                        );
                    }),
                );
            body.append(card);
        } catch (error) {
            if (generation === epoch && sequence === detailSequence)
                report(error, detailStatus);
        }
    }
    async function compare(body: HTMLElement) {
        const procedure = detail?.procedure;
        if (!procedure) return;
        const generation = epoch;
        const sequence = detailSequence;
        try {
            const value = await invokeView("memoryHubCompareRunbook", {
                corpusId: procedure.corpusId,
                procedureId: procedure.procedureId,
                version: procedure.version,
            });
            if (
                disposed ||
                generation !== epoch ||
                sequence !== detailSequence ||
                !body.isConnected
            )
                return;
            const columns = rbNode(
                "div",
                undefined,
                "runbook-columns runbook-compare",
            );
            const previous = rbNode("section");
            previous.append(rbNode("h3", "Previous exact originals"));
            const updated = rbNode("section");
            updated.append(rbNode("h3", "Updated exact originals"));
            const current = rbNode("section");
            current.append(
                rbNode("h3", "Current agent edition (not overwritten)"),
                rbNode(
                    "p",
                    "Comparison does not change your draft, review or linked skills. Create new draft requests a separate candidate from an exact updated original; synthesis availability depends on the host.",
                ),
                rbNode("p", value.warnings.join("\n"), "runbook-warning"),
            );
            for (const affected of value.affectedSteps)
                current.append(
                    rbNode(
                        "p",
                        `${affected.stepId}: ${affected.reasons.join("; ")}`,
                        "runbook-affected",
                    ),
                );
            const safeCurrent = createRunbookDraft({
                corpusId: procedure.corpusId,
                corpusName: detail?.corpusName ?? "Selected corpus",
                procedure: value.current,
                originals: [],
                history: [],
                skills: [],
                drift: [],
                warnings: [],
            }).document;
            current.append(rbReadOnlyEdition(safeCurrent));
            for (const [target, source] of [
                [previous, value.previous],
                [updated, value.updated],
            ] satisfies Array<[HTMLElement, typeof value.previous]>) {
                const panel = mountRunbookOriginals(target, source, {
                    corpusId: procedure.corpusId,
                    onOpenSource: openSource,
                    onError: options.onError,
                });
                cleanups.push(panel.dispose);
            }
            for (const original of value.updated) {
                const jobKey = JSON.stringify([
                    procedure.corpusId,
                    procedure.procedureId,
                    procedure.version,
                    original.citation.sourceId,
                    original.citation.revisionId,
                ]);
                const panel = mountRunbookSynthesis(updated, {
                    procedure,
                    original,
                    initialJob: synthesisJobs.get(jobKey),
                    onRecorded: (job) => {
                        synthesisJobs.set(jobKey, job);
                    },
                    onError: options.onError,
                    onChanged: async () => {
                        listLoaded = false;
                        await notifyChanged(
                            "Synthesis job/candidate state recorded",
                        );
                    },
                    onPendingChanged: (pending) => {
                        pendingChanges = Math.max(
                            0,
                            pendingChanges + (pending ? 1 : -1),
                        );
                    },
                    onOpenCandidate: (corpusId, candidateId) => {
                        void openDetail({
                            corpusId,
                            kind: "candidate",
                            objectId: candidateId,
                        });
                    },
                });
                cleanups.push(panel.dispose);
            }
            columns.append(previous, updated, current);
            body.append(columns);
        } catch (error) {
            if (generation === epoch && sequence === detailSequence)
                report(error, detailStatus);
        }
    }
    async function show(request?: RunbookDetailRequest) {
        if (disposed) return;
        if (request) {
            await openDetail(request);
            return;
        }
        if (!discardChanges()) return;
        detailSequence++;
        cleanupDetail();
        detail = undefined;
        draft = undefined;
        activeRequest = undefined;
        navigationCursor.clearSelection();
        list.hidden = false;
        detailHost.hidden = true;
        options.onRouteChanged?.(undefined);
        if (!listLoaded) await loadList();
    }
    function scopeChanged() {
        if (!discardChanges()) return;
        epoch++;
        listSequence++;
        detailSequence++;
        listLoaded = false;
        items = [];
        navigationCursor.reset();
        pageIndex = 0;
        tokens = [undefined];
        detail = undefined;
        draft = undefined;
        activeRequest = undefined;
        cleanupDetail();
        rows.replaceChildren();
        paging.replaceChildren();
        list.hidden = false;
        detailHost.hidden = true;
        options.onRouteChanged?.(undefined);
        void loadList();
    }
    function beforeUnload(event: BeforeUnloadEvent) {
        if (draft?.dirty || saving || pendingChanges > 0) {
            event.preventDefault();
            event.returnValue = "";
        }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return {
        show,
        scopeChanged,
        discardChanges,
        dispose() {
            disposed = true;
            epoch++;
            listSequence++;
            detailSequence++;
            cleanupDetail();
            window.removeEventListener("beforeunload", beforeUnload);
            root.remove();
        },
    };
}
