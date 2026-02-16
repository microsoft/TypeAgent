// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Checks if an element is visible in the viewport
 * @param element The element to check
 * @returns Whether the element is visible
 */
export function isVisible(element: HTMLElement): boolean {
    const html = document.documentElement;
    const rect = element.getBoundingClientRect();

    return (
        !!rect &&
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.left <= html.clientWidth &&
        rect.top <= html.clientHeight
    );
}

/**
 * Checks if a string matches a regular expression
 * @param s The string to check
 * @param re The regular expression to match against
 * @returns Whether the string matches the regular expression
 */
export function matchString(
    s: string,
    re: RegExp,
): RegExpMatchArray | "" | null {
    return s && s.match(re);
}

/**
 * Checks if an element matches a regular expression
 * @param element The element to check
 * @param re The regular expression to match against
 * @returns Whether the element matches the regular expression
 */
export function matchElement(
    element: HTMLElement,
    re: RegExp,
): RegExpMatchArray | "" | null {
    return (
        matchString(element.innerText, re) ||
        matchString(element.textContent ?? "", re) ||
        matchString(element.id, re) ||
        matchString(element.getAttribute("title") ?? "", re) ||
        matchString(element.getAttribute("aria-label") ?? "", re)
    );
}

/**
 * Finds a link that matches a pattern
 * @param pattern The pattern to match
 * @returns The matched link or null
 */
/**
 * Walk up the DOM from an element to find the nearest ancestor <a> tag.
 */
function findAncestorLink(element: HTMLElement): HTMLAnchorElement | null {
    let current: HTMLElement | null = element;
    while (current) {
        if (current.tagName === "A") {
            return current as HTMLAnchorElement;
        }
        current = current.parentElement;
    }
    return null;
}

/**
 * Find the nearest <a> tag relative to an element:
 * ancestor first, then children, then walk up a few parent
 * levels searching for an <a> anywhere in the subtree.
 */
function findNearestLink(element: HTMLElement): HTMLAnchorElement | null {
    // Check ancestors
    const ancestor = findAncestorLink(element);
    if (ancestor) return ancestor;

    // Check children
    const child = element.querySelector("a") as HTMLAnchorElement | null;
    if (child) return child;

    // Walk up a few levels and search within each parent's subtree.
    // This handles cases like ESPN where <a> and <h2> are cousins
    // under a card container (article, section, div, etc.).
    let parent = element.parentElement;
    for (let depth = 0; depth < 5 && parent; depth++) {
        const link = parent.querySelector("a") as HTMLAnchorElement | null;
        if (link) return link;
        parent = parent.parentElement;
    }

    return null;
}

/**
 * Check whether an anchor element has a real navigable href
 * (not #, empty, or javascript:void).
 */
function hasNavigableHref(element: HTMLElement): boolean {
    const anchor = element as HTMLAnchorElement;
    if (!anchor.href) return false;
    const raw = anchor.getAttribute("href") ?? "";
    if (
        !raw ||
        raw === "#" ||
        raw.startsWith("javascript:") ||
        raw.startsWith("data:") ||
        raw.startsWith("vbscript:")
    )
        return false;
    // Fragment-only links that point to the current page
    try {
        const url = new URL(anchor.href);
        if (
            url.origin === location.origin &&
            url.pathname === location.pathname &&
            url.search === location.search &&
            url.hash !== ""
        ) {
            // Same page with just a hash — not a real navigation
            return false;
        }
    } catch {
        // If URL parsing fails, treat as non-navigable
        return false;
    }
    return true;
}

export function matchLinks(pattern: string): HTMLElement | null {
    let re: RegExp | undefined;
    try {
        re = pattern ? new RegExp(pattern, "i") : undefined;
    } catch (err: any) {
        re = undefined;
        console.log(
            "Error building matching regular expression: " + err.toString(),
        );
    }

    if (!re) return null;

    // First: search <a> tags and role="link" elements directly
    const allLinks = document.querySelectorAll('a, [role="link"]');
    const visibleMatches: HTMLElement[] = [];
    const allMatches: HTMLElement[] = [];

    console.log(
        `[matchLinks] Searching ${allLinks.length} links for pattern: ${pattern}`,
    );

    allLinks.forEach((el) => {
        const element = el as HTMLElement;
        if (matchElement(element, re!) && hasNavigableHref(element)) {
            allMatches.push(element);
            if (isVisible(element)) {
                visibleMatches.push(element);
            }
        }
    });

    console.log(
        `[matchLinks] Found ${visibleMatches.length} visible, ${allMatches.length} total matches`,
    );

    if (visibleMatches.length > 0 || allMatches.length > 0) {
        const match = visibleMatches[0] ?? allMatches[0];
        const matchHref = (match as HTMLAnchorElement).href;
        console.log(
            `[matchLinks] Matched: <${match.tagName.toLowerCase()}> text="${match.innerText?.substring(0, 80)}" href="${matchHref}"`,
        );
        return match;
    }

    // Second: search ALL elements for matching text, then find nearby <a> tags.
    // This handles cases like ESPN where the text is in an <h2> and the <a>
    // is a parent, child, or sibling element.
    console.log(
        `[matchLinks] No direct link match; searching all elements for text`,
    );
    const allElements = document.querySelectorAll(
        "h1, h2, h3, h4, h5, h6, span, p, li, div, button",
    );
    for (const element of allElements) {
        const el = element as HTMLElement;
        if (
            matchString(el.innerText, re) ||
            matchString(el.textContent ?? "", re)
        ) {
            const link = findNearestLink(el);
            if (link && hasNavigableHref(link)) {
                console.log(
                    `[matchLinks] Found text in <${el.tagName.toLowerCase()}>, nearest link: ${link.href}`,
                );
                return link;
            }
        }
    }

    console.log(`[matchLinks] No matches found anywhere`);
    return null;
}

