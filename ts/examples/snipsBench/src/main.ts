// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";
import {
    loadSplit,
    SnipsExample,
    Split,
    tagsToSpans,
    spansToTags,
} from "./data.js";
import { Prediction, scoreSlots, scoreIntent, SlotScore } from "./score.js";
import { GRAMMARS, SlotType } from "./grammar.js";
import { compile, runExample, CompiledGrammar } from "./runner.js";
import { refineSpans } from "./refine.js";
import { induceGrammar } from "./induce.js";

const pct = (x: number) => (x * 100).toFixed(1);

/** Validate the scorer against a hand-computed micro-case (P=1, R=.5, F1=.667). */
function selfTestScorer(): void {
    const examples: SnipsExample[] = [
        {
            tokens: ["add", "taylor", "swift", "to", "jazz"],
            tags: ["O", "B-artist", "I-artist", "O", "B-playlist"],
            intent: "AddToPlaylist",
        },
    ];
    const s = scoreSlots(examples, [
        {
            intent: "AddToPlaylist",
            tags: ["O", "B-artist", "I-artist", "O", "O"],
        },
    ]);
    const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9;
    if (
        !approx(s.precision, 1) ||
        !approx(s.recall, 0.5) ||
        !approx(s.f1, 2 / 3)
    ) {
        throw new Error(
            `scorer self-test FAILED: P=${s.precision} R=${s.recall} F1=${s.f1}`,
        );
    }
    console.log(chalk.green("✓ scorer self-test passed"));
}

/** Oracle: gold-as-pred must score 100% — proves load→spans→score is sound. */
function verifyOracle(examples: SnipsExample[]): void {
    const oracle: Prediction[] = examples.map((e) => ({
        intent: e.intent,
        tags: e.tags,
    }));
    const oi = scoreIntent(examples, oracle);
    const os = scoreSlots(examples, oracle);
    if (oi.accuracy !== 1 || Math.abs(os.f1 - 1) > 1e-9) {
        throw new Error(
            `PIPELINE BROKEN: oracle intent ${oi.accuracy}, slot F1 ${os.f1}`,
        );
    }
    console.log(
        chalk.green(
            `✓ oracle 100/100 on ${examples.length} examples (${os.numGold} gold spans) — verified`,
        ),
    );
}

const ARMS = ["wildcard", "NP", "title-aware"] as const;
type Arm = (typeof ARMS)[number];

/** Predictions for one arm over a subset, given the plain & NP base predictions. */
function predictArm(
    arm: Arm,
    subset: SnipsExample[],
    plain: Prediction[],
    np: Prediction[],
): Prediction[] {
    if (arm === "wildcard") return plain;
    if (arm === "NP") return np;
    return subset.map((e, i) => ({
        intent: plain[i].intent,
        tags: spansToTags(
            refineSpans(e.tokens, tagsToSpans(plain[i].tags)),
            e.tokens.length,
        ),
    }));
}

/** A per-intent compiled grammar pair plus a short note for the table. */
interface IntentBuild {
    gPlain: CompiledGrammar;
    gNP: CompiledGrammar;
    note: string;
}

/**
 * Run a full scoreboard: for each intent, build plain & NP grammars, evaluate
 * three arms on that intent's gold test subset, and micro-pool across intents.
 */
