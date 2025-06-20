// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

/**
 * Enhanced slash command handler that properly detects and executes typed commands
 */
export const slashCommandHandler = $prose((_ctx) => {
    return new Plugin({
        key: new PluginKey("slash-command-handler"),

        props: {
            handleKeyDown(view: any, event: any) {
                // Only handle Enter key
                if (event.key !== "Enter") {
                    return false;
                }

                const { state } = view;
                const { selection } = state;
                const { $from } = selection;

                // Get the current line content
                const lineStart = $from.start($from.depth);
                const lineEnd = $from.end($from.depth);
                const lineText = state.doc.textBetween(lineStart, lineEnd);

                // Check for various slash commands
                const commands = [
                    {
                        pattern: /^\/test:continue\s*$/,
                        handler: () => {
                            executeSlashCommand(
                                "continue",
                                {},
                                true,
                                view,
                                lineStart,
                                lineEnd,
                            );
                        },
                    },
                    {
                        pattern: /^\/continue\s*$/,
                        handler: () => {
                            executeSlashCommand(
                                "continue",
                                {},
                                false,
                                view,
                                lineStart,
                                lineEnd,
                            );
                        },
                    },
                    {
                        pattern: /^\/test:diagram(?:\s+(.+))?\s*$/,
                        handler: (match: RegExpMatchArray) => {
                            const description =
                                match[1]?.trim() || "test diagram";
                            executeSlashCommand(
                                "diagram",
                                { description },
                                true,
                                view,
                                lineStart,
                                lineEnd,
                            );
                        },
                    },
                    {
                        pattern: /^\/diagram\s+(.+)\s*$/,
                        handler: (match: RegExpMatchArray) => {
                            const description = match[1]?.trim();
                            executeSlashCommand(
                                "diagram",
                                { description },
                                false,
                                view,
                                lineStart,
                                lineEnd,
                            );
                        },
                    },
                    {
                        pattern: /^\/test:augment(?:\s+(.+))?\s*$/,
                        handler: (match: RegExpMatchArray) => {
                            const instruction =
                                match[1]?.trim() || "improve formatting";
                            executeSlashCommand(
                                "augment",
                                { instruction },
                                true,
                                view,
                                lineStart,
                                lineEnd,
                            );
                        },
                    },
                    {
                        pattern: /^\/augment\s+(.+)\s*$/,
                        handler: (match: RegExpMatchArray) => {
                            const instruction = match[1]?.trim();
                            executeSlashCommand(
                                "augment",
                                { instruction },
                                false,
                                view,
                                lineStart,
                                lineEnd,
                            );
                        },
                    },
                ];

                // Check each command pattern
                for (const command of commands) {
                    const match = lineText.match(command.pattern);
                    if (match) {
                        // Prevent default Enter behavior
                        event.preventDefault();
                        command.handler(match);
                        return true;
                    }
                }

                return false;
            },
        },
    });
});

/**
 * Execute a slash command by removing the command text and triggering the appropriate action
 */
async function executeSlashCommand(
    command: string,
    params: any,
    testMode: boolean,
    view: any,
    lineStart: number,
    lineEnd: number,
) {
    // Remove the command line
    const tr = view.state.tr.delete(lineStart, lineEnd);
    view.dispatch(tr);

    // Get cursor position after deletion
    const newPos = lineStart;

    // Build the agent request
    const requestParams = {
        position: newPos,
        testMode,
        ...params,
    };

    // For test mode commands, only trigger the backend - don't create any frontend content
    // This prevents duplicate content creation between frontend and backend

    // Use the existing executeAgentCommand function
    setTimeout(() => {
        if (
            typeof window !== "undefined" &&
            (window as any).executeAgentCommand
        ) {
            (window as any).executeAgentCommand(command, requestParams);
        } else {
            console.error("executeAgentCommand not available on window");
        }
    }, 100);
}

/**
 * Visual feedback for slash commands as user types
 */
export const slashCommandPreview = $prose(() => {
    return new Plugin({
        key: new PluginKey("slash-command-preview"),

        state: {
            init() {
                return DecorationSet.empty;
            },
            apply(tr: any, decorationSet: DecorationSet) {
                return decorationSet.map(tr.mapping, tr.doc);
            },
        },

        props: {
            decorations(state: any) {
                const { selection } = state;
                const { $from } = selection;

                // Only show preview if cursor is at end of line
                if (!selection.empty) return DecorationSet.empty;

                const lineStart = $from.start($from.depth);
                const lineEnd = $from.end($from.depth);
                const lineText = state.doc.textBetween(lineStart, lineEnd);
                const cursorPos = selection.head;

                // Check if cursor is at the end of the line
                if (cursorPos !== lineEnd) return DecorationSet.empty;

                // Define command patterns for styling
                const commandPatterns = [
                    {
                        pattern: /^(\/test:continue)(\s+(.+))?$/,
                        commandEnd: 14, // "/test:continue".length
                    },
                    {
                        pattern: /^(\/continue)(\s+(.+))?$/,
                        commandEnd: 9, // "/continue".length
                    },
                    {
                        pattern: /^(\/test:diagram)(\s+(.+))?$/,
                        commandEnd: 13, // "/test:diagram".length
                    },
                    {
                        pattern: /^(\/diagram)(\s+(.+))?$/,
                        commandEnd: 8, // "/diagram".length
                    },
                    {
                        pattern: /^(\/test:augment)(\s+(.+))?$/,
                        commandEnd: 13, // "/test:augment".length
                    },
                    {
                        pattern: /^(\/augment)(\s+(.+))?$/,
                        commandEnd: 8, // "/augment".length
                    },
                ];

                let decorations: Decoration[] = [];

                for (const cmd of commandPatterns) {
                    const match = lineText.match(cmd.pattern);
                    if (match) {
                        // Style the command part
                        const commandDecoration = Decoration.inline(
                            lineStart,
                            lineStart + cmd.commandEnd,
                            { class: "slash-command-name" },
                        );
                        decorations.push(commandDecoration);

                        // Style the instruction part if it exists
                        if (match[3]) {
                            // The instruction part
                            const instructionStart =
                                lineStart +
                                match[1].length +
                                (match[2].length - match[3].length);
                            const instructionEnd = lineStart + lineText.length;
                            const instructionDecoration = Decoration.inline(
                                instructionStart,
                                instructionEnd,
                                { class: "slash-command-instruction" },
                            );
                            decorations.push(instructionDecoration);
                        }
                        break;
                    }
                }

                return DecorationSet.create(state.doc, decorations);
            },
        },
    });
});
