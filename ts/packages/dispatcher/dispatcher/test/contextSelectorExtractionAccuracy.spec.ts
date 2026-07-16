// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Extraction-ACCURACY benchmark for the context signal (design §7-8): 50 labeled
// cases measuring how often the extractor lands on exactly the expected canonical
// tokens — the words the scorer will actually see — while dropping the glue it
// should. Each case pins the tokens that MUST appear in the ContextVector
// (`present`) and the tokens that must NOT (`absent`, e.g. stopwords, generic
// verbs, plural surface forms, or negated content when the guard is on). A case
// counts as a correct extraction only when every `present` token is in the vector
// AND no `absent` token is. The suite runs each case as its own test and reports
// the aggregate extraction accuracy over all 50.
//
// This exercises the real RingBufferSignalSource + tokenize as one unit; the
// per-behavior specs (contextSelectorTokenize / contextSelectorSignal /
// contextSelectorExtraction) pin the arithmetic in isolation. Deterministic,
// offline, no LLM.

import {
    RingBufferSignalSource,
    ContextVector,
} from "../src/context/contextSelector/conversationSignal.js";

type ExtractCase = {
    id: string;
    category: string;
    turns: string[];
    // Canonical tokens the extractor MUST surface.
    present: string[];
    // Tokens the extractor MUST drop (glue / verbs / surface plurals / negated).
    absent: string[];
    windowTurns?: number;
    decay?: number;
    negationGuard?: boolean;
};

function extract(c: ExtractCase): ContextVector {
    const s = new RingBufferSignalSource(() => ({
        windowTurns: c.windowTurns ?? 20,
        decay: c.decay ?? 0.9,
        negationGuard: c.negationGuard ?? false,
    }));
    for (const turn of c.turns) {
        s.recordRequest(turn);
    }
    return s.getContextVector();
}

// A case is "correctly extracted" iff every expected token is present and every
// forbidden token is absent.
function isCorrect(c: ExtractCase): boolean {
    const v = extract(c);
    return (
        c.present.every((t) => (v.get(t) ?? 0) > 0) &&
        c.absent.every((t) => (v.get(t) ?? 0) === 0)
    );
}

