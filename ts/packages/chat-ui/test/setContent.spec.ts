// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { setContent } from "../src/setContent.js";
import {
    defaultChatSettings,
    PlatformAdapter,
} from "../src/platformAdapter.js";

// setContent renders DisplayContent into the DOM; these run under jsdom.
function render(
    content: Parameters<typeof setContent>[1],
    adapter?: PlatformAdapter,
): HTMLElement {
    const elm = document.createElement("div");
    setContent(
        elm,
        content,
        defaultChatSettings,
        "agent",
        adapter ?? { handleLinkClick() {} },
    );
    return elm;
}

afterEach(() => {
    document.body.replaceChildren();
});

describe("setContent markdown linkification", () => {
    it("turns a bare https URL into a clickable link", () => {
        const elm = render({
            type: "markdown",
            content: "See https://aka.ms/typeagent for details.",
        });
        const link = elm.querySelector<HTMLAnchorElement>("a[href]");
        expect(link).not.toBeNull();
        expect(link!.getAttribute("href")).toBe("https://aka.ms/typeagent");
        // Links open in a new tab.
        expect(link!.getAttribute("target")).toBe("_blank");
    });

    it("routes a linkified URL click to the platform adapter", () => {
        const handleLinkClick = jest.fn();
        const elm = render(
            {
                type: "markdown",
                content: "Docs: https://example.org/guide",
            },
            { handleLinkClick },
        );
        const link = elm.querySelector<HTMLAnchorElement>("a[href]")!;
        link.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        expect(handleLinkClick).toHaveBeenCalledWith(
            "https://example.org/guide",
            "_blank",
        );
    });

    it("preserves explicit markdown links", () => {
        const elm = render({
            type: "markdown",
            content: "[the docs](https://example.org/docs)",
        });
        const link = elm.querySelector<HTMLAnchorElement>("a[href]");
        expect(link?.getAttribute("href")).toBe("https://example.org/docs");
        expect(link?.textContent).toBe("the docs");
    });

    it("does not linkify bare tokens that merely look like domains", () => {
        // Fuzzy linking is disabled, so filenames / package names that share
        // a TLD-looking suffix (README.md, example.com in prose) stay plain
        // text rather than becoming spurious links.
        const elm = render({
            type: "markdown",
            content: "Edit README.md then publish to example.com.",
        });
        expect(elm.querySelector("a[href]")).toBeNull();
    });

    it("does not linkify inside inline code spans", () => {
        const elm = render({
            type: "markdown",
            content: "Run `curl https://example.org` to test.",
        });
        expect(elm.querySelector("a[href]")).toBeNull();
        expect(elm.querySelector("code")?.textContent).toBe(
            "curl https://example.org",
        );
    });
});

describe("setContent local-file links", () => {
    it("keeps typeagent-file links and routes clicks to the adapter", () => {
        const handleLinkClick = jest.fn();
        const href = "typeagent-file:///d:/repo/ts/config.local.yaml";
        const elm = render(
            {
                type: "markdown",
                content: `Edit [\`config.local.yaml\`](<${href}>)`,
            },
            { handleLinkClick },
        );
        const link = elm.querySelector<HTMLAnchorElement>("a[href]");
        // The sanitizer allows the scheme through...
        expect(link?.getAttribute("href")).toBe(href);
        link!.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        // ...and the host decides how to open it.
        expect(handleLinkClick).toHaveBeenCalledWith(href, expect.anything());
    });
});

