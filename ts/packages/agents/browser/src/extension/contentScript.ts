// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Readability, isProbablyReaderable } from "@mozilla/readability";
import { HTMLReducer } from "./htmlReducer";
import { SkeletonLoadingDetector } from "./loadingDetector";
import { convert } from "html-to-text";
import DOMPurify from "dompurify";

function isVisible(element: HTMLElement) {
    var html = document.documentElement;
    var rect = element.getBoundingClientRect();

    return (
        !!rect &&
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.left <= html.clientWidth &&
        rect.top <= html.clientHeight
    );
}

function isClickTarget(element: HTMLElement) {
    return !!(
        element.offsetWidth ||
        element.offsetHeight ||
        element.getClientRects().length
    );
}

function isTextInputTarget(element: HTMLElement) {
    return !!(
        element.offsetWidth ||
        element.offsetHeight ||
        element.getClientRects().length
    );
}

function isScrollable(element: HTMLElement) {
    var overflowY = window
        .getComputedStyle(element)
        .getPropertyValue("overflow-y");
    var overflowX = window
        .getComputedStyle(element)
        .getPropertyValue("overflow-x");
    return {
        vertical:
            (overflowY === "scroll" || overflowY === "auto") &&
            element.scrollHeight > element.clientHeight,
        horizontal:
            (overflowX === "scroll" || overflowX === "auto") &&
            element.scrollWidth > element.clientWidth,
    };
}

function matchString(s: string, re: RegExp) {
    return s && s.match(re);
}

function matchElement(element: HTMLElement, re: RegExp) {
    return (
        matchString(element.innerHTML, re) ||
        matchString(element.id, re) ||
        matchString(element.innerText, re)
    );
}

