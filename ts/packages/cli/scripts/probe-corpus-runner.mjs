// Replay an LLM-generated phrase corpus through the dispatcher's
// embedding ranker (`semanticSearchActionSchema`) — same call path
// `@collision probe` uses, but invoked directly to avoid HTML parsing
// and to allow our own action-name comparison (corpus has the
// action-enum value, the probe handler displays the TypeScript type
// name; they need normalization to match).
//
// Verdicts per phrase:
//   - CLEAN     : top-1 == intended target AND Δ to #2 ≥ threshold
//   - TIGHT     : top-1 == intended target BUT Δ to #2 < threshold
//                 (runtime llmSelect would flag this as a collision)
//   - MISROUTE  : top-1 != intended target
//
// SAFETY: read-only context (no actions, no translation, no cache).
//
// Usage (from ts/):
//   node packages/cli/scripts/probe-corpus-runner.mjs \
//       [--corpus f:/tmp/corpus-sample.json] \
//       [--out    f:/tmp/probe-results.json] \
//       [--top    5] \
//       [--delta  0.05]

import { config as loadDotenv } from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoTsRoot = path.resolve(__dirname, "../../..");
loadDotenv({ path: path.join(repoTsRoot, ".env") });

import {
    initializeCommandHandlerContext,
    closeCommandHandlerContext,
} from "agent-dispatcher/internal";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import { getInstanceDir } from "agent-dispatcher/helpers/data";

// --- Args -------------------------------------------------------------------

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        corpus: "f:/tmp/corpus-sample.json",
        out: "f:/tmp/probe-results.json",
        top: 5,
        delta: 0.05,
    };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case "--corpus":
                opts.corpus = args[++i];
                break;
            case "--out":
                opts.out = args[++i];
                break;
            case "--top":
                opts.top = Number(args[++i]);
                break;
            case "--delta":
                opts.delta = Number(args[++i]);
                break;
            default:
                throw new Error(`Unknown argument: ${args[i]}`);
        }
    }
    return opts;
}

const OPTS = parseArgs();

// --- Helpers ----------------------------------------------------------------

const noop = () => {};
const noopAsync = async () => {};
const stubClientIO = {
    clear: noop, exit: noop, shutdown: noop,
    setUserRequest: noop, setDisplayInfo: noop,
    setDisplay: noop, appendDisplay: noop, appendDiagnosticData: noop,
    setDynamicDisplay: noop,
    question: async () => 0, proposeAction: async () => undefined,
    notify: noop, openLocalView: noopAsync, closeLocalView: noopAsync,
    requestChoice: noop, requestInteraction: noop,
    interactionResolved: noop, interactionCancelled: noop,
    takeAction: noop,
};

/**
 * Normalize an action identifier for comparison.  The semantic-map
 * entry's `definition.name` is the TypeScript type name (e.g.
 * `PlayTrackAction`) while the corpus uses the action-enum value
 * (`playTrack`).  Lowercase + drop trailing "action" makes them
 * equivalent.
 */
function normalizeAction(s) {
    let n = String(s).toLowerCase();
    if (n.endsWith("action")) n = n.slice(0, -"action".length);
    return n;
}

function actionsMatch(s1, a1, s2, a2) {
    return s1 === s2 && normalizeAction(a1) === normalizeAction(a2);
}

function classify(top1Match, deltaToNext, threshold) {
    if (!top1Match) return "MISROUTE";
    if (deltaToNext === undefined || deltaToNext < threshold) return "TIGHT";
    return "CLEAN";
}

function pad(s, n) {
    s = String(s);
    return s.length >= n ? s : s + " ".repeat(n - s.length);
}

// --- Run --------------------------------------------------------------------

