// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    LoadResult,
    LoadedGrammar,
    CompletionPreview,
    MatchTrace,
    CoverageReport,
    GrammarDiff,
    GrammarSnapshot,
} from "grammar-tools-core";
import type { GrammarBackend } from "../backend.js";

// ---------------------------------------------------------------------------
// Canned data (derived from the player agent grammar)
// ---------------------------------------------------------------------------

const fixtureGrammar: LoadedGrammar = {
    source: { kind: "buffer", id: "fixture:player.agr" },
    grammar: {} as LoadedGrammar["grammar"], // opaque to the UI
    identifiers: {
        ruleIds: [
            "Start",
            "PlayAction",
            "ArtistRef",
            "AlbumRef",
            "ShuffleAction",
            "QueueAction",
            "SkipAction",
            "PauseAction",
        ],
        partIds: [],
        ruleIndex: new Map([
            ["Start", 0],
            ["PlayAction", 1],
            ["ArtistRef", 2],
            ["AlbumRef", 3],
            ["ShuffleAction", 4],
            ["QueueAction", 5],
            ["SkipAction", 6],
            ["PauseAction", 7],
        ]),
    },
    debugInfo: {
        grammarHash: "fixture-abc123",
        rules: new Map([
            [
                "Start",
                {
                    fileId: "player.agr",
                    displayPath: "player.agr",
                    range: {
                        start: { line: 0, character: 0, offset: 0 },
                        end: { line: 0, character: 40, offset: 40 },
                    },
                },
            ],
            [
                "PlayAction",
                {
                    fileId: "player.agr",
                    displayPath: "player.agr",
                    range: {
                        start: { line: 3, character: 0, offset: 60 },
                        end: { line: 5, character: 30, offset: 150 },
                    },
                },
            ],
            [
                "ArtistRef",
                {
                    fileId: "player.agr",
                    displayPath: "player.agr",
                    range: {
                        start: { line: 11, character: 0, offset: 200 },
                        end: { line: 13, character: 20, offset: 260 },
                    },
                },
            ],
            [
                "AlbumRef",
                {
                    fileId: "player.agr",
                    displayPath: "player.agr",
                    range: {
                        start: { line: 17, character: 0, offset: 300 },
                        end: { line: 19, character: 25, offset: 370 },
                    },
                },
            ],
            [
                "ShuffleAction",
                {
                    fileId: "player.agr",
                    displayPath: "player.agr",
                    range: {
                        start: { line: 24, character: 0, offset: 400 },
                        end: { line: 25, character: 20, offset: 440 },
                    },
                },
            ],
            [
                "QueueAction",
                {
                    fileId: "player.agr",
                    displayPath: "player.agr",
                    range: {
                        start: { line: 29, character: 0, offset: 500 },
                        end: { line: 32, character: 25, offset: 590 },
                    },
                },
            ],
            [
                "SkipAction",
                {
                    fileId: "player.agr",
                    displayPath: "player.agr",
                    range: {
                        start: { line: 37, character: 0, offset: 650 },
                        end: { line: 37, character: 30, offset: 680 },
                    },
                },
            ],
            [
                "PauseAction",
                {
                    fileId: "player.agr",
                    displayPath: "player.agr",
                    range: {
                        start: { line: 40, character: 0, offset: 720 },
                        end: { line: 40, character: 30, offset: 750 },
                    },
                },
            ],
        ]),
        parts: new Map(),
        partRules: new Map(),
        partLabels: new Map(),
        filePaths: new Map(),
    },
    files: [
        {
            id: "player.agr",
            text: [
                "<Start> = <PlayAction> | <ShuffleAction> | <QueueAction> | <SkipAction> | <PauseAction>;",
                "",
                "// Play a track or artist",
                "<PlayAction> = play <ArtistRef>",
                '  | play <AlbumRef> -> { action: "play", album };',
                "",
                "// Artist reference with wildcard",
                "<ArtistRef> = [by] $(artist:wildcard) -> { artist };",
                "",
                "// Album reference",
                "<AlbumRef> = [album] $(album:wildcard) -> { album };",
                "",
                "// Shuffle mode",
                "<ShuffleAction> = shuffle [all] [songs]",
                '  -> { action: "shuffle" };',
                "",
                "// Queue a song",
                '<QueueAction> = queue <ArtistRef> | queue <AlbumRef> | queue next -> { action: "queue" };',
                "",
                "// Skip track",
                '<SkipAction> = skip [this] [track] -> { action: "skip" };',
                "",
                "// Pause playback",
                '<PauseAction> = pause | stop -> { action: "pause" };',
            ].join("\n"),
        },
    ],
};

