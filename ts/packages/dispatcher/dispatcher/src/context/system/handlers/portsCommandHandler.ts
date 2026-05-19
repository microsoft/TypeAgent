// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext } from "@typeagent/agent-sdk";
import { CommandHandler } from "@typeagent/agent-sdk/helpers/command";
import { displayWarn } from "@typeagent/agent-sdk/helpers/display";
import chalk from "chalk";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import {
    AGENT_SERVER_REGISTRAR_NAME,
    SYSTEM_SESSION_CONTEXT_ID,
} from "../../portRegistrar.js";

export class PortsCommandHandler implements CommandHandler {
    public readonly description =
        "Lists ports registered by agents and the number of clients connected to each.";

    public readonly parameters = {};

    public async run(context: ActionContext<CommandHandlerContext>) {
        const cmdContext = context.sessionContext.agentContext;
        const registrar = cmdContext.portRegistrar;
        const agents = cmdContext.agents;

        // Best-effort emoji lookup: the registrar may contain entries for
        // pseudo-agents that aren't real app-agents (notably the
        // agent-server's own listening port registered under the
        // well-known "agent-server" name), in which case
        // `getAppAgentEmoji` throws "Unknown app agent: ...". Render
        // the agent-server's own row with 🤖 so it's not visually
        // empty; everything else falls back to no emoji.
        const safeEmoji = (name: string): string => {
            if (name === AGENT_SERVER_REGISTRAR_NAME) return "🤖";
            try {
                return agents.getAppAgentEmoji(name) ?? "";
            } catch {
                return "";
            }
        };

        // Group registrar entries by (agentName, role, port). Code's
        // shared WS server has no per-session client identity, so its
        // count is global and the same number is reported across every
        // session that registered the shared port. Grouping collapses
        // those duplicates into one row with the (shared) count.
        type Row = {
            agentName: string;
            role: string;
            port: number;
            isSystem: boolean;
            // undefined === "agent never reported a count" (distinct from 0)
            clientCount: number | undefined;
        };
        const grouped = new Map<string, Row>();
        for (const alloc of registrar.list()) {
            const key = `${alloc.agentName}\u0000${alloc.role}\u0000${alloc.port}`;
            const isSystem =
                alloc.sessionContextId === SYSTEM_SESSION_CONTEXT_ID;
            const cc = registrar.getClientCount(
                alloc.agentName,
                alloc.role,
                alloc.sessionContextId,
            );
            const existing = grouped.get(key);
            if (existing === undefined) {
                grouped.set(key, {
                    agentName: alloc.agentName,
                    role: alloc.role,
                    port: alloc.port,
                    isSystem,
                    clientCount: cc,
                });
            } else {
                // System tag is sticky: if any underlying allocation is
                // system-owned, treat the group as system.
                if (isSystem) existing.isSystem = true;
                // Within a (agent, role, port) group, every contributing
                // session is registered to the SAME physical server, so
                // each session's reported count is the same global
                // number — not an independent value to add. Take the max
                // (treating "never reported" as 0 only when comparing).
                // For per-session servers each group has a single
                // contributor and this collapses to that count anyway.
                if (cc !== undefined) {
                    existing.clientCount = Math.max(
                        existing.clientCount ?? 0,
                        cc,
                    );
                }
            }
        }

        const rows = Array.from(grouped.values()).sort((a, b) => {
            const an = a.agentName.localeCompare(b.agentName);
            if (an !== 0) return an;
            const ar = a.role.localeCompare(b.role);
            if (ar !== 0) return ar;
            return a.port - b.port;
        });

        if (rows.length === 0) {
            displayWarn("No ports registered", context);
            return;
        }

        // Plain-text (CLI / console) — fixed-width via chalk for alignment.
        const text: string[][] = [["", "Agent", "Role", "Port", "Clients"]];
        for (const r of rows) {
            const emoji = safeEmoji(r.agentName);
            const name = r.isSystem
                ? `${r.agentName} ${chalk.gray("[system]")}`
                : r.agentName;
            const clients =
                r.clientCount === undefined
                    ? chalk.gray("?")
                    : r.clientCount.toString();
            text.push([emoji, name, r.role, r.port.toString(), clients]);
        }

        // Rich HTML for the shell.
        const html = buildPortsHtml(rows, { getAppAgentEmoji: safeEmoji });

        context.actionIO.appendDisplay({
            type: "text",
            content: text,
            alternates: [{ type: "html", content: html }],
        });
    }
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildPortsHtml(
    rows: ReadonlyArray<{
        agentName: string;
        role: string;
        port: number;
        isSystem: boolean;
        clientCount: number | undefined;
    }>,
    agents: { getAppAgentEmoji(name: string): string },
): string {
    const thStyle = `text-align:left;padding:4px 8px;font-weight:600;font-size:13px;color:#64748b;border-bottom:2px solid #e2e8f0`;
    const headerCols = [
        `<th style="${thStyle}">Agent</th>`,
        `<th style="${thStyle}">Role</th>`,
        `<th style="${thStyle};text-align:right">Port</th>`,
        `<th style="${thStyle};text-align:right">Clients</th>`,
    ];

    const tdBase = `padding:3px 12px;border-bottom:1px solid #f1f5f9;white-space:nowrap`;
    const rowsHtml = rows
        .map((r) => {
            const emoji = agents.getAppAgentEmoji(r.agentName) ?? "";
            const systemTag = r.isSystem
                ? ` <span style="color:#64748b;font-size:12px;font-style:italic">[system]</span>`
                : "";
            const clientCell =
                r.clientCount === undefined
                    ? `<span style="color:#94a3b8" title="No count reported (this agent does not publish client counts)" aria-label="No count reported">?</span>`
                    : escapeHtml(r.clientCount.toString());
            return (
                `<tr>` +
                `<td style="${tdBase};font-weight:600;color:#1e293b">${emoji ? emoji + " " : ""}${escapeHtml(r.agentName)}${systemTag}</td>` +
                `<td style="${tdBase};color:#475569">${escapeHtml(r.role)}</td>` +
                `<td style="${tdBase};text-align:right;font-family:'Cascadia Code',Consolas,monospace">${r.port}</td>` +
                `<td style="${tdBase};text-align:right">${clientCell}</td>` +
                `</tr>`
            );
        })
        .join("");

    return (
        `<table style="border-collapse:collapse;font-family:'Segoe UI',system-ui,sans-serif;font-size:14px;line-height:1.4">` +
        `<thead><tr>${headerCols.join("")}</tr></thead>` +
        `<tbody>${rowsHtml}</tbody></table>`
    );
}
