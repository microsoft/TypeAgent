// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Integration benchmark: new grammarGenerator (populateCache) + NFA matcher end-to-end
 *
 * Mirrors the production flow in cache.ts when grammarSystem === "nfa":
 *   userRequest + confirmedAction → populateCache() → generatedRule → NFA match
 *
 * Run explicitly:
 *   npm test -- --testPathPattern=grammarNfaIntegration
 *
 * Results are persisted to test/data/grammarNfaResults.json between runs.
 * Each run only re-runs entries that previously failed (or have never been run).
 * This makes incremental progress: fix issues, rerun, only failing entries are retried.
 *
 * To force a full rerun, delete (or clear) test/data/grammarNfaResults.json.
 * To limit entries: MAX_ENTRIES=50 npm test -- --testPathPattern=grammarNfaIntegration
 *
 * Both rejections (populateCache declined) and no-match (NFA failed to match)
 * are treated as failures so they show up in the Jest summary.
 */

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { readExplanationTestData } from "agent-dispatcher/internal";
import { glob } from "glob";
import {
    loadGrammarRules,
    compileGrammarToNFA,
    matchGrammarWithNFA,
    registerBuiltInEntities,
    globalPhraseSetRegistry,
} from "action-grammar";
import { populateCache } from "action-grammar/generation";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Configuration ──────────────────────────────────────────────────────────────

// Sequential execution: concurrent Claude CLI processes corrupt ~/.claude.json.
// Results persist between runs; only previously-failed entries are re-run.
const RESULTS_FILE = path.resolve(
    __dirname,
    "data/grammarNfaResults.json",
);

const PLAYER_SCHEMA_PATH = path.resolve(
    __dirname,
    "../../../agents/player/dist/agent/playerSchema.pas.json",
);

// ── Skip guard ─────────────────────────────────────────────────────────────────

// Enterprise auth is handled transparently by the Claude Agent SDK —
// no explicit API key env var needed.
const schemaAvailable = fs.existsSync(PLAYER_SCHEMA_PATH);

// ── Data loading ───────────────────────────────────────────────────────────────

interface TestEntry {
    request: string;
    schemaName: string;
    actionName: string;
    parameters: Record<string, unknown>;
}

const dataFiles = ["test/data/explanations/**/v5/*.json"];
const inputs = await Promise.all(
    (await glob(dataFiles)).map((f) => readExplanationTestData(f)),
);

const allTestEntries: TestEntry[] = inputs.flatMap((f) =>
    f.entries.map((e) => {
        const action = e.action as {
            fullActionName: string;
            parameters?: Record<string, unknown>;
        };
        const actionName = action.fullActionName.split(".").pop()!;
        return {
            request: e.request,
            schemaName: f.schemaName,
            actionName,
            parameters: action.parameters ?? {},
        };
    }),
);

// Allow limiting entries via MAX_ENTRIES env var for trial runs (e.g. MAX_ENTRIES=30)
const maxEntries = process.env.MAX_ENTRIES
    ? parseInt(process.env.MAX_ENTRIES, 10)
    : undefined;
const testEntries = maxEntries
    ? allTestEntries.slice(0, maxEntries)
    : allTestEntries;

// ── Persistent results file ────────────────────────────────────────────────────
//
// Stored as a JSON array, one object per test entry.
// "pass"  = rule generated AND NFA matched.
// "fail"  = rejected (no rule) or no-match (rule didn't match the request).
// On the next run, only "fail" entries (and any new entries) are re-run.

interface PersistedResult {
    request: string;
    schemaName: string;
    actionName: string;
    parameters: Record<string, unknown>;
    status: "pass" | "fail";
    failReason?: "rejected" | "no-match";
    generatedRule?: string;
    rejectionReason?: string;
    lastAttemptedRule?: string;
    /** Phrases added to built-in phrase sets during generation — replayed on load */
    appliedPhrasesToAdd?: Array<{ matcherName: string; phrase: string }>;
    runAt: string; // ISO timestamp of last attempt
}

function entryKey(e: TestEntry): string {
    return `${e.schemaName}|${e.actionName}|${e.request}`;
}

function loadPersistedResults(): Map<string, PersistedResult> {
    if (!fs.existsSync(RESULTS_FILE)) return new Map();
    try {
        const arr = JSON.parse(
            fs.readFileSync(RESULTS_FILE, "utf-8"),
        ) as PersistedResult[];
        return new Map(arr.map((r) => [entryKey(r), r]));
    } catch {
        return new Map();
    }
}

