// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import registerDebug from "debug";
import { getLineCol } from "./utils.js";
import {
    CompiledLiteralValueNode,
    CompiledVariableValueNode,
    CompiledObjectValueNode,
    CompiledArrayValueNode,
    CompiledSpacingMode,
} from "./grammarTypes.js";
import {
    parseValueExpr,
    type ValueExprNode,
    type ValueExprParserContext,
} from "./grammarValueExprParser.js";

/**
 * Controls how flex-space separator positions between tokens are matched at runtime.
 *   "required" – at least one whitespace/punctuation character must be present.
 *   "optional" – zero or more separator characters allowed; tokens may be adjacent
 *                but spaces are permitted.
 *   "none"     – no separator characters allowed between tokens; whitespace or
 *                punctuation is only permitted if it is part of the next token itself.
 *   "auto"     – explicit annotation; folded to undefined by the compiler.
 *   undefined  – auto (default): a separator is required only when both adjacent
 *                characters belong to scripts that normally use word spaces (e.g.
 *                Latin, Cyrillic). Scripts such as CJK do not require one.
 */
type SpacingMode = CompiledSpacingMode | "auto";

const debugParse = registerDebug("typeagent:grammar:parse");
/**
 * The grammar for cache grammar files is defined as follows (in BNF and regular expressions):
 *   <AgentCacheGrammar> ::= (<ImportStatement> | <RuleDefinition>)*
 *   <ImportStatement> ::= "import" (<ImportAll> | <ImportNames>) ("from" <StringLiteral>)? ";"
 *   <ImportAll> ::= "*"
 *   <ImportNames> ::= "{" <Identifier> ("," <Identifier>)* "}"
 *   <RuleDefinition> ::= "export"? <RuleName> <RuleAnnotation>? <ValueType>? "=" <Rules> ";"
 *   <ValueType> ::= ":" <TypeName> ("|" <TypeName>)*
 *   <RuleAnnotation> ::= "[" <AnnotationKey> "=" <AnnotationValue> "]"
 *   // Currently the only supported annotation key is "spacing":
 *   //   [spacing=required], [spacing=optional], [spacing=auto], [spacing=none]
 *   <Rules> ::= <Rule> ( "|" <Rule> )*
 *   <Rule> ::= <RuleAnnotation>? <Expression> ( "->" <Value> )?
 *
 *   <Expression> ::= ( <StringExpr> | <VariableExpr> | <RuleRefExpr> | <GroupExpr> )+
 *
 *   // <Char> is any character except special chars (| ( ) < > $ - ; { } [ ]) and backslash,
 *   // and not the start of a comment sequence ("//" or "/*").
 *   // A "flex space" is a separator position in the grammar source, created by any unescaped
 *   // whitespace or comment between sub-expressions.
 *   // When matching input, a flex space accepts any run of whitespace or punctuation characters.
 *   // The minimum number required is controlled by the per-rule spacing mode
 *   // annotation (see SpacingMode type above for the full semantics of each mode).
 *   //
 *   // The spacing mode is set per-rule via a [spacing=<mode>] annotation immediately
 *   // after the rule name: <rule> [spacing=required] = ...;
 *   // It can also be set per-alternate: ... | [spacing=none] $(h:number) : $(m:number) -> ...
 *   // Per-alternate annotations override the definition-level setting.
 *   // Omitting the annotation is equivalent to [spacing=auto].
 *   //
 *   // An escaped space (e.g. "\ ") is treated as a literal character, not a flex space.
 *   // Special chars must be escaped with backslash to appear as literal text.
 *   <StringExpr> ::= ( <EscapeSequence> | <WS> | <Char> )+
 *   <EscapeSequence> ::= "\\"<EscapedChar>
 *   <EscapedChar> ::= "0"                        // null character \0
 *                   | "n"                        // newline \n
 *                   | "r"                        // carriage return \r
 *                   | "v"                        // vertical tab \v
 *                   | "t"                        // horizontal tab \t
 *                   | "b"                        // backspace \b
 *                   | "f"                        // form feed \f
 *                   | <LineTerminator>           // line continuation: backslash and newline are both discarded
 *                   | "x"<Hex2Digit>             // hex escape \xXX
 *                   | "u"<Unicode4Digit>         // Unicode escape \uXXXX
 *                   | "u{"<UnicodeCodePoint>"}"  // Unicode code point \u{X…} (up to U+10FFFF)
 *                   | <AnyChar>                  // identity escape: any other character is kept as-is
 *
 *   <Hex2Digit> ::= [0-9A-Fa-f]{2}
 *   <Unicode4Digit> ::= [0-9A-Fa-f]{4}
 *   <UnicodeCodePoint> ::= [0-9A-Fa-f]+
 *   <VariableExpr> ::= "$(" <VariableSpecifier> ( ")" | ")?" )
 *
 *    // TODO: Support nested instead of just Rule Ref
 *   <VariableSpecifier> ::= <VarName> (":" (<TypeName> | <RuleName>))?
 *
 *   <RuleRefExpr> ::= <RuleName>
 *   <GroupExpr> ::= "(" <Rules> ( ")" | ")?" | ")*" | ")+" )
 *
 *   // ── Value (basic mode: enableValueExpressions=false) ──────────────────────────
 *   <Value> = <BooleanValue> | <NumberValue> | <StringValue>
 *           | <ObjectValue> | <ArrayValue> | <VarReference>
 *   <ArrayValue> = "[" (<Value> ("," <Value>)* ","?)? "]"
 *   <ObjectValue> = "{" (<ObjectElement> ("," <ObjectElement>)* ","?)? "}"
 *   <ObjectElement> = <ObjectProperty> | <SpreadElement>
 *   <ObjectProperty> = <ObjectPropertyFull> | <ObjectPropertyShort>
 *   <ObjectPropertyFull> = <ObjectPropertyName> ":" <Value>
 *   <ObjectPropertyShort> = <VarReference>
 *   <ObjectPropertyName> = <Identifier> | <StringLiteral>
 *   <BooleanValue> = "true" | "false"
 *   <NumberValue> = <NumberLiteral>
 *   <StringValue> = <StringLiteral>
 *   <VarReference> = <VarName>
 *
 *   // ── Value expressions (enableValueExpressions=true) ───────────────────────────
 *   // When enableValueExpressions is true, the <Value> position (after "->")
 *   // supports full JavaScript-like expressions with operator precedence.
 *   // In this mode <Value> is replaced by <ValueExpr>.
 *   //
 *   // Operator precedence (lowest → highest):
 *   //   1. Ternary              ? :
 *   //   2. Nullish coalescing   ??    (cannot mix with || && without parens)
 *   //   3. Logical OR           ||
 *   //   4. Logical AND          &&
 *   //   5. Equality             === !==
 *   //   6. Comparison           < > <= >=
 *   //   7. Additive             + -
 *   //   8. Multiplicative       * / %
 *   //   9. Unary                - ! typeof
 *   //  10. Postfix              . ?. [] ?.[] ?.()
 *   //  11. Primary              literals, identifiers, objects, arrays,
 *   //                           template literals, (expr), ...expr
 *   //
 *   <ValueExpr> ::= <TernaryExpr>
 *   <TernaryExpr> ::= <ShortCircuitExpr> ( "?" <TernaryExpr> ":" <TernaryExpr> )?
 *
 *   <ShortCircuitExpr> ::= <NullishExpr> | <LogicalExpr>
 *   // Nullish and logical families cannot be mixed without parentheses.
 *   <NullishExpr> ::= <EqualityExpr> ( "??" <EqualityExpr> )*
 *   <LogicalExpr> ::= <LogicalAndExpr> ( "||" <LogicalAndExpr> )*
 *   <LogicalAndExpr> ::= <EqualityExpr> ( "&&" <EqualityExpr> )*
 *
 *   <EqualityExpr> ::= <ComparisonExpr> ( ("===" | "!==") <ComparisonExpr> )*
 *   <ComparisonExpr> ::= <AdditiveExpr> ( ("<" | ">" | "<=" | ">=") <AdditiveExpr> )*
 *   <AdditiveExpr> ::= <MultiplicativeExpr> ( ("+" | "-") <MultiplicativeExpr> )*
 *   <MultiplicativeExpr> ::= <UnaryExpr> ( ("*" | "/" | "%") <UnaryExpr> )*
 *   <UnaryExpr> ::= ("-" | "!" | "typeof") <UnaryExpr> | <PostfixExpr>
 *
 *   <PostfixExpr> ::= <PrimaryExpr> <PostfixOp>*
 *   <PostfixOp> ::= "." <Identifier> ( "(" <ArgList> ")" )?    // member access / method call
 *                  | "?." <Identifier> ( "(" <ArgList> ")" )?   // optional member / method
 *                  | "?." "[" <ValueExpr> "]"                   // optional computed access
 *                  | "?." "(" <ArgList> ")"                     // optional call
 *                  | "[" <ValueExpr> "]"                        // computed member access
 *
 *   <PrimaryExpr> ::= <SpreadElement>
 *                    | <TemplateLiteral>
 *                    | "(" <ValueExpr> ")"              // grouped expression
 *                    | <ObjectValue>
 *                    | <ArrayValue>
 *                    | <StringLiteral>
 *                    | <BooleanValue>
 *                    | <Identifier>                     // variable reference
 *                    | <NumberLiteral>
 *
 *   <SpreadElement> ::= "..." <ValueExpr>
 *   <TemplateLiteral> ::= "`" ( <TemplateChars> | "${" <ValueExpr> "}" )* "`"
 *   <ArgList> ::= <ValueExpr> ( "," <ValueExpr> )*
 *
 *   <VarName> = <Identifier>
 *   <TypeName> = <Identifier>
 *   <RuleName> = "<" <Identifier> ">"
 *
 *   <StringLiteral> = {{ Javascript string literal }}
 *   <NumberLiteral> = {{ Javascript number literal }}
 *   <Identifier> = <ID_Start><ID_Continue>*
 *   <ID_Start> = {{ Unicode ID_Start character }}
 *   <ID_Continue> = {{ Unicode ID_Continue character }}
 *
 * Between structural tokens in the above grammar, all whitespace and comments are skipped.
 * Within <Expression>, comments between sub-expressions also act as flex-space separators;
 * they are attached as leadingComments on the following sub-expression in the AST.
 * Comments are omitted from the BNF productions above for readability.
 *   <WS> ::= {{ Javascript Whitespace and Line terminators character ( [\s] in JS regexp )}}*
 *   <SingleLineComment> ::= "//" [^\n]* "\n"
 *   <MultiLineComment> ::= "/*" .* "*\/"
 */
