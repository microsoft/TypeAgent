// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar Cache Warmer — Generator/Adversary Debate System
 *
 * Proactively generates grammar rules via a three-role LLM architecture:
 *   1. Generator: proposes candidate NL patterns for each action
 *   2. Adversary: challenges whether patterns are "common enough" to cache
 *   3. Test Set Creator: generates held-out test requests for hit rate measurement
 *
 * Politeness, greetings, fillers, and acknowledgements are handled orthogonally
 * by phrase-set matchers (<Polite>, <Greeting>, etc.) and are NOT embedded in
 * generated patterns.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { SchemaInfo, ActionInfo, getWildcardType } from "./schemaReader.js";
import { loadGrammarRulesNoThrow } from "../grammarLoader.js";
import { compileGrammarToNFA } from "../nfaCompiler.js";
import { matchGrammarWithNFA } from "../nfaMatcher.js";
import { registerBuiltInEntities } from "../builtInEntities.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GrammarWarmingConfig {
    /** SchemaInfo loaded from .pas.json */
    schemaInfo: SchemaInfo;
    /** Pre-generated test set (skip test-set generation if provided) */
    testSet?: WarmingTestCase[];
    /** Model for generator (default: sonnet) */
    generatorModel?: string;
    /** Model for adversary (default: sonnet) */
    adversaryModel?: string;
    /** Model for test creator (default: sonnet) */
    testerModel?: string;
    /** Max wall-clock time in ms (default: 20 min) — counts only the debate loop, not test-set generation */
    timeLimitMs?: number;
    /** Target hit rate on common test cases (default: 0.9) */
    targetHitRate?: number;
    /** Patterns per batch per action (default: 10) */
    batchSize?: number;
    /** Max debate rounds for contested patterns (default: 2) */
    maxDebateRounds?: number;
    /** Blind test set — never seen by the adapt loop, measured only at the end */
    blindTestSet?: WarmingTestCase[];
    /** Progress callback */
    onProgress?: (msg: string) => void;
    /** Max concurrent LLM calls (default: 8) */
    concurrency?: number;
}

export interface PatternVote {
    /** The core pattern (no politeness wrapper) */
    pattern: string;
    /** Action this pattern belongs to */
    actionName: string;
    /** Generator's confidence (1-5) + reasoning */
    generator: { score: number; reasoning: string };
    /** Adversary's commonness score (1-5) + reasoning */
    adversary: { score: number; reasoning: string };
    /** Final verdict */
    verdict: "accept" | "reject" | "debate";
    /** Round number (1 = first pass, 2+ = debate rounds) */
    round: number;
}

export interface WarmingTestCase {
    /** The test request (natural language) */
    request: string;
    /** Expected action */
    actionName: string;
    /** Expected parameter values */
    parameters: Record<string, any>;
    /** Is this a "common" request that should match? */
    isCommon: boolean;
}

export interface HitRateMetrics {
    totalTests: number;
    commonTests: number;
    uncommonTests: number;
    commonHits: number;
    commonMisses: number;
    uncommonHits: number;
    /** commonHits / commonTests */
    hitRate: number;
    /** (commonHits + uncommonHits) / totalTests */
    overallHitRate: number;
}

export interface IterationMetrics {
    iteration: number;
    patternsProposed: number;
    patternsAccepted: number;
    hitRate: number;
    elapsedMs: number;
}

export interface GrammarWarmingResult {
    /** The compiled .agr grammar text */
    grammarText: string;
    /** All votes (accepted + rejected) */
    votes: PatternVote[];
    /** Final hit rate metrics (on the training test set) */
    metrics: HitRateMetrics;
    /** The test set used for measurement during warming */
    testSet: WarmingTestCase[];
    /** Blind test set metrics (if a blind set was provided) */
    blindMetrics?: HitRateMetrics;
    /** The blind test set (if provided) */
    blindTestSet?: WarmingTestCase[];
    /** Per-iteration convergence history */
    iterationHistory: IterationMetrics[];
    /** Total elapsed time in ms */
    elapsedMs: number;
}

// ── Internal types ───────────────────────────────────────────────────────────

interface GeneratorCandidate {
    pattern: string;
    confidence: number;
    reasoning: string;
}

interface AdversaryReview {
    pattern: string;
    score: number;
    reasoning: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_TIME_LIMIT_MS = 20 * 60 * 1000; // 20 minutes
const DEFAULT_TARGET_HIT_RATE = 0.9;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_DEBATE_ROUNDS = 2;
const DEFAULT_CONCURRENCY = 8;
const TIME_BUFFER_MS = 30_000; // 30s buffer before deadline
const TEST_CASES_PER_ACTION = 15;

// ── Distribution-Informed Heuristics ─────────────────────────────────────────
// Based on analysis of SNIPS NLU Benchmark and Amazon MASSIVE datasets.
// See test/data/distributionAnalysis.md for full methodology.

/**
 * Classify an action as "transitive" (verb + entity params, e.g. "play X by Y")
 * or "control" (no entity / numeric-only params, e.g. "pause", "turn up volume").
 *
 * Transitive actions have a single dominant verb (~75-80% of utterances) while
 * control actions have distributed vocabulary (no verb exceeds ~20%).
 * This affects how many verb variants the generator should produce.
 */
type ActionVerbProfile = "transitive" | "control";

function classifyActionType(actionInfo: ActionInfo): ActionVerbProfile {
    // Count wildcard/entity params (text-heavy) vs numeric/boolean/no params
    let wildcardCount = 0;
    for (const [, paramInfo] of actionInfo.parameters) {
        const spec = paramInfo.paramSpec;
        if (!spec || spec === "checked_wildcard" || paramInfo.isEntityType) {
            wildcardCount++;
        }
    }
    // Actions with no params or only numeric params are "control" actions
    // Actions with at least one wildcard/entity param are "transitive"
    return wildcardCount > 0 ? "transitive" : "control";
}

/**
 * Enumerate meaningful parameter subsets for an action.
 * E.g. for playTrack(trackName, albumName?, artists?[]):
 *   - trackName only
 *   - trackName + artists
 *   - trackName + albumName
 *   - trackName + artists + albumName
 *
 * Returns a list of human-readable combo descriptions for the generator prompt.
 */
function enumerateParamCombinations(actionInfo: ActionInfo): string[] {
    const required: string[] = [];
    const optional: string[] = [];
    for (const [paramName, paramInfo] of actionInfo.parameters) {
        if (paramInfo.optional) {
            optional.push(paramName);
        } else {
            required.push(paramName);
        }
    }

    if (optional.length === 0) {
        // No optional params — just one combo with all required
        if (required.length === 0) return ["(no parameters)"];
        return [required.join(" + ")];
    }

    // Generate power set of optional params, combined with required
    const combos: string[] = [];
    const n = optional.length;
    for (let mask = 0; mask < 1 << n; mask++) {
        const included = required.slice();
        for (let i = 0; i < n; i++) {
            if (mask & (1 << i)) {
                included.push(optional[i]);
            }
        }
        if (included.length === 0) {
            combos.push("(no parameters)");
        } else {
            combos.push(included.join(" + "));
        }
    }
    return combos;
}

// Empirical sentence form distribution from SNIPS + MASSIVE datasets.
// Stable across intents: ~89% imperative, ~6% desire, ~5% question.
const SENTENCE_FORM_WEIGHTS = {
    imperative: 89,
    desire: 6,
    question: 5,
};

// ── LLM Helper ───────────────────────────────────────────────────────────────

async function queryLLM(prompt: string, model: string): Promise<string> {
    const queryInstance = query({
        prompt,
        options: { model },
    });

    let responseText = "";
    for await (const message of queryInstance) {
        if (message.type === "result") {
            if (message.subtype === "success") {
                responseText = message.result || "";
                break;
            }
        }
    }
    return responseText;
}

function parseJSONArray<T>(text: string): T[] {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
        return JSON.parse(match[0]);
    } catch {
        return [];
    }
}

