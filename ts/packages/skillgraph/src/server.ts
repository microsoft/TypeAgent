// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
    createConnection,
    DiagnosticSeverity,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    type Diagnostic as LspDiagnostic,
    type Location,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SkillGraph, type BuildResult } from "./graph.js";
import type { Config, Diagnostic, Edge, Severity } from "./types.js";

// LSP over stdio. Each edit rebuilds the graph from overlays (cheap: no tool
// runs). Missing CLI specs are probed in the background; diagnostics are
// republished when probes finish.
//
//   didChange ─▶ build() ─▶ publish ─▶ pending probes? ─▶ probe ─▶ build() ─▶ publish

const SEVERITY: Record<Severity, DiagnosticSeverity> = {
    error: DiagnosticSeverity.Error,
    warn: DiagnosticSeverity.Warning,
    info: DiagnosticSeverity.Information,
};
const REBUILD_DEBOUNCE_MS = 150;
const SOURCE = "skillgraph";

export function startServer(config: Config) {
    // stdio always: `skillgraph lsp` works with or without a --stdio flag.
    const connection = createConnection(
        ProposedFeatures.all,
        process.stdin,
        process.stdout,
    );
    const documents = new TextDocuments(TextDocument);
    const graph = new SkillGraph(config);
    let res: BuildResult = graph.build();
    let published = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    let probing = false;

    const publish = () => {
        const byFile = new Map<string, LspDiagnostic[]>();
        for (const d of res.diagnostics) {
            const list = byFile.get(d.at.file) ?? [];
            list.push(toLsp(d));
            byFile.set(d.at.file, list);
        }
        for (const f of published) if (!byFile.has(f)) byFile.set(f, []);
        for (const [file, diagnostics] of byFile) {
            connection.sendDiagnostics({
                uri: pathToFileURL(file).href,
                diagnostics,
            });
        }
        published = new Set(
            [...byFile.keys()].filter((f) => byFile.get(f)!.length),
        );
    };

    const rebuild = () => {
        res = graph.build();
        publish();
        if (res.pending.length && !probing && config.probe) {
            probing = true;
            const pending = res.pending;
            Promise.all(pending.map((p) => graph.store.probe(p.tool, p.words)))
                .catch(() => undefined)
                .finally(() => {
                    probing = false;
                    rebuild();
                });
        }
    };
    const schedule = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(rebuild, REBUILD_DEBOUNCE_MS);
    };

    connection.onInitialize(() => ({
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full,
            definitionProvider: true,
            referencesProvider: true,
            hoverProvider: true,
            inlayHintProvider: true,
        },
        serverInfo: { name: SOURCE, version: "0.0.1" },
    }));
    connection.onInitialized(() => rebuild());

    documents.onDidChangeContent((e) => {
        graph.setOverlay(fileURLToPath(e.document.uri), e.document.getText());
        schedule();
    });
    documents.onDidClose((e) => {
        graph.setOverlay(fileURLToPath(e.document.uri), undefined);
        schedule();
    });
    connection.onDidChangeWatchedFiles(schedule);

    /** Edge whose source range contains the cursor. */
    const edgeAt = (
        uri: string,
        line: number,
        character: number,
    ): Edge | undefined => {
        const file = fileURLToPath(uri);
        return res.edges.find(
            (e) =>
                e.at.file === file &&
                e.at.line === line + 1 &&
                character + 1 >= e.at.col &&
                character + 1 <= e.at.endCol,
        );
    };

    connection.onDefinition((p) => {
        const e = edgeAt(
            p.textDocument.uri,
            p.position.line,
            p.position.character,
        );
        return e ? targetLocation(e.to, res) : null;
    });

    connection.onReferences((p) => {
        const file = fileURLToPath(p.textDocument.uri);
        const e = edgeAt(
            p.textDocument.uri,
            p.position.line,
            p.position.character,
        );
        // On a reference: find all refs to the same target. Elsewhere: refs to this file.
        const ids = new Set<string>(e ? [e.to] : []);
        if (!e) {
            for (const n of res.nodes)
                if (n.path === file && n.kind !== "heading") ids.add(n.id);
            const md = res.docs.get(file);
            const h = md?.headings.find((x) => x.line === p.position.line + 1);
            if (h) {
                for (const n of res.nodes) {
                    if (
                        n.kind === "heading" &&
                        n.path === file &&
                        n.line === h.line
                    )
                        ids.add(n.id);
                }
            }
        }
        return res.edges
            .filter((x) => ids.has(x.to))
            .map(
                (x): Location => ({
                    uri: pathToFileURL(x.at.file).href,
                    range: range(x.at),
                }),
            );
    });

    connection.onHover((p) => {
        const e = edgeAt(
            p.textDocument.uri,
            p.position.line,
            p.position.character,
        );
        if (!e) return null;
        const node = res.nodes.find((n) => n.id === e.to);
        const lines: string[] = [
            `**${e.to}** · ${e.kind}${e.resolved ? "" : " · unresolved"}`,
        ];
        if (node?.description) lines.push("", node.description);
        if (node?.tokens) lines.push("", `~${node.tokens} tokens`);
        const spec =
            res.specs.get(e.to) ??
            res.specs.get(`${e.to} ${(e.words ?? []).join(" ")}`.trim());
        if (spec) {
            lines.push(
                "",
                `\`${spec.source === "ast" ? path.basename(spec.tool) : `${spec.tool} ${spec.version}`}\` · ${spec.source}${spec.probe.length ? ` · \`${spec.probe.join(" ")}\`` : ""}`,
            );
            if (spec.summary) lines.push("", spec.summary);
            if (spec.subcommands.length)
                lines.push(
                    "",
                    `commands: ${spec.subcommands
                        .slice(0, 20)
                        .map((c) => `\`${c}\``)
                        .join(" ")}`,
                );
            const flags = spec.flags
                .filter((f) => f.name.startsWith("--"))
                .slice(0, 12);
            if (flags.length)
                lines.push(
                    "",
                    flags
                        .map(
                            (f) =>
                                `\`${f.name}\`${f.help ? ` — ${f.help}` : ""}`,
                        )
                        .join("  \n"),
                );
        }
        return { contents: { kind: "markdown", value: lines.join("\n") } };
    });

    connection.languages.inlayHint.on((p) => {
        const file = fileURLToPath(p.textDocument.uri);
        return res.edges
            .filter(
                (e) => e.at.file === file && e.kind === "links" && e.resolved,
            )
            .flatMap((e) => {
                const target = e.to.startsWith("heading:")
                    ? e.to.replace(/^heading:/, "doc:").replace(/#.*$/, "")
                    : e.to;
                const n = res.nodes.find((x) => x.id === target);
                if (!n?.tokens) return [];
                return [
                    {
                        position: {
                            line: e.at.line - 1,
                            character: e.at.endCol - 1,
                        },
                        label: ` ~${fmtTokens(n.tokens)} tok`,
                        paddingLeft: true,
                    },
                ];
            });
    });

    documents.listen(connection);
    connection.listen();
}

