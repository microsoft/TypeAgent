// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryQuestion,
    QuestionEdit,
    QuestionSummaryPage,
    ViewCitation,
} from "@typeagent/memory-service";
import { invokeMemory, invokeView } from "./viewClient";
import { MemoryHubInventoryPager } from "./memoryHubInventoryPager";
import {
    rbButton,
    rbChip,
    rbIconButton,
    rbNode,
    rbField,
    rbError,
} from "./memoryHubDocumentUi";
import { icon, menuButton, setTabLabel } from "./memoryHubUi";
import {
    questionAttention,
    questionIdentity,
    questionReason,
    parseQuestionAssertion,
    questionCandidateCount,
    type QuestionListItem,
} from "./memoryHubQuestionsModel";
import { routeHash, type HiddenItems, type HubRoute } from "./memoryHubModel";
import { schemaViewPageBrowserLink } from "./memoryHubViewPages";
import { mountMemoryHubAcquisitions } from "./memoryHubAcquisitions";
import { mountMemoryHubKnowledgeStatus } from "./memoryHubKnowledgeStatus";
import type { InboxAttentionCard } from "./memoryHubInbox";

type QuestionTarget = Pick<MemoryQuestion, "corpusId" | "viewId"> & {
    slot: { id: string; question?: string };
};

