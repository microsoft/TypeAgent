// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadGrammarRules } from "../src/grammarLoader.js";
import { matchGrammar } from "../src/grammarMatcher.js";

// Regression: in `preferSkip` mode the matcher restores the take-frame
// snapshot when the skip path fails, but the snapshot's `partIndex` is
// unchanged and `suppressOptionalFork` is not set, so the optional-fork
// block at the top of `matchState`'s loop fires again.  That re-pushes a
// new take frame and re-enters the same skip path → infinite loop.
//
// The fix should mark the take snapshot as "already-decided" (via
// `suppressOptionalFork: true`) so that on restore the optional-fork
// block is suppressed and the part is matched directly.  The single-use
// flag must then be cleared before the next part to avoid leaking
// suppression onto unrelated downstream optionals.
describe("optionalPolicy: preferSkip take-frame backtrack", () => {
    it("does not infinite-loop when skip fails and take must be tried", () => {
        const grammar = loadGrammarRules(
            "test.grammar",
            `<Start> = (please)? help -> true;`,
        );
        const results = matchGrammar(grammar, "please help", {
            optionalPolicy: "preferSkip",
        }).map((m) => m.match);
        expect(results).toStrictEqual([true]);
    }, 5000);

    it("subsequent optional after a successful take is still considered", () => {
        // Guards against a fix that sets `suppressOptionalFork` on the
        // take snapshot but forgets to clear it after the optional-fork
        // block — which would suppress the trailing optional and lose
        // the (thanks) alternative.
        const grammar = loadGrammarRules(
            "test.grammar",
            `<Start> = (please)? do it (thanks)? -> true;`,
        );
        const results = matchGrammar(grammar, "please do it thanks", {
            optionalPolicy: "preferSkip",
        }).map((m) => m.match);
        expect(results).toStrictEqual([true]);
    }, 5000);
});
