// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class HTMLReducer {
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

    miscTagsToRemove: string[] = ["svg", "cookieJar"];

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

    removeAllClasses: boolean = true;
    removeLinkTags: boolean = true;
    removeMetaTags: boolean = true;
    removeStyleTags: boolean = true;
    removeSvgTags: boolean = true;
    removeScripts: boolean = true;
    removeDivs: boolean = true;
    removeCookieJars: boolean = true;

    reduce(html: string): string {
        const domParser = new DOMParser();
        let doc = domParser.parseFromString(html, "text/html");

        this.removeNodes(doc, this.linkSelectors, this.removeLinkTags);
        this.removeNodes(doc, this.metaTagSelectors, this.removeMetaTags);
        this.removeNodes(doc, this.styleTagSelectors, this.removeStyleTags);
        this.removeNodes(doc, this.svgSelectors, this.removeSvgTags);
        this.removeNodes(doc, this.scriptTagsSelector, this.removeScripts);
        this.removeNodes(doc, this.cookieJarsSelector, this.removeCookieJars);

        this.processMediaElements(doc);
        this.processClassAttributes(doc);
        this.removeMiscAttributes(doc);
        this.replaceLinks(doc);
        this.removeCommentNodes(doc);
        
        let reduced = doc.documentElement.outerHTML;
        reduced = reduced.replace(/<!DOCTYPE[^>]*>/, "");

        if (this.removeDivs) {
            reduced = reduced.replace(/<div>/g, "").replace(/<\/div>/g, "");
        }

        reduced = reduced.replace(/\s+/g, " ");

        return reduced;
    }

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

    private removeMiscAttributes(doc: Document): void {
        const elements = doc.querySelectorAll("*");
        elements.forEach((element) => {
            this.miscAttribsToRemove.forEach((attr) => {
                if (element.hasAttribute(attr) || attr.startsWith("data-")) {
                    element.removeAttribute(attr);
                }
            });
        });
    }

    private removeDataAttributes(doc: Document): void {
        const elements = doc.querySelectorAll("*");
        elements.forEach((element) => {
            for (const attr of element.attributes) {
                if (attr.name.startsWith("data-")) {
                    element.removeAttribute(attr.name);
                }
            }
        });
    }

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
}
