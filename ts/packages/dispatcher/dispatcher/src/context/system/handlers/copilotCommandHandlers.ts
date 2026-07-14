// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionContext, ParsedCommandParams } from "@typeagent/agent-sdk";
import {
    CommandHandler,
    CommandHandlerNoParams,
    CommandHandlerTable,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayStatus,
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DisplayLogEntry } from "@typeagent/dispatcher-types";
import { FullAction, toExecutableActions } from "agent-cache";
import { CommandHandlerContext } from "../../commandHandlerContext.js";
import { executeActions } from "../../../execute/actionHandlers.js";
import { askYesNoWithContext } from "../../interactiveIO.js";

class CopilotImportCommandHandler implements CommandHandlerNoParams {
    public readonly description =
        "Import GitHub Copilot Chat sessions as conversation mirrors";
    public async run(context: ActionContext<CommandHandlerContext>) {
        const importCopilot = context.sessionContext.agentContext.copilotImport;
        if (importCopilot === undefined) {
            // No ConversationManager behind this host (e.g. standalone local
            // mode) — importing isn't possible here.
            displayWarn(
                "Importing GitHub Copilot sessions is not supported in this session.",
                context,
            );
            return;
        }

        // Progress and result stream to the user through clientIO, so this
        // renders in the chat for every client (Electron shell, VS Code, CLI).
        displayStatus("Reading GitHub Copilot session store…", context);
        try {
            const summary = await importCopilot((progress) => {
                displayStatus(
                    `Importing GitHub Copilot sessions ${progress.current}/${progress.total}: ${progress.name}`,
                    context,
                );
            });

            if (summary.total === 0) {
                displayWarn(
                    "No GitHub Copilot sessions found to import.",
                    context,
                );
                return;
            }

            const parts = [`${summary.imported} imported`];
            if (summary.renamed > 0) {
                parts.push(`${summary.renamed} renamed`);
            }
            if (summary.skipped > 0) {
                parts.push(`${summary.skipped} already imported`);
            }
            if (summary.failed > 0) {
                parts.push(`${summary.failed} failed`);
            }
            displaySuccess(
                `GitHub Copilot import complete: ${parts.join(", ")}.`,
                context,
            );
        } catch (e) {
            throw new Error(
                `Failed to import GitHub Copilot sessions: ${
                    e instanceof Error ? e.message : String(e)
                }`,
            );
        }
    }
}

// Runtime schema name for the code agent's in-editor action sub-schema. The
// manifest sub-action key ("code-editor") is dot-prefixed with the parent
// "code" agent name by the dispatcher, so the runtime schemaName is
// "code.code-editor" (see codeActionHandler.ts for the same convention).
const codeEditorSchemaName = "code.code-editor";
const launchCopilotChatActionName = "launchCopilotChat";

type FixMode = "agent" | "ask";
type DevCaptureMode = "auto" | "on" | "off";

function normalizeMode(value: string): FixMode {
    return value === "ask" ? "ask" : "agent";
}

function normalizeDevCaptureMode(value: string): DevCaptureMode {
    if (value === "on" || value === "off") {
        return value;
    }
    return "auto";
}

type ChatSessionLocation = "view" | "editor" | "window";

function normalizeChatSessionLocation(value: string): ChatSessionLocation {
    return value === "view" || value === "window" ? value : "editor";
}

// Sanitize a request id the same way DevTrace names capture files, so a
// request id from the display log can be matched against the files on disk.
function safeRequestId(requestId: string): string {
    return requestId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// The most recent request id carried on any display-log entry — used to
// correlate the failing request with its developer-mode capture file(s).
function getLatestRequestId(entries: DisplayLogEntry[]): string | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as DisplayLogEntry & {
            requestId?: { requestId?: string };
        };
        const id = entry.requestId?.requestId;
        if (id !== undefined && id !== "") {
            return id;
        }
    }
    return undefined;
}

