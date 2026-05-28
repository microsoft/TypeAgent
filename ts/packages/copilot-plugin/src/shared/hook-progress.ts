// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Hook progress protocol helpers.
 *
 * Copilot CLI hooks communicate progress to the CLI timeline by writing
 * NDJSON lines to stdout. Lines matching `{"type":"progress","message":"..."}`
 * are intercepted by the CLI's hook executor and displayed as ephemeral
 * info entries; all other stdout content is treated as the hook response.
 *
 * IMPORTANT: Progress lines must be complete (terminated by \n) and must
 * be valid JSON. Partial lines or malformed JSON will be treated as normal
 * stdout output and corrupt the hook response.
 */

/**
 * Write a progress message to stdout using the Copilot CLI hook progress protocol.
 * The message appears as a transient info entry in the CLI timeline.
 */
export function emitProgress(message: string): void {
    process.stdout.write(
        JSON.stringify({ type: "progress", message }) + "\n",
    );
}