/**
 * Run async tasks with bounded concurrency.
 * Returns results in the same order as inputs.
 */
async function parallelMap<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    concurrency: number,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < items.length) {
            const idx = nextIndex++;
            results[idx] = await fn(items[idx]);
        }
    }

    const workers = Array.from(
        { length: Math.min(concurrency, items.length) },
        () => worker(),
    );
    await Promise.all(workers);
    return results;
}

// ── Prompts ──────────────────────────────────────────────────────────────────

function buildGeneratorPrompt(
    actionInfo: ActionInfo,
    schemaInfo: SchemaInfo,
    batchSize: number,
    acceptedPatterns: string[],
    missedCases?: WarmingTestCase[],
): string {
    const paramList = formatParamList(actionInfo, schemaInfo);
    const profile = classifyActionType(actionInfo);
    const paramCombos = enumerateParamCombinations(actionInfo);

    // Verb budget: transitive actions need fewer verb variants (dominant verb covers 75%+),
    // control actions need more (no verb exceeds 20%). Based on SNIPS/MASSIVE analysis.
    const verbGuidance =
        profile === "transitive"
            ? `This is a TRANSITIVE action (verb + entity). Real-world data shows one verb dominates
   ~75% of utterances. Focus ~60% of patterns on the primary verb with varied PARAMETER
   STRUCTURES, and ~40% on 4-5 verb synonyms. Do NOT over-diversify verbs.`
            : `This is a CONTROL action (no entity / numeric params). Real-world data shows vocabulary
   is highly distributed — no single verb exceeds 20%. Generate at LEAST 8-10 different
   verb phrases. Include phrasal verbs ("turn up"), adjective forms ("louder"), and
   noun-first forms ("volume up").`;

    // Sentence form budget: 89% imperative, 6% desire, 5% question (from SNIPS/MASSIVE)
    const formBudget = Math.max(1, Math.round(batchSize * 0.06));
    const questionBudget = Math.max(1, Math.round(batchSize * 0.05));

    let prompt = `You are generating natural language command patterns for a voice/text assistant.

ACTION: ${actionInfo.actionName}
PARAMETERS:
${paramList}

VERB BUDGET:
${verbGuidance}

PARAMETER STRUCTURES TO COVER (generate patterns for EACH of these combinations):
${paramCombos.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}

SENTENCE FORM DISTRIBUTION (from real-world NLU data — match these proportions):
  - ~89% IMPERATIVE: "play X", "add X to Y", "skip" (${batchSize - formBudget - questionBudget} patterns)
  - ~6% DESIRE: "I want to hear X", "I'd like to play X" (${formBudget} patterns)
  - ~5% QUESTION: "can you play X", "what's playing" (${questionBudget} patterns)

RULES:
1. Generate ${batchSize} diverse, realistic command patterns
2. Each pattern MUST use $(paramName:type) wildcards for variable content
   - Use the EXACT variable names shown in PARAMETERS above
   - Types: wildcard (multi-word text), Cardinal (numbers), Ordinal (1st/2nd/etc.), CalendarDate, CalendarTime
3. DO NOT include politeness, greetings, or filler words — those are handled separately by phrase-set matchers
4. Focus on how REAL USERS phrase commands — match the sentence form distribution above
5. Systematically vary across these structural axes:
   - VERB CHOICE: different verbs for the same intent (budget depends on action type above)
   - SENTENCE FORM: imperative, desire, question — in the proportions above
   - WORD ORDER: "play X by Y" vs "play Y's X" vs "play some X from Y"
   - PARAMETER SUBSETS: cover each parameter combination listed above
   - CONTRACTIONS: "what's" vs "what is", "I'd" vs "I would"
6. Patterns should cover the most COMMON phrasings (aim for what 90% of users would say)
7. Do NOT invent unusual or literary phrasings

EXAMPLES of good structural variation for a music player:
- play $(trackName:wildcard) by $(artist:wildcard)     [imperative, verb=play]
- put on $(trackName:wildcard)                          [imperative, verb=put on, fewer params]
- I want to hear $(trackName:wildcard) by $(artist:wildcard)  [desire form]
- listen to $(trackName:wildcard)                       [imperative, verb=listen to]
- start playing $(trackName:wildcard)                   [imperative, verb=start playing]

EXAMPLES of BAD patterns (too unusual):
- my ears crave $(trackName:wildcard) — too literary
- throw $(trackName:wildcard) on the speakers — too context-specific
- bestow upon me the sounds of $(trackName:wildcard) — absurd`;

    if (acceptedPatterns.length > 0) {
        prompt += `\n\nALREADY ACCEPTED (avoid duplicates, generate NEW patterns):
${acceptedPatterns.map((p) => `- ${p}`).join("\n")}`;
    }

    if (missedCases && missedCases.length > 0) {
        prompt += `\n\nTHESE TEST REQUESTS ARE NOT MATCHED BY THE CURRENT GRAMMAR — generate patterns that would catch them:
${missedCases.map((c) => `- "${c.request}" → ${c.actionName}`).join("\n")}`;
    }

    prompt += `\n\nReturn a JSON array:
[{ "pattern": "...", "confidence": 1-5, "reasoning": "why this is common" }, ...]

Return ONLY the JSON array, no other text.`;

    return prompt;
}

function buildAdversaryPrompt(
    candidates: GeneratorCandidate[],
    actionInfo: ActionInfo,
): string {
    const patternsText = candidates
        .map(
            (c) =>
                `- "${c.pattern}" (generator confidence: ${c.confidence}, reasoning: ${c.reasoning})`,
        )
        .join("\n");

    return `You are a critic evaluating whether command patterns are COMMON ENOUGH to pre-load into a grammar cache. The grammar should cover ~90% of how real users phrase requests.

ACTION: ${actionInfo.actionName}

COMMONNESS SCORING:
- Score 5: Universal phrasing nearly everyone uses ("play X by Y", "add X to Y", "pause", "next track")
- Score 4: Very common variant ("put on X", "listen to X by Y", "turn it up")
- Score 3: Reasonably common, worth including ("queue up X", "throw on some X")
- Score 2: Unusual but possible ("hit me with some X", "fire up X")
- Score 1: Rare/literary/context-specific ("my ears crave X", "bestow upon me X")

REJECT patterns that:
- Use metaphorical or poetic language for simple commands
- Include scenario context ("while I'm driving, play X")
- Are so terse they're ambiguous without context (single word when action needs params)
- Embed politeness/greetings (those are separate: <Polite>, <Greeting>)
- Have unusual verb choices that most users wouldn't say

CANDIDATE PATTERNS:
${patternsText}

Return a JSON array:
[{ "pattern": "exact pattern from above", "score": 1-5, "reasoning": "..." }, ...]

Return ONLY the JSON array, no other text.`;
}

