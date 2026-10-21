import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stopCopilotClient } from "@typeagent/aiclient";
import { loadRuntimeConfigSync } from "@typeagent/config";
import {
    createVariantDecisionClient,
    decisionProviderOptions,
} from "../decision.mjs";
import { cases as fixtureCases } from "./fixtures.mjs";

export const DECISION_MODEL = "gpt-6-luna-decisions";
export const SCORE_LEVELS = ["irrelevant", "partial", "relevant"];
export const RELEVANCE_GRADES = [0, 1, 2];
export const SUFFICIENCY_MIN = 0.35;
export const RERANK_BASELINE = {
    name: "compileMessageReRank",
    source: "ts/packages/knowPro/src/search.ts",
    method: "embedding similarity when a message embedding index exists, otherwise SelectTopN",
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

function assertGrades(passages) {
    for (const passage of passages) {
        if (!RELEVANCE_GRADES.includes(passage.relevance)) {
            throw new Error(
                `Relevance for '${passage.id}' must be an exact grade 0, 1, or 2.`,
            );
        }
    }
}

export function assertPermutation(order, passages) {
    const ids = passages.map((passage) => passage.id);
    if (
        order.length !== ids.length ||
        new Set(order).size !== ids.length ||
        order.some((id) => !ids.includes(id))
    ) {
        throw new Error("Order must be an exact permutation of passage ids.");
    }
}

export function assertFixtures(cases) {
    if (!Array.isArray(cases) || cases.length < 20 || cases.length > 30) {
        throw new Error("Retrieval pilot must contain 20 to 30 cases.");
    }
    const ids = new Set();
    for (const item of cases) {
        if (typeof item.id !== "string" || ids.has(item.id)) {
            throw new Error(`Duplicate or invalid case id '${item.id}'.`);
        }
        ids.add(item.id);
        assertGrades(item.passages);
        assertPermutation(item.retrievalOrder, item.passages);
    }
}

export function dcg(grades) {
    return grades.reduce(
        (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
        0,
    );
}

export function metricFor(order, passages) {
    assertGrades(passages);
    assertPermutation(order, passages);
    const byId = new Map(
        passages.map((passage) => [passage.id, passage.relevance]),
    );
    const grades = order.map((id) => byId.get(id));
    const noneRelevant = passages.every((passage) => passage.relevance === 0);
    const ideal = dcg([...grades].sort((left, right) => right - left));
    return {
        order,
        ndcg: ideal === 0 ? 1 : dcg(grades) / ideal,
        ndcgInformative: !noneRelevant,
        noneRelevant,
    };
}

export function rankByScores(passages, scores, predicates, retrievalOrder) {
    assertPermutation(retrievalOrder, passages);
    const position = new Map(retrievalOrder.map((id, index) => [id, index]));
    for (const passage of passages) {
        if (
            !Number.isFinite(scores[passage.id]) ||
            !Number.isFinite(predicates[passage.id])
        ) {
            throw new Error(`Missing score or predicate for '${passage.id}'.`);
        }
    }
    return [...passages]
        .sort((left, right) => {
            const scoreDelta = scores[right.id] - scores[left.id];
            if (scoreDelta !== 0) return scoreDelta;
            const predicateDelta = predicates[right.id] - predicates[left.id];
            if (predicateDelta !== 0) return predicateDelta;
            return position.get(left.id) - position.get(right.id);
        })
        .map((passage) => passage.id);
}

export function predictsNoneRelevant(scores, predicates) {
    const scoreValues = Object.values(scores);
    const predicateValues = Object.values(predicates);
    if (!scoreValues.length || scoreValues.length !== predicateValues.length) {
        throw new Error(
            "None-relevant prediction needs a score and predicate per passage.",
        );
    }
    return (
        scoreValues.every((score) => score < 0.5) &&
        predicateValues.every((probability) => probability < SUFFICIENCY_MIN)
    );
}

export function retrievalQuestions(item) {
    const questions = {};
    for (const passage of item.passages) {
        questions[`score_${passage.id}`] = {
            type: "score",
            instructions: `How relevant is passage ${passage.id} to the frozen query? Judge only the passage text. Keyword stuffing is not relevance.`,
            criteria: SCORE_LEVELS,
        };
        questions[`relevant_${passage.id}`] = {
            type: "noul",
            instructions: `Is passage ${passage.id} relevant to the frozen query? Irrelevant, contradicted, or keyword-stuffed text is false. If no passage supports the query, this is false.`,
        };
    }
    for (const question of Object.values(questions)) {
        if (question.type === "score") {
            if (question.criteria.join("|") !== SCORE_LEVELS.join("|")) {
                throw new Error(
                    "Score levels must be exactly irrelevant, partial, relevant.",
                );
            }
        }
    }
    return questions;
}

export function decisionState(item) {
    return {
        task: "Score the frozen passages. Do not retrieve new passages or use outside documents.",
        query: item.query,
        passages: item.passages.map((passage) => ({
            id: passage.id,
            text: passage.text,
        })),
    };
}

function decisionRanking(item, answers) {
    const scores = {};
    const predicates = {};
    const probabilities = {};
    const nativeConfidence = {};
    for (const passage of item.passages) {
        const score = answers[`score_${passage.id}`];
        const relevant = answers[`relevant_${passage.id}`];
        if (score?.type !== "score" || relevant?.type !== "noul") {
            throw new Error(`Missing decision answers for '${passage.id}'.`);
        }
        if (
            !Number.isFinite(score.score) ||
            score.score < 0 ||
            score.score > SCORE_LEVELS.length - 1
        ) {
            throw new Error(
                `Score for '${passage.id}' is outside 0..${SCORE_LEVELS.length - 1}.`,
            );
        }
        scores[passage.id] = score.score;
        predicates[passage.id] = relevant.noul;
        probabilities[passage.id] = {
            score: score.probabilities ?? null,
            relevant: relevant.noul,
        };
        nativeConfidence[passage.id] = {
            score: score.confidence ?? null,
            relevant: relevant.confidence ?? null,
        };
    }
    const order = rankByScores(
        item.passages,
        scores,
        predicates,
        item.retrievalOrder,
    );
    return {
        ...metricFor(order, item.passages),
        predictedNoneRelevant: predictsNoneRelevant(scores, predicates),
        scores,
        predicates,
        probabilities,
        nativeConfidence,
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
    if (!/^[1-9]\d*$/.test(value))
        throw new Error("--limit must be a positive integer.");
    const limit = Number(value);
    if (limit > total)
        throw new Error(`--limit ${limit} exceeds ${total} retrieval cases.`);
    return limit;
}

export async function run(argv = process.argv.slice(2), options = {}) {
    const { values } = parseArgs({
        args: argv,
        options: {
            ...decisionProviderOptions,
            live: { type: "boolean", default: false },
            limit: { type: "string" },
            "cli-path": { type: "string" },
            help: { type: "boolean", default: false },
        },
        strict: true,
    });
    if (values.help) {
        process.stdout.write(
            "Offline by default. --live --provider copilot|azure --model <model/deployment> --region <Azure region> --limit <n>. Prints JSONL; does not run embeddings.\n",
        );
        return 0;
    }
    if (values["cli-path"] && !values.live)
        throw new Error("--cli-path requires --live.");
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
        client = createVariantDecisionClient(
            config,
            values,
            options.endpointProvider,
        );
    }
    let failures = 0;
    for (const item of selected) {
        const labels = metricFor(item.retrievalOrder, item.passages);
        let decision = variantResult(null, { fallback: "offline-dry-run" });
        if (client) {
            const started = performance.now();
            try {
                const response = await client.decide(
                    decisionState(item),
                    retrievalQuestions(item),
                );
                const ranked = decisionRanking(item, response.answers);
                decision = variantResult(
                    {
                        order: ranked.order,
                        ndcg: ranked.ndcg,
                        ndcgInformative: ranked.ndcgInformative,
                        predictedNoneRelevant: ranked.predictedNoneRelevant,
                        scores: ranked.scores,
                    },
                    {
                        nativeConfidence: ranked.nativeConfidence,
                        probabilities: ranked.probabilities,
                        latencyMs: Math.round(performance.now() - started),
                    },
                );
            } catch (error) {
                failures += 1;
                decision = variantResult(null, {
                    latencyMs: Math.round(performance.now() - started),
                    failure: publicError(error),
                });
            }
        }
        process.stdout.write(
            JSON.stringify({
                lane: "retrieval",
                id: item.id,
                kind: item.kind,
                mode: client ? "live" : "offline",
                expected: {
                    relevance: Object.fromEntries(
                        item.passages.map((passage) => [
                            passage.id,
                            passage.relevance,
                        ]),
                    ),
                    noneRelevant: labels.noneRelevant,
                    retrievalOrder: item.retrievalOrder,
                },
                embeddingReranker: "not-run",
                generativeJudge: "not-run",
                variants: {
                    fixtureOrder: variantResult(
                        {
                            order: labels.order,
                            ndcg: labels.ndcg,
                            ndcgInformative: labels.ndcgInformative,
                            noneRelevant: labels.noneRelevant,
                        },
                        { latencyMs: 0 },
                    ),
                    decision,
                },
            }) + "\n",
        );
    }
    console.error(
        JSON.stringify({
            lane: "retrieval",
            summary: true,
            cases: selected.length,
            mode: client ? "live" : "offline",
            decisionCalls: client ? selected.length : 0,
            failures,
            embeddingReranker: RERANK_BASELINE,
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
