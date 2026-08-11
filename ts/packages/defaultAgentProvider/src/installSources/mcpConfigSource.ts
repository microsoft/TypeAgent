// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import registerDebug from "debug";
import {
    InstallSource,
    McpConfigSourceConfig,
    MaterializedInstallRecord,
    ResolvedCandidate,
    SourceWarning,
    AvailableInstallRow,
} from "./config.js";
import { importMcpConfig } from "../mcp/mcpConfigImport.js";
import type { NormalizedMcpServerConfig } from "../mcp/mcpServerConfig.js";

const debug = registerDebug("typeagent:dispatcher:installSource:mcpConfig");

// A snapshot of one imported MCP config file, built once when the source is
// created. Like the catalog source, there is no live reload: an edit to the
// file after startup is not picked up until restart. Reading once keeps
// enumeration off the filesystem on every resolve walk.
interface McpConfigSnapshot {
    // Normalized server config per server name (only entries that imported
    // cleanly).
    readonly serversByName: Map<string, NormalizedMcpServerConfig>;
    // Whole-file corruption / unreadable message, when the file failed to load
    // or parse. Surfaced by every command.
    readonly loadWarning?: string;
    // Per-entry import problems (a malformed server entry). Surfaced only by
    // enumeration (listAgents), matching the catalog source's split.
    readonly entryWarnings: readonly string[];
}

// Read + parse the MCP config file, wrapping read/parse failures with the file
// path so callers get an actionable message instead of a bare JSON/ENOENT error.
function loadFile(file: string): unknown {
    let text: string;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch (e: unknown) {
        throw new Error(
            `Could not read MCP config '${file}': ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
    }
    try {
        return JSON.parse(text) as unknown;
    } catch (e: unknown) {
        throw new Error(
            `MCP config '${file}' is not valid JSON: ${
                e instanceof Error ? e.message : String(e)
            }`,
        );
    }
}

/**
 * The `mcp-config` install source: a DISCOVERY source over a local MCP config
 * file (`.mcp.json`, `.vscode/mcp.json`, or a Claude-desktop `mcpServers`
 * file). It imports the file through {@link importMcpConfig} once at build time
 * and enumerates the normalized servers as `extensionKind: "mcp"` rows for
 * `@package available --type mcp`.
 *
 * It deliberately does NOT participate in the native-agent resolution walk:
 * `find` / `findName` return `undefined` so an MCP server name never resolves
 * as an installable npm agent. Actually adding an MCP server routes through the
 * MCP server store / {@link ../mcp/mcpAppAgentSource.McpServerSourceApi}, kept as
 * a separate store behind the unified `@package` facade per the near-term
 * staging plan; `materialize` therefore throws if ever reached.
 *
 * `getServers` exposes the normalized snapshot so the facade (and tests) can
 * pull a named server's config to hand to the MCP source.
 */
export interface McpConfigInstallSource extends InstallSource {
    // The normalized configs of every server that imported cleanly, keyed by
    // server name. Used by the `@package` facade to route an MCP install to the
    // MCP server store.
    getServers(): ReadonlyMap<string, NormalizedMcpServerConfig>;
}

export function createMcpConfigSource(
    config: McpConfigSourceConfig,
): McpConfigInstallSource {
    function buildSnapshot(): McpConfigSnapshot {
        const entryWarnings: string[] = [];
        let parsed: unknown;
        try {
            parsed = loadFile(config.file);
        } catch (e) {
            return {
                serversByName: new Map(),
                loadWarning: `mcp-config source '${config.name}': ${(e as Error).message}`,
                entryWarnings,
            };
        }
        const result = importMcpConfig(parsed);
        for (const error of result.errors) {
            entryWarnings.push(
                `mcp-config source '${config.name}': server '${error.name}' dropped - ${error.reason}`,
            );
        }
        const serversByName = new Map<string, NormalizedMcpServerConfig>();
        for (const server of result.servers) {
            serversByName.set(server.name, server.config);
        }
        return { serversByName, entryWarnings };
    }

    const snapshot = buildSnapshot();

    function warnLoad(onWarn?: SourceWarning): void {
        if (snapshot.loadWarning !== undefined) {
            debug(snapshot.loadWarning);
            onWarn?.(snapshot.loadWarning);
        }
    }

    function warnAll(onWarn?: SourceWarning): void {
        warnLoad(onWarn);
        for (const message of snapshot.entryWarnings) {
            debug(message);
            onWarn?.(message);
        }
    }

    return {
        name: config.name,
        kind: "mcp-config",
        describe(): string {
            return config.file;
        },
        getServers(): ReadonlyMap<string, NormalizedMcpServerConfig> {
            return snapshot.serversByName;
        },
        // An MCP server is not a native npm agent: never resolve one through the
        // agent resolution walk. The unified `@package` facade routes MCP
        // installs to the MCP server store instead (see class doc).
        async find(): Promise<ResolvedCandidate | undefined> {
            return undefined;
        },
        async materialize(): Promise<MaterializedInstallRecord> {
            throw new Error(
                `mcp-config source '${config.name}' cannot materialize a native agent; ` +
                    `MCP servers are installed into the MCP server store via the @package facade.`,
            );
        },
        async listAgents(
            onWarn?: SourceWarning,
        ): Promise<AvailableInstallRow[]> {
            warnAll(onWarn);
            const rows: AvailableInstallRow[] = [];
            for (const [name, server] of snapshot.serversByName) {
                const row: AvailableInstallRow = {
                    source: config.name,
                    ref: name,
                    defaultAgentName: name,
                    extensionKind: "mcp",
                };
                if (server.description !== undefined) {
                    rows.push({ ...row, description: server.description });
                } else {
                    rows.push(row);
                }
            }
            return rows;
        },
    };
}