function buildTestSetPrompt(
    actionInfo: ActionInfo,
    schemaInfo: SchemaInfo,
    count: number,
): string {
    const paramList = formatParamList(actionInfo, schemaInfo);
    const allActionNames = Array.from(schemaInfo.actions.keys());
    const paramCombos = enumerateParamCombinations(actionInfo);

    // Sentence form budget from empirical distribution (SNIPS + MASSIVE)
    const commonCount = Math.round(count * 0.7);
    const uncommonCount = count - commonCount;
    const impCount = Math.round(
        (commonCount * SENTENCE_FORM_WEIGHTS.imperative) / 100,
    );
    const desireCount = Math.max(
        1,
        Math.round((commonCount * SENTENCE_FORM_WEIGHTS.desire) / 100),
    );
    const questionCount = Math.max(
        1,
        Math.round((commonCount * SENTENCE_FORM_WEIGHTS.question) / 100),
    );

    return `You are creating a test set to measure grammar hit rate for a voice assistant.

ACTION: ${actionInfo.actionName}
PARAMETERS:
${paramList}

ALL VALID ACTION NAMES IN THIS SCHEMA (use ONLY these — never invent your own):
${allActionNames.join(", ")}

PARAMETER STRUCTURES TO TEST (spread test cases across these combinations):
${paramCombos.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}

Generate ${count} test requests. Each must include:
- A natural language request (complete sentence)
- The expected action name — MUST be exactly "${actionInfo.actionName}" (not a shortened or alternative name)
- The expected parameter values (as a JSON object)
- Whether it's "common" (should be cached, standard phrasing) or "uncommon" (acceptable cache miss)

CRITICAL: The actionName in every returned object MUST be exactly "${actionInfo.actionName}".
Do NOT use shortened names like "play" instead of "playTrack", or "volume" instead of "setVolume".

SENTENCE FORM DISTRIBUTION FOR COMMON REQUESTS (from real NLU data — follow these proportions):
  Of the ~${commonCount} common requests:
  - ~${impCount} should be IMPERATIVE form: "play X", "add X to Y", "skip the track"
  - ~${desireCount} should be DESIRE form: "I want to hear X", "I'd like to play X"
  - ~${questionCount} should be QUESTION form: "can you play X", "what's playing now"
  DO NOT over-represent question forms — real users overwhelmingly use imperatives (~89%).

REQUIREMENTS:
- Use realistic, varied parameter values (real names, real songs, etc.)
- Common requests (~${commonCount}): standard phrasings real users would say
  Examples: "play Bohemian Rhapsody by Queen", "pause", "skip to the next song"
- Uncommon requests (~${uncommonCount}): chat-history references, unusual phrasings, context-dependent
  Examples: "do that again", "the same thing but louder", "my soul yearns for jazz"
- Spread common requests across the parameter structures listed above
- Include edge cases: multi-word entities ("Taylor Swift"), contractions ("what's playing")
- DO NOT wrap with politeness/greetings — test the core command only

Return a JSON array:
[{ "request": "...", "actionName": "${actionInfo.actionName}", "parameters": {...}, "isCommon": true }, ...]

Return ONLY the JSON array, no other text.`;
}

function buildGeneralizationPrompt(
    actionInfo: ActionInfo,
    schemaInfo: SchemaInfo,
    acceptedPatterns: string[],
    batchSize: number,
): string {
    const paramList = formatParamList(actionInfo, schemaInfo);
    const profile = classifyActionType(actionInfo);
    const paramCombos = enumerateParamCombinations(actionInfo);

    // Group accepted patterns by structure for the LLM to see what's already covered
    const patternList = acceptedPatterns.map((p) => `- ${p}`).join("\n");

    const verbBudgetNote =
        profile === "transitive"
            ? `This is a TRANSITIVE action. The primary verb already dominates ~75% of real usage.
Focus generalization on: parameter structure variants, possessive/article variants, and
a few question-form transforms. Do NOT generate many verb synonyms — 4-5 total is enough.`
            : `This is a CONTROL action with distributed vocabulary. Focus generalization heavily on
VERB SYNONYMS — generate 8+ different verb phrases. Also include adjective/adverb forms
("louder", "quieter") and noun-first forms ("volume up").`;

    return `You are generating STRUCTURAL VARIANTS of existing command patterns for a voice/text assistant.

ACTION: ${actionInfo.actionName}
PARAMETERS:
${paramList}

VERB BUDGET:
${verbBudgetNote}

PARAMETER STRUCTURES (ensure each accepted pattern is generalized across these combos):
${paramCombos.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}

EXISTING ACCEPTED PATTERNS:
${patternList}

YOUR TASK: Generate ${batchSize} NEW patterns that are STRUCTURAL VARIANTS of the accepted patterns.
These patterns must use different sentence structures while keeping the same natural intent.

SENTENCE FORM TARGET (from real NLU data):
  ~89% imperative, ~6% desire ("I want..."), ~5% question ("can you...")
  Most of your variants should be imperative form with structural changes.

STRUCTURAL VARIATION AXES (systematically explore ALL of these):
1. VERB SYNONYMS — for EACH accepted pattern, replace the verb with common alternatives:
   - play → put on, start, listen to, throw on, queue, queue up, hear
   - add → put, place, save, include, throw in, toss in
   - create → make, set up, start, build, new
   - search/find → look for, look up, search for, find me, hunt for
   - skip/next → go to the next, move to the next, jump ahead, advance
   - previous/back → go back, last, go to the previous, rewind, go back to
   - volume/turn up → raise, increase, bump up, make louder, crank up, boost
   - volume/turn down → lower, decrease, reduce, make quieter, soften
   - show/display → what's, tell me, give me, list, show me
   - delete/remove → get rid of, trash, clear, drop, remove
2. QUESTION FORM TRANSFORMS (~5% of real usage — include 1-2 per action):
   - Imperative: "play X" → Question: "can you play X" / "could you play X"
   - Status: "show status" → "what's playing" / "what song is this"
   - Search: "find X" → "do you have X" / "is there any X"
3. POSSESSIVE + ARTICLE VARIANTS (users frequently say "my" or "the"):
   - "add to playlist" → "add to my playlist" / "add to the playlist"
   - "play favorites" → "play my favorites" / "play the favorites"
   - "play X" → "play the X" → "play some X" → "play a X"
   - Generate both with and without "my", "the", "some", "any"
4. PREPOSITION VARIANTS:
   - "add X to Y" → "add X into Y" → "put X on Y" → "put X in Y"
   - "play X from Y" → "play X off Y" → "play X on Y"
5. CONTRACTION VARIANTS:
   - "what is" → "what's", "I would" → "I'd", "let us" → "let's", "I will" → "I'll"
6. PARAMETER STRUCTURE VARIANTS — for each accepted pattern, create variants using
   different parameter combinations from the list above:
   - Full: "play X by Y on Z" → Partial: "play X by Y" → Minimal: "play X"
7. WORD ORDER PERMUTATIONS:
   - "play X by Y" → "play Y's X" → "play some Y, the song X"
   - "add X to Y" → "in Y, add X" → "on Y, put X"

RULES:
- Each pattern MUST use $(paramName:type) wildcards with the EXACT names from PARAMETERS
- DO NOT include politeness, greetings, or filler words
- Only generate patterns that REAL USERS would commonly say
- DO NOT duplicate any existing accepted patterns
- Focus on HIGH-COVERAGE structural diversity, not clever or unusual phrasings

Return a JSON array:
[{ "pattern": "...", "confidence": 1-5, "reasoning": "structural variant of: [original pattern] — axis: [which axis]" }, ...]

Return ONLY the JSON array, no other text.`;
}

/**
 * Analyze missed training cases to identify structural patterns the grammar lacks.
 * Returns a description of what's missing (for the generator prompt), not the cases themselves.
 */
function analyzeMissPatterns(missedCases: WarmingTestCase[]): {
    gapDescription: string;
    questionCount: number;
    possessiveCount: number;
    articleCount: number;
    verbGaps: string[];
} {
    let questionCount = 0;
    let possessiveCount = 0;
    let articleCount = 0;
    const verbsSeen = new Set<string>();

    for (const tc of missedCases) {
        const r = tc.request.toLowerCase();
        if (
            r.startsWith("what") ||
            r.startsWith("which") ||
            r.startsWith("where") ||
            r.startsWith("how") ||
            r.startsWith("do ") ||
            r.startsWith("does ") ||
            r.startsWith("is ") ||
            r.startsWith("are ") ||
            r.startsWith("can ")
        ) {
            questionCount++;
        }
        if (r.includes(" my ") || r.includes(" my\n")) possessiveCount++;
        if (
            r.includes(" the ") ||
            r.includes(" a ") ||
            r.includes(" some ") ||
            r.includes(" any ")
        ) {
            articleCount++;
        }

        // Detect leading verbs
        const firstWord = r.split(/\s/)[0];
        if (firstWord) verbsSeen.add(firstWord);
    }

    const gapLines: string[] = [];
    if (questionCount > 0) {
        gapLines.push(
            `- ${questionCount} missed requests use QUESTION FORM ("what's playing", "how do I...", "can you...")`,
        );
    }
    if (possessiveCount > 0) {
        gapLines.push(
            `- ${possessiveCount} missed requests use POSSESSIVE "my" ("add to my playlist", "play my favorites")`,
        );
    }
    if (articleCount > 0) {
        gapLines.push(
            `- ${articleCount} missed requests use ARTICLES "the/a/some/any" ("play the album", "find some jazz")`,
        );
    }
    const verbGaps = Array.from(verbsSeen).slice(0, 20);
    if (verbGaps.length > 0) {
        gapLines.push(`- Leading verbs in misses: ${verbGaps.join(", ")}`);
    }

    return {
        gapDescription:
            gapLines.length > 0
                ? gapLines.join("\n")
                : "No specific structural gap detected",
        questionCount,
        possessiveCount,
        articleCount,
        verbGaps,
    };
}

