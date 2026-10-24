// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    MemoryQuestion,
    QuestionEdit,
    QuestionInventory,
    ViewCitation,
} from "@typeagent/memory-service";
import { invokeMemory, invokeView } from "./viewClient";
import {
    rbButton,
    rbChip,
    rbIconButton,
    rbNode,
    rbField,
    rbError,
} from "./memoryHubDocumentUi";
import { menuButton } from "./memoryHubUi";
import {
    questionAttention,
    questionIdentity,
    questionReason,
    parseQuestionAssertion,
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
    let inventories = new Map<string, QuestionInventory>();
    let sequence = 0;
    let selectedView: string | undefined;
    let selectedCorpus: string | undefined;
    let busy = false;
    let dirty = false;
    const status = rbNode("p");
    status.setAttribute("role", "status");
    const list = rbNode("div");
    const inspector = rbNode("section");
    inspector.setAttribute("aria-label", "Question inspector");
    const author = rbNode("section");
    const maintenanceStatus = rbNode("p");
    maintenanceStatus.setAttribute("role", "status");
    const acquisitionHost = rbNode("section");
    const acquisitions = mountMemoryHubAcquisitions(acquisitionHost);
    host.append(
        rbNode("h2", "Questions"),
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
        status,
        maintenanceStatus,
        author,
        list,
        inspector,
        acquisitionHost,
    );

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
        await refresh();
        const current = all().find(
            (item) => questionIdentity(item) === questionIdentity(question),
        );
        if (current) inspect(current);
        else
            inspector.replaceChildren(
                rbNode("p", "This question is no longer available."),
            );
    }
    // One status chip plus only the states that differ from the default.
    function questionStatusChips(question: MemoryQuestion) {
        const details = question.details;
        const row = rbNode("div", undefined, "hub-chips");
        row.append(
            rbChip(
                details.answerState,
                details.answerState === "conflicted" ? "bad" : undefined,
            ),
        );
        if (question.slot.approval !== "approved")
            row.append(rbChip(question.slot.approval, "warn"));
        if (details.reviewState !== "unreviewed")
            row.append(rbChip(details.reviewState));
        if (details.freshness !== "current")
            row.append(rbChip(details.freshness, "warn"));
        const count = details.candidates.length;
        row.append(
            rbChip(`${count} ${count === 1 ? "candidate" : "candidates"}`),
        );
        return row;
    }
    function inspect(question: MemoryQuestion) {
        if (dirty && !confirm("Discard unsaved question edits?")) return;
        dirty = false;
        const details = question.details;
        // Decision first: the question, its status and the candidates.
        // Schemas, revisions and raw support stay under Advanced.
        inspector.replaceChildren(
            rbNode("h3", question.slot.question),
            questionStatusChips(question),
        );
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
        inspector.append(
            headerActions,
            evidence(
                question.corpusId,
                question.slot.discoveryCitations,
                "Question discovery evidence",
            ),
        );
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
                rbNode(
                    "strong",
                    typeof candidate.value === "string"
                        ? candidate.value
                        : JSON.stringify(candidate.value),
                ),
                rbChip(
                    candidate.review,
                    candidate.review === "confirmed" ? "good" : undefined,
                ),
            );
            if (selected) heading.append(rbChip("selected", "good"));
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
                rbNode(
                    "p",
                    [
                        candidate.effectiveAt,
                        candidate.assertionOwner,
                        candidate.origin,
                    ]
                        .filter(Boolean)
                        .join(" · "),
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
    function hideQuestions(questions: MemoryQuestion[], until?: number) {
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
        options.onAttentionCount?.(groups.length);
        if (!groups.length) return;
        attentionHost.append(rbNode("h3", "Question decisions"));
        for (const group of groups) {
            const card = rbNode("article", undefined, "card");
            const link = rbNode(
                "a",
                `${group.title} · ${group.questions.length} decisions`,
            );
            const first = group.questions[0];
            link.href = routeHash({
                page: "questions",
                corpusId: first.corpusId,
                objectId: first.viewId,
            });
            card.append(
                link,
                rbNode(
                    "p",
                    [...new Set(group.questions.map(questionReason))].join(
                        "; ",
                    ),
                ),
            );
            for (const [label, glyph, until] of [
                ["Dismiss", "fa-xmark", undefined],
                ["Snooze one day", "fa-bell-slash", Date.now() + 86400000],
            ] as const)
                card.append(
                    rbIconButton(glyph, label, () =>
                        hideQuestions(group.questions, until),
                    ),
                );
            attentionHost.append(card);
        }
    }
    function renderAuthor() {
        author.replaceChildren();
        const corpusId = options.scope();
        if (!corpusId) {
            author.append(
                rbNode(
                    "p",
                    "Select one collection to propose a schema-defined view.",
                ),
            );
            return;
        }
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
    async function refresh() {
        const version = ++sequence;
        status.textContent = "Loading questions…";
        let capabilities;
        try {
            capabilities = await invokeMemory("memoryViewCapabilities", {});
        } catch (error) {
            inventories = new Map();
            maintenanceStatus.textContent = "";
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
        if (!capabilities.derivedViews?.kinds.includes("schemaView")) {
            inventories = new Map();
            maintenanceStatus.textContent = "";
            acquisitions.clear();
            list.replaceChildren();
            author.replaceChildren();
            inspector.replaceChildren();
            attentionHost.replaceChildren();
            options.onAttentionCount?.(0);
            status.textContent =
                "Schema-defined questions capability is unavailable.";
            return;
        }
        const corpusId = options.scope();
        const corpora = options
            .corpora()
            .filter(
                (corpus) =>
                    !corpusId ||
                    corpus.corpusId === corpusId ||
                    corpus.corpusId === selectedCorpus,
            );
        const results = await Promise.allSettled(
            corpora.map(
                async (corpus) =>
                    [
                        corpus.corpusId,
                        await invokeMemory("memoryListQuestions", {
                            corpusId: corpus.corpusId,
                        }),
                    ] as const,
            ),
        );
        if (version !== sequence) return;
        inventories = new Map(
            results.flatMap((result) =>
                result.status === "fulfilled" ? [result.value] : [],
            ),
        );
        maintenanceStatus.textContent = [...inventories.entries()]
            .flatMap(([corpusId, inventory]) =>
                inventory.maintenanceError
                    ? [
                          `${corpusId} · Question maintenance failed: ${inventory.maintenanceError}`,
                      ]
                    : [],
            )
            .join("\n");
        const failures = results.flatMap((result, index) =>
            result.status === "rejected"
                ? [`${corpora[index].name}: ${rbError(result.reason)}`]
                : [],
        );
        renderAuthor();
        list.replaceChildren();
        const questions = all();
        status.textContent = failures.length
            ? `Incomplete question inventory: ${failures.join("; ")}`
            : `${questions.length} ${questions.length === 1 ? "question" : "questions"}`;
        if (!corpora.length && corpusId)
            status.textContent =
                "Selected collection is unavailable; scope has not been broadened.";
        for (const question of questions.filter(
            (item) =>
                (!selectedView || item.viewId === selectedView) &&
                (!selectedCorpus || item.corpusId === selectedCorpus),
        )) {
            const card = rbNode("article", undefined, "card");
            card.append(
                rbButton(question.slot.question, () => inspect(question)),
                questionStatusChips(question),
                rbNode("small", question.viewTitle),
            );
            list.append(card);
        }
        renderAttention();
        if (failures.length)
            attentionHost.prepend(rbNode("p", status.textContent));
        await acquisitions.refresh(
            corpora.filter(
                (corpus) =>
                    !selectedCorpus || corpus.corpusId === selectedCorpus,
            ),
            selectedView,
        );
    }
    return {
        async show(viewId?: string, corpusId?: string) {
            selectedView = viewId;
            selectedCorpus = corpusId;
            inspector.replaceChildren();
            await refresh();
        },
        refresh,
        discardChanges() {
            if (!dirty) return true;
            if (!confirm("Discard unsaved question edits?")) return false;
            dirty = false;
            return true;
        },
    };
}
