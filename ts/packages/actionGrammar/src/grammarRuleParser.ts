// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";

const debugParse = registerDebug("typeagent:grammar:parse");
/**
 * The grammar for cache grammar files is defined as follows (in BNF and regular expressions):
 *   <AgentCacheGrammar> ::= <RuleDefinition>*
 *   <RuleDefinition> ::= "@" <RuleName> "=" <Rules>
 *   <Rules> ::= <Rule> ( "|" <Rule> )*
 *   <Rule> ::= <Expression> ( "->" <Value> )?
 *
 *   <Expression> ::= ( <StringExpr> | <VariableExpr> | <RuleRefExpr> | <GroupExpr> )+
 *   <StringExpr> ::= [^$()|-+*[]{}?]+*
 *   <VariableExpr> ::= "$(" <VariableSpecifier> ( ")" | ")?" )
 *
 *    // TODO: Support nested instead of just Rule Ref
 *   <VariableSpecifier> ::= <VarName> (":" (<TypeName> | <RuleName>))?
 *
 *   <RuleRefExpr> ::= <RuleName>
 *   <GroupExpr> ::= "(" <Rules> ( ")" | ")?" )      // TODO: support for + and *?
 *
 *
 *   <Value> = BooleanValue | NumberValue | StringValue | ObjectValue | ArrayValue | VarReference
 *   <ArrayValue> = "[" <Value> ("," <Value>)* )? "]"
 *   <ObjectValue> = "{" <ObjectProperty> ("," <ObjectProperty>)* "}"
 *   <ObjectProperty> = <ObjectPropertyName> ":" <Value>
 *   <ObjectPropertyName> = <Identifier> | {{ Javascript string literal }}
 *   <BooleanValue> = "true" | "false"
 *   <NumberValue> = <NumberLiteral>
 *   <StringValue> = <StringLiteral>>
 *   <VarReference> = "$(" <VarName> ")"
 *
 *   <VarName> = <Identifier>
 *   <TypeName> = <Identifier>
 *   <RuleName> = "<" <Identifier> ">"
 *
 *   <StringLiteral> = {{ Javascript string literal }}
 *   <NumberLiteral> = {{ Javascript number literal }}
 *   <Identifier> = <ID_Start> <ID_Continue>*
 *   <ID_Start> = {{ Unicode ID_Start character }}
 *   <ID_Continue> = {{ Unicode ID_Continue character }}
 *
 * In the above grammar, all whitespace or comments can appear between any two symbols (terminal or non-terminal).
 *   <WS> ::= {{ Javascript Whitespace and Line terminators character ( [\s] in JS regexp )}}*
 *   <SingleLineComment> ::= "//" [^\n]* "\n"
 *   <MultiLineComment> ::= "/*" .* "*\/"
 */
export function parseGrammarRules(
    fileName: string,
    content: string,
): RuleDefinition[] {
    const parser = new GrammarRuleParser(fileName, content);
    const definitions = parser.parse();
    debugParse(JSON.stringify(definitions, undefined, 2));
    return definitions;
}

// Expr
export type Expr = StrExpr | VarDefExpr | RuleRefExpr | RulesExpr;
type StrExpr = {
    type: "string";
    value: string[];
};

type RuleRefExpr = {
    type: "ruleReference";
    name: string;
};

type RulesExpr = {
    type: "rules";
    rules: Rule[];
    optional?: boolean;
};

type VarDefExpr = {
    type: "variable";
    name: string;
    typeName: string;
    ruleReference: boolean;
    optional?: boolean;
};

// Value
export type ValueNode =
    | LiteralValueNode
    | ObjectValueNode
    | ArrayValueNode
    | VariableValueNode;

type LiteralValueNode = { type: "literal"; value: boolean | string | number };
type ObjectValueNode = {
    type: "object";
    value: { [key: string]: ValueNode };
};
type ArrayValueNode = {
    type: "array";
    value: ValueNode[];
};
type VariableValueNode = {
    type: "variable";
    name: string;
};

// Rule
export type Rule = {
    expressions: Expr[];
    value?: ValueNode | undefined;
};

export type RuleDefinition = {
    name: string;
    rules: Rule[];
};

export function isWhitespace(char: string) {
    return /^\s$/.test(char);
}
function isIdStart(char: string) {
    return /^\p{ID_Start}$/u.test(char);
}

