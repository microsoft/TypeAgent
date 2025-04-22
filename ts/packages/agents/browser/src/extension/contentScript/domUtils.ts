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
        matchString(element.innerHTML, re) ||
        matchString(element.id, re) ||
        matchString(element.innerText, re)
    );
}

/**
 * Finds a link that matches a pattern
 * @param pattern The pattern to match
 * @returns The matched link or null
 */
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

    const allLinks = document.querySelectorAll("a");
    const matchedLinks: HTMLElement[] = [];

    allLinks.forEach((element: HTMLElement) => {
        if (re && isVisible(element) && matchElement(element, re)) {
            matchedLinks.push(element);
        }
    });

    let selectedLink = null;
    if (matchedLinks.length > 0) {
        selectedLink = matchedLinks[0];
    }

    return selectedLink;
}

/**
 * Finds a link by position
 * @param position The position of the link
 * @returns The matched link or null
 */
export function matchLinksByPosition(position: number): HTMLElement | null {
    const allLinks = document.querySelectorAll("a");
    const matchedLinks: HTMLElement[] = [];

    allLinks.forEach((element: HTMLElement) => {
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