async function main() {
    process.stderr.write(`Loading corpus from ${OPTS.corpus}…\n`);
    const corpus = JSON.parse(fs.readFileSync(OPTS.corpus, "utf8"));

    const tasks = [];
    for (const action of corpus.actions) {
        for (const phrase of action.phrases) {
            tasks.push({
                schemaName: action.schemaName,
                actionName: action.actionName,
                description: action.description,
                phraseText: phrase.text,
                phraseSources: phrase.sources,
            });
        }
    }
    process.stderr.write(
        `Corpus has ${tasks.length} unique phrase(s) across ${corpus.actions.length} action(s).\n`,
    );

    const instanceDir = getInstanceDir();
    const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
    const defaultConstructionProvider = getDefaultConstructionProvider();
    const indexingServiceRegistry =
        await getIndexingServiceRegistry(instanceDir);

    process.stderr.write(
        "Initializing command handler context (read-only)…\n",
    );
    const context = await initializeCommandHandlerContext(
        "probe-corpus-runner",
        {
            appAgentProviders: defaultAppAgentProviders,
            agents: { actions: false, commands: ["dispatcher"] },
            translation: { enabled: false },
            explainer: { enabled: false },
            cache: { enabled: false },
            constructionProvider: defaultConstructionProvider,
            indexingServiceRegistry,
            clientIO: stubClientIO,
        },
    );
    process.stderr.write("Context ready — semantic map loaded.\n\n");

    const results = [];
    const t0 = Date.now();
    for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        try {
            // Same call path llmSelect uses.  filter=()=>true so we don't
            // exclude inactive schemas (the dispatcher we boot here has
            // most agents inactive by default).
            const ranking = await context.agents.semanticSearchActionSchema(
                t.phraseText,
                OPTS.top,
                () => true,
            );
            const rows = (ranking ?? []).map((r) => ({
                schemaName: r.item.actionSchemaFile.schemaName,
                actionName: r.item.definition.name,
                score: r.score,
            }));
            for (let k = 0; k < rows.length - 1; k++) {
                rows[k].deltaToNext = rows[k].score - rows[k + 1].score;
            }
            const top1 = rows[0];
            const top1MatchesExpected =
                top1 !== undefined &&
                actionsMatch(
                    top1.schemaName,
                    top1.actionName,
                    t.schemaName,
                    t.actionName,
                );
            const verdict = classify(
                top1MatchesExpected,
                top1?.deltaToNext,
                OPTS.delta,
            );
            results.push({
                schemaName: t.schemaName,
                actionName: t.actionName,
                phraseText: t.phraseText,
                phraseSources: t.phraseSources,
                rows,
                top1: top1
                    ? { ...top1, matchesExpected: top1MatchesExpected }
                    : undefined,
                verdict,
            });
        } catch (err) {
            results.push({
                schemaName: t.schemaName,
                actionName: t.actionName,
                phraseText: t.phraseText,
                phraseSources: t.phraseSources,
                error: String(err),
                verdict: "ERROR",
            });
        }
        if ((i + 1) % 25 === 0 || i + 1 === tasks.length) {
            process.stderr.write(`  [${i + 1}/${tasks.length}]\n`);
        }
    }
    const elapsedMs = Date.now() - t0;
    process.stderr.write(
        `\nProbed ${tasks.length} phrase(s) in ${(elapsedMs / 1000).toFixed(1)}s.\n`,
    );

    await closeCommandHandlerContext(context);

    // ---- Aggregate ----------------------------------------------------------

    const counts = { CLEAN: 0, TIGHT: 0, MISROUTE: 0, ERROR: 0 };
    const perAction = new Map();
    const perModel = new Map();
    const perStyle = new Map();
    const misrouteEdges = new Map();

    for (const r of results) {
        counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;

        const aKey = `${r.schemaName}.${r.actionName}`;
        const aRow = perAction.get(aKey) ?? {
            schemaName: r.schemaName,
            actionName: r.actionName,
            CLEAN: 0, TIGHT: 0, MISROUTE: 0, ERROR: 0, total: 0,
        };
        aRow[r.verdict] = (aRow[r.verdict] ?? 0) + 1;
        aRow.total++;
        perAction.set(aKey, aRow);

        for (const src of r.phraseSources ?? []) {
            const mRow = perModel.get(src.model) ?? {
                model: src.model,
                CLEAN: 0, TIGHT: 0, MISROUTE: 0, ERROR: 0, total: 0,
            };
            mRow[r.verdict] = (mRow[r.verdict] ?? 0) + 1;
            mRow.total++;
            perModel.set(src.model, mRow);

            const sRow = perStyle.get(src.style) ?? {
                style: src.style,
                CLEAN: 0, TIGHT: 0, MISROUTE: 0, ERROR: 0, total: 0,
            };
            sRow[r.verdict] = (sRow[r.verdict] ?? 0) + 1;
            sRow.total++;
            perStyle.set(src.style, sRow);
        }

        if (r.verdict === "MISROUTE" && r.top1) {
            const key = `${r.schemaName}.${r.actionName} → ${r.top1.schemaName}.${r.top1.actionName}`;
            misrouteEdges.set(key, (misrouteEdges.get(key) ?? 0) + 1);
        }
    }

    const summary = {
        scannedAt: new Date().toISOString(),
        corpus: OPTS.corpus,
        elapsedMs,
        delta: OPTS.delta,
        top: OPTS.top,
        totalPhrases: tasks.length,
        counts,
        perAction: Array.from(perAction.values()).sort(
            (a, b) =>
                b.MISROUTE + b.TIGHT - (a.MISROUTE + a.TIGHT) ||
                a.actionName.localeCompare(b.actionName),
        ),
        perModel: Array.from(perModel.values()),
        perStyle: Array.from(perStyle.values()),
        misrouteEdges: Array.from(misrouteEdges.entries())
            .map(([edge, count]) => ({ edge, count }))
            .sort((a, b) => b.count - a.count),
    };
    fs.writeFileSync(OPTS.out, JSON.stringify({ summary, results }, null, 2));

    // ---- Stdout summary -----------------------------------------------------

    const total = tasks.length;
    const pct = (n) =>
        total === 0 ? "0.0%" : ((n / total) * 100).toFixed(1) + "%";
    process.stdout.write(
        `\n${total} phrase(s) probed (delta=${OPTS.delta}):\n`,
    );
    process.stdout.write(`  CLEAN   : ${counts.CLEAN} (${pct(counts.CLEAN)})\n`);
    process.stdout.write(
        `  TIGHT   : ${counts.TIGHT} (${pct(counts.TIGHT)})  — top-1 correct but llmSelect would flag\n`,
    );
    process.stdout.write(
        `  MISROUTE: ${counts.MISROUTE} (${pct(counts.MISROUTE)})  — top-1 wrong\n`,
    );
    if (counts.ERROR > 0) {
        process.stdout.write(
            `  ERROR   : ${counts.ERROR} (${pct(counts.ERROR)})\n`,
        );
    }

    process.stdout.write(`\nPer-action verdict counts:\n`);
    process.stdout.write(
        `  ${pad("ACTION", 50)} ${pad("CLEAN", 6)} ${pad("TIGHT", 6)} ${pad("MISROUTE", 9)} ${pad("ERR", 4)}\n`,
    );
    for (const r of summary.perAction) {
        process.stdout.write(
            `  ${pad(r.schemaName + "." + r.actionName, 50)} ${pad(r.CLEAN, 6)} ${pad(r.TIGHT, 6)} ${pad(r.MISROUTE, 9)} ${pad(r.ERROR, 4)}\n`,
        );
    }

    process.stdout.write(`\nPer-source-model verdict counts:\n`);
    process.stdout.write(
        `  ${pad("MODEL", 18)} ${pad("CLEAN", 6)} ${pad("TIGHT", 6)} ${pad("MISROUTE", 9)} ${pad("ERR", 4)}\n`,
    );
    for (const r of summary.perModel.sort((a, b) =>
        a.model.localeCompare(b.model),
    )) {
        process.stdout.write(
            `  ${pad(r.model, 18)} ${pad(r.CLEAN, 6)} ${pad(r.TIGHT, 6)} ${pad(r.MISROUTE, 9)} ${pad(r.ERROR, 4)}\n`,
        );
    }

    process.stdout.write(`\nPer-style verdict counts:\n`);
    process.stdout.write(
        `  ${pad("STYLE", 16)} ${pad("CLEAN", 6)} ${pad("TIGHT", 6)} ${pad("MISROUTE", 9)} ${pad("ERR", 4)}\n`,
    );
    for (const r of summary.perStyle.sort((a, b) =>
        a.style.localeCompare(b.style),
    )) {
        process.stdout.write(
            `  ${pad(r.style, 16)} ${pad(r.CLEAN, 6)} ${pad(r.TIGHT, 6)} ${pad(r.MISROUTE, 9)} ${pad(r.ERROR, 4)}\n`,
        );
    }

    if (summary.misrouteEdges.length > 0) {
        process.stdout.write(
            `\nMisroute edges (top-20, expected → actual):\n`,
        );
        for (const e of summary.misrouteEdges.slice(0, 20)) {
            process.stdout.write(`  ${pad(e.count, 4)} ${e.edge}\n`);
        }
    }

    process.stdout.write(`\nWrote results to ${OPTS.out}\n`);
}

main().catch((err) => {
    process.stderr.write(`probe-corpus-runner failed: ${err?.stack ?? err}\n`);
    process.exit(1);
});
