// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PythonLiteral =
    | string
    | number
    | PythonNumber
    | boolean
    | null
    | PythonLiteral[]
    | { [key: string]: PythonLiteral };

export class PythonNumber {
    public constructor(public readonly lexeme: string) {}
}

export interface PythonLiteralOptions {
    preserveNumberLexemes?: boolean;
    maxDepth?: number;
    maxValues?: number;
    maxStringLength?: number;
}

export type PythonLiteralOffsetOptions = PythonLiteralOptions & {
    offset?: number;
};

export interface PythonLiteralParseResult {
    value: PythonLiteral;
    end: number;
}

function isWhitespace(ch: string): boolean {
    return ch.trim() === "";
}

function isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
}

function isHexDigit(ch: string): boolean {
    return isDigit(ch) || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

function isWordChar(ch: string): boolean {
    return (
        (ch >= "a" && ch <= "z") ||
        (ch >= "A" && ch <= "Z") ||
        isDigit(ch) ||
        ch === "_"
    );
}

function isIdentifierStart(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function skipWhitespace(text: string, offset: number): number {
    while (offset < text.length && isWhitespace(text[offset]!)) {
        offset++;
    }
    return offset;
}

/**
 * Optional "-", then "0" or [1-9][0-9]*, optional "." + digits (only when a
 * digit follows), optional e/E exponent (only when digits follow). Returns
 * the lexeme, or undefined when the integer part does not match.
 */
function scanNumberLexeme(text: string, offset: number): string | undefined {
    let i = offset;
    if (text[i] === "-") {
        i++;
    }
    const lead = text[i];
    if (lead === "0") {
        i++;
    } else if (lead !== undefined && lead >= "1" && lead <= "9") {
        i++;
        while (i < text.length && isDigit(text[i]!)) {
            i++;
        }
    } else {
        return undefined;
    }
    if (text[i] === "." && text[i + 1] !== undefined && isDigit(text[i + 1]!)) {
        i += 2;
        while (i < text.length && isDigit(text[i]!)) {
            i++;
        }
    }
    const e = text[i];
    if (e === "e" || e === "E") {
        let j = i + 1;
        const sign = text[j];
        if (sign === "+" || sign === "-") {
            j++;
        }
        if (j < text.length && isDigit(text[j]!)) {
            i = j;
            while (i < text.length && isDigit(text[i]!)) {
                i++;
            }
        }
    }
    return text.slice(offset, i);
}

type ParseResult = PythonLiteralParseResult;

/**
 * Parses single/double-quoted strings with simple, hex, or Unicode escapes;
 * lists and string-keyed dictionaries with optional trailing commas; True,
 * False, None, and JSON-shaped decimal/exponent numbers. Other Python syntax,
 * including prefixes, tuples, bytes, comments, arithmetic, NaN, and Infinity,
 * is not part of this dataset grammar.
 */
export function parsePythonLiteral(
    text: string,
    options: PythonLiteralOptions = {},
): PythonLiteral {
    const parser = new PythonLiteralParser(text, options);
    const result = parser.parse(0);
    const end = parser.skipWhitespace(result.end);
    if (end !== text.length) {
        throw parser.error("unexpected trailing input", end);
    }
    return result.value;
}

export function parsePythonLiteralAt(
    text: string,
    options: PythonLiteralOffsetOptions = {},
): PythonLiteralParseResult {
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length) {
        throw new RangeError(`invalid Python literal offset: ${offset}`);
    }
    return new PythonLiteralParser(text, options).parse(offset);
}

class PythonLiteralParser {
    private valueCount = 0;
    private readonly preserveNumberLexemes: boolean;
    private readonly maxDepth: number;
    private readonly maxValues: number;
    private readonly maxStringLength: number;

    public constructor(
        private readonly text: string,
        options: PythonLiteralOptions,
    ) {
        this.preserveNumberLexemes = options.preserveNumberLexemes ?? false;
        this.maxDepth = limit("maxDepth", options.maxDepth, 100);
        this.maxValues = limit("maxValues", options.maxValues, 100_000);
        this.maxStringLength = limit(
            "maxStringLength",
            options.maxStringLength,
            1_000_000,
        );
    }

    public parse(offset: number): PythonLiteralParseResult {
        return this.parseValue(this.skipWhitespace(offset), 0);
    }

    public skipWhitespace(offset: number): number {
        return skipWhitespace(this.text, offset);
    }

    public error(message: string, offset: number): SyntaxError {
        return new SyntaxError(`${message} at index ${offset}`);
    }

    private parseValue(offset: number, depth: number): ParseResult {
        this.valueCount++;
        if (this.valueCount > this.maxValues) {
            throw this.error("Python literal exceeds maxValues", offset);
        }
        if (depth > this.maxDepth) {
            throw this.error("Python literal exceeds maxDepth", offset);
        }

        offset = this.skipWhitespace(offset);
        const token = this.text[offset];
        if (token === "'" || token === '"') {
            return this.parseString(offset, token);
        }
        if (token === "[") {
            return this.parseArray(offset, depth);
        }
        if (token === "{") {
            return this.parseObject(offset, depth);
        }
        for (const [keyword, value] of [
            ["True", true],
            ["False", false],
            ["None", null],
        ] as const) {
            if (this.matchesKeyword(offset, keyword)) {
                return { value, end: offset + keyword.length };
            }
        }
        return this.parseNumber(offset);
    }

    private parseString(offset: number, quote: string): ParseResult {
        let value = "";
        let cursor = offset + 1;
        while (cursor < this.text.length) {
            const character = this.text[cursor++]!;
            if (character === quote) {
                return { value, end: cursor };
            }
            if (character !== "\\") {
                value += character;
            } else {
                const escape = this.decodeEscape(cursor);
                value += escape.value;
                cursor = escape.end;
            }
            if (value.length > this.maxStringLength) {
                throw this.error(
                    "Python string exceeds maxStringLength",
                    offset,
                );
            }
        }
        throw this.error("unterminated Python string", offset);
    }

    private decodeEscape(offset: number): { value: string; end: number } {
        if (offset >= this.text.length) {
            throw this.error("unterminated Python string escape", offset);
        }
        const character = this.text[offset]!;
        const simpleEscapes: Record<string, string> = {
            "\\": "\\",
            "'": "'",
            '"': '"',
            a: "\x07",
            b: "\b",
            f: "\f",
            n: "\n",
            r: "\r",
            t: "\t",
            v: "\v",
        };
        if (character in simpleEscapes) {
            return { value: simpleEscapes[character]!, end: offset + 1 };
        }
        const width =
            character === "x"
                ? 2
                : character === "u"
                  ? 4
                  : character === "U"
                    ? 8
                    : 0;
        if (width !== 0) {
            const digits = this.text.slice(offset + 1, offset + 1 + width);
            if (digits.length !== width || ![...digits].every(isHexDigit)) {
                throw this.error("invalid Python string escape", offset - 1);
            }
            const codePoint = Number.parseInt(digits, 16);
            if (codePoint > 0x10ffff) {
                throw this.error("invalid Python string escape", offset - 1);
            }
            return {
                value: String.fromCodePoint(codePoint),
                end: offset + 1 + width,
            };
        }
        return { value: `\\${character}`, end: offset + 1 };
    }

    private parseArray(offset: number, depth: number): ParseResult {
        const values: PythonLiteral[] = [];
        let cursor = this.skipWhitespace(offset + 1);
        if (this.text[cursor] === "]") {
            return { value: values, end: cursor + 1 };
        }
        while (true) {
            const item = this.parseValue(cursor, depth + 1);
            values.push(item.value);
            cursor = this.skipWhitespace(item.end);
            if (this.text[cursor] === "]") {
                return { value: values, end: cursor + 1 };
            }
            if (this.text[cursor] !== ",") {
                throw this.error("expected ',' or ']'", cursor);
            }
            cursor = this.skipWhitespace(cursor + 1);
            if (this.text[cursor] === "]") {
                return { value: values, end: cursor + 1 };
            }
        }
    }

    private parseObject(offset: number, depth: number): ParseResult {
        const value: { [key: string]: PythonLiteral } = Object.create(null);
        let cursor = this.skipWhitespace(offset + 1);
        if (this.text[cursor] === "}") {
            return { value, end: cursor + 1 };
        }
        while (true) {
            const quote = this.text[cursor];
            if (quote !== "'" && quote !== '"') {
                throw this.error("Python object key must be a string", cursor);
            }
            const key = this.parseString(cursor, quote);
            cursor = this.skipWhitespace(key.end);
            if (this.text[cursor] !== ":") {
                throw this.error("expected ':'", cursor);
            }
            const item = this.parseValue(cursor + 1, depth + 1);
            value[key.value as string] = item.value;
            cursor = this.skipWhitespace(item.end);
            if (this.text[cursor] === "}") {
                return { value, end: cursor + 1 };
            }
            if (this.text[cursor] !== ",") {
                throw this.error("expected ',' or '}'", cursor);
            }
            cursor = this.skipWhitespace(cursor + 1);
            if (this.text[cursor] === "}") {
                return { value, end: cursor + 1 };
            }
        }
    }

    private parseNumber(offset: number): PythonLiteralParseResult {
        const lexeme = scanNumberLexeme(this.text, offset);
        if (lexeme === undefined) {
            throw this.error("unexpected Python literal token", offset);
        }
        const number = Number(lexeme);
        if (
            !this.preserveNumberLexemes &&
            (!Number.isFinite(number) ||
                (Number.isInteger(number) && !Number.isSafeInteger(number)))
        ) {
            throw this.error("number requires preserveNumberLexemes", offset);
        }
        return {
            value: this.preserveNumberLexemes
                ? new PythonNumber(lexeme)
                : number,
            end: offset + lexeme.length,
        };
    }

    private matchesKeyword(offset: number, keyword: string): boolean {
        if (!this.text.startsWith(keyword, offset)) {
            return false;
        }
        const next = this.text[offset + keyword.length];
        return next === undefined || !isWordChar(next);
    }
}

function limit(name: string, value: number | undefined, fallback: number) {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
    }
    return result;
}