function isIdContinue(char: string) {
    return /^\p{ID_Continue}$/u.test(char);
}
// Even some of these are not used yet, include them for future use.
export const expressionsSpecialChar = [
    // Must escape
    "@",
    "|",
    "(",
    ")",
    "<",
    ">",
    "$", // for $(
    "-", // for ->
    // Reserved for future use
    "{",
    "}",
    "[",
    "]",
];

export function isExpressionSpecialChar(char: string) {
    return expressionsSpecialChar.includes(char);
}

class GrammarRuleParser {
    private curr: number = 0;
    constructor(
        private readonly fileName: string,
        private readonly content: string,
    ) {}

    private isAtWhiteSpace() {
        return !this.isAtEnd() && isWhitespace(this.content[this.curr]);
    }
    private isAt(expected: string) {
        return this.content.startsWith(expected, this.curr);
    }
    private skipAfter(skip: number, after: string) {
        const index = this.content.indexOf(after, this.curr + skip);
        this.curr = index === -1 ? this.content.length : index + after.length;
    }

    private skipWhitespace(skip: number = 0): void {
        this.curr += skip;
        while (true) {
            if (this.isAtWhiteSpace()) {
                this.curr++;
                continue;
            }
            if (this.isAt("//")) {
                this.skipAfter(2, "\n");
                continue;
            }
            if (this.isAt("/*")) {
                this.skipAfter(2, "*/");
                continue;
            }
            break;
        }
    }

    private parseId(expected: string): string {
        const start = this.curr;
        const content = this.content;
        if (!isIdStart(content[start])) {
            this.throwUnexpectedCharError(`${expected} expected.`);
        }
        this.curr++;
        while (this.curr < content.length && isIdContinue(content[this.curr])) {
            this.curr++;
        }
        this.skipWhitespace();
        return content.substring(start, this.curr);
    }

    private parseEscapedChar() {
        if (this.isAtEnd()) {
            this.throwError("Missing escaped character.");
        }

        // See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#string_literals
        const ch = this.content[this.curr++];

        switch (ch) {
            case "0":
                return "\0";
            case "n":
                return "\n";
            case "r":
                return "\r";
            case "v":
                return "\v";
            case "t":
                return "\t";
            case "b":
                return "\b";
            case "f":
                return "\f";
            case "\n":
            case "\r":
            case "\u2028":
            case "\u2029":
                // Line continuation, ignore both \ and newline
                return "";
            case "x": {
                // Hex escape \xXX
                const hex = this.content.substring(this.curr, this.curr + 2);
                if (!/^[0-9A-Fa-f]{2}$/.test(hex)) {
                    this.throwError("Invalid hex escape sequence.");
                }
                this.curr += 2;
                return String.fromCharCode(parseInt(hex, 16));
            }
            case "u": {
                // Unicode escape \uXXXX or \u{X...X}
                if (this.isAt("{")) {
                    this.curr++;
                    const start = this.curr;
                    while (!this.isAtEnd() && this.content[this.curr] !== "}") {
                        this.curr++;
                    }
                    if (this.isAtEnd()) {
                        this.throwError("Unterminated Unicode escape.");
                    }
                    const hex = this.content.substring(start, this.curr);
                    if (!/^[0-9A-Fa-f]+$/.test(hex)) {
                        this.throwError(
                            "Invalid Unicode escape sequence.",
                            start,
                        );
                    }
                    // Consume the closing '}'
                    this.curr++;
                    const codePoint = parseInt(hex, 16);
                    if (codePoint > 0x10ffff) {
                        this.throwError(
                            "Unicode code point out of range.",
                            start,
                        );
                    }
                    return String.fromCodePoint(codePoint);
                } else {
                    const hex = this.content.substring(
                        this.curr,
                        this.curr + 4,
                    );
                    if (!/^[0-9A-Fa-f]{4}$/.test(hex)) {
                        this.throwError("Invalid Unicode escape sequence.");
                    }
                    this.curr += 4;
                    return String.fromCharCode(parseInt(hex, 16));
                }
            }
            default:
                return ch;
        }
    }

