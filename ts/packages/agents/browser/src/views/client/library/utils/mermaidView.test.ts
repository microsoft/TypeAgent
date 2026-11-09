// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const render = jest.fn();
const parse = jest.fn();
const initialize = jest.fn();
jest.mock(
    "mermaid",
    () => ({
        __esModule: true,
        default: {
            render: (...args: unknown[]) => render(...args),
            parse: (...args: unknown[]) => parse(...args),
            initialize: (...args: unknown[]) => initialize(...args),
        },
    }),
    { virtual: true },
);

import { createMermaidPreview, renderMermaidIn } from "./mermaidView";

beforeEach(() => {
    jest.clearAllMocks();
    document.body.replaceChildren();
    parse.mockResolvedValue(true);
    render.mockImplementation(async (id: string, source: string) => ({
        svg: `<svg id="${id}"><text>${source.length}</text></svg>`,
    }));
});

function block(source: string) {
    const root = document.createElement("div");
    root.innerHTML = `<pre><code class="language-mermaid"></code></pre>`;
    root.querySelector("code")!.textContent = source;
    document.body.append(root);
    return root;
}

test("diagrams use the strict security level", async () => {
    await renderMermaidIn(block("graph TD; A-->B"));
    expect(initialize).toHaveBeenCalledWith(
        expect.objectContaining({
            securityLevel: "strict",
            htmlLabels: false,
        }),
    );
});

test("a mermaid block is replaced by its diagram", async () => {
    const root = block("graph TD; A-->B");
    await renderMermaidIn(root);
    expect(root.querySelector("figure.hub-mermaid svg")).not.toBeNull();
    expect(root.querySelector("pre")).toBeNull();
});

test("a diagram that fails keeps the code and explains why", async () => {
    parse.mockRejectedValue(new Error("Parse error on line 1"));
    const root = block("not a diagram");
    await renderMermaidIn(root);
    expect(root.querySelector("pre")).not.toBeNull();
    expect(root.querySelector(".hub-mermaid-error")!.textContent).toContain(
        "Parse error on line 1",
    );
    expect(root.querySelector("svg")).toBeNull();
});

test("editor previews show a placeholder, then the cached diagram", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const preview = createMermaidPreview(host);
    const first = preview("graph TD; A-->B");
    expect(first).toContain("Rendering diagram");
    host.innerHTML = first;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(host.querySelector("svg")).not.toBeNull();
    expect(host.querySelector("[data-mermaid-key]")).toBeNull();
    expect(preview("graph TD; A-->B")).toContain("<svg");
    expect(render).toHaveBeenCalledTimes(1);
});