/**
 * Finds a link by position
 * @param position The position of the link
 * @returns The matched link or null
 */
export function matchLinksByPosition(position: number): HTMLElement | null {
    const allLinks = document.querySelectorAll("a");
    const matchedLinks: HTMLElement[] = [];

    allLinks.forEach((el) => {
        const element = el as HTMLElement;
        if (isVisible(element)) {
            matchedLinks.push(element);
        }
    });

    let selectedLink = null;
    if (matchedLinks.length > position) {
        selectedLink = matchedLinks[position];
    }

    return selectedLink;
}

/**
 * Gets a CSS selector for an element
 * @param element The element to get a selector for
 * @returns The CSS selector
 */
export function getCSSSelector(element: HTMLElement): string {
    if (element.id) {
        return `#${element.id}`;
    }

    let path = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
        let selector = element.tagName.toLowerCase();

        if (element.className) {
            selector += "." + element.className.trim().replace(/\s+/g, ".");
        }

        let siblingIndex = 1;
        let sibling = element.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === element.tagName) siblingIndex++;
            sibling = sibling.previousElementSibling;
        }
        selector += `:nth-of-type(${siblingIndex})`;

        path.unshift(selector);
        element = element.parentElement!;
    }
    return path.join(" > ");
}

/**
 * Gets a full selector for an element
 * @param e The element to get a full selector for
 * @returns The full selector
 */
export function getFullSelector(e: HTMLElement): string {
    let s = "";
    let t, i, c, p, n;

    do {
        t = e.tagName.toLowerCase();
        i = e.hasAttribute("id") ? "#" + e.id : "";
        c = e.hasAttribute("class")
            ? "." + e.className.split(/\s+/).join(".")
            : "";
        p = e.parentElement;
        n =
            Array.prototype.filter
                .call(e.parentNode?.childNodes, function (x) {
                    return x.nodeType == Node.ELEMENT_NODE;
                })
                .indexOf(e) + 1;
        s = t + i + c + ":nth-child(" + n + ") > " + s;
    } while (!p || !(e = p).tagName.match(/^HTML$/i));

    return s.slice(0, -3);
}

/**
 * Gets the bounding box of an element
 * @param element The element to get the bounding box for
 * @returns The bounding box
 */
export function getBoundingBox(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
}

/**
 * Marks invisible nodes for cleanup
 */
export function markInvisibleNodesForCleanup(): void {
    const allElements = Array.from(document.body.getElementsByTagName("*"));

    allElements.forEach((element: Element) => {
        if (
            element instanceof HTMLElement &&
            element.nodeType == Node.ELEMENT_NODE
        ) {
            if (element.hidden) {
                element.setAttribute("data-deleteInReducer", "");
            } else if (element.hasAttribute("data-deleteInReducer")) {
                // previously hidden element is now visible
                element.removeAttribute("data-deleteInReducer");
            }
        }
    });
}

/**
 * Sets IDs on all elements
 * @param frameId The frame ID
 * @param useTimestampIds Whether to use timestamp IDs
 */
export function setIdsOnAllElements(
    frameId: number,
    useTimestampIds?: boolean,
): void {
    const allElements = Array.from(document.getElementsByTagName("*"));
    let idPrefix = `id_${daysIntoYear()}_${frameId}_`;

    const skipIdsFor = [
        "BR",
        "P",
        "B",
        "I",
        "U",
        "STRONG",
        "TEMPLATE",
        "IFRAME",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "HR",
        "HEAD",
        "TITLE",
        "HTML",
        "BODY",
        "SCRIPT",
        "META",
        "STYLE",
        "SPAN",
        "TABLE",
        "TBODY",
        "TR",
        "TD",
        "UL",
        "OL",
        "LI",
        "LABEL",
        "PATH",
        "SVG",
    ];

    for (let i = 0; i < allElements.length; i++) {
        let element = allElements[i];

        if (
            !element.hasAttribute("id") &&
            !skipIdsFor.includes(element.tagName.toUpperCase())
        ) {
            if (useTimestampIds) {
                element.setAttribute("id", idPrefix + i.toString());
            } else {
                element.setAttribute("id", idPrefix + i.toString());
            }
        }
    }
}

/**
 * Gets the days into the year
 * @returns The days into the year
 */
export function daysIntoYear(): number {
    const date = new Date();
    return (
        (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
            Date.UTC(date.getFullYear(), 0, 0)) /
        24 /
        60 /
        60 /
        1000
    );
}