export function mountMemoryHubQuestions(
    host: HTMLElement,
    attentionHost: HTMLElement,
    options: {
        scope: () => string | undefined;
        corpora: () => Array<{ corpusId: string; name: string }>;
        hidden: HiddenItems;
        persistHidden: () => void;
        onError: (error: unknown) => void;
        onOpenSource: (corpusId: string, sourceId: string) => void;
        onNavigate?: (route: HubRoute) => void;
        onAttentionCount?: (count: number, hasMore?: boolean) => void;
        onAttentionError?: (error: unknown) => void;
        presentAttention?: (card: InboxAttentionCard) => HTMLElement;
    },
) {
    let inventories = new Map<string, QuestionSummaryPage>();
    const pager = new MemoryHubInventoryPager();
    let attentionOnly = false;
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    const pagination = rbNode("div");
    let sequence = 0;
    let selectedView: string | undefined;
    let selectedCorpus: string | undefined;
    let busy = false;
    let dirty = false;
    type Filter = "all" | "open" | "answered";
    let selectedKey: string | undefined;
    let selectedQuestion: QuestionTarget | undefined;
    let readerHead: QuestionSummaryPage["head"] | undefined;
    let filter: Filter = "all";
    let search = "";
    let loadedAt = 0;
    let loadedScope: string | undefined;
    let schemaViewsSupported = false;
    let failureLines: string[] = [];
    const status = rbChip("");
    status.setAttribute("role", "status");
    const total = rbNode("span", "Loading...", "hub-list-total");
    const notice = rbNode("div", undefined, "hub-notice");
    notice.hidden = true;
    const list = rbNode("div", undefined, "hub-qlist");
    const inspector = rbNode(
        "article",
        undefined,
        "hub-qdetail hub-view-document",
    );
    inspector.setAttribute("aria-label", "Question inspector");
    const reader = rbNode("section", undefined, "hub-question-reader");
    reader.hidden = true;
    const readerActions = rbNode("div", undefined, "hub-view-actions");
    const back = rbIconButton(
        "fa-arrow-left",
        "Back to questions",
        backToQuestions,
    );
    readerActions.append(back);
    reader.append(readerActions, inspector);
    const author = rbNode("section");
    const acquisitionHost = rbNode("section");
    const acquisitions = mountMemoryHubAcquisitions(acquisitionHost);
    const knowledgeHost = rbNode("section");
    const knowledge = mountMemoryHubKnowledgeStatus(knowledgeHost);
    const knowledgePanel = rbNode("details", undefined, "hub-panel");
    knowledgePanel.append(
        rbNode("summary", "Knowledge preparation"),
        knowledgeHost,
    );
    let knowledgeLoaded = false;
    async function loadKnowledge() {
        if (!knowledgePanel.open || knowledgeLoaded || attentionOnly) return;
        knowledgeLoaded = true;
        await knowledge.refresh(panelCorpora);
    }
    knowledgePanel.addEventListener("toggle", () => {
        void loadKnowledge().catch(options.onError);
    });
    const panel = rbNode("details", undefined, "hub-panel");
    panel.append(
        rbNode("summary", "Deferred evidence acquisition"),
        acquisitionHost,
    );
    let panelCorpora: Array<{ corpusId: string; name: string }> = [];
    let panelLoaded = false;
    async function loadPanel() {
        if (!panel.open || panelLoaded || attentionOnly) return;
        panelLoaded = true;
        await acquisitions.refresh(panelCorpora, selectedView);
    }
    panel.addEventListener("toggle", () => {
        void loadPanel().catch((error: unknown) => options.onError(error));
    });
    const chips = rbNode("div", undefined, "hub-tabs");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Question filter");
    for (const [value, label, glyph] of [
        ["all", "All", "fa-list"],
        ["open", "Open", "fa-circle-question"],
        ["answered", "Answered", "fa-circle-check"],
    ] as const) {
        const chip = rbButton(label, () => {
            filter = value;
            for (const other of chips.querySelectorAll("button"))
                other.setAttribute("aria-pressed", String(other === chip));
            renderList();
            pager.reset();
            void refresh().catch(options.onError);
        });
        setTabLabel(chip, glyph, label);
        chip.setAttribute("aria-pressed", String(value === filter));
        chips.append(chip);
    }
    const searchBox = rbNode("input");
    searchBox.type = "search";
    searchBox.placeholder = "Filter questions";
    searchBox.setAttribute("aria-label", "Filter questions");
    searchBox.addEventListener("input", () => {
        search = searchBox.value.trim().toLowerCase();
        renderList();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            pager.reset();
            void refresh().catch(options.onError);
        }, 250);
    });
    const head = rbNode("div", undefined, "hub-page-head hub-qhead");
    head.append(
        rbNode("h2", "Questions"),
        status,
        rbNode("span", undefined, "hub-spacer"),
        rbIconButton("fa-plus", "Propose a question", () => {
            const form = author.querySelector("details");
            if (form) {
                form.open = true;
                form.scrollIntoView?.({ block: "nearest" });
            }
        }),
        rbIconButton(
            "fa-rotate-left",
            "Restore dismissed question decisions",
            () => {
                for (const question of all())
                    delete options.hidden[questionIdentity(question)];
                options.persistHidden();
                renderAttention();
            },
        ),
        rbIconButton("fa-gear", "Deferred evidence acquisition", () => {
            panel.open = !panel.open;
            if (panel.open) panel.scrollIntoView?.({ block: "nearest" });
        }),
    );
    const filters = rbNode("div", undefined, "hub-qfilters");
    filters.append(searchBox);
    const card = rbNode("section", undefined, "card hub-list-card");
    card.setAttribute("aria-label", "Questions list");
    const cardHead = rbNode("div", undefined, "section-heading");
    cardHead.append(rbNode("h2", "Questions"), total);
    card.append(cardHead, notice, filters, list, pagination);
    host.append(head, chips, card, reader, author, panel, knowledgePanel);

    function setDetailMode(detail: boolean) {
        reader.hidden = !detail;
        for (const element of [
            head,
            chips,
            card,
            author,
            panel,
            knowledgePanel,
        ])
            element.hidden = detail;
    }

    function backToQuestions() {
        if (busy || (dirty && !confirm("Discard unsaved question edits?")))
            return;
        dirty = false;
        detailSequence++;
        selectedKey = undefined;
        selectedQuestion = undefined;
        inspector.setAttribute("aria-busy", "false");
        inspector.replaceChildren();
        if (options.onNavigate)
            options.onNavigate({
                page: "questions",
                ...(selectedView ? { objectId: selectedView } : {}),
                ...(selectedCorpus ? { corpusId: selectedCorpus } : {}),
            });
        else {
            setDetailMode(false);
            renderList();
        }
    }

    function action(work: () => Promise<void>) {
        if (busy) return;
        busy = true;
        void work()
            .catch((error: unknown) => {
                status.textContent = `Question operation failed: ${rbError(error)}`;
                if (!reader.hidden) {
                    const alert = rbNode("p", status.textContent);
                    alert.setAttribute("role", "alert");
                    inspector.append(alert);
                }
                options.onError(error);
            })
            .finally(() => {
                busy = false;
            });
    }
    function all() {
        return [...inventories.values()].flatMap(
            (inventory) => inventory.items,
        );
    }
    function evidence(
        corpusId: string,
        citations: ViewCitation[],
        label: string,
    ) {
        const section = rbNode("section");
        section.append(rbNode("h5", label));
        if (!citations.length)
            section.append(
                rbNode(
                    "p",
                    "No source citations (user assertions are not source evidence).",
                ),
            );
        for (const citation of citations) {
            section.append(rbNode("blockquote", citation.excerpt));
            section.append(
                rbIconButton(
                    "fa-arrow-up-right-from-square",
                    `${citation.sourceId} @ ${citation.revisionId} · ${citation.locator}`,
                    () =>
                        action(async () => {
                            const original = citation.evidence
                                ? await invokeView("memoryHubEvidence", {
                                      corpusId,
                                      kind: "event",
                                      objectId: citation.evidence.eventId,
                                      revisionId: citation.revisionId,
                                  })
                                : await invokeView("memoryHubSourceOriginal", {
                                      corpusId,
                                      sourceId: citation.sourceId,
                                      revisionId: citation.revisionId,
                                      locator: citation.locator,
                                  });
                            if ("available" in original && !original.available)
                                throw new Error(
                                    original.error ??
                                        "Original question evidence is unavailable.",
                                );
                            section.append(
                                rbNode("h5", original.title),
                                rbNode("pre", original.content),
                            );
                        }),
                ),
            );
        }
        return section;
    }
    function questionHead(question: QuestionTarget) {
        if (
            readerHead === undefined ||
            selectedKey !== questionIdentity(question) ||
            reader.hidden
        )
            throw new Error(
                "Question inventory is unavailable. Reload the question before modifying it.",
            );
        return readerHead;
    }
    async function edit(question: MemoryQuestion, edit: QuestionEdit) {
        const current = detailSequence;
        await invokeMemory("memoryEditQuestion", {
            corpusId: question.corpusId,
            viewId: question.viewId,
            slotId: question.slot.id,
            expectedHead: questionHead(question),
            expectedVersion: question.viewVersion,
            edit,
        });
        dirty = false;
        await refreshReader(question, current);
    }
    async function refreshReader(question: QuestionTarget, current: number) {
        loadedAt = 0;
        const updated = await fetchQuestion(question);
        if (current !== detailSequence || reader.hidden) return;
        readerHead = updated.head;
        selectedQuestion = updated.detail;
        inspect(updated.detail);
    }
    function originLabel(question: QuestionListItem) {
        return (
            "discoveryCitationCount" in question.slot
                ? question.slot.discoveryCitationCount
                : question.slot.discoveryCitations.length
        )
            ? "Source-proposed"
            : "User-defined";
    }
    function questionKey(question: QuestionListItem) {
        return questionIdentity(question);
    }
    function valueNode(value: unknown): HTMLElement {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            const fields = rbNode("dl", undefined, "hub-fields");
            for (const [key, item] of Object.entries(value)) {
                fields.append(
                    rbNode("dt", key),
                    rbNode(
                        "dd",
                        typeof item === "string" ? item : JSON.stringify(item),
                    ),
                );
            }
            return fields;
        }
        return rbNode(
            "strong",
            typeof value === "string" ? value : JSON.stringify(value),
        );
    }
    // List rows: the answer state, plus a count only when it is not 1.
    function rowChips(question: QuestionListItem) {
        const row = rbNode("div", undefined, "hub-chips");
        row.append(
            rbChip(
                question.details.answerState,
                question.details.answerState === "conflicted"
                    ? "bad"
                    : question.details.answerState === "answered"
                      ? "good"
                      : undefined,
            ),
        );
        const count = questionCandidateCount(question);
        if (count > 1) row.append(rbChip(`${count} candidates`));
        return row;
    }
    async function fetchQuestion(question: QuestionTarget) {
        const [detail, page] = await Promise.all([
            invokeMemory("memoryGetQuestion", {
                corpusId: question.corpusId,
                viewId: question.viewId,
                slotId: question.slot.id,
            }),
            invokeMemory("memoryListQuestionSummaries", {
                corpusId: question.corpusId,
                viewId: question.viewId,
                pageSize: 1,
            }),
        ]);
        if (!detail) throw new Error("This question is no longer available.");
        return { detail, head: page.head };
    }
    let detailSequence = 0;
    function select(question: QuestionListItem) {
        if (options.onNavigate) {
            options.onNavigate({
                page: "questions",
                corpusId: question.corpusId,
                objectId: question.viewId,
                questionSlotId: question.slot.id,
            });
        } else void loadDetail(question);
    }
    async function loadDetail(question: QuestionTarget) {
        if (busy) return;
        if (dirty && !confirm("Discard unsaved question edits?")) return;
        dirty = false;
        const current = ++detailSequence;
        const scope = options.scope();
        const key = questionIdentity(question);
        selectedKey = key;
        selectedQuestion = question;
        readerHead = undefined;
        setDetailMode(true);
        readerActions.replaceChildren(back);
        const isCurrent = () =>
            current === detailSequence &&
            selectedKey === key &&
            scope === options.scope();
        inspector.setAttribute("aria-busy", "true");
        inspector.replaceChildren(
            rbNode("h2", question.slot.question ?? "Question"),
            rbNode("p", "Loading question details..."),
        );
        try {
            if (!schemaViewsSupported) {
                const capabilities = await invokeMemory(
                    "memoryViewCapabilities",
                    {},
                );
                if (!isCurrent()) return;
                schemaViewsSupported =
                    capabilities.derivedViews?.kinds.includes("schemaView") ??
                    false;
                if (!schemaViewsSupported)
                    throw new Error(
                        "Schema-defined questions capability is unavailable.",
                    );
            }
            const loaded = await fetchQuestion(question);
            if (!isCurrent()) return;
            readerHead = loaded.head;
            selectedQuestion = loaded.detail;
            inspect(loaded.detail);
        } catch (error: unknown) {
            if (!isCurrent()) return;
            const alert = rbNode(
                "p",
                `Question details unavailable: ${rbError(error)}`,
            );
            alert.setAttribute("role", "alert");
            inspector.replaceChildren(
                rbNode("h2", question.slot.question ?? "Question"),
                alert,
                rbButton("Retry question details", () => {
                    void loadDetail(question);
                }),
            );
            options.onError(error);
        } finally {
            if (isCurrent()) inspector.setAttribute("aria-busy", "false");
        }
    }
    function visibleQuestions() {
        return all().filter(
            (item) =>
                (!selectedView || item.viewId === selectedView) &&
                (!selectedCorpus || item.corpusId === selectedCorpus) &&
                (filter === "all" ||
                    (filter === "answered") ===
                        (item.details.answerState === "answered")) &&
                (!search ||
                    `${item.slot.question} ${item.viewTitle}`
                        .toLowerCase()
                        .includes(search)),
        );
    }
    function renderNotice() {
        notice.replaceChildren();
        const lines = [
            ...failureLines,
            ...[...inventories.entries()].flatMap(([corpusId, inventory]) =>
                inventory.maintenanceError
                    ? [
                          `${options.corpora().find((corpus) => corpus.corpusId === corpusId)?.name ?? corpusId} · Question maintenance failed: ${inventory.maintenanceError}`,
                      ]
                    : [],
            ),
        ];
        notice.hidden = !lines.length;
        for (const line of lines) {
            const row = rbNode("p");
            row.title = line;
            row.append(icon("fa-triangle-exclamation"), line);
            notice.append(row);
        }
    }
    function renderList() {
        list.replaceChildren();
        const questions = visibleQuestions();
        if (!all().length && !failureLines.length)
            list.append(
                rbNode(
                    "p",
                    "Add sources to discover useful questions, or define a question explicitly.",
                    "hub-muted",
                ),
            );
        else if (!questions.length)
            list.append(rbNode("p", "No matching questions.", "hub-muted"));
        for (const question of questions) {
            const row = rbNode("div", undefined, "hub-qrow");
            if (questionKey(question) === selectedKey)
                row.classList.add("selected");
            const title = rbButton(question.slot.question, () =>
                select(question),
            );
            const meta = rbNode("div", undefined, "hub-qmeta");
            const origin = rbNode("span");
            origin.setAttribute("role", "img");
            origin.setAttribute("aria-label", originLabel(question));
            origin.title = originLabel(question);
            origin.append(
                icon(
                    originLabel(question) === "User-defined"
                        ? "fa-user"
                        : "fa-file-lines",
                ),
            );
            meta.append(
                origin,
                rbNode("small", question.viewTitle),
                rowChips(question),
            );
            row.append(title, meta);
            row.addEventListener("click", (event) => {
                if (event.target !== title) select(question);
            });
            list.append(row);
        }
    }
    function detailMeta(question: MemoryQuestion) {
        const details = question.details;
        return [
            originLabel(question),
            `Contract ${question.slot.approval}`,
            `Answer review ${details.reviewState}`,
            `Coverage ${details.coverage}`,
            ...(details.freshness !== "current"
                ? [`Freshness ${details.freshness}`]
                : []),
        ].join(" · ");
    }
    function inspect(question: MemoryQuestion) {
        if (dirty && !confirm("Discard unsaved question edits?")) return;
        dirty = false;
        const details = question.details;
        // Decision first: the question, its status and the candidates.
        // Schemas, revisions and raw support stay under Advanced.
        inspector.replaceChildren();
        const title = rbNode("h2", question.slot.question);
        title.tabIndex = -1;
        const flow = rbNode("div", undefined, "hub-view-reading-flow");
        const overview = rbNode("aside", undefined, "hub-view-infobox");
        overview.setAttribute("aria-label", "About this question");
        overview.append(
            rbNode("h3", "Question overview"),
            rbNode(
                "p",
                "Answer coverage and metadata",
                "hub-view-infobox-label",
            ),
            rowChips(question),
            rbNode("p", detailMeta(question), "hub-view-note"),
            rbNode(
                "p",
                `Collection: ${options.corpora().find((corpus) => corpus.corpusId === question.corpusId)?.name ?? question.corpusId}`,
            ),
            rbNode("p", `View: ${question.viewTitle}`),
            rbNode(
                "p",
                `Version ${question.viewVersion} · ${details.evaluatedSources.length} evaluated sources`,
            ),
        );
        const content = rbNode("div", undefined, "hub-question-content");
        flow.append(overview, content);
        inspector.append(title, flow);
        if (question.slot.admission) {
            const admission = question.slot.admission;
            overview.append(
                rbChip(
                    admission.actor === "policy"
                        ? "Policy-discovered"
                        : "User-defined",
                ),
                rbNode("p", `Discovery reason: ${admission.reason}`),
                rbNode(
                    "p",
                    `Admission: ${admission.actor} · policy v${admission.policyVersion}. Policy admission is not human confirmation of an answer.`,
                ),
            );
        }
        const advanced = rbNode("details");
        advanced.append(
            rbNode("summary", "Advanced"),
            rbNode(
                "p",
                `View version ${question.viewVersion} · revision ${question.viewRevisionId} · scope ${details.scopeFingerprint} · evaluated sources ${details.evaluatedSources.length}`,
            ),
            rbNode("pre", JSON.stringify(details.evaluatedSources, null, 2)),
            rbNode("h4", "Answer schema"),
            rbNode("pre", JSON.stringify(question.slot.schema, null, 2)),
        );
        if (question.slot.admission)
            advanced.append(
                rbNode("pre", JSON.stringify(question.slot.admission, null, 2)),
            );
        const menuItems = [
            ...(["approved", "rejected"] as const).map((approval) => ({
                label:
                    approval === "approved"
                        ? "Approve question"
                        : "Reject question",
                icon: approval === "approved" ? "fa-check" : "fa-ban",
                action: () =>
                    action(() =>
                        edit(question, { kind: "approval", approval }),
                    ),
            })),
            {
                label: "Question answer history",
                icon: "fa-clock-rotate-left",
                action: () =>
                    action(async () => {
                        const history = await invokeMemory(
                            "memoryViewHistory",
                            {
                                corpusId: question.corpusId,
                                viewId: question.viewId,
                            },
                        );
                        const revisions = rbNode("section");
                        revisions.append(rbNode("h4", "Question revisions"));
                        for (const entry of history) {
                            if (entry.version.content.kind !== "schemaView")
                                continue;
                            const section = entry.version.content.sections.find(
                                (section) =>
                                    section.details.slotId === question.slot.id,
                            );
                            if (section)
                                revisions.append(
                                    rbNode(
                                        "h5",
                                        `${entry.version.createdAt} · ${entry.version.revisionId}`,
                                    ),
                                    rbNode(
                                        "pre",
                                        JSON.stringify(
                                            section.details,
                                            null,
                                            2,
                                        ),
                                    ),
                                );
                        }
                        content.append(revisions);
                    }),
            },
            {
                label: "Read agent page",
                icon: "fa-file-lines",
                action: () =>
                    action(async () => {
                        const page = await invokeMemory("memoryGetViewPage", {
                            corpusId: question.corpusId,
                            viewId: question.viewId,
                            slotId: question.slot.id,
                            revisionId: question.viewRevisionId,
                        });
                        const link = rbNode("a", page.uri);
                        link.href = schemaViewPageBrowserLink(page.uri);
                        content.append(
                            rbNode(
                                "p",
                                `Deterministic page · revision ${page.revisionId}`,
                            ),
                            link,
                            rbNode("pre", page.markdown),
                        );
                    }),
            },
            {
                label: "Discover question proposals",
                icon: "fa-wand-magic-sparkles",
                action: () =>
                    action(async () => {
                        const current = detailSequence;
                        await invokeMemory("memoryDiscoverSchemaQuestions", {
                            corpusId: question.corpusId,
                            viewId: question.viewId,
                            expectedHead: questionHead(question),
                            expectedVersion: question.viewVersion,
                        });
                        await refreshReader(question, current);
                        inspector.prepend(
                            rbNode(
                                "p",
                                "Discovery completed. Review proposals in the inventory; they are not approved facts.",
                            ),
                        );
                    }),
            },
        ];
        const headerActions = rbNode("div", undefined, "hub-row-actions");
        headerActions.append(
            rbIconButton("fa-bell-slash", "Snooze one day", () => {
                hideQuestions([question], Date.now() + 86400000);
                backToQuestions();
            }),
            rbIconButton("fa-xmark", "Dismiss", () => {
                hideQuestions([question]);
                backToQuestions();
            }),
            menuButton("More question actions", menuItems),
        );
        readerActions.replaceChildren(
            back,
            rbNode("span", undefined, "hub-spacer"),
            headerActions,
        );
        title.focus();
        const discovery = rbNode("details");
        discovery.append(rbNode("summary", "Configure bounded discovery"));
        const enable = rbNode("input");
        enable.type = "checkbox";
        const enabledLabel = rbNode(
            "label",
            "Enable question discovery for this view",
        );
        enabledLabel.prepend(enable);
        const bound = rbNode("input");
        bound.type = "number";
        bound.min = "0";
        bound.max = "8";
        bound.value = "5";
        bound.setAttribute("aria-label", "Maximum question proposals");
        discovery.append(
            enabledLabel,
            bound,
            rbButton("Save discovery configuration", () =>
                action(async () => {
                    const maxProposals = Number(bound.value);
                    if (
                        !Number.isInteger(maxProposals) ||
                        maxProposals < 0 ||
                        maxProposals > 8
                    )
                        throw new Error(
                            "Discovery requires an integer bound from 0 to 8.",
                        );
                    await edit(question, {
                        kind: "discovery",
                        enabled: enable.checked,
                        maxProposals,
                    });
                    inspector.replaceChildren(
                        rbNode(
                            "p",
                            "Discovery configuration saved. Use Discover explicitly to generate proposals.",
                        ),
                    );
                }),
            ),
        );
        advanced.append(discovery);
        content.append(
            details.candidates.length
                ? rbNode("h4", "Candidates")
                : rbNode("p", "No candidate answers yet."),
        );
        for (const candidate of details.candidates) {
            const card = rbNode("article", undefined, "card");
            const selected = details.selectedCandidateIds.includes(
                candidate.id,
            );
            const heading = rbNode("div", undefined, "hub-row-actions");
            heading.append(
                rbChip(
                    candidate.review,
                    candidate.review === "confirmed" ? "good" : undefined,
                ),
            );
            if (selected) heading.append(rbChip("selected", "good"));
            heading.append(rbNode("span", undefined, "hub-spacer"));
            for (const [review, glyph, label] of [
                ["confirmed", "fa-check", "Confirm candidate"],
                ["rejected", "fa-ban", "Reject candidate"],
                ["unreviewed", "fa-rotate-left", "Reset review candidate"],
            ] as const)
                if (review !== candidate.review)
                    heading.append(
                        rbIconButton(glyph, label, () =>
                            action(() =>
                                edit(question, {
                                    kind: "review",
                                    candidateId: candidate.id,
                                    review,
                                }),
                            ),
                        ),
                    );
            card.append(
                heading,
                valueNode(candidate.value),
                rbNode(
                    "p",
                    [
                        candidate.effectiveAt,
                        candidate.assertionOwner,
                        candidate.origin === "source"
                            ? undefined
                            : candidate.origin,
                    ]
                        .filter(Boolean)
                        .join(" · "),
                    "hub-muted",
                ),
                evidence(
                    question.corpusId,
                    candidate.citations,
                    "Supporting citations",
                ),
            );
            if (candidate.opposingCitations.length)
                card.append(
                    evidence(
                        question.corpusId,
                        candidate.opposingCitations,
                        "Opposing citations",
                    ),
                );
            const detail = rbNode("details");
            detail.append(
                rbNode("summary", "Advanced"),
                rbNode(
                    "p",
                    `${candidate.id} · item ${candidate.itemKey ?? "none"} · independence ${candidate.independenceKey ?? "unknown"} · derived from ${candidate.derivedFrom.join(", ") || "none declared"} · ${candidate.citations.length} supporting citations (not independent votes)`,
                ),
                rbNode("pre", JSON.stringify(candidate.value, null, 2)),
                rbNode("pre", JSON.stringify(candidate.support, null, 2)),
            );
            card.append(detail);
            content.append(card);
        }
        const why = rbNode("details");
        why.append(
            rbNode("summary", "Why this question"),
            evidence(
                question.corpusId,
                question.slot.discoveryCitations,
                "Question discovery evidence",
            ),
        );
        content.append(why);
        let answer = "";
        let itemKey = "";
        let meaning = question.slot.question;
        let rubric = JSON.stringify(question.slot.rubric, null, 2);
        const changed = () => {
            dirty = true;
        };
        const assertion = rbNode("details");
        assertion.append(rbNode("summary", "Add my answer"));
        assertion.querySelector("summary")!.title =
            "Saved as your own assertion. It never rewrites original source evidence.";
        assertion.append(
            rbField(
                "Your answer",
                answer,
                (value) => {
                    answer = value;
                    changed();
                },
                { multiline: true },
            ),
        );
        if (question.slot.cardinality === "collection")
            assertion.append(
                rbField("Stable item key", itemKey, (value) => {
                    itemKey = value;
                    changed();
                }),
            );
        assertion.append(
            rbButton("Save user assertion", () =>
                action(async () => {
                    const value = parseQuestionAssertion(question, answer);
                    if (
                        question.slot.cardinality === "collection" &&
                        !itemKey.trim()
                    )
                        throw new Error(
                            "A stable collection item key is required.",
                        );
                    await edit(question, {
                        kind: "assert",
                        value,
                        ...(itemKey ? { itemKey } : {}),
                    });
                }),
            ),
        );
        const contract = rbNode("details");
        contract.append(rbNode("summary", "How answers are chosen"));
        contract.querySelector("summary")!.title =
            "Saving the question or rubric requires reevaluation. It is not a source edit.";
        const rubricAdvanced = rbNode("details");
        rubricAdvanced.append(
            rbNode("summary", "Advanced"),
            rbField(
                "Versioned rubric (JSON)",
                rubric,
                (value) => {
                    rubric = value;
                    changed();
                },
                { multiline: true },
            ),
        );
        contract.append(
            rbField("Question", meaning, (value) => {
                meaning = value;
                changed();
            }),
            rubricAdvanced,
            rbButton("Save question and rubric", () =>
                action(async () => {
                    const parsed: unknown = JSON.parse(rubric);
                    if (
                        !parsed ||
                        typeof parsed !== "object" ||
                        Array.isArray(parsed)
                    )
                        throw new Error("Expected a rubric object.");
                    await edit(question, {
                        kind: "slot",
                        slot: {
                            ...question.slot,
                            question: meaning,
                            rubric: parsed as MemoryQuestion["slot"]["rubric"],
                        },
                    });
                }),
            ),
        );
        content.append(assertion, contract, advanced);
    }
    function hideQuestions(questions: QuestionListItem[], until?: number) {
        for (const question of questions)
            options.hidden[questionIdentity(question)] = {
                fingerprint: question.fingerprint,
                ...(until ? { until } : {}),
            };
        options.persistHidden();
        renderAttention();
    }
    function renderAttention() {
        attentionHost.replaceChildren();
        const allGroups = questionAttention(
            all().filter(
                (question) =>
                    !options.scope() || question.corpusId === options.scope(),
            ),
            options.hidden,
            Date.now(),
            20,
        );
        const groups = allGroups.slice(0, 5);
        if (!groups.length && !pager.hasNext) {
            options.onAttentionCount?.(0, false);
            return;
        }
        attentionHost.append(rbNode("h3", "Question decisions"));
        const byReason = new Map<string, typeof groups>();
        for (const group of groups) {
            const reason = [
                ...new Set(group.questions.map(questionReason)),
            ].join("; ");
            byReason.set(reason, [...(byReason.get(reason) ?? []), group]);
        }
        for (const [reason, members] of byReason) {
            const card = rbNode("article", undefined, "card");
            const rows = rbNode("div", undefined, "hub-rows");
            card.append(rbNode("h4", reason), rows);
            for (const group of members) {
                const row = rbNode("div", undefined, "hub-row-actions");
                const first = group.questions[0];
                const link = rbNode(
                    "a",
                    group.questions.length > 1
                        ? `${group.title} · ${group.questions.length}`
                        : group.title,
                    "hub-grow",
                );
                link.href = routeHash({
                    page: "questions",
                    corpusId: first.corpusId,
                    objectId: first.viewId,
                    ...(group.questions.length === 1
                        ? { questionSlotId: first.slot.id }
                        : {}),
                });
                row.append(link);
                for (const [label, glyph, until] of [
                    ["Snooze one day", "fa-bell-slash", Date.now() + 86400000],
                    ["Dismiss", "fa-xmark", undefined],
                ] as const)
                    row.append(
                        rbIconButton(glyph, `${label}: ${group.title}`, () =>
                            hideQuestions(group.questions, until),
                        ),
                    );
                rows.append(row);
            }
            attentionHost.append(
                options.presentAttention?.({
                    id: JSON.stringify([
                        "questions",
                        reason,
                        members.map((group) => group.id),
                    ]),
                    fingerprint: JSON.stringify(
                        members.flatMap((group) =>
                            group.questions.map((item) => [
                                questionIdentity(item),
                                item.fingerprint,
                            ]),
                        ),
                    ),
                    title: reason,
                    summary: members.map((group) => group.title).join(", "),
                    entries: members.length,
                    detail: card,
                }) ?? card,
            );
        }
        if (attentionOnly)
            attentionHost.append(
                pager.controls("question decisions", () => {
                    void refresh().catch(options.onError);
                }),
            );
        const workspace = rbNode("a", "Open Questions workspace");
        workspace.href = "#/questions";
        attentionHost.append(workspace);
        options.onAttentionCount?.(
            groups.length,
            allGroups.length > groups.length ||
                (attentionOnly && pager.hasNext),
        );
    }
    function renderAuthor() {
        author.replaceChildren();
        const corpusId = options.scope();
        if (!corpusId) return;
        let viewId = "";
        let specification = "";
        let maintenance = JSON.stringify(
            { schemaVersion: 1, scope: { mode: "pinned" } },
            null,
            2,
        );
        let approved = false;
        const disclosure = rbNode("details");
        disclosure.append(
            rbNode(
                "summary",
                "Propose a view from prose, a form, or an example",
            ),
            rbField("New view ID", viewId, (value) => {
                viewId = value;
                dirty = true;
            }),
            rbField(
                "Prose, form, or example specification",
                specification,
                (value) => {
                    specification = value;
                    dirty = true;
                },
                { multiline: true },
            ),
        );
        disclosure.querySelector("summary")!.title =
            "Examples are specifications, never facts about you. Generated slots remain proposals until individually approved.";
        const scope = rbNode("details");
        scope.append(
            rbNode("summary", "Advanced"),
            rbField(
                "Maintenance scope (JSON: pinned, currentSources or scopedSources)",
                maintenance,
                (value) => {
                    maintenance = value;
                    dirty = true;
                },
                { multiline: true },
            ),
        );
        disclosure.append(scope);
        const consent = rbNode("input");
        consent.type = "checkbox";
        consent.onchange = () => {
            approved = consent.checked;
        };
        const label = rbNode("label", "Approve generating a proposal");
        label.prepend(consent);
        disclosure.append(
            label,
            rbButton("Generate proposal", () =>
                action(async () => {
                    if (!approved || !viewId.trim() || !specification.trim())
                        throw new Error(
                            "Provide a view ID, specification, and explicit proposal approval.",
                        );
                    await invokeMemory("memoryProposeSchemaView", {
                        corpusId,
                        viewId,
                        specification,
                        expectedHead: inventories.get(corpusId)?.head ?? null,
                        expectedVersion: 0,
                        maintenance: JSON.parse(maintenance),
                    });
                    dirty = false;
                    await refresh();
                }),
            ),
        );
        author.append(disclosure);
    }
    async function loadQuestions(corpora: Array<{ corpusId: string }>) {
        const results = await Promise.allSettled(
            corpora.map(
                async (corpus) =>
                    [
                        corpus.corpusId,
                        await invokeMemory("memoryListQuestionSummaries", {
                            ...pager.request(corpus.corpusId),
                            ...(selectedView ? { viewId: selectedView } : {}),
                            ...(!attentionOnly && search
                                ? { query: search }
                                : {}),
                            ...(!attentionOnly && filter !== "all"
                                ? { answerFilter: filter }
                                : {}),
                            ...(attentionOnly ? { attentionOnly: true } : {}),
                        }),
                    ] as const,
            ),
        );
        return results;
    }
    function applyInventory(
        results: PromiseSettledResult<readonly [string, QuestionSummaryPage]>[],
        corpora: Array<{ corpusId: string; name: string }>,
        corpusId: string | undefined,
    ) {
        inventories = new Map(
            results.flatMap((result) =>
                result.status === "fulfilled" ? [result.value] : [],
            ),
        );
        pager.update(
            [...inventories].map(([corpusId, page]) => ({ corpusId, ...page })),
        );
        failureLines = results.flatMap((result, index) =>
            result.status === "rejected"
                ? [
                      `Incomplete question inventory: ${corpora[index].name}: ${rbError(result.reason)}`,
                  ]
                : [],
        );
        renderAuthor();
        const questions = all();
        status.textContent = "";
        total.textContent =
            failureLines.length && failureLines.length === corpora.length
                ? "Unavailable"
                : `${pager.total} total${failureLines.length ? " (partial)" : ""}`;
        total.title = `Showing ${questions.length} loaded questions${failureLines.length ? "; some collections are unavailable" : ""}.`;
        pagination.replaceChildren(
            pager.controls("questions", () => {
                void refresh().catch(options.onError);
            }),
        );
        if (!corpora.length && corpusId) {
            status.textContent = "";
            total.textContent = "Unavailable";
            failureLines = [
                "Selected collection is unavailable; scope has not been broadened.",
            ];
        }
        renderNotice();
        renderList();
        renderAttention();
        loadedAt = Date.now();
        loadedScope = corpusId;
    }
    function scopedCorpora() {
        const corpusId = selectedCorpus ?? options.scope();
        return options
            .corpora()
            .filter((corpus) => !corpusId || corpus.corpusId === corpusId);
    }
    async function refresh() {
        const version = ++sequence;
        status.textContent = "Loading questions…";
        total.textContent = "Loading...";
        total.title = "";
        const corpora = scopedCorpora().filter((corpus) =>
            pager.includes(corpus.corpusId),
        );
        let supported = schemaViewsSupported;
        try {
            if (!supported) {
                const capabilities = await invokeMemory(
                    "memoryViewCapabilities",
                    {},
                );
                supported =
                    capabilities.derivedViews?.kinds.includes("schemaView") ??
                    false;
            }
        } catch (error) {
            inventories = new Map();
            notice.hidden = true;
            acquisitions.clear();
            knowledge.clear();
            list.replaceChildren();
            attentionHost.replaceChildren(
                rbNode(
                    "p",
                    `Question decisions unavailable: ${rbError(error)}`,
                ),
            );
            options.onAttentionCount?.(0);
            status.textContent = `Questions unavailable: ${rbError(error)}`;
            total.textContent = "Unavailable";
            throw error;
        }
        if (version !== sequence) return;
        schemaViewsSupported = supported;
        if (!supported) {
            inventories = new Map();
            notice.hidden = true;
            acquisitions.clear();
            knowledge.clear();
            list.replaceChildren();
            author.replaceChildren();
            inspector.replaceChildren();
            attentionHost.replaceChildren();
            options.onAttentionCount?.(0);
            status.textContent = "";
            total.textContent = "Unavailable";
            list.append(
                rbNode(
                    "p",
                    "Schema-defined questions capability is unavailable.",
                    "hub-muted",
                ),
            );
            return;
        }
        const results = await loadQuestions(corpora);
        if (version !== sequence) return;
        applyInventory(results, corpora, options.scope());
        if (failureLines.length) {
            attentionHost.prepend(rbNode("p", failureLines.join("; ")));
            if (attentionOnly)
                options.onAttentionError?.(new Error(failureLines.join("; ")));
        }
        panelCorpora = corpora.filter(
            (corpus) => !selectedCorpus || corpus.corpusId === selectedCorpus,
        );
        panelLoaded = false;
        knowledgeLoaded = false;
        knowledge.clear();
        await loadKnowledge();
        if (panel.open) await loadPanel();
    }
    return {
        async show(viewId?: string, corpusId?: string, slotId?: string) {
            if (slotId && viewId && corpusId) {
                attentionOnly = false;
                await loadDetail({ corpusId, viewId, slot: { id: slotId } });
                return;
            }
            setDetailMode(false);
            detailSequence++;
            inspector.setAttribute("aria-busy", "false");
            const same =
                !attentionOnly &&
                loadedScope === options.scope() &&
                selectedView === viewId &&
                selectedCorpus === corpusId;
            selectedView = viewId;
            selectedCorpus = corpusId;
            attentionOnly = false;
            if (!same) pager.reset();
            inspector.replaceChildren();
            selectedKey = undefined;
            if (same && inventories.size && Date.now() - loadedAt < 5000) {
                renderList();
                return;
            }
            await refresh();
        },
        async refresh() {
            await refresh();
            if (!reader.hidden && selectedQuestion && !dirty && !busy)
                await loadDetail(selectedQuestion);
        },
        hide() {
            detailSequence++;
            inspector.setAttribute("aria-busy", "false");
        },
        async refreshAttention() {
            attentionOnly = true;
            selectedView = undefined;
            selectedCorpus = undefined;
            clearTimeout(searchTimer);
            pager.reset();
            try {
                await refresh();
            } catch (error) {
                options.onAttentionError?.(error);
                throw error;
            }
        },
        discardChanges() {
            if (busy) return false;
            if (!dirty) return true;
            if (!confirm("Discard unsaved question edits?")) return false;
            dirty = false;
            return true;
        },
    };
}
