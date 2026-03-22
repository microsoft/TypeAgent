// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar Warmer — Generator/Adversary Debate Tests
 *
 * These are long-running tests that call the Claude API.
 * They are skipped in CI and should be run explicitly:
 *   pnpm run jest-esm --testPathPattern="grammarWarmer" --verbose
 *
 * ══ GAP ANALYSIS (2026-03-05, 30-min run) ══
 *
 * Results: Training 96.4% (663/688), Blind 87.6% (602/687), Gap 8.8 pts
 *          1933 accepted patterns across 9 iterations (4 adapt + 5 generalization)
 *
 * Category breakdown of BLIND misses (85 total missed common cases):
 *   standard           74.8%  (63 cases)  — Standard phrasings that should match
 *   question           10.3%  (9 cases)   — Question-form requests ("what's playing")
 *   pronoun             7.0%  (6 cases)   — Pronoun references ("turn it up", "skip it")
 *   possessive          3.3%  (3 cases)   — Possessive prepositions ("add to my X")
 *   deictic             2.1%  (2 cases)   — Deictic refs ("this song", "this track")
 *   embedded-politeness 1.7%  (1 case)    — Embedded "please", "could you"
 *   compound            0.8%  (1 case)    — Multi-action ("play X and add Y")
 *
 * Per-action miss rates (blind set, top actions):
 *   setVolume:     11/22 missed (50%)  — "turn up/down the volume" variants
 *   changeVolume:  10/20 missed (50%)  — "make it louder/quieter" variants
 *   playTrack:     9/88 missed (10%)   — Long tail of unusual phrasings
 *   next:          6/21 missed (29%)   — "skip" phrasing not always covered
 *   searchTracks:  6/21 missed (29%)   — "find me X" / "look for X" variants
 *   setMaxVolume:  5/7 missed (71%)    — Rare action, few patterns generated
 *   previous:      4/17 missed (24%)   — "go back" / "last song" variants
 *
 * Root causes of the training–blind gap:
 *
 * 1. ACTION NAME HALLUCINATION (now fixed): ~3-6% of test cases had LLM-hallucinated
 *    action names (e.g., "play" instead of "playTrack", "volume" instead of "setVolume").
 *    These can never match because the grammar maps to real action names.
 *    Fix: buildTestSetPrompt now lists all valid action names and createTestSet()
 *    post-validates, fixing any hallucinated names to the expected action.
 *
 * 2. PRONOUN/DEICTIC FORMS: "turn it up", "skip it", "play this song" require
 *    anaphora resolution — fundamentally unmatchable by a stateless grammar.
 *    These are correctly classified as "uncommon" misses, not a real gap.
 *
 * 3. ADAPT-PHASE OVERFITTING: Phase 1 targets specific training misses, creating
 *    patterns that match those exact phrasings. Blind set uses different wording
 *    for the same intent. Phase 2 (generalization) helps but only closes ~3 pts.
 *
 * 4. VERB SYNONYM COVERAGE: Volume actions suffer most because users say "turn up",
 *    "make louder", "increase", "raise", "bump up", "crank" — many synonyms that
 *    the generator may not produce for the training set's specific miss cases.
 *
 * 5. POSSESSIVE/ARTICLE VARIATION: "add to my playlist" vs "add to playlist" vs
 *    "add to the playlist" — small word differences that multiply across actions.
 *
 * Improvement vectors:
 * - Fix #1 eliminates ~3-6% of phantom misses in test sets
 * - More aggressive verb-synonym expansion in generalization phase
 * - Longer time budget allows more generalization rounds
 * - Consider a "pattern repair" phase that takes blind misses and generates
 *   targeted patterns (without seeing blind set — use structural analysis only)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { GrammarWarmer } from "../src/generation/grammarWarmer.js";
import type { WarmingTestCase } from "../src/generation/grammarWarmer.js";
import { loadSchemaInfo } from "../src/generation/schemaReader.js";
import { registerBuiltInEntities } from "../src/builtInEntities.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

registerBuiltInEntities();

// Find the player .pas.json file
const playerPasPath = path.resolve(
    __dirname,
    "../../../agents/player/dist/agent/playerSchema.pas.json",
);

const hasPlayerSchema = fs.existsSync(playerPasPath);

// Cache files — pre-generate once, reuse across runs
const testSetCachePath = path.resolve(
    __dirname,
    "../../../agents/player/dist/agent/playerWarmerTestSet.json",
);
const blindSetCachePath = path.resolve(
    __dirname,
    "../../../agents/player/dist/agent/playerWarmerBlindSet.json",
);

/**
 * Load or generate a named test set. Cached to a JSON file
 * so it can be reused across warming runs without burning LLM time.
 */
