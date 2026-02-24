// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Expr,
    GrammarParseResult,
    ImportStatement,
    isExpressionSpecialChar,
    isWhitespace,
    Rule,
    RuleDefinition,
    ValueNode,
} from "./grammarRuleParser.js";

export function writeGrammarFile(result: GrammarParseResult): string {
    const parts: string[] = [];

    if (result.entities.length > 0) {
        parts.push(`entity ${result.entities.join(", ")};\n\n`);
    }

    if (result.imports.length > 0) {
        for (const imp of result.imports) {
            parts.push(writeImportStatement(imp));
        }
        parts.push("\n");
    }

    parts.push(writeGrammarRules(result.definitions));
    return parts.join("");
}

function writeImportStatement(imp: ImportStatement): string {
    const names = imp.names === "*" ? "*" : `{ ${imp.names.join(", ")} }`;
    return `import ${names} from "${imp.source}";\n`;
}

export function writeGrammarRules(grammar: RuleDefinition[]): string {
    const result: string[] = [];
    for (const def of grammar) {
        writeRuleDefinition(result, def);
        result.push("\n");
    }

    return result.join("");
}

function writeRuleDefinition(result: string[], def: RuleDefinition) {
    const ruleStart = `<${def.name}> = `;
    result.push(ruleStart);
    writeRules(result, def.rules, ruleStart.length);
    result.push(";");
}

function writeRules(result: string[], rules: Rule[], indent: number) {
    let first = true;

    for (const rule of rules) {
        if (!first) {
            result.push(`\n${" ".repeat(indent)}| `);
        }
        first = false;
        writeRule(result, rule, indent);
    }
}

function writeRule(result: string[], rule: Rule, indent: number) {
    writeExpression(result, rule.expressions, indent);
    if (rule.value !== undefined) {
        result.push(" -> ");
        writeValueNode(result, rule.value, 0);
    }
}

function escapeExpressionString(str: string): string {
    const ret: string[] = [];
    for (const c of str) {
        switch (c) {
            case "\0":
                ret.push("\\0");
                break;
            case "\n":
                ret.push("\\n");
                break;
            case "\r":
                ret.push("\\r");
                break;
            case "\v":
                ret.push("\\v");
                break;
            case "\t":
                ret.push("\\t");
                break;
            case "\b":
                ret.push("\\b");
                break;
            case "\f":
                ret.push("\\f");
                break;
            case "\\":
                ret.push("\\\\");
                break;
            default:
                if (c === " " || isExpressionSpecialChar(c)) {
                    ret.push(`\\${c}`);
                    break;
                }
                // Use unicode escape for other whitespace characters
                if (isWhitespace(c)) {
                    ret.push(`\\u{${c.codePointAt(0)!.toString(16)}}`);
                    break;
                }
                // Note don't need to escape quotes for expressions
                ret.push(c);
                break;
        }
    }
    return ret.join("");
}

function writeExpression(
    result: string[],
    expressions: Expr[],
    indent: number,
) {
    let first = true;
    for (const expr of expressions) {
        if (!first) {
            result.push(" ");
        }
        first = false;

        switch (expr.type) {
            case "string":
                result.push(expr.value.map(escapeExpressionString).join(" "));
                break;
            case "ruleReference":
                result.push(`<${expr.name}>`);
                break;
            case "rules":
                const rules = expr.rules;
                result.push("(");
                writeRules(result, rules, indent);
                result.push(expr.optional ? ")?" : ")");
                break;
            case "variable":
                result.push("$(");
                result.push(expr.name);
                if (expr.refName !== "string") {
                    result.push(":");
                    result.push(
                        expr.ruleReference ? `<${expr.refName}>` : expr.refName,
                    );
                }
                result.push(expr.optional ? ")?" : ")");
                break;
        }
    }
}
function writeValueNode(result: string[], value: ValueNode, indent: number) {
    switch (value.type) {
        case "literal":
            result.push(JSON.stringify(value.value));
            break;
        case "variable":
            result.push(value.name);
            break;
        case "object": {
            const entries = Object.entries(value.value);
            if (entries.length === 0) {
                result.push("{}");
                break;
            }
            result.push("{\n");
            let first = true;
            const innerIndent = indent + 4;
            for (const [key, val] of entries) {
                if (!first) {
                    result.push(",\n");
                }
                first = false;
                result.push(" ".repeat(innerIndent));
                if (val === null) {
                    // Shorthand form: { key } instead of { key: key }
                    result.push(key);
                } else {
                    // Full form: { key: value }
                    result.push(`${key}: `);
                    writeValueNode(result, val, innerIndent);
                }
            }
            result.push(`\n${" ".repeat(indent)}}`);
            break;
        }
        case "array": {
            result.push("[");
            let first = true;
            for (const item of value.value) {
                if (!first) {
                    result.push(", ");
                }
                first = false;
                writeValueNode(result, item, indent);
            }
            result.push("]");
            break;
        }
    }
}
