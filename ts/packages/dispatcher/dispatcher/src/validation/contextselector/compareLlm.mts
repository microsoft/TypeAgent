// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// contextSelector vs the full LLM resolution path. The offline benchmark scores
// contextSelector against ground-truth labels; this harness answers a different
// question the ship decision needs: how does contextSelector's routing compare
// to what the STANDARD path would do with contextSelector OFF — i.e. the LLM
// disambiguating the collision?
//
// Two arms, same 250 labeled collisions:
//   - contextSelector: the real deterministic scorer (resolve to an agent, or
//     abstain -> falls through to the LLM).
//   - LLM-only (contextSelector OFF): the real `aiclient` model — the same LLM
//     the standard resolution path uses — picks the agent (or "unclear").
//
// The decision-relevant metrics per tier:
//   - LLM-only accuracy (the "contextSelector off" baseline).
//   - contextSelector-ON system accuracy (resolve -> its pick; abstain -> LLM).
//   - REGRESSIONS: contextSelector resolved WRONG where the LLM-off path would
//     have been right (the cost of turning it on).
//   - SAVINGS: correct contextSelector resolves — LLM calls avoided with the
//     right answer (the benefit).
//
// LLM responses are cached to llm-cache.json so the run is re-runnable and does
// not re-spend. Requires model config (config.local.yaml); NOT deterministic on
// a cold cache. Run: npx tsx src/validation/contextselector/compareLlm.mts [--out dir]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfigSync } from "../../../../../config/dist/index.js";
import { openai } from "../../../../../aiclient/dist/index.js";
import { loadRoster } from "./metricRoster.mjs";
import { resolveReportPath, upsertLlmSection } from "./reportFile.mjs";
import { SCENARIOS } from "./metricRealisticDialogue.mjs";
import { RingBufferSignalSource } from "../../context/contextSelector/conversationSignal.js";
import { TfIdfStrategy } from "../../context/contextSelector/strategy.js";
import { DecisionConfig } from "../../context/contextSelector/decision.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TS_ROOT = path.resolve(HERE, "..", "..", "..", "..", "..", "..");
const CACHE_PATH = path.join(HERE, "llm-cache.json");
const CFG: DecisionConfig = { minUniqueTokens: 2, minMass: 1.0, margin: 0.5 };

// Mirror production (session.ts negationGuard default on) so the CS-ON arm here
// matches the guarded scorer the main metrics use. CS_NEGATION_GUARD=0 replays
// the pre-guard baseline, consistent with metricRunner.
const NEGATION_GUARD = process.env.CS_NEGATION_GUARD !== "0";

// Concise, accurate one-liners for the featured agents so the LLM knows what
// each does (a stand-in for the schema/action descriptions the real translator
// sees).
const DESC: Record<string, string> = {
    player: "Streaming music player (Spotify-style): play/queue tracks, playlists, favorites, mixes.",
    localPlayer:
        "Local music player: play audio files stored on disk (mp3, flac, wav, ogg).",
    calendar:
        "Calendar: create events, meetings, appointments; invite participants.",
    timer: "Reminders & alarms: set timers, alarms, and pending notifications for tasks.",
    windowsClock:
        "Windows Clock app: stopwatch, countdown, world clock, timezones.",
    "code.code-debug":
        "Code editor/debugger: edit source files, fix bugs, manage breakpoints.",
    visualStudio:
        "Visual Studio debugger: break, inspect threads, call stack, variables, memory.",
    photo: "Camera/photos: take real photos, selfies, and snapshots with the camera.",
    image: "AI image generation: create illustrations, digital art, paintings, sketches.",
    "browser.external":
        "Web browser: open tabs, bookmarks, and history; navigate to websites.",
    utility:
        "Web-fetch utility: fetch raw HTML content from a URL or web resource.",
    powershell: "PowerShell: run scripts and shell commands.",
    taskflow:
        "Task-flow automation: run reusable task-flow templates and steps.",
    email: "Email: read/search the inbox, compose messages to recipients.",
    markdown:
        "Markdown documents: open and edit markdown docs, notes, and outlines.",
    list: "Lists: manage grocery/todo checklists, inventories, and items.",
    "github-cli":
        "GitHub CLI: manage repositories, caches, packages, and CI builds.",
    "desktop.desktop-taskbar":
        "Desktop taskbar settings: hide/show the taskbar, toolbar, and menus.",
    settings:
        "System display settings: monitor resolution and multi-monitor layout.",
    weather: "Weather: forecasts, current conditions, and storm alerts.",
    montage:
        "Photo montage: search a photo collection by tags, people, and location.",
    chat: "Chat: show or share image files, screenshots, and icons.",
};

type LlmChoice = "A" | "B" | "unclear";
type Cache = Record<string, { choice: LlmChoice; raw: string }>;

function loadCache(): Cache {
    try {
        return JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    } catch {
        return {};
    }
}

