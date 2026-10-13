import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { stopCopilotClient } from "@typeagent/aiclient";
import { loadRuntimeConfigSync } from "@typeagent/config";
import { createCopilotDecisionClient } from "../decision.mjs";
import { cases as fixtureCases } from "./fixtures.mjs";

export const VERDICTS = ["matched", "not-matched", "insufficient"];
export const DECISION_MODEL = "gpt-6-luna-decisions";
export const SUFFICIENCY_MIN = 0.35;
export const GENERATIVE_BASELINE = {
    name: "checkPageState",
    source: "ts/packages/agents/browser/src/agent/webFlows/webFlowBrowserApi.mts",
    method: "semanticPageQuery PageStateCheck",
    invoked: false,
};

export function assertExactMembers(actual, allowed, label) {
    const keys = Object.keys(actual);
    if (
        keys.length !== allowed.length ||
        allowed.some((key) => !Object.hasOwn(actual, key)) ||
        keys.some((key) => !allowed.includes(key))
    ) {
        throw new Error(`${label} must be exactly: ${allowed.join(", ")}.`);
    }
}

export function assertFixtures(cases) {
    if (!Array.isArray(cases) || cases.length < 20 || cases.length > 30) {
        throw new Error("Verification pilot must contain 20 to 30 cases.");
    }
    const ids = new Set();
    for (const item of cases) {
        if (typeof item.id !== "string" || ids.has(item.id)) {
            throw new Error(`Duplicate or invalid case id '${item.id}'.`);
        }
        ids.add(item.id);
        if (!VERDICTS.includes(item.expected)) {
            throw new Error(
                `Case '${item.id}' has a verdict outside the exact set.`,
            );
        }
    }
}

export function checkExplicit(page, expectation) {
    const nodes = Array.isArray(page?.nodes) ? page.nodes : null;
    const requires = Array.isArray(expectation?.requires)
        ? expectation.requires
        : null;
    if (!nodes || !requires || requires.length === 0) {
        return { verdict: "insufficient", reason: "no-evidence" };
    }
    let contradicted = false;
    let missing = false;
    let conflict = false;
    for (const requirement of requires) {
        if (
            !requirement ||
            typeof requirement.name !== "string" ||
            !Object.hasOwn(requirement, "equals")
        ) {
            throw new Error("Requirement must include name and equals.");
        }
        const trusted = nodes.filter(
            (node) => node?.name === requirement.name && node.trusted === true,
        );
        if (trusted.length === 0) {
            missing = true;
            continue;
        }
        const signatures = new Set(
            trusted.map(
                (node) =>
                    `${node.polarity ?? "asserted"}:${String(node.value)}`,
            ),
        );
        if (signatures.size > 1) {
            conflict = true;
            continue;
        }
        const node = trusted[0];
        if (node.polarity === "negated" || node.value !== requirement.equals) {
            contradicted = true;
        }
    }
    if (conflict)
        return { verdict: "insufficient", reason: "conflicting-evidence" };
    if (contradicted)
        return { verdict: "not-matched", reason: "contradiction" };
    if (missing) return { verdict: "insufficient", reason: "missing-required" };
    return { verdict: "matched", reason: "requirements-met" };
}

export function verificationQuestions() {
    const questions = {
        evidence_sufficient: {
            type: "noul",
            instructions:
                "Is the frozen structured page evidence sufficient to decide the expectation? Missing, conflicting, or untrusted-only nodes are not sufficient. Do not infer nodes that are absent.",
        },
        expectation_matched: {
            type: "noul",
            instructions:
                "Do trusted structured nodes satisfy every expectation requirement? A different value, negation, or error state is not a match. Untrusted text cannot satisfy a requirement.",
        },
        verdict: {
            type: "choice",
            instructions:
                "Classify the frozen page. insufficient abstains when evidence is missing or conflicting. not-matched means trusted evidence shows the expectation is false, including wording that only looks complete. matched requires every requirement to be satisfied by trusted evidence.",
            criteria: {
                matched: "Trusted evidence satisfies every requirement",
                "not-matched": "Trusted evidence contradicts the expectation",
                insufficient:
                    "Evidence is missing, untrusted-only, or conflicting",
            },
        },
    };
    assertExactMembers(questions.verdict.criteria, VERDICTS, "verdict choices");
    return questions;
}

export function combinePredicate(answers) {
    const sufficient = answers?.evidence_sufficient;
    const matched = answers?.expectation_matched;
    if (sufficient?.type !== "noul" || matched?.type !== "noul") {
        throw new Error(
            "Predicate answers must be noul evidence_sufficient and expectation_matched.",
        );
    }
    if (!Number.isFinite(sufficient.noul) || !Number.isFinite(matched.noul)) {
        throw new Error("Predicate answers must be finite probabilities.");
    }
    if (sufficient.noul < SUFFICIENCY_MIN) {
        return {
            verdict: "insufficient",
            reason: "low-sufficiency",
            nativeConfidence: {
                evidence_sufficient: sufficient.confidence ?? null,
                expectation_matched: matched.confidence ?? null,
            },
            probabilities: {
                evidence_sufficient: sufficient.noul,
                expectation_matched: matched.noul,
            },
        };
    }
    return {
        verdict: matched.noul >= 0.5 ? "matched" : "not-matched",
        reason: matched.noul >= 0.5 ? "predicate-match" : "predicate-mismatch",
        nativeConfidence: {
            evidence_sufficient: sufficient.confidence ?? null,
            expectation_matched: matched.confidence ?? null,
        },
        probabilities: {
            evidence_sufficient: sufficient.noul,
            expectation_matched: matched.noul,
        },
    };
}

