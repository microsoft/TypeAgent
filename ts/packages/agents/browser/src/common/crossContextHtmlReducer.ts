// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Class for reducing HTML size by removing unnecessary elements and attributes
 * Works in both browser (DOMParser) and Node.js (JSDOM) contexts
 */
export class CrossContextHtmlReducer {
    linkSelectors: string[] = [
        'link[rel="icon"]',
        'link[rel="stylesheet"]',
        'link[rel="canonical"]',
        'link[rel="preload"]',
        'link[rel="apple-touch-icon"]',
        'link[rel="mask-icon"]',
        'link[rel="preconnect"]',
        'link[rel="manifest"]',
        'link[rel="dns-prefetch"]',
        'link[rel="prefetch"]',
    ];

    metaTagSelectors: string[] = [
        "meta",
        'meta[name="theme-color"]',
        'meta[name*="verify"]',
        'meta[name*="site-verification"]',
        'meta[name*="validate"]',
        'meta[name="msapplication-TileImage"]',
        'meta[name="msapplication-TileColor"]',
        'meta[name="msapplication-config"]',
        'meta[name="viewport"]',
        'meta[property="fb:app_id"]',
    ];

    styleTagSelectors: string[] = ["style"];

    svgSelectors: string[] = ["svg use", "svg path", "svg circle"];

    scriptTagsSelector: string[] = ["script"];

    cookieJarsSelector: string[] = ["cookieJar"];

    nonVisibleNodesSelector: string[] = ["[data-deleteInReducer]"];

    miscTagsToRemove: string[] = [
        "svg",
        "cookieJar",
        "iframe",
        "nocontent",
        "noscript",
        "template",
        "img",
    ];

    mediaElementSelectors: string[] = [
        "img",
        "video",
        "audio",
        "picture",
        "source",
    ];

    miscAttribsToRemove: string[] = [
        "style",
        "tabindex",
        "xmlns:xlink",
        "xlink:href",
        "viewBox",
        "xmlns",
        "onview-beacon-nucleus",
        "loading",
        "clickid",
        "fetchpriority",
        "srcset",
        "aria-busy",
        "aria-haspopup",
        "aria-autocomplete",
        "href",
    ];

    attribsToReplace: Set<string> = new Set(["href", "src"]);

    classesToRemove: Set<string> = new Set([
        "grid",
        "small",
        "medium",
        "large",
        "column",
        "row",
        "wrapper",
        "container",
        "separator",
        "carousel",
        "animation",
        "spacer",
        "mobile",
        "tablet",
        "padding",
        "margin",
        "theme",
        "loader",
        "link",
        "bold",
        "background",
        "foreground",
    ]);

    emptyTagsSelector: string[] = ["p", "span", "div"];

    removeAllClasses: boolean = true;
    removeLinkTags: boolean = true;
    removeMetaTags: boolean = false;
    removeStyleTags: boolean = true;
    removeSvgTags: boolean = true;
    removeScripts: boolean = true;
    removeDivs: boolean = true;
    removeCookieJars: boolean = true;
    removeNonVisibleNodes: boolean = true;
    removeMiscTags: boolean = true;

    /**
     * Reduces HTML by removing unnecessary elements and attributes
     * @param html The HTML to reduce
     * @returns The reduced HTML
     */
    reduce(html: string): string {
        // Parse document using cross-context parser
        let doc = this.parseDocument(html);
        if (!doc) {
            console.warn("Failed to parse HTML, returning original");
            return html;
        }

        this.removeNodes(doc, this.linkSelectors, this.removeLinkTags);
        this.removeNodes(doc, this.metaTagSelectors, this.removeMetaTags);
        this.removeNodes(doc, this.styleTagSelectors, this.removeStyleTags);
        this.removeNodes(doc, this.svgSelectors, this.removeSvgTags);
        this.removeNodes(doc, this.scriptTagsSelector, this.removeScripts);
        this.removeNodes(doc, this.cookieJarsSelector, this.removeCookieJars);
        this.removeNodes(doc, this.miscTagsToRemove, this.removeMiscTags);

        this.removeNodes(
            doc,
            this.nonVisibleNodesSelector,
            this.removeNonVisibleNodes,
        );

        this.processMediaElements(doc);
        this.processClassAttributes(doc);
        this.removeMiscAttributes(doc);
        this.replaceLinks(doc);
        this.removeCommentNodes(doc); // Enable comment removal
        this.removeEmptyNodes(doc, this.emptyTagsSelector);
        this.reduceElementNesting(doc, this.emptyTagsSelector);
        this.removeDataAttributes(doc);
        this.removeDuplicateAltText(doc);
        this.removeSpans(doc);

        let reduced = doc.documentElement.outerHTML;
        reduced = reduced.replace(/<!DOCTYPE[^>]*>/, "");

        if (this.removeDivs) {
            reduced = reduced.replace(/<div>/g, "").replace(/<\/div>/g, "");
        }

        reduced = reduced.replace(/\s+/g, " ");

        return reduced;
    }

