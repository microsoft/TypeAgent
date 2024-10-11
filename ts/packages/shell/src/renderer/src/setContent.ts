// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnsiUp } from "ansi_up";
import {
    DisplayAppendMode,
    DisplayContent,
    DisplayType,
    DisplayMessageKind,
} from "@typeagent/agent-sdk";
import DOMPurify from "dompurify";

const ansi_up = new AnsiUp();
ansi_up.use_classes = true;

function textToHtml(text: string): string {
    const value = ansi_up.ansi_to_html(text);
    const line = value.replace(/\n/gm, "<br>");
    return line;
}

function stripAnsi(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function encodeTextToHtml(text: string): string {
    return text
        .replace(/&/gm, "&amp;")
        .replace(/</gm, "&lt;")
        .replace(/>/gm, "&gt;");
}

const enableText2Html = true;

function matchKindStyle(elm: HTMLElement, kindStyle?: string) {
    if (kindStyle !== undefined) {
        return elm.classList.contains(kindStyle);
    }
    for (const cls of elm.classList) {
        if (cls.startsWith("chat-message-kind-")) {
            return false;
        }
    }
    return true;
}

export function setContent(
    elm: HTMLElement,
    content: DisplayContent,
    appendMode?: DisplayAppendMode,
): string | undefined {
    // Remove existing content if we are not appending.
    if (appendMode === undefined) {
        while (elm.firstChild) {
            elm.removeChild(elm.firstChild);
        }
    }

    let type: DisplayType;
    let kind: DisplayMessageKind | undefined;
    let text: string;
    let speak: boolean;
    if (typeof content === "string") {
        type = "text";
        text = content;
        speak = false;
    } else {
        type = content.type;
        text = content.content;
        kind = content.kind;
        speak = content.speak ?? false;
    }

    const kindStyle = kind ? `chat-message-kind-${kind}` : undefined;

    let contentDiv = elm.lastChild as HTMLDivElement | null;
    let newDiv = true;
    if (
        appendMode !== "inline" ||
        !contentDiv ||
        !matchKindStyle(contentDiv, kindStyle)
    ) {
        // Create a new div
        contentDiv = document.createElement("div");
        if (kindStyle) {
            contentDiv.classList.add(kindStyle);
        }
        if (appendMode === "inline") {
            contentDiv.style.display = "inline-block";
        }
        elm.appendChild(contentDiv);
        newDiv = false;
    }

    let contentElm: HTMLElement = contentDiv;
    if (type === "text") {
        const prevElm = contentDiv.lastChild as HTMLElement | null;
        if (prevElm?.classList.contains("chat-message-agent-text")) {
            // If there is an existing text element then append to it.
            contentElm = prevElm;
        } else {
            const span = document.createElement("span");
            // create a text span so we can set "whitespace: break-spaces" css style of text content.
            span.className = `chat-message-agent-text`;
            contentDiv.appendChild(span);
            contentElm = span;
        }
    }

    // Process content according to type
    const contentHtml =
        type === "html"
            ? DOMPurify.sanitize(text, {
                  ADD_ATTR: ["target", "onclick", "onerror"],
                  ADD_DATA_URI_TAGS: ["img"],
                  ADD_URI_SAFE_ATTR: ["src"],
              })
            : enableText2Html
              ? textToHtml(text)
              : stripAnsi(encodeTextToHtml(text));

    // if the agent wants to show script we need to do that in isolation so create an iframe
    // and put both the script and supplied HTML into it
    if (type === "iframe") {
        const iframe: HTMLIFrameElement = document.createElement("iframe");
        iframe.sandbox.add("allow-scripts");
        iframe.classList.add("host-frame");
        iframe.srcdoc = `<html>
        <head>
        <link href="./assets/styles.less" type="text/css" rel="stylesheet">
        <link href="./assets/carousel.less" type="text/css" rel="stylesheet">
        </head>
        <body style="height: auto; overflow: hidden;">${text}</body></html>`;

        contentElm.appendChild(iframe);
    } else {
        // vanilla, sanitized HTML only
        contentElm.innerHTML += contentHtml;
    }

    if (!speak) {
        return undefined;
    }
    if (type === "text") {
        return stripAnsi(text);
    }

    if (newDiv) {
        return contentElm.innerText;
    }

    const parser = new DOMParser();
    return parser.parseFromString(contentHtml, "text/html").body.innerText;
}
