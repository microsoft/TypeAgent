// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { renderMarkdown } from "./markdownRenderer";

function render(markdown: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = renderMarkdown(markdown);
    return host;
}
const math = (host: HTMLElement) =>
    Array.from(host.querySelectorAll<HTMLElement>(".md-math"));

test("inline $...$ becomes a placeholder holding the TeX source", () => {
    const host = render("Energy is $E = mc^2$ here.");
    const [formula] = math(host);
    expect(formula.dataset.tex).toBe("E = mc^2");
    expect(formula.dataset.display).toBe("false");
    expect(formula.tagName).toBe("SPAN");
    expect(host.textContent).toContain("Energy is");
});

test("underscores and braces inside a formula are not Markdown", () => {
    const host = render("Sum $a_1 + a_2 * b_{i}$ done");
    expect(math(host)[0].dataset.tex).toBe("a_1 + a_2 * b_{i}");
    expect(host.querySelector("em")).toBeNull();
});

test("currency and lone dollar signs are left alone", () => {
    expect(math(render("It costs $5 and $10 today."))).toHaveLength(0);
    expect(math(render("Price: $ 5 and more $ later"))).toHaveLength(0);
    expect(math(render(String.raw`Escaped \$x\$ stays text`))).toHaveLength(0);
});

test("$$ blocks, multi-line blocks and bracket blocks render as display math", () => {
    const single = math(render("$$x^2 + y^2$$"));
    expect(single[0].dataset.display).toBe("true");
    expect(single[0].tagName).toBe("DIV");
    const multi = math(
        render(
            String.raw`Before

$$
\int_0^1 x\,dx
= \tfrac12
$$

After`,
        ),
    );
    expect(multi).toHaveLength(1);
    expect(multi[0].dataset.tex).toBe(
        String.raw`\int_0^1 x\,dx` + "\n= " + String.raw`\tfrac12`,
    );
    const bracket = math(
        render(String.raw`\[
a + b
\]`),
    );
    expect(bracket[0].dataset.tex).toBe("a + b");
    expect(bracket[0].dataset.display).toBe("true");
});

test("parenthesis delimiters are recognized inline", () => {
    const [formula] = math(
        render(String.raw`Let \(x \in \mathbb{R}\) be real.`),
    );
    expect(formula.dataset.tex).toBe(String.raw`x \in \mathbb{R}`);
    expect(formula.dataset.display).toBe("false");
});

test("math inside code spans and fences is not touched", () => {
    expect(math(render("Use `$x$` literally"))).toHaveLength(0);
    expect(math(render("```\n$$y$$\n```"))).toHaveLength(0);
});

test("TeX source is escaped, never injected as markup", () => {
    const host = render("$<img src=x onerror=alert(1)>$");
    expect(host.querySelector("img")).toBeNull();
    expect(math(host)[0].dataset.tex).toBe("<img src=x onerror=alert(1)>");
});