function buildTargetedRepairPrompt(
    actionInfo: ActionInfo,
    schemaInfo: SchemaInfo,
    acceptedPatterns: string[],
    missedCases: WarmingTestCase[],
    batchSize: number,
): string {
    const paramList = formatParamList(actionInfo, schemaInfo);
    const gapAnalysis = analyzeMissPatterns(missedCases);
    const profile = classifyActionType(actionInfo);
    const paramCombos = enumerateParamCombinations(actionInfo);

    const patternList =
        acceptedPatterns.length > 0
            ? acceptedPatterns.map((p) => `- ${p}`).join("\n")
            : "(none yet)";

    const verbNote =
        profile === "transitive"
            ? `This is a TRANSITIVE action. Focus repairs on parameter structure gaps and
   article/possessive variants rather than verb diversity.`
            : `This is a CONTROL action. Verb diversity is critical — ensure at least 8 different
   verb phrases are covered across all accepted + repair patterns.`;

    return `You are generating TARGETED grammar patterns for a voice/text assistant to close coverage gaps.

ACTION: ${actionInfo.actionName}
PARAMETERS:
${paramList}

VERB BUDGET:
${verbNote}

PARAMETER STRUCTURES (check which combos are missing from accepted patterns):
${paramCombos.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}

EXISTING ACCEPTED PATTERNS:
${patternList}

COVERAGE GAP ANALYSIS (${missedCases.length} requests are NOT matching):
${gapAnalysis.gapDescription}

SAMPLE MISSED REQUESTS (generate patterns that would match these and similar phrasings):
${missedCases
    .slice(0, 15)
    .map((c) => `- "${c.request}"`)
    .join("\n")}

YOUR TASK: Generate ${batchSize} NEW patterns that specifically address the coverage gaps above.

MANDATORY PATTERN TYPES TO INCLUDE:
${gapAnalysis.questionCount > 0 ? `1. QUESTION FORMS: "what's the current $(X:wildcard)", "what $(X:wildcard) is playing"` : ""}
${gapAnalysis.possessiveCount > 0 ? `2. POSSESSIVE FORMS: "... my $(X:wildcard)", "... to my $(X:wildcard)"` : ""}
${gapAnalysis.articleCount > 0 ? `3. ARTICLE VARIANTS: "play the $(X:wildcard)", "find some $(X:wildcard)", "search for a $(X:wildcard)"` : ""}
4. VERB SYNONYM EXPANSION: For EACH existing accepted pattern, consider whether a different
   verb would also be natural. Common verb alternatives:
   - play → put on, start, listen to, throw on, queue, queue up, hear
   - skip/next → go to the next, move to the next, jump ahead
   - previous/back → go back, last, go to the previous, rewind
   - volume/turn up → raise, increase, bump up, make louder, crank up
   - volume/turn down → lower, decrease, reduce, make quieter
   - add → put, place, save, include, throw in, toss in
   - search/find → look for, look up, search for, find me, hunt for
   - create → make, set up, start, build, new
   - delete/remove → get rid of, trash, clear, drop
   - show/display → what's, tell me, give me, list
5. PREPOSITION VARIANTS: "add X to Y" / "add X into Y" / "add X on Y" / "put X in Y"
6. MISSING PARAMETER STRUCTURES: Check which parameter combos from the list above are NOT
   covered by existing accepted patterns, and generate patterns for those.

RULES:
- Each pattern MUST use $(paramName:type) wildcards with the EXACT names from PARAMETERS
- DO NOT include politeness, greetings, or filler words
- Only generate patterns that REAL USERS would commonly say (score 3+ commonness)
- DO NOT duplicate any existing accepted patterns
- Focus on filling the specific gaps identified above

Return a JSON array:
[{ "pattern": "...", "confidence": 1-5, "reasoning": "fills gap: [which gap]" }, ...]

Return ONLY the JSON array, no other text.`;
}

function formatParamList(
    actionInfo: ActionInfo,
    _schemaInfo: SchemaInfo,
): string {
    const lines: string[] = [];
    for (const [paramName, paramInfo] of actionInfo.parameters) {
        const wildcardType = getWildcardType(paramInfo);
        let desc = `  $(${paramName}:${wildcardType})`;
        if (paramInfo.paramSpec === "checked_wildcard") {
            desc += " — validated at runtime";
        }
        if (paramInfo.optional) {
            desc += " — optional";
        }
        lines.push(desc);
    }
    return lines.join("\n");
}

// ── Grammar Assembly ─────────────────────────────────────────────────────────

function assembleGrammar(
    schemaInfo: SchemaInfo,
    acceptedPatterns: Map<string, string[]>,
): string {
    let output = "// Copyright (c) Microsoft Corporation.\n";
    output += "// Licensed under the MIT License.\n\n";
    output +=
        "// Grammar generated by GrammarWarmer (generator/adversary debate)\n\n";

    // Entity declarations: scan patterns for typed wildcards
    const entityTypes = new Set<string>();
    for (const patterns of acceptedPatterns.values()) {
        for (const pattern of patterns) {
            const matches = pattern.matchAll(/\$\([^:]+:(\w+)\)/g);
            for (const m of matches) {
                const typeName = m[1];
                if (
                    typeName !== "wildcard" &&
                    typeName !== "string" &&
                    typeName !== "word"
                ) {
                    entityTypes.add(typeName);
                }
            }
        }
    }
    if (entityTypes.size > 0) {
        output += `import { ${Array.from(entityTypes).join(", ")} };\n\n`;
    }

    // Per-action rules
    const actionNames: string[] = [];
    for (const [actionName, patterns] of acceptedPatterns) {
        if (patterns.length === 0) continue;
        actionNames.push(actionName);

        const actionInfo = schemaInfo.actions.get(actionName);
        if (!actionInfo) continue;

        // Build the action body for each pattern.
        // Each alternative MUST have its own -> { ... } because the grammar
        // parser only attaches a trailing -> to the last alternative.
        output += `<${actionName}> =\n`;
        for (let i = 0; i < patterns.length; i++) {
            const pattern = patterns[i];
            // Build parameter mappings for THIS pattern's captures
            const paramMappings: string[] = [];
            for (const [paramName] of actionInfo.parameters) {
                const varName = paramName;
                if (pattern.includes(`$(${varName}:`)) {
                    paramMappings.push(`${paramName}: ${varName}`);
                    continue;
                }
                // Try singular form for array params
                const singular =
                    paramName.endsWith("s") && paramName.length > 1
                        ? paramName.slice(0, -1)
                        : null;
                if (singular && pattern.includes(`$(${singular}:`)) {
                    paramMappings.push(`${paramName}: [${singular}]`);
                }
            }
            const actionBody = `{ actionName: "${actionName}", parameters: { ${paramMappings.join(", ")} } }`;
            const sep = i < patterns.length - 1 ? "\n    |" : ";";
            output += `    ${pattern} -> ${actionBody}${sep}\n`;
        }
        output += "\n";
    }

    // Start rule: union of all action rules
    // Phrase-set matchers (<Greeting>, <Polite>, <Acknowledgement>) are handled
    // orthogonally by the dispatch system and don't need grammar-level wrapping.
    if (actionNames.length > 0) {
        output += `<Start> = ${actionNames.map((n) => `<${n}>`).join(" | ")};\n`;
    }

    return output;
}

