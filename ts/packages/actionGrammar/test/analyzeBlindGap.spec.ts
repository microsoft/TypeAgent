// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Diagnostic: Analyze the training-blind hit rate gap.
 *   pnpm run jest-esm --testPathPattern="analyzeBlindGap" --verbose
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { GrammarWarmer } from "../src/generation/grammarWarmer.js";
import type { WarmingTestCase } from "../src/generation/grammarWarmer.js";
import { loadSchemaInfo } from "../src/generation/schemaReader.js";
import { registerBuiltInEntities } from "../src/builtInEntities.js";
import { loadGrammarRulesNoThrow } from "../src/grammarLoader.js";
import { compileGrammarToNFA } from "../src/nfaCompiler.js";
import { matchGrammarWithNFA } from "../src/nfaMatcher.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

registerBuiltInEntities();

const playerPasPath = path.resolve(
    __dirname,
    "../../../agents/player/dist/agent/playerSchema.pas.json",
);
const testSetPath = path.resolve(
    __dirname,
    "../../../agents/player/dist/agent/playerWarmerTestSet.json",
);
const blindSetPath = path.resolve(
    __dirname,
    "../../../agents/player/dist/agent/playerWarmerBlindSet.json",
);

const hasPlayerSchema = fs.existsSync(playerPasPath);
const hasTestSets = fs.existsSync(testSetPath) && fs.existsSync(blindSetPath);

interface MissAnalysis {
    request: string;
    actionName: string;
    isCommon: boolean;
    category: string;
    reason: string;
}

function categorize(tc: WarmingTestCase): { category: string; reason: string } {
    const r = tc.request.toLowerCase();

    // Context-dependent / anaphoric
    if (
        r.includes("that") &&
        (r.includes("again") || r.includes("same") || r.includes("one"))
    ) {
        return {
            category: "anaphoric",
            reason: "References previous context (that/same/again)",
        };
    }
    if (
        r.includes("this") &&
        (r.includes("song") || r.includes("track") || r.includes("one"))
    ) {
        if (
            !r.includes("playlist") &&
            !r.includes("add") &&
            !r.includes("put") &&
            !r.includes("save")
        ) {
            return {
                category: "deictic",
                reason: "Deictic reference (this song/track)",
            };
        }
    }
    if (
        r.includes("it ") ||
        r.includes("it,") ||
        r === "it" ||
        r.endsWith(" it")
    ) {
        return { category: "pronoun", reason: "Pronoun reference (it)" };
    }

    // Compound / multi-action
    if (
        r.includes(" and ") &&
        (r.includes("play") || r.includes("add") || r.includes("then"))
    ) {
        return {
            category: "compound",
            reason: "Compound/multi-action request",
        };
    }

    // Unusual verb or phrasing
    const unusualVerbs = [
        "cue",
        "dial",
        "blast",
        "crank",
        "whip",
        "drop",
        "fire",
        "hook",
        "hit me",
        "serve",
        "deliver",
        "give me a",
        "grace",
        "immerse",
        "indulge",
        "spin up",
        "unleash",
        "vibe",
        "groove",
        "jam",
        "bang",
        "bump",
        "smash",
        "rock",
    ];
    for (const v of unusualVerbs) {
        if (r.includes(v)) {
            return {
                category: "unusual-verb",
                reason: `Unusual verb/phrasing: "${v}"`,
            };
        }
    }

    // Conversational / chatty
    if (
        r.includes("mood for") ||
        r.includes("feel like") ||
        r.includes("feeling like") ||
        r.includes("how about") ||
        r.includes("what about") ||
        r.includes("you know")
    ) {
        return {
            category: "conversational",
            reason: "Conversational/mood-based phrasing",
        };
    }

    // Question form
    if (
        r.startsWith("what") ||
        r.startsWith("which") ||
        r.startsWith("where") ||
        r.startsWith("how") ||
        r.startsWith("do you") ||
        r.startsWith("does")
    ) {
        return { category: "question", reason: "Question form" };
    }

    // Imperative with preposition variation
    if (
        r.includes("to my") ||
        r.includes("on my") ||
        r.includes("from my") ||
        r.includes("in my")
    ) {
        return {
            category: "possessive",
            reason: "Possessive preposition (my/the)",
        };
    }

    // Long/complex with multiple clauses
    if (r.split(" ").length > 12) {
        return {
            category: "long",
            reason: `Long request (${r.split(" ").length} words)`,
        };
    }

    // Politeness embedded (despite instructions)
    if (
        r.includes("please") ||
        r.includes("could you") ||
        r.includes("would you") ||
        r.includes("can you") ||
        r.includes("i'd like")
    ) {
        return {
            category: "embedded-politeness",
            reason: "Politeness embedded in request",
        };
    }

    return {
        category: "standard",
        reason: "Standard phrasing that should match",
    };
}

