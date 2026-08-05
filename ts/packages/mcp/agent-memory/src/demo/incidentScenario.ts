// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type IncidentEvidenceTurn = {
    id: string;
    type: "evidence";
    at: string;
    source: string;
    topicPath: string;
    evidence: string;
    memoryContent: string;
    tags: readonly string[];
};

export type IncidentCheckpointTurn = {
    id: string;
    type: "checkpoint";
    at: string;
    title: string;
    expectedRecall: readonly string[];
};

export type IncidentTurn = IncidentEvidenceTurn | IncidentCheckpointTurn;

export type IncidentConversationRound = {
    id: string;
    at: string;
    analystMessage: string;
    evidenceIds: readonly string[];
};

export const incidentScenario: readonly IncidentTurn[] = [
    {
        id: "alert-password-spray",
        type: "evidence",
        at: "2026-08-05T09:00:00.000Z",
        source: "Entra ID Protection",
        topicPath: "/security/incidents/ir-7421/identity",
        evidence:
            "A password spray from 203.0.113.77 targeted 46 accounts. The legacy service account svc-build had the only successful authentication.",
        memoryContent:
            "Incident IR-7421: password spray source 203.0.113.77 targeted 46 accounts and successfully authenticated as svc-build.",
        tags: ["IR-7421", "identity", "indicator"],
    },
    {
        id: "identity-correlation",
        type: "evidence",
        at: "2026-08-05T09:08:00.000Z",
        source: "Entra sign-in logs",
        topicPath: "/security/incidents/ir-7421/identity",
        evidence:
            "svc-build authenticated from 203.0.113.77 using legacy authentication. The account is excluded from MFA and normally runs only from build-runner-03.",
        memoryContent:
            "Incident IR-7421: svc-build used legacy authentication from 203.0.113.77, is excluded from MFA, and normally runs only on build-runner-03.",
        tags: ["IR-7421", "svc-build", "identity"],
    },
    {
        id: "endpoint-execution",
        type: "evidence",
        at: "2026-08-05T09:17:00.000Z",
        source: "Endpoint detection",
        topicPath: "/security/incidents/ir-7421/execution",
        evidence:
            "On build-runner-03, w3wp.exe spawned encoded PowerShell that downloaded update.ps1. The script SHA-256 begins 84c1e9b7.",
        memoryContent:
            "Incident IR-7421: build-runner-03 executed encoded PowerShell from w3wp.exe, downloading update.ps1 with SHA-256 prefix 84c1e9b7.",
        tags: ["IR-7421", "build-runner-03", "execution", "indicator"],
    },
    {
        id: "checkpoint-initial-access",
        type: "checkpoint",
        at: "2026-08-05T09:25:00.000Z",
        title: "Initial-access handoff",
        expectedRecall: [
            "203.0.113.77",
            "svc-build",
            "build-runner-03",
            "84c1e9b7",
        ],
    },
    {
        id: "command-and-control",
        type: "evidence",
        at: "2026-08-05T09:31:00.000Z",
        source: "Proxy telemetry",
        topicPath: "/security/incidents/ir-7421/command-and-control",
        evidence:
            "build-runner-03 contacted 198.51.100.24 over TCP 443 every 60 seconds beginning two minutes after update.ps1 ran.",
        memoryContent:
            "Incident IR-7421: build-runner-03 began 60-second HTTPS callbacks to 198.51.100.24 two minutes after update.ps1 executed.",
        tags: ["IR-7421", "build-runner-03", "command-control", "indicator"],
    },
    {
        id: "vault-access",
        type: "evidence",
        at: "2026-08-05T09:44:00.000Z",
        source: "Azure activity log",
        topicPath: "/security/incidents/ir-7421/cloud-impact",
        evidence:
            "A token associated with svc-build listed secrets in Key Vault prod-signing. No secret value or signing operation was logged.",
        memoryContent:
            "Incident IR-7421: a svc-build token listed secrets in Key Vault prod-signing; no secret value retrieval or signing operation was observed.",
        tags: ["IR-7421", "svc-build", "prod-signing", "cloud"],
    },
    {
        id: "artifact-anomaly",
        type: "evidence",
        at: "2026-08-05T09:52:00.000Z",
        source: "Release verification",
        topicPath: "/security/incidents/ir-7421/artifact-integrity",
        evidence:
            "A release verifier reported a digest mismatch for payments-api 4.18.2. Treat possible signing-key abuse as a hypothesis, not a confirmed fact.",
        memoryContent:
            "Incident IR-7421 hypothesis: payments-api 4.18.2 showed a digest mismatch that may indicate signing-key abuse, but this is not confirmed.",
        tags: ["IR-7421", "payments-api", "hypothesis"],
    },
    {
        id: "checkpoint-impact",
        type: "checkpoint",
        at: "2026-08-05T10:00:00.000Z",
        title: "Scope and impact handoff",
        expectedRecall: [
            "198.51.100.24",
            "prod-signing",
            "payments-api 4.18.2",
            "not confirmed",
        ],
    },
    {
        id: "containment",
        type: "evidence",
        at: "2026-08-05T10:14:00.000Z",
        source: "Incident command",
        topicPath: "/security/incidents/ir-7421/containment",
        evidence:
            "Responders isolated build-runner-03, revoked svc-build sessions, rotated its credential, and sinkholed 198.51.100.24. Callbacks stopped.",
        memoryContent:
            "Incident IR-7421 containment: build-runner-03 isolated, svc-build sessions revoked and credential rotated, 198.51.100.24 sinkholed, and callbacks stopped.",
        tags: ["IR-7421", "containment"],
    },
    {
        id: "false-lead-resolution",
        type: "evidence",
        at: "2026-08-05T10:29:00.000Z",
        source: "Forensic validation",
        topicPath: "/security/incidents/ir-7421/corrections",
        evidence:
            "The payments-api mismatch came from a stale verifier cache. Key Vault confirms the attacker never read a secret value or performed a signing operation.",
        memoryContent:
            "Incident IR-7421 correction: the payments-api 4.18.2 digest mismatch was a stale verifier-cache false lead; no signing key was retrieved or used.",
        tags: ["IR-7421", "payments-api", "correction", "validated"],
    },
    {
        id: "checkpoint-final",
        type: "checkpoint",
        at: "2026-08-05T10:40:00.000Z",
        title: "Final diagnosis and lessons",
        expectedRecall: [
            "svc-build",
            "build-runner-03",
            "198.51.100.24",
            "stale verifier",
            "no signing key",
        ],
    },
];