describe("setContent code blocks", () => {
    const yaml = "```yaml\nspotify:\n  clientId: <value>\n```";

    function clickCopy(elm: HTMLElement): void {
        elm.querySelector<HTMLButtonElement>("button.chat-code-copy")!.click();
    }

    it("adds a copy button to fenced code blocks", () => {
        const elm = render({ type: "markdown", content: yaml });
        const pre = elm.querySelector("pre");
        expect(pre?.classList.contains("chat-code-block")).toBe(true);
        expect(pre?.querySelector("button.chat-code-copy")).not.toBeNull();
    });

    it("copies the block's text without the button's own markup", async () => {
        const writeText = jest.fn(async () => {});
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
        });
        const elm = render({ type: "markdown", content: yaml });
        document.body.appendChild(elm);
        clickCopy(elm);
        expect(writeText).toHaveBeenCalledWith(
            "spotify:\n  clientId: <value>\n",
        );
    });

    it("still copies after more content is appended", () => {
        // setContent appends with `innerHTML +=`, which re-serializes the
        // container and drops listeners bound to individual elements — the
        // handler is delegated to the container so it survives.
        const writeText = jest.fn(async () => {});
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
        });
        const elm = render({ type: "markdown", content: yaml });
        document.body.appendChild(elm);
        setContent(
            elm,
            { type: "markdown", content: "and then some prose." },
            defaultChatSettings,
            "agent",
            { handleLinkClick() {} },
            "inline",
        );
        expect(elm.querySelectorAll("button.chat-code-copy")).toHaveLength(1);
        clickCopy(elm);
        expect(writeText).toHaveBeenCalledWith(
            "spotify:\n  clientId: <value>\n",
        );
    });

    it("does not add a copy button to inline code", () => {
        const elm = render({
            type: "markdown",
            content: "Run `pnpm build` first.",
        });
        expect(elm.querySelector("button.chat-code-copy")).toBeNull();
    });

    it("syntax-highlights yaml and json blocks", () => {
        const elm = render({ type: "markdown", content: yaml });
        const code = elm.querySelector("pre > code")!;
        expect(code.querySelector(".json-key")?.textContent).toBe("spotify:");
        // Highlighting must not disturb the text the copy button grabs.
        expect(code.textContent).toBe("spotify:\n  clientId: <value>\n");

        const json = render({
            type: "markdown",
            content: '```json\n{"port": 8080}\n```',
        });
        expect(json.querySelector("pre > code .json-number")?.textContent).toBe(
            "8080",
        );
    });

    it("leaves blocks in unknown languages alone", () => {
        const elm = render({
            type: "markdown",
            content: "```\nplain text\n```",
        });
        const code = elm.querySelector("pre > code")!;
        expect(code.querySelector("span")).toBeNull();
        expect(code.textContent).toBe("plain text\n");
    });
});

describe("setContent inline commands", () => {
    it("makes an inline command click-to-copy", async () => {
        const writeText = jest.fn(async () => {});
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText },
            configurable: true,
        });
        const elm = render({
            type: "markdown",
            content: "Then run `@config agent refresh player`.",
        });
        document.body.appendChild(elm);
        const code = elm.querySelector<HTMLElement>("code.chat-inline-copy")!;
        expect(code.textContent).toBe("@config agent refresh player");
        code.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        expect(writeText).toHaveBeenCalledWith("@config agent refresh player");
    });

    it("leaves ordinary inline code as prose", () => {
        const elm = render({
            type: "markdown",
            content: "The `clientId` comes from the dashboard.",
        });
        expect(elm.querySelector("code.chat-inline-copy")).toBeNull();
    });
});

describe("setContent plain-text linkification", () => {
    it("turns a bare https URL in text content into a clickable link", () => {
        const elm = render({
            type: "text",
            content: "See https://aka.ms/typeagent for details.",
        });
        const link = elm.querySelector<HTMLAnchorElement>("a[href]");
        expect(link).not.toBeNull();
        expect(link!.getAttribute("href")).toBe("https://aka.ms/typeagent");
        expect(link!.getAttribute("target")).toBe("_blank");
        // Surrounding text is preserved.
        expect(elm.textContent).toBe(
            "See https://aka.ms/typeagent for details.",
        );
    });

    it("linkifies a bare URL in a plain string (default text type)", () => {
        const elm = render("Visit https://example.org now");
        expect(
            elm
                .querySelector<HTMLAnchorElement>("a[href]")
                ?.getAttribute("href"),
        ).toBe("https://example.org");
    });

    it("routes a text-linkified URL click to the platform adapter", () => {
        const handleLinkClick = jest.fn();
        const elm = render(
            { type: "text", content: "Docs: https://example.org/guide" },
            { handleLinkClick },
        );
        const link = elm.querySelector<HTMLAnchorElement>("a[href]")!;
        link.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        expect(handleLinkClick).toHaveBeenCalledWith(
            "https://example.org/guide",
            "_blank",
        );
    });

    it("does not linkify filenames or bare domains in text content", () => {
        const elm = render({
            type: "text",
            content: "Edit README.md then publish to example.com.",
        });
        expect(elm.querySelector("a[href]")).toBeNull();
    });
});