function buildPrompt(
    dialogue: string[],
    ask: string,
    aSchema: string,
    bSchema: string,
): string {
    const convo = dialogue.map((t, i) => `[${i + 1}] ${t}`).join("\n");
    return [
        "A user is talking to an assistant. Using the conversation so far, decide which of two agents should handle their final request.",
        "",
        "Conversation:",
        convo,
        `Final request: "${ask}"`,
        "",
        "Candidate agents:",
        `A) ${aSchema}: ${DESC[aSchema] ?? aSchema}`,
        `B) ${bSchema}: ${DESC[bSchema] ?? bSchema}`,
        "",
        'Judge what the user ACTUALLY wants — account for negation ("not X"), sarcasm, and words that are quoting someone else. If the conversation genuinely does not favor one agent over the other, answer "unclear".',
        'Respond ONLY with JSON of the form {"agent": "A"} or {"agent": "B"} or {"agent": "unclear"}.',
    ].join("\n");
}

function parseChoice(text: string): LlmChoice {
    try {
        const m = text.match(/\{[\s\S]*\}/);
        const obj = m ? JSON.parse(m[0]) : JSON.parse(text);
        const a = String(obj.agent).toLowerCase();
        if (a === "a") return "A";
        if (a === "b") return "B";
        return "unclear";
    } catch {
        const t = text.toLowerCase();
        if (t.includes('"a"') || /\bagent a\b/.test(t)) return "A";
        if (t.includes('"b"') || /\bagent b\b/.test(t)) return "B";
        return "unclear";
    }
}