export const incidentConversationRounds: readonly IncidentConversationRound[] =
    [
        {
            id: "initial-triage",
            at: "2026-08-05T09:25:00.000Z",
            analystMessage:
                "We have a likely account compromise on IR-7421. Entra reports a password spray from 203.0.113.77 against 46 accounts, with svc-build as the only successful login. The account used legacy authentication, is excluded from MFA, and normally runs only on build-runner-03. EDR now shows w3wp.exe on that host spawning encoded PowerShell to download update.ps1; its SHA-256 starts 84c1e9b7. What is your initial assessment and what should I prioritize?",
            evidenceIds: [
                "alert-password-spray",
                "identity-correlation",
                "endpoint-execution",
            ],
        },
        {
            id: "impact-and-containment",
            at: "2026-08-05T10:29:00.000Z",
            analystMessage:
                "More evidence is in. build-runner-03 beaconed to 198.51.100.24:443 every 60 seconds after update.ps1 ran. The svc-build token listed secrets in prod-signing, but there was no secret-value read or signing operation. A payments-api 4.18.2 digest mismatch briefly raised signing-key abuse as a hypothesis. We isolated the host, revoked and rotated svc-build, and sinkholed the callback. Forensics then traced the mismatch to a stale verifier cache and confirmed no signing key was retrieved or used. Update the diagnosis and tell me what remains to do.",
            evidenceIds: [
                "command-and-control",
                "vault-access",
                "artifact-anomaly",
                "containment",
                "false-lead-resolution",
            ],
        },
    ];

export function getConversationRoundEvidence(
    round: IncidentConversationRound,
): readonly IncidentEvidenceTurn[] {
    return round.evidenceIds.map((id) => {
        const turn = incidentScenario.find(
            (candidate): candidate is IncidentEvidenceTurn =>
                candidate.type === "evidence" && candidate.id === id,
        );
        if (turn === undefined) {
            throw new Error(`Unknown incident evidence turn: ${id}`);
        }
        return turn;
    });
}

