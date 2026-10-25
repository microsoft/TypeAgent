// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { collect } from "../../src/extension/contentScript/crossword/collector";
import {
    CrosswordDecisionHost,
    type RuntimeCall,
} from "../../src/extension/contentScript/crossword/decisionHost";
import { enterExolve } from "../../src/extension/contentScript/crossword/exolveEntry";
import { enterCrossword } from "../../src/extension/contentScript/crossword/entry";
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

describe("Decision body bindings", () => {
    test("an entry-only target upgrades to a body without target reselection", async () => {
        fixture();
        const mock = runtimeMock();
        const host = new CrosswordDecisionHost(mock.runtime);
        await expect(host.enterText("ABC", 1, "across")).rejects.toThrow(
            "verified entry requires",
        );
        const requests = () =>
            mock.runtime.mock.calls
                .map(([message]) => message)
                .filter((message) => message.method === "resolveCrosswordClue");
        expect(requests()[0].params.includeBody).toBeUndefined();
        expect(await host.readClue(1, "across")).toEqual({
            text: "Visible clue 1",
        });
        expect(requests()).toHaveLength(2);
        expect(requests()[1].params).toMatchObject({
            includeBody: true,
            bodyCandidateId: "c0",
        });
        await host.readClue(1, "across");
        expect(requests()).toHaveLength(2);
        host.dispose();
    });
    test("a missing body does not return labelled text", async () => {
        fixture();
        const mock = runtimeMock();
        mock.resolve(async (request) => ({
            ...request.snapshot,
            status: "resolved",
            candidateId: "c0",
            configGeneration: "config-1",
            body: null,
        }));
        const host = new CrosswordDecisionHost(mock.runtime);
        await expect(host.readClue(1, "across")).rejects.toThrow(
            "invalid clue body binding",
        );
        host.dispose();
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
    let strategy = "hybrid";
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
        if (data.type === "getCrosswordMode") return { mode, strategy };
        if (data.type === "cancelCrosswordDecisionRpc") return {};
        if (data.method === "getCrosswordDecisionCapabilities")
            return { available: true, configGeneration: config };
        if (resolver) {
            const result = await resolver(data.params);
            if (
                result &&
                typeof result === "object" &&
                "status" in result &&
                result.status === "resolved" &&
                "candidateId" in result &&
                !("body" in result) &&
                data.params.includeBody
            ) {
                const candidate = data.params.snapshot.candidates.find(
                    (entry) => entry.id === result.candidateId,
                );
                if (candidate)
                    return { ...result, body: fixtureBody(candidate.text) };
            }
            return result;
        }
        return {
            ...data.params.snapshot,
            configGeneration: config,
            status: "resolved",
            candidateId: "c0",
            ...(data.params.includeBody
                ? { body: fixtureBody(data.params.snapshot.candidates[0].text) }
                : {}),
        };
    });
    return {
        runtime: runtime as jest.Mock & RuntimeCall,
        mode: (value: string) => {
            mode = value;
        },
        strategy: (value: string) => {
            strategy = value;
        },
        config: (value: string) => {
            config = value;
        },
        resolve: (value: typeof resolver) => {
            resolver = value;
        },
    };
}

function fixtureBody(text: string) {
    const start = /^\d+[.]?\s+/.exec(text)?.[0].length ?? 0;
    return { start, end: text.length, text: text.slice(start) };
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
    test.each([16, 32, 64, 65, 128, 253, 254, 512])(
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
        document.body.innerHTML = `<ul>${Array.from(
            { length: 2049 },
            (_, i) => `<li>${i + 1} Clue</li>`,
        ).join("")}</ul>`;
        expect(() => collect("doc", 0, 0)).toThrow("incomplete candidate set");
    });
    test("overlong evidence is rejected rather than truncated", () => {
        fixture();
        document.querySelector("li")!.append("x".repeat(513));
        expect(() => collect("doc", 0, 0)).toThrow("text bound");
    });
    test("UTF-8 snapshot byte overflow is rejected without truncation", () => {
        document.body.innerHTML = `<ul>${Array.from(
            { length: 1400 },
            (_, i) => `<li>${i + 1} ${"界".repeat(500)}</li>`,
        ).join("")}</ul>`;
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
    test("collects unrelated content and generic clues without engine roots", () => {
        document.body.innerHTML = `News before the puzzle
            <nav><a href="#">News</a></nav>
            <main><h2>Across</h2><div><div>1</div><div>Beam of light</div></div>
            <h2>Down</h2><p>1 Not dark</p></main><footer>Copyright</footer>`;
        const state = collect("doc", 0, 0);
        expect(state.snapshot.candidates.map((entry) => entry.text)).toEqual([
            "News before the puzzle",
            "News",
            "1 Beam of light",
            "1 Not dark",
            "Copyright",
        ]);
        expect(state.snapshot.candidates[2].context).toBe("Across");
        expect(state.snapshot.candidates[3].context).toBe("Down");
        expect(state.snapshot.candidates[2].regionId).toBeDefined();
        expect(state.snapshot.candidates[2].scopeId).toBeDefined();
    });
    test("empty documents have complete empty local inventories", () => {
        document.body.replaceChildren();
        expect(collect("doc", 0, 0).snapshot.candidates).toEqual([]);
    });
    test("numbered clue headings remain entries, not just group context", () => {
        document.body.innerHTML =
            "<h3><span>1</span> Across Beam of light</h3><h3>1 Down Not dark</h3>";
        expect(
            collect("doc", 0, 0).snapshot.candidates.map((entry) => entry.text),
        ).toEqual(["1 Across Beam of light", "1 Down Not dark"]);
    });
    test("plain direction labels supply context without engine classes or heading roles", () => {
        document.body.innerHTML =
            "<div><div>Across</div><table><tr><td>1</td><td>Beam of light</td></tr></table><div>Down</div><p>1 Not dark</p></div>";
        const candidates = collect("doc", 0, 0).snapshot.candidates;
        expect(
            candidates.find((entry) => entry.text === "1 Beam of light")
                ?.context,
        ).toBe("Across");
        expect(
            candidates.find((entry) => entry.text === "1 Not dark")?.context,
        ).toBe("Down");
    });
    test("separate puzzles retain separate scopes", () => {
        fixture(1);
        document.body.append(
            document.querySelector("section")!.cloneNode(true),
        );
        const candidates = collect("doc", 0, 0).snapshot.candidates;
        expect(candidates).toHaveLength(2);
        expect(candidates[0].scopeId).not.toBe(candidates[1].scopeId);
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
    test("live progress is not clue evidence, including the known Exolve counter", () => {
        fixture(1);
        document.body.insertAdjacentHTML(
            "beforeend",
            '<div role="status">Loading</div><div class="xlv-frame"><div class="xlv-status">Squares filled: 0</div></div>',
        );
        const state = collect("doc", 0, 0);
        expect(state.snapshot.candidates).toHaveLength(1);
    });
    test("numbered duplicate current views coalesce to stable list nodes", () => {
        fixture(1);
        const before = collect("doc", 0, 0);
        document
            .querySelector("section")!
            .insertAdjacentHTML(
                "afterbegin",
                "<div><span>1a.</span><span>Visible clue 1</span></div>",
            );
        const after = collect("doc", 0, 0);
        expect(after.snapshot.candidates).toEqual(before.snapshot.candidates);
        expect(after.registry.get("c0")!.node).toBe(
            before.registry.get("c0")!.node,
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
        test("physical clue label and direction mapping reject mismatches before typing", () => {
            const { state, binding, letters } = engine();
            expect(() =>
                enterExolve(state, binding, "cat", 2, "across", () => {}),
            ).toThrow("clue label mapping");
            expect(() =>
                enterExolve(state, binding, "cat", 1, "down", () => {}),
            ).toThrow("clue direction mapping");
            expect(
                [...letters].slice(0, 3).map((letter) => letter.textContent),
            ).toEqual(["", "", ""]);
        });
        test("uppercase exact length, per-keystroke focus and rendered readback", () => {
            const { state, binding, letters } = engine();
            expect(
                enterExolve(state, binding, "cat", 1, "across", () => {}),
            ).toEqual({ entered: 3, verified: true });
            expect([...letters].map((node) => node.textContent).join("")).toBe(
                "CATZ",
            );
        });
        test("a Generative clue-text selector uses the same verified Exolve input path", () => {
            const { state, binding, letters } = engine();
            const node = binding.node.querySelector(".xlv-clue-text")!;
            expect(
                enterCrossword(state, { node }, "cat", 1, "across", () => {}),
            ).toEqual({ entered: 3, verified: true });
            expect(
                [...letters].map((letter) => letter.textContent).join(""),
            ).toBe("CATZ");
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
    test("Hybrid2 strategy comes from extension settings and changing it invalidates bindings", async () => {
        mock.strategy("hybrid2");
        await host.readClue(1, "across");
        const first = matches(mock)[0][0].params;
        expect(first.strategy).toBe("hybrid2");
        await host.readClue(1, "across");
        expect(matches(mock)).toHaveLength(1);
        mock.strategy("hybrid");
        await host.readClue(1, "across");
        expect(matches(mock)).toHaveLength(2);
        expect(matches(mock)[1][0].params.strategy).toBe("hybrid");
        expect(matches(mock)[1][0].params.snapshot.snapshotId).not.toBe(
            first.snapshot.snapshotId,
        );
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
    test("progressive publisher content and unrelated candidate removal preserve the cached inventory", async () => {
        mock.strategy("hybrid2");
        await host.readClue(1, "across");
        const snapshot = await host.capture();
        document.body.insertAdjacentHTML(
            "afterbegin",
            "<aside><p>Publisher update</p></aside>",
        );
        document.querySelector("li:last-child")!.remove();
        document.querySelector("aside p")!.textContent = "Another update";
        expect(await host.capture()).toEqual(snapshot);
        expect((await host.readClue(1, "across")).text).toBe("Visible clue 1");
        expect(matches(mock)).toHaveLength(1);
    });
    test("original node handles survive selector drift and changed layout metadata", async () => {
        const original = collect("selector-audit", 0, 0).registry.get("c0")!;
        await host.readClue(1, "across");
        document
            .querySelector("ul")!
            .insertAdjacentHTML("afterbegin", "<li>New placeholder</li>");
        original.node.setAttribute("role", "listitem");
        document.querySelector("h3")!.textContent = "Across clues";
        expect(document.querySelector(original.selector)).not.toBe(
            original.node,
        );
        expect((await host.readClue(1, "across")).text).toBe("Visible clue 1");
        expect(matches(mock)).toHaveLength(1);
    });
    test("unrelated DOM churn during inference does not veto an issued selection", async () => {
        mock.resolve(async (request) => {
            document.body.insertAdjacentHTML(
                "afterbegin",
                "<aside><p>Loaded after capture</p></aside>",
            );
            document.querySelector("li:last-child")!.remove();
            return {
                ...request.snapshot,
                status: "resolved",
                candidateId: "c0",
                configGeneration: "config-1",
            };
        });
        expect((await host.readClue(1, "across")).text).toBe("Visible clue 1");
        expect(matches(mock)).toHaveLength(1);
    });
    test.each(["change", "remove", "replace"])(
        "a first selected target that changes during inference is rejected: %s",
        async (mutation) => {
            const snapshot = await host.capture();
            mock.resolve(async (request) => {
                const node = document.querySelector("li")!;
                if (mutation === "change") node.textContent = "1 New puzzle";
                else if (mutation === "remove") node.remove();
                else node.replaceWith(node.cloneNode(true));
                return {
                    ...request.snapshot,
                    status: "resolved",
                    candidateId: "c0",
                    configGeneration: "config-1",
                };
            });
            await expect(host.readClue(1, "across")).rejects.toThrow("stale");
            expect((await host.capture()).snapshotId).not.toBe(
                snapshot.snapshotId,
            );
        },
    );
    test("an established sentinel invalidates an in-flight selection of an unchanged clue", async () => {
        await host.readClue(1, "across");
        const snapshot = await host.capture();
        mock.resolve(async (request) => {
            document.querySelector("li span:last-child")!.textContent =
                "New edition";
            return {
                ...request.snapshot,
                status: "resolved",
                candidateId: "c1",
                configGeneration: "config-1",
            };
        });
        await expect(host.readClue(2, "across")).rejects.toThrow("stale");
        expect((await host.capture()).snapshotId).not.toBe(snapshot.snapshotId);
        expect(mock.runtime).toHaveBeenCalledWith({
            type: "cancelCrosswordDecisionRpc",
            snapshotId: snapshot.snapshotId,
        });
    });
    test("same-URL puzzle ancestor replacement forces rediscovery even with identical clue text", async () => {
        await host.readClue(1, "across");
        const snapshot = await host.capture();
        const puzzle = document.querySelector("section")!;
        puzzle.replaceWith(puzzle.cloneNode(true));
        await host.readClue(1, "across");
        expect((await host.capture()).snapshotId).not.toBe(snapshot.snapshotId);
        expect(matches(mock)).toHaveLength(2);
    });
    test("selected non-sentinel removal is rejected locally and retires the old inventory", async () => {
        await host.readClue(1, "across");
        const snapshot = await host.capture();
        document.querySelector("li:nth-child(2)")!.remove();
        expect(await host.capture()).toEqual(snapshot);
        await expect(
            host.executeCaptured("readClue", {
                snapshotId: snapshot.snapshotId,
                candidateId: "c1",
                configGeneration: "config-1",
                clueNumber: 2,
                clueDirection: "across",
            }),
        ).rejects.toThrow("stale");
        expect((await host.capture()).snapshotId).not.toBe(snapshot.snapshotId);
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
        }));
        await expect(host.readClue(1, "across")).rejects.toThrow("unissued");
    });
    test("issued model choices authorize reads without verification while physical entry safeguards remain", async () => {
        mock.resolve(async (request) => ({
            ...request.snapshot,
            configGeneration: "config-1",
            status: "resolved",
            candidateId: "c1",
        }));
        expect((await host.readClue(1, "across")).text).toContain(
            "Visible clue 2",
        );
        await expect(host.enterText("ABC", 1, "across")).rejects.toThrow(
            "verified entry requires",
        );
    });
    test("low Choice probability is diagnostic, not an acceptance threshold", async () => {
        mock.resolve(async (request) => ({
            ...request.snapshot,
            configGeneration: "config-1",
            status: "resolved",
            candidateId: "c0",
            choiceProbability: 0.2,
        }));
        expect((await host.readClue(1, "across")).text).toContain(
            "Visible clue 1",
        );
    });
    test("legacy uniqueness-fit cannot override model ambiguity", async () => {
        mock.resolve(async (request) => ({
            ...request.snapshot,
            configGeneration: "config-1",
            status: "ambiguous",
            candidateId: "c0",
            fit: 1,
        }));
        await expect(host.readClue(1, "across")).rejects.toThrow("ambiguous");
    });
    test("missing parsed direction does not override an issued model read", async () => {
        document.querySelector("[aria-label]")!.removeAttribute("aria-label");
        document.querySelector("h3")!.remove();
        expect((await host.readClue(1, "across")).text).toContain(
            "Visible clue 1",
        );
    });
    test("class-renamed table layouts remain readable without engine assumptions", async () => {
        document.body.innerHTML =
            '<div class="different-engine"><div class="different-heading">Across</div><table><tr><td>1</td><td>Beam of light</td></tr></table></div>';
        mock.resolve(async (request) => ({
            ...request.snapshot,
            status: "resolved",
            configGeneration: "config-1",
            candidateId: request.snapshot.candidates.find(
                (entry) => entry.text === "1 Beam of light",
            )?.id,
        }));
        expect((await host.readClue(1, "across")).text).toBe("Beam of light");
    });
    test("same number in Across and Down and other Across numbers do not conflict", async () => {
        document
            .querySelector("section")!
            .insertAdjacentHTML(
                "beforeend",
                "<div><h3>Down</h3><ul><li>1 A different Down clue</li></ul></div>",
            );
        expect((await host.readClue(1, "across")).text).toContain(
            "Visible clue 1",
        );
    });
    test("repeated presentations within one puzzle are allowed", async () => {
        document
            .querySelector("ul")!
            .append(document.querySelector("li")!.cloneNode(true));
        expect((await host.readClue(1, "across")).text).toContain(
            "Visible clue 1",
        );
    });
    test.each(["different text", "different puzzle"])(
        "the host does not add a semantic veto to an issued model choice: %s",
        async (conflict) => {
            if (conflict === "different puzzle")
                document.body.append(
                    document.querySelector("section")!.cloneNode(true),
                );
            else
                document
                    .querySelector("ul")!
                    .insertAdjacentHTML(
                        "beforeend",
                        "<li>1 Conflicting clue</li>",
                    );
            expect((await host.readClue(1, "across")).text).toContain(
                "Visible clue 1",
            );
        },
    );
    test("captured targets are checked locally before use and after mutation", async () => {
        const snapshot = await host.capture();
        const params = {
            snapshotId: snapshot.snapshotId,
            candidateId: "c0",
            configGeneration: "config-1",
            clueNumber: 1,
            clueDirection: "across" as const,
            body: fixtureBody(snapshot.candidates[0].text),
        };
        await expect(host.executeCaptured("readClue", params)).resolves.toEqual(
            {
                text: "Visible clue 1",
            },
        );
        document.querySelector("li")!.textContent = "1 Changed";
        await expect(host.executeCaptured("readClue", params)).rejects.toThrow(
            "stale",
        );
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