export interface DroidCall {
    id: number;
    name: string;
    arguments: Record<string, PythonLiteral>;
    positionalArguments?: PythonLiteral[];
}

function splitTopLevel(text: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let quote: string | undefined;
    let escaped = false;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i]!;
        if (quote !== undefined) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === quote) quote = undefined;
            continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (char === "[" || char === "{" || char === "(") depth++;
        else if (char === "]" || char === "}" || char === ")") depth--;
        else if (char === "," && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.filter((part) => part.trim().length > 0);
}

function findTopLevelEquals(text: string): number {
    let quote: string | undefined;
    let escaped = false;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i]!;
        if (quote !== undefined) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === quote) quote = undefined;
            continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (char === "[" || char === "{" || char === "(") depth++;
        else if (char === "]" || char === "}" || char === ")") depth--;
        else if (char === "=" && depth === 0) return i;
    }
    return -1;
}

function findClosingParen(text: string, open: number): number {
    let quote: string | undefined;
    let escaped = false;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const char = text[i]!;
        if (quote !== undefined) {
            if (escaped) escaped = false;
            else if (char === "\\") escaped = true;
            else if (char === quote) quote = undefined;
            continue;
        }
        if (char === '"' || char === "'") quote = char;
        else if (char === "(") depth++;
        else if (char === ")" && --depth === 0) return i;
    }
    throw new Error(`unterminated function call at index ${open}`);
}

