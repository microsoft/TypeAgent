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
import { icon, menuButton } from "./memoryHubUi";
import {
    questionAttention,
    questionIdentity,
    questionReason,
    parseQuestionAssertion,
    questionCandidateCount,
    type QuestionListItem,
} from "./memoryHubQuestionsModel";
import { routeHash, type HiddenItems } from "./memoryHubModel";
import { schemaViewPageBrowserLink } from "./memoryHubViewPages";
import { mountMemoryHubAcquisitions } from "./memoryHubAcquisitions";

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
        onAttentionCount?: (count: number) => void;
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
    let filter: Filter = "all";
    let search = "";
    let loadedAt = 0;
    let loadedScope: string | undefined;
    let schemaViewsSupported = false;
    let failureLines: string[] = [];
    const status = rbChip("");
    status.setAttribute("role", "status");
    const notice = rbNode("div", undefined, "hub-notice");
    notice.hidden = true;
    const list = rbNode("div", undefined, "hub-qlist");
    const inspector = rbNode("section", undefined, "hub-qdetail");
    inspector.setAttribute("aria-label", "Question inspector");
    const author = rbNode("section");
    const acquisitionHost = rbNode("section");
    const acquisitions = mountMemoryHubAcquisitions(acquisitionHost);
    const panel = rbNode("details", undefined, "hub-panel");
    panel.append(
        rbNode("summary", "Deferred evidence acquisition"),
        acquisitionHost,
    );
    let panelCorpora: Array<{ corpusId: string; name: string }> = [];
    let panelLoaded = false;
    async function loadPanel() {
        if (!panel.open || panelLoaded) return;
        panelLoaded = true;
        await acquisitions.refresh(panelCorpora, selectedView);
    }
    panel.addEventListener("toggle", () => {
        void loadPanel().catch((error: unknown) => options.onError(error));
    });
    const chips = rbNode("div", undefined, "hub-chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Question filter");
    for (const [value, label] of [
        ["all", "All"],
        ["open", "Open"],
        ["answered", "Answered"],
    ] as const) {
        const chip = rbButton(label, () => {
            filter = value;
            for (const other of chips.querySelectorAll("button"))
                other.setAttribute("aria-pressed", String(other === chip));
            renderList();
            pager.reset();
            void refresh().catch(options.onError);
        });
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
    filters.append(chips, searchBox);
    const split = rbNode("div", undefined, "hub-split");
    split.append(list, inspector);
    host.append(head, notice, author, filters, split, pagination, panel);

    function action(work: () => Promise<void>) {
        if (busy) return;
        busy = true;
        void work()
            .catch((error: unknown) => {
                status.textContent = `Question operation failed: ${rbError(error)}`;
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
    async function edit(question: MemoryQuestion, edit: QuestionEdit) {
        await invokeMemory("memoryEditQuestion", {
            corpusId: question.corpusId,
            viewId: question.viewId,
            slotId: question.slot.id,
            expectedHead: inventories.get(question.corpusId)!.head,
            expectedVersion: question.viewVersion,
            edit,
        });
        dirty = false;
        await refreshInventory();
        const current = all().find(
            (item) => questionIdentity(item) === questionIdentity(question),
        );
        if (current) inspect(await fetchQuestion(current));
        else
            inspector.replaceChildren(
                rbNode("p", "This question is no longer available."),
            );
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
    async function fetchQuestion(question: QuestionListItem) {
        const detail = await invokeMemory("memoryGetQuestion", {
            corpusId: question.corpusId,
            viewId: question.viewId,
            slotId: question.slot.id,
        });
        if (!detail) throw new Error("This question is no longer available.");
        return detail;
    }
    let detailSequence = 0;
    function select(question: QuestionListItem) {
        if (busy) return;
        if (dirty && !confirm("Discard unsaved question edits?")) return;
        dirty = false;
        const current = ++detailSequence;
        const scope = options.scope();
        selectedKey = questionKey(question);
        const isCurrent = () =>
            current === detailSequence &&
            selectedKey === questionKey(question) &&
            scope === options.scope();
        inspector.setAttribute("aria-busy", "true");
        inspector.replaceChildren(
            rbNode("h3", question.slot.question),
            rbNode("p", "Loading question details..."),
        );
        void fetchQuestion(question)
            .then((detail) => {
                if (isCurrent()) inspect(detail);
            })
            .catch((error: unknown) => {
                if (!isCurrent()) return;
                const alert = rbNode(
                    "p",
                    `Question details unavailable: ${rbError(error)}`,
                );
                alert.setAttribute("role", "alert");
                inspector.replaceChildren(
                    rbNode("h3", question.slot.question),
                    alert,
                    rbButton("Retry question details", () => select(question)),
                );
                options.onError(error);
            })
            .finally(() => {
                if (isCurrent()) inspector.setAttribute("aria-busy", "false");
            });
        renderList();
        if (window.matchMedia?.("(max-width: 900px)").matches)
            inspector.scrollIntoView?.({ block: "start" });
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
                        inspector.append(revisions);
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
                        inspector.append(
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
                        await invokeMemory("memoryDiscoverSchemaQuestions", {
                            corpusId: question.corpusId,
                            viewId: question.viewId,
                            expectedHead: inventories.get(question.corpusId)!
                                .head,
                            expectedVersion: question.viewVersion,
                        });
                        await refresh();
                        inspector.replaceChildren(
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
                inspector.replaceChildren();
            }),
            rbIconButton("fa-xmark", "Dismiss", () => {
                hideQuestions([question]);
                inspector.replaceChildren();
            }),
            menuButton("More question actions", menuItems),
        );
        const titleRow = rbNode("div", undefined, "hub-qdetail-head");
        titleRow.append(
            rbNode("h3", question.slot.question),
            rowChips(question),
            headerActions,
        );
        const meta = rbNode("p", detailMeta(question), "hub-muted");
        inspector.append(titleRow, meta);
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
        inspector.append(
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
            inspector.append(card);
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
        inspector.append(why);
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
        inspector.append(assertion, contract, advanced);
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
        const groups = questionAttention(
            all().filter(
                (question) =>
                    !options.scope() || question.corpusId === options.scope(),
            ),
            options.hidden,
        );
        options.onAttentionCount?.(
            groups.length + (attentionOnly && pager.hasNext ? 1 : 0),
        );
        if (!groups.length && !pager.hasNext) return;
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
            attentionHost.append(card);
        }
        if (attentionOnly)
            attentionHost.append(
                pager.controls("question decisions", () => {
                    void refresh().catch(options.onError);
                }),
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
        status.textContent = `Showing ${questions.length} of ${pager.total} questions`;
        pagination.replaceChildren(
            pager.controls("questions", () => {
                void refresh().catch(options.onError);
            }),
        );
        if (!corpora.length && corpusId) {
            status.textContent = "";
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
        const corpusId = options.scope();
        return options
            .corpora()
            .filter(
                (corpus) =>
                    !corpusId ||
                    corpus.corpusId === corpusId ||
                    corpus.corpusId === selectedCorpus,
            );
    }
    // Reloads the inventory only. Acquisition progress loads
    // when their panel is opened, not on every question edit.
    async function refreshInventory() {
        const version = ++sequence;
        const corpora = scopedCorpora().filter((corpus) =>
            pager.includes(corpus.corpusId),
        );
        const results = await loadQuestions(corpora);
        if (version !== sequence) return;
        applyInventory(results, corpora, options.scope());
    }
    async function refresh() {
        const version = ++sequence;
        status.textContent = "Loading questions…";
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
            list.replaceChildren();
            attentionHost.replaceChildren(
                rbNode(
                    "p",
                    `Question decisions unavailable: ${rbError(error)}`,
                ),
            );
            options.onAttentionCount?.(0);
            status.textContent = `Questions unavailable: ${rbError(error)}`;
            throw error;
        }
        if (version !== sequence) return;
        schemaViewsSupported = supported;
        if (!supported) {
            inventories = new Map();
            notice.hidden = true;
            acquisitions.clear();
            list.replaceChildren();
            author.replaceChildren();
            inspector.replaceChildren();
            attentionHost.replaceChildren();
            options.onAttentionCount?.(0);
            status.textContent = "";
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
        if (failureLines.length)
            attentionHost.prepend(rbNode("p", failureLines.join("; ")));
        panelCorpora = corpora.filter(
            (corpus) => !selectedCorpus || corpus.corpusId === selectedCorpus,
        );
        panelLoaded = false;
        if (panel.open) await loadPanel();
    }
    return {
        async show(viewId?: string, corpusId?: string) {
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
        refresh,
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
            await refresh();
        },
        discardChanges() {
            if (!dirty) return true;
            if (!confirm("Discard unsaved question edits?")) return false;
            dirty = false;
            return true;
        },
    };
}