function scoreboard(
    title: string,
    all: SnipsExample[],
    build: (intent: string, subset: SnipsExample[]) => IntentBuild | null,
): void {
    console.log(
        chalk.bold(
            `\n══ ${title} — slot F1 by intent × arm (intent given) ══\n`,
        ),
    );
    const pooled = new Map<Arm, { ex: SnipsExample[]; pr: Prediction[] }>();
    for (const a of ARMS) pooled.set(a, { ex: [], pr: [] });

    const head =
        "intent".padEnd(22) +
        "cov".padStart(7) +
        "note".padStart(10) +
        ARMS.map((a) => a.padStart(13)).join("");
    console.log(chalk.bold(head));
    console.log(chalk.dim("─".repeat(head.length)));

    for (const ig of GRAMMARS) {
        const subset = all.filter((e) => e.intent === ig.intent);
        if (subset.length === 0) continue;
        const built = build(ig.intent, subset);
        if (!built) {
            console.log(
                ig.intent.padEnd(22) + chalk.dim("  (grammar build failed)"),
            );
            continue;
        }
        const plain = subset.map((e) =>
            runExample(e.tokens, [built.gPlain], ig.intent),
        );
        const np = subset.map((e) =>
            runExample(e.tokens, [built.gNP], ig.intent),
        );
        const coverage =
            plain.filter((p) => p.tags.some((t) => t !== "O")).length /
            subset.length;

        const cells: string[] = [];
        for (const arm of ARMS) {
            const preds = predictArm(arm, subset, plain, np);
            cells.push(`${pct(scoreSlots(subset, preds).f1)}`.padStart(13));
            const pool = pooled.get(arm)!;
            pool.ex.push(...subset);
            pool.pr.push(...preds);
        }
        console.log(
            ig.intent.padEnd(22) +
                `${pct(coverage)}%`.padStart(7) +
                built.note.padStart(10) +
                cells.join(""),
        );
    }

    console.log(chalk.dim("─".repeat(head.length)));
    const agg = new Map<Arm, SlotScore>();
    const cells: string[] = [];
    for (const arm of ARMS) {
        const p = pooled.get(arm)!;
        const s = scoreSlots(p.ex, p.pr);
        agg.set(arm, s);
        cells.push(`${pct(s.f1)}`.padStart(13));
    }
    console.log(
        chalk.bold("POOLED (micro)".padEnd(29)) +
            "".padStart(10) +
            cells.join(""),
    );
    for (const arm of ARMS) {
        const s = agg.get(arm)!;
        console.log(
            `  ${arm.padEnd(13)} F1 ${pct(s.f1)}%  ` +
                chalk.dim(
                    `(P ${pct(s.precision)} / R ${pct(s.recall)}, ${s.numCorrect}/${s.numPred} pred, ${s.numGold} gold)`,
                ),
        );
    }
    console.log();
}

function main(): void {
    const split = (process.argv[2] as Split) ?? "test";
    console.log(
        chalk.bold(`\nSNIPS action-grammar benchmark — split: ${split}\n`),
    );

    selfTestScorer();
    const examples = loadSplit(split);
    console.log(
        chalk.dim(
            `loaded ${examples.length} examples, ${new Set(examples.map((e) => e.intent)).size} intents`,
        ),
    );
    verifyOracle(examples);

    // M2 — hand-authored grammars.
    scoreboard("M2 hand-authored", examples, (intent) => {
        try {
            const ig = GRAMMARS.find((g) => g.intent === intent)!;
            return {
                gPlain: compile(intent, ig.build("wildcard"), `${intent}_w`),
                gNP: compile(intent, ig.build("NP"), `${intent}_n`),
                note: "",
            };
        } catch {
            return null;
        }
    });

    // M3 — grammars induced from the training split.
    const train = loadSplit("train");
    const minFreq = Number(process.argv[3] ?? 2);
    scoreboard(`M3 induced (train, minFreq=${minFreq})`, examples, (intent) => {
        try {
            const ind = (s: SlotType) =>
                induceGrammar(train, intent, s, { minFreq });
            const w = ind("wildcard");
            return {
                gPlain: compile(intent, w.agr, `${intent}_iw`),
                gNP: compile(intent, ind("NP").agr, `${intent}_in`),
                note: `${w.numAlternatives}alt`,
            };
        } catch (e) {
            console.error(
                chalk.red(
                    `  induce ${intent} failed: ${(e as Error).message.split("\n")[0]}`,
                ),
            );
            return null;
        }
    });
}

main();
