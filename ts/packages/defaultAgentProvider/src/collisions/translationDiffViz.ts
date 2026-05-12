// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Self-contained HTML visualization for a translation diff: baseline run
// vs. candidate run (typically baseline = no user-context, candidate =
// expected-schema or fixed user-context).
//
// One static HTML file. No external CSS/JS. Visual style mirrors the
// existing visualization HTML in `collisionCorpusHandlers.ts` (monospace,
// `#888` greys, `#c44` reds, plus `#2a8` greens for rescues).

import type {
    TranslationOutcome,
    TranslationProbeSummary,
    UserContext,
} from "agent-dispatcher/internal";

export const OUTCOMES: TranslationOutcome[] = [
    "CLEAN",
    "MISROUTE",
    "CLARIFY",
    "INVALID",
    "ERROR",
];

export type TransitionClass =
    | "clean-stable"
    | "rescue"
    | "regression"
    | "still-broken"
    | "still-clarify"
    | "other";

export interface PhraseSourceTag {
    model: string;
    style: string;
}

export interface DiffTransitionRow {
    phraseText: string;
    expectedSchema: string;
    expectedAction: string;
    baseline: {
        outcome: TranslationOutcome;
        chosenSchema?: string;
        chosenAction?: string;
    };
    candidate: {
        outcome: TranslationOutcome;
        chosenSchema?: string;
        chosenAction?: string;
    };
    userContext?: UserContext;
    transitionClass: TransitionClass;
    /** The `(model, style)` provenance for the corpus phrase. Used by
     *  the HTML viz to power the per-source pill filter. */
    phraseSources: PhraseSourceTag[];
}

export interface DiffSchemaSummary {
    schema: string;
    baseline: Record<TranslationOutcome, number>;
    candidate: Record<TranslationOutcome, number>;
    rescued: number;
    regressed: number;
}

export interface DiffPayload {
    baseline: { path: string; summary: TranslationProbeSummary };
    candidate: { path: string; summary: TranslationProbeSummary };
    transitions: DiffTransitionRow[];
    transitionMatrix: Record<
        TranslationOutcome,
        Record<TranslationOutcome, number>
    >;
    bySchema: DiffSchemaSummary[];
}

function emptyOutcomeCounts(): Record<TranslationOutcome, number> {
    return { CLEAN: 0, MISROUTE: 0, CLARIFY: 0, INVALID: 0, ERROR: 0 };
}

export function classifyTransition(
    baseline: TranslationOutcome,
    candidate: TranslationOutcome,
): TransitionClass {
    if (baseline === "CLEAN" && candidate === "CLEAN") return "clean-stable";
    if (baseline !== "CLEAN" && candidate === "CLEAN") return "rescue";
    if (baseline === "CLEAN" && candidate !== "CLEAN") return "regression";
    if (baseline === "MISROUTE" && candidate === "MISROUTE")
        return "still-broken";
    if (baseline === "CLARIFY" && candidate === "CLARIFY")
        return "still-clarify";
    return "other";
}