function analyzeSet(
    grammar: ReturnType<typeof loadGrammarRulesNoThrow>,
    nfa: ReturnType<typeof compileGrammarToNFA>,
    testSet: WarmingTestCase[],
    label: string,
) {
    const commonCases = testSet.filter((tc) => tc.isCommon);
    const uncommonCases = testSet.filter((tc) => !tc.isCommon);

    let commonHits = 0;
    const commonMisses: MissAnalysis[] = [];
    let uncommonHits = 0;

    for (const tc of commonCases) {
        const results = matchGrammarWithNFA(grammar!, nfa, tc.request);
        if (results.length > 0) {
            commonHits++;
        } else {
            const { category, reason } = categorize(tc);
            commonMisses.push({
                request: tc.request,
                actionName: tc.actionName,
                isCommon: true,
                category,
                reason,
            });
        }
    }

    for (const tc of uncommonCases) {
        const results = matchGrammarWithNFA(grammar!, nfa, tc.request);
        if (results.length > 0) {
            uncommonHits++;
        }
    }

    console.log(`\n══ ${label} ══`);
    console.log(
        `  Common: ${commonHits}/${commonCases.length} = ${((commonHits / commonCases.length) * 100).toFixed(1)}%`,
    );
    console.log(
        `  Uncommon: ${uncommonHits}/${uncommonCases.length} bonus hits`,
    );
    console.log(`  Missed common: ${commonMisses.length}`);

    // Category breakdown
    const categoryCounts = new Map<string, number>();
    for (const miss of commonMisses) {
        categoryCounts.set(
            miss.category,
            (categoryCounts.get(miss.category) || 0) + 1,
        );
    }
    const sortedCategories = Array.from(categoryCounts.entries()).sort(
        (a, b) => b[1] - a[1],
    );

    console.log(`\n  Category breakdown of MISSED COMMON cases:`);
    for (const [cat, count] of sortedCategories) {
        const pct = ((count / commonMisses.length) * 100).toFixed(1);
        console.log(`    ${cat}: ${count} (${pct}%)`);
    }

    // Per-action miss breakdown
    const actionMissCounts = new Map<string, number>();
    const actionTotalCounts = new Map<string, number>();
    for (const tc of commonCases) {
        actionTotalCounts.set(
            tc.actionName,
            (actionTotalCounts.get(tc.actionName) || 0) + 1,
        );
    }
    for (const miss of commonMisses) {
        actionMissCounts.set(
            miss.actionName,
            (actionMissCounts.get(miss.actionName) || 0) + 1,
        );
    }
    const actionMissRates = Array.from(actionMissCounts.entries())
        .map(([action, misses]) => ({
            action,
            misses,
            total: actionTotalCounts.get(action) || 0,
            rate: misses / (actionTotalCounts.get(action) || 1),
        }))
        .sort((a, b) => b.misses - a.misses);

    console.log(`\n  Per-action miss rates (top 10):`);
    for (const { action, misses, total, rate } of actionMissRates.slice(
        0,
        10,
    )) {
        console.log(
            `    ${action}: ${misses}/${total} missed (${(rate * 100).toFixed(0)}%)`,
        );
    }

    // Sample misses per category
    console.log(`\n  Sample misses by category:`);
    for (const [cat] of sortedCategories) {
        const samples = commonMisses
            .filter((m) => m.category === cat)
            .slice(0, 5);
        console.log(`\n    [${cat}]`);
        for (const s of samples) {
            console.log(`      "${s.request}" → ${s.actionName}`);
        }
    }

    return {
        commonHits,
        commonMisses,
        commonCases,
        uncommonHits,
        uncommonCases,
    };
}

