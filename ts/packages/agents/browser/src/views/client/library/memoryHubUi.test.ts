// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    iconButton,
    menuButton,
    setIconButton,
    watchSlowRequest,
} from "./memoryHubUi";

afterEach(() => {
    document.body.replaceChildren();
});

test("icon buttons keep an accessible name and tooltip", () => {
    const action = jest.fn();
    const button = iconButton("fa-xmark", "Close", action, "danger");
    document.body.append(button);
    expect(button.getAttribute("aria-label")).toBe("Close");
    expect(button.title).toBe("Close");
    expect(button.textContent).toBe("");
    expect(button.classList.contains("icon-btn")).toBe(true);
    expect(button.classList.contains("danger")).toBe(true);
    expect(button.querySelector("i")!.className).toBe("fa-solid fa-xmark");
    button.click();
    expect(action).toHaveBeenCalledTimes(1);
});

test("setIconButton replaces visible text and accepts a style prefix", () => {
    const button = document.createElement("button");
    button.textContent = "Delete event";
    setIconButton(button, "fa-regular fa-trash-can", "Delete event");
    expect(button.textContent).toBe("");
    expect(button.querySelector("i")!.className).toBe(
        "fa-regular fa-trash-can",
    );
});

test("menus open on demand, evaluate disabled state late and close on use", () => {
    const first = jest.fn();
    const second = jest.fn();
    let locked = true;
    const host = menuButton("More", [
        { label: "Reindex", icon: "fa-rotate", action: first },
        {
            label: "Forget",
            icon: "fa-trash",
            danger: true,
            disabled: () => locked,
            action: second,
        },
    ]);
    document.body.append(host);
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    expect(host.querySelector(".hub-menu")).toBeNull();
    trigger.click();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const items = host.querySelectorAll<HTMLButtonElement>("[role=menuitem]");
    expect(items).toHaveLength(2);
    expect(items[1].disabled).toBe(true);
    expect(items[1].classList.contains("danger")).toBe(true);
    items[0].click();
    expect(first).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".hub-menu")).toBeNull();
    locked = false;
    trigger.click();
    host.querySelectorAll<HTMLButtonElement>("[role=menuitem]")[1].click();
    expect(second).toHaveBeenCalledTimes(1);
});

test("Escape and outside clicks close an open menu", () => {
    const host = menuButton("More", [
        { label: "Reindex", icon: "fa-rotate", action: jest.fn() },
    ]);
    document.body.append(host);
    const trigger = host.querySelector<HTMLButtonElement>("button")!;
    trigger.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host.querySelector(".hub-menu")).toBeNull();
    trigger.click();
    document.body.click();
    expect(host.querySelector(".hub-menu")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

test("opening a second menu closes the first", () => {
    const one = menuButton("One", [
        { label: "A", icon: "fa-a", action: jest.fn() },
    ]);
    const two = menuButton("Two", [
        { label: "B", icon: "fa-b", action: jest.fn() },
    ]);
    document.body.append(one, two);
    one.querySelector("button")!.click();
    two.querySelector("button")!.click();
    expect(one.querySelector(".hub-menu")).toBeNull();
    expect(two.querySelector(".hub-menu")).not.toBeNull();
});

describe("slow request watcher", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test("fast requests never show the note", () => {
        const status = document.createElement("p");
        const stop = watchSlowRequest(status, jest.fn(), 1000);
        jest.advanceTimersByTime(500);
        stop();
        jest.advanceTimersByTime(2000);
        expect(status.querySelector("button")).toBeNull();
    });

    test("slow requests offer Cancel once and remove the note on cancel", () => {
        const status = document.createElement("p");
        const onCancel = jest.fn();
        watchSlowRequest(status, onCancel, 1000);
        jest.advanceTimersByTime(1000);
        expect(status.textContent).toContain("taking longer than usual");
        status.querySelector("button")!.click();
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(status.querySelector(".hub-slow-note")).toBeNull();
    });

    test("settling after the note appears removes it", () => {
        const status = document.createElement("p");
        const stop = watchSlowRequest(status, jest.fn(), 1000);
        jest.advanceTimersByTime(1000);
        stop();
        expect(status.querySelector(".hub-slow-note")).toBeNull();
    });
});
