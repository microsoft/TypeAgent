// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Typesets the placeholders produced by markdownMath. KaTeX output is built
// from the formula text only (trust is off), and a formula that fails to
// parse stays visible as its source with an error marker.
export async function renderMathIn(root: HTMLElement): Promise<void> {
    const targets = Array.from(root.querySelectorAll<HTMLElement>(".md-math"));
    if (!targets.length) return;
    let katex: typeof import("katex").default;
    try {
        katex = (await import("katex")).default;
    } catch (error) {
        console.warn("Math rendering unavailable.", error);
        return;
    }
    for (const target of targets) {
        if (!target.isConnected) continue;
        const tex = target.dataset.tex ?? "";
        try {
            katex.render(tex, target, {
                displayMode: target.dataset.display === "true",
                throwOnError: true,
                trust: false,
                strict: "ignore",
                maxExpand: 1000,
                maxSize: 50,
            });
            target.classList.add("md-math-rendered");
        } catch (error) {
            // KaTeX clears the element before it throws.
            target.textContent = tex;
            target.classList.add("md-math-error");
            target.title =
                error instanceof Error ? error.message : "Invalid formula";
        }
    }
}
