// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Clipboard writes that work across the hosts.
 *
 * `navigator.clipboard` is missing or rejects in some of the contexts the
 * chat UI runs in (older webviews, non-secure origins, denied permission),
 * so every copy affordance goes through here and falls back to the
 * `execCommand` textarea trick.
 */

/** Copy `text`, returning whether it made it to the clipboard. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
    if (!text) {
        return false;
    }
    if (navigator.clipboard?.writeText !== undefined) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            // Fall through to the legacy path.
        }
    }
    return fallbackCopy(text);
}

function fallbackCopy(text: string): boolean {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    let copied = false;
    try {
        copied = document.execCommand("copy");
    } catch {
        // Best-effort; nothing more to do.
    }
    ta.remove();
    return copied;
}