// Collect the developer-mode translation capture(s) for the failing request.
// Prefer captures whose file name matches the latest request id; otherwise
// fall back to the single most-recent capture by modification time.
async function selectDevCaptures(
    sessionDirPath: string,
    entries: DisplayLogEntry[],
): Promise<string[]> {
    const captureDir = path.join(sessionDirPath, "dev-captures");
    let files: string[];
    try {
        files = (await fs.promises.readdir(captureDir)).filter(
            (name) => name.startsWith("translate-") && name.endsWith(".json"),
        );
    } catch {
        // No dev-captures directory yet.
        return [];
    }
    if (files.length === 0) {
        return [];
    }

    const latestRequestId = getLatestRequestId(entries);
    if (latestRequestId !== undefined) {
        const suffix = `-${safeRequestId(latestRequestId)}.json`;
        const matches = files.filter((name) => name.endsWith(suffix));
        if (matches.length > 0) {
            return matches.map((name) => path.join(captureDir, name));
        }
    }

    // Fall back to the most-recently modified capture.
    const withMtime = await Promise.all(
        files.map(async (name) => {
            const filePath = path.join(captureDir, name);
            try {
                const stat = await fs.promises.stat(filePath);
                return { filePath, mtime: stat.mtimeMs };
            } catch {
                return { filePath, mtime: 0 };
            }
        }),
    );
    withMtime.sort((a, b) => b.mtime - a.mtime);
    return [withMtime[0].filePath];
}

function composeQuery(
    instructions: string | undefined,
    entryCount: number,
    captureCount: number,
    includeScreenshot: boolean,
): string {
    const lines: string[] = [];
    if (instructions !== undefined && instructions.trim().length > 0) {
        lines.push(instructions.trim());
        lines.push("");
    }
    const parts: string[] = [
        "The attached files capture a TypeAgent session that ran into a problem.",
        `\`conversation.json\` is the full raw conversation log (${entryCount} entries: user requests, agent responses, errors, command results).`,
    ];
    if (captureCount > 0) {
        parts.push(
            `The remaining ${captureCount} JSON file(s) are developer-mode translation captures (the request, history context, resolved actions and the full model prompt(s)) for the failing request.`,
        );
    }
    if (includeScreenshot) {
        parts.push(
            "A screenshot of the current VS Code window is also attached.",
        );
    }
    parts.push(
        "Please diagnose the underlying problem and fix it in this workspace.",
    );
    lines.push(parts.join(" "));
    return lines.join("\n");
}

function describeAttachments(
    entryCount: number,
    captureCount: number,
    includeScreenshot: boolean,
): string {
    const parts = [`${entryCount} conversation entries`];
    if (captureCount > 0) {
        parts.push(
            `${captureCount} developer capture${captureCount === 1 ? "" : "s"}`,
        );
    }
    if (includeScreenshot) {
        parts.push("a screenshot");
    }
    return `Sending ${parts.join(", ")}.`;
}

class FixWithCopilotCommandHandler implements CommandHandler {
    public readonly description =
        "Hand the current conversation to GitHub Copilot Chat in VS Code to diagnose and fix";
    public readonly parameters = {
        args: {
            instructions: {
                description:
                    "Optional extra instructions to include in the Copilot prompt",
                implicitQuotes: true,
                optional: true,
            },
        },
        flags: {
            mode: {
                description:
                    "Copilot chat mode: 'agent' (can edit the workspace) or 'ask'",
                type: "string",
                default: "agent",
            },
            "no-screenshot": {
                description: "Do not attach a screenshot of the VS Code window",
                type: "boolean",
                default: false,
            },
            "dev-captures": {
                description:
                    "Include developer-mode translation captures: 'auto' (when developer mode is on), 'on', or 'off'",
                type: "string",
                default: "auto",
            },
            target: {
                description:
                    "Copilot target (reserved; only native GitHub Copilot is supported)",
                type: "string",
                default: "native",
            },
            "no-send": {
                description:
                    "Pre-fill the Copilot prompt but do not auto-submit it (review before sending)",
                type: "boolean",
                default: false,
            },
            "reuse-session": {
                description:
                    "Send into the current Copilot Chat session instead of starting a new one",
                type: "boolean",
                default: false,
            },
            location: {
                description:
                    "Where to open the new session: 'editor' (new chat editor), 'view' (chat panel), or 'window' (separate chat window)",
                type: "string",
                default: "editor",
            },
        },
    } as const;

