// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The Seal-Tools HuggingFace rows embed Python `repr()` literals (single- and
// double-quoted strings, True/False/None) inside the conversation text. This is
// a small tolerant recursive-descent parser for those literals.

export type PyValue =
    | string
    | number
    | PythonNumber
    | boolean
    | null
    | PyValue[]
    | { [key: string]: PyValue };

export interface PythonNumber {
    __pythonNumber: string;
}

export function isPythonNumber(value: unknown): value is PythonNumber {
    return (
        typeof value === "object" &&
        value !== null &&
        Object.keys(value).length === 1 &&
        typeof (value as PythonNumber).__pythonNumber === "string"
    );
}

export function toPythonNumberString(lexeme: string): string {
    const value = Number(lexeme);
    const isFloat = /[.eE]/.test(lexeme);
    if (!isFloat) return BigInt(lexeme).toString();
    if (Object.is(value, -0)) return "-0.0";
    const absolute = Math.abs(value);
    if (Number.isInteger(value) && absolute < 1e16) {
        return `${String(value)}.0`;
    }
    const text =
        absolute !== 0 && (absolute < 1e-4 || absolute >= 1e16)
            ? value.toExponential()
            : String(value);
    return text.replace(/e([+-])(\d)$/, "e$10$2");
}

export function decodePythonStringContents(text: string): string {
    let out = "";
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (c !== "\\") {
            out += c;
            continue;
        }
        const next = text[++i];
        switch (next) {
            case "n":
                out += "\n";
                break;
            case "t":
                out += "\t";
                break;
            case "r":
                out += "\r";
                break;
            case "\\":
            case "'":
            case '"':
                out += next;
                break;
            case "x": {
                const hex = text.slice(i + 1, i + 3);
                if (/^[0-9a-fA-F]{2}$/.test(hex)) {
                    out += String.fromCharCode(parseInt(hex, 16));
                    i += 2;
                } else {
                    out += next;
                }
                break;
            }
            case "u": {
                const hex = text.slice(i + 1, i + 5);
                if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                    out += String.fromCharCode(parseInt(hex, 16));
                    i += 4;
                } else {
                    out += next;
                }
                break;
            }
            default:
                out += next ?? "";
        }
    }
    return out;
}

export function parsePythonLiteral(
    text: string,
    start = 0,
    preserveNumberLexemes = false,
): { value: PyValue; end: number } {
    let i = start;
    const n = text.length;

    const skipWs = () => {
        while (i < n && /\s/.test(text[i]!)) i++;
    };

    function parseString(): string {
        const quote = text[i]!;
        const start = ++i;
        while (i < n) {
            const c = text[i]!;
            if (c === "\\") {
                i += 2;
                continue;
            }
            if (c === quote) {
                const out = decodePythonStringContents(text.slice(start, i));
                i++;
                return out;
            }
            i++;
        }
        throw new Error("unterminated string in python literal");
    }

    function parseArray(): PyValue[] {
        i++; // consume [
        const arr: PyValue[] = [];
        skipWs();
        if (text[i] === "]") {
            i++;
            return arr;
        }
        while (i < n) {
            arr.push(parseValue());
            skipWs();
            if (text[i] === ",") {
                i++;
                skipWs();
                if (text[i] === "]") {
                    i++;
                    return arr;
                }
                continue;
            }
            if (text[i] === "]") {
                i++;
                return arr;
            }
            throw new Error(`expected ',' or ']' at index ${i}`);
        }
        throw new Error("unterminated array in python literal");
    }

    function parseObject(): { [key: string]: PyValue } {
        i++; // consume {
        const obj: { [key: string]: PyValue } = {};
        skipWs();
        if (text[i] === "}") {
            i++;
            return obj;
        }
        while (i < n) {
            skipWs();
            const key = parseValue();
            if (typeof key !== "string") {
                throw new Error("python object key must be a string");
            }
            skipWs();
            if (text[i] !== ":") {
                throw new Error(`expected ':' at index ${i}`);
            }
            i++;
            obj[key] = parseValue();
            skipWs();
            if (text[i] === ",") {
                i++;
                skipWs();
                if (text[i] === "}") {
                    i++;
                    return obj;
                }
                continue;
            }
            if (text[i] === "}") {
                i++;
                return obj;
            }
            throw new Error(`expected ',' or '}' at index ${i}`);
        }
        throw new Error("unterminated object in python literal");
    }

    function parseValue(): PyValue {
        skipWs();
        const c = text[i];
        if (c === "'" || c === '"') return parseString();
        if (c === "{") return parseObject();
        if (c === "[") return parseArray();
        const rest = text.slice(i);
        const m = /^(True|False|None|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
            rest,
        );
        if (m === null) {
            throw new Error(
                `unexpected token at index ${i}: ${text.slice(i, i + 24)}`,
            );
        }
        i += m[0].length;
        if (m[0] === "True") return true;
        if (m[0] === "False") return false;
        if (m[0] === "None") return null;
        return preserveNumberLexemes
            ? { __pythonNumber: toPythonNumberString(m[0]) }
            : Number(m[0]);
    }

    const value = parseValue();
    return { value, end: i };
}