export function parseGrammarRules(
    fileName: string,
    content: string,
    /** Whether to track source positions on value nodes (default: true). */
    position?: boolean,
    /** Enable JavaScript-like value expressions in the `->` position (default: false). */
    enableValueExpressions: boolean = false,
): GrammarParseResult {
    const parser = new GrammarRuleParser(
        fileName,
        content,
        position ?? true,
        enableValueExpressions,
    );
    const result = parser.parse();
    debugParse(JSON.stringify(result, undefined, 2));
    return result;
}

// ─── Comment types ────────────────────────────────────────────────────────────
//
// Naming convention for comment-carrying fields:
//   - Plural  (e.g. trailingComments: Comment[]): used where multiple comments
//     can appear — typically block-level positions where several "// …" lines
//     or "/* … */" spans may follow one another.  Also used for same-line
//     trailing positions because multiple block comments can precede a line
//     comment (e.g. /* a */ /* b */ // c).

export type Comment = {
    style: "line" | "block"; // "//" vs "/* */"
    text: string; // Raw content after "//" or between "/*" and "*/"
    // (preserves leading space, e.g. " foo" from "// foo")
};

// Expr
export type Expr = StrExpr | VarDefExpr | RuleRefExpr | RulesExpr;
type StrExpr = {
    type: "string";
    value: string[];
    pos?: number | undefined;
    leadingComments?: Comment[] | undefined;
};