// ── Hit Rate Measurement ─────────────────────────────────────────────────────

function measureHitRate(
    grammarText: string,
    testSet: WarmingTestCase[],
): HitRateMetrics {
    registerBuiltInEntities();
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow("warmer", grammarText, errors);

    if (!grammar || errors.length > 0) {
        return {
            totalTests: testSet.length,
            commonTests: testSet.filter((t) => t.isCommon).length,
            uncommonTests: testSet.filter((t) => !t.isCommon).length,
            commonHits: 0,
            commonMisses: testSet.filter((t) => t.isCommon).length,
            uncommonHits: 0,
            hitRate: 0,
            overallHitRate: 0,
        };
    }

    const nfa = compileGrammarToNFA(grammar);
    let commonHits = 0;
    let commonMisses = 0;
    let uncommonHits = 0;
    const commonTests = testSet.filter((t) => t.isCommon);
    const uncommonTests = testSet.filter((t) => !t.isCommon);

    for (const tc of commonTests) {
        const results = matchGrammarWithNFA(grammar, nfa, tc.request);
        if (results.length > 0) {
            commonHits++;
        } else {
            commonMisses++;
        }
    }

    for (const tc of uncommonTests) {
        const results = matchGrammarWithNFA(grammar, nfa, tc.request);
        if (results.length > 0) {
            uncommonHits++;
        }
    }

    const hitRate =
        commonTests.length > 0 ? commonHits / commonTests.length : 0;
    const totalHits = commonHits + uncommonHits;
    const overallHitRate = testSet.length > 0 ? totalHits / testSet.length : 0;

    return {
        totalTests: testSet.length,
        commonTests: commonTests.length,
        uncommonTests: uncommonTests.length,
        commonHits,
        commonMisses,
        uncommonHits,
        hitRate,
        overallHitRate,
    };
}

// ── GrammarWarmer Class ──────────────────────────────────────────────────────

export class GrammarWarmer {
    private readonly schemaInfo: SchemaInfo;
    private readonly generatorModel: string;
    private readonly adversaryModel: string;
    private readonly testerModel: string;
    private readonly timeLimitMs: number;
    private readonly targetHitRate: number;
    private readonly batchSize: number;
    private readonly maxDebateRounds: number;
    private readonly concurrency: number;
    private readonly onProgress: (msg: string) => void;
    private readonly preloadedTestSet?: WarmingTestCase[];
    private readonly blindTestSet?: WarmingTestCase[];

    constructor(config: GrammarWarmingConfig) {
        this.schemaInfo = config.schemaInfo;
        this.generatorModel = config.generatorModel || DEFAULT_MODEL;
        this.adversaryModel = config.adversaryModel || DEFAULT_MODEL;
        this.testerModel = config.testerModel || DEFAULT_MODEL;
        this.timeLimitMs = config.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
        this.targetHitRate = config.targetHitRate ?? DEFAULT_TARGET_HIT_RATE;
        this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
        this.maxDebateRounds =
            config.maxDebateRounds ?? DEFAULT_MAX_DEBATE_ROUNDS;
        this.concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
        this.onProgress = config.onProgress ?? (() => {});
        // Validate test sets: strip out cases with hallucinated action names
        const validNames = new Set(config.schemaInfo.actions.keys());
        if (config.testSet) {
            this.preloadedTestSet = config.testSet.filter((tc) =>
                validNames.has(tc.actionName),
            );
        }
        if (config.blindTestSet) {
            this.blindTestSet = config.blindTestSet.filter((tc) =>
                validNames.has(tc.actionName),
            );
        }
    }

    /**
     * Generate a test set for a schema (static, can be saved/reused).
     * Runs all actions in parallel for speed.
     */
    static async createTestSet(
        schemaInfo: SchemaInfo,
        model?: string,
        concurrency?: number,
        onProgress?: (msg: string) => void,
        casesPerAction?: number,
    ): Promise<WarmingTestCase[]> {
        const llmModel = model || DEFAULT_MODEL;
        const maxConcurrent = concurrency || DEFAULT_CONCURRENCY;
        const log = onProgress || (() => {});
        const perAction = casesPerAction || TEST_CASES_PER_ACTION;

        const actions = Array.from(schemaInfo.actions.values());
        log(
            `Generating test set for ${actions.length} actions (${perAction} cases each, concurrency: ${maxConcurrent})...`,
        );

        const validActionNames = new Set(schemaInfo.actions.keys());

        const perActionResults = await parallelMap(
            actions,
            async (actionInfo) => {
                const prompt = buildTestSetPrompt(
                    actionInfo,
                    schemaInfo,
                    perAction,
                );
                const response = await queryLLM(prompt, llmModel);
                const parsed = parseJSONArray<WarmingTestCase>(response);
                let fixedCount = 0;
                const valid = parsed
                    .map((tc) => {
                        // Fix hallucinated action names: if the LLM returned
                        // a name not in the schema, replace with the expected
                        // action name (since we generate per-action).
                        if (
                            tc.actionName &&
                            !validActionNames.has(tc.actionName)
                        ) {
                            tc.actionName = actionInfo.actionName;
                            fixedCount++;
                        }
                        return tc;
                    })
                    .filter(
                        (tc) =>
                            tc.request &&
                            tc.actionName &&
                            tc.isCommon !== undefined,
                    );
                if (fixedCount > 0) {
                    log(
                        `  ${actionInfo.actionName}: ${valid.length} test cases (${fixedCount} had hallucinated action names, fixed)`,
                    );
                } else {
                    log(
                        `  ${actionInfo.actionName}: ${valid.length} test cases`,
                    );
                }
                return valid;
            },
            maxConcurrent,
        );

        const allTests = perActionResults.flat();
        log(
            `Test set complete: ${allTests.length} cases (${allTests.filter((t) => t.isCommon).length} common, ${allTests.filter((t) => !t.isCommon).length} uncommon)`,
        );
        return allTests;
    }