function matchLinks(pattern: string) {
    let re: RegExp | undefined;
    try {
        re = pattern ? new RegExp(pattern, "i") : undefined;
    } catch (err: any) {
        re = undefined;
        console.log(
            "Error building matching regular expression: " + err.toString(),
        );
    }

    //let allLinks = document.querySelectorAll("a, input, button");
    let allLinks = document.querySelectorAll("a");
    let matchedLinks = Array();

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

function matchLinksByPostion(position: number) {
    //let allLinks = document.querySelectorAll("a, input, button");
    let allLinks = document.querySelectorAll("a");
    let matchedLinks = Array();

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

function getTextInNode(currentNode: Node, sentences: string[]): string[] {
    if (currentNode.nodeType == Node.TEXT_NODE && currentNode.textContent) {
        sentences.push(currentNode.textContent);
    }

    if (currentNode.hasChildNodes()) {
        currentNode.childNodes.forEach((node) => {
            sentences = getTextInNode(node, sentences);
        });
    }

    return sentences;
}

function getReadablePageContent() {
    if (isProbablyReaderable(document)) {
        // readability updates the document object passed in - create a clone
        // to prevent modifying the live page
        var documentClone = document.cloneNode(true) as Document;
        var article = new Readability(documentClone).parse();

        // build usable text, with line breaks.
        if (article?.content) {
            let formattedText: string[] = [];
            var contentRoot = document.createElement("div");
            contentRoot.innerHTML = article?.content;

            formattedText = getTextInNode(contentRoot, formattedText);

            return {
                ...article,
                formattedText,
            };
        }
    }
    return { error: "Page content cannot be read" };
}

function markInvisibleNodesForCleanup() {
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

function getPageHTML(
    fullSize: boolean,
    documentHtml: string,
    frameId: number,
    useTimestampIds: boolean,
) {
    if (!documentHtml) {
        setIdsOnAllElements(frameId, useTimestampIds);
        markInvisibleNodesForCleanup();
        documentHtml = document.children[0].outerHTML;
    }

    if (fullSize) {
        return documentHtml;
    }

    const reducer = new HTMLReducer();
    reducer.removeDivs = false;
    const reducedHtml = reducer.reduce(documentHtml);
    return reducedHtml;
}

function getPageText(documentHtml: string, frameId: number) {
    if (!documentHtml) {
        setIdsOnAllElements(frameId, false);
        documentHtml = document.body.outerHTML;
    }

    const options = {
        wordwrap: 130,
    };

    const text = convert(documentHtml, options);
    return text;
}

function getPageHTMLSubFragments(
    documentHtml: string,
    cssSelectors: string,
    frameId: number,
) {
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(
        DOMPurify.sanitize(documentHtml),
        "text/html",
    );
    const elements = doc.documentElement.querySelectorAll(cssSelectors);
    let htmlFragments = [];
    if (elements) {
        for (let i = 0; i < elements.length; i++) {
            htmlFragments.push({
                frameId: frameId,
                content: elements[i].outerHTML,
            });
        }
    }

    return htmlFragments;
}

function getPageHTMLFragments(
    documentHtml: string,
    frameId: number,
    useTimestampIds: boolean,
    maxSize: 16000,
) {
    if (!documentHtml) {
        documentHtml = getPageHTML(
            false,
            documentHtml,
            frameId,
            useTimestampIds,
        );
    }
    const domParser = new DOMParser();
    const doc = domParser.parseFromString(
        DOMPurify.sanitize(documentHtml),
        "text/html",
    );
    let htmlFragments = [];
    let node = doc.body;
    while (node) {
        if (node.outerHTML.length > maxSize) {
            if (node.children.length > 0) {
                let largestIndex = 0;
                let largestSize = 0;
                for (let i = 0; i < node.children.length; i++) {
                    if (node.children[i].outerHTML.length > largestSize) {
                        largestIndex = i;
                        largestSize = node.children[i].outerHTML.length;
                    }
                }
                node = node.children[largestIndex] as HTMLElement;
            } else {
                break;
            }
        } else {
            htmlFragments.push({
                frameId: frameId,
                content: node.outerHTML,
            });

            node.remove();

            if (node == doc.body) {
                break;
            } else {
                node = doc.body;
            }
        }
    }

    return htmlFragments;
}

function getFullSelector(e: HTMLElement) {
    var s = "",
        t,
        i,
        c,
        p,
        n;
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

function getInteractiveElementsBoundingBoxes() {
    const allElements = Array.from(document.getElementsByTagName("*"));
    let textInputBounds = Array();
    let clickBounds = Array();
    let scrollBounds = Array();
    let tableRowBounds = Array();
    let tableColBounds = Array();
    let tableCellBounds = Array();
    let index = 0;
    let rowIndex = 0;
    let colIndex = 0;
    let isFirstRow = true;

    allElements.forEach((element: Element) => {
        if (element instanceof HTMLElement) {
            if (
                isVisible(element) &&
                !element.hidden &&
                element.checkVisibility({
                    checkVisibilityCSS: true,
                    checkOpacity: true,
                })
            ) {
                const bounds = element.getBoundingClientRect();
                if (element instanceof HTMLInputElement) {
                    if (element.tagName == "TEXT") {
                        textInputBounds.push({
                            top: bounds.top,
                            right: bounds.right,
                            bottom: bounds.bottom,
                            left: bounds.left,
                            selector: getFullSelector(element),
                            index: index,
                        });
                    } else {
                        clickBounds.push({
                            top: bounds.top,
                            right: bounds.right,
                            bottom: bounds.bottom,
                            left: bounds.left,
                            selector: getFullSelector(element),
                            index: index,
                        });
                    }

                    index += 1;
                } else if (
                    element instanceof HTMLAnchorElement ||
                    element instanceof HTMLButtonElement ||
                    element.getAttribute("onclick") != null
                    // (typeof element.click === 'function')
                ) {
                    clickBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: index,
                    });

                    index += 1;
                } else if (element instanceof HTMLTableRowElement) {
                    tableRowBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: rowIndex,
                    });
                    rowIndex += 1;
                    if (isFirstRow) {
                        // add all cells as columns
                        for (const col of element.children) {
                            const colBounds = col.getBoundingClientRect();
                            tableColBounds.push({
                                top: colBounds.top,
                                right: colBounds.right,
                                bottom: colBounds.bottom,
                                left: colBounds.left,
                                selector: getFullSelector(col as HTMLElement),
                                index: colIndex,
                            });
                            colIndex += 1;
                        }

                        isFirstRow = false;
                    }
                } else if (element instanceof HTMLTableColElement) {
                    tableColBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: colIndex,
                    });
                    colIndex += 1;
                } else if (element instanceof HTMLTableCellElement) {
                    tableCellBounds.push({
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        left: bounds.left,
                        selector: getFullSelector(element),
                        index: index,
                    });
                    index += 1;
                }

                /*
                                const scrollState = isScrollable(element);
                                if (scrollState.vertical || scrollState.horizontal) {
                                    scrollBounds.push({
                                        top: bounds.top,
                                        right: bounds.right,
                                        bottom: bounds.bottom,
                                        left: bounds.left,
                                        selector: getFullSelector(element),
                                        index: index,
                                    });
                                }
                */
                if (element.getAttribute("handler_click")) {
                    console.log("Found handler added by patch");
                }
            }
        }
    });

    return {
        textInput: textInputBounds,
        click: clickBounds,
        scroll: scrollBounds,
        rows: tableRowBounds,
        cols: tableColBounds,
        cells: tableCellBounds,
    };
}