describe("Blind Gap Analysis", () => {
    const skip = !hasPlayerSchema || !hasTestSets || !!process.env.CI;

    (skip ? it.skip : it)(
        "analyzes training vs blind gap",
        async () => {
            const trainingSet = JSON.parse(
                fs.readFileSync(testSetPath, "utf-8"),
            ) as WarmingTestCase[];
            const blindSet = JSON.parse(
                fs.readFileSync(blindSetPath, "utf-8"),
            ) as WarmingTestCase[];

            console.log(`Training set: ${trainingSet.length} cases`);
            console.log(`Blind set: ${blindSet.length} cases`);

            const schemaInfo = loadSchemaInfo(playerPasPath);

            console.log(
                "\nRunning 5-min warm to get a representative grammar...",
            );
            const quickWarmer = new GrammarWarmer({
                schemaInfo,
                testSet: trainingSet,
                blindTestSet: blindSet,
                timeLimitMs: 5 * 60 * 1000,
                targetHitRate: 0.95,
                batchSize: 10,
                onProgress: (msg: string) => {
                    if (
                        msg.includes("Hit rate") ||
                        msg.includes("Training") ||
                        msg.includes("Blind")
                    ) {
                        console.log(msg);
                    }
                },
            });

            const result = await quickWarmer.warm();
            const grammarText = result.grammarText;

            console.log(
                `\nGrammar: ${grammarText.length} chars, ${result.votes.filter((v) => v.verdict === "accept").length} patterns`,
            );

            const errors: string[] = [];
            const grammar = loadGrammarRulesNoThrow(
                "warmer",
                grammarText,
                errors,
            );
            expect(grammar).toBeDefined();
            if (!grammar) return;

            const nfa = compileGrammarToNFA(grammar);

            const trainingAnalysis = analyzeSet(
                grammar,
                nfa,
                trainingSet,
                "TRAINING SET",
            );
            const blindAnalysis = analyzeSet(
                grammar,
                nfa,
                blindSet,
                "BLIND SET",
            );

            // Category comparison
            console.log("\n══ GAP ANALYSIS ══");

            const trainingMissCategories = new Map<string, number>();
            for (const miss of trainingAnalysis.commonMisses) {
                trainingMissCategories.set(
                    miss.category,
                    (trainingMissCategories.get(miss.category) || 0) + 1,
                );
            }
            const blindMissCategories = new Map<string, number>();
            for (const miss of blindAnalysis.commonMisses) {
                blindMissCategories.set(
                    miss.category,
                    (blindMissCategories.get(miss.category) || 0) + 1,
                );
            }

            const allCategories = new Set([
                ...trainingMissCategories.keys(),
                ...blindMissCategories.keys(),
            ]);
            console.log(
                "\n  Category comparison (training misses vs blind misses):",
            );
            console.log("  Category              Training  Blind    Delta");
            console.log("  " + "─".repeat(55));
            for (const cat of Array.from(allCategories).sort()) {
                const t = trainingMissCategories.get(cat) || 0;
                const b = blindMissCategories.get(cat) || 0;
                console.log(
                    `  ${cat.padEnd(22)} ${String(t).padEnd(10)}${String(b).padEnd(9)}${b - t > 0 ? "+" : ""}${b - t}`,
                );
            }

            // Standard misses are the most actionable
            const blindStandardMisses = blindAnalysis.commonMisses.filter(
                (m) => m.category === "standard",
            );
            console.log(
                `\n  "Standard" blind misses (most actionable — ${blindStandardMisses.length} cases):`,
            );
            for (const miss of blindStandardMisses.slice(0, 30)) {
                console.log(`    "${miss.request}" → ${miss.actionName}`);
            }

            const trainingStandardMisses = trainingAnalysis.commonMisses.filter(
                (m) => m.category === "standard",
            );
            console.log(
                `\n  "Standard" training misses: ${trainingStandardMisses.length}`,
            );
            for (const miss of trainingStandardMisses.slice(0, 15)) {
                console.log(`    "${miss.request}" → ${miss.actionName}`);
            }

            // Summary
            console.log("\n══ SUMMARY ══");
            const trainingRate =
                trainingAnalysis.commonHits /
                trainingAnalysis.commonCases.length;
            const blindRate =
                blindAnalysis.commonHits / blindAnalysis.commonCases.length;
            console.log(
                `Training: ${(trainingRate * 100).toFixed(1)}% (${trainingAnalysis.commonHits}/${trainingAnalysis.commonCases.length})`,
            );
            console.log(
                `Blind:    ${(blindRate * 100).toFixed(1)}% (${blindAnalysis.commonHits}/${blindAnalysis.commonCases.length})`,
            );
            console.log(
                `Gap:      ${((trainingRate - blindRate) * 100).toFixed(1)} percentage points`,
            );
            console.log(`\nBlind misses: ${blindAnalysis.commonMisses.length}`);
            console.log(
                `Training misses: ${trainingAnalysis.commonMisses.length}`,
            );
            console.log(
                `Extra blind misses: ${blindAnalysis.commonMisses.length - trainingAnalysis.commonMisses.length}`,
            );

            // Assertions (diagnostic — not strict)
            expect(grammar).toBeDefined();
        },
        10 * 60 * 1000, // 10 min timeout
    );
});