    /** Run the full warming loop. */
    async warm(): Promise<GrammarWarmingResult> {
        const startTime = Date.now();

        // Step 1: Get or generate test set (NOT counted against time budget)
        const validActionNames = new Set(this.schemaInfo.actions.keys());
        let testSet: WarmingTestCase[];
        if (this.preloadedTestSet && this.preloadedTestSet.length > 0) {
            // Validate preloaded test set: strip out cases with hallucinated action names
            const raw = this.preloadedTestSet;
            testSet = raw.filter((tc) => validActionNames.has(tc.actionName));
            const dropped = raw.length - testSet.length;
            if (dropped > 0) {
                this.onProgress(
                    `Validated preloaded test set: dropped ${dropped}/${raw.length} cases with invalid action names`,
                );
            }
            this.onProgress(
                `Using preloaded test set: ${testSet.length} cases (${testSet.filter((t) => t.isCommon).length} common, ${testSet.filter((t) => !t.isCommon).length} uncommon)`,
            );
        } else {
            this.onProgress("Step 1: Generating test set...");
            testSet = await GrammarWarmer.createTestSet(
                this.schemaInfo,
                this.testerModel,
                this.concurrency,
                this.onProgress,
            );
        }

        // Time budget starts AFTER test set is ready
        const debateStart = Date.now();
        const deadline = debateStart + this.timeLimitMs;
        const hasTime = () => Date.now() < deadline - TIME_BUFFER_MS;

        const allVotes: PatternVote[] = [];
        const acceptedPatterns = new Map<string, string[]>();
        const iterationHistory: IterationMetrics[] = [];

        // Initialize accepted patterns map for all actions
        for (const actionName of this.schemaInfo.actions.keys()) {
            acceptedPatterns.set(actionName, []);
        }

        // Step 2: Iterative warming loop
        let iteration = 0;
        let currentHitRate = 0;

        while (hasTime() && currentHitRate < this.targetHitRate) {
            iteration++;
            this.onProgress(
                `\nIteration ${iteration} (${Math.round((Date.now() - debateStart) / 1000)}s elapsed)`,
            );

            let batchProposed = 0;
            let batchAccepted = 0;

            // Find missed common test cases from previous iteration
            let missedCases: WarmingTestCase[] | undefined;
            if (iteration > 1) {
                const grammarText = assembleGrammar(
                    this.schemaInfo,
                    acceptedPatterns,
                );
                missedCases = this.findMissedCases(grammarText, testSet);
                this.onProgress(
                    `  ${missedCases.length} common test cases still missed`,
                );
            }

            // Determine which actions need work this iteration
            const actionsToProcess: Array<{
                actionName: string;
                actionInfo: ActionInfo;
                actionMissed?: WarmingTestCase[];
            }> = [];
            for (const [actionName, actionInfo] of this.schemaInfo.actions) {
                if (missedCases && iteration > 1) {
                    const actionMissed = missedCases.filter(
                        (c) => c.actionName === actionName,
                    );
                    if (actionMissed.length === 0) continue;
                    actionsToProcess.push({
                        actionName,
                        actionInfo,
                        actionMissed,
                    });
                } else {
                    actionsToProcess.push({ actionName, actionInfo });
                }
            }

            // GENERATE phase: all actions in parallel
            this.onProgress(
                `  Generating patterns for ${actionsToProcess.length} actions...`,
            );
            const generateResults = await parallelMap(
                actionsToProcess,
                async (item) => {
                    const existing =
                        acceptedPatterns.get(item.actionName) ?? [];
                    return this.generate(
                        item.actionInfo,
                        existing,
                        item.actionMissed,
                    );
                },
                this.concurrency,
            );

            // REVIEW phase: all actions in parallel
            // Build (actionIndex, candidates) pairs for non-empty results
            const reviewItems: Array<{
                idx: number;
                candidates: GeneratorCandidate[];
            }> = [];
            for (let i = 0; i < generateResults.length; i++) {
                if (generateResults[i].length > 0) {
                    reviewItems.push({
                        idx: i,
                        candidates: generateResults[i],
                    });
                    batchProposed += generateResults[i].length;
                }
            }

            this.onProgress(
                `  Reviewing ${reviewItems.length} action batches (${batchProposed} patterns)...`,
            );
            const reviewResults = await parallelMap(
                reviewItems,
                async (item) => {
                    return this.review(
                        item.candidates,
                        actionsToProcess[item.idx].actionInfo,
                    );
                },
                this.concurrency,
            );

            // ADJUDICATE: process all review results
            const debateItems: Array<{
                idx: number;
                debated: PatternVote[];
            }> = [];
            for (let ri = 0; ri < reviewItems.length; ri++) {
                const item = reviewItems[ri];
                const actionName = actionsToProcess[item.idx].actionName;
                const { accepted, debated, rejected } = this.adjudicate(
                    item.candidates,
                    reviewResults[ri],
                    actionName,
                    1,
                    allVotes,
                );
                this.onProgress(
                    `    ${actionName}: ${accepted.length} accepted, ${rejected.length} rejected, ${debated.length} debated`,
                );

                for (const p of accepted) {
                    const patterns = acceptedPatterns.get(actionName)!;
                    if (!patterns.includes(p)) {
                        patterns.push(p);
                        batchAccepted++;
                    }
                }

                if (debated.length > 0) {
                    debateItems.push({ idx: item.idx, debated });
                }
            }

            // DEBATE ROUND 2: all debated items in parallel
            if (debateItems.length > 0 && hasTime()) {
                this.onProgress(
                    `  Debate round 2 for ${debateItems.length} actions...`,
                );
                const debateResults = await parallelMap(
                    debateItems,
                    async (item) => {
                        const debateCandidates = item.debated.map((v) => ({
                            pattern: v.pattern,
                            confidence: v.generator.score,
                            reasoning: `Generator says: ${v.generator.reasoning}. Adversary says: ${v.adversary.reasoning}`,
                        }));
                        const reReviews = await this.review(
                            debateCandidates,
                            actionsToProcess[item.idx].actionInfo,
                        );
                        return { candidates: debateCandidates, reReviews };
                    },
                    this.concurrency,
                );

                for (let di = 0; di < debateItems.length; di++) {
                    const actionName =
                        actionsToProcess[debateItems[di].idx].actionName;
                    const { candidates, reReviews } = debateResults[di];
                    const round2 = this.adjudicate(
                        candidates,
                        reReviews,
                        actionName,
                        2,
                        allVotes,
                    );
                    this.onProgress(
                        `    ${actionName}: ${round2.accepted.length} more accepted in debate`,
                    );
                    for (const p of round2.accepted) {
                        const patterns = acceptedPatterns.get(actionName)!;
                        if (!patterns.includes(p)) {
                            patterns.push(p);
                            batchAccepted++;
                        }
                    }
                }
            }

            // COMPILE + MEASURE
            const grammarText = assembleGrammar(
                this.schemaInfo,
                acceptedPatterns,
            );
            const metrics = measureHitRate(grammarText, testSet);
            currentHitRate = metrics.hitRate;

            const elapsed = Date.now() - debateStart;
            iterationHistory.push({
                iteration,
                patternsProposed: batchProposed,
                patternsAccepted: batchAccepted,
                hitRate: currentHitRate,
                elapsedMs: elapsed,
            });

            this.onProgress(
                `  Hit rate: ${(currentHitRate * 100).toFixed(1)}% (${metrics.commonHits}/${metrics.commonTests} common)`,
            );

            // Check if no progress was made
            if (batchAccepted === 0 && iteration > 1) {
                this.onProgress("  No new patterns accepted — stopping early");
                break;
            }
        }

        // Phase 2: Targeted Repair — focus on high-miss actions with gap analysis
        // This phase uses TRAINING misses (never blind) to identify structural gaps
        // and generates patterns specifically targeting those gaps.
        if (hasTime()) {
            this.onProgress("\n══ PHASE 2: TARGETED REPAIR ══");
            let repairRound = 0;
            const MAX_REPAIR_ROUNDS = 3;
            while (hasTime() && repairRound < MAX_REPAIR_ROUNDS) {
                repairRound++;
                this.onProgress(
                    `\nRepair round ${repairRound} (${Math.round((Date.now() - debateStart) / 1000)}s elapsed)`,
                );

                // Find remaining training misses, grouped by action
                const currentGrammar = assembleGrammar(
                    this.schemaInfo,
                    acceptedPatterns,
                );
                const allMissed = this.findMissedCases(currentGrammar, testSet);
                if (allMissed.length === 0) {
                    this.onProgress(
                        "  No training misses remain — skipping repair",
                    );
                    break;
                }

                // Group by action and find high-miss actions (>= 2 misses)
                const missByAction = new Map<string, WarmingTestCase[]>();
                for (const tc of allMissed) {
                    const arr = missByAction.get(tc.actionName) ?? [];
                    arr.push(tc);
                    missByAction.set(tc.actionName, arr);
                }

                const repairActions: Array<{
                    actionName: string;
                    actionInfo: ActionInfo;
                    missed: WarmingTestCase[];
                }> = [];
                for (const [actionName, missed] of missByAction) {
                    if (missed.length >= 2) {
                        const actionInfo =
                            this.schemaInfo.actions.get(actionName);
                        if (actionInfo) {
                            repairActions.push({
                                actionName,
                                actionInfo,
                                missed,
                            });
                        }
                    }
                }

                if (repairActions.length === 0) {
                    this.onProgress(
                        "  No actions with >= 2 misses — skipping repair",
                    );
                    break;
                }

                this.onProgress(
                    `  Repairing ${repairActions.length} high-miss actions (${allMissed.length} total misses)...`,
                );

                // Generate targeted repairs in parallel
                const repairResults = await parallelMap(
                    repairActions,
                    async (item) => {
                        return this.generateTargetedRepair(
                            item.actionInfo,
                            acceptedPatterns.get(item.actionName) ?? [],
                            item.missed,
                        );
                    },
                    this.concurrency,
                );

                // Review with adversary in parallel
                let repairProposed = 0;
                let repairAccepted = 0;
                const repairReviewItems: Array<{
                    idx: number;
                    candidates: GeneratorCandidate[];
                }> = [];
                for (let i = 0; i < repairResults.length; i++) {
                    if (repairResults[i].length > 0) {
                        repairReviewItems.push({
                            idx: i,
                            candidates: repairResults[i],
                        });
                        repairProposed += repairResults[i].length;
                    }
                }

                if (repairReviewItems.length === 0) {
                    this.onProgress(
                        "  No repair candidates generated — stopping repair",
                    );
                    break;
                }

                this.onProgress(
                    `  Reviewing ${repairProposed} repair patterns...`,
                );
                const repairReviews = await parallelMap(
                    repairReviewItems,
                    async (item) => {
                        return this.review(
                            item.candidates,
                            repairActions[item.idx].actionInfo,
                        );
                    },
                    this.concurrency,
                );

                // Adjudicate with relaxed threshold for repairs
                for (let ri = 0; ri < repairReviewItems.length; ri++) {
                    const item = repairReviewItems[ri];
                    const actionName = repairActions[item.idx].actionName;
                    const { accepted, rejected } = this.adjudicateRelaxed(
                        item.candidates,
                        repairReviews[ri],
                        actionName,
                        1,
                        allVotes,
                    );
                    this.onProgress(
                        `    ${actionName}: ${accepted.length} accepted, ${rejected.length} rejected`,
                    );
                    for (const p of accepted) {
                        const patterns = acceptedPatterns.get(actionName)!;
                        if (!patterns.includes(p)) {
                            patterns.push(p);
                            repairAccepted++;
                        }
                    }
                }

                // Measure
                iteration++;
                const repairGrammar = assembleGrammar(
                    this.schemaInfo,
                    acceptedPatterns,
                );
                const repairMetrics = measureHitRate(repairGrammar, testSet);
                currentHitRate = repairMetrics.hitRate;
                const elapsed = Date.now() - debateStart;

                iterationHistory.push({
                    iteration,
                    patternsProposed: repairProposed,
                    patternsAccepted: repairAccepted,
                    hitRate: currentHitRate,
                    elapsedMs: elapsed,
                });

                this.onProgress(
                    `  Training: ${(repairMetrics.hitRate * 100).toFixed(1)}% | +${repairAccepted} patterns`,
                );
                if (this.blindTestSet && this.blindTestSet.length > 0) {
                    const repairBlindMetrics = measureHitRate(
                        repairGrammar,
                        this.blindTestSet,
                    );
                    this.onProgress(
                        `  Blind: ${(repairBlindMetrics.hitRate * 100).toFixed(1)}%`,
                    );
                }

                if (repairAccepted === 0) {
                    this.onProgress(
                        "  No repair patterns accepted — stopping repair",
                    );
                    break;
                }
            }
        }

        // Phase 3: Generalization — generate structural variants of accepted patterns
        // This phase does NOT look at any test cases (training or blind).
        // It systematically explores verb synonyms, sentence forms, word order, etc.
        if (hasTime()) {
            this.onProgress("\n══ PHASE 3: GENERALIZATION ══");
            let genIteration = 0;
            while (hasTime()) {
                genIteration++;
                this.onProgress(
                    `\nGeneralization round ${genIteration} (${Math.round((Date.now() - debateStart) / 1000)}s elapsed)`,
                );

                let genProposed = 0;
                let genAccepted = 0;

                // Only process actions that have at least 2 accepted patterns to vary from
                const actionsWithPatterns: Array<{
                    actionName: string;
                    actionInfo: ActionInfo;
                    patterns: string[];
                }> = [];
                for (const [actionName, actionInfo] of this.schemaInfo
                    .actions) {
                    const patterns = acceptedPatterns.get(actionName) ?? [];
                    if (patterns.length >= 2) {
                        actionsWithPatterns.push({
                            actionName,
                            actionInfo,
                            patterns,
                        });
                    }
                }

                if (actionsWithPatterns.length === 0) break;

                // GENERATE structural variants in parallel
                this.onProgress(
                    `  Generating variants for ${actionsWithPatterns.length} actions...`,
                );
                const variantResults = await parallelMap(
                    actionsWithPatterns,
                    async (item) => {
                        return this.generateVariants(
                            item.actionInfo,
                            item.patterns,
                        );
                    },
                    this.concurrency,
                );

                // REVIEW variants with adversary in parallel
                const variantReviewItems: Array<{
                    idx: number;
                    candidates: GeneratorCandidate[];
                }> = [];
                for (let i = 0; i < variantResults.length; i++) {
                    if (variantResults[i].length > 0) {
                        variantReviewItems.push({
                            idx: i,
                            candidates: variantResults[i],
                        });
                        genProposed += variantResults[i].length;
                    }
                }

                if (variantReviewItems.length === 0) {
                    this.onProgress(
                        "  No variants generated — stopping generalization",
                    );
                    break;
                }

                this.onProgress(
                    `  Reviewing ${genProposed} variant patterns...`,
                );
                const variantReviews = await parallelMap(
                    variantReviewItems,
                    async (item) => {
                        return this.review(
                            item.candidates,
                            actionsWithPatterns[item.idx].actionInfo,
                        );
                    },
                    this.concurrency,
                );

                // ADJUDICATE with relaxed threshold (structural variants
                // of already-vetted patterns deserve a lower bar)
                for (let ri = 0; ri < variantReviewItems.length; ri++) {
                    const item = variantReviewItems[ri];
                    const actionName = actionsWithPatterns[item.idx].actionName;
                    const { accepted, rejected } = this.adjudicateRelaxed(
                        item.candidates,
                        variantReviews[ri],
                        actionName,
                        1,
                        allVotes,
                    );
                    this.onProgress(
                        `    ${actionName}: ${accepted.length} accepted, ${rejected.length} rejected`,
                    );
                    for (const p of accepted) {
                        const patterns = acceptedPatterns.get(actionName)!;
                        if (!patterns.includes(p)) {
                            patterns.push(p);
                            genAccepted++;
                        }
                    }
                }

                // Measure both training and blind hit rates
                iteration++;
                const genGrammar = assembleGrammar(
                    this.schemaInfo,
                    acceptedPatterns,
                );
                const genTrainMetrics = measureHitRate(genGrammar, testSet);
                currentHitRate = genTrainMetrics.hitRate;
                const elapsed = Date.now() - debateStart;

                iterationHistory.push({
                    iteration,
                    patternsProposed: genProposed,
                    patternsAccepted: genAccepted,
                    hitRate: currentHitRate,
                    elapsedMs: elapsed,
                });

                this.onProgress(
                    `  Training: ${(genTrainMetrics.hitRate * 100).toFixed(1)}% | +${genAccepted} patterns`,
                );

                if (this.blindTestSet && this.blindTestSet.length > 0) {
                    const genBlindMetrics = measureHitRate(
                        genGrammar,
                        this.blindTestSet,
                    );
                    this.onProgress(
                        `  Blind: ${(genBlindMetrics.hitRate * 100).toFixed(1)}%`,
                    );
                }

                if (genAccepted === 0) {
                    this.onProgress(
                        "  No new variants accepted — stopping generalization",
                    );
                    break;
                }
            }
        }

        // Final grammar and metrics
        const grammarText = assembleGrammar(this.schemaInfo, acceptedPatterns);
        const finalMetrics = measureHitRate(grammarText, testSet);
        const totalElapsed = Date.now() - startTime;

        this.onProgress(
            `\nDone. Final hit rate: ${(finalMetrics.hitRate * 100).toFixed(1)}%`,
        );
        this.onProgress(
            `Total patterns accepted: ${allVotes.filter((v) => v.verdict === "accept").length}`,
        );
        this.onProgress(`Total time: ${totalElapsed}ms`);

        // Measure blind test set (never seen during warming)
        const result: GrammarWarmingResult = {
            grammarText,
            votes: allVotes,
            metrics: finalMetrics,
            testSet,
            iterationHistory,
            elapsedMs: totalElapsed,
        };

        if (this.blindTestSet && this.blindTestSet.length > 0) {
            const blindMetrics = measureHitRate(grammarText, this.blindTestSet);
            result.blindMetrics = blindMetrics;
            result.blindTestSet = this.blindTestSet;
            this.onProgress(
                `\nBlind test set: ${(blindMetrics.hitRate * 100).toFixed(1)}% hit rate (${blindMetrics.commonHits}/${blindMetrics.commonTests} common)`,
            );
        }

        return result;
    }