function fmtTokens(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

function range(at: { line: number; col: number; endCol: number }) {
    return {
        start: { line: at.line - 1, character: at.col - 1 },
        end: { line: at.line - 1, character: at.endCol - 1 },
    };
}

function toLsp(d: Diagnostic): LspDiagnostic {
    const tag = d.spec
        ? ` [${d.spec.source === "ast" ? d.spec.tool : `${d.spec.tool} ${d.spec.version}`} · ${d.spec.source}]`
        : "";
    return {
        range: range(d.at),
        severity: SEVERITY[d.severity],
        code: d.rule,
        source: SOURCE,
        message: d.message + tag,
    };
}

function targetLocation(id: string, res: BuildResult): Location | null {
    const node = res.nodes.find((n) => n.id === id);
    if (node?.path) {
        const line = (node.line ?? 1) - 1;
        return {
            uri: pathToFileURL(node.path).href,
            range: {
                start: { line, character: 0 },
                end: { line, character: 0 },
            },
        };
    }
    if (id.startsWith("script:")) {
        const spec = res.specs.get(id);
        if (spec?.path)
            return {
                uri: pathToFileURL(spec.path).href,
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                },
            };
    }
    if (id.startsWith("file:")) {
        const p = id.slice(5);
        return {
            uri: pathToFileURL(p).href,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
            },
        };
    }
    return null;
}
