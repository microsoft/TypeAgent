// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getCSSSelector, getBoundingBox } from "../domUtils";
import {
    recordedActions,
    actionIndex,
    recordedHtmlIndex,
    saveRecordedActions,
    incrementActionIndex,
} from "./index";
import { captureAnnotatedScreenshot } from "./capture";
import { getPageHTML } from "../htmlProcessing";

/**
 * Records a click event
 * @param event The click event
 */
export async function recordClick(event: MouseEvent): Promise<void> {
    const target = event.target as HTMLElement;
    if (!target) return;

    const cssSelector = getCSSSelector(target);
    const boundingBox = getBoundingBox(target);

    recordedActions.push({
        id: incrementActionIndex(),
        type: "click",
        tag: target.tagName,
        text: target.textContent?.trim(),
        cssSelector,
        boundingBox,
        timestamp: Date.now(),
        htmlIndex: recordedHtmlIndex,
    });

    await saveRecordedActions();
}

/**
 * Records an input event
 * @param event The input event
 */
export async function recordInput(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (!target) return;

    const cssSelector = getCSSSelector(target);
    const boundingBox = getBoundingBox(target);

    recordedActions.push({
        id: incrementActionIndex(),
        type: "input",
        tag: target.tagName,
        value: target.value,
        cssSelector,
        boundingBox,
        timestamp: Date.now(),
        htmlIndex: recordedHtmlIndex,
    });

    await saveRecordedActions();
}

/**
 * Records a text entry event
 * @param event The keyup event
 */
export async function recordTextEntry(event: KeyboardEvent): Promise<void> {
    const target = event.target as HTMLElement;
    if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
    ) {
        let value = target.textContent;
        if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement
        ) {
            value = target.value;
        }

        const action = {
            id: incrementActionIndex(),
            type: "textInput",
            timestamp: Date.now(),
            tag: target.tagName,
            selector: getCSSSelector(target),
            boundingBox: getBoundingBox(target),
            value: value!, // Capture final text value
            htmlIndex: recordedHtmlIndex,
        };

        recordedActions.push(action);
    }
    if (target.tagName === "BODY") {
        if (
            recordedActions.length > 0 &&
            recordedActions[recordedActions.length - 1].type ===
                "pageLevelTextInput"
        ) {
            // accumulate entered text value
            recordedActions[recordedActions.length - 1].value += event.key;
        } else {
            const action = {
                id: incrementActionIndex(),
                type: "pageLevelTextInput",
                timestamp: Date.now(),
                tag: target.tagName,
                selector: "body",
                boundingBox: getBoundingBox(target),
                value: event.key,
                htmlIndex: recordedHtmlIndex,
            };

            recordedActions.push(action);
        }
    }

    await saveRecordedActions();
}

/**
 * Records a scroll event
 */
export async function recordScroll(): Promise<void> {
    recordedActions.push({
        id: incrementActionIndex(),
        type: "scroll",
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        timestamp: Date.now(),
        htmlIndex: recordedHtmlIndex,
    });

    await saveRecordedActions();
}

/**
 * Records a navigation event
 */
export async function recordNavigation(): Promise<void> {
    recordedActions.push({
        id: incrementActionIndex(),
        type: "navigation",
        url: window.location.href,
        timestamp: Date.now(),
        htmlIndex: recordedHtmlIndex,
    });

    await saveRecordedActions();
}