    // ── Private: LLM Calls ───────────────────────────────────────────────

    private async generate(
        actionInfo: ActionInfo,
        existingPatterns: string[],
        missedCases?: WarmingTestCase[],
    ): Promise<GeneratorCandidate[]> {
        const prompt = buildGeneratorPrompt(
            actionInfo,
            this.schemaInfo,
            this.batchSize,
            existingPatterns,
            missedCases,
        );
        const response = await queryLLM(prompt, this.generatorModel);
        const parsed = parseJSONArray<GeneratorCandidate>(response);

        // Validate: must have pattern with $() wildcards or be a bare command
        return parsed.filter(
            (c) =>
                c.pattern &&
                typeof c.pattern === "string" &&
                c.confidence >= 1 &&
                c.confidence <= 5,
        );
    }

    private async review(
        candidates: GeneratorCandidate[],
        actionInfo: ActionInfo,
    ): Promise<AdversaryReview[]> {
        const prompt = buildAdversaryPrompt(candidates, actionInfo);
        const response = await queryLLM(prompt, this.adversaryModel);
        return parseJSONArray<AdversaryReview>(response);
    }

    private adjudicate(
        candidates: GeneratorCandidate[],
        reviews: AdversaryReview[],
        actionName: string,
        round: number,
        allVotes: PatternVote[],
    ): {
        accepted: string[];
        rejected: string[];
        debated: PatternVote[];
    } {
        const accepted: string[] = [];
        const rejected: string[] = [];
        const debated: PatternVote[] = [];

        // Build review lookup by pattern
        const reviewMap = new Map<string, AdversaryReview>();
        for (const r of reviews) {
            if (r.pattern) {
                reviewMap.set(r.pattern, r);
            }
        }

        for (const candidate of candidates) {
            const review = reviewMap.get(candidate.pattern);
            const adversaryScore = review?.score ?? 3;
            const adversaryReasoning = review?.reasoning ?? "no review";

            let verdict: "accept" | "reject" | "debate";
            if (candidate.confidence >= 3 && adversaryScore >= 3) {
                verdict = "accept";
            } else if (candidate.confidence < 2 || adversaryScore < 2) {
                verdict = "reject";
            } else {
                verdict = round >= this.maxDebateRounds ? "reject" : "debate";
            }

            const vote: PatternVote = {
                pattern: candidate.pattern,
                actionName,
                generator: {
                    score: candidate.confidence,
                    reasoning: candidate.reasoning,
                },
                adversary: {
                    score: adversaryScore,
                    reasoning: adversaryReasoning,
                },
                verdict,
                round,
            };
            allVotes.push(vote);

            if (verdict === "accept") {
                accepted.push(candidate.pattern);
            } else if (verdict === "debate") {
                debated.push(vote);
            } else {
                rejected.push(candidate.pattern);
            }
        }

        return { accepted, rejected, debated };
    }

