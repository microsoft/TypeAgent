// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Webview-side GrammarBackend that proxies all calls to the extension
 * host via postMessage/onDidReceiveMessage RPC.
 */

import type {
    LoadResult,
    LoadedGrammar,
    CompletionPreview,
    CompletionOptions,
    MatchTrace,
    CoverageReport,
    GrammarDiff,
    GrammarSnapshot,
    GrammarIdentifierIndex,
    GrammarDebugInfo,
    SourceLocation,
    SourceFile,
    GrammarSource,
    RuleId,
    PartId,
    Diagnostic,
} from "grammar-tools-core";
import type { GrammarBackend } from "grammar-tools-ui";

declare function acquireVsCodeApi(): {
    postMessage(msg: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

interface WebviewRequest {
    id: number;
    method: string;
    params: unknown[];
}

interface WebviewResponse {
    id: number;
    result?: unknown;
    error?: string;
}

/**
 * Serialized LoadResult returned from the extension host.
 * The grammar object is replaced with a string handle.
 */
export interface SerializedLoadResult {
    ok: true;
    handle: string;
    identifiers: GrammarIdentifierIndex;
    debugInfo?: {
        grammarHash: string;
        rules: Array<[RuleId, SourceLocation]>;
        parts: Array<[PartId, SourceLocation]>;
        partRules: Array<[PartId, RuleId]>;
        filePaths?: Array<[string, string]>;
    };
    files?: readonly SourceFile[];
    source: GrammarSource;
    diagnostics?: Diagnostic[];
}

const vscode = acquireVsCodeApi();
let nextId = 1;
const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

window.addEventListener("message", (event: MessageEvent) => {
    // In VS Code webviews, the only legitimate sender is the extension
    // host. Ignore messages without the expected shape.
    const msg = event.data as WebviewResponse;
    if (typeof msg !== "object" || msg === null || msg.id == null) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) {
        entry.reject(new Error(msg.error));
    } else {
        entry.resolve(msg.result);
    }
});

function rpc(method: string, ...params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        const req: WebviewRequest = { id, method, params };
        vscode.postMessage(req);
    });
}

/**
 * Reconstruct a LoadedGrammar proxy from serialized data.
 * The actual grammar object lives in the extension host; the webview
 * only keeps the handle and metadata needed for rendering.
 */
export function hydrateLoadResult(raw: SerializedLoadResult): LoadResult {
    const debugInfo: GrammarDebugInfo | undefined = raw.debugInfo
        ? {
              grammarHash: raw.debugInfo.grammarHash,
              rules: new Map(raw.debugInfo.rules),
              parts: new Map(raw.debugInfo.parts),
              partRules: new Map(raw.debugInfo.partRules),
              filePaths: new Map(raw.debugInfo.filePaths ?? []),
          }
        : undefined;

    const identifiers: GrammarIdentifierIndex = {
        ...raw.identifiers,
        ruleIndex: new Map(raw.identifiers.ruleIds.map((id, i) => [id, i])),
    };

    const grammar: LoadedGrammar = {
        source: raw.source,
        grammar: {
            __handle: raw.handle,
        } as unknown as LoadedGrammar["grammar"],
        debugInfo,
        files: raw.files,
        identifiers,
    };

    // Stash the handle for later use in RPC calls
    (grammar as unknown as { __handle: string }).__handle = raw.handle;

    return { ok: true, grammar, diagnostics: raw.diagnostics };
}

function getHandle(grammar: LoadedGrammar): string {
    const handle = (grammar as unknown as { __handle: string }).__handle;
    if (!handle) throw new Error("Grammar has no RPC handle");
    return handle;
}

/**
 * WebviewBackend implements GrammarBackend by proxying to the extension host.
 */
export class WebviewBackend implements GrammarBackend {
    async loadGrammarFromFile(path: string): Promise<LoadResult> {
        const raw = (await rpc("loadGrammarFromFile", path)) as
            | SerializedLoadResult
            | { ok: false; diagnostics: Diagnostic[]; files: SourceFile[] };
        if (!raw.ok) return raw;
        return hydrateLoadResult(raw);
    }

    async loadGrammarFromBuffer(id: string, text: string): Promise<LoadResult> {
        const raw = (await rpc("loadGrammarFromBuffer", id, text)) as
            | SerializedLoadResult
            | { ok: false; diagnostics: Diagnostic[]; files: SourceFile[] };
        if (!raw.ok) return raw;
        return hydrateLoadResult(raw);
    }

    async loadGrammarFromAgent(agentName: string): Promise<LoadResult> {
        // Agent loading uses loadGrammarFromFile on the extension side
        const raw = (await rpc("loadGrammarFromAgent", agentName)) as
            | SerializedLoadResult
            | { ok: false; diagnostics: Diagnostic[]; files: SourceFile[] };
        if (!raw.ok) return raw;
        return hydrateLoadResult(raw);
    }

    async loadGrammarFromSnapshot(
        _snapshot: GrammarSnapshot,
    ): Promise<LoadResult> {
        // Snapshots not yet supported in the extension
        return {
            ok: false,
            diagnostics: [
                {
                    range: {
                        start: { line: 0, character: 0, offset: 0 },
                        end: { line: 0, character: 0, offset: 0 },
                    },
                    severity: "error",
                    message: "Snapshot loading not supported in VS Code",
                    source: "grammar-tools-core",
                },
            ],
            files: [],
        };
    }

    async loadGrammarFromActiveEditor(): Promise<LoadResult> {
        const raw = (await rpc("loadGrammarFromActiveEditor")) as
            | SerializedLoadResult
            | { ok: false; diagnostics: Diagnostic[]; files: SourceFile[] };
        if (!raw.ok) return raw;
        return hydrateLoadResult(raw);
    }

    async previewCompletion(
        grammar: LoadedGrammar,
        input: string,
        options?: CompletionOptions,
    ): Promise<CompletionPreview> {
        return (await rpc(
            "previewCompletion",
            getHandle(grammar),
            input,
            options,
        )) as CompletionPreview;
    }

    async traceMatch(
        grammar: LoadedGrammar,
        input: string,
    ): Promise<MatchTrace> {
        return (await rpc(
            "traceMatch",
            getHandle(grammar),
            input,
        )) as MatchTrace;
    }

    async computeCoverage(
        grammar: LoadedGrammar,
        inputs: readonly string[],
    ): Promise<CoverageReport> {
        return (await rpc(
            "computeCoverage",
            getHandle(grammar),
            inputs,
        )) as CoverageReport;
    }

    async diffGrammars(
        before: LoadedGrammar,
        after: LoadedGrammar,
    ): Promise<GrammarDiff> {
        return (await rpc(
            "diffGrammars",
            getHandle(before),
            getHandle(after),
        )) as GrammarDiff;
    }

    async format(grammar: LoadedGrammar): Promise<string> {
        return (await rpc("format", getHandle(grammar))) as string;
    }

    async listAgents(): Promise<string[]> {
        return (await rpc("listAgents")) as string[];
    }
}