export function createInvestigationRoundPrompt(
    round: IncidentConversationRound,
    scope: Readonly<Record<string, string>>,
    continuing: boolean,
): string {
    const evidence = getConversationRoundEvidence(round)
        .map(
            (turn, index) =>
                `${index + 1}. [${turn.at}] ${turn.source} (${turn.topicPath}): ${turn.evidence}`,
        )
        .join("\n");
    return [
        continuing
            ? "Continue the IR-7421 investigation using the context already in this session."
            : "You are assisting a security analyst with incident IR-7421.",
        `Use this exact access scope for every memory tool: ${JSON.stringify(scope)}.`,
        "Store each new evidence item below as a separate durable memory using memory_store with kind observation, tags including IR-7421, provenance sourceType agent, actorId incident-demo, and its timestamp as observedAt.",
        "Keep confirmed facts, hypotheses, corrections, and containment distinct. Do not store the analyst's question as evidence.",
        "After the memory updates, answer the analyst directly with a concise assessment, confidence, and prioritized next actions.",
        "",
        `Analyst: ${round.analystMessage}`,
        "",
        "New evidence:",
        evidence,
    ].join("\n");
}

export function createIncidentTurnPrompt(
    turn: IncidentTurn,
    scope: Readonly<Record<string, string>>,
): string {
    const memoryInstructions = [
        "You are the security analyst for incident IR-7421.",
        "This is a fresh agent session. Use the agent-memory MCP to recover prior incident context before reasoning.",
        `Use this exact access scope for memory tools: ${JSON.stringify(scope)}.`,
        "Query /memories for IR-7421. Treat facts, hypotheses, corrections, and containment status distinctly.",
    ].join(" ");
    if (turn.type === "checkpoint") {
        return `${memoryInstructions}\n\nCheckpoint: ${turn.title}. No new evidence is supplied. Produce a concise handoff with timeline, current diagnosis, confidence, false leads, containment, and next actions. Cite concrete indicators recovered from memory.`;
    }
    return `${memoryInstructions}\n\nNew evidence at ${turn.at} from ${turn.source}: ${turn.evidence}\n\nAnalyze how this changes the incident. Store this evidence as a durable memory using memory_store with kind observation, tags including IR-7421, provenance sourceType agent and actorId incident-demo. If it corrects an earlier hypothesis, clearly preserve the correction. Return a concise analyst update.`;
}

export function createBatchedInvestigationPrompt(
    scope: Readonly<Record<string, string>>,
): string {
    const evidence = incidentScenario
        .filter(
            (turn): turn is IncidentEvidenceTurn => turn.type === "evidence",
        )
        .map(
            (turn, index) =>
                `${index + 1}. [${turn.at}] ${turn.source} (${turn.topicPath}): ${turn.evidence}`,
        )
        .join("\n");
    return [
        "You are the primary security analyst for incident IR-7421.",
        `Use this exact access scope for every memory tool: ${JSON.stringify(scope)}.`,
        "Analyze the evidence below as one incident timeline.",
        "Store each numbered evidence item as a separate durable memory using memory_store with kind observation, tags including IR-7421, provenance sourceType agent, actorId incident-demo, and observedAt equal to that item's timestamp.",
        "Preserve the distinction between confirmed facts, hypotheses, corrections, and containment. Store the stale-verifier finding as a correction to the earlier signing-key hypothesis.",
        "After all memory_store calls complete, return a concise incident diagnosis and containment summary.",
        "",
        evidence,
    ].join("\n");
}

export function createFreshHandoffPrompt(
    scope: Readonly<Record<string, string>>,
): string {
    return [
        "You are a new security analyst taking over incident IR-7421 in a fresh agent session.",
        "No incident evidence is present in this chat. Recover it from the agent-memory MCP before answering.",
        `Use this exact access scope for memory tools: ${JSON.stringify(scope)}.`,
        'Call memory_query with path query /memories where "IR-7421" tokens 8192 limit 100.',
        "Produce a concise handoff with timeline, initial access, affected identity and host, command-and-control indicator, cloud impact, corrected false lead, containment, confidence, and next actions.",
        "Include concrete indicators and explicitly state whether a signing key was retrieved or used.",
    ].join("\n");
}

export const finalHandoffRecall = (
    incidentScenario.find(
        (turn) => turn.id === "checkpoint-final",
    ) as IncidentCheckpointTurn
).expectedRecall;