function daysIntoYear() {
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

function setIdsOnAllElements(frameId: number, useTimestampIds?: boolean) {
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
    // let i = 0;
    for (let i = 0; i < allElements.length; i++) {
        let element = allElements[i];

        // for (let element of allElements) {
        if (
            !element.hasAttribute("id") &&
            !skipIdsFor.includes(element.tagName.toUpperCase())
        ) {
            if (useTimestampIds) {
                // element.setAttribute("id", idPrefix + performance.now().toString().replace('.', '_'));
                element.setAttribute("id", idPrefix + i.toString());
            } else {
                element.setAttribute("id", idPrefix + i.toString());
                // i++;
            }
        }
    }
}

async function awaitPageIncrementalUpdates() {
    return new Promise<string | undefined>((resolve, reject) => {
        const detector = new SkeletonLoadingDetector({
            stabilityThresholdMs: 500,
            // Consider elements visible when they're at least 10% in view
            intersectionThreshold: 0.1,
        });

        detector
            .detect()
            .then(() => {
                resolve("true");
            })
            .catch((_error: Error) => {
                resolve("false");
            });
    });
}

let recording = false;
let recordedActions: any[] = [];
let actionIndex = 1;

function startRecording() {
    if (recording) return;
    recording = true;
    recordedActions = [];
    actionIndex = 1;

    document.addEventListener("click", recordClick, true);
    document.addEventListener("input", recordInput, true);
    // document.addEventListener("scroll", recordScroll, true);
    document.addEventListener("keyup", recordTextEntry, true);

    saveRecordedActions();
}

// Stop recording and return data
function stopRecording() {
    recording = false;
    document.removeEventListener("click", recordClick, true);
    document.removeEventListener("input", recordInput, true);
    // document.removeEventListener("scroll", recordScroll, true);
    document.removeEventListener("keyup", recordTextEntry, true);

    captureAnnotatedScreenshot(() => {
        const pageHTML = document.documentElement.outerHTML;
        chrome.runtime.sendMessage({
            type: "saveRecordedActionPageHTML",
            html: pageHTML,
        });

        chrome.runtime.sendMessage({
            type: "recordingStopped",
            recordedActions,
        });
        chrome.storage.session.remove("recordedActions");
    });
}

// Record click events
function recordClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target) return;

    const cssSelector = getCSSSelector(target);
    const boundingBox = getBoundingBox(target);

    recordedActions.push({
        id: actionIndex++,
        type: "click",
        tag: target.tagName,
        text: target.textContent?.trim(),
        cssSelector,
        boundingBox,
        timestamp: Date.now(),
    });

    saveRecordedActions();
}