// A name with optional leading and trailing comments.
// Used for rule names within angle brackets and entries in comma-separated lists.
export type CommentedName = {
    name: string;
    leadingComments?: Comment[] | undefined;
    trailingComments?: Comment[] | undefined;
};

export type RuleRefExpr = {
    type: "ruleReference";
    refName: CommentedName;
    pos?: number | undefined;
    leadingComments?: Comment[] | undefined;
};

type RulesExpr = {
    type: "rules";
    rules: Rule[];
    optional?: boolean | undefined;
    repeat?: boolean | undefined; // Kleene star: zero or more
    leadingComments?: Comment[] | undefined;
};

export type VarDefExpr = {
    type: "variable";
    variableName: CommentedName;
    ruleReference: boolean;
    // refName.name is the type/rule name; absent means the type defaults to "string".
    // For rule references ($(...:<RuleName>)): leadingComments/trailingComments are inside the <>.
    // For plain types ($(...:typeName)):       trailingComments are after the type identifier.
    refName?: CommentedName | undefined;
    refPos?: number | undefined;
    optional?: boolean | undefined;
    pos?: number | undefined;
    leadingComments?: Comment[] | undefined;
    colonComments?: Comment[] | undefined; // between : and the type specifier
};

// Value
export type ValueNode =
    | LiteralValueNode
    | ObjectValueNode
    | ArrayValueNode
    | VariableValueNode
    | ValueExprNode;

// Parser-time value node types: compiled base types augmented with comment fields.
// The compiler strips these before storing into GrammarRule (see grammarCompiler.ts).
//
// leadingComments:  comments before the value (e.g. after ":" or "[").
// trailingComments: comments after the value but before the trailing "," or "]"/"}" delimiter.
type LiteralValueNode = CompiledLiteralValueNode & {
    pos?: number | undefined;
    leadingComments?: Comment[] | undefined;
    trailingComments?: Comment[] | undefined;
};
type VariableValueNode = CompiledVariableValueNode & {
    pos?: number | undefined;
    leadingComments?: Comment[] | undefined;
    trailingComments?: Comment[] | undefined;
};
// A single property in an ObjectValueNode.
// leadingComments: comments before the property key that start on a new line
//   (after '{' or after the comma + any trailing comments).
// trailingComments: same-line comments after the trailing ',' — block comments
//   that close before the next newline and/or a final line comment.
export type ObjectProperty = {
    type: "property";
    key: string;
    value: ValueNode | null; // null = shorthand: { x } means { x: x }
    leadingComments?: Comment[] | undefined;
    trailingComments?: Comment[] | undefined;
};
// A spread element in an ObjectValueNode: { ...expr }.
export type ObjectSpreadElement = {
    type: "spread";
    argument: ValueNode;
    leadingComments?: Comment[] | undefined;
    trailingComments?: Comment[] | undefined;
};
// A single element in an ObjectValueNode — either a named property or a spread.
export type ObjectElement = ObjectProperty | ObjectSpreadElement;

/** Type guard: true when the element is a spread (`{ ...expr }`). */
export function isObjectSpread(e: ObjectElement): e is ObjectSpreadElement {
    return e.type === "spread";
}

// A value node as it appears as an element in an array literal.
// trailingComments: same-line comments after the trailing ','.
export type ArrayElement = {
    value: ValueNode;
    trailingComments?: Comment[] | undefined;
};
// ObjectValueNode and ArrayValueNode override the `value` field so it can
// hold recursive ValueNode/ArrayElement references (not just CompiledValueNode).
type ObjectValueNode = Omit<CompiledObjectValueNode, "value"> & {
    value: ObjectElement[];
    pos?: number | undefined;
    leadingComments?: Comment[] | undefined;
    trailingComments?: Comment[] | undefined;
    // Comments after the last property's trailing ',' (or inside an empty object).
    closingComments?: Comment[] | undefined;
};
type ArrayValueNode = Omit<CompiledArrayValueNode, "value"> & {
    value: ArrayElement[];
    pos?: number | undefined;
    leadingComments?: Comment[] | undefined;
    trailingComments?: Comment[] | undefined;
    // Comments after the last element's trailing ',' (or inside an empty array).
    closingComments?: Comment[] | undefined;
};

// Comments attached to a [spacing=...] annotation.
// Shared between Rule (per-alternate) and RuleDefinition (definition-level).
export type SpacingAnnotationComments = {
    beforeAnnotation?: Comment[] | undefined; // comments before [
    afterBracket?: Comment[] | undefined; // after [
    afterKey?: Comment[] | undefined; // after "spacing" keyword, before =
    afterEquals?: Comment[] | undefined; // after =, before value
    afterValue?: Comment[] | undefined; // after value, before ]
};

// Rule
export type Rule = {
    expressions: Expr[];
    spacingMode?: SpacingMode | undefined; // per-alternate [spacing=...] override
    spacingAnnotationComments?: SpacingAnnotationComments | undefined;
    trailingComments?: Comment[] | undefined; // comments after expressions, before | or ;
    value?: ValueNode | undefined;
    valueLeadingComments?: Comment[] | undefined; // comments between -> and value
    valueTrailingComments?: Comment[] | undefined; // comments after value, before | or ;
};

export type RuleDefinition = {
    definitionName: CommentedName;
    rules: Rule[];
    exported?: boolean | undefined; // true when prefixed with "export" keyword
    spacingMode?: SpacingMode | undefined;
    pos?: number | undefined;
    leadingComments?: Comment[] | undefined; // comments before "export" or <Name>
    afterExportComments?: Comment[] | undefined; // comments between "export" keyword and <Name>
    spacingAnnotationComments?: SpacingAnnotationComments | undefined;
    valueType?: CommentedName[] | undefined; // type names after ":" (e.g. <Rule> : A | B = ...)
    beforeValueTypeComments?: Comment[] | undefined; // comments before ":" in value type
    beforeEqualsComments?: Comment[] | undefined; // comments between <Name>/[annotation]/valueType and =
    trailingComments?: Comment[] | undefined; // comments on same line as ";"
};