    private parseStrExpr(): StrExpr | undefined {
        const str: string[] = [];
        const curr: string[] = [];
        while (!this.isAtEnd()) {
            let ch = this.content[this.curr];
            if (isExpressionSpecialChar(ch)) {
                break;
            }

            // Collapse all whitespace to flex space
            if (isWhitespace(ch)) {
                str.push(curr.join(""));
                curr.length = 0;
                this.skipWhitespace(1);
                continue;
            }
            this.curr++;

            // Whitespace are keep as is if escaped
            curr.push(ch === "\\" ? this.parseEscapedChar() : ch);
        }

        if (curr.length !== 0) {
            str.push(curr.join(""));
        } else if (str.length === 0) {
            return undefined;
        }

        return {
            type: "string",
            value: str,
        };
    }

    private parseVariableSpecifier(): VarDefExpr {
        const id = this.parseId("Variable name");
        let typeName: string = "string";
        let ruleReference: boolean = false;

        if (this.isAt(":")) {
            // Consume colon
            this.skipWhitespace(1);

            if (this.isAt("<")) {
                typeName = this.parseRuleName();
                ruleReference = true;
            } else {
                typeName = this.parseId("Type name");
            }
        }
        return {
            type: "variable",
            name: id,
            typeName,
            ruleReference,
        };
    }

    private parseExpression(): Expr[] {
        const expNodes: Expr[] = [];
        do {
            if (this.isAt("<")) {
                const n = this.parseRuleName();
                expNodes.push({
                    type: "ruleReference",
                    name: n,
                });
                continue;
            }
            if (this.isAt("$(")) {
                this.skipWhitespace(2);
                const v = this.parseVariableSpecifier();
                expNodes.push(v);
                if (this.isAt(")?")) {
                    v.optional = true;
                    this.skipWhitespace(2);
                    continue;
                }
                this.consume(")", "at end of variable");
                continue;
            }

            if (this.isAt("(")) {
                this.skipWhitespace(1);
                const rules = this.parseRules();
                const node: RulesExpr = { type: "rules", rules };
                expNodes.push(node);

                if (this.isAt(")?")) {
                    node.optional = true;
                    this.skipWhitespace(2);
                    continue;
                }
                this.consume(")", "to close expression");
                continue;
            }

            const s = this.parseStrExpr();
            if (s === undefined) {
                // end of expression
                break;
            }

            expNodes.push(s);
        } while (!this.isAtEnd());
        return expNodes;
    }

    private parseStringLiteral(): string {
        const quote = this.content[this.curr];
        this.curr++;
        const s: string[] = [];
        while (true) {
            if (this.isAtEnd() || this.isAt("\n") || this.isAt("\r")) {
                this.throwError(`Unterminated string literal.`);
            }
            const ch = this.content[this.curr];
            this.curr++;
            if (ch === quote) {
                const value = s.join("");
                this.skipWhitespace();
                return value;
            }

            s.push(ch === "\\" ? this.parseEscapedChar() : ch);
        }
    }
    private parseStringValue(): LiteralValueNode {
        return { type: "literal", value: this.parseStringLiteral() };
    }

    private parseNumberValue(): LiteralValueNode {
        // Capture all a-z to get Infinity
        const regexp = /[0-9a-z\+\-\.]*/iy;
        regexp.lastIndex = this.curr;

        const match = this.content.match(regexp);
        if (match === null || match[0].length === 0) {
            this.throwError(`Invalid value.`);
        }
        const numStr = match[0];

        const n = Number(numStr);
        if (isNaN(n)) {
            this.throwError(`Invalid literal '${numStr}'.`);
        }
        if (n === Infinity || n === -Infinity) {
            this.throwError(`Infinity values are not allowed.`);
        }
        this.curr += numStr.length;
        this.skipWhitespace();
        return {
            type: "literal",
            value: n,
        };
    }
    private parseValue(): ValueNode {
        if (this.isAt("{")) {
            // Object
            this.skipWhitespace(1);

            let first = true;
            const obj: { [key: string]: ValueNode } = {};
            while (true) {
                if (this.isAtEnd()) {
                    this.throwError("Unexpected end of file in object value.");
                }
                if (this.isAt("}")) {
                    this.skipWhitespace(1);
                    return {
                        type: "object",
                        value: obj,
                    };
                }

                if (!first) {
                    this.consume(",", "between object properties");
                } else {
                    first = false;
                }
                const id =
                    this.isAt('"') || this.isAt("'")
                        ? this.parseStringLiteral()
                        : this.parseId("Object property name");
                this.consume(":", "after object property name");
                const v = this.parseValue();
                obj[id] = v;
            }
        }
        if (this.isAt("[")) {
            // Array
            this.skipWhitespace(1);

            let first = true;
            const arr: ValueNode[] = [];
            while (true) {
                if (this.isAtEnd()) {
                    this.throwError("Unexpected end of file in array value.");
                }
                if (this.isAt("]")) {
                    this.skipWhitespace(1);
                    return {
                        type: "array",
                        value: arr,
                    };
                }

                if (!first) {
                    this.consume(",", "between array elements");
                } else {
                    first = false;
                }
                const v = this.parseValue();
                arr.push(v);
            }
        }
        if (this.isAt("$(")) {
            this.skipWhitespace(2);
            const id = this.parseId("Variable name");
            this.consume(")", "at end of variable reference");
            return {
                type: "variable",
                name: id,
            };
        }
        if (this.isAt('"') || this.isAt("'")) {
            return this.parseStringValue();
        }
        if (this.isAt("true")) {
            this.skipWhitespace(4);
            return { type: "literal", value: true };
        }
        if (this.isAt("false")) {
            this.skipWhitespace(5);
            return { type: "literal", value: false };
        }
        return this.parseNumberValue();
    }