// Record text input events
function recordInput(event: Event) {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (!target) return;

    const cssSelector = getCSSSelector(target);
    const boundingBox = getBoundingBox(target);

    recordedActions.push({
        id: actionIndex++,
        type: "input",
        tag: target.tagName,
        value: target.value,
        cssSelector,
        boundingBox,
        timestamp: Date.now(),
    });

    saveRecordedActions();
}

function recordTextEntry(event: Event) {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        const action = {
            id: actionIndex++,
            type: "textInput",
            timestamp: Date.now(),
            tag: target.tagName,
            selector: getCSSSelector(target),
            boundingBox: getBoundingBox(target),
            value: target.value, // Capture final text value
        };

        recordedActions.push(action);
    }

    saveRecordedActions();
}

// Record scroll events
function recordScroll() {
    recordedActions.push({
        id: actionIndex++,
        type: "scroll",
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        timestamp: Date.now(),
    });

    saveRecordedActions();
}

function recordNavigation() {
    captureAnnotatedScreenshot(() => {
        const pageHTML = document.documentElement.outerHTML;
        chrome.runtime.sendMessage({
            type: "saveRecordedActionPageHTML",
            html: pageHTML,
        });
    });

    recordedActions.push({
        id: actionIndex++,
        type: "navigation",
        url: window.location.href,
        timestamp: Date.now(),
    });

    saveRecordedActions();
}

function captureAnnotatedScreenshot(callback: () => void) {
    chrome.runtime.sendMessage({ type: "takeScreenshot" }, (screenshotUrl) => {
        if (!screenshotUrl) {
            console.error("Failed to capture screenshot");
            return callback();
        }

        const img = new Image();
        img.src = screenshotUrl;
        img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d")!;
            canvas.width = img.width;
            canvas.height = img.height;

            ctx.drawImage(img, 0, 0);

            recordedActions.forEach((action) => {
                if (!action.boundingBox) return;

                const { left, top, width, height } = action.boundingBox;
                ctx.strokeStyle = "red";
                ctx.lineWidth = 2;
                ctx.strokeRect(left, top, width, height);

                ctx.fillStyle = "red";
                ctx.font = "bold 14px Arial";
                ctx.fillText(
                    `${action.id} ${action.type}`,
                    left + width - 40,
                    top - 5,
                );
            });

            const annotatedScreenshot = canvas.toDataURL("image/png");
            chrome.runtime.sendMessage({
                action: "saveAnnotatedScreenshot",
                screenshot: annotatedScreenshot,
            });

            callback();
        };
    });
}

function saveRecordedActions() {
    chrome.storage.session.set({ recordedActions });
}

// Restore actions if page is refreshed
chrome.storage.session.get("recordedActions", (data) => {
    if (data.recordedActions) {
        recordedActions = data.recordedActions;
    }
});

// Detect navigation and push it as an action
window.addEventListener("beforeunload", recordNavigation);
window.addEventListener("popstate", recordNavigation);
window.addEventListener("hashchange", recordNavigation);

