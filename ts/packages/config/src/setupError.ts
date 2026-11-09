// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { configSetupHint, type ConfigHintVar } from "./hints.js";

/**
 * Thrown when an agent can't run because required settings are missing
 * from the config files.
 *
 * `message` is the one-line plain-text summary that logs and non-display
 * consumers see. `markdown` carries the full actionable version — the file
 * link and the YAML snippet to paste — which only reads correctly when
 * rendered as markdown. The chat hosts pick `markdown` up (it survives the
 * agent-process RPC boundary) and fall back to `message` when they can't
 * render markdown.
 */
export class ConfigSetupError extends Error {
    public readonly markdown: string;
    constructor(message: string, markdown: string) {
        super(message);
        this.name = "ConfigSetupError";
        this.markdown = markdown;
    }
}

/**
 * A `ConfigSetupError` whose markdown is the summary followed by the
 * standard "add this to config.local.yaml" hint for `vars`.
 */
export function configSetupError(
    message: string,
    vars: ConfigHintVar[],
    note?: string,
): ConfigSetupError {
    return new ConfigSetupError(
        message,
        `${message}\n\n${configSetupHint(vars, note)}`,
    );
}

/**
 * The markdown an error wants displayed, or undefined when it carries none
 * (in which case callers should fall back to the plain message).
 *
 * Duck-typed rather than an `instanceof` check: errors are rebuilt on the
 * far side of the agent RPC boundary, and more than one package defines a
 * markdown-carrying error.
 */
export function getErrorMarkdown(e: unknown): string | undefined {
    const markdown = (e as { markdown?: unknown } | undefined)?.markdown;
    return typeof markdown === "string" && markdown.length > 0
        ? markdown
        : undefined;
}