const fixtureCompletionFull: CompletionPreview = {
    groups: [
        {
            completions: ["play", "shuffle", "queue", "skip", "pause", "stop"],
            separatorMode: "space",
        },
    ],
    matchedPrefixLength: 0,
    afterWildcard: "none",
    directionSensitive: false,
};

const fixtureCompletionPlay: CompletionPreview = {
    groups: [
        {
            completions: ["by", "album"],
            separatorMode: "space",
        },
    ],
    properties: [{ propertyNames: ["artist"], separatorMode: "space" }],
    matchedPrefixLength: 5,
    afterWildcard: "some",
    directionSensitive: false,
};

const fixtureCompletionBeatles: CompletionPreview = {
    groups: [
        {
            completions: ["les", "beatles", "beach boys"],
            separatorMode: "space",
        },
        {
            completions: [",", ";"],
            separatorMode: "optionalSpace",
        },
    ],
    properties: [{ propertyNames: ["artist"], separatorMode: "space" }],
    matchedPrefixLength: 14,
    afterWildcard: "some",
    directionSensitive: false,
};

const fixtureTrace: MatchTrace = {
    input: "play songs by the beatles",
    events: [
        { seq: 0, kind: "ruleEntered", rule: "Start", depth: 0, inputPos: 0 },
        {
            seq: 1,
            kind: "partAttempted",
            rule: "Start",
            part: 0,
            inputPos: 0,
            partKind: "rules",
        },
        {
            seq: 2,
            kind: "ruleEntered",
            rule: "PlayAction",
            depth: 1,
            inputPos: 0,
        },
        {
            seq: 3,
            kind: "partAttempted",
            rule: "PlayAction",
            part: 1,
            inputPos: 0,
            partKind: "string",
        },
        {
            seq: 4,
            kind: "partMatched",
            rule: "PlayAction",
            part: 1,
            inputPos: 0,
            endPos: 4,
        },
        {
            seq: 5,
            kind: "partAttempted",
            rule: "PlayAction",
            part: 2,
            inputPos: 5,
            partKind: "rules",
        },
        {
            seq: 6,
            kind: "ruleEntered",
            rule: "ArtistRef",
            depth: 2,
            inputPos: 5,
        },
        {
            seq: 7,
            kind: "partAttempted",
            rule: "ArtistRef",
            part: 3,
            inputPos: 5,
            partKind: "string",
        },
        {
            seq: 8,
            kind: "partMatched",
            rule: "ArtistRef",
            part: 3,
            inputPos: 5,
            endPos: 7,
        },
        {
            seq: 9,
            kind: "partAttempted",
            rule: "ArtistRef",
            part: 4,
            inputPos: 8,
            partKind: "wildcard",
        },
        {
            seq: 10,
            kind: "partMatched",
            rule: "ArtistRef",
            part: 4,
            inputPos: 8,
            endPos: 25,
            capturedValue: { variable: "artist", value: "the beatles" },
        },
        {
            seq: 11,
            kind: "ruleExited",
            rule: "ArtistRef",
            inputPos: 25,
            result: "matched",
        },
        {
            seq: 12,
            kind: "ruleExited",
            rule: "PlayAction",
            inputPos: 25,
            result: "matched",
        },
        {
            seq: 13,
            kind: "ruleExited",
            rule: "Start",
            inputPos: 25,
            result: "matched",
        },
    ],
    result: "matched",
    matchValue: { action: "play", artist: "the beatles" },
};

const fixtureCoverage: CoverageReport = {
    grammarHash: "fixture-abc123",
    totals: { rules: 8, parts: 18, ruleHits: 4, partHits: 12 },
    perRule: [
        {
            id: "Start",
            hits: 12,
            parts: [
                { id: 0, hits: 12 },
                { id: 1, hits: 8 },
                { id: 2, hits: 3 },
            ],
            location: fixtureGrammar.debugInfo!.rules.get("Start")!,
        },
        {
            id: "PlayAction",
            hits: 8,
            parts: [
                { id: 3, hits: 8 },
                { id: 4, hits: 8 },
                { id: 5, hits: 6 },
                { id: 6, hits: 2 },
                { id: 7, hits: 0 },
            ],
            location: fixtureGrammar.debugInfo!.rules.get("PlayAction")!,
        },
        {
            id: "ArtistRef",
            hits: 3,
            parts: [
                { id: 8, hits: 3 },
                { id: 9, hits: 3 },
            ],
            location: fixtureGrammar.debugInfo!.rules.get("ArtistRef")!,
        },
        {
            id: "AlbumRef",
            hits: 1,
            parts: [
                { id: 10, hits: 1 },
                { id: 11, hits: 1 },
                { id: 12, hits: 0 },
            ],
            location: fixtureGrammar.debugInfo!.rules.get("AlbumRef")!,
        },
        {
            id: "ShuffleAction",
            hits: 0,
            parts: [
                { id: 13, hits: 0 },
                { id: 14, hits: 0 },
            ],
            location: fixtureGrammar.debugInfo!.rules.get("ShuffleAction")!,
        },
        {
            id: "QueueAction",
            hits: 0,
            parts: [
                { id: 15, hits: 0 },
                { id: 16, hits: 0 },
                { id: 17, hits: 0 },
                { id: 18, hits: 0 },
            ],
            location: fixtureGrammar.debugInfo!.rules.get("QueueAction")!,
        },
        {
            id: "SkipAction",
            hits: 0,
            parts: [{ id: 19, hits: 0 }],
            location: fixtureGrammar.debugInfo!.rules.get("SkipAction")!,
        },
        {
            id: "PauseAction",
            hits: 0,
            parts: [{ id: 20, hits: 0 }],
            location: fixtureGrammar.debugInfo!.rules.get("PauseAction")!,
        },
    ],
    unmatchedInputs: [
        { input: "play something random", reason: "no rule matched" },
        { input: "shuffle all songs by mood", reason: "no rule matched" },
        { input: "queue next", reason: "partial match at pos 5" },
    ],
};