const CASES: ExtractCase[] = [
    // --- topical extraction: content nouns kept, glue dropped ---
    {
        id: "topic-budget-sheet",
        category: "topical",
        turns: ["please open the budget spreadsheet"],
        present: ["budget", "spreadsheet"],
        absent: ["please", "open", "the"],
    },
    {
        id: "topic-formula-cell",
        category: "topical",
        turns: ["edit the formula in that cell"],
        present: ["formula", "cell"],
        absent: ["edit", "in", "that"],
    },
    {
        id: "topic-pivot-chart",
        category: "topical",
        turns: ["show me the pivot chart"],
        present: ["pivot", "chart"],
        absent: ["show", "me", "the"],
    },
    {
        id: "topic-meeting",
        category: "topical",
        turns: ["schedule the team meeting for tomorrow"],
        present: ["team", "meeting", "tomorrow"],
        absent: ["the", "for"],
    },
    {
        id: "topic-email-marketing",
        category: "topical",
        turns: ["draft an email to the marketing group"],
        present: ["email", "marketing", "group"],
        absent: ["an", "to", "the"],
    },
    {
        id: "topic-playlist-song",
        category: "topical",
        turns: ["play the next song on my playlist"],
        present: ["song", "playlist"],
        absent: ["the", "on", "my"],
    },
    {
        id: "topic-flight",
        category: "topical",
        turns: ["book a flight to boston"],
        present: ["flight", "boston"],
        absent: ["a", "to"],
    },
    {
        id: "topic-invoice",
        category: "topical",
        turns: ["the invoice from the vendor is overdue"],
        present: ["invoice", "vendor", "overdue"],
        absent: ["the", "from", "is"],
    },
    {
        id: "topic-weather",
        category: "topical",
        turns: ["the weather forecast for the weekend"],
        present: ["weather", "forecast", "weekend"],
        absent: ["the", "for"],
    },
    {
        id: "topic-recipe",
        category: "topical",
        turns: ["the recipe needs garlic and butter"],
        present: ["recipe", "garlic", "butter"],
        absent: ["the", "and", "need"],
    },

    // --- multi-turn presence / accumulation ---
    {
        id: "multiturn-carry",
        category: "multi-turn",
        turns: [
            "open the budget spreadsheet",
            "edit the formula",
            "check the pivot chart",
        ],
        present: ["budget", "spreadsheet", "formula", "pivot", "chart"],
        absent: ["open", "edit", "the"],
    },
    {
        id: "multiturn-accumulate",
        category: "multi-turn",
        turns: ["spreadsheet work", "the spreadsheet", "spreadsheet again"],
        present: ["spreadsheet"],
        absent: ["the"],
    },
    {
        id: "multiturn-two-topics",
        category: "multi-turn",
        turns: ["the calendar meeting", "the spreadsheet formula"],
        present: ["calendar", "meeting", "spreadsheet", "formula"],
        absent: ["the"],
    },
    {
        id: "multiturn-email-thread",
        category: "multi-turn",
        turns: ["reply to the email", "forward the attachment"],
        present: ["email", "attachment"],
        absent: ["to", "the"],
    },
    {
        id: "multiturn-shopping",
        category: "multi-turn",
        turns: ["the grocery list", "the recipe ingredients"],
        present: ["grocery", "list", "recipe", "ingredient"],
        absent: ["the", "ingredients"],
    },

    // --- plural stemming: surface plural dropped, singular key present ---
    {
        id: "stem-vampire-coffin",
        category: "stemming",
        turns: ["the vampires need coffins"],
        present: ["vampire", "coffin"],
        absent: ["vampires", "coffins", "need"],
    },
    {
        id: "stem-items-lists",
        category: "stemming",
        turns: ["add these items to my lists"],
        present: ["item", "list"],
        absent: ["items", "lists", "add"],
    },
    {
        id: "stem-cells-columns",
        category: "stemming",
        turns: ["update the cells in the columns"],
        present: ["cell", "column"],
        absent: ["cells", "columns", "update"],
    },
    {
        id: "stem-rows-tables",
        category: "stemming",
        turns: ["sort the rows and tables"],
        present: ["row", "table"],
        absent: ["rows", "tables", "and"],
    },
    {
        id: "stem-boxes-glasses",
        category: "stemming",
        turns: ["the boxes hold the glasses"],
        present: ["box", "glass"],
        absent: ["boxes", "glasses"],
    },
    {
        id: "stem-watches-dishes",
        category: "stemming",
        turns: ["the watches and the dishes"],
        present: ["watch", "dish"],
        absent: ["watches", "dishes"],
    },
    {
        id: "stem-contacts-reminders",
        category: "stemming",
        turns: ["sync my contacts and reminders"],
        present: ["contact", "reminder"],
        absent: ["contacts", "reminders"],
    },

    // --- tokenization robustness ---
    {
        id: "token-punct-emoji",
        category: "tokenization",
        turns: ["SPREADSHEET!!! the FORMULA??? 📊💰"],
        present: ["spreadsheet", "formula"],
        absent: ["the"],
    },
    {
        id: "token-csharp-macro",
        category: "tokenization",
        turns: ["debug the C# macro"],
        present: ["c#", "macro"],
        absent: ["the"],
    },
    {
        id: "token-cellref",
        category: "tokenization",
        turns: ["highlight the A1:B2 range"],
        present: ["a1:b2", "range"],
        absent: ["the"],
    },
    {
        id: "token-cpp",
        category: "tokenization",
        turns: ["compile the C++ module"],
        present: ["c++", "module"],
        absent: ["the"],
    },
    {
        id: "token-casing",
        category: "tokenization",
        turns: ["The BUDGET Spreadsheet"],
        present: ["budget", "spreadsheet"],
        absent: ["the"],
    },
    {
        id: "token-friends-plural",
        category: "tokenization",
        turns: ["movie night with friends"],
        present: ["movie", "night", "friend"],
        absent: ["with", "friends"],
    },

    // --- glue rejection: turns that must yield no (or only glue-free) signal ---
    {
        id: "glue-all-stopwords",
        category: "glue",
        turns: ["the it is on to for"],
        present: [],
        absent: ["the", "it", "is", "on", "to", "for"],
    },
    {
        id: "glue-all-verbs",
        category: "glue",
        turns: ["add show get open update"],
        present: [],
        absent: ["add", "show", "get", "open", "update"],
    },
    {
        id: "glue-connectors",
        category: "glue",
        turns: ["and or but so than too"],
        present: [],
        absent: ["and", "or", "but", "so", "than", "too"],
    },
    {
        id: "glue-polite-filler",
        category: "glue",
        turns: ["please could you just do this for me now"],
        present: [],
        absent: ["please", "could", "you", "just", "do", "this", "for", "me"],
    },
    {
        id: "glue-let-me",
        category: "glue",
        turns: ["let me just do that"],
        present: [],
        absent: ["let", "me", "just", "do", "that"],
    },

    // --- window eviction: tokens outside the look-back window drop out ---
    {
        id: "window-evict-5",
        category: "window",
        turns: [
            "topic0",
            "topic1",
            "topic2",
            "topic3",
            "topic4",
            "topic5",
            "topic6",
            "topic7",
        ],
        windowTurns: 5,
        present: ["topic3", "topic7"],
        absent: ["topic0", "topic1", "topic2"],
    },
    {
        id: "window-evict-3",
        category: "window",
        turns: ["alpha", "beta", "gamma", "delta"],
        windowTurns: 3,
        present: ["beta", "gamma", "delta"],
        absent: ["alpha"],
    },
    {
        id: "window-topic-shift",
        category: "window",
        turns: [
            "the calendar meeting",
            "the calendar meeting",
            "the calendar meeting",
            "the spreadsheet formula",
        ],
        windowTurns: 1,
        present: ["spreadsheet", "formula"],
        absent: ["calendar", "meeting"],
    },

    // --- generic-verb dropping: the CRUD verb goes, the object stays ---
    {
        id: "verb-create-document",
        category: "generic-verb",
        turns: ["create a new document"],
        present: ["document"],
        absent: ["create", "new", "a"],
    },
    {
        id: "verb-delete-files",
        category: "generic-verb",
        turns: ["delete the old files"],
        present: ["old", "file"],
        absent: ["delete", "the", "files"],
    },
    {
        id: "verb-save-close",
        category: "generic-verb",
        turns: ["save and close the window"],
        present: ["window"],
        absent: ["save", "close", "and"],
    },
    {
        id: "verb-run-report",
        category: "generic-verb",
        turns: ["run the quarterly report"],
        present: ["quarterly", "report"],
        absent: ["run", "the"],
    },
    {
        id: "verb-select-cells",
        category: "generic-verb",
        turns: ["select the highlighted cells"],
        present: ["highlighted", "cell"],
        absent: ["select", "the", "cells"],
    },

    // --- negation guard ON: negated content is suppressed, resets recover it ---
    {
        id: "neg-not-spreadsheet",
        category: "negation-guard",
        turns: ["do not open the spreadsheet"],
        negationGuard: true,
        present: [],
        absent: ["spreadsheet"],
    },
    {
        id: "neg-no-pivot",
        category: "negation-guard",
        turns: ["no pivot chart"],
        negationGuard: true,
        present: [],
        absent: ["pivot", "chart"],
    },
    {
        id: "neg-reset-but",
        category: "negation-guard",
        turns: ["not the calendar but the spreadsheet"],
        negationGuard: true,
        present: ["spreadsheet"],
        absent: ["calendar"],
    },
    {
        id: "neg-clause-comma",
        category: "negation-guard",
        turns: ["no problem, open the sheet"],
        negationGuard: true,
        present: ["sheet"],
        absent: ["problem"],
    },
    {
        id: "neg-never-invoice",
        category: "negation-guard",
        turns: ["never delete the invoice"],
        negationGuard: true,
        present: [],
        absent: ["invoice"],
    },

    // --- mixed realistic conversations ---
    {
        id: "mixed-spreadsheet-vs-calendar",
        category: "mixed",
        turns: [
            "let's review the spreadsheet formula",
            "then update the calendar meeting",
        ],
        present: ["spreadsheet", "formula", "calendar", "meeting"],
        absent: ["the", "then", "update"],
    },
    {
        id: "mixed-travel",
        category: "mixed",
        turns: ["book the hotel", "reserve the rental car"],
        present: ["hotel", "rental", "car"],
        absent: ["the"],
    },
    {
        id: "mixed-music",
        category: "mixed",
        turns: ["queue the jazz album", "skip to the next track"],
        present: ["jazz", "album", "track"],
        absent: ["the", "to"],
    },
    {
        id: "mixed-devtools",
        category: "mixed",
        turns: ["open the terminal", "run the C# build script"],
        present: ["terminal", "c#", "build", "script"],
        absent: ["open", "run", "the"],
    },
];

