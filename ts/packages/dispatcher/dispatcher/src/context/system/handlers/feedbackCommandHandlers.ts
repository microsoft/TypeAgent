// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import { displayResult } from "@typeagent/agent-sdk/helpers/display";
import fs from "node:fs";
import path from "node:path";
import type {
    UserFeedbackCategory,
    UserFeedbackEntry,
    UserFeedbackRating,
} from "@typeagent/dispatcher-types";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { expandHome } from "../../../utils/fsUtils.js";
import { checkOverwriteFile } from "../../../utils/commandHandlerUtils.js";

/**
 * Pull every user-feedback entry out of the displayLog. Append-only —
 * later entries with the same requestId are a re-rating / category
 * change / comment edit, NOT a duplicate. Callers that want the
 * "current rating per request" should run `reduceToLatest` on the
 * result.
 */
function getAllFeedback(
    systemContext: CommandHandlerContext,
): UserFeedbackEntry[] {
    return systemContext.displayLog
        .getEntries()
        .filter((e): e is UserFeedbackEntry => e.type === "user-feedback");
}

/** Keep only the latest entry per requestId — drops historical edits. */
function reduceToLatest(entries: UserFeedbackEntry[]): UserFeedbackEntry[] {
    const latest = new Map<string, UserFeedbackEntry>();
    for (const e of entries) {
        const key =
            e.requestId.requestId || String(e.requestId.clientRequestId ?? "");
        if (!key) continue;
        latest.set(key, e);
    }
    return Array.from(latest.values());
}

function ratingGlyph(r: UserFeedbackRating): string {
    if (r === "up") return "👍";
    if (r === "down") return "👎";
    return "  ";
}

function fmtTimestamp(ts: number): string {
    return new Date(ts).toISOString().slice(0, 19).replace("T", " ");
}

function shortReqId(r: UserFeedbackEntry["requestId"]): string {
    const id = r.requestId || String(r.clientRequestId ?? "");
    return id.length > 8 ? id.slice(0, 8) : id;
}

function fmtEntry(e: UserFeedbackEntry): string {
    const cat = e.category ? ` ${e.category}` : "";
    const comment = e.comment ? ` — "${e.comment}"` : "";
    return `[${fmtTimestamp(e.timestamp)}] ${ratingGlyph(e.rating)}${cat} (req ${shortReqId(e.requestId)})${comment}`;
}

