// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function decodeEscapes(value: string): string {
    const escapes: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
        v: "\v",
        "\\": "\\",
        "'": "'",
        '"': '"',
    };
    return value.replace(
        /\\(\r?\n|u[\da-fA-F]{4}|U[\da-fA-F]{8}|x[\da-fA-F]{2}|.)/g,
        (_match, escape: string) => {
            if (escape === "\n" || escape === "\r\n") return "";
            if (/^[uUx]/.test(escape))
                return String.fromCodePoint(parseInt(escape.slice(1), 16));
            if (!(escape in escapes))
                throw new Error(`Unsupported literal escape: ${escape}`);
            return escapes[escape];
        },
    );
}

export function parseLiteral(source: string): unknown {
    let offset = 0;
    const whitespace = () => {
        while (/\s/.test(source[offset] ?? "") && offset < source.length)
            offset++;
    };
    function quoted(): string {
        const quote = source[offset++];
        let raw = "";
        while (offset < source.length) {
            const char = source[offset++];
            if (char === quote) return decodeEscapes(raw);
            raw += char;
            if (char === "\\") raw += source[offset++];
        }
        throw new Error("Unterminated literal string");
    }
    function sequence(close: string): unknown[] {
        const values: unknown[] = [];
        while (true) {
            whitespace();
            if (source[offset] === close) {
                offset++;
                return values;
            }
            values.push(value());
            whitespace();
            if (source[offset] === close) {
                offset++;
                return values;
            }
            if (source[offset++] !== ",")
                throw new Error("Expected literal separator");
        }
    }
    function dictionary(): Record<string, unknown> {
        const result: Record<string, unknown> = Object.create(null);
        while (true) {
            whitespace();
            if (source[offset] === "}") {
                offset++;
                return result;
            }
            const key = value();
            if (typeof key !== "string")
                throw new Error("Expected string dictionary key");
            whitespace();
            if (source[offset++] !== ":")
                throw new Error("Expected dictionary colon");
            result[key] = value();
            whitespace();
            if (source[offset] === "}") {
                offset++;
                return result;
            }
            if (source[offset++] !== ",")
                throw new Error("Expected dictionary separator");
        }
    }
    function value(): unknown {
        whitespace();
        const char = source[offset];
        if (char === "'" || char === '"') return quoted();
        if (char === "[" || char === "(") {
            offset++;
            return sequence(char === "[" ? "]" : ")");
        }
        if (char === "{") {
            offset++;
            return dictionary();
        }
        const token =
            /^(?:True|False|None|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
                source.slice(offset),
            )?.[0];
        if (!token)
            throw new Error(`Unsupported literal at position ${offset}`);
        offset += token.length;
        if (["None", "null"].includes(token)) return null;
        if (["True", "true"].includes(token)) return true;
        if (["False", "false"].includes(token)) return false;
        return Number(token);
    }
    const result = value();
    whitespace();
    if (offset !== source.length) throw new Error("Trailing literal input");
    return result;
}
