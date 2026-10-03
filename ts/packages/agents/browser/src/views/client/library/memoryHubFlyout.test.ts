// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { mountFlyout } from "./memoryHubFlyout";

let host: HTMLElement;
beforeEach(() => {
    document.body.innerHTML =
        "<button id='opener'>Open</button><div id='h'></div>";
    host = document.getElementById("h")!;
});

function view(title: string, dispose = jest.fn()) {
    return {
        title,
        dispose,
        render: (body: HTMLElement) => {
            body.textContent = `${title} body`;
            return dispose;
        },
    };
}
const panel = () => host.querySelector<HTMLElement>(".hub-flyout")!;
const control = (label: string) =>
    panel().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;

test("starts hidden and opens with a title and body", () => {
    const flyout = mountFlyout(host, "Detail");
    expect(panel().hidden).toBe(true);
    flyout.open(view("Entities"));
    expect(panel().hidden).toBe(false);
    expect(panel().querySelector("h2")!.textContent).toBe("Entities");
    expect(panel().textContent).toContain("Entities body");
    expect(control("Back").hidden).toBe(true);
});

test("pushed views get a Back control that restores and disposes", () => {
    const flyout = mountFlyout(host, "Detail");
    const list = view("List");
    const item = view("Item");
    flyout.open(list);
    flyout.push(item);
    expect(list.dispose).toHaveBeenCalledTimes(1);
    expect(control("Back").hidden).toBe(false);
    expect(panel().querySelector("h2")!.textContent).toBe("Item");
    control("Back").click();
    expect(item.dispose).toHaveBeenCalledTimes(1);
    expect(panel().querySelector("h2")!.textContent).toBe("List");
    expect(control("Back").hidden).toBe(true);
});

test("opening replaces the whole stack", () => {
    const flyout = mountFlyout(host, "Detail");
    flyout.open(view("A"));
    flyout.push(view("B"));
    flyout.open(view("C"));
    expect(control("Back").hidden).toBe(true);
    expect(panel().querySelector("h2")!.textContent).toBe("C");
});

test("Escape and Close hide the panel, dispose the view and restore focus", () => {
    const opener = document.getElementById("opener") as HTMLButtonElement;
    const flyout = mountFlyout(host, "Detail");
    const current = view("A");
    opener.focus();
    flyout.open(current);
    panel().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(panel().hidden).toBe(true);
    expect(current.dispose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(opener);
    flyout.open(view("B"));
    control("Close").click();
    expect(panel().hidden).toBe(true);
    expect(flyout.isOpen()).toBe(false);
});

test("push on a closed flyout opens it", () => {
    const flyout = mountFlyout(host, "Detail");
    flyout.push(view("A"));
    expect(flyout.isOpen()).toBe(true);
    expect(control("Back").hidden).toBe(true);
});
