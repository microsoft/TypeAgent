// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Expr,
    GrammarParseResult,
    isExpressionSpecialChar,
    isWhitespace,
    Rule,
    RuleDefinition,
    ValueNode,
} from "./grammarRuleParser.js";

export type GrammarWriterOptions = {
    maxLineLength?: number; // Maximum line length before breaking (default: 80)
    indentSize?: number; // Number of spaces to indent when breaking lines (default: 2)
};

class GrammarWriter {
    private parts: string[] = [];
    private _column: number = 0;

    constructor(private readonly options?: GrammarWriterOptions) {}

    get column(): number {
        return this._column;
    }

    get maxLineLength(): number {
        return this.options?.maxLineLength ?? 80;
    }

    get indentSize(): number {
        return this.options?.indentSize ?? 2;
    }

    write(text: string): void {
        this.parts.push(text);
        this._column += text.length;
    }

    writeAtColumn(text: string, column: number): void {
        if (this._column > column) {
            this.writeNewLine(" ".repeat(column));
        } else {
            this.write(" ".repeat(column - this._column));
        }
        this.write(text);
    }
    writeNewLine(text: string): void {
        this.parts.push("\n");
        this._column = 0;
        this.write(text);
    }
    writeLine(text?: string): void {
        if (text) {
            this.write(text);
        }
        this.parts.push("\n");
        this._column = 0;
    }

    toString(): string {
        return this.parts.join("");
    }
}

export function writeGrammarRules(
    grammar: GrammarParseResult,
    options?: GrammarWriterOptions,
): string {
    const result = new GrammarWriter(options);
    if (grammar.entities.length > 0) {
        result.writeLine(`entity ${grammar.entities.join(", ")};`);
        result.writeLine();
    }

    if (grammar.imports.length > 0) {
        for (const imp of grammar.imports) {
            const names =
                imp.names === "*" ? "*" : `{ ${imp.names.join(", ")} }`;
            result.writeLine(`import ${names} from "${imp.source}";`);
        }
        result.writeLine();
    }

    for (const def of grammar.definitions) {
        writeRuleDefinition(result, def);
    }

    return result.toString();
}

function writeRuleDefinition(result: GrammarWriter, def: RuleDefinition) {
    result.write(`<${def.name}> = `);
    writeRules(result, def.rules, result.column - 2);
    result.writeLine(";");
}

function writeRules(result: GrammarWriter, rules: Rule[], col: number) {
    let first = true;

    for (const rule of rules) {
        if (!first) {
            result.writeNewLine(`${" ".repeat(col)}| `);
        }
        first = false;
        writeRule(result, rule, col);
    }
}

function writeRule(result: GrammarWriter, rule: Rule, col: number) {
    writeExpression(result, rule.expressions, col);
    if (rule.value !== undefined) {
        if (result.column >= result.maxLineLength) {
            result.writeNewLine(`${" ".repeat(col + result.indentSize)}-> `);
        } else {
            result.write(" -> ");
        }
        writeValueNode(result, rule.value, result.column);
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
    result: GrammarWriter,
    expressions: Expr[],
    indent: number,
) {
    let first = true;
    for (const expr of expressions) {
        if (!first) {
            result.write(" ");
        }
        first = false;

        switch (expr.type) {
            case "string":
                result.write(expr.value.map(escapeExpressionString).join(" "));
                break;
            case "ruleReference":
                result.write(`<${expr.name}>`);
                break;
            case "rules": {
                const rules = expr.rules;
                result.write("(");
                writeRules(result, rules, indent);
                const suffix = expr.repeat
                    ? expr.optional
                        ? ")*"
                        : ")+"
                    : expr.optional
                      ? ")?"
                      : ")";
                result.write(suffix);
                break;
            }
            case "variable":
                result.write("$(");
                result.write(expr.name);
                if (expr.refName !== "string") {
                    result.write(":");
                    result.write(
                        expr.ruleReference ? `<${expr.refName}>` : expr.refName,
                    );
                }
                result.write(expr.optional ? ")?" : ")");
                break;
        }
    }
}
function writeValueNode(result: GrammarWriter, value: ValueNode, col: number) {
    switch (value.type) {
        case "literal":
            result.write(JSON.stringify(value.value));
            break;
        case "variable":
            result.write(value.name);
            break;
        case "object": {
            const entries = Object.entries(value.value);
            if (entries.length === 0) {
                result.write("{}");
                break;
            }
            let first = true;
            const nestedCol = col + result.indentSize;
            for (const [key, val] of entries) {
                result.writeLine(first ? "{" : ",");
                first = false;
                if (val === null) {
                    // Shorthand form: { key } instead of { key: key }
                    result.writeAtColumn(key, nestedCol);
                } else {
                    // Full form: { key: value }
                    result.writeAtColumn(`${key}: `, nestedCol);
                    writeValueNode(result, val, nestedCol);
                }
            }
            result.writeNewLine(`${" ".repeat(col)}}`);
            break;
        }
        case "array": {
            let first = true;
            const nestedCol = col + result.indentSize;
            if (value.value.length === 0) {
                result.write("[]");
                break;
            }
            for (const item of value.value) {
                result.writeLine(first ? "[" : ", ");
                first = false;
                result.writeAtColumn("", nestedCol);
                writeValueNode(result, item, nestedCol);
            }
            result.writeNewLine(`${" ".repeat(col)}]`);
            break;
        }
    }
}
