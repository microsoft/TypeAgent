// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collect } from "../../src/extension/contentScript/crossword/collector";
import {
    CrosswordDecisionHost,
    type RuntimeCall,
} from "../../src/extension/contentScript/crossword/decisionHost";
import { enterExolve } from "../../src/extension/contentScript/crossword/exolveEntry";
import type { ResolveCrosswordClueRequest } from "@typeagent/browser-control-rpc/crosswordDecisionTypes";
import { initializeCrosswordBridge } from "../../src/extension/contentScript/crossword/bridge";

describe("narrow isolated-world window bridge", () => {
    test("ignores page-supplied mode and foreign messages", async () => {
        fixture();
        const runtime = runtimeMock();
        runtime.mode("generative");
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
            runtime.runtime,
        );
        const post = jest
            .spyOn(window, "postMessage")
            .mockImplementation(() => {});
        const dispose = initializeCrosswordBridge();
        window.dispatchEvent(
            new MessageEvent("message", {
                source: window,
                origin: location.origin,
                data: {
                    type: "typeagent-crossword-request",
                    requestId: "page-mode",
                    method: "readClue",
                    mode: "decision",
                    params: {
                        clueNumber: 1,
                        clueDirection: "across",
                        selector: "body",
                    },
                },
            }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(post).toHaveBeenCalledWith(
            expect.objectContaining({
                requestId: "page-mode",
                error: expect.stringContaining("decision mode is not selected"),
            }),
            location.origin,
        );
        const before = runtime.runtime.mock.calls.length;
        window.dispatchEvent(
            new MessageEvent("message", {
                source: window,
                origin: "https://foreign.invalid",
                data: {
                    type: "typeagent-crossword-request",
                    requestId: "foreign",
                    method: "status",
                },
            }),
        );
        await Promise.resolve();
        expect(runtime.runtime.mock.calls).toHaveLength(before);
        dispose();
        post.mockRestore();
    });
    test("does not proxy arbitrary JavaScript or RPC", async () => {
        const runtime = runtimeMock();
        (chrome.runtime.sendMessage as jest.Mock).mockImplementation(
            runtime.runtime,
        );
        const post = jest
            .spyOn(window, "postMessage")
            .mockImplementation(() => {});
        const dispose = initializeCrosswordBridge();
        window.dispatchEvent(
            new MessageEvent("message", {
                source: window,
                origin: location.origin,
                data: {
                    type: "typeagent-crossword-request",
                    requestId: "proxy",
                    method: "evaluate",
                    params: { code: "arbitrary" },
                },
            }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(post).toHaveBeenCalledWith(
            expect.objectContaining({
                requestId: "proxy",
                error: expect.stringContaining(
                    "unknown crossword bridge method",
                ),
            }),
            location.origin,
        );
        dispose();
        post.mockRestore();
    });
});

function fixture(count = 16): void {
    document.body.innerHTML = `<section role="group" aria-roledescription="crossword">
        <h2>Puzzle</h2><div aria-label="Across"><h3>Across</h3><ul>${Array.from(
            { length: count },
            (_, i) =>
                `<li><span>${i + 1}</span><span>Visible clue ${i + 1}</span></li>`,
        ).join("")}</ul></div></section>`;
}

function runtimeMock() {
    let mode = "decision";
    let config = "config-1";
    let resolver:
        | ((request: ResolveCrosswordClueRequest) => Promise<unknown>)
        | undefined;
    const runtime = jest.fn(async (message: unknown): Promise<unknown> => {
        const data = message as {
            type: string;
            method?: string;
            params: ResolveCrosswordClueRequest;
        };
        if (data.type === "getCrosswordMode") return { mode };
        if (data.type === "cancelCrosswordDecisionRpc") return {};
        if (data.method === "getCrosswordDecisionCapabilities")
            return { available: true, configGeneration: config };
        if (resolver) return resolver(data.params);
        return {
            ...data.params.snapshot,
            configGeneration: config,
            status: "resolved",
            candidateId: "c0",
            fit: 0.9,
        };
    });
    return {
        runtime: runtime as jest.Mock & RuntimeCall,
        mode: (value: string) => {
            mode = value;
        },
        config: (value: string) => {
            config = value;
        },
        resolve: (value: typeof resolver) => {
            resolver = value;
        },
    };
}

beforeAll(() => {
    Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: require("node:crypto").randomUUID,
    });
    Object.defineProperty(Element.prototype, "getClientRects", {
        configurable: true,
        value: () => [{ width: 10, height: 10 }],
    });
    if (!globalThis.TextEncoder) {
        // jsdom omits the platform encoder even though the extension has it.
        const { TextEncoder } = require("node:util");
        Object.assign(globalThis, { TextEncoder });
    }
});
afterEach(() => {
    document.body.innerHTML = "";
});

describe("generic accessible candidate recall (not provider calibration)", () => {
    test.each([16, 32, 64])(
        "retains every split number/text row at %i candidates",
        (count) => {
            fixture(count);
            const state = collect("document", 0, 0);
            expect(state.snapshot.complete).toBe(true);
            expect(state.snapshot.candidates).toHaveLength(count);
            state.snapshot.candidates.forEach((candidate, index) => {
                expect(candidate.text).toBe(
                    `${index + 1} Visible clue ${index + 1}`,
                );
                expect(candidate.context).toContain("Across");
                expect(candidate).not.toHaveProperty("clueNumber");
                expect(candidate).not.toHaveProperty("direction");
                const entry = state.registry.get(candidate.id)!;
                expect(document.querySelectorAll(entry.selector)).toHaveLength(
                    1,
                );
                expect(document.querySelector(entry.selector)).toBe(entry.node);
            });
        },
    );
    test("overflow is explicitly incomplete, never a guessed shortlist", () => {
        fixture(65);
        expect(() => collect("doc", 0, 0)).toThrow("incomplete candidate set");
    });
    test("overlong evidence is rejected rather than truncated", () => {
        fixture();
        document.querySelector("li")!.append("x".repeat(513));
        expect(() => collect("doc", 0, 0)).toThrow("text bound");
    });
    test("UTF-8 snapshot byte overflow is rejected without truncation", () => {
        fixture(64);
        document.querySelectorAll("li span:last-child").forEach((node) => {
            node.textContent = "界".repeat(450);
        });
        expect(() => collect("doc", 0, 0)).toThrow("byte bound");
    });
    test("split leaves promote to minimal non-semantic rows", () => {
        fixture(1);
        document.querySelector("ul")!.outerHTML =
            "<div><span>1</span><span>Split visible clue</span></div>";
        const state = collect("doc", 0, 0);
        expect(state.snapshot.candidates).toHaveLength(1);
        expect(state.snapshot.candidates[0].text).toBe("1 Split visible clue");
    });
    test("duplicate puzzles cannot establish an active puzzle", () => {
        fixture();
        document.body.append(
            document.querySelector("section")!.cloneNode(true),
        );
        expect(() => collect("doc", 0, 0)).toThrow("ambiguous puzzle");
    });
    test("hidden and unrelated page inputs never become evidence", () => {
        fixture();
        document
            .querySelector("section")!
            .insertAdjacentHTML(
                "beforeend",
                '<input value="private"><p hidden>secret</p>',
            );
        expect(JSON.stringify(collect("doc", 0, 0).snapshot)).not.toMatch(
            /private|secret/,
        );
    });
});

describe("isolated decision lifecycle", () => {
    let host: CrosswordDecisionHost;
    let mock: ReturnType<typeof runtimeMock>;
    beforeEach(() => {
        fixture();
        mock = runtimeMock();
        host = new CrosswordDecisionHost(mock.runtime);
    });

    describe("DOM-verified rectangular Exolve pilot executor", () => {
        function engine() {
            document.body.innerHTML = `<div class="xlv-frame"><div class="xlv-clues-panel">
                <div class="xlv-clues-label">Across</div><table id="pilot-across">
                <tr><td class="xlv-clue-label">1</td><td><span class="xlv-clue-text">Three letters (3)</span></td></tr></table>
                </div><svg>${[1, 25, 49]
                    .map(
                        (
                            x,
                            i,
                        ) => `<g><rect x="${x}" y="1" width="23" height="23"/>
                    <text class="xlv-cell-text"></text>${i === 0 ? '<text class="xlv-cell-num">1</text>' : ""}</g>`,
                    )
                    .join("")}
                    <g><rect x="1" y="25" width="23" height="23"/><text class="xlv-cell-text">Z</text></g></svg>
                <div class="xlv-grid-input-wrapper" style="left:1px;top:1px"><input class="xlv-grid-input"></div></div>`;
            const state = collect("doc", 0, 0);
            const binding = state.registry.get("c0")!;
            const input = document.querySelector<HTMLInputElement>("input")!;
            const wrapper = document.querySelector<HTMLElement>(
                ".xlv-grid-input-wrapper",
            )!;
            const letters = document.querySelectorAll("svg text.xlv-cell-text");
            let index = 0;
            binding.node.addEventListener("click", () => {
                binding.node.classList.add("xlv-active-clue");
                input.focus();
            });

            input.addEventListener("input", () => {
                letters[index].textContent = input.value;
                index++;
                wrapper.style.left = `${[1, 25, 49][Math.min(index, 2)]}px`;
            });
            return { state, binding, input, wrapper, letters };
        }
        test("uppercase exact length, per-keystroke focus and rendered readback", () => {
            const { state, binding, letters } = engine();
            expect(
                enterExolve(state, binding, "cat", 1, "across", () => {}),
            ).toEqual({ entered: 3, verified: true });
            expect([...letters].map((node) => node.textContent).join("")).toBe(
                "CATZ",
            );
        });
        test("conflicting crossings and unsupported lengths cause no typing", () => {
            const { state, binding, input, letters } = engine();
            letters[1].textContent = "X";
            expect(() =>
                enterExolve(state, binding, "CAT", 1, "across", () => {}),
            ).toThrow("crossing_conflict");
            expect(input.value).toBe("");
            expect(() =>
                enterExolve(state, binding, "TOO-LONG", 1, "across", () => {}),
            ).toThrow("original letters only");
        });
        test("wrong focus reports partial execution without replay", () => {
            const { state, binding, input } = engine();
            input.addEventListener("input", () => input.blur());
            expect(() =>
                enterExolve(state, binding, "CAT", 1, "across", () => {}),
            ).toThrow("partial_entry: 1/3; wrong_grid_focus; no retry");
            expect(input.value).toBe("C");
        });
        test("protected cells changing after a keystroke are reported", () => {
            const { state, binding, input, letters } = engine();
            input.addEventListener("input", () => {
                letters[3].textContent = "Q";
            });
            expect(() =>
                enterExolve(state, binding, "CAT", 1, "across", () => {}),
            ).toThrow("protected_crossing_changed");
        });
    });
    afterEach(() => host.dispose());
    const matches = (mock: ReturnType<typeof runtimeMock>) =>
        mock.runtime.mock.calls.filter(
            ([message]) => message.method === "resolveCrosswordClue",
        );

    test("warm bindings perform zero additional inference", async () => {
        expect((await host.readClue(1, "across")).text).toContain(
            "Visible clue 1",
        );
        await host.readClue(1, "across");
        expect(matches(mock)).toHaveLength(1);
    });
    test("coalesces simultaneous same-clue matches", async () => {
        await Promise.all([
            host.readClue(1, "across"),
            host.readClue(1, "across"),
        ]);
        expect(matches(mock)).toHaveLength(1);
    });
    test("queued text mutation invalidates before cache use", async () => {
        await host.readClue(1, "across");
        document.querySelector("li span:last-child")!.textContent =
            "Replacement";
        expect((await host.readClue(1, "across")).text).toContain(
            "Replacement",
        );
        expect(matches(mock)).toHaveLength(2);
    });
    test("highlight changes do not invalidate unchanged evidence", async () => {
        await host.readClue(1, "across");
        document.querySelector("li")!.className = "active";
        await host.readClue(1, "across");
        expect(matches(mock)).toHaveLength(1);
    });
    test("replacement nodes with identical text do not retain handles", async () => {
        await host.readClue(1, "across");
        const original = document.querySelector("li")!;
        original.replaceWith(original.cloneNode(true));
        await host.readClue(1, "across");
        expect(matches(mock)).toHaveLength(2);
    });
    test("configuration changes invalidate warm bindings", async () => {
        await host.readClue(1, "across");
        mock.config("config-2");
        await host.readClue(1, "across");
        expect(matches(mock)).toHaveLength(2);
    });
    test("mode changes reject late matches without fallback", async () => {
        let finish!: (value: unknown) => void;
        let request!: ResolveCrosswordClueRequest;
        mock.resolve(async (params) => {
            request = params;
            return new Promise((resolve) => {
                finish = resolve;
            });
        });
        const pending = host.readClue(1, "across");
        for (let i = 0; i < 20 && !finish; i++)
            await new Promise((resolve) => setTimeout(resolve, 0));
        expect(finish).toBeDefined();
        host.changeMode("generative");
        finish({
            ...request.snapshot,
            status: "resolved",
            candidateId: "c0",
            fit: 0.99,
            configGeneration: "config-1",
        });
        await expect(pending).rejects.toThrow("stale");
    });
    test("unknown accessible layouts are read-only", async () => {
        await expect(host.enterText("ABC", 1, "across")).rejects.toThrow(
            "verified entry requires",
        );
    });
    test("unissued candidates cannot authorize reads", async () => {
        mock.resolve(async (request) => ({
            ...request.snapshot,
            configGeneration: "config-1",
            status: "resolved",
            candidateId: "invented",
            fit: 0.99,
        }));
        await expect(host.readClue(1, "across")).rejects.toThrow("unissued");
    });
    test("crossing and answer validation happen before entry", () => {
        const state = collect("doc", 0, 0);
        expect(() =>
            enterExolve(
                state,
                state.registry.get("c0")!,
                "A B",
                1,
                "across",
                () => {},
            ),
        ).toThrow("original letters only");
    });
});
