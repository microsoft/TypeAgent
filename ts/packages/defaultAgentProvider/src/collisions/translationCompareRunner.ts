// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Compare two translation-results JSON files (typically a baseline and a
// candidate run with userContext injected). Joins on phraseText +
// expectedSchema + expectedAction, classifies each phrase's transition,
// and writes a JSON join plus a self-contained HTML diff visualization.
//
// Read-only: this runner reads two JSON files, writes a JSON + an HTML.
// No LLM calls, no dispatcher spin-up.
//
// Usage (from ts/, after building):
//   node packages/defaultAgentProvider/dist/collisions/translationCompareRunner.js \
//     --baseline <path>/translation-results-baseline.json \
//     --candidate <path>/translation-results-with-context.json \
//     [--out-json <path>] [--out-html <path>]

import * as fs from "node:fs";
import * as path from "node:path";

import type {
    TranslationOutcome,
    TranslationProbeFile,
    TranslationProbeRow,
} from "agent-dispatcher/internal";

import {
    buildDiffPayload,
    buildTranslationDiffHTML,
    OUTCOMES,
    type DiffPayload,
} from "./translationDiffViz.js";

interface Args {
    baseline: string;
    candidate: string;
    outJson: string;
    outHtml: string;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const get = (name: string): string | undefined => {
        const i = argv.indexOf(`--${name}`);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const baseline = get("baseline");
    const candidate = get("candidate");
    if (!baseline || !candidate) {
        throw new Error(
            "Required: --baseline <path> --candidate <path>. Optional: --out-json, --out-html.",
        );
    }
    const dir = path.dirname(path.resolve(baseline));
    return {
        baseline: path.resolve(baseline),
        candidate: path.resolve(candidate),
        outJson: path.resolve(
            get("out-json") ?? path.join(dir, "translation-compare.json"),
        ),
        outHtml: path.resolve(
            get("out-html") ?? path.join(dir, "translation-compare.html"),
        ),
    };
}

function loadProbe(p: string): TranslationProbeFile {
    if (!fs.existsSync(p)) {
        throw new Error(`Probe file not found: ${p}`);
    }
    return JSON.parse(fs.readFileSync(p, "utf8")) as TranslationProbeFile;
}

function pad(s: string, n: number): string {
    return s.length >= n ? s : s + " ".repeat(n - s.length);
}

function printSummary(payload: DiffPayload): void {
    const total = payload.transitions.length;
    const baseCounts: Record<TranslationOutcome, number> =
        payload.baseline.summary.counts;
    const candCounts: Record<TranslationOutcome, number> =
        payload.candidate.summary.counts;
    process.stdout.write(
        `\n=== translation diff ===\n` +
            `baseline:  ${payload.baseline.path}  (userContextMode=${payload.baseline.summary.userContextMode})\n` +
            `candidate: ${payload.candidate.path}  (userContextMode=${payload.candidate.summary.userContextMode})\n` +
            `joined phrases: ${total}\n\n`,
    );

    process.stdout.write(`Overall outcomes (baseline / candidate):\n`);
    for (const o of OUTCOMES) {
        const b = baseCounts[o] ?? 0;
        const c = candCounts[o] ?? 0;
        const delta = c - b;
        const sign = delta > 0 ? "+" : "";
        process.stdout.write(
            `  ${pad(o, 9)} ${pad(b.toString(), 5)} → ${pad(c.toString(), 5)}  (${sign}${delta})\n`,
        );
    }

    process.stdout.write(
        `\nTransition matrix (baseline rows × candidate cols):\n`,
    );
    const header = `  ${pad("", 9)}${OUTCOMES.map((c) => pad(c, 9)).join("")}\n`;
    process.stdout.write(header);
    for (const r of OUTCOMES) {
        const cells = OUTCOMES.map((c) =>
            pad((payload.transitionMatrix[r]?.[c] ?? 0).toString(), 9),
        ).join("");
        process.stdout.write(`  ${pad(r, 9)}${cells}\n`);
    }

    let rescues = 0;
    let regressions = 0;
    for (const t of payload.transitions) {
        if (t.transitionClass === "rescue") rescues++;
        if (t.transitionClass === "regression") regressions++;
    }
    process.stdout.write(
        `\nRescues (anything → CLEAN): ${rescues}\n` +
            `Regressions (CLEAN → anything): ${regressions}\n` +
            `Net delta: ${rescues - regressions}\n`,
    );

    process.stdout.write(`\nTop schemas by net delta:\n`);
    const top = payload.bySchema.slice(0, 10);
    for (const s of top) {
        const net = s.rescued - s.regressed;
        const sign = net > 0 ? "+" : "";
        process.stdout.write(
            `  ${pad(s.schema, 30)} rescued=${pad(s.rescued.toString(), 3)} regressed=${pad(s.regressed.toString(), 3)} net=${sign}${net}\n`,
        );
    }

    process.stdout.write(`\nSample rescue phrases (up to 10):\n`);
    let shown = 0;
    for (const t of payload.transitions) {
        if (t.transitionClass !== "rescue") continue;
        const bChosen = t.baseline.chosenSchema
            ? `${t.baseline.chosenSchema}.${t.baseline.chosenAction}`
            : `(${t.baseline.outcome})`;
        const cChosen = t.candidate.chosenSchema
            ? `${t.candidate.chosenSchema}.${t.candidate.chosenAction}`
            : `(${t.candidate.outcome})`;
        process.stdout.write(
            `  "${t.phraseText}"  [${t.expectedSchema}.${t.expectedAction}]  ${bChosen} → ${cChosen}\n`,
        );
        shown++;
        if (shown >= 10) break;
    }
    process.stdout.write("\n");
}

function main(): void {
    const args = parseArgs();
    const baseline = loadProbe(args.baseline);
    const candidate = loadProbe(args.candidate);

    // buildDiffPayload expects a `results: readonly Row[]` shape — assert
    // here so callers see a clear error if the JSON files are malformed.
    if (!Array.isArray(baseline.results)) {
        throw new Error(
            `baseline ${args.baseline} has no 'results' array — is this a TranslationProbeFile?`,
        );
    }
    if (!Array.isArray(candidate.results)) {
        throw new Error(
            `candidate ${args.candidate} has no 'results' array — is this a TranslationProbeFile?`,
        );
    }

    const payload = buildDiffPayload(
        {
            path: args.baseline,
            summary: baseline.summary,
            results: baseline.results as readonly TranslationProbeRow[],
        },
        {
            path: args.candidate,
            summary: candidate.summary,
            results: candidate.results as readonly TranslationProbeRow[],
        },
    );

    fs.mkdirSync(path.dirname(args.outJson), { recursive: true });
    fs.writeFileSync(args.outJson, JSON.stringify(payload, null, 2));
    fs.writeFileSync(args.outHtml, buildTranslationDiffHTML(payload));

    printSummary(payload);
    process.stdout.write(`Wrote ${args.outJson}\nWrote ${args.outHtml}\n`);
}

try {
    main();
} catch (err) {
    process.stderr.write(
        `translation-compare-runner failed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
}