function esc(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export function buildTranslationDiffHTML(payload: DiffPayload): string {
    // Distinct (style, model) values for the pill bar — sorted by count
    // descending so the most-populated source appears first. Styles and
    // models are independent filter dimensions (a row is included if it
    // has at least one source where both pills are enabled).
    const styleCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();
    for (const t of payload.transitions) {
        for (const s of t.phraseSources ?? []) {
            styleCounts.set(s.style, (styleCounts.get(s.style) ?? 0) + 1);
            modelCounts.set(s.model, (modelCounts.get(s.model) ?? 0) + 1);
        }
    }
    const styles = [...styleCounts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const models = [...modelCounts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );

    const head = `<!doctype html>
<html><head><meta charset="utf-8"/>
<title>Translation diff: baseline vs candidate</title>
<style>
    body { font: 13px system-ui, sans-serif; color: #222; max-width: 1100px; margin: 24px auto; padding: 0 16px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 24px 0 8px; color: #444; }
    code { font: 12px ui-monospace, monospace; background: #f5f5f5; padding: 1px 4px; border-radius: 3px; }
    .pillbar { margin: 12px 0 16px; }
    .pillbar-label { font: 11px system-ui, sans-serif; color: #666; text-transform: uppercase; letter-spacing: 0.04em; margin-right: 8px; }
    .pill { display: inline-block; padding: 3px 10px; margin: 2px 4px 2px 0; border: 1px solid #aaa; border-radius: 999px; background: #eef; color: #224; font: 12px ui-monospace, monospace; cursor: pointer; user-select: none; }
    .pill.off { background: #f5f5f5; color: #aaa; border-color: #ddd; text-decoration: line-through; }
    .pill .count { color: #888; font-size: 11px; margin-left: 4px; }
    .pillbar-buttons { display: inline-block; margin-left: 8px; font-size: 11px; }
    .pillbar-buttons a { color: #36a; cursor: pointer; text-decoration: underline; margin: 0 4px; }
    #filtered-count { color: #666; font: 12px ui-monospace, monospace; margin-bottom: 12px; }
</style>
</head><body>`;

    const subhead = `<div style="color:#666;font-size:12px;margin-bottom:18px;">
        baseline: <code>${esc(payload.baseline.path)}</code> &nbsp;·&nbsp;
        candidate: <code>${esc(payload.candidate.path)}</code><br/>
        baseline userContextMode: <code>${esc(payload.baseline.summary.userContextMode ?? "(unknown)")}</code> &nbsp;·&nbsp;
        candidate userContextMode: <code>${esc(payload.candidate.summary.userContextMode ?? "(unknown)")}</code>
    </div>`;

    const stylePills = styles
        .map(
            ([s, n]) =>
                `<span class="pill" data-kind="style" data-value="${esc(s)}">${esc(s)}<span class="count">${n}</span></span>`,
        )
        .join("");
    const modelPills = models
        .map(
            ([m, n]) =>
                `<span class="pill" data-kind="model" data-value="${esc(m)}">${esc(m)}<span class="count">${n}</span></span>`,
        )
        .join("");
    const pillsBlock = `
        <div class="pillbar">
            <span class="pillbar-label">style</span>${stylePills}
            <span class="pillbar-buttons">
                <a data-action="all" data-kind="style">all</a>·<a data-action="none" data-kind="style">none</a>·<a data-action="only-typos" data-kind="style">only typos</a>·<a data-action="no-typos" data-kind="style">no typos</a>
            </span>
        </div>
        <div class="pillbar">
            <span class="pillbar-label">model</span>${modelPills}
            <span class="pillbar-buttons">
                <a data-action="all" data-kind="model">all</a>·<a data-action="none" data-kind="model">none</a>
            </span>
        </div>
        <div id="filtered-count"></div>`;

    // Embed everything the JS needs to re-render. The bySchema array is
    // recomputed client-side from the filtered transitions (so it
    // reflects the active filter), so we don't need to embed it.
    const data = {
        transitions: payload.transitions,
        outcomes: OUTCOMES,
    };
    const dataScript = `<script>window.__DIFF_DATA__ = ${JSON.stringify(data)};</script>`;

    const containers = `
        <div id="tiles"></div>
        <h2>Transition matrix</h2>
        <div id="matrix"></div>
        <h2>Per-schema breakdown</h2>
        <div id="schema"></div>
        <h2>Sample phrases</h2>
        <div id="samples"></div>`;

    return (
        head +
        `<h1>Translation diff: baseline vs candidate</h1>` +
        subhead +
        pillsBlock +
        containers +
        dataScript +
        `<script>${diffVizClientScript()}</script>` +
        `</body></html>`
    );
}

/**
 * The inline browser script that reads `window.__DIFF_DATA__`, attaches
 * pill click handlers, filters transitions by (style, model), and
 * re-renders the tiles / transition matrix / per-schema table / sample
 * sections. Kept as a function returning a string so the TS source stays
 * editable; embedded verbatim into the HTML.
 *
 * Filter semantics: a row is included when its `phraseSources` array has
 * at least one source where BOTH the style pill AND the model pill are
 * enabled. Rows with no sources are always included (defensive — corpus
 * builds may omit them in legacy runs).
 */
function diffVizClientScript(): string {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return String.raw`
(function () {
    const DATA = window.__DIFF_DATA__;
    const TX = DATA.transitions;
    const OUTCOMES = DATA.outcomes;

    function esc(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }
    function pct(n, total) {
        if (total === 0) return "0.0%";
        return ((n / total) * 100).toFixed(1) + "%";
    }
    function colorForTransition(r, c) {
        if (r === c) return "#444";
        if (r !== "CLEAN" && c === "CLEAN") return "#2a8";
        if (r === "CLEAN" && c !== "CLEAN") return "#c44";
        return "#888";
    }
    function bgForTransition(r, c) {
        if (r === c) return "#f5f5f5";
        if (r !== "CLEAN" && c === "CLEAN") return "#e8f7ee";
        if (r === "CLEAN" && c !== "CLEAN") return "#fbe9e9";
        return "#fafafa";
    }
    function transitionLabel(t) {
        switch (t) {
            case "rescue": return "Rescues (anything → CLEAN)";
            case "regression": return "Regressions (CLEAN → anything)";
            case "still-broken": return "Still broken (MISROUTE → MISROUTE)";
            case "still-clarify": return "Still ambiguous (CLARIFY → CLARIFY)";
            case "clean-stable": return "Stable CLEAN";
            case "other": return "Other transitions";
        }
        return t;
    }

    function emptyCounts() {
        const o = {};
        for (const k of OUTCOMES) o[k] = 0;
        return o;
    }

    function tileHTML(label, value, color, sub) {
        return '<div style="display:inline-block;min-width:140px;margin:0 12px 12px 0;padding:10px 14px;border:1px solid #ddd;border-radius:6px;background:#fff;">' +
            '<div style="font:11px system-ui,sans-serif;color:#666;text-transform:uppercase;letter-spacing:0.04em;">' + esc(label) + '</div>' +
            '<div style="font:22px ui-monospace,monospace;color:' + color + ';margin-top:4px;">' + value + '</div>' +
            (sub ? '<div style="font:11px ui-monospace,monospace;color:#888;margin-top:2px;">' + esc(sub) + '</div>' : '') +
            '</div>';
    }

    function renderTiles(rows) {
        const total = rows.length;
        let rescues = 0, regressions = 0, stableClean = 0, stillBroken = 0;
        for (const t of rows) {
            if (t.transitionClass === "rescue") rescues++;
            else if (t.transitionClass === "regression") regressions++;
            else if (t.transitionClass === "clean-stable") stableClean++;
            else if (t.transitionClass === "still-broken") stillBroken++;
        }
        const netDelta = rescues - regressions;
        const netColor = netDelta > 0 ? "#2a8" : netDelta < 0 ? "#c44" : "#666";
        return tileHTML("Rescues", rescues, "#2a8", pct(rescues, total) + " of " + total) +
            tileHTML("Regressions", regressions, "#c44", pct(regressions, total) + " of " + total) +
            tileHTML("Net delta", netDelta, netColor, rescues + "↑ − " + regressions + "↓") +
            tileHTML("Stable CLEAN", stableClean, "#666") +
            tileHTML("Still broken", stillBroken, "#c44");
    }

    function renderMatrix(rows) {
        const total = rows.length;
        const matrix = {};
        for (const r of OUTCOMES) {
            matrix[r] = emptyCounts();
        }
        for (const t of rows) {
            matrix[t.baseline.outcome][t.candidate.outcome]++;
        }
        let html = '<table style="border-collapse:collapse;border:1px solid #ddd;">';
        html += '<tr><th style="text-align:left;padding:4px 8px;color:#666;font:11px system-ui,sans-serif;">baseline \\ candidate</th>';
        for (const c of OUTCOMES) {
            html += '<th style="padding:4px 8px;color:#666;font:11px system-ui,sans-serif;text-align:right;">' + c + '</th>';
        }
        html += '<th style="padding:4px 8px;color:#666;font:11px system-ui,sans-serif;text-align:right;">total</th></tr>';
        for (const r of OUTCOMES) {
            let rowTotal = 0;
            let cells = '';
            for (const c of OUTCOMES) {
                const v = matrix[r][c];
                rowTotal += v;
                cells += '<td style="padding:4px 8px;text-align:right;font:12px ui-monospace,monospace;color:' + colorForTransition(r, c) + ';background:' + bgForTransition(r, c) + ';">' + v + '<span style="color:#aaa;font-size:10px;"> ' + pct(v, total) + '</span></td>';
            }
            html += '<tr><th style="text-align:left;padding:4px 8px;color:' + colorForTransition(r, r) + ';font:12px ui-monospace,monospace;">' + r + '</th>' + cells +
                '<td style="padding:4px 8px;text-align:right;font:12px ui-monospace,monospace;color:#666;">' + rowTotal + '</td></tr>';
        }
        html += '</table>';
        return html;
    }

    function renderSchema(rows) {
        const map = new Map();
        for (const t of rows) {
            let s = map.get(t.expectedSchema);
            if (!s) {
                s = { schema: t.expectedSchema, baseline: emptyCounts(), candidate: emptyCounts(), rescued: 0, regressed: 0 };
                map.set(t.expectedSchema, s);
            }
            s.baseline[t.baseline.outcome]++;
            s.candidate[t.candidate.outcome]++;
            if (t.transitionClass === "rescue") s.rescued++;
            if (t.transitionClass === "regression") s.regressed++;
        }
        const arr = [...map.values()].sort((a, b) =>
            (b.rescued - b.regressed) - (a.rescued - a.regressed) ||
            a.schema.localeCompare(b.schema)
        );
        if (arr.length === 0) {
            return '<div style="font:12px system-ui,sans-serif;color:#888;">No per-schema data.</div>';
        }
        let html = '<table style="border-collapse:collapse;border:1px solid #ddd;width:100%;">';
        html += '<tr>' +
            '<th style="text-align:left;padding:4px 8px;color:#666;font:11px system-ui,sans-serif;">schema</th>' +
            '<th style="padding:4px 8px;color:#666;font:11px system-ui,sans-serif;text-align:right;">baseline CLEAN</th>' +
            '<th style="padding:4px 8px;color:#666;font:11px system-ui,sans-serif;text-align:right;">candidate CLEAN</th>' +
            '<th style="padding:4px 8px;color:#2a8;font:11px system-ui,sans-serif;text-align:right;">rescued</th>' +
            '<th style="padding:4px 8px;color:#c44;font:11px system-ui,sans-serif;text-align:right;">regressed</th>' +
            '<th style="padding:4px 8px;color:#666;font:11px system-ui,sans-serif;text-align:right;">net delta</th>' +
            '</tr>';
        for (const r of arr) {
            const delta = r.rescued - r.regressed;
            const deltaColor = delta > 0 ? "#2a8" : delta < 0 ? "#c44" : "#888";
            html += '<tr>' +
                '<td style="padding:4px 8px;font:12px ui-monospace,monospace;color:#222;">' + esc(r.schema) + '</td>' +
                '<td style="padding:4px 8px;text-align:right;font:12px ui-monospace,monospace;color:#666;">' + r.baseline.CLEAN + '</td>' +
                '<td style="padding:4px 8px;text-align:right;font:12px ui-monospace,monospace;color:#222;">' + r.candidate.CLEAN + '</td>' +
                '<td style="padding:4px 8px;text-align:right;font:12px ui-monospace,monospace;color:#2a8;">' + r.rescued + '</td>' +
                '<td style="padding:4px 8px;text-align:right;font:12px ui-monospace,monospace;color:#c44;">' + r.regressed + '</td>' +
                '<td style="padding:4px 8px;text-align:right;font:12px ui-monospace,monospace;color:' + deltaColor + ';">' + (delta > 0 ? "+" : "") + delta + '</td>' +
                '</tr>';
        }
        html += '</table>';
        return html;
    }

    function renderSamplesBlock(title, rows, color, limit) {
        if (rows.length === 0) return '';
        let items = '';
        const shown = rows.slice(0, limit);
        for (const r of shown) {
            const bChosen = r.baseline.chosenSchema
                ? r.baseline.chosenSchema + '.' + (r.baseline.chosenAction || '?')
                : '(' + r.baseline.outcome + ')';
            const cChosen = r.candidate.chosenSchema
                ? r.candidate.chosenSchema + '.' + (r.candidate.chosenAction || '?')
                : '(' + r.candidate.outcome + ')';
            const ctx = r.userContext && r.userContext.activeApp
                ? '  <span style="color:#888;">[ctx:' + esc(r.userContext.activeApp) + ']</span>'
                : '';
            const styles = (r.phraseSources || []).map(s => s.style).join(',');
            const styleTag = styles ? '  <span style="color:#aaa;font-size:10px;">[' + esc(styles) + ']</span>' : '';
            items += '<li style="padding:3px 0;border-bottom:1px dotted #eee;">' +
                '<span style="color:#222;">' + esc(r.phraseText) + '</span>' + ctx + styleTag + '<br/>' +
                '<span style="color:#888;font-size:11px;">expected ' + esc(r.expectedSchema) + '.' + esc(r.expectedAction) + ' · ' + esc(bChosen) + ' → ' + esc(cChosen) + '</span>' +
                '</li>';
        }
        const more = rows.length > limit
            ? '<div style="color:#888;font-size:11px;padding:6px 0;">… and ' + (rows.length - limit) + ' more</div>'
            : '';
        return '<details style="margin:6px 0;" open>' +
            '<summary style="color:' + color + ';font:12px system-ui,sans-serif;cursor:pointer;">' + esc(title) + ' <span style="color:#888;">(' + rows.length + ')</span></summary>' +
            '<ul style="list-style:none;padding:6px 0 0 12px;margin:0;font:12px ui-monospace,monospace;">' + items + more + '</ul>' +
            '</details>';
    }

    function renderSamples(rows) {
        const byClass = { "clean-stable": [], rescue: [], regression: [], "still-broken": [], "still-clarify": [], other: [] };
        for (const r of rows) byClass[r.transitionClass].push(r);
        return renderSamplesBlock(transitionLabel("rescue"), byClass.rescue, "#2a8", 20) +
            renderSamplesBlock(transitionLabel("regression"), byClass.regression, "#c44", 20) +
            renderSamplesBlock(transitionLabel("still-broken"), byClass["still-broken"], "#c44", 10) +
            renderSamplesBlock(transitionLabel("still-clarify"), byClass["still-clarify"], "#888", 10) +
            renderSamplesBlock(transitionLabel("other"), byClass.other, "#888", 10);
    }

    function activePills(kind) {
        const set = new Set();
        document.querySelectorAll('.pill[data-kind="' + kind + '"]').forEach(el => {
            if (!el.classList.contains('off')) set.add(el.dataset.value);
        });
        return set;
    }

    function applyFilter() {
        const styles = activePills('style');
        const models = activePills('model');
        // If the user disabled all pills in either dimension, treat that
        // as "match nothing" so the displayed counts are honest about the
        // intent (rather than silently passing every row through).
        const allowAll = styles.size === 0 && models.size === 0;
        const filtered = TX.filter(t => {
            if (allowAll) return false;
            const sources = t.phraseSources || [];
            if (sources.length === 0) {
                // Legacy rows without source provenance: include when at
                // least one pill in each dimension is enabled.
                return styles.size > 0 && models.size > 0;
            }
            return sources.some(s => styles.has(s.style) && models.has(s.model));
        });
        document.getElementById('tiles').innerHTML = renderTiles(filtered);
        document.getElementById('matrix').innerHTML = renderMatrix(filtered);
        document.getElementById('schema').innerHTML = renderSchema(filtered);
        document.getElementById('samples').innerHTML = renderSamples(filtered);
        document.getElementById('filtered-count').textContent =
            'showing ' + filtered.length + ' of ' + TX.length + ' phrases';
    }

    // Click handlers for individual pills.
    document.querySelectorAll('.pill').forEach(p => {
        p.addEventListener('click', () => {
            p.classList.toggle('off');
            applyFilter();
        });
    });

    // Click handlers for the all/none/only-typos/no-typos shortcut links.
    document.querySelectorAll('.pillbar-buttons a').forEach(a => {
        a.addEventListener('click', (e) => {
            e.preventDefault();
            const action = a.dataset.action;
            const kind = a.dataset.kind;
            const pills = document.querySelectorAll('.pill[data-kind="' + kind + '"]');
            pills.forEach(p => {
                const v = p.dataset.value;
                if (action === 'all') p.classList.remove('off');
                else if (action === 'none') p.classList.add('off');
                else if (action === 'only-typos') {
                    if (v === 'typos') p.classList.remove('off');
                    else p.classList.add('off');
                }
                else if (action === 'no-typos') {
                    if (v === 'typos') p.classList.add('off');
                    else p.classList.remove('off');
                }
            });
            applyFilter();
        });
    });

    // Initial render.
    applyFilter();
})();
`;
}

/**
 * Build the diff payload from a pair of probe-file shapes. Joins on
 * (phraseText, expectedSchema, expectedAction). Phrases unique to one
 * side are dropped — they signal corpus mismatch, not a translator
 * behavior change.
 */
export interface DiffInputRow {
    expectedSchema: string;
    expectedAction: string;
    phraseText: string;
    chosenSchema?: string | undefined;
    chosenAction?: string | undefined;
    outcome: TranslationOutcome;
    userContext?: UserContext | undefined;
    phraseSources?: PhraseSourceTag[] | undefined;
}

export function buildDiffPayload(
    baseline: {
        path: string;
        summary: TranslationProbeSummary;
        results: readonly DiffInputRow[];
    },
    candidate: {
        path: string;
        summary: TranslationProbeSummary;
        results: readonly DiffInputRow[];
    },
): DiffPayload {
    const keyOf = (r: {
        expectedSchema: string;
        expectedAction: string;
        phraseText: string;
    }) => `${r.expectedSchema}${r.expectedAction}${r.phraseText}`;

    const candidateByKey = new Map<string, (typeof candidate.results)[number]>();
    for (const r of candidate.results) {
        candidateByKey.set(keyOf(r), r);
    }

    const transitions: DiffTransitionRow[] = [];
    const matrix: Record<
        TranslationOutcome,
        Record<TranslationOutcome, number>
    > = {
        CLEAN: emptyOutcomeCounts(),
        MISROUTE: emptyOutcomeCounts(),
        CLARIFY: emptyOutcomeCounts(),
        INVALID: emptyOutcomeCounts(),
        ERROR: emptyOutcomeCounts(),
    };
    const bySchemaMap = new Map<string, DiffSchemaSummary>();
    const ensureSchema = (schema: string): DiffSchemaSummary => {
        let s = bySchemaMap.get(schema);
        if (!s) {
            s = {
                schema,
                baseline: emptyOutcomeCounts(),
                candidate: emptyOutcomeCounts(),
                rescued: 0,
                regressed: 0,
            };
            bySchemaMap.set(schema, s);
        }
        return s;
    };

    for (const b of baseline.results) {
        const c = candidateByKey.get(keyOf(b));
        if (!c) continue;
        const tc = classifyTransition(b.outcome, c.outcome);
        const baselineEntry: DiffTransitionRow["baseline"] = {
            outcome: b.outcome,
            ...(b.chosenSchema !== undefined && { chosenSchema: b.chosenSchema }),
            ...(b.chosenAction !== undefined && { chosenAction: b.chosenAction }),
        };
        const candidateEntry: DiffTransitionRow["candidate"] = {
            outcome: c.outcome,
            ...(c.chosenSchema !== undefined && { chosenSchema: c.chosenSchema }),
            ...(c.chosenAction !== undefined && { chosenAction: c.chosenAction }),
        };
        // Prefer the candidate's phraseSources (more recent provenance)
        // when both sides report them; fall back to baseline. Empty array
        // when both sides omit them so the JS filter has a deterministic
        // shape to read.
        const sources: PhraseSourceTag[] =
            c.phraseSources ?? b.phraseSources ?? [];
        transitions.push({
            phraseText: b.phraseText,
            expectedSchema: b.expectedSchema,
            expectedAction: b.expectedAction,
            baseline: baselineEntry,
            candidate: candidateEntry,
            transitionClass: tc,
            ...(c.userContext !== undefined && { userContext: c.userContext }),
            phraseSources: sources,
        });
        matrix[b.outcome][c.outcome]++;
        const s = ensureSchema(b.expectedSchema);
        s.baseline[b.outcome]++;
        s.candidate[c.outcome]++;
        if (tc === "rescue") s.rescued++;
        if (tc === "regression") s.regressed++;
    }

    const bySchema = [...bySchemaMap.values()].sort(
        (a, b) =>
            b.rescued - b.regressed - (a.rescued - a.regressed) ||
            a.schema.localeCompare(b.schema),
    );

    return {
        baseline: { path: baseline.path, summary: baseline.summary },
        candidate: { path: candidate.path, summary: candidate.summary },
        transitions,
        transitionMatrix: matrix,
        bySchema,
    };
}
