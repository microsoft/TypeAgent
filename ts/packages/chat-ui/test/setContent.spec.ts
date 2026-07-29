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
