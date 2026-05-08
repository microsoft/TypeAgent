// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseGrammarRules, writeGrammarRules } from "action-grammar";
import type { RuleDefinition } from "action-grammar";
import type {
    LoadedGrammar,
    GrammarDiff,
    RuleChange,
    RuleId,
} from "./types.js";
import { MissingSourceError, hasSource } from "./types.js";

/**
 * Compute a structural rule-level diff between two grammars.
 * Reports rules added, removed, or changed. For changed rules,
 * includes the canonical text of both versions.
 *
 * Requires source files on both grammars (throws MissingSourceError
 * otherwise).
 */
export function diffGrammars(
    before: LoadedGrammar,
    after: LoadedGrammar,
): GrammarDiff {
    if (!hasSource(before)) {
        throw new MissingSourceError(before.source);
    }
    if (!hasSource(after)) {
        throw new MissingSourceError(after.source);
    }

    const beforeRules = collectRules(before);
    const afterRules = collectRules(after);

    const added: RuleId[] = [];
    const removed: RuleId[] = [];
    const changed: RuleChange[] = [];

    // Rules in after but not in before: added
    for (const name of afterRules.keys()) {
        if (!beforeRules.has(name)) {
            added.push(name);
        }
    }

    // Rules in before but not in after: removed
    for (const name of beforeRules.keys()) {
        if (!afterRules.has(name)) {
            removed.push(name);
        }
    }

    // Rules in both: check for changes
    for (const [name, beforeText] of beforeRules) {
        const afterText = afterRules.get(name);
        if (afterText === undefined) continue; // already in removed
        if (beforeText !== afterText) {
            changed.push({
                rule: name,
                reason: classifyChange(
                    beforeRules,
                    afterRules,
                    name,
                    beforeText,
                    afterText,
                ),
                before: beforeText,
                after: afterText,
            });
        }
    }

    return { added, removed, changed };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse source files and collect each rule's canonical text, keyed by
 * rule name.
 */
function collectRules(g: LoadedGrammar): Map<RuleId, string> {
    const rules = new Map<RuleId, string>();
    for (const file of g.files!) {
        let parsed;
        try {
            parsed = parseGrammarRules(file.id, file.text);
        } catch {
            continue; // skip unparseable files
        }
        for (const def of parsed.definitions) {
            const name = def.definitionName.name;
            // Serialize this single rule to canonical text
            const canonical = serializeSingleRule(def);
            rules.set(name, canonical);
        }
    }
    return rules;
}

/**
 * Serialize a single rule definition to its canonical text form.
 */
function serializeSingleRule(def: RuleDefinition): string {
    // Create a minimal parse result with just this one definition
    // and use writeGrammarRules to get canonical text
    const singleResult = {
        imports: [],
        definitions: [def],
    };
    try {
        return writeGrammarRules(singleResult).trim();
    } catch {
        // Fallback: use the definition name
        return `<${def.definitionName.name}> = (serialization failed)`;
    }
}

/**
 * Classify whether a change is to the signature or body of a rule.
 * "signature" = the rule name/type/spacing changed but not the body.
 * "body" = the rule alternatives changed.
 * "value" = only the value expression changed.
 */
function classifyChange(
    _beforeRules: Map<RuleId, string>,
    _afterRules: Map<RuleId, string>,
    _name: RuleId,
    beforeText: string,
    afterText: string,
): "signature" | "body" | "value" {
    // Extract the part before "=" as signature
    const beforeSig = beforeText.split("=")[0]?.trim() ?? "";
    const afterSig = afterText.split("=")[0]?.trim() ?? "";

    if (beforeSig !== afterSig) {
        return "signature";
    }

    // Check if only the value expression differs
    // Value expressions appear after "->" in rule alternatives
    const beforeBody = stripValues(beforeText);
    const afterBody = stripValues(afterText);
    if (beforeBody === afterBody) {
        return "value";
    }

    return "body";
}

/**
 * Strip value expressions (everything after "->") from rule text
 * for body comparison.
 */
function stripValues(text: string): string {
    return text
        .split("\n")
        .map((line) => {
            const arrowIdx = line.indexOf("->");
            return arrowIdx >= 0 ? line.substring(0, arrowIdx).trimEnd() : line;
        })
        .join("\n");
}
