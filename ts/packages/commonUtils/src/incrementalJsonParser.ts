// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const enum State {
    Element,
    LiteralString,
    LiteralStringEscape,
    LiteralStringUnicodeEscape,
    LiteralNumberInteger,
    LiteralNumberFraction,
    LiteralNumberExponent,
    LiteralKeyword,
    ObjectStart,
    ObjectPropStart,
    ObjectPropColon,
    ObjectPropEnd,
    ArrayStart,
    ArrayElemEnd,
    End,
    Error,
}

const skipSpace = [
    true, // Element,
    false, // LiteralString,
    false, // LiteralStringEscape,
    false, // LiteralStringUnicodeEscape,
    false, // LiteralNumberInteger,
    false, // LiteralNumberFraction,
    false, // LiteralNumberExponent,
    false, // LiteralKeyword,
    true, // ObjectStart,
    true, // ObjectPropStart,
    true, // ObjectPropColon,
    true, // ObjectPropEnd,
    true, // ArrayStart,
    true, // ArrayElemEnd,
    true, // End,
    false, // Error
];

export type IncrementalJsonValueCallBack = (
    prop: string,
    value: any,
    delta?: string,
) => void;

export function createIncrementalJsonParser(
    callback: IncrementalJsonValueCallBack,
    options?: {
        full?: boolean;
        partial?: boolean;
    },
) {
    function tryCallBack(prop: string, value: any, delta?: string) {
        try {
            parser.callback(prop, value, delta);
        } catch (e) {
            // callback throw, just set it to error state and stop incremental parsing.
            currentState = State.Error;
        }
    }

    // Literal value
    let currentLiteral: string = "";
    let literalDelta: string = "";
    let currentUnicodeEscape: string = "";
    let expectedKeyword: string = "";
    let expectedKeywordValue: boolean | null = null;

    // Nested object/arrays property names
    let props: (string | number)[] = [];

    // For full mode
    let nested: any[] = [];
    let currentNested: any = undefined;

    function parseLiteralKeyword(c: string) {
        currentLiteral += c;
        if (currentLiteral === expectedKeyword) {
            return finishElementValue(expectedKeywordValue);
        }
        if (!expectedKeyword.startsWith(currentLiteral)) {
            // invalid keyword
            return State.Error;
        }
        return currentState;
    }
    function finishLiteralNumber(c: string): State {
        if ("0123456789".includes(currentLiteral[currentLiteral.length - 1])) {
            const nextState = finishElementValue(parseFloat(currentLiteral));
            return incrParseChar(c, nextState);
        }
        // Invalid number
        return State.Error;
    }
    function finishElementValue(value?: any) {
        if (value === undefined) {
            // finishing structures (object/array)
            if (options?.full) {
                value = currentNested;
                tryCallBack(props.join("."), value);
                currentNested = nested.pop();
            }
        } else {
            reportStringDelta();
            tryCallBack(props.join("."), value);
        }

        const lastProp = props.pop();
        if (lastProp === undefined) {
            return State.End;
        }
        if (options?.full) {
            currentNested[lastProp] = value;
        }
        if (typeof lastProp === "string") {
            return State.ObjectPropEnd;
        }
        props.push(lastProp + 1);
        return State.ArrayElemEnd;
    }
    function startObject() {
        if (options?.full) {
            nested.push(currentNested);
            currentNested = {};
        }
        return State.ObjectStart;
    }
    function startArray() {
        if (options?.full) {
            nested.push(currentNested);
            currentNested = [];
        }
        props.push(0); // push the index
        return State.ArrayStart;
    }
    function finishArray() {
        props.pop(); // pop the index
        return finishElementValue();
    }
    function startLiteral(c: string, newState: State): State {
        currentLiteral = c;
        return newState;
    }
    function startKeyword(c: string, keyword: string, value: boolean | null) {
        expectedKeyword = keyword;
        expectedKeywordValue = value;
        return startLiteral(c, State.LiteralKeyword);
    }
    function parseElement(c: string): State {
        switch (c) {
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
            case "-":
                return startLiteral(c, State.LiteralNumberInteger);
            case '"':
                return startLiteral("", State.LiteralString);
            case "t": // true
                return startKeyword(c, "true", true);
            case "f": // false
                return startKeyword(c, "false", false);
            case "n": // null
                return startKeyword(c, "null", null);
            case "{":
                return startObject();
            case "[":
                return startArray();
            default:
                // Invalid start of an element
                return State.Error;
        }
    }
    function isPendingPropertyName() {
        return props.length !== 0 && props[props.length - 1] === "";
    }
    function appendStringLiteral(c: string) {
        literalDelta += c;
        currentLiteral += c;
    }
    function parseLiteralString(c: string): State {
        switch (c) {
            case '"':
                if (isPendingPropertyName()) {
                    if (currentLiteral === "") {
                        // Can't have empty property name
                        return State.Error;
                    }
                    // Property name
                    props[props.length - 1] = currentLiteral;
                    return State.ObjectPropColon;
                }
                return finishElementValue(currentLiteral);

            case "\\":
                return State.LiteralStringEscape;
            default:
                if (c.charCodeAt(0) < 0x20) {
                    // Invalid control character in string literal
                    return State.Error;
                }
                appendStringLiteral(c);
                return State.LiteralString;
        }
    }
    function parseLiteralStringEscape(c: string): State {
        switch (c) {
            case '"':
            case "\\":
            case "/":
                appendStringLiteral(c);
                break;
            case "b":
                appendStringLiteral("\b");
                break;
            case "f":
                appendStringLiteral("\f");
                break;
            case "n":
                appendStringLiteral("\n");
                break;
            case "r":
                appendStringLiteral("\r");
                break;
            case "t":
                appendStringLiteral("\t");
                break;
            case "u":
                currentUnicodeEscape = "";
                return State.LiteralStringUnicodeEscape;
            default:
                // Invalid escape character
                return State.Error;
        }
        return State.LiteralString;
    }
    function parseLiteralStringUnicodeEscape(c: string): State {
        if (!"0123456789abcdefABCDEF".includes(c)) {
            // Invalid unicode escape character
            return State.Error;
        }
        currentUnicodeEscape += c;
        if (currentUnicodeEscape.length === 4) {
            appendStringLiteral(
                String.fromCharCode(parseInt(currentUnicodeEscape, 16)),
            );
            return State.LiteralString;
        }
        return State.LiteralStringUnicodeEscape;
    }
    function parseLiteralNumberInteger(c: string): State {
        switch (c) {
            case "E":
            case "e":
            case ".":
                if (currentLiteral === "-") {
                    // Invalid integer
                    return State.Error;
                }
                currentLiteral += c;
                return c === "."
                    ? State.LiteralNumberFraction
                    : State.LiteralNumberExponent;
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
                if (currentLiteral === "0" || currentLiteral === "-0") {
                    // Invalid number (leading zero)
                    return State.Error;
                }
                currentLiteral += c;
                return State.LiteralNumberInteger;
            default:
                return finishLiteralNumber(c);
        }
    }
    function parseLiteralNumberFraction(c: string) {
        switch (c) {
            case "E":
            case "e":
                if (currentLiteral.endsWith(".")) {
                    // Invalid number (missing number in fraction)
                    return State.Error;
                }
                currentLiteral += c;
                return State.LiteralNumberExponent;
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
                currentLiteral += c;
                return State.LiteralNumberFraction;
        }
        return finishLiteralNumber(c);
    }
    function parseLiteralNumberExponent(c: string) {
        switch (c) {
            case "+":
            case "-":
                if (
                    !currentLiteral.endsWith("e") &&
                    !currentLiteral.endsWith("E")
                ) {
                    // Invalid number (sign after numbers in exponent)
                    return State.Error;
                }
            // fall thru
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
                currentLiteral += c;
                return State.LiteralNumberExponent;
            default:
                return finishLiteralNumber(c);
        }
    }
    function parseObjectPropStart(c: string) {
        if (c === '"') {
            // Push an empty property name to indicate the next string literal is a property name
            props.push("");
            return startLiteral("", State.LiteralString);
        }
        // Expect a property name
        return State.Error;
    }

    function parseObjectPropEnd(c: string): State {
        switch (c) {
            case "}":
                return finishElementValue();
            case ",":
                return State.ObjectPropStart;
            default:
                // Expecting a comma or end of object
                return State.Error;
        }
    }
    function parseArrayElemEnd(c: string): State {
        switch (c) {
            case "]":
                return finishArray();
            case ",":
                return State.Element;
            default:
                // Expecting a comma or end of array
                return State.Error;
        }
    }
    function incrParseChar(c: string, state: State): State {
        if (skipSpace[state]) {
            switch (c) {
                case " ":
                case "\n":
                case "\r":
                case "\t":
                    return state;
            }
        }
        switch (state) {
            case State.ObjectStart:
                if (c === "}") {
                    return finishElementValue();
                }
            // fall thru
            case State.ObjectPropStart:
                return parseObjectPropStart(c);
            case State.ObjectPropColon:
                // Expect a colon
                return c === ":" ? State.Element : State.Error;
            case State.ObjectPropEnd:
                return parseObjectPropEnd(c);
            case State.ArrayStart:
                if (c === "]") {
                    return finishArray();
                }
            // fall thru
            case State.Element:
                return parseElement(c);
            case State.ArrayElemEnd:
                return parseArrayElemEnd(c);
            case State.LiteralString:
                return parseLiteralString(c);
            case State.LiteralStringEscape:
                return parseLiteralStringEscape(c);
            case State.LiteralStringUnicodeEscape:
                return parseLiteralStringUnicodeEscape(c);
            case State.LiteralNumberInteger:
                return parseLiteralNumberInteger(c);
            case State.LiteralNumberFraction:
                return parseLiteralNumberFraction(c);
            case State.LiteralNumberExponent:
                return parseLiteralNumberExponent(c);
            case State.LiteralKeyword:
                return parseLiteralKeyword(c);
        }
        // Invalid state
        return State.Error;
    }

    function reportStringDelta() {
        if (options?.partial) {
            // States that expect a value and the value is a literal string
            if (
                (currentState === State.LiteralString ||
                    currentState === State.LiteralStringEscape ||
                    currentState === State.LiteralStringUnicodeEscape) &&
                !isPendingPropertyName()
            ) {
                tryCallBack(props.join("."), currentLiteral, literalDelta);
            }
        }
        literalDelta = "";
    }
    let currentState: State = State.Element;
    const parser = {
        callback,
        parse: (chunk: string) => {
            if (currentState === State.Error) {
                // Short circuit if we are in an error state
                return false;
            }
            for (const c of chunk) {
                currentState = incrParseChar(c, currentState);
                if (currentState === State.Error) {
                    // Short circuit if we are in an error state
                    return false;
                }
            }

            reportStringDelta();
            return true;
        },
        complete: () => {
            if (currentState === State.Error) {
                return false;
            }
            if (currentState === State.End) {
                return true;
            }

            // Flush the last number literal
            if (
                currentState === State.LiteralNumberInteger ||
                currentState === State.LiteralNumberFraction ||
                currentState === State.LiteralNumberExponent
            ) {
                currentState = finishLiteralNumber(" ");
                return currentState === State.End;
            }

            // Finishing in any other state is an error
            currentState = State.Error;
            return false;
        },
    };
    return parser;
}

export type IncrementalJsonParser = ReturnType<
    typeof createIncrementalJsonParser
>;
