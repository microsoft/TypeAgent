// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { iconButton } from "./memoryHubUi";

export type FlyoutView = {
    title: string;
    // Fills the body. The returned function is called when the view is
    // replaced or closed.
    render: (body: HTMLElement) => void | (() => void);
};

// A panel that slides in from the right edge. Views stack, so a list opened
// from "View all" can drill into an item and go back to the list.
export function mountFlyout(host: HTMLElement, label: string) {
    const panel = document.createElement("aside");
    panel.className = "hub-drawer hub-flyout";
    panel.hidden = true;
    panel.setAttribute("aria-label", label);
    const head = document.createElement("div");
    head.className = "hub-drawer-head";
    const back = iconButton("fa-arrow-left", "Back", () => goBack());
    const title = document.createElement("h2");
    const close = iconButton("fa-xmark", "Close", () => closeFlyout());
    head.append(back, title, close);
    const body = document.createElement("div");
    body.className = "hub-flyout-body";
    panel.append(head, body);
    host.append(panel);

    const stack: Array<{ view: FlyoutView; dispose?: () => void }> = [];
    let opener: HTMLElement | undefined;

    function renderTop() {
        const top = stack[stack.length - 1];
        title.textContent = top.view.title;
        back.hidden = stack.length < 2;
        body.replaceChildren();
        const dispose = top.view.render(body);
        top.dispose = dispose || undefined;
        panel.hidden = false;
        panel.scrollTop = 0;
    }
    function disposeTop() {
        stack[stack.length - 1]?.dispose?.();
    }
    function goBack() {
        if (stack.length < 2) return;
        disposeTop();
        stack.pop();
        renderTop();
        close.focus();
    }
    function closeFlyout() {
        if (panel.hidden) return;
        disposeTop();
        stack.length = 0;
        body.replaceChildren();
        panel.hidden = true;
        if (opener?.isConnected) opener.focus();
        opener = undefined;
    }
    panel.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        closeFlyout();
    });
    return {
        isOpen: () => !panel.hidden,
        open(view: FlyoutView) {
            if (panel.hidden && document.activeElement instanceof HTMLElement)
                opener = document.activeElement;
            disposeTop();
            stack.length = 0;
            stack.push({ view });
            renderTop();
            close.focus();
        },
        push(view: FlyoutView) {
            if (panel.hidden) {
                this.open(view);
                return;
            }
            disposeTop();
            stack.push({ view });
            renderTop();
            close.focus();
        },
        close: closeFlyout,
        dispose() {
            closeFlyout();
            panel.remove();
        },
    };
}