    /**
     * Cross-context document parser - works in browser and Node.js
     * @param html HTML string to parse
     * @returns Document object or null if parsing fails
     */
    private parseDocument(html: string): Document | null {
        try {
            // Sanitize HTML first - try to get DOMPurify in any context
            let sanitizedHtml = html;
            try {
                // Try to get DOMPurify - works in browser contexts
                if (
                    typeof window !== "undefined" &&
                    (window as any).DOMPurify
                ) {
                    sanitizedHtml = (window as any).DOMPurify.sanitize(html);
                } else {
                    // Try to require DOMPurify for Node.js contexts
                    try {
                        const DOMPurifyNode = require("dompurify");
                        if (DOMPurifyNode) {
                            sanitizedHtml = DOMPurifyNode.sanitize(html);
                        }
                    } catch (requireError) {
                        // DOMPurify not available via require
                    }
                }
            } catch (error) {
                console.warn(
                    "DOMPurify not available, proceeding without sanitization:",
                    error,
                );
                // Continue without sanitization - not ideal but functional
            }

            // Try browser DOMParser first
            if (typeof DOMParser !== "undefined") {
                const parser = new DOMParser();
                return parser.parseFromString(sanitizedHtml, "text/html");
            }

            // Try Node.js JSDOM
            if (typeof require !== "undefined") {
                try {
                    const { JSDOM } = require("jsdom");
                    const dom = new JSDOM(sanitizedHtml);
                    return dom.window.document;
                } catch (error) {
                    console.warn("JSDOM not available:", error);
                }
            }

            return null;
        } catch (error) {
            console.error("Document parsing failed:", error);
            return null;
        }
    }

    /**
     * Removes nodes from the document that match the given selectors
     * @param doc The document to modify
     * @param selectors The selectors to match
     * @param removeFlag Whether to remove the nodes
     */
    private removeNodes(
        doc: Document,
        selectors: string[],
        removeFlag = true,
    ): void {
        if (removeFlag) {
            for (const selector of selectors) {
                const nodes = doc.querySelectorAll(selector);
                nodes.forEach((node) => node.parentNode?.removeChild(node));
            }
        }
    }

    /**
     * Processes media elements by removing certain attributes
     * @param doc The document to process
     */
    private processMediaElements(doc: Document): void {
        for (const selector of this.mediaElementSelectors) {
            const elements = doc.querySelectorAll(selector);
            elements.forEach((element) => {
                element.removeAttribute("width");
                element.removeAttribute("height");
                element.removeAttribute("style");
                element.removeAttribute("class");
                element.removeAttribute("media");
            });
        }
    }

    /**
     * Processes class attributes by removing classes or all classes
     * @param doc The document to process
     */
    private processClassAttributes(doc: Document): void {
        const elements = doc.querySelectorAll("[class]");
        elements.forEach((element) => {
            if (this.removeAllClasses) {
                element.removeAttribute("class");
                return;
            }

            const classList = element.getAttribute("class")?.split(" ");
            const newClassList = classList?.filter(
                (c) => !this.classesToRemove.has(c.toLowerCase()),
            );
            if (newClassList && newClassList.length > 0) {
                element.setAttribute("class", newClassList.join(" "));
            } else {
                element.removeAttribute("class");
            }
        });
    }

    /**
     * Removes miscellaneous attributes from all elements
     * @param doc The document to process
     */
    private removeMiscAttributes(doc: Document): void {
        const elements = doc.querySelectorAll("*");
        elements.forEach((element) => {
            this.miscAttribsToRemove.forEach((attr) => {
                if (element.hasAttribute(attr)) {
                    element.removeAttribute(attr);
                }
            });
        });
    }