    private parseRule(): Rule {
        const start = this.curr;
        const expNodes = this.parseExpression();
        const result: Rule = {
            expressions: expNodes,
        };

        if (this.isAt("->")) {
            this.skipWhitespace(2);
            result.value = this.parseValue();
        } else if (
            !this.isAtEnd() &&
            !this.isAt("@") &&
            !this.isAt("|") &&
            !this.isAt(")")
        ) {
            // Early error
            if (this.isAt("${")) {
                // Common mistake
                this.throwError("'${' is not valid, did you mean '$('?");
            }
            this.throwError("Special character needs to be escaped");
        }

        // Delay semantic error until syntax is fully parsed
        if (expNodes.length === 0) {
            this.throwError(`Empty expression.`, start);
        }

        return result;
    }

    private parseRuleName(): string {
        this.consume("<", "at start of rule name");
        const id = this.parseId("Rule identifier");
        this.consume(">", "at end of rule name");
        return id;
    }

    private parseRules(): Rule[] {
        const rules: Rule[] = [];
        do {
            const r = this.parseRule();
            rules.push(r);

            if (!this.isAt("|")) {
                break;
            }
            this.skipWhitespace(1);
        } while (!this.isAtEnd());
        return rules;
    }

    private parseRuleDefinition(): RuleDefinition {
        this.consume("@", "start of rule");
        const n = this.parseRuleName();
        this.consume("=", "after rule identifier");
        const r = this.parseRules();
        return {
            name: n,
            rules: r,
        };
    }

    private consume(expected: string, reason?: string) {
        if (!this.isAt(expected)) {
            this.throwUnexpectedCharError(
                `'${expected}' expected${reason ? ` ${reason}` : ""}.`,
            );
        }
        return this.skipWhitespace(expected.length);
    }

    private getLineCol(pos: number) {
        let line = 1;
        let col = 1;
        const content = this.content;
        for (let i = 0; i < pos && i < content.length; i++) {
            if (content[i] === "\n") {
                line++;
                col = 1;
            } else {
                col++;
            }
        }
        return { line, col };
    }

    private throwError(message: string, pos: number = this.curr): never {
        if (pos === this.content.length) {
            while (pos > 0) {
                if (!isWhitespace(this.content[pos - 1])) {
                    break;
                }
                pos--;
            }
        }
        const lineCol = this.getLineCol(pos);

        const end = this.content.indexOf("\n", pos);
        const lead = Math.min(70, lineCol.col - 1);

        const line = this.content.slice(
            pos - lead,
            end === -1 ? this.content.length : end,
        );

        const msg = `${this.fileName}:${lineCol.line}:${lineCol.col}: ${message}\n\n  ${line}\n  ${" ".repeat(lead)}^`;
        debugParse(msg);
        throw new Error(msg);
    }

    private throwUnexpectedCharError(message?: string): never {
        this.throwError(
            `Unexpected character '${this.content[this.curr]}'.${message ? ` ${message}` : ""}`,
        );
    }

    private isAtEnd() {
        return this.curr >= this.content.length;
    }

    public parse(): RuleDefinition[] {
        const definitions: RuleDefinition[] = [];
        this.skipWhitespace();
        while (!this.isAtEnd()) {
            definitions.push(this.parseRuleDefinition());
        }
        return definitions;
    }
}