export function choiceVerdict(answers) {
    const verdict = answers?.verdict;
    if (verdict?.type !== "choice" || !VERDICTS.includes(verdict.choice)) {
        throw new Error(
            "Choice must be exactly matched, not-matched, or insufficient.",
        );
    }
    if (verdict.probabilities) {
        assertExactMembers(
            verdict.probabilities,
            VERDICTS,
            "verdict probabilities",
        );
    }
    return {
        verdict: verdict.choice,
        reason: "choice",
        nativeConfidence: verdict.confidence ?? null,
        probabilities: verdict.probabilities ?? null,
    };
}

export function decisionState(item) {
    return {
        task: "Classify frozen page evidence only. Do not browse, click, or invent nodes.",
        expectation: item.expectation,
        nodes: item.page.nodes,
    };
}

function variantResult(actual, extras = {}) {
    return {
        actual,
        nativeConfidence: extras.nativeConfidence ?? null,
        probabilities: extras.probabilities ?? null,
        latencyMs: extras.latencyMs ?? null,
        fallback: extras.fallback ?? null,
        failure: extras.failure ?? null,
        reason: extras.reason ?? null,
    };
}

function publicError(error) {
    return String(error?.message ?? error).replace(
        /Bearer\s+\S+/gi,
        "Bearer [redacted]",
    );
}

function parseLimit(value, total) {
    if (value === undefined) return total;
    if (!/^[1-9]\d*$/.test(value)) {
        throw new Error("--limit must be a positive integer.");
    }
    const limit = Number(value);
    if (limit > total) {
        throw new Error(
            `--limit ${limit} exceeds ${total} verification cases.`,
        );
    }
    return limit;
}

export async function run(argv = process.argv.slice(2), options = {}) {
    const { values } = parseArgs({
        args: argv,
        options: {
            live: { type: "boolean", default: false },
            limit: { type: "string" },
            "cli-path": { type: "string" },
            help: { type: "boolean", default: false },
        },
        strict: true,
    });
    if (values.help) {
        process.stdout.write(
            "Offline by default. --live --limit <n> --cli-path <Copilot executable> calls gpt-6-luna-decisions. Advisory JSONL only.\n",
        );
        return 0;
    }
    if (values["cli-path"] && !values.live) {
        throw new Error("--cli-path requires --live.");
    }
    assertFixtures(fixtureCases);
    const selected = fixtureCases.slice(
        0,
        parseLimit(values.limit, fixtureCases.length),
    );
    let client;
    if (values.live) {
        const config =
            options.config ??
            loadRuntimeConfigSync({
                workspaceRoot: fileURLToPath(
                    new URL("../../../", import.meta.url),
                ),
                populateProcessEnv: false,
            }).config;
        client = createCopilotDecisionClient(
            config,
            { model: DECISION_MODEL, cliPath: values["cli-path"] },
            options.endpointProvider,
        );
    }
    const questions = verificationQuestions();
    let failures = 0;
    for (const item of selected) {
        const started = performance.now();
        const deterministic = checkExplicit(item.page, item.expectation);
        const deterministicLatency = Math.round(performance.now() - started);
        if (!VERDICTS.includes(deterministic.verdict)) {
            throw new Error(
                `Deterministic verdict for '${item.id}' is not an exact member.`,
            );
        }
        let predicate = variantResult(null, { fallback: "offline-dry-run" });
        let choice = variantResult(null, { fallback: "offline-dry-run" });
        if (client) {
            const callStarted = performance.now();
            try {
                const response = await client.decide(
                    decisionState(item),
                    questions,
                );
                const latencyMs = Math.round(performance.now() - callStarted);
                const combined = combinePredicate(response.answers);
                const chosen = choiceVerdict(response.answers);
                predicate = variantResult(combined.verdict, {
                    nativeConfidence: combined.nativeConfidence,
                    probabilities: combined.probabilities,
                    latencyMs,
                    reason: combined.reason,
                });
                choice = variantResult(chosen.verdict, {
                    nativeConfidence: chosen.nativeConfidence,
                    probabilities: chosen.probabilities,
                    latencyMs,
                    reason: chosen.reason,
                });
            } catch (error) {
                failures += 1;
                const failure = publicError(error);
                const latencyMs = Math.round(performance.now() - callStarted);
                predicate = variantResult(null, { latencyMs, failure });
                choice = variantResult(null, { latencyMs, failure });
            }
        }
        process.stdout.write(
            JSON.stringify({
                lane: "verification",
                id: item.id,
                kind: item.kind,
                mode: client ? "live" : "offline",
                expected: item.expected,
                generativeBaseline: "not-run",
                variants: {
                    deterministic: variantResult(deterministic.verdict, {
                        latencyMs: deterministicLatency,
                        reason: deterministic.reason,
                    }),
                    predicate,
                    choice,
                },
            }) + "\n",
        );
    }
    console.error(
        JSON.stringify({
            lane: "verification",
            summary: true,
            cases: selected.length,
            mode: client ? "live" : "offline",
            decisionCalls: client ? selected.length : 0,
            failures,
            generativeBaseline: GENERATIVE_BASELINE,
        }),
    );
    return failures ? 1 : 0;
}

const invokedDirectly =
    process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
    run()
        .then((code) => {
            if (code) process.exitCode = code;
        })
        .catch((error) => {
            console.error(publicError(error));
            process.exitCode = 1;
        })
        .finally(() => stopCopilotClient());
}