    private async generateVariants(
        actionInfo: ActionInfo,
        existingPatterns: string[],
    ): Promise<GeneratorCandidate[]> {
        const prompt = buildGeneralizationPrompt(
            actionInfo,
            this.schemaInfo,
            existingPatterns,
            this.batchSize,
        );
        const response = await queryLLM(prompt, this.generatorModel);
        const parsed = parseJSONArray<GeneratorCandidate>(response);

        // Filter valid candidates and exclude duplicates of existing patterns
        const existingSet = new Set(existingPatterns);
        return parsed.filter(
            (c) =>
                c.pattern &&
                typeof c.pattern === "string" &&
                c.confidence >= 1 &&
                c.confidence <= 5 &&
                !existingSet.has(c.pattern),
        );
    }

    private async generateTargetedRepair(
        actionInfo: ActionInfo,
        existingPatterns: string[],
        missedCases: WarmingTestCase[],
    ): Promise<GeneratorCandidate[]> {
        const prompt = buildTargetedRepairPrompt(
            actionInfo,
            this.schemaInfo,
            existingPatterns,
            missedCases,
            this.batchSize,
        );
        const response = await queryLLM(prompt, this.generatorModel);
        const parsed = parseJSONArray<GeneratorCandidate>(response);

        const existingSet = new Set(existingPatterns);
        return parsed.filter(
            (c) =>
                c.pattern &&
                typeof c.pattern === "string" &&
                c.confidence >= 1 &&
                c.confidence <= 5 &&
                !existingSet.has(c.pattern),
        );
    }

    /**
     * Relaxed adjudication for generalization/repair phases.
     * Accepts patterns where generator >= 3 AND adversary >= 2 (instead of both >= 3).
     * Structural variants of already-vetted patterns deserve a lower bar.
     */
    private adjudicateRelaxed(
        candidates: GeneratorCandidate[],
        reviews: AdversaryReview[],
        actionName: string,
        round: number,
        allVotes: PatternVote[],
    ): {
        accepted: string[];
        rejected: string[];
        debated: PatternVote[];
    } {
        const accepted: string[] = [];
        const rejected: string[] = [];
        const debated: PatternVote[] = [];

        const reviewMap = new Map<string, AdversaryReview>();
        for (const r of reviews) {
            if (r.pattern) {
                reviewMap.set(r.pattern, r);
            }
        }

        for (const candidate of candidates) {
            const review = reviewMap.get(candidate.pattern);
            const adversaryScore = review?.score ?? 3;
            const adversaryReasoning = review?.reasoning ?? "no review";

            // Relaxed: accept if generator >= 3 AND adversary >= 2
            let verdict: "accept" | "reject" | "debate";
            if (candidate.confidence >= 3 && adversaryScore >= 2) {
                verdict = "accept";
            } else if (candidate.confidence < 2 || adversaryScore < 1) {
                verdict = "reject";
            } else {
                verdict = round >= this.maxDebateRounds ? "reject" : "debate";
            }

            const vote: PatternVote = {
                pattern: candidate.pattern,
                actionName,
                generator: {
                    score: candidate.confidence,
                    reasoning: candidate.reasoning,
                },
                adversary: {
                    score: adversaryScore,
                    reasoning: adversaryReasoning,
                },
                verdict,
                round,
            };
            allVotes.push(vote);

            if (verdict === "accept") {
                accepted.push(candidate.pattern);
            } else if (verdict === "debate") {
                debated.push(vote);
            } else {
                rejected.push(candidate.pattern);
            }
        }

        return { accepted, rejected, debated };
    }

    // ── Private: Helpers ─────────────────────────────────────────────────

    private findMissedCases(
        grammarText: string,
        testSet: WarmingTestCase[],
    ): WarmingTestCase[] {
        registerBuiltInEntities();
        const errors: string[] = [];
        const grammar = loadGrammarRulesNoThrow("warmer", grammarText, errors);
        if (!grammar) return testSet.filter((t) => t.isCommon);

        const nfa = compileGrammarToNFA(grammar);
        return testSet.filter((tc) => {
            if (!tc.isCommon) return false;
            const results = matchGrammarWithNFA(grammar, nfa, tc.request);
            return results.length === 0;
        });
    }
}
