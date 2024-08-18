// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const enum State {
    Value,
    ObjectStart,
    PropStart,
    PropColon,
    PropEnd,
    ArrayStart,
    ElemEnd,
    End,
    Error,
}
const enum LiteralType {
    String,
    StringEscape,
    StringUnicodeEscape,
    Number,
    NumberFraction,
    NumberExponent,
    True,
    False,
    Null,
    None,
}

const enum JSONTokenType {
    ObjectStart, // {
    ObjectEnd, // }
    Comma, // ,
    ArrayStart, // [
    ArrayEnd, // ]
    Colon, // :
    Literal, // string, number, boolean, null
    Error,
}

type JSONToken = {
    type: JSONTokenType;
    literal?: string | number | boolean | null;
};

export function createIncrementalJsonParser(
    cb: (prop: string, value: any) => void,
    options?: {
        full?: boolean;
    },
) {
    let currentLiteralType: LiteralType = LiteralType.None;
    let currentLiteral: string = "";
    let currentUnicodeEscape: string = "";

    function finishLiteralValue(
        c: string,
        expectedStr: string,
        value: any,
    ): JSONToken[] | undefined {
        currentLiteral += c;
        if (currentLiteral === expectedStr) {
            currentLiteralType = LiteralType.None;
            return [{ type: JSONTokenType.Literal, literal: value }];
        }
        if (!expectedStr.startsWith(currentLiteral)) {
            return [{ type: JSONTokenType.Error }];
        }
        return undefined;
    }
    function finishNumber(c: string): JSONToken[] {
        currentLiteralType = LiteralType.None;
        if ("0123456789".includes(currentLiteral[currentLiteral.length - 1])) {
            return [
                {
                    type: JSONTokenType.Literal,
                    literal: parseFloat(currentLiteral),
                },
                ...(getNextTokens(c) ?? []),
            ];
        }
        return [{ type: JSONTokenType.Error }];
    }

    function processCharForLiteral(c: string): JSONToken[] | undefined {
        switch (currentLiteralType) {
            case LiteralType.String:
                if (c === '"') {
                    currentLiteralType = LiteralType.None;
                    return [
                        {
                            type: JSONTokenType.Literal,
                            literal: currentLiteral,
                        },
                    ];
                }
                if (c === "\\") {
                    currentLiteralType = LiteralType.StringEscape;
                } else {
                    currentLiteral += c;
                }
                return undefined;
            case LiteralType.StringEscape:
                currentLiteralType = LiteralType.String;
                switch (c) {
                    case '"':
                    case "\\":
                    case "/":
                        currentLiteral += c;
                        break;
                    case "b":
                        currentLiteral += "\b";
                        break;
                    case "f":
                        currentLiteral += "\f";
                        break;
                    case "n":
                        currentLiteral += "\n";
                        break;
                    case "r":
                        currentLiteral += "\r";
                        break;
                    case "t":
                        currentLiteral += "\t";
                        break;
                    case "u":
                        currentUnicodeEscape = "";
                        currentLiteralType = LiteralType.StringUnicodeEscape;
                        break;
                    default:
                        return [{ type: JSONTokenType.Error }];
                }
                return undefined;
            case LiteralType.StringUnicodeEscape:
                if ("0123456789abcdefABCDEF".includes(c)) {
                    currentUnicodeEscape += c;
                    if (currentUnicodeEscape.length === 4) {
                        currentLiteral += String.fromCharCode(
                            parseInt(currentUnicodeEscape, 16),
                        );
                        currentLiteralType = LiteralType.String;
                    }
                    return undefined;
                }
                return [{ type: JSONTokenType.Error }];
            case LiteralType.Number:
                if (c === "e" || c === "E" || c === ".") {
                    if (currentLiteral === "-") {
                        return [{ type: JSONTokenType.Error }];
                    }
                    currentLiteral += c;
                    currentLiteralType =
                        c === "."
                            ? LiteralType.NumberFraction
                            : LiteralType.NumberExponent;
                    return undefined;
                }
                if ("0123456789".includes(c)) {
                    if (currentLiteral === "0" || currentLiteral === "-0") {
                        // Can't prefix with 0.
                        return [{ type: JSONTokenType.Error }];
                    }
                    currentLiteral += c;
                    return undefined;
                }

                return finishNumber(c);

            case LiteralType.NumberFraction:
                if ("0123456789".includes(c)) {
                    currentLiteral += c;
                    return undefined;
                }
                if (c === "e" || c === "E") {
                    if (currentLiteral.endsWith(".")) {
                        return [{ type: JSONTokenType.Error }];
                    }
                    currentLiteral += c;
                    currentLiteralType = LiteralType.NumberExponent;
                    return undefined;
                }
                return finishNumber(c);
            case LiteralType.NumberExponent:
                if ("0123456789".includes(c)) {
                    currentLiteral += c;
                    return undefined;
                }
                if (c === "+" || c === "-") {
                    if (
                        currentLiteral.endsWith("e") ||
                        currentLiteral.endsWith("E")
                    ) {
                        currentLiteral += c;
                        return undefined;
                    }
                }
                return finishNumber(c);

            case LiteralType.True:
                return finishLiteralValue(c, "true", true);
            case LiteralType.False:
                return finishLiteralValue(c, "false", false);
            case LiteralType.Null:
                return finishLiteralValue(c, "null", null);
            default:
                return [{ type: JSONTokenType.Error }];
        }
    }
    function startLiteral(type: LiteralType, c: string) {
        currentLiteralType = type;
        currentLiteral = c;
    }
    function getNextTokens(c: string): JSONToken[] | undefined {
        if (currentLiteralType !== LiteralType.None) {
            return processCharForLiteral(c);
        }
        switch (c) {
            case "{":
                return [{ type: JSONTokenType.ObjectStart }];
            case "}":
                return [{ type: JSONTokenType.ObjectEnd }];
            case "[":
                return [{ type: JSONTokenType.ArrayStart }];
            case "]":
                return [{ type: JSONTokenType.ArrayEnd }];
            case ",":
                return [{ type: JSONTokenType.Comma }];
            case ":":
                return [{ type: JSONTokenType.Colon }];
            case " ":
            case "\n":
            case "\r":
            case "\t":
                break;
            case '"':
                startLiteral(LiteralType.String, "");
                break;
            case "t":
                startLiteral(LiteralType.True, c);
                break;
            case "f":
                startLiteral(LiteralType.False, c);
                break;
            case "n":
                startLiteral(LiteralType.Null, c);
                break;
            case "-":
            case "0":
            case "1":
            case "2":
            case "3":
            case "4":
            case "5":
            case "6":
            case "7":
            case "8":
            case "9":
                startLiteral(LiteralType.Number, c);
                break;
            default:
                return [{ type: JSONTokenType.Error }];
        }
    }

    let state: State = State.Value;
    let props: (string | number)[] = [];
    let nested: any[] = [];
    let currentNested: any = undefined;
    function processValue(value: any) {
        if (value === undefined) {
            if (options?.full) {
                value = currentNested;
                cb!(props.join("."), value);
                currentNested = nested.pop();
            }
        } else {
            cb!(props.join("."), value);
        }

        const lastProp = props.pop();
        if (lastProp === undefined) {
            return State.End;
        }
        if (options?.full) {
            currentNested[lastProp] = value;
        }
        if (typeof lastProp === "string") {
            return State.PropEnd;
        }
        props.push(lastProp + 1);
        return State.ElemEnd;
    }
    function processToken(token: JSONToken) {
        if (token.type === JSONTokenType.Error) {
            return State.Error;
        }
        switch (state) {
            case State.ArrayStart:
                if (token.type === JSONTokenType.ArrayEnd) {
                    props.pop();
                    return processValue(undefined);
                }
            // fall thru
            case State.Value:
                if (token.type === JSONTokenType.ObjectStart) {
                    if (options?.full) {
                        nested.push(currentNested);
                        currentNested = {};
                    }
                    return State.ObjectStart;
                }
                if (token.type === JSONTokenType.ArrayStart) {
                    if (options?.full) {
                        nested.push(currentNested);
                        currentNested = [];
                    }
                    props.push(0);
                    return State.ArrayStart;
                }
                if (token.type === JSONTokenType.Literal) {
                    return processValue(token.literal);
                }
                break;
            case State.ObjectStart:
                if (token.type === JSONTokenType.ObjectEnd) {
                    return processValue(undefined);
                }
            // fall thru
            case State.PropStart:
                if (
                    token.type == JSONTokenType.Literal &&
                    typeof token.literal === "string"
                ) {
                    props.push(token.literal);
                    return State.PropColon;
                }
                break;

            case State.PropColon:
                if (token.type === JSONTokenType.Colon) {
                    return State.Value;
                }
                break;
            case State.PropEnd:
                if (token.type === JSONTokenType.ObjectEnd) {
                    return processValue(undefined);
                }
                if (token.type === JSONTokenType.Comma) {
                    return State.PropStart;
                }
                break;

            case State.ElemEnd:
                if (token.type === JSONTokenType.ArrayEnd) {
                    // array value
                    props.pop();
                    return processValue(undefined);
                }
                if (token.type === JSONTokenType.Comma) {
                    return State.Value;
                }
                break;
        }
        return State.Error;
    }
    function processChar(c: string) {
        const tokens = getNextTokens(c);
        if (tokens === undefined) {
            return true;
        }
        for (const token of tokens) {
            state = processToken(token);
            if (state === State.Error) {
                return false;
            }
        }
        return true;
    }
    return (chunk: string, finished: boolean = false) => {
        if (state === State.Error) {
            return false;
        }
        for (const c of chunk) {
            if (!processChar(c)) {
                return false;
            }
        }

        return finished ? processChar(" ") : true;
    };
}