/**
 * Matches a bare `result<digits>` token starting at `index`: digits must be
 * followed by a non-word char or end of text. Returns the digits and the
 * full matched length.
 */
function scanResultReference(
    text: string,
    index: number,
): { digits: string; length: number } | undefined {
    if (!text.startsWith("result", index)) {
        return undefined;
    }
    let end = index + "result".length;
    const digitsStart = end;
    while (end < text.length && isDigit(text[end]!)) {
        end++;
    }
    if (end === digitsStart) {
        return undefined;
    }
    const next = text[end];
    if (next !== undefined && isWordChar(next)) {
        return undefined;
    }
    return { digits: text.slice(digitsStart, end), length: end - index };
}

// Quote bare resultN tokens so the Python-literal parser can preserve them
// inside lists and dictionaries without changing ordinary string contents.
function replaceResultReferences(text: string): string {
    let output = "";
    let quote: string | undefined;
    let escaped = false;
    for (let index = 0; index < text.length; index++) {
        const character = text[index]!;
        if (quote !== undefined) {
            output += character;
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === quote) quote = undefined;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            output += character;
            continue;
        }
        const reference = scanResultReference(text, index);
        const previous = index === 0 ? undefined : text[index - 1];
        if (
            reference !== undefined &&
            (previous === undefined || !isWordChar(previous))
        ) {
            output += JSON.stringify(`#${reference.digits}`);
            index += reference.length - 1;
            continue;
        }
        output += character;
    }
    return output;
}