async function main() {
    loadConfigSync({ workspaceRoot: TS_ROOT });
    const roster = loadRoster({ minVectorSize: 8 });
    const best = new Map<string, { schemaName: string; actionName: string }>();
    for (const a of roster.actions) {
        const cur = best.get(a.schemaName);
        if (
            cur === undefined ||
            roster.index.effective(a.schemaName, a.actionName).size >
                roster.index.effective(cur.schemaName, cur.actionName).size
        ) {
            best.set(a.schemaName, {
                schemaName: a.schemaName,
                actionName: a.actionName,
            });
        }
    }
    const strat = new TfIdfStrategy();
    const model = openai.createChatModel(
        undefined,
        { temperature: 0, response_format: { type: "json_object" } },
        undefined,
        ["cs-benchmark-compare"],
    );
    const cache = loadCache();

    // contextSelector's decision (offline).
    const csDecide = (s: (typeof SCENARIOS)[number]) => {
        const a = best.get(s.pair[0]);
        const b = best.get(s.pair[1]);
        if (!a || !b) return { kind: "abstain" as const };
        const sig = new RingBufferSignalSource(() => ({
            windowTurns: 20,
            decay: 0.9,
            negationGuard: NEGATION_GUARD,
        }));
        for (const t of s.dialogue) sig.recordRequest(t);
        const cands = [a, b].map((x) => ({
            schemaName: x.schemaName,
            actionName: x.actionName,
            keywords: roster.index.effective(x.schemaName, x.actionName),
        }));
        const { decision } = strat.evaluate(sig.getContextVector(), cands, CFG);
        return decision.kind === "resolve"
            ? { kind: "resolve" as const, schema: decision.winner.schemaName }
            : { kind: "abstain" as const };
    };

    let called = 0;
    const rows: {
        id: string;
        tier: string;
        goldKind: "resolve" | "abstain";
        goldSchema: string | undefined;
        cs: "resolve" | "abstain";
        csSchema: string | undefined;
        llm: string; // schema | "unclear"
    }[] = [];

    for (const s of SCENARIOS) {
        const tier = s.difficulty ?? "realistic";
        const aSchema = s.pair[0];
        const bSchema = s.pair[1];
        const goldSchema =
            s.expect.kind === "resolve" ? s.expect.target : undefined;

        // LLM arm (cached).
        let cached = cache[s.id];
        if (cached === undefined) {
            const prompt = buildPrompt(s.dialogue, s.ask, aSchema, bSchema);
            const r = await model.complete(prompt);
            const raw = r.success ? r.data : `ERROR: ${r.message}`;
            cached = { choice: r.success ? parseChoice(raw) : "unclear", raw };
            cache[s.id] = cached;
            called++;
            if (called % 10 === 0) {
                fs.writeFileSync(
                    CACHE_PATH,
                    JSON.stringify(cache, null, 2) + "\n",
                );
                process.stdout.write(`  …${called} LLM calls\n`);
            }
        }
        const llm =
            cached.choice === "A"
                ? aSchema
                : cached.choice === "B"
                  ? bSchema
                  : "unclear";

        const cs = csDecide(s);
        rows.push({
            id: s.id,
            tier,
            goldKind: s.expect.kind,
            goldSchema,
            cs: cs.kind,
            csSchema: cs.kind === "resolve" ? cs.schema : undefined,
            llm,
        });
    }
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + "\n");
    console.log(`LLM calls this run: ${called} (rest cached)\n`);

    // Routing-correct: for a resolve-gold, route to the target; for an
    // abstain-gold, do NOT commit (abstain / unclear).
    const committedTo = (arm: "cs" | "llm", r: (typeof rows)[number]) =>
        arm === "cs"
            ? r.cs === "resolve"
                ? r.csSchema
                : undefined
            : r.llm === "unclear"
              ? undefined
              : r.llm;
    const armCorrect = (arm: "cs" | "llm", r: (typeof rows)[number]) => {
        const committed = committedTo(arm, r);
        return r.goldKind === "resolve"
            ? committed === r.goldSchema
            : committed === undefined;
    };
    // contextSelector-ON system: resolve -> its pick; abstain -> the LLM.
    const onCorrect = (r: (typeof rows)[number]) =>
        r.cs === "resolve" ? armCorrect("cs", r) : armCorrect("llm", r);

    const tiers = ["simple", "realistic", "hard", "extra-hard"] as const;
    const tierName: Record<string, string> = {
        simple: "Simple",
        realistic: "Realistic",
        hard: "Hard",
        "extra-hard": "Adversarial",
    };
    const pct = (n: number, d: number) =>
        d === 0 ? "n/a" : `${((100 * n) / d).toFixed(0)}%`;

    console.log(
        "=== contextSelector vs full LLM resolution path (contextSelector OFF) ===\n",
    );
    const md: string[] = [];
    md.push("# contextSelector vs the LLM resolution path\n");
    md.push(
        `_Generated ${new Date().toISOString()} · 250 labeled collisions · LLM arm = real \`aiclient\` model (the standard path's LLM), temperature 0, cached._\n`,
    );
    md.push(
        "**Goal:** the report above shows contextSelector is safe and instant, but the dispatcher could instead just ask the LLM to resolve every collision. This section asks the shipping question head-on: versus letting the LLM decide, what does turning contextSelector on gain, and what does it cost? The same 250 labeled collisions are scored both ways.\n",
    );
    md.push(
        "**contextSelector OFF** = the collision falls through to the LLM, which picks the agent. **contextSelector ON** = contextSelector resolves it instantly, or abstains and falls through to the LLM. Routing is *correct* when it commits to the labeled agent (resolve cases) or correctly declines to commit (ambiguous cases). Every LLM answer is cached, so re-running is free and deterministic.\n",
    );
    md.push(
        "| Tier | LLM-only acc (CS off) | CS-ON system acc | CS resolves (LLM calls saved) | Regressions (CS wrong, LLM right) | Correct saves |",
    );
    md.push("| --- | --- | --- | --- | --- | --- |");

    for (const tier of tiers) {
        const set = rows.filter((r) => r.tier === tier);
        const n = set.length;
        const llmAcc = set.filter((r) => armCorrect("llm", r)).length;
        const onAcc = set.filter((r) => onCorrect(r)).length;
        const csResolves = set.filter((r) => r.cs === "resolve");
        const regressions = set.filter(
            (r) => !onCorrect(r) && armCorrect("llm", r),
        );
        const correctSaves = csResolves.filter((r) => armCorrect("cs", r));

        console.log(`${tierName[tier]} (${n}):`);
        console.log(
            `  LLM-only accuracy (CS off):  ${pct(llmAcc, n)} (${llmAcc}/${n})`,
        );
        console.log(
            `  CS-ON system accuracy:       ${pct(onAcc, n)} (${onAcc}/${n})`,
        );
        console.log(
            `  CS resolves (LLM calls saved): ${csResolves.length}  (correct: ${correctSaves.length})`,
        );
        console.log(
            `  Regressions (CS wrong, LLM would be right): ${regressions.length}` +
                (regressions.length
                    ? `  [${regressions.map((r) => r.id).join(", ")}]`
                    : ""),
        );
        console.log("");

        md.push(
            `| ${tierName[tier]} (${n}) | ${pct(llmAcc, n)} (${llmAcc}/${n}) | ${pct(onAcc, n)} (${onAcc}/${n}) | ${csResolves.length} | **${regressions.length}** | ${correctSaves.length} |`,
        );
    }

    md.push(
        "\n**How to read it.** *LLM-only accuracy* is the standard path with contextSelector off. *CS-ON system accuracy* is the deployed behavior (resolve, else fall through to the LLM). *Regressions* are the price of enabling contextSelector — collisions it resolves to the wrong agent that the LLM alone would have routed correctly. *Correct saves* are the payoff — right answers delivered without an LLM call.\n",
    );
    const reportPath = resolveReportPath();
    upsertLlmSection(reportPath, md.join("\n"));
    console.log(
        `Wrote LLM comparison into consolidated report:\n  ${reportPath}`,
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
