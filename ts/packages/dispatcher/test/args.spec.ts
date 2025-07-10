// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ObjectValue } from "@typeagent/agent-sdk";
import { parseParams } from "../src/command/parameters.js";

describe("Argument parsing", () => {
    const parameters = {
        args: {
            obj: {
                description: "json",
                type: "json",
            },
            num: {
                description: "number",
                type: "number",
            },
            str: {
                description: "string",
                type: "string",
            },
            bool: {
                description: "boolean",
                type: "boolean",
            },
            defStr: {
                description: "default string",
            },
            optional: {
                description: "optional",
                optional: true,
            },
            optional2: {
                description: "optional2",
                optional: true,
            },
        },
    } as const;
    it("arguments", () => {
        const l1 = {
            hello: "str",
            num: 11,
            bool: true,
        };
        const l2 = {
            ...l1,
            obj: l1,
            arr: [l1, l1],
        };
        const params = parseParams(
            `'${JSON.stringify(l2)}' 10 \t hello 1  world !`,
            parameters,
        );
        const flags: undefined = params.flags;
        expect(flags).toBe(undefined);

        const args = params.args;
        const obj: ObjectValue = args.obj;
        const num: number = args.num;
        const str: string = args.str;
        const bool: boolean = args.bool;
        const defStr: string = args.defStr;
        const optional: string = args.optional!; // Use ! to make sure the type is correct
        const optional2: string = args.optional2!; // Use ! to make sure the type is correct
        expect(obj).toStrictEqual(l2);
        expect(num).toBe(10);
        expect(str).toBe("hello");
        expect(bool).toBe(true);
        expect(defStr).toBe("world");
        expect(optional).toBe("!");
        expect(optional2).toBe(undefined);
    });
    const multipleArgs = {
        args: {
            single: {
                description: "single",
            },
            multiple: {
                description: "multiple",
                multiple: true,
            },
        },
    } as const;
    it("arguments - multiple", () => {
        const params = parseParams("hello world again !", multipleArgs);
        const flags: undefined = params.flags;
        expect(flags).toBe(undefined);

        const args = params.args;
        const single: string = args.single;
        const multiple: string[] = args.multiple;
        expect(single).toBe("hello");
        expect(multiple).toStrictEqual(["world", "again", "!"]);
    });
    it("arguments - multiple boolean value", () => {
        const params = parseParams("true false 1 0 tRue False", {
            args: {
                bool: {
                    description: "boolean",
                    type: "boolean",
                    multiple: true,
                },
            },
        });
        expect(params.args.bool).toStrictEqual([
            true,
            false,
            true,
            false,
            true,
            false,
        ]);
    });
    it("arguments - multiple terminate", () => {
        const params = parseParams("hello world ! -- again", {
            args: {
                multiple: {
                    description: "multiple",
                    multiple: true,
                },
                single: {
                    description: "single",
                },
            },
        });
        const flags: undefined = params.flags;
        expect(flags).toBe(undefined);

        const args = params.args;
        const multiple: string[] = args.multiple;
        const single: string = args.single;
        expect(multiple).toStrictEqual(["hello", "world", "!"]);
        expect(single).toBe("again");
    });
    const optionalMultipleArgs = {
        args: {
            single: {
                description: "single",
                optional: true,
            },
            multiple: {
                description: "multiple",
                multiple: true,
                optional: true,
            },
        },
    } as const;
    it("arguments - optional multiple - no args", () => {
        const params = parseParams("", optionalMultipleArgs);
        const flags: undefined = params.flags;
        expect(flags).toBe(undefined);

        const args = params.args;
        const single: string = args.single!; // Use ! to make sure the type is correct
        const multiple: string[] = args.multiple!; // Use ! to make sure the type is correct
        expect(single).toBe(undefined);
        expect(multiple).toBe(undefined);
    });
    it("arguments - optional multiple - single args", () => {
        const params = parseParams(" hello", optionalMultipleArgs);
        const flags: undefined = params.flags;
        expect(flags).toBe(undefined);

        const args = params.args;
        const single: string = args.single!; // Use ! to make sure the type is correct
        const multiple: string[] = args.multiple!; // Use ! to make sure the type is correct
        expect(single).toBe("hello");
        expect(multiple).toBe(undefined);
    });
    it("arguments - optional multiple - multiple args", () => {
        const params = parseParams(" hello   world", optionalMultipleArgs);
        const flags: undefined = params.flags;
        expect(flags).toBe(undefined);

        const args = params.args;
        const single: string = args.single!; // Use ! to make sure the type is correct
        const multiple: string[] = args.multiple!; // Use ! to make sure the type is correct
        expect(single).toBe("hello");
        expect(multiple).toStrictEqual(["world"]);
    });

    const implicitQuoteArgs = {
        args: {
            implicit: {
                description: "implicit",
                implicitQuotes: true,
            },
        },
    };
    it("implicit quote arguments", () => {
        const params = parseParams(" hello   world  ", implicitQuoteArgs);
        const flags: undefined = params.flags;
        expect(flags).toBe(undefined);

        const args = params.args;
        const implicit: string = args.implicit;
        expect(implicit).toBe("hello   world");
    });
    it("Too many args", () => {
        try {
            parseParams("{} 10 \t hello 1  world invalid", parameters);
        } catch (e: any) {
            expect(e.message).toBe("Too many arguments 'invalid'");
        }
    });
    it("Missing args", () => {
        try {
            parseParams("{} 10", parameters);
        } catch (e: any) {
            expect(e.message).toBe("Missing argument 'str'");
        }
    });
    it("Invalid number value", () => {
        try {
            parseParams("{} abc hello 1  world", parameters);
        } catch (e: any) {
            expect(e.message).toBe(
                "Invalid number value 'abc' for argument 'num'",
            );
        }
    });

    it("Invalid boolean value", () => {
        try {
            parseParams("{} 10 hello falsy world", parameters);
        } catch (e: any) {
            expect(e.message).toBe(
                "Invalid boolean value 'falsy' for argument 'bool'",
            );
        }
    });

    const invalidJsonTests = [10, [], null, true, false, "hello"];
    it.each(invalidJsonTests)("Invalid json value - %s", (value) => {
        try {
            parseParams(
                `'${JSON.stringify(value)}' 10 hello 1  world`,
                parameters,
            );
        } catch (e: any) {
            expect(e.message).toBe(
                "Invalid JSON value for argument 'obj': Not an object",
            );
        }
    });
});