function parseValue(text: string): PythonLiteral {
    return parsePythonLiteral(replaceResultReferences(text.trim()));
}

function parseArguments(text: string): {
    arguments: Record<string, PythonLiteral>;
    positionalArguments: PythonLiteral[];
} {
    const args = Object.create(null) as Record<string, PythonLiteral>;
    const positionalArguments: PythonLiteral[] = [];
    for (const part of splitTopLevel(text)) {
        const equals = findTopLevelEquals(part);
        if (equals < 0) {
            positionalArguments.push(parseValue(part));
            continue;
        }
        if (equals === 0) throw new Error(`invalid argument: ${part}`);
        const name = part.slice(0, equals).trim();
        if (name.length === 0 || ![...name].every(isWordChar))
            throw new Error(`invalid argument name: ${name}`);
        args[name] = parseValue(part.slice(equals + 1));
    }
    return { arguments: args, positionalArguments };
}

export function parseDroidCallCode(text: string): DroidCall[] {
    const calls: DroidCall[] = [];
    let i = 0;
    while (i < text.length) {
        // `result` must start a token (word boundary) and be followed
        // directly by digits, then `=`, then `name(`.
        if (
            !text.startsWith("result", i) ||
            (i > 0 && isWordChar(text[i - 1]!))
        ) {
            i++;
            continue;
        }
        let j = i + "result".length;
        const digitsStart = j;
        while (j < text.length && isDigit(text[j]!)) {
            j++;
        }
        if (j === digitsStart) {
            i++;
            continue;
        }
        const digits = text.slice(digitsStart, j);
        j = skipWhitespace(text, j);
        if (text[j] !== "=") {
            i++;
            continue;
        }
        j = skipWhitespace(text, j + 1);
        const nameStart = j;
        if (j < text.length && isIdentifierStart(text[j]!)) {
            j++;
            while (j < text.length && isWordChar(text[j]!)) {
                j++;
            }
        }
        const name = text.slice(nameStart, j);
        if (name.length === 0) {
            i++;
            continue;
        }
        j = skipWhitespace(text, j);
        if (text[j] !== "(") {
            i++;
            continue;
        }
        const open = j;
        const close = findClosingParen(text, open);
        const parsed = parseArguments(text.slice(open + 1, close));
        const id = Number(digits);
        if (!Number.isSafeInteger(id)) {
            throw new RangeError(`invalid result id: ${digits}`);
        }
        calls.push({
            id,
            name,
            arguments: parsed.arguments,
            ...(parsed.positionalArguments.length === 0
                ? {}
                : { positionalArguments: parsed.positionalArguments }),
        });
        i = close + 1;
    }
    return calls;
}

function isResultReference(value: string): boolean {
    if (!value.startsWith("#") || value.length === 1) {
        return false;
    }
    for (let i = 1; i < value.length; i++) {
        if (!isDigit(value[i]!)) {
            return false;
        }
    }
    return true;
}

export function hasDroidCallResultReference(value: unknown): boolean {
    if (typeof value === "string") return isResultReference(value);
    if (Array.isArray(value)) return value.some(hasDroidCallResultReference);
    if (typeof value === "object" && value !== null) {
        return Object.values(value).some(hasDroidCallResultReference);
    }
    return false;
}

export type DroidCallShape =
    | "noCall"
    | "singleTool"
    | "multiCallNested"
    | "multiCallWithoutNested";

export function classifyDroidCalls(calls: DroidCall[]): DroidCallShape {
    if (calls.length === 0) return "noCall";
    if (calls.length === 1) return "singleTool";
    return calls.some(
        (call) =>
            hasDroidCallResultReference(call.arguments) ||
            hasDroidCallResultReference(call.positionalArguments),
    )
        ? "multiCallNested"
        : "multiCallWithoutNested";
}