// Import types
export type ImportStatement = {
    names: CommentedName[] | "*"; // Specific names or * for all
    source: string | undefined; // File path or module name; undefined for source-less (entity) imports
    pos?: number | undefined;
    leadingComments?: Comment[] | undefined; // comments before "import"
    afterImportComments?: Comment[] | undefined; // after "import" keyword, before "{" or "*"
    afterCloseBraceComments?: Comment[] | undefined; // after "}" (named imports only), before "from"
    afterStarComments?: Comment[] | undefined; // after "*" (wildcard import only), before "from"
    afterFromComments?: Comment[] | undefined; // after "from", before source string
    trailingComments?: Comment[] | undefined; // comments on same line as ";"
};

// Grammar Parse Result (includes imports)
export type GrammarParseResult = {
    imports: ImportStatement[]; // Import statements (includes source-less entity imports)
    definitions: RuleDefinition[];
    leadingComments?: Comment[] | undefined; // comments at top of file before first item
    trailingComments?: Comment[] | undefined; // comments after last definition (end of file)
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
    "|",
    "(",
    ")",
    "<",
    ">",
    "$", // for $(
    "-", // for ->
    ";", // terminator
    // Reserved for future use
    "{",
    "}",
    "[",
    "]",
];

export function isExpressionSpecialChar(char: string) {
    return expressionsSpecialChar.includes(char);
}

// ─── Parser invariant: skip-whitespace-after-parse ──────────────────────────
//
// Every parse method that consumes input must leave `curr` positioned past any
// trailing whitespace so that the next method can immediately inspect the next
// non-whitespace character.  This is typically done via `skipWhitespace(N)`
// (which advances N characters then skips whitespace), `consume()`, or by
// delegating to another parse method that itself upholds the invariant.
//
// Methods that intentionally break this pattern are marked with:
//   "INVARIANT EXCEPTION: does not skip trailing whitespace — <reason>."
// Callers of such methods are responsible for the subsequent whitespace skip.

class GrammarRuleParser implements ValueExprParserContext {
    curr: number = 0;
    constructor(
        private readonly fileName: string,
        readonly content: string,
        private readonly position: boolean = true,
        private readonly enableValueExpressions: boolean = false,
    ) {}

    private get pos(): number | undefined {
        return this.position ? this.curr : undefined;
    }

    private isAtWhiteSpace() {
        return !this.isAtEnd() && isWhitespace(this.content[this.curr]);
    }
    isAt(expected: string) {
        return this.content.startsWith(expected, this.curr);
    }
    private skipAfter(skip: number, after: string) {
        const index = this.content.indexOf(after, this.curr + skip);
        if (index === -1) {
            this.throwError(
                `Unterminated '${this.content.substring(this.curr, this.curr + skip)}' — expected closing '${after}'.`,
            );
        }
        this.curr = index + after.length;
    }

    // Advances skip characters then skips whitespace characters only.
    // Pure — does not consume or collect comments.
    skipWhitespace(skip: number = 0): boolean {
        const start = this.curr;
        this.curr += skip;
        while (this.isAtWhiteSpace()) {
            this.curr++;
        }
        return this.curr > start;
    }

    // Parses any // and /* */ comments at the current position,
    // skipping whitespace between consecutive comments.
    // Returns the collected comments, or undefined if none.
    // Callers must have already skipped whitespace before calling.
    parseComments(): Comment[] | undefined {
        const comments: Comment[] = [];
        while (this.isAtComment()) {
            comments.push(this.parseComment());
            this.skipWhitespace();
        }
        return comments.length > 0 ? comments : undefined;
    }

    // Consumes exactly one comment (// or /* */) at the current position and returns it.
    // For // comments, curr is left AT the newline (not past it).  Stopping here rather
    // than consuming the '\n' lets the subsequent skipWhitespace() advance past it, keeping
    // horizontal-space tracking correct.  Callers must always call skipWhitespace() after.
    //
    // INVARIANT EXCEPTION: does not skip trailing whitespace — callers (parseComments,
    // tryConsumeTrailingComments) handle the skip themselves.
    private parseComment(): Comment {
        if (this.isAt("//")) {
            const textStart = this.curr + 2;
            const newlinePos = this.content.indexOf("\n", textStart);
            const textEnd =
                newlinePos === -1 ? this.content.length : newlinePos;
            this.curr = textEnd;
            return {
                style: "line",
                text: this.content.substring(textStart, textEnd),
            };
        }
        // "/*"
        const textStart = this.curr + 2;
        this.skipAfter(2, "*/");
        return {
            style: "block",
            text: this.content.substring(textStart, this.curr - 2),
        };
    }