const N = 50;

describe("contextSelector/extraction-accuracy — per-case correctness", () => {
    it(`has exactly ${N} labeled cases with unique ids`, () => {
        expect(CASES).toHaveLength(N);
        expect(new Set(CASES.map((c) => c.id)).size).toBe(N);
    });

    it.each(CASES.map((c) => [c.id, c] as const))(
        "extracts expected tokens for %s",
        (_id, c) => {
            const v = extract(c);
            for (const token of c.present) {
                expect(v.get(token) ?? 0).toBeGreaterThan(0);
            }
            for (const token of c.absent) {
                expect(v.get(token) ?? 0).toBe(0);
            }
        },
    );
});

describe("contextSelector/extraction-accuracy — aggregate benchmark", () => {
    it("reports the corpus-level extraction accuracy", () => {
        const correct = CASES.filter(isCorrect).length;
        const accuracy = correct / CASES.length;
        const byCategory = new Map<
            string,
            { correct: number; total: number }
        >();
        for (const c of CASES) {
            const bucket = byCategory.get(c.category) ?? {
                correct: 0,
                total: 0,
            };
            bucket.total++;
            if (isCorrect(c)) {
                bucket.correct++;
            }
            byCategory.set(c.category, bucket);
        }
        const perCat = [...byCategory.entries()]
            .map(([k, v]) => `${k} ${v.correct}/${v.total}`)
            .join(", ");
        // eslint-disable-next-line no-console
        console.log(
            `context extraction accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${CASES.length}) — ${perCat}`,
        );
        // The corpus is authored to the extractor's correct behavior, so a
        // regression in tokenize/stemming/windowing/negation drops this below 1.
        expect(accuracy).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Multi-turn extraction: 25 conversations spanning 3-9 turns. These exercise the
// signal source's cross-turn behavior — accumulation, recency ordering, topic
// persistence within the window, topic-shift eviction, multi-topic interleaving,
// stemming across turns, and negation scope per turn — which the single-turn
// corpus above cannot.
// ---------------------------------------------------------------------------
const MULTITURN_CASES: ExtractCase[] = [
    {
        id: "mt-accumulate-spreadsheet",
        category: "mt-accumulate",
        turns: [
            "spreadsheet edits",
            "more spreadsheet work",
            "the spreadsheet",
        ],
        present: ["spreadsheet"],
        absent: ["the", "edit"],
    },
    {
        id: "mt-accumulate-invoice",
        category: "mt-accumulate",
        turns: ["review the invoice", "the invoice again", "invoice total"],
        present: ["invoice", "total"],
        absent: ["the"],
    },
    {
        id: "mt-accumulate-budget",
        category: "mt-accumulate",
        turns: ["budget planning", "budget review", "final budget"],
        present: ["budget", "final"],
        absent: [],
    },
    {
        id: "mt-persist-three",
        category: "mt-persistence",
        turns: [
            "open the budget spreadsheet",
            "add a formula",
            "insert a chart",
        ],
        present: ["budget", "spreadsheet", "formula", "chart"],
        absent: ["add", "insert", "the"],
    },
    {
        id: "mt-persist-glue",
        category: "mt-persistence",
        turns: ["the budget report", "please do that", "just show me"],
        present: ["budget", "report"],
        absent: ["please", "do", "just", "show", "me"],
    },
    {
        id: "mt-persist-campaign",
        category: "mt-persistence",
        turns: [
            "the marketing campaign",
            "please proceed now",
            "the campaign budget",
        ],
        present: ["marketing", "campaign", "budget"],
        absent: ["please", "now", "the"],
    },
    {
        id: "mt-two-topics",
        category: "mt-multi-topic",
        turns: ["schedule the meeting", "open the spreadsheet"],
        present: ["meeting", "spreadsheet"],
        absent: ["the", "open"],
    },
    {
        id: "mt-three-topics",
        category: "mt-multi-topic",
        turns: [
            "the calendar meeting",
            "the email inbox",
            "the spreadsheet formula",
        ],
        present: ["meeting", "inbox", "spreadsheet", "formula"],
        absent: ["the"],
    },
    {
        id: "mt-four-topics",
        category: "mt-multi-topic",
        turns: [
            "the spreadsheet",
            "the calendar",
            "the playlist",
            "the invoice",
        ],
        present: ["spreadsheet", "calendar", "playlist", "invoice"],
        absent: ["the"],
    },
    {
        id: "mt-recency-order",
        category: "mt-recency",
        turns: [
            "team meeting schedule",
            "calendar reminder",
            "spreadsheet formula",
        ],
        present: ["spreadsheet", "formula", "meeting", "calendar", "reminder"],
        absent: [],
    },
    {
        id: "mt-recency-dominant",
        category: "mt-recency",
        turns: ["the spreadsheet stuff", "the calendar meeting"],
        present: ["spreadsheet", "calendar", "meeting"],
        absent: ["the"],
    },
    {
        id: "mt-topic-shift-evict",
        category: "mt-window",
        turns: [
            "the vampire coffin",
            "the grocery list",
            "the spreadsheet formula",
            "the calendar meeting",
        ],
        windowTurns: 3,
        present: [
            "grocery",
            "list",
            "spreadsheet",
            "formula",
            "calendar",
            "meeting",
        ],
        absent: ["vampire", "coffin"],
    },
    {
        id: "mt-window-accumulate",
        category: "mt-window",
        turns: ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"],
        windowTurns: 5,
        present: ["beta", "gamma", "delta", "epsilon", "zeta"],
        absent: ["alpha"],
    },
    {
        id: "mt-stem-vampires",
        category: "mt-stemming",
        turns: [
            "the vampires arrived",
            "more coffins needed",
            "the vampires again",
        ],
        present: ["vampire", "coffin"],
        absent: ["vampires", "coffins"],
    },
    {
        id: "mt-stem-cells",
        category: "mt-stemming",
        turns: ["update the cells", "sort the columns", "the rows too"],
        present: ["cell", "column", "row"],
        absent: ["cells", "columns", "rows", "update"],
    },
    {
        id: "mt-stem-eggs",
        category: "mt-stemming",
        turns: ["add milk to the list", "add eggs too", "the grocery run"],
        present: ["milk", "egg", "grocery", "list"],
        absent: ["eggs", "add", "too"],
    },
    {
        id: "mt-neg-then-topic",
        category: "mt-negation",
        turns: ["do not open the spreadsheet", "show the calendar"],
        negationGuard: true,
        present: ["calendar"],
        absent: ["spreadsheet"],
    },
    {
        id: "mt-neg-no-pivot",
        category: "mt-negation",
        turns: ["no pivot chart", "work on the formula"],
        negationGuard: true,
        present: ["formula"],
        absent: ["pivot", "chart"],
    },
    {
        id: "mt-neg-reset",
        category: "mt-negation",
        turns: ["not the grocery but the spreadsheet", "the formula too"],
        negationGuard: true,
        present: ["spreadsheet", "formula"],
        absent: ["grocery"],
    },
    {
        id: "mt-long-workbook",
        category: "mt-long",
        turns: [
            "open the workbook",
            "edit the macro",
            "run the formula",
            "check the pivot",
            "save the sheet",
        ],
        present: ["workbook", "macro", "formula", "pivot", "sheet"],
        absent: ["open", "edit", "run", "save", "the"],
    },
    {
        id: "mt-long-travel",
        category: "mt-long",
        turns: ["book the flight", "reserve the hotel", "the rental car"],
        present: ["flight", "hotel", "rental", "car"],
        absent: ["the"],
    },
    {
        id: "mt-long-music",
        category: "mt-long",
        turns: ["play the playlist", "skip to the next song", "the album art"],
        present: ["playlist", "song", "album", "art"],
        absent: ["the", "to"],
    },
    {
        id: "mt-long-dev",
        category: "mt-long",
        turns: [
            "open the terminal",
            "run the C# build",
            "check the A1:B2 range",
        ],
        present: ["terminal", "c#", "build", "a1:b2", "range"],
        absent: ["open", "run", "the"],
    },
    {
        id: "mt-report-drafts",
        category: "mt-accumulate",
        turns: ["the report draft", "the report review", "the final report"],
        present: ["report", "draft", "final"],
        absent: ["the"],
    },
    {
        id: "mt-shopping-run",
        category: "mt-multi-topic",
        turns: [
            "the grocery list",
            "the recipe ingredients",
            "the pantry stock",
        ],
        present: ["grocery", "list", "recipe", "ingredient", "pantry", "stock"],
        absent: ["the", "ingredients"],
    },
];

const MT_N = 25;

describe("contextSelector/extraction-accuracy — multi-turn conversations", () => {
    it(`has exactly ${MT_N} multi-turn cases with unique ids`, () => {
        expect(MULTITURN_CASES).toHaveLength(MT_N);
        expect(new Set(MULTITURN_CASES.map((c) => c.id)).size).toBe(MT_N);
    });

    it.each(MULTITURN_CASES.map((c) => [c.id, c] as const))(
        "extracts expected tokens across turns for %s",
        (_id, c) => {
            const v = extract(c);
            for (const token of c.present) {
                expect(v.get(token) ?? 0).toBeGreaterThan(0);
            }
            for (const token of c.absent) {
                expect(v.get(token) ?? 0).toBe(0);
            }
        },
    );

    it("reports the multi-turn extraction accuracy", () => {
        const correct = MULTITURN_CASES.filter(isCorrect).length;
        // eslint-disable-next-line no-console
        console.log(
            `multi-turn extraction accuracy: ${((correct / MULTITURN_CASES.length) * 100).toFixed(1)}% (${correct}/${MULTITURN_CASES.length})`,
        );
        expect(correct).toBe(MULTITURN_CASES.length);
    });
});
