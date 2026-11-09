// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { renderMathIn } from "./mathView";

jest.mock(
    "katex",
    () => ({
        __esModule: true,
        default: {
            render: (tex: string, element: HTMLElement) => {
                element.textContent = "";
                if (tex.includes("\bad")) throw new Error("ParseError");
                element.innerHTML = `<span class="katex">${tex}</span>`;
            },
        },
    }),
    { virtual: true },
);

function host(html: string) {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.append(root);
    return root;
}

test("placeholders are typeset in place", async () => {
    const root = host(
        '<span class="md-math" data-tex="x^2" data-display="false">x^2</span>',
    );
    await renderMathIn(root);
    expect(root.querySelector(".katex")!.textContent).toBe("x^2");
    expect(root.querySelector(".md-math-rendered")).not.toBeNull();
});

test("a formula that fails keeps its source and is marked", async () => {
    const root = host(
        '<span class="md-math" data-tex="\bad" data-display="false">\bad</span>',
    );
    await renderMathIn(root);
    const formula = root.querySelector<HTMLElement>(".md-math")!;
    expect(formula.textContent).toBe("\bad");
    expect(formula.classList.contains("md-math-error")).toBe(true);
    expect(formula.title).toBe("ParseError");
});

test("content without math never loads KaTeX", async () => {
    const root = host("<p>plain</p>");
    await expect(renderMathIn(root)).resolves.toBeUndefined();
});