async function getOrCreateCachedTestSet(
    cachePath: string,
    label: string,
    casesPerAction: number,
): Promise<WarmingTestCase[]> {
    // Try loading from cache
    if (fs.existsSync(cachePath)) {
        const cached = JSON.parse(
            fs.readFileSync(cachePath, "utf-8"),
        ) as WarmingTestCase[];
        if (cached.length > 0) {
            console.log(
                `Loaded cached ${label}: ${cached.length} cases from ${cachePath}`,
            );
            return cached;
        }
    }

    // Generate fresh
    console.log(`Generating fresh ${label} (this takes a few minutes)...`);
    const schemaInfo = loadSchemaInfo(playerPasPath);
    const testSet = await GrammarWarmer.createTestSet(
        schemaInfo,
        undefined, // default model
        8, // concurrency
        console.log,
        casesPerAction,
    );

    // Save to cache
    fs.writeFileSync(cachePath, JSON.stringify(testSet, null, 2));
    console.log(`Saved ${label} to ${cachePath}`);
    return testSet;
}

describe("Grammar Warmer", () => {
    // Skip if no player schema available (not built) or in CI
    const skip = !hasPlayerSchema || !!process.env.CI;

    (skip ? it.skip : it)(
        "warms player grammar with generator/adversary debate",
        async () => {
            const schemaInfo = loadSchemaInfo(playerPasPath);
            console.log(
                `\nSchema: ${schemaInfo.schemaName} (${schemaInfo.actions.size} actions)`,
            );
            console.log(
                `Actions: ${Array.from(schemaInfo.actions.keys()).join(", ")}`,
            );

            // Load or generate training + blind test sets (not counted against time budget)
            const testSet = await getOrCreateCachedTestSet(
                testSetCachePath,
                "training test set",
                30,
            );
            const blindTestSet = await getOrCreateCachedTestSet(
                blindSetCachePath,
                "blind test set",
                30,
            );

            const warmer = new GrammarWarmer({
                schemaInfo,
                testSet,
                blindTestSet,
                timeLimitMs: 30 * 60 * 1000, // 30 min debate budget (Phase 1 adapt + Phase 2 generalization)
                targetHitRate: 0.95,
                batchSize: 10,
                onProgress: console.log,
            });

            const result = await warmer.warm();

            // Print results
            console.log("\n══ RESULTS ══");
            console.log(`Grammar length: ${result.grammarText.length} chars`);
            console.log(`Total votes: ${result.votes.length}`);
            console.log(
                `  Accepted: ${result.votes.filter((v) => v.verdict === "accept").length}`,
            );
            console.log(
                `  Rejected: ${result.votes.filter((v) => v.verdict === "reject").length}`,
            );
            console.log(`\nTraining set: ${result.testSet.length} cases`);
            console.log(
                `  Common: ${result.metrics.commonTests}, Uncommon: ${result.metrics.uncommonTests}`,
            );
            console.log(
                `  Hit rate: ${(result.metrics.hitRate * 100).toFixed(1)}% (${result.metrics.commonHits}/${result.metrics.commonTests})`,
            );
            if (result.blindMetrics) {
                console.log(
                    `\nBlind set: ${result.blindTestSet!.length} cases`,
                );
                console.log(
                    `  Common: ${result.blindMetrics.commonTests}, Uncommon: ${result.blindMetrics.uncommonTests}`,
                );
                console.log(
                    `  Hit rate: ${(result.blindMetrics.hitRate * 100).toFixed(1)}% (${result.blindMetrics.commonHits}/${result.blindMetrics.commonTests})`,
                );
            }
            console.log(
                `\nOverall: ${(result.metrics.overallHitRate * 100).toFixed(1)}%`,
            );
            console.log(`Time: ${(result.elapsedMs / 1000).toFixed(1)}s`);
            console.log(`Iterations: ${result.iterationHistory.length}`);

            // Print convergence
            console.log("\n══ CONVERGENCE ══");
            for (const iter of result.iterationHistory) {
                console.log(
                    `  Iter ${iter.iteration}: +${iter.patternsAccepted} patterns, ` +
                        `hit rate ${(iter.hitRate * 100).toFixed(1)}%, ` +
                        `${(iter.elapsedMs / 1000).toFixed(0)}s`,
                );
            }

            // Print vote log (sample)
            console.log("\n══ VOTE LOG (sample) ══");
            for (const vote of result.votes.slice(0, 10)) {
                const genIcon = vote.generator.score >= 3 ? "✓" : "✗";
                const advIcon = vote.adversary.score >= 3 ? "✓" : "✗";
                console.log(
                    `  ${vote.verdict.toUpperCase().padEnd(7)} ` +
                        `gen:${genIcon}${vote.generator.score} adv:${advIcon}${vote.adversary.score} ` +
                        `${vote.actionName}: ${vote.pattern}`,
                );
            }

            // Print grammar
            console.log("\n══ GRAMMAR ══");
            console.log(result.grammarText);

            // Assertions
            expect(result.grammarText.length).toBeGreaterThan(0);
            expect(
                result.votes.filter((v) => v.verdict === "accept").length,
            ).toBeGreaterThan(0);
            expect(result.testSet.length).toBeGreaterThan(0);
            // Training hit rate should reach 0.90+ with 30 min budget
            expect(result.metrics.hitRate).toBeGreaterThanOrEqual(0.9);
            // Blind hit rate — the real generalization measure
            expect(result.blindMetrics).toBeDefined();
            expect(result.blindMetrics!.hitRate).toBeGreaterThanOrEqual(0.8);
        },
        45 * 60 * 1000, // 45 min timeout (test-set gen ~8 min + 30 min debate + buffer)
    );
});