    public async run(
        context: ActionContext<CommandHandlerContext>,
        params: ParsedCommandParams<typeof this.parameters>,
    ) {
        const systemContext = context.sessionContext.agentContext;

        // The handoff runs through the code agent → Coda bridge, so the code
        // agent's in-editor sub-schema must be active in this session.
        if (!systemContext.agents.isActionActive(codeEditorSchemaName)) {
            displayWarn(
                "The 'code' agent is not enabled. Open VS Code with the TypeAgent/Coda extension and enable it with '@config agent code' before running '@copilot fix'.",
                context,
            );
            return;
        }

        const mode = normalizeMode(params.flags.mode);
        if (params.flags.target !== "native") {
            displayWarn(
                `--target '${params.flags.target}' is reserved; using native GitHub Copilot.`,
                context,
            );
        }
        const includeScreenshot = params.flags["no-screenshot"] !== true;
        const devCaptureMode = normalizeDevCaptureMode(
            params.flags["dev-captures"],
        );
        const autoSend = params.flags["no-send"] !== true;
        const newSession = params.flags["reuse-session"] !== true;
        const newSessionLocation = normalizeChatSessionLocation(
            params.flags.location,
        );

        // 1. Raw conversation from the display log — the same source the chat
        // UI replays on reload.
        const entries = systemContext.displayLog.getEntries();
        if (entries.length === 0) {
            displayWarn(
                "There is no conversation to hand to Copilot yet.",
                context,
            );
            return;
        }

        // 2. Developer-mode translation captures for the failing request(s).
        const includeDevCaptures =
            devCaptureMode === "on" ||
            (devCaptureMode === "auto" && systemContext.developerMode === true);
        const sessionDirPath = systemContext.session.getSessionDirPath();
        const captureFiles =
            includeDevCaptures && sessionDirPath !== undefined
                ? await selectDevCaptures(sessionDirPath, entries)
                : [];

        // Serialize the conversation to a temp dir the co-located Coda
        // extension can read (v1 assumes dispatcher and Coda share a machine).
        displayStatus("Preparing conversation for Copilot…", context);
        const tmpDir = path.join(os.tmpdir(), "typeagent-copilot-fix");
        await fs.promises.mkdir(tmpDir, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const conversationFile = path.join(
            tmpDir,
            `conversation-${timestamp}.json`,
        );
        await fs.promises.writeFile(
            conversationFile,
            JSON.stringify(entries, null, 2),
            "utf-8",
        );

        const attachFiles = [conversationFile, ...captureFiles];

        // 3. Compose the pre-filled prompt.
        const query = composeQuery(
            params.args.instructions,
            entries.length,
            captureFiles.length,
            includeScreenshot,
        );

        // Confirm before sending — the context can be large, and (with
        // auto-send in agent mode) Copilot may start editing the workspace.
        const sendNote = autoSend ? " It will be submitted automatically." : "";
        if (
            !(await askYesNoWithContext(
                systemContext,
                `Hand this conversation to GitHub Copilot Chat (${mode} mode)?${sendNote} ${describeAttachments(
                    entries.length,
                    captureFiles.length,
                    includeScreenshot,
                )}`,
                true,
            ))
        ) {
            displayWarn("Cancelled '@copilot fix'.", context);
            return;
        }

        // 4. Launch native Copilot Chat via the code agent → Coda bridge.
        displayStatus("Opening GitHub Copilot Chat in VS Code…", context);
        const action: FullAction = {
            schemaName: codeEditorSchemaName,
            actionName: launchCopilotChatActionName,
            parameters: {
                query,
                mode,
                isPartialQuery: !autoSend,
                attachScreenshot: includeScreenshot,
                attachFiles,
                newSession,
                newSessionLocation,
            },
        };

        const error = await executeActions(
            toExecutableActions([action]),
            undefined,
            context,
        );
        if (error !== undefined) {
            // The underlying error was already surfaced to the user; add
            // guidance for the common "Coda not connected" case.
            displayWarn(
                "Could not open GitHub Copilot Chat. Make sure VS Code with the TypeAgent/Coda extension is open in the same window.",
                context,
            );
            return;
        }

        // Don't print a success line here. The definitive outcome (✅ opened /
        // ❌ Copilot Chat unavailable / open failed) is only known inside the
        // Coda handler, which renders it via the action display. The bridge
        // collapses success and in-VS-Code failures into the same "no error"
        // result, so a success message here could contradict a "❌ …" message
        // from Coda. Leave the outcome messaging to the side that knows what
        // actually happened.
    }
}

export function getCopilotCommandHandlers(): CommandHandlerTable {
    return {
        description: "GitHub Copilot session commands",
        defaultSubCommand: "import",
        commands: {
            import: new CopilotImportCommandHandler(),
            fix: new FixWithCopilotCommandHandler(),
        },
    };
}