const fixtureDiff: GrammarDiff = {
    added: ["RepeatAction", "QueueAction"],
    removed: ["LegacySkip"],
    changed: [
        {
            rule: "PlayAction",
            reason: "body",
            before: [
                "<PlayAction> = play <ArtistRef>",
                '  | play <AlbumRef> -> { action: "play", album };',
            ].join("\n"),
            after: [
                "<PlayAction> = play <ArtistRef>",
                "  [by <artist:wildcard>]",
                '  -> { action: "play", song, artist };',
            ].join("\n"),
        },
        {
            rule: "ShuffleAction",
            reason: "value",
            before: '<ShuffleAction> = shuffle [all] [songs] -> { action: "shuffle" };',
            after: '<ShuffleAction> = shuffle [all] [songs] -> { action: "shuffle", mode: "all" };',
        },
    ],
};

// ---------------------------------------------------------------------------
// Fixture backend implementation
// ---------------------------------------------------------------------------

/**
 * Fixture implementation of GrammarBackend returning canned data.
 * Used for developing and testing UI components before real core
 * services are wired up.
 */
export class FixtureBackend implements GrammarBackend {
    private readonly delay: number;

    constructor(options?: { delayMs?: number }) {
        this.delay = options?.delayMs ?? 80;
    }

    private async wait(): Promise<void> {
        if (this.delay > 0) {
            return new Promise((resolve) => setTimeout(resolve, this.delay));
        }
    }

    async loadGrammarFromFile(_path: string): Promise<LoadResult> {
        await this.wait();
        return { ok: true, grammar: fixtureGrammar };
    }

    async loadGrammarFromBuffer(
        _id: string,
        _text: string,
    ): Promise<LoadResult> {
        await this.wait();
        return { ok: true, grammar: fixtureGrammar };
    }

    async loadGrammarFromAgent(_agentName: string): Promise<LoadResult> {
        await this.wait();
        return { ok: true, grammar: fixtureGrammar };
    }

    async loadGrammarFromSnapshot(
        _snapshot: GrammarSnapshot,
    ): Promise<LoadResult> {
        await this.wait();
        return { ok: true, grammar: fixtureGrammar };
    }

    async previewCompletion(
        _grammar: LoadedGrammar,
        input: string,
    ): Promise<CompletionPreview> {
        await this.wait();
        if (input.length === 0) return fixtureCompletionFull;
        if (input.startsWith("play") && input.length <= 5)
            return fixtureCompletionPlay;
        if (input.includes("beat")) return fixtureCompletionBeatles;
        // Fallback: return full completions with prefix length = input length
        return {
            ...fixtureCompletionFull,
            matchedPrefixLength: input.length,
        };
    }

    async traceMatch(
        _grammar: LoadedGrammar,
        _input: string,
    ): Promise<MatchTrace> {
        await this.wait();
        return fixtureTrace;
    }

    async computeCoverage(
        _grammar: LoadedGrammar,
        _inputs: readonly string[],
    ): Promise<CoverageReport> {
        await this.wait();
        return fixtureCoverage;
    }

    async diffGrammars(
        _before: LoadedGrammar,
        _after: LoadedGrammar,
    ): Promise<GrammarDiff> {
        await this.wait();
        return fixtureDiff;
    }

    async format(_grammar: LoadedGrammar): Promise<string> {
        await this.wait();
        return fixtureGrammar.files?.[0]?.text ?? "";
    }

    async listAgents(): Promise<string[]> {
        await this.wait();
        return ["player", "calendar", "email", "list", "browser"];
    }
}
