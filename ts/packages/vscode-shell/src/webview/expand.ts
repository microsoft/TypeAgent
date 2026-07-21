// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Standalone "expanded message" webview. Runs in a separate VS Code editor
// panel (which the user can move/snap) and shows one chat message's rendered
// content at full size. The extension host sends the (already-sanitized)
// content over postMessage; we re-sanitize with DOMPurify before rendering as
// defense in depth, so no HTML is constructed from input on the extension side.

import DOMPurify from "dompurify";
import chatPanelStyles from "chat-ui/styles";
import vscodeThemeStyles from "./vscode-theme.css";
import { injectStyle } from "./injectStyle.js";

injectStyle(chatPanelStyles as unknown as string);
injectStyle(vscodeThemeStyles as unknown as string);

const vscode = acquireVsCodeApi();

const root = document.getElementById("expand-root")!;

window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg && msg.type === "expandContent" && typeof msg.html === "string") {
        root.innerHTML = DOMPurify.sanitize(msg.html, {
            ADD_ATTR: ["target"],
        }) as string;
        // This is a static read view: reveal rows hidden behind a table's
        // "Show more" pager and drop the now-dead pager/sort controls so the
        // full content is readable.
        root.querySelectorAll(".sc-row-hidden").forEach((r) =>
            r.classList.remove("sc-row-hidden"),
        );
        root.querySelectorAll(".sc-show-more, .sc-sort-btn").forEach((b) =>
            b.remove(),
        );
    }
});

// Links can't navigate inside this static panel; hand them to the host.
root.addEventListener("click", (event) => {
    const anchor = (event.target as HTMLElement | null)?.closest("a");
    const href = anchor?.getAttribute("href");
    if (href && /^(https?|mailto):/i.test(href)) {
        event.preventDefault();
        vscode.postMessage({ type: "openExternal", href });
    }
});

// Signal the host that we're ready to receive the content.
vscode.postMessage({ type: "expandReady" });
