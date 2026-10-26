// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    UiDecisionHost,
    initializeUiDecisionHost,
} from "../../src/extension/contentScript/uiDecisionHost";
import { TextEncoder } from "node:util";

function fixture() {
    document.body.innerHTML = `
        <form action="/search">
            <label for="search">Search products</label>
            <input id="search" type="search"><button>Search</button>
        </form>
        <article><h2>Coffee 12-pack</h2><button id="pack">Add</button></article>
        <article><h2>Coffee single can</h2><button id="single">Add</button></article>
        <input type="password" value="secret-password">
        <input type="email" value="private@example.com">
        <div hidden><button>Hidden</button>Hidden evidence</div>
        <button disabled>Unavailable</button>
        <select aria-label="Delivery"><option>Pickup</option><option disabled>Express</option></select>`;
}

describe("grounded UI collector and executor", () => {
    beforeEach(() => {
        Object.defineProperty(globalThis, "TextEncoder", {
            configurable: true,
            value: TextEncoder,
        });
        Object.defineProperty(chrome.runtime, "id", {
            configurable: true,
            value: "ui-extension",
        });
        let id = 0;
        Object.defineProperty(crypto, "randomUUID", {
            configurable: true,
            value: () => `ui-${++id}`,
        });
        jest.spyOn(Element.prototype, "getClientRects").mockReturnValue({
            length: 1,
        } as DOMRectList);
        fixture();
    });

    afterEach(() => jest.restoreAllMocks());

    test("collects labels, product context, disabled state and literal options without input values", () => {
        const snapshot = new UiDecisionHost().capture();
        expect(snapshot.complete).toBe(true);
        expect(
            snapshot.candidates.find((item) =>
                item.capabilities.includes("fill"),
            )?.name,
        ).toBe("Search products");
        expect(
            snapshot.candidates
                .filter((item) => item.name === "Add")
                .map((item) => item.context),
        ).toEqual(["Coffee 12-pack Add", "Coffee single can Add"]);
        expect(
            snapshot.candidates.find((item) => item.name === "Unavailable")
                ?.disabled,
        ).toBe(true);
        expect(
            snapshot.candidates.find((item) => item.name === "Delivery")
                ?.options,
        ).toEqual([
            { id: "o0", text: "Pickup", disabled: false },
            { id: "o1", text: "Express", disabled: true },
        ]);
        expect(JSON.stringify(snapshot)).not.toMatch(
            /secret-password|private@example|Hidden evidence|"Hidden"/,
        );
    });

    test("binds the selected live node, consumes it, and does not confuse identical Add labels", () => {
        const host = new UiDecisionHost();
        const snapshot = host.capture();
        const pack = snapshot.candidates.find(
            (item) => item.context === "Coffee 12-pack Add",
        )!;
        const clicked: string[] = [];
        document
            .querySelector("#pack")!
            .addEventListener("click", () => clicked.push("pack"));
        document
            .querySelector("#single")!
            .addEventListener("click", () => clicked.push("single"));
        expect(
            host.execute(snapshot.snapshotId, pack.id, { type: "activate" }),
        ).toEqual({ dispatched: true });
        expect(clicked).toEqual(["pack"]);
        expect(() =>
            host.execute(snapshot.snapshotId, pack.id, { type: "activate" }),
        ).toThrow("stale");
    });

    test("preserves unknown mixed state rather than reporting it as unchecked", () => {
        document.body.innerHTML =
            '<div role="checkbox" aria-label="All variants" aria-checked="mixed">All</div>';
        const candidate = new UiDecisionHost().capture().candidates[0];
        expect(candidate.name).toBe("All variants");
        expect(candidate.checked).toBeUndefined();
    });

    test("snapshot expiry and form destination changes prevent dispatch", () => {
        const host = new UiDecisionHost();
        const snapshot = host.capture();
        const input = snapshot.candidates.find((item) =>
            item.capabilities.includes("fill"),
        )!;
        const submit = jest
            .spyOn(document.querySelector("form")!, "requestSubmit")
            .mockImplementation(() => {});
        document.querySelector("form")!.action = "/checkout";
        expect(() =>
            host.execute(snapshot.snapshotId, input.id, {
                type: "fill",
                text: "coffee",
                submit: true,
            }),
        ).toThrow("stale");
        const fresh = host.capture();
        jest.spyOn(Date, "now").mockReturnValue(fresh.createdAt + 30001);
        expect(() =>
            host.execute(fresh.snapshotId, input.id, {
                type: "fill",
                text: "coffee",
                submit: true,
            }),
        ).toThrow("stale");
        expect(submit).not.toHaveBeenCalled();
    });

    test.each(["replace", "text", "href", "disabled", "new-control"])(
        "rejects %s changes before execution",
        (kind) => {
            document.body.innerHTML =
                '<article><h2>Product A</h2><a href="/a">Details</a></article>';
            const host = new UiDecisionHost();
            const snapshot = host.capture();
            const node = document.querySelector("a")!;
            const click = jest.spyOn(node, "click");
            if (kind === "replace") node.outerHTML = node.outerHTML;
            if (kind === "text")
                document.querySelector("h2")!.textContent = "Product B";
            if (kind === "href") node.href = "/b";
            if (kind === "disabled") node.setAttribute("aria-disabled", "true");
            if (kind === "new-control")
                document.body.insertAdjacentHTML(
                    "beforeend",
                    "<button>New</button>",
                );
            expect(() =>
                host.execute(snapshot.snapshotId, snapshot.candidates[0].id, {
                    type: "activate",
                }),
            ).toThrow("stale");
            expect(click).not.toHaveBeenCalled();
        },
    );

    test("fills the bound input, verifies the value, and submits only its own form", () => {
        const host = new UiDecisionHost();
        const snapshot = host.capture();
        const input = snapshot.candidates.find((item) =>
            item.capabilities.includes("fill"),
        )!;
        const form = document.querySelector("form")!;
        const submit = jest
            .spyOn(form, "requestSubmit")
            .mockImplementation(() => {});
        const events: string[] = [];
        document
            .querySelector("#search")!
            .addEventListener("input", () => events.push("input"));
        document
            .querySelector("#search")!
            .addEventListener("change", () => events.push("change"));
        expect(
            host.execute(snapshot.snapshotId, input.id, {
                type: "fill",
                text: "coffee",
                submit: true,
            }),
        ).toEqual({
            dispatched: true,
            valueVerified: true,
        });
        expect(
            (document.querySelector("#search") as HTMLInputElement).value,
        ).toBe("coffee");
        expect(events).toEqual(["input", "change"]);
        expect(submit).toHaveBeenCalledTimes(1);
    });

    test("never submits after an input handler changes the destination or rejects the value", () => {
        const host = new UiDecisionHost();
        const snapshot = host.capture();
        const input = snapshot.candidates.find((item) =>
            item.capabilities.includes("fill"),
        )!;
        const form = document.querySelector("form")!;
        const submit = jest
            .spyOn(form, "requestSubmit")
            .mockImplementation(() => {});
        document.querySelector("#search")!.addEventListener("input", () => {
            form.action = "/checkout";
        });
        expect(() =>
            host.execute(snapshot.snapshotId, input.id, {
                type: "fill",
                text: "coffee",
                submit: true,
            }),
        ).toThrow("verification_failed");
        expect(submit).not.toHaveBeenCalled();
    });

    test("refuses arbitrary option IDs, disabled options and actions incompatible with the target", () => {
        for (const action of [
            { type: "select", optionId: "invented" },
            { type: "select", optionId: "o1" },
            { type: "activate" },
        ] as const) {
            const host = new UiDecisionHost();
            const snapshot = host.capture();
            const select = snapshot.candidates.find((item) =>
                item.capabilities.includes("select"),
            )!;
            expect(() =>
                host.execute(snapshot.snapshotId, select.id, action),
            ).toThrow("unsupported");
        }
        const host = new UiDecisionHost();
        const snapshot = host.capture();
        const select = snapshot.candidates.find((item) =>
            item.capabilities.includes("select"),
        )!;
        expect(
            host.execute(snapshot.snapshotId, select.id, {
                type: "select",
                optionId: "o0",
            }).valueVerified,
        ).toBe(true);
    });

    test("rejects oversized evidence rather than silently truncating candidates or text", () => {
        document.body.innerHTML = "<button>Button</button>".repeat(254);
        expect(() => new UiDecisionHost().capture()).toThrow("unsupported");
        document.body.innerHTML = `<p>${"x".repeat(30001)}</p>`;
        expect(() => new UiDecisionHost().capture()).toThrow("unsupported");
    });

    test("does not accept page-world or expired execution messages", () => {
        initializeUiDecisionHost();
        const listener = (
            chrome.runtime.onMessage.addListener as jest.Mock
        ).mock.calls.at(-1)![0];
        const reply = jest.fn();
        listener(
            {
                type: "groundedUi",
                expiresAt: Date.now() + 1000,
                request: { method: "capture" },
            },
            { id: "foreign" },
            reply,
        );
        expect(reply).not.toHaveBeenCalled();
        listener(
            {
                type: "groundedUi",
                expiresAt: Date.now() - 1,
                request: { method: "capture" },
            },
            { id: chrome.runtime.id },
            reply,
        );
        expect(reply).toHaveBeenCalledWith({
            error: expect.stringContaining("deadline expired"),
        });
    });
});
