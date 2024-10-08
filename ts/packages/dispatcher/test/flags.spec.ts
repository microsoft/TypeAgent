// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseParams } from "../src/dispatcher/parameters.js";

describe("Flag parsing", () => {
    const typeFlags = {
        flags: {
            bool: { description: "testing", type: "boolean" },
            num: { description: "testing", type: "number" },
            str: { description: "testing", type: "string" },
        },
    } as const;
    it("type", () => {
        const params = parseParams("", typeFlags);
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const bool: boolean = flags.bool!; // Use ! to make sure the type is correct
        const num: number = flags.num!; // Use ! to make sure the type is correct
        const str: string = flags.str!; // Use ! to make sure the type is correct

        expect(bool).toBe(undefined);
        expect(num).toBe(undefined);
        expect(str).toBe(undefined);
    });
    it("type - with flags", () => {
        const params = parseParams("--bool --num 11 --str world", typeFlags);
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const bool: boolean = flags.bool!;
        const num: number = flags.num!;
        const str: string = flags.str!;

        expect(bool).toBe(true);
        expect(num).toBe(11);
        expect(str).toBe("world");
    });

    const multipleFlags = {
        flags: {
            num: { description: "testing", multiple: true, type: "number" },
            str: { description: "testing", multiple: true, type: "string" },
        },
    } as const;
    it("multiple", () => {
        const params = parseParams("", multipleFlags);
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const num: number[] = flags.num!; // Use ! to make sure the type is correct
        const str: string[] = flags.str!; // Use ! to make sure the type is correct

        expect(num).toBe(undefined);
        expect(str).toBe(undefined);
    });
    it("multiple - with flag input", () => {
        const params = parseParams(
            "--num 11 --str world --num 12 --str !",
            multipleFlags,
        );
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const num: number[] = flags.num!;
        const str: string[] = flags.str!;

        expect(num).toStrictEqual([11, 12]);
        expect(str).toStrictEqual(["world", "!"]);
    });

    const typeWithDefaultFlags = {
        flags: {
            bool: { description: "testing", type: "boolean", default: false },
            num: { description: "testing", type: "number", default: 10 },
            str: { description: "testing", type: "string", default: "hello" },
        },
    } as const;
    it("type default", () => {
        const params = parseParams("", typeWithDefaultFlags);
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const bool: boolean = flags.bool!; // Use ! to make sure the type is correct
        const num: number = flags.num!; // Use ! to make sure the type is correct
        const str: string = flags.str!; // Use ! to make sure the type is correct

        expect(bool).toBe(typeWithDefaultFlags.flags.bool.default);
        expect(num).toBe(typeWithDefaultFlags.flags.num.default);
        expect(str).toBe(typeWithDefaultFlags.flags.str.default);
    });
    it("type default - with flag input", () => {
        const params = parseParams(
            "--bool --num 11 --str world",
            typeWithDefaultFlags,
        );
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const bool: boolean = flags.bool!;
        const num: number = flags.num!;
        const str: string = flags.str!;

        expect(bool).toBe(true);
        expect(num).toBe(11);
        expect(str).toBe("world");
    });

    const defaultValueFlags = {
        flags: {
            bool: { description: "testing", default: false },
            num: { description: "testing", default: 10 },
            str: { description: "testing", default: "hello" },
            defStr: { description: "testing" },
        },
    } as const;
    it("default", () => {
        const params = parseParams("", defaultValueFlags);
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const bool: boolean = flags.bool;
        const num: number = flags.num;
        const str: string = flags.str;
        const defStr: string = flags.defStr!; // Use ! to make sure the type is correct

        expect(bool).toBe(defaultValueFlags.flags.bool.default);
        expect(num).toBe(defaultValueFlags.flags.num.default);
        expect(str).toBe(defaultValueFlags.flags.str.default);
        expect(defStr).toBe(undefined);
    });

    it("default - with flag input", () => {
        const params = parseParams(
            "--bool --num 11 --str world --defStr default",
            defaultValueFlags,
        );
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const bool: boolean = flags.bool;
        const num: number = flags.num;
        const str: string = flags.str;
        const defStr: string = flags.defStr!; // Use ! to make sure the type is correct

        expect(bool).toBe(true);
        expect(num).toBe(11);
        expect(str).toBe("world");
        expect(defStr).toBe("default");
    });
    const defaultMultipleConfig = {
        flags: {
            num: { description: "testing", multiple: true, default: [10, 11] },
            str: {
                description: "testing",
                multiple: true,
                default: ["hello", "world"],
            },
        },
    } as const;
    it("default multiple", () => {
        const params = parseParams("", defaultMultipleConfig);
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const num: readonly number[] = flags.num!; // Use ! to make sure the type is correct
        const str: readonly string[] = flags.str!; // Use ! to make sure the type is correct

        expect(num).toStrictEqual(defaultMultipleConfig.flags.num.default);
        expect(str).toStrictEqual(defaultMultipleConfig.flags.str.default);
    });
    it("default multiple - with flag input", () => {
        const params = parseParams(
            "--num 11 --str world --num 12 --str !",
            multipleFlags,
        );
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const num: number[] = flags.num!;
        const str: string[] = flags.str!;

        expect(num).toStrictEqual([11, 12]);
        expect(str).toStrictEqual(["world", "!"]);
    });

    it("Invalid flag", () => {
        try {
            parseParams("--invalid", typeFlags);
        } catch (e: any) {
            expect(e.message).toStrictEqual("Invalid flag '--invalid'");
        }
    });
    it("Missing value", () => {
        try {
            parseParams("--num", typeFlags);
        } catch (e: any) {
            expect(e.message).toStrictEqual("Missing value for flag '--num'");
        }
    });
    it("Invalid value", () => {
        try {
            parseParams("--num abc", typeFlags);
        } catch (e: any) {
            expect(e.message).toStrictEqual(
                "Invalid number value 'abc' for flag '--num'",
            );
        }
    });
    it("Invalid alias", () => {
        try {
            parseParams("-n abc", typeFlags);
        } catch (e: any) {
            expect(e.message).toStrictEqual("Invalid flag '-n'");
        }
    });

    it("Duplicate flags", () => {
        try {
            parseParams("--num 10 --num 11", typeFlags);
        } catch (e: any) {
            expect(e.message).toStrictEqual("Duplicate flag '--num'");
        }
    });
});
