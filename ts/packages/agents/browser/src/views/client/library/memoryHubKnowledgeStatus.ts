// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    DiscoveryPolicy,
    KnowledgeCheckpoint,
    KnowledgeStatus,
} from "@typeagent/memory-service";
import { invokeMemory } from "./viewClient";
import { rbButton, rbError, rbNode } from "./memoryHubDocumentUi";

type Corpus = { corpusId: string; name: string };

export function mountMemoryHubKnowledgeStatus(host: HTMLElement) {
    host.setAttribute("aria-label", "Knowledge preparation");
    const status = rbNode("p");
    status.setAttribute("role", "status");
    const list = rbNode("div");
    host.append(rbNode("h3", "Knowledge preparation"), status, list);
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
        const card = rbNode("article");
        card.append(
            rbNode(
                "h5",
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
                `Coverage: ${checkpoint.coverage.inspectedSources} inspected sources · ${checkpoint.coverage.deferredSources} deferred sources`,
            ),
            rbNode(
                "p",
                `Knowledge work: ${checkpoint.viewIds.length} views · ${checkpoint.jobIds.length} jobs`,
            ),
        );
        for (const reason of checkpoint.reasons)
            card.append(rbNode("p", reason));
        if (checkpoint.state !== "ready")
            card.append(
                rbNode(
                    "p",
                    "Not ready: source indexing alone does not qualify knowledge readiness.",
                ),
            );
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
    function knowledgeCard(corpus: Corpus, knowledge: KnowledgeStatus) {
        const section = rbNode("section");
        section.append(rbNode("h4", corpus.name));
        const label = rbNode("label", "Discovery policy ");
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
        section.append(
            label,
            rbButton(`Save discovery policy · ${corpus.name}`, () => {
                const policy = select.value as DiscoveryPolicy;
                void act(() =>
                    invokeMemory("memoryUpdateKnowledgeDiscovery", {
                        corpusId: corpus.corpusId,
                        policy,
                    }),
                );
            }),
            rbNode(
                "p",
                "Policy admission is not human answer review or external-tool authority. Existing corpora remain off until explicitly enabled; new corpora default to source observed.",
            ),
        );
        if (knowledge.discovery.error)
            section.append(
                rbNode("p", `Discovery failed: ${knowledge.discovery.error}`),
            );
        if (
            knowledge.discovery.error ||
            knowledge.discovery.receipts.some(
                (receipt) => receipt.state === "failed",
            )
        )
            section.append(
                rbButton(`Retry failed discovery · ${corpus.name}`, () => {
                    void act(() =>
                        invokeMemory("memoryUpdateKnowledgeDiscovery", {
                            corpusId: corpus.corpusId,
                            policy: knowledge.discovery.policy,
                            retryFailed: true,
                        }),
                    );
                }),
                rbNode(
                    "p",
                    "Explicit bounded retry only; at most two attempts are retained. This grants no external-tool permissions.",
                ),
            );
        if (!knowledge.discovery.receipts.length)
            section.append(
                rbNode(
                    "p",
                    "No discovery receipt yet. Add sources to discover useful questions; disabled discovery requires explicit enablement.",
                ),
            );
        for (const receipt of knowledge.discovery.receipts) {
            section.append(
                rbNode(
                    "p",
                    `Discovery ${receipt.state} · ${receipt.sources.length} source revisions · ${receipt.attempts} attempts · ${receipt.viewIds.length} views`,
                ),
            );
            if (receipt.reason) section.append(rbNode("p", receipt.reason));
            for (const proposal of receipt.proposals ?? [])
                section.append(
                    rbNode(
                        "p",
                        `${proposal.slot.question} — ${proposal.reason}`,
                    ),
                );
        }
        section.append(
            rbButton(`Capture knowledge checkpoint · ${corpus.name}`, () => {
                void act(() =>
                    invokeMemory("memoryCreateKnowledgeCheckpoint", {
                        corpusId: corpus.corpusId,
                        producerComplete: false,
                    }),
                );
            }),
            rbNode(
                "p",
                "Captures the current source revisions and enabled families as best-effort coverage. It does not seal an import or authorize external tools.",
            ),
        );
        if (!knowledge.checkpoints.length)
            section.append(rbNode("p", "No knowledge checkpoint captured."));
        for (const checkpoint of knowledge.checkpoints)
            section.append(checkpointCard(checkpoint));
        return section;
    }
    async function refresh(corpora: Corpus[]) {
        targets = corpora;
        const current = ++sequence;
        list.replaceChildren();
        status.textContent = "Loading source and knowledge progress…";
        const results = await Promise.all(
            corpora.map(async (corpus) => ({
                corpus,
                values: await Promise.allSettled([
                    invokeMemory("memoryGetCorpus", {
                        corpusId: corpus.corpusId,
                    }),
                    invokeMemory("memoryGetKnowledgeStatus", {
                        corpusId: corpus.corpusId,
                    }).then((knowledge) => knowledgeCard(corpus, knowledge)),
                ] as const),
            })),
        );
        if (current !== sequence) return;
        let failures = 0;
        for (const {
            corpus,
            values: [sources, knowledge],
        } of results) {
            if (sources.status === "fulfilled" && sources.value) {
                const source = sources.value;
                list.append(
                    rbNode(
                        "p",
                        `${corpus.name} · Source progress: ${source.readyRevisionCount}/${source.revisionCount} revisions indexed · ${source.activeJobCount} active jobs · ${source.failedRevisionCount} failed revisions. Knowledge preparation is separate.`,
                    ),
                );
                if (source.sourceCount === 0)
                    list.append(
                        rbNode(
                            "p",
                            "Add sources to discover useful questions.",
                        ),
                    );
            } else {
                failures++;
                list.append(
                    rbNode(
                        "p",
                        `${corpus.name} · Source progress unavailable: ${sources.status === "rejected" ? rbError(sources.reason) : "Collection unavailable"}`,
                    ),
                );
            }
            if (knowledge.status === "fulfilled") {
                list.append(knowledge.value);
            } else {
                failures++;
                list.append(
                    rbNode(
                        "p",
                        `${corpus.name} · Knowledge preparation unavailable: ${rbError(knowledge.reason)}`,
                    ),
                );
            }
        }
        status.textContent = failures
            ? "Progress is incomplete; failures are shown below."
            : corpora.length
              ? "Source and knowledge progress loaded. Ready is relative to checkpoint coverage, not exhaustive memory."
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
