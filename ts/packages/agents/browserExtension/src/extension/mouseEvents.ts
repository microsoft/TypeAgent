// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function simulateMouseClick(element: HTMLElement): void {
    element.focus();
    const options = { bubbles: true, cancelable: true, view: window };
    const events = [
        new MouseEvent("mouseenter", options),
        new MouseEvent("mouseover", options),
        new FocusEvent("focusin", options),
        new MouseEvent("mousedown", options),
        new PointerEvent("pointerdown", options),
        new MouseEvent("mouseup", options),
        new PointerEvent("pointerup", options),
        new MouseEvent("click", options),
    ];
    for (const event of events) element.dispatchEvent(event);
}