// ---------------------------------------------------------------------------
// @feedback list
// ---------------------------------------------------------------------------
class FeedbackListCommandHandler implements CommandHandler {
    public readonly description =
        "List recent user-feedback entries (most recent first).";
    public readonly parameters = {
        flags: {
            limit: {
                description: "Maximum number of entries to show",
                type: "number",
                default: 20,
            },
            all: {
                description:
                    "Include every entry; otherwise only the latest rating per request is shown",
                type: "boolean",
                default: false,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        param: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const all = getAllFeedback(systemContext);
        const selected = param.flags.all ? all : reduceToLatest(all);
        // newest-first
        const sorted = [...selected].sort((a, b) => b.timestamp - a.timestamp);
        const limit = Math.max(1, param.flags.limit ?? 20);
        const head = sorted.slice(0, limit);
        if (head.length === 0) {
            displayResult("No user feedback recorded yet.", context);
            return;
        }
        const lines = [
            `${selected.length} entr${selected.length === 1 ? "y" : "ies"} (showing ${head.length}):`,
            ...head.map(fmtEntry),
        ];
        displayResult(lines, context);
    }
}

// ---------------------------------------------------------------------------
// @feedback top
// ---------------------------------------------------------------------------
class FeedbackTopCommandHandler implements CommandHandler {
    public readonly description =
        "Aggregate user feedback — counts by rating and category.";
    public readonly parameters = {
        flags: {
            limit: {
                description: "Top-N depth for the per-category breakdown",
                type: "number",
                default: 10,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        param: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const latest = reduceToLatest(getAllFeedback(systemContext));
        if (latest.length === 0) {
            displayResult("No user feedback recorded yet.", context);
            return;
        }

        let up = 0;
        let down = 0;
        let cleared = 0;
        const byCategory = new Map<string, number>();
        for (const e of latest) {
            if (e.rating === "up") up++;
            else if (e.rating === "down") down++;
            else cleared++;
            if (e.rating === "down" && e.category) {
                byCategory.set(
                    e.category,
                    (byCategory.get(e.category) ?? 0) + 1,
                );
            }
        }

        const limit = Math.max(1, param.flags.limit ?? 10);
        const categories = Array.from(byCategory.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit);

        const lines: string[] = [
            `Total rated requests: ${latest.length}`,
            `  👍 up:      ${up}`,
            `  👎 down:    ${down}`,
            `  cleared:    ${cleared}`,
            "",
            `Top thumbs-down categories (top ${categories.length}):`,
            ...categories.map(
                ([cat, n]) => `  ${n.toString().padStart(4)}  ${cat}`,
            ),
        ];
        displayResult(lines, context);
    }
}

// ---------------------------------------------------------------------------
// @feedback filter
// ---------------------------------------------------------------------------
const ratingValues = ["up", "down", "cleared"] as const;
const categoryValues = [
    "wrong-agent",
    "didnt-understand",
    "bad-response",
    "other",
] as const;

class FeedbackFilterCommandHandler implements CommandHandler {
    public readonly description =
        "Filter feedback by rating, category, and/or date range.";
    public readonly parameters = {
        flags: {
            rating: {
                description: "up | down | cleared",
                type: "string",
            },
            category: {
                description:
                    "wrong-agent | didnt-understand | bad-response | other",
                type: "string",
            },
            since: {
                description:
                    "ISO date (YYYY-MM-DD) — entries on/after this date",
                type: "string",
            },
            until: {
                description:
                    "ISO date (YYYY-MM-DD) — entries on/before this date",
                type: "string",
            },
            limit: {
                description: "Maximum number of entries to show",
                type: "number",
                default: 50,
            },
            all: {
                description:
                    "Include every entry; otherwise only the latest rating per request",
                type: "boolean",
                default: false,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        param: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const all = getAllFeedback(systemContext);
        let entries = param.flags.all ? all : reduceToLatest(all);

        const rating = param.flags.rating?.toLowerCase();
        if (rating !== undefined) {
            if (
                !ratingValues.includes(rating as (typeof ratingValues)[number])
            ) {
                throw new Error(
                    `Invalid --rating "${rating}". Use one of: ${ratingValues.join(", ")}`,
                );
            }
            entries = entries.filter((e) =>
                rating === "cleared" ? e.rating === null : e.rating === rating,
            );
        }
        const category = param.flags.category?.toLowerCase();
        if (category !== undefined) {
            if (
                !categoryValues.includes(
                    category as (typeof categoryValues)[number],
                )
            ) {
                throw new Error(
                    `Invalid --category "${category}". Use one of: ${categoryValues.join(", ")}`,
                );
            }
            entries = entries.filter(
                (e) => e.category === (category as UserFeedbackCategory),
            );
        }
        if (param.flags.since !== undefined) {
            const t = Date.parse(param.flags.since);
            if (isNaN(t)) {
                throw new Error(
                    `--since must be a valid date string (got "${param.flags.since}")`,
                );
            }
            entries = entries.filter((e) => e.timestamp >= t);
        }
        if (param.flags.until !== undefined) {
            const t = Date.parse(param.flags.until);
            if (isNaN(t)) {
                throw new Error(
                    `--until must be a valid date string (got "${param.flags.until}")`,
                );
            }
            // End-of-day on the target date — make the bound inclusive.
            entries = entries.filter((e) => e.timestamp <= t + 86_400_000);
        }
        const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
        const limit = Math.max(1, param.flags.limit ?? 50);
        const head = sorted.slice(0, limit);
        if (head.length === 0) {
            displayResult("No matching feedback entries.", context);
            return;
        }
        const lines = [
            `${entries.length} matching entr${entries.length === 1 ? "y" : "ies"} (showing ${head.length}):`,
            ...head.map(fmtEntry),
        ];
        displayResult(lines, context);
    }
}

// ---------------------------------------------------------------------------
// @feedback export
// ---------------------------------------------------------------------------
class FeedbackExportCommandHandler implements CommandHandler {
    public readonly description =
        "Export user-feedback entries to a local file (JSON or JSONL).";
    public readonly parameters = {
        args: {
            file: {
                description:
                    "Destination path (extension picks the format if --format is omitted: .jsonl → JSONL, anything else → JSON)",
                type: "string",
            },
        },
        flags: {
            format: {
                description: "json | jsonl (overrides the path extension)",
                type: "string",
            },
            all: {
                description:
                    "Include every entry; otherwise only the latest rating per request",
                type: "boolean",
                default: false,
            },
        },
    } as const;
    public async run(
        context: ActionContext<CommandHandlerContext>,
        param: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;
        const all = getAllFeedback(systemContext);
        const entries = param.flags.all ? all : reduceToLatest(all);

        const filename = expandHome(param.args.file);
        await checkOverwriteFile(filename, systemContext);
        const ext = path.extname(filename).toLowerCase();
        const format =
            (param.flags.format?.toLowerCase() as
                | "json"
                | "jsonl"
                | undefined) ?? (ext === ".jsonl" ? "jsonl" : "json");

        let body: string;
        if (format === "jsonl") {
            body = entries.map((e) => JSON.stringify(e)).join("\n");
        } else {
            body = JSON.stringify(entries, null, 2);
        }
        await fs.promises.writeFile(filename, body, "utf-8");
        displayResult(
            `Wrote ${entries.length} feedback entr${entries.length === 1 ? "y" : "ies"} to ${filename} (${format}).`,
            context,
        );
    }
}

// ---------------------------------------------------------------------------
// @feedback clear
// ---------------------------------------------------------------------------
class FeedbackCountCommandHandler implements CommandHandlerNoParams {
    public readonly description = "Show the total number of feedback entries.";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const systemContext = context.sessionContext.agentContext;
        const all = getAllFeedback(systemContext);
        const latest = reduceToLatest(all);
        displayResult(
            `${all.length} total entr${all.length === 1 ? "y" : "ies"} (${latest.length} unique request${latest.length === 1 ? "" : "s"}).`,
            context,
        );
    }
}

export function getFeedbackCommandHandlers(): CommandHandlerTable {
    return {
        description: "Inspect and export user-feedback entries",
        defaultSubCommand: "list",
        commands: {
            list: new FeedbackListCommandHandler(),
            top: new FeedbackTopCommandHandler(),
            filter: new FeedbackFilterCommandHandler(),
            export: new FeedbackExportCommandHandler(),
            count: new FeedbackCountCommandHandler(),
        },
    };
}
