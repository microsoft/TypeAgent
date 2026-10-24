// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    DiscoveryPolicy,
    KnowledgeCheckpoint,
    KnowledgeStatus,
} from "@typeagent/memory-service";
import { invokeMemory } from "./viewClient";
import {
    rbButton,
    rbChip,
    rbError,
    rbIconButton,
    rbNode,
} from "./memoryHubDocumentUi";

type Corpus = { corpusId: string; name: string };

export function mountMemoryHubKnowledgeStatus(host: HTMLElement) {
    host.setAttribute("aria-label", "Knowledge preparation");
    const status = rbNode("p");
    status.setAttribute("role", "status");
    const list = rbNode("div");
    status.className = "hub-muted";
    host.append(status, list);
    let sequence = 0;
    let working = false;
    let targets: Corpus[] = [];

    async function act(work: () => Promise<unknown>) {
        if (working) return;
        working = true;
        for (const control of host.querySelectorAll<
            HTMLButtonElement | HTMLSelectElement
        >("button, select"))
            control.disabled = true;
        try {
            await work();
            await refresh(targets);
        } catch (error) {
            status.textContent = `Knowledge operation failed: ${rbError(error)}`;
        } finally {
            working = false;
            for (const control of host.querySelectorAll<
                HTMLButtonElement | HTMLSelectElement
            >("button, select"))
                control.disabled = false;
        }
    }
    function checkpointCard(checkpoint: KnowledgeCheckpoint) {
        const card = rbNode("details");
        card.append(
            rbNode(
                "summary",
                `Checkpoint ${checkpoint.checkpointId} · ${checkpoint.state}`,
            ),
            rbNode(
                "p",
                `${checkpoint.sources.length} captured source revisions · ${checkpoint.producerComplete ? "producer-complete" : "best-effort, producer not sealed"} · index ${checkpoint.indexVersion}`,
            ),
            rbNode(
                "p",
                `Families: ${checkpoint.families.join(", ") || "none"} · excluded: ${checkpoint.excludedFamilies.join(", ") || "none"}`,
            ),
            rbNode(
                "p",
                `Coverage: ${checkpoint.coverage.inspectedSources} inspected sources · ${checkpoint.coverage.deferredSources} deferred sources · ${checkpoint.viewIds.length} views · ${checkpoint.jobIds.length} jobs`,
            ),
        );
        for (const reason of checkpoint.reasons)
            card.append(rbNode("p", reason));
        if (checkpoint.state !== "ready") {
            const notReady = rbChip("Not ready", "warn");
            notReady.title =
                "Source indexing alone does not qualify knowledge readiness.";
            card.append(notReady);
        }
        if (checkpoint.state === "pending" || checkpoint.state === "running")
            card.append(
                rbButton("Wait up to 30 seconds", () => {
                    void act(async () => {
                        const result = await invokeMemory(
                            "memoryWaitForKnowledgeCheckpoint",
                            {
                                corpusId: checkpoint.corpusId,
                                checkpointId: checkpoint.checkpointId,
                                timeoutMs: 30000,
                            },
                        );
                        if (result.state !== "ready")
                            throw new Error(
                                `Checkpoint ${result.state}: ${result.reasons.join("; ") || "Readiness has not been reached within this wait."}`,
                            );
                    });
                }),
            );
        return card;
    }
    function knowledgeBody(
        section: HTMLElement,
        corpus: Corpus,
        knowledge: KnowledgeStatus,
    ) {
        const policy = rbNode("div", undefined, "hub-row-actions");
        const label = rbNode("label", "Discovery policy ");
        label.title =
            "Policy admission is not human answer review or external-tool authority. Existing corpora remain off until explicitly enabled; new corpora default to source observed.";
        const select = rbNode("select");
        select.setAttribute("aria-label", `Discovery policy · ${corpus.name}`);
        for (const [value, title] of [
            ["off", "Off — explicit questions only"],
            ["suggest", "Suggest — proposals need approval"],
            [
                "sourceObserved",
                "Source observed — policy-admitted informational questions",
            ],
        ]) {
            const option = rbNode("option", title);
            option.value = value;
            select.append(option);
        }
        select.value = knowledge.discovery.policy;
        label.append(select);
        policy.append(
            label,
            rbIconButton(
                "fa-check",
                `Save discovery policy · ${corpus.name}`,
                () => {
                    const value = select.value as DiscoveryPolicy;
                    void act(() =>
                        invokeMemory("memoryUpdateKnowledgeDiscovery", {
                            corpusId: corpus.corpusId,
                            policy: value,
                        }),
                    );
                },
            ),
            rbIconButton(
                "fa-bookmark",
                `Capture knowledge checkpoint · ${corpus.name}`,
                () => {
                    void act(() =>
                        invokeMemory("memoryCreateKnowledgeCheckpoint", {
                            corpusId: corpus.corpusId,
                            producerComplete: false,
                        }),
                    );
                },
            ),
        );
        section.append(policy);
        const failed =
            knowledge.discovery.error ||
            knowledge.discovery.receipts.some(
                (receipt) => receipt.state === "failed",
            );
        if (failed) {
            const failure = rbNode("p", undefined, "hub-row-actions");
            failure.append(
                rbNode(
                    "span",
                    knowledge.discovery.error
                        ? `Discovery failed: ${knowledge.discovery.error}`
                        : "Discovery failed",
                ),
                rbIconButton(
                    "fa-rotate-right",
                    `Retry failed discovery · ${corpus.name}`,
                    () => {
                        void act(() =>
                            invokeMemory("memoryUpdateKnowledgeDiscovery", {
                                corpusId: corpus.corpusId,
                                policy: knowledge.discovery.policy,
                                retryFailed: true,
                            }),
                        );
                    },
                ),
            );
            failure.title =
                "Explicit bounded retry only; at most two attempts are retained. This grants no external-tool permissions.";
            section.append(failure);
        }
        if (!knowledge.discovery.receipts.length)
            section.append(rbNode("p", "No discovery yet.", "hub-muted"));
        else {
            const history = rbNode("details");
            history.append(
                rbNode(
                    "summary",
                    `Discovery history (${knowledge.discovery.receipts.length})`,
                ),
            );
            for (const receipt of knowledge.discovery.receipts) {
                history.append(
                    rbNode(
                        "p",
                        `Discovery ${receipt.state} · ${receipt.sources.length} source revisions · ${receipt.attempts} attempts · ${receipt.viewIds.length} views`,
                    ),
                );
                if (receipt.reason) history.append(rbNode("p", receipt.reason));
                for (const proposal of receipt.proposals ?? [])
                    history.append(
                        rbNode(
                            "p",
                            `${proposal.slot.question} — ${proposal.reason}`,
                        ),
                    );
            }
            section.append(history);
        }
        if (!knowledge.checkpoints.length)
            section.append(rbNode("p", "No checkpoint captured.", "hub-muted"));
        for (const checkpoint of knowledge.checkpoints)
            section.append(checkpointCard(checkpoint));
    }
    async function refresh(corpora: Corpus[]) {
        targets = corpora;
        const current = ++sequence;
        list.replaceChildren();
        status.textContent = "Loading…";
        const results = await Promise.all(
            corpora.map(async (corpus) => ({
                corpus,
                values: await Promise.allSettled([
                    invokeMemory("memoryGetCorpus", {
                        corpusId: corpus.corpusId,
                    }),
                    invokeMemory("memoryGetKnowledgeStatus", {
                        corpusId: corpus.corpusId,
                    }),
                ] as const),
            })),
        );
        if (current !== sequence) return;
        let failures = 0;
        for (const {
            corpus,
            values: [sources, knowledge],
        } of results) {
            const section = rbNode("section");
            section.append(rbNode("h4", corpus.name));
            if (sources.status === "fulfilled" && sources.value) {
                const source = sources.value;
                section.append(
                    rbNode(
                        "p",
                        [
                            `${source.readyRevisionCount}/${source.revisionCount} revisions indexed`,
                            ...(source.activeJobCount
                                ? [`${source.activeJobCount} active jobs`]
                                : []),
                            ...(source.failedRevisionCount
                                ? [
                                      `${source.failedRevisionCount} failed revisions`,
                                  ]
                                : []),
                        ].join(" · "),
                        "hub-muted",
                    ),
                );
                if (source.sourceCount === 0)
                    section.append(
                        rbNode(
                            "p",
                            "Add sources to discover useful questions.",
                            "hub-muted",
                        ),
                    );
            } else {
                failures++;
                section.append(
                    rbNode(
                        "p",
                        `Source progress unavailable: ${sources.status === "rejected" ? rbError(sources.reason) : "Collection unavailable"}`,
                    ),
                );
            }
            if (knowledge.status === "fulfilled")
                knowledgeBody(section, corpus, knowledge.value);
            else {
                failures++;
                section.append(
                    rbNode(
                        "p",
                        `Knowledge preparation unavailable: ${rbError(knowledge.reason)}`,
                    ),
                );
            }
            list.append(section);
        }
        status.textContent = failures
            ? "Progress is incomplete; failures are shown below."
            : corpora.length
              ? ""
              : "Select a collection to inspect knowledge preparation.";
    }
    return {
        refresh,
        clear() {
            sequence++;
            list.replaceChildren();
            status.textContent =
                "Knowledge preparation is unavailable until a collection is selected.";
        },
    };
}