    // Scans for all comments on the CURRENT LINE only (before any newline).
    // Used to capture trailing comments after ";", ",", etc.
    // Multiple block comments may appear, optionally followed by a line comment.
    //
    // When blockOnlyAtEOL is true, block comments (/* */) are only consumed as
    // trailing if the rest of the line after the closing */ is empty (whitespace,
    // more comments, or newline/EOF).  If a non-comment token follows on the
    // same line, the block comment is left for the caller's parseComments() to
    // pick up as a leading comment on the next element.
    //
    // This is used after commas in arrays/objects:
    //   ["a", /* trailing */\n"b"]  →  /* trailing */ is trailing on "a"
    //   ["a", /* leading */ "b"]    →  /* leading */  is leading on "b"
    //
    // INVARIANT EXCEPTION: does not skip trailing whitespace — by design, this
    // only scans the current line.  Callers must do the subsequent skip.
    private tryConsumeTrailingComments(
        blockOnlyAtEOL: boolean = false,
    ): Comment[] | undefined {
        const comments: Comment[] = [];
        while (true) {
            // Skip horizontal whitespace only (spaces and tabs)
            let i = this.curr;
            while (
                i < this.content.length &&
                (this.content[i] === " " || this.content[i] === "\t")
            ) {
                i++;
            }
            if (this.content.startsWith("//", i)) {
                this.curr = i;
                comments.push(this.parseComment());
                break; // line comment consumes rest of line
            }
            if (this.content.startsWith("/*", i)) {
                const closePos = this.content.indexOf("*/", i + 2);
                if (closePos !== -1) {
                    // Only treat as trailing if the closing */ comes before the next newline
                    const newlinePos = this.content.indexOf("\n", i);
                    if (newlinePos === -1 || closePos < newlinePos) {
                        if (blockOnlyAtEOL) {
                            // Check what follows after */ on the same line.
                            // Only consume if the rest of the line is empty
                            // (whitespace, more comments, or newline/EOF).
                            let after = closePos + 2;
                            while (
                                after < this.content.length &&
                                (this.content[after] === " " ||
                                    this.content[after] === "\t")
                            ) {
                                after++;
                            }
                            if (
                                after < this.content.length &&
                                this.content[after] !== "\n" &&
                                this.content[after] !== "\r" &&
                                !this.content.startsWith("//", after) &&
                                !this.content.startsWith("/*", after)
                            ) {
                                // Non-comment token on same line → leave for
                                // parseComments() to pick up as leading.
                                break;
                            }
                        }
                        this.curr = i;
                        comments.push(this.parseComment());
                        continue; // look for more comments on this line
                    }
                }
            }
            break;
        }
        return comments.length > 0 ? comments : undefined;
    }

    parseId(expected: string): string {
        const start = this.curr;
        const content = this.content;
        if (!isIdStart(content[start])) {
            this.throwUnexpectedCharError(`${expected} expected.`);
        }
        this.curr++;
        while (this.curr < content.length && isIdContinue(content[this.curr])) {
            this.curr++;
        }
        const end = this.curr; // Capture end position before skipping whitespace
        this.skipWhitespace();
        return content.substring(start, end);
    }