function savePersistedResults(map: Map<string, PersistedResult>): void {
    const arr = Array.from(map.values()).sort((a, b) => {
        const sc = a.schemaName.localeCompare(b.schemaName);
        if (sc !== 0) return sc;
        const ac = a.actionName.localeCompare(b.actionName);
        if (ac !== 0) return ac;
        return a.request.localeCompare(b.request);
    });
    fs.mkdirSync(path.dirname(RESULTS_FILE), { recursive: true });
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(arr, null, 2));
}

// ── Grammar generation results (populated in beforeAll) ────────────────────────

interface GenerationResult {
    generatedRule: string | undefined;
    rejectionReason: string | undefined;
    lastAttemptedRule: string | undefined;
}

const generationResults: (GenerationResult | undefined)[] = new Array(
    testEntries.length,
);

// ── Test suite ─────────────────────────────────────────────────────────────────

describe("Grammar NFA Integration (new explainer → new matcher)", () => {
    beforeAll(async () => {
        if (!schemaAvailable) {
            return;
        }

        // Register built-in entity converters (ordinal, cardinal, etc.) so
        // generated grammar rules using those types compile and match correctly.
        registerBuiltInEntities();

        const total = testEntries.length;
        const persistedResults = loadPersistedResults();

        // Replay all persisted phrasesToAdd so cached rules match as they did when generated.
        // populateCache adds phrases ephemerally; without replay, cached rules that depend on
        // added phrases (e.g. "yo yo" in Greeting) will fail NFA match in the it() blocks.
        for (const prev of persistedResults.values()) {
            if (prev.appliedPhrasesToAdd) {
                for (const { matcherName, phrase } of prev.appliedPhrasesToAdd) {
                    globalPhraseSetRegistry.addPhrase(matcherName, phrase);
                }
            }
        }

        // Split entries into: already-passed (use cached result) vs. need-to-run.
        // For cached-pass entries, do a quick NFA pre-check: if the rule no longer
        // matches (e.g. phrasesToAdd weren't persisted in an older run), re-run it.
        const toRun: Array<{ entry: TestEntry; index: number }> = [];

        for (let i = 0; i < testEntries.length; i++) {
            const entry = testEntries[i];
            const prev = persistedResults.get(entryKey(entry));
            if (prev?.status === "pass" && prev.generatedRule) {
                let nfaStillMatches = false;
                try {
                    const g = loadGrammarRules("test", prev.generatedRule);
                    const nfa = compileGrammarToNFA(g);
                    nfaStillMatches =
                        matchGrammarWithNFA(g, nfa, entry.request).length > 0;
                } catch {
                    nfaStillMatches = false;
                }
                if (nfaStillMatches) {
                    generationResults[i] = {
                        generatedRule: prev.generatedRule,
                        rejectionReason: prev.rejectionReason,
                        lastAttemptedRule: prev.lastAttemptedRule,
                    };
                } else {
                    // Stale cache (phrases missing) — re-run to get fresh phrasesToAdd
                    toRun.push({ entry, index: i });
                }
            } else {
                toRun.push({ entry, index: i });
            }
        }

        const cachedPass = total - toRun.length;
        process.stdout.write(
            `\n─── Grammar NFA: ${total} entries │ ${cachedPass} cached-pass │ ${toRun.length} to run ───\n\n`,
        );

        let newPass = 0;
        let newFail = 0;

        for (let run = 0; run < toRun.length; run++) {
            const { entry, index } = toRun[run];
            const actionLabel = `${entry.actionName}(${JSON.stringify(entry.parameters)})`;

            const result = await populateCache({
                request: entry.request,
                schemaName: entry.schemaName,
                action: {
                    actionName: entry.actionName,
                    parameters: entry.parameters,
                },
                schemaPath: PLAYER_SCHEMA_PATH,
            });

            generationResults[index] = {
                generatedRule: result.generatedRule,
                rejectionReason: result.rejectionReason,
                lastAttemptedRule: result.lastAttemptedRule,
            };

            // Attempt NFA match here so we can record the true status.
            // The it() blocks will re-run the same check and report via Jest assertions.
            let nfaMatched = false;
            if (result.generatedRule) {
                try {
                    const g = loadGrammarRules("test", result.generatedRule);
                    const nfa = compileGrammarToNFA(g);
                    nfaMatched = matchGrammarWithNFA(g, nfa, entry.request).length > 0;
                } catch {
                    nfaMatched = false;
                }
            }

            const persisted: PersistedResult = {
                request: entry.request,
                schemaName: entry.schemaName,
                actionName: entry.actionName,
                parameters: entry.parameters,
                status: result.generatedRule && nfaMatched ? "pass" : "fail",
                runAt: new Date().toISOString(),
            };
            if (result.generatedRule) persisted.generatedRule = result.generatedRule;
            if (result.rejectionReason) persisted.rejectionReason = result.rejectionReason;
            if (result.lastAttemptedRule)
                persisted.lastAttemptedRule = result.lastAttemptedRule;
            if (result.appliedPhrasesToAdd && result.appliedPhrasesToAdd.length > 0)
                persisted.appliedPhrasesToAdd = result.appliedPhrasesToAdd;
            if (!result.generatedRule) {
                persisted.failReason = "rejected";
            } else if (!nfaMatched) {
                persisted.failReason = "no-match";
            }
            persistedResults.set(entryKey(entry), persisted);

            if (persisted.status === "pass") {
                newPass++;
                process.stdout.write(
                    `[${run + 1}/${toRun.length}] ✓  ${entry.request}\n` +
                        `           → ${actionLabel}\n`,
                );
            } else if (persisted.failReason === "rejected") {
                newFail++;
                const ruleInfo = result.lastAttemptedRule
                    ? `\n  rule   : ${result.lastAttemptedRule.trimEnd()}`
                    : "";
                process.stdout.write(
                    `[${run + 1}/${toRun.length}] ✗  REJECT  ${entry.request}\n` +
                        `  action : ${actionLabel}\n` +
                        `  reason : ${result.rejectionReason ?? "no result"}` +
                        ruleInfo +
                        `\n`,
                );
            } else {
                newFail++;
                process.stdout.write(
                    `[${run + 1}/${toRun.length}] ✗  NO-MATCH  ${entry.request}\n` +
                        `  action : ${actionLabel}\n` +
                        `  rule   : ${result.generatedRule?.trimEnd()}\n`,
                );
            }
        }

        savePersistedResults(persistedResults);

        const totalPass = cachedPass + newPass;
        process.stdout.write(
            `\n─── Done: ${totalPass}/${total} pass (${cachedPass} cached + ${newPass} new) │ ${newFail} failed ───\n\n`,
        );
    }, 40 * 60 * 1000); // 40-minute timeout for the full benchmark (~535 entries)

    for (let i = 0; i < testEntries.length; i++) {
        const entry = testEntries[i];
        it(`[${entry.schemaName}] '${entry.request}'`, () => {
            if (!schemaAvailable) {
                console.log("Skip: player schema not built");
                return;
            }

            const gen = generationResults[i];
            const actionLabel = `${entry.actionName}(${JSON.stringify(entry.parameters)})`;

            // ── Rejection: populateCache declined to generate a rule ──────────
            if (!gen?.generatedRule) {
                const ruleInfo = gen?.lastAttemptedRule
                    ? `\n  rule   :\n${gen.lastAttemptedRule}`
                    : "";
                const reason = gen?.rejectionReason ?? "no result";
                // Fail the test so rejections show up in the Jest summary
                throw new Error(
                    `[REJECTED] ${reason}\n  action : ${actionLabel}${ruleInfo}`,
                );
            }

            // ── NFA match verification ────────────────────────────────────────
            const g = loadGrammarRules("test", gen.generatedRule);
            const nfa = compileGrammarToNFA(g);
            const matched = matchGrammarWithNFA(g, nfa, entry.request);

            if (matched.length === 0) {
                // Fail the test with the rule visible so we can fix it
                process.stdout.write(
                    `[NO MATCH] ${entry.request}\n` +
                        `  action : ${actionLabel}\n` +
                        `  rule   :\n${gen.generatedRule}\n`,
                );
                throw new Error(
                    `[NO MATCH] NFA did not match request\n  action : ${actionLabel}\n  rule   :\n${gen.generatedRule}`,
                );
            }

            // The new grammar emits `actionName` (not `fullActionName`).
            const matchedAction = matched[0].match as {
                actionName?: string;
                parameters?: Record<string, unknown>;
            };
            expect(matchedAction?.actionName).toBe(entry.actionName);
        });
    }
});