function getCSSSelector(element: HTMLElement): string {
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

function getBoundingBox(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect();
}

function sendPaleoDbRequest(data: any) {
    document.dispatchEvent(
        new CustomEvent("toPaleoDbAutomation", { detail: data }),
    );
}

document.addEventListener("fromPaleoDbAutomation", function (e: any) {
    var message = e.detail;
    console.log("received", message);
});

function sendUIEventsRequest(data: any) {
    document.dispatchEvent(
        new CustomEvent("toUIEventsDispatcher", { detail: data }),
    );
}

document.addEventListener("fromUIEventsDispatcher", async function (e: any) {
    var message = e.detail;
    console.log("received", message);
});

async function handleScriptAction(
    message: any,
    sendResponse: (response?: any) => void,
) {
    switch (message.type) {
        case "get_page_links_by_query": {
            const link = matchLinks(message.query) as HTMLAnchorElement;
            if (link && link.href) {
                sendResponse({ url: link.href });
            } else {
                sendResponse({});
            }
            break;
        }

        case "get_page_links_by_position": {
            const link = matchLinksByPostion(
                message.position,
            ) as HTMLAnchorElement;
            if (link && link.href) {
                sendResponse({ url: link.href });
            } else {
                sendResponse({});
            }
            break;
        }

        case "scroll_down_on_page": {
            window.scrollTo(0, window.scrollY + window.innerHeight * 0.9);
            sendResponse({});
            break;
        }

        case "scroll_up_on_page": {
            window.scrollTo(0, window.scrollY - window.innerHeight * 0.9);
            sendResponse({});
            break;
        }
        case "history_go_back": {
            window.history.back();

            sendResponse({});
            break;
        }
        case "history_go_forward": {
            window.history.forward();

            sendResponse({});
            break;
        }

        case "read_page_content": {
            const article = getReadablePageContent();
            sendResponse(article);
            break;
        }

        case "get_reduced_html": {
            const html = getPageHTML(
                message.fullSize,
                message.inputHtml,
                message.frameId,
                message.useTimestampIds,
            );
            sendResponse(html);
            break;
        }

        case "get_page_text": {
            const text = getPageText(message.inputHtml, message.frameId);
            sendResponse(text);
            break;
        }

        case "get_filtered_html_fragments": {
            const htmlFragments = getPageHTMLSubFragments(
                message.inputHtml,
                message.cssSelectors,
                message.frameId,
            );
            sendResponse(htmlFragments);
            break;
        }

        case "get_maxSize_html_fragments": {
            const htmlFragments = getPageHTMLFragments(
                message.inputHtml,
                message.frameId,
                message.maxFragmentSize,
                message.useTimestampIds,
            );
            sendResponse(htmlFragments);
            break;
        }

        case "get_element_bounding_boxes": {
            const boundingBoxes = getInteractiveElementsBoundingBoxes();
            sendResponse(boundingBoxes);
            break;
        }

        case "await_page_incremental_load": {
            const updated = await awaitPageIncrementalUpdates();
            sendResponse(updated);
            break;
        }

        case "run_ui_event": {
            sendUIEventsRequest(message.action);
            sendResponse({});
            break;
        }

        case "run_paleoBioDb_action": {
            sendPaleoDbRequest(message.action);
            sendResponse({});
            break;
        }

        case "clearCrosswordPageCache": {
            const value = await localStorage.getItem("pageSchema");
            if (value) {
                localStorage.removeItem("pageSchema");
            }
            sendResponse({});
            break;
        }
        case "get_page_schema": {
            const value = localStorage.getItem("pageSchema");
            if (value) {
                sendResponse(JSON.parse(value));
            } else {
                sendResponse(null);
            }
            break;
        }
        case "set_page_schema": {
            let updatedSchema = message.action.parameters.schema;
            localStorage.setItem("pageSchema", JSON.stringify(updatedSchema));
            sendResponse({});
            break;
        }
        case "clear_page_schema": {
            const value = localStorage.getItem("pageSchema");
            if (value) {
                localStorage.removeItem("pageSchema");
            }
            sendResponse({});
            break;
        }
        case "startRecording": {
            startRecording();
            sendResponse({});
            break;
        }
        case "stopRecording": {
            stopRecording();
            sendResponse({ recordedActions });
            break;
        }
    }
}

chrome.runtime?.onMessage.addListener(
    (message: any, sender: chrome.runtime.MessageSender, sendResponse) => {
        const handleMessage = async () => {
            await handleScriptAction(message, sendResponse);
        };

        handleMessage();
        return true; // Important: indicates we'll send response asynchronously
    },
);

window.addEventListener(
    "message",
    async (event) => {
        if (
            event.data !== undefined &&
            event.data.source === "preload" &&
            event.data.target === "contentScript" &&
            event.data.messageType === "scriptActionRequest"
        ) {
            await handleScriptAction(event.data.body, (response) => {
                window.top?.postMessage(
                    {
                        source: "contentScript",
                        target: "preload",
                        messageType: "scriptActionResponse",
                        id: event.data.id,
                        body: response,
                    },
                    "*",
                );
            });
        }
    },
    false,
);

document.addEventListener("DOMContentLoaded", async () => {
    console.log("Content Script initialized");
});