    parseEscapedChar() {
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

    // INVARIANT EXCEPTION: does not skip trailing whitespace — whitespace is
    // semantically significant here (flex-space boundaries).  The caller
    // (parseExpression) manages whitespace skipping in its loop.
    private parseStrExpr(): StrExpr | undefined {
        const pos = this.pos;
        const str: string[] = [];
        const word: string[] = [];
        while (!this.isAtEnd()) {
            // Skip whitespace only (not comments) for flex-space boundary detection.
            // Comments are handled by parseExpression(), which attaches them as
            // leadingComments on the next sub-expression.
            if (this.skipWhitespace()) {
                str.push(word.join(""));
                word.length = 0;
                continue;
            }

            // Stop at a comment — parseExpression will attach it as leadingComments
            // on the following sub-expression.
            if (this.isAtComment()) {
                break;
            }

            const ch = this.content[this.curr];
            if (isExpressionSpecialChar(ch)) {
                break;
            }
            // Append literal character, expanding escape sequences
            // Escaped spaces are treated as literal spaces rather than flex space

            this.curr++;
            word.push(ch === "\\" ? this.parseEscapedChar() : ch);
        }

        if (word.length !== 0) {
            // Flush the final segment
            str.push(word.join(""));
        } else if (str.length === 0) {
            return undefined;
        }

        return {
            type: "string",
            value: str,
            pos,
        };
    }

    private parseVariableSpecifier(): VarDefExpr {
        const pos = this.pos;
        const commentedName = this.parseNameWithComments("Variable name");
        let ruleReference: boolean = false;
        let refPos: number | undefined = undefined;
        let colonComments: Comment[] | undefined;
        let bracketedName: CommentedName | undefined;

        if (this.isAt(":")) {
            // Advance past ":" then collect comments before the type specifier.
            this.skipWhitespace(1);
            colonComments = this.parseComments();

            refPos = this.pos;
            if (this.isAt("<")) {
                ruleReference = true;
                bracketedName = this.parseRuleName();
            } else {
                bracketedName = this.parseNameWithComments("Type name");
            }
        }
        return {
            type: "variable",
            variableName: commentedName,
            ruleReference,
            refName: bracketedName,
            refPos,
            pos,
            colonComments,
        };
    }

    private parseExpression(initialComments?: Comment[]): {
        expressions: Expr[];
        trailingComments?: Comment[];
    } {
        const expNodes: Expr[] = [];
        let pending: Comment[] | undefined = initialComments;

        const attach = (node: Expr): void => {
            if (pending) {
                node.leadingComments = pending;
                pending = undefined;
            }
        };

        do {
            // Skip whitespace between tokens (e.g. after a comment token that
            // doesn't consume trailing whitespace itself).
            this.skipWhitespace();
            if (this.isAtEnd()) break;

            // Buffer comments; attach to the next expr as leadingComments.
            if (this.isAtComment()) {
                if (!pending) pending = [];
                pending.push(this.parseComment());
                continue;
            }

            if (this.isAt("<")) {
                const pos = this.pos;
                const node: RuleRefExpr = {
                    type: "ruleReference",
                    refName: this.parseRuleName(),
                    pos,
                };
                attach(node);
                expNodes.push(node);
                continue;
            }
            if (this.isAt("$(")) {
                this.skipWhitespace(2); // advance past "$("
                const v = this.parseVariableSpecifier();
                attach(v);
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
                attach(node);
                expNodes.push(node);

                if (this.isAt(")?")) {
                    node.optional = true;
                } else if (this.isAt(")*")) {
                    node.optional = true;
                    node.repeat = true;
                } else if (this.isAt(")+")) {
                    node.repeat = true; // optional stays false — must match at least once
                } else {
                    this.consume(")", "to close expression");
                    continue;
                }
                this.skipWhitespace(2);
                continue;
            }

            const s = this.parseStrExpr();
            if (s === undefined) {
                // end of expression
                break;
            }
            attach(s);
            expNodes.push(s);
        } while (!this.isAtEnd());
        return pending
            ? { expressions: expNodes, trailingComments: pending }
            : { expressions: expNodes };
    }

    parseStringLiteral(): string {
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

    parseNumberValue(): LiteralValueNode {
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
    // Parses a value and attaches any surrounding comments to it.
    // If `leadingComments` is provided it is used directly (e.g. carried over from
    // a preceding separator); otherwise comments are consumed from the current position.
    private parseValueWithComments(leadingComments?: Comment[]): ValueNode {
        const leading = leadingComments ?? this.parseComments();
        const v = this.parseValue();
        v.leadingComments = leading;
        v.trailingComments = this.parseComments();
        return v;
    }

    private parseValue(): ValueNode {
        if (this.enableValueExpressions) {
            return parseValueExpr(this);
        }
        return this.parseSimpleValue();
    }

    /** Parse an object literal value: { ... } */
    parseObjectValue(): ValueNode {
        // Object
        this.skipWhitespace(1);
        // Capture comments after "{" as potential leading for the first property.
        let pendingLeading = this.parseComments();

        let first = true;
        const obj: ObjectElement[] = [];
        while (true) {
            if (this.isAtEnd()) {
                this.throwError("Unexpected end of file in object value.");
            }
            if (this.isAt("}")) {
                this.skipWhitespace(1);
                return {
                    type: "object",
                    value: obj,
                    closingComments: pendingLeading,
                } satisfies ObjectValueNode;
            }

            if (!first) {
                const trailing = this.consumeWithTrailingComments(
                    ",",
                    "object property",
                    true,
                );
                obj[obj.length - 1].trailingComments = trailing;
                this.skipWhitespace(); // advance past newline + indentation
                pendingLeading = this.parseComments();
                // Trailing comma: if next token is "}", there is no further property.
                if (this.isAt("}")) {
                    this.skipWhitespace(1);
                    return {
                        type: "object",
                        value: obj,
                        closingComments: pendingLeading,
                    } satisfies ObjectValueNode;
                }
            } else {
                first = false;
            }

            // Spread element: { ...expr }
            if (this.isAt("...")) {
                this.skipWhitespace(3);
                const argument = this.parseValueWithComments();
                obj.push({
                    type: "spread",
                    argument,
                    leadingComments: pendingLeading,
                } satisfies ObjectSpreadElement);
                pendingLeading = undefined;
                continue;
            }

            // Parse property name (identifier or string literal)
            const isStringLiteral = this.isAtStringDelimiter();

            const id = isStringLiteral
                ? this.parseStringLiteral()
                : this.parseId("Object property name");

            // Check for full form (name: value) or short form (name)
            let v: ValueNode | null;
            if (this.isAt(",") || this.isAt("}")) {
                // Short form: only valid for identifiers (not string literals)
                // Represents { id: id } where id is a variable reference
                if (isStringLiteral) {
                    this.throwError(
                        "Shorthand property syntax requires an identifier, not a string literal",
                    );
                }
                v = null;
            } else {
                // Full form: propertyName: value
                this.consume(":", "between property name and value");
                v = this.parseValueWithComments();
            }
            obj.push({
                type: "property",
                key: id,
                value: v,
                leadingComments: pendingLeading,
            });
            pendingLeading = undefined;
        }
    }

    /** Parse an array literal value: [ ... ] */
    parseArrayValue(): ValueNode {
        // Array
        this.skipWhitespace(1);
        const arr: ArrayElement[] = [];

        // Capture comments right after "[" as potential leading for the first element.
        let pendingLeading = this.parseComments();
        let first = true;
        while (true) {
            if (this.isAtEnd()) {
                this.throwError("Unexpected end of file in array value.");
            }
            if (this.isAt("]")) {
                this.skipWhitespace(1);
                return {
                    type: "array",
                    value: arr,
                    closingComments: pendingLeading,
                } satisfies ArrayValueNode;
            }

            if (!first) {
                const trailingComments = this.consumeWithTrailingComments(
                    ",",
                    "array element",
                    true,
                );
                arr[arr.length - 1].trailingComments = trailingComments;
                this.skipWhitespace();
                pendingLeading = this.parseComments();
                // Trailing comma: if next token is "]", there is no further element.
                if (this.isAt("]")) {
                    this.skipWhitespace(1);
                    return {
                        type: "array",
                        value: arr,
                        closingComments: pendingLeading,
                    } satisfies ArrayValueNode;
                }
            } else {
                first = false;
            }
            arr.push({
                value: this.parseValueWithComments(pendingLeading),
            });
            pendingLeading = undefined;
        }
    }

    /** Parse a simple value (no expressions) — the original parseValue logic. */
    private parseSimpleValue(): ValueNode {
        if (this.isAt("{")) {
            return this.parseObjectValue();
        }
        if (this.isAt("[")) {
            return this.parseArrayValue();
        }
        if (this.isAtStringDelimiter()) {
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
        if (
            !this.isAtEnd() &&
            isIdStart(this.content[this.curr]) &&
            !this.isAt("Infinity")
        ) {
            const id = this.parseId("Variable name");
            return { type: "variable", name: id };
        }
        return this.parseNumberValue();
    }

    private parseRule(): Rule {
        const start = this.curr;
        // Parse optional per-alternate spacing annotation: [spacing=mode]
        // The annotation may follow comments (e.g. after | on a new line),
        // so we need to look past any leading comments to detect it.
        let spacingMode: SpacingMode | undefined;
        let spacingAnnotationComments: Rule["spacingAnnotationComments"];
        // Parse any leading comments, then check for [spacing=...]
        const pendingComments = this.parseComments();
        if (this.isAt("[")) {
            // Found annotation — comments before it belong to the annotation.
            const ann = this.parseSpacingAnnotation();
            spacingMode = ann.spacingMode;
            spacingAnnotationComments = {
                beforeAnnotation: pendingComments,
                afterBracket: ann.afterBracketComments,
                afterKey: ann.afterKeyComments,
                afterEquals: ann.afterEqualsComments,
                afterValue: ann.afterValueComments,
            };
        }
        // If no annotation was found, forward the already-parsed comments
        // to parseExpression so they attach to the first expression node.
        const { expressions, trailingComments } = this.parseExpression(
            spacingMode === undefined ? pendingComments : undefined,
        );
        let value: ValueNode | undefined;
        let valueLeadingComments: Comment[] | undefined;
        let valueTrailingComments: Comment[] | undefined;

        if (this.isAt("->")) {
            this.skipWhitespace(2);
            valueLeadingComments = this.parseComments();
            const valuePos = this.pos; // position of value (first token after ->)
            value = this.parseValue();
            if (valuePos !== undefined) {
                value.pos = valuePos;
            }
            // Comments after the value (before | or ;) belong to this rule.
            valueTrailingComments = this.parseComments();
        } else if (
            !this.isAtEnd() &&
            !this.isAt(";") &&
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

        // Delay semantic error until syntax is fully parsed.
        // An expression with only comments and no actual tokens is empty.
        if (expressions.length === 0) {
            this.throwError(`Empty expression.`, start);
        }

        return {
            expressions,
            spacingMode,
            spacingAnnotationComments,
            trailingComments,
            value,
            valueLeadingComments,
            valueTrailingComments,
        };
    }

    // Parse an identifier surrounded by optional comments into a CommentedName.
    private parseNameWithComments(label: string): CommentedName {
        const leadingComments = this.parseComments();
        const name = this.parseId(label);
        const trailingComments = this.parseComments();
        return { name, leadingComments, trailingComments };
    }

    private parseRuleName(): CommentedName {
        this.consume("<", "at start of rule name");
        const result = this.parseNameWithComments("Rule identifier");
        this.consume(">", "at end of rule name");
        return result;
    }

    private parseRules(): Rule[] {
        const rules: Rule[] = [];
        rules.push(this.parseRule());

        while (this.isAt("|")) {
            this.skipWhitespace(1); // advance past "|"
            rules.push(this.parseRule());
        }
        return rules;
    }

    private parseSpacingAnnotation(): {
        spacingMode: SpacingMode;
        afterBracketComments: Comment[] | undefined;
        afterKeyComments: Comment[] | undefined;
        afterEqualsComments: Comment[] | undefined;
        afterValueComments: Comment[] | undefined;
    } {
        this.skipWhitespace(1); // skip "["
        const afterBracketComments = this.parseComments();
        const key = this.parseId("annotation key");
        if (key !== "spacing") {
            this.throwError(
                `Unknown rule annotation '${key}'. Expected 'spacing'.`,
            );
        }
        // parseId already called skipWhitespace(); collect comments before "=".
        const afterKeyComments = this.parseComments();
        this.consume("=", "in spacing annotation");
        const afterEqualsComments = this.parseComments();
        const value = this.parseId("spacing value");
        if (
            value !== "required" &&
            value !== "optional" &&
            value !== "auto" &&
            value !== "none"
        ) {
            this.throwError(
                `Invalid value '${value}' for spacing annotation. Expected 'required', 'optional', 'auto', or 'none'.`,
            );
        }
        // parseId already called skipWhitespace(); collect comments before "]".
        const afterValueComments = this.parseComments();
        this.consume("]", "at end of spacing annotation");
        // "auto" is now stored explicitly (compiler folds it to undefined).
        return {
            spacingMode: value as SpacingMode,
            afterBracketComments,
            afterKeyComments,
            afterEqualsComments,
            afterValueComments,
        };
    }

    private parseRuleDefinition(
        leadingComments?: Comment[],
        exported?: boolean,
        afterExportComments?: Comment[],
    ): RuleDefinition {
        const pos = this.pos;
        const rn = this.parseRuleName();
        let spacingMode: SpacingMode;
        let spacingAnnotationComments: SpacingAnnotationComments | undefined;
        let beforeEqualsComments: Comment[] | undefined;
        let valueType: CommentedName[] | undefined;
        let beforeValueTypeComments: Comment[] | undefined;
        const maybePreComments = this.parseComments();
        if (this.isAt("[")) {
            const ann = this.parseSpacingAnnotation();
            spacingMode = ann.spacingMode;
            spacingAnnotationComments = {
                beforeAnnotation: maybePreComments,
                afterBracket: ann.afterBracketComments,
                afterKey: ann.afterKeyComments,
                afterEquals: ann.afterEqualsComments,
                afterValue: ann.afterValueComments,
            };
            beforeEqualsComments = this.parseComments();
        } else {
            beforeEqualsComments = maybePreComments;
        }
        // Parse optional value type: `: TypeName (| TypeName)*`
        if (this.isAt(":")) {
            beforeValueTypeComments = beforeEqualsComments;
            this.skipWhitespace(1); // skip ":"
            valueType = [];
            const leadingComments = this.parseComments();
            const firstName = this.parseId("value type name");
            let trailingComments = this.parseComments();
            valueType.push({
                name: firstName,
                leadingComments,
                trailingComments,
            });
            while (this.isAt("|")) {
                this.skipWhitespace(1); // skip "|"
                const lc = this.parseComments();
                const typeName = this.parseId("value type name");
                trailingComments = this.parseComments();
                valueType.push({
                    name: typeName,
                    leadingComments: lc,
                    trailingComments,
                });
            }
            beforeEqualsComments = this.parseComments();
        }
        if (!this.isAt("=")) {
            this.throwUnexpectedCharError(
                "'=' expected after rule identifier.",
            );
        }
        this.skipWhitespace(1); // advance past "="
        const rules = this.parseRules();

        const trailingComments = this.consumeWithTrailingComments(
            ";",
            "rule definition",
        );

        return {
            definitionName: rn,
            rules,
            exported,
            spacingMode,
            valueType,
            pos,
            leadingComments,
            afterExportComments,
            spacingAnnotationComments,
            beforeValueTypeComments,
            beforeEqualsComments,
            trailingComments,
        };
    }

    consume(expected: string, reason?: string) {
        if (!this.isAt(expected)) {
            this.throwUnexpectedCharError(
                `'${expected}' expected${reason ? ` ${reason}` : ""}.`,
            );
        }
        return this.skipWhitespace(expected.length);
    }

    private getLineCol(pos: number) {
        return getLineCol(this.content, pos);
    }

    throwError(message: string, pos: number = this.curr): never {
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

    isAtEnd() {
        return this.curr >= this.content.length;
    }

    private isAtComment() {
        return this.isAt("//") || this.isAt("/*");
    }

    isAtStringDelimiter() {
        return this.isAt('"') || this.isAt("'");
    }

    // Asserts the current character is `char`, advances past it, and returns
    // any same-line trailing comments.  Used wherever a token can be followed
    // by trailing // or /* */ comments on the same line (";", ",", etc.).
    //
    // When blockOnlyAtEOL is true, block comments are only consumed as
    // trailing if nothing else follows on the same line.  See
    // tryConsumeTrailingComments for details.
    //
    // INVARIANT EXCEPTION: does not skip trailing whitespace — delegates to
    // tryConsumeTrailingComments which only scans the current line.  Callers
    // must do the subsequent skip.
    private consumeWithTrailingComments(
        char: string,
        context: string,
        blockOnlyAtEOL: boolean = false,
    ): Comment[] | undefined {
        if (!this.isAt(char)) {
            this.throwUnexpectedCharError(
                `'${char}' expected at end of ${context}.`,
            );
        }
        this.curr++; // advance past char
        return this.tryConsumeTrailingComments(blockOnlyAtEOL);
    }

    private parseImportStatement(leadingComments?: Comment[]): ImportStatement {
        // import { Name1, Name2 } from "file";   (sourced import)
        // import * from "file";                   (wildcard import)
        // import { Name1, Name2 };                (source-less / entity import)
        this.skipWhitespace(6); // skip "import"
        const afterImportComments = this.parseComments();
        const pos = this.pos;

        let names: CommentedName[] | "*";
        let afterStarComments: Comment[] | undefined;
        let afterCloseBraceComments: Comment[] | undefined;

        if (this.isAt("*")) {
            // import all
            names = "*";
            this.skipWhitespace(1); // skip "*"
            afterStarComments = this.parseComments();
        } else if (this.isAt("{")) {
            // granular import
            this.skipWhitespace(1); // skip "{"
            names = [];

            // Leading comments for the first name (after "{").
            let pendingLeading = this.parseComments();

            while (true) {
                if (this.isAtEnd()) {
                    this.throwError(
                        "Unexpected end of file in import statement.",
                    );
                }
                if (this.isAt("}")) {
                    this.skipWhitespace(1); // skip "}"
                    break;
                }

                const name = this.parseId("import name");
                // Collect trailing comments after the name, before "," or "}".
                const trailingComments = this.parseComments();
                names.push({
                    name,
                    leadingComments: pendingLeading,
                    trailingComments,
                });

                if (this.isAtEnd()) {
                    this.throwError(
                        "Unexpected end of file in import statement.",
                    );
                }
                if (this.isAt("}")) {
                    this.skipWhitespace(1); // skip "}"
                    break;
                }
                this.consume(",", "between import names");
                pendingLeading = this.parseComments();
            }

            if (names.length === 0) {
                this.throwError(
                    "Import statement must have at least one name.",
                );
            }
            afterCloseBraceComments = this.parseComments();
        } else {
            this.throwUnexpectedCharError("Expected '{' or '*' after 'import'");
        }

        // Parse optional "from" clause
        let source: string | undefined;
        let afterFromComments: Comment[] | undefined;
        if (this.isAt("from")) {
            this.skipWhitespace(4); // skip "from"
            afterFromComments = this.parseComments();

            // Parse source string
            if (!this.isAtStringDelimiter()) {
                this.throwUnexpectedCharError(
                    "Expected string literal for import source",
                );
            }
            source = this.parseStringLiteral();
        } else if (names === "*") {
            this.throwUnexpectedCharError(
                "Wildcard import ('import *') requires a 'from' clause",
            );
        }

        const trailingComments = this.consumeWithTrailingComments(
            ";",
            "import statement",
        );

        return {
            names,
            source,
            pos,
            leadingComments,
            afterImportComments,
            afterCloseBraceComments,
            afterStarComments,
            afterFromComments,
            trailingComments,
        };
    }

    public parse(): GrammarParseResult {
        const imports: ImportStatement[] = [];
        const definitions: RuleDefinition[] = [];
        let trailingComments: Comment[] | undefined;
        this.skipWhitespace();
        const leadingComments = this.parseComments();

        while (!this.isAtEnd()) {
            this.skipWhitespace();
            if (this.isAtEnd()) break;
            const constructLeading = this.parseComments();
            if (this.isAtEnd()) {
                // Comments at end of file with no following construct.
                trailingComments = constructLeading;
                break;
            }

            if (this.isAt("<")) {
                definitions.push(this.parseRuleDefinition(constructLeading));
                continue;
            }
            if (this.isAt("import")) {
                imports.push(this.parseImportStatement(constructLeading));
                continue;
            }
            if (this.isAt("export")) {
                this.skipWhitespace(6); // skip "export"
                const afterExportComments = this.parseComments();
                if (!this.isAt("<")) {
                    this.throwUnexpectedCharError(
                        "Expected rule definition after 'export'",
                    );
                }
                definitions.push(
                    this.parseRuleDefinition(
                        constructLeading,
                        true,
                        afterExportComments,
                    ),
                );
                continue;
            }
            this.throwUnexpectedCharError(
                "Expected rule definition or 'import' statement",
            );
        }
        return {
            imports,
            definitions,
            leadingComments,
            trailingComments,
        };
    }
}
