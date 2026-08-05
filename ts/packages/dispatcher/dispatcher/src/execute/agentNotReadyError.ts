// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayContent } from "@typeagent/agent-sdk";

/**
 * Thrown by the readiness pre-flight gate when an agent can't run yet.
 *
 * `message` stays a single plain-text line (what non-display consumers and
 * logs see). `markdown` optionally carries the actionable setup instructions
 * — which file to edit and the config snippet to paste — which only render
 * correctly as markdown, since plain-text display collapses indentation.
 */
export class AgentNotReadyError extends Error {
    public readonly markdown: string | undefined;
    constructor(message: string, markdown?: string) {
        super(message);
        this.name = "AgentNotReadyError";
        this.markdown = markdown;
    }
}

/**
 * The rich error display for a thrown value, or undefined when it carries
 * none (in which case callers should fall back to the plain message).
 */
export function getErrorDisplayContent(e: unknown): DisplayContent | undefined {
    const markdown =
        e instanceof AgentNotReadyError ? e.markdown : (undefined as undefined);
    return markdown === undefined
        ? undefined
        : { type: "markdown", content: markdown, kind: "error" };
}
