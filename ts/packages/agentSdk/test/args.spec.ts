// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseParams } from "../src/helpers/parameterHelpers.js";

describe("Argument parsing", () => {
    const parameters = {
        args: {
            num: {
                description: "number",
                type: "number",
            },
            str: {
                description: "string",
                type: "string",
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
        const params = parseParams("10 \t hello   world !", parameters);
        const flags: undefined = params.flags;
        expect(flags).toBe(undefined);

        const args = params.args;
        const num: number = args.num;
        const str: string = args.str;
        const defStr: string = args.defStr;
        const optional: string = args.optional!; // Use ! to make sure the type is correct
        const optional2: string = args.optional2!; // Use ! to make sure the type is correct
        expect(num).toBe(10);
        expect(str).toBe("hello");
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
    it("Too many args", () => {
        try {
            parseParams("10 \t hello   world invalid", parameters);
        } catch (e: any) {
            expect(e.message).toBe("Too many arguments 'invalid'");
        }
    });
    it("Missing args", () => {
        try {
            parseParams("10", parameters);
        } catch (e: any) {
            expect(e.message).toBe("Missing argument 'str'");
        }
    });
    it("Invalid value", () => {
        try {
            parseParams("abc hello world", parameters);
        } catch (e: any) {
            expect(e.message).toBe(
                "Invalid number value 'abc' for argument 'num'",
            );
        }
    });
});