    /**
     * Removes data attributes from all elements
     * @param doc The document to process
     */
    private removeDataAttributes(doc: Document): void {
        const elements = doc.querySelectorAll("*");
        elements.forEach((element) => {
            let dataAttributes = Array.from(element.attributes).filter((a) =>
                a.name.startsWith("data-"),
            );
            dataAttributes.forEach((attr) => {
                element.removeAttribute(attr.name);
            });
        });
    }

    /**
     * Replaces links with placeholder values
     * @param doc The document to process
     */
    private replaceLinks(doc: Document): void {
        const elements = doc.querySelectorAll("*");
        elements.forEach((element) => {
            element.getAttributeNames().forEach((attrName) => {
                if (this.attribsToReplace.has(attrName.toLowerCase())) {
                    element.setAttribute(attrName, "link");
                }
            });
        });
    }

    /**
     * Removes duplicate alt text where the same text appears in title and alt attributes
     * @param doc The document to process
     */
    private removeDuplicateAltText(doc: Document): void {
        const elements = doc.querySelectorAll("*");
        elements.forEach((element) => {
            if (element.hasAttribute("alt") && element.hasAttribute("title")) {
                if (
                    element.attributes.getNamedItem("alt")?.value ===
                    element.attributes.getNamedItem("title")?.value
                ) {
                    element.removeAttribute("alt");
                }
            }
        });
    }

    /**
     * Removes comment nodes from the document
     * @param doc The document to process
     */
    private removeCommentNodes(doc: Document): void {
        const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
        let node = walker.nextNode();
        while (node) {
            if (node.parentNode && !node.textContent?.startsWith("<!DOCTYPE")) {
                node.parentNode.removeChild(node);
            }
            node = walker.nextNode();
        }
    }

    /**
     * Removes empty nodes from the document
     * @param doc The document to process
     * @param selectors The selectors to match
     */
    private removeEmptyNodes(doc: Document, selectors: string[]): void {
        const selector = selectors.join(", ");
        let nodes;
        let emptyNodes;

        do {
            nodes = Array.from(doc.querySelectorAll(selector));
            emptyNodes = nodes.filter(
                (n) =>
                    n.childNodes.length === 0 ||
                    (n.childNodes.length === 1 &&
                        n.childNodes[0].nodeType === Node.TEXT_NODE &&
                        n.textContent?.trim().length === 0),
            );

            emptyNodes.forEach((node) => {
                node.parentNode?.removeChild(node);
            });

            doc.normalize();
        } while (emptyNodes && emptyNodes.length > 1);
    }

    /**
     * Reduces element nesting by moving children up when parent has only one child
     * @param doc The document to process
     * @param selectors The selectors to match
     */
    private reduceElementNesting(doc: Document, selectors: string[]): void {
        const selector = selectors.join(", ");
        let nodes;
        let nestedNodes;

        do {
            nodes = Array.from(doc.querySelectorAll(selector));
            nestedNodes = nodes.filter(
                (n) =>
                    n.parentNode?.childNodes.length === 1 &&
                    n.parentNode?.nodeType === n.nodeType,
            );

            nestedNodes.forEach((node) => {
                while (node.firstChild) {
                    node.parentNode?.insertBefore(node.firstChild, node);
                }

                node.parentNode?.removeChild(node);
            });

            doc.normalize();
        } while (nestedNodes && nestedNodes.length > 1);
    }

    /**
     * Removes span elements by moving their children up
     * @param doc The document to process
     */
    private removeSpans(doc: Document): void {
        const selector = "span";
        const nodes = Array.from(doc.querySelectorAll(selector));
        nodes.forEach((node) => {
            while (node.firstChild) {
                node.parentNode?.insertBefore(node.firstChild, node);
            }

            node.parentNode?.removeChild(node);
        });

        doc.normalize();
    }
}

/**
 * Factory function to create cross-context HTML reducer
 */
export function createCrossContextHtmlReducer(): CrossContextHtmlReducer {
    return new CrossContextHtmlReducer();
}

// Export HTMLReducer as alias for compatibility
export { CrossContextHtmlReducer as HTMLReducer };
