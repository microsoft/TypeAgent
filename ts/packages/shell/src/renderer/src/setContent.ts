// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AnsiUp } from "ansi_up";
import {
    DisplayAppendMode,
    DisplayContent,
    DisplayType,
    DisplayMessageKind,
    MessageContent,
} from "@typeagent/agent-sdk";
import DOMPurify from "dompurify";
import { SettingsView } from "./settingsView";

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
function processContent(content: string, type: string): string {
    return type === "html"
        ? DOMPurify.sanitize(content, {
              ADD_ATTR: ["target", "onclick", "onerror"],
              ADD_DATA_URI_TAGS: ["img"],
              ADD_URI_SAFE_ATTR: ["src"],
          })
        : enableText2Html
          ? textToHtml(content)
          : stripAnsi(encodeTextToHtml(content));
}

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

function messageContentToHTML(
    message: MessageContent,
    type: DisplayType,
): string {
    if (typeof message === "string") {
        return processContent(message, type);
    }

    if (message.length === 0) {
        return "";
    }

    if (typeof message[0] === "string") {
        return (message as string[])
            .map((s) => processContent(s, type))
            .join("<br>");
    }

    const table = message as string[][];
    return `<table class="table-message">${table.map((row, i) => `<tr>${row.map((cell) => `${i === 0 ? "<th>" : "<td>"}${processContent(cell, type)}${i === 0 ? "</th>" : "</td>"}`).join("")}</tr>`).join("")}</table>`;
}

export function setContent(
    elm: HTMLElement,
    content: DisplayContent,
    settingsView: SettingsView,
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
    let message: MessageContent;
    let speak: boolean;
    if (typeof content === "string" || Array.isArray(content)) {
        type = "text";
        message = content;
        speak = false;
    } else {
        type = content.type;
        message = content.content;
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
    if (!settingsView.isDisplayTypeAllowed(type)) {
        contentElm.innerText = `The supplied content type (${type}) is not allowed by the configured settings.`;
        return contentElm.innerText;
    }

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
    const contentHtml = messageContentToHTML(message, type);

    // if the agent wants to show script we need to do that in isolation so create an iframe
    // and put both the script and supplied HTML into it
    if (type === "iframe") {
        const iframe: HTMLIFrameElement = document.createElement("iframe");
        iframe.sandbox.add("allow-scripts");
        iframe.classList.add("host-frame");

        // use the same stylesheets as the main page
        let css: string = "";
        const links = document.head.getElementsByTagName("link");
        for (let i = 0; i < links.length; i++) {
            if (links[i].rel.toLowerCase() == "stylesheet") {
                css += links[i].outerHTML;
            }
        }

        iframe.srcdoc = `<html>
        <head>
        ${css}
        </head>
        <body style="height: auto; overflow: hidden;">${message}</body></html>`;

        // give the iframe the same stylesheet as the host page

        contentElm.appendChild(iframe);
    } else {
        // vanilla, sanitized HTML only
        contentElm.innerHTML += contentHtml;
    }

    if (!speak) {
        return undefined;
    }
    if (type === "text") {
        if (typeof message === "string") {
            return stripAnsi(message);
        }
        if (message.length === 0) {
            return undefined;
        }
        if (typeof message[0] === "string") {
            return message.join("\n");
        }
        return message.map((row) => row.join("\t")).join("\n");
    }

    if (newDiv) {
        return contentElm.innerText;
    }

    const parser = new DOMParser();
    return parser.parseFromString(contentHtml, "text/html").body.innerText;
}
