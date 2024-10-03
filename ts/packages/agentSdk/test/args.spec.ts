// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseCommandArgs } from "../src/helpers/parameterHelpers.js";

describe("Argument parsing", () => {
    const explicitConfig = {
        flags: {
            bool: {
                type: "boolean",
            },
            num: {
                type: "number",
            },
            str: {
                type: "string",
            },
        },
    } as const;
    it("explicit", () => {
        const { args, flags } = parseCommandArgs("", explicitConfig);
        expect(args.length).toEqual(0);
        const bool: boolean = flags.bool!; // Use ! to make sure the type is correct
        const num: number = flags.num!; // Use ! to make sure the type is correct
        const str: string = flags.str!; // Use ! to make sure the type is correct

        expect(bool).toBe(undefined);
        expect(num).toBe(undefined);
        expect(str).toBe(undefined);
    });
    it("explicit - with flags", () => {
        const { args, flags } = parseCommandArgs(
            "--bool --num 11 --str world",
            explicitConfig,
        );
        expect(args.length).toEqual(0);
        const bool: boolean = flags.bool!;
        const num: number = flags.num!;
        const str: string = flags.str!;

        expect(bool).toBe(true);
        expect(num).toBe(11);
        expect(str).toBe("world");
    });

    const explicitMultipleConfig = {
        flags: {
            num: {
                multiple: true,
                type: "number",
            },
            str: {
                multiple: true,
                type: "string",
            },
        },
    } as const;
    it("explicit multiple", () => {
        const { args, flags } = parseCommandArgs("", explicitMultipleConfig);
        expect(args.length).toEqual(0);
        const num: number[] = flags.num!; // Use ! to make sure the type is correct
        const str: string[] = flags.str!; // Use ! to make sure the type is correct

        expect(num).toBe(undefined);
        expect(str).toBe(undefined);
    });
    it("explicit multiple - with flags", () => {
        const { args, flags } = parseCommandArgs(
            "--num 11 --str world --num 12 --str !",
            explicitMultipleConfig,
        );
        expect(args.length).toEqual(0);

        const num: number[] = flags.num!;
        const str: string[] = flags.str!;

        expect(num).toStrictEqual([11, 12]);
        expect(str).toStrictEqual(["world", "!"]);
    });

    const explicitTypeWithDefault = {
        flags: {
            bool: {
                type: "boolean",
                default: false,
            },
            num: {
                type: "number",
                default: 10,
            },
            str: {
                type: "string",
                default: "hello",
            },
        },
    } as const;
    it("explicit default", () => {
        const { args, flags } = parseCommandArgs("", explicitTypeWithDefault);
        expect(args.length).toEqual(0);
        const bool: boolean = flags.bool!; // Use ! to make sure the type is correct
        const num: number = flags.num!; // Use ! to make sure the type is correct
        const str: string = flags.str!; // Use ! to make sure the type is correct

        expect(bool).toBe(explicitTypeWithDefault.flags.bool.default);
        expect(num).toBe(explicitTypeWithDefault.flags.num.default);
        expect(str).toBe(explicitTypeWithDefault.flags.str.default);
    });
    it("explicit default - with flags", () => {
        const { args, flags } = parseCommandArgs(
            "--bool --num 11 --str world",
            explicitTypeWithDefault,
        );
        expect(args.length).toEqual(0);
        const bool: boolean = flags.bool!;
        const num: number = flags.num!;
        const str: string = flags.str!;

        expect(bool).toBe(true);
        expect(num).toBe(11);
        expect(str).toBe("world");
    });

    const defaultValueFlags = {
        flags: {
            bool: false,
            num: 10,
            str: "hello",
            defStr: undefined,
        },
    };
    it("default value", () => {
        const { args, flags } = parseCommandArgs("", defaultValueFlags);
        expect(args.length).toEqual(0);
        const bool: boolean = flags.bool;
        const num: number = flags.num;
        const str: string = flags.str;
        const defStr: string = flags.defStr!; // Use ! to make sure the type is correct

        expect(bool).toBe(defaultValueFlags.flags.bool);
        expect(num).toBe(defaultValueFlags.flags.num);
        expect(str).toBe(defaultValueFlags.flags.str);
        expect(defStr).toBe(defaultValueFlags.flags.defStr);
    });

    it("default value - with flags", () => {
        const { args, flags } = parseCommandArgs(
            "--bool --num 11 --str world --defStr default",
            defaultValueFlags,
        );
        expect(args.length).toEqual(0);
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
            num: {
                multiple: true,
                default: [10, 11],
            },
            str: {
                multiple: true,
                default: ["hello", "world"],
            },
        },
    } as const;
    it("default multiple", () => {
        const { args, flags } = parseCommandArgs("", defaultMultipleConfig);
        expect(args.length).toEqual(0);
        const num: readonly number[] = flags.num!; // Use ! to make sure the type is correct
        const str: readonly string[] = flags.str!; // Use ! to make sure the type is correct

        expect(num).toStrictEqual(defaultMultipleConfig.flags.num.default);
        expect(str).toStrictEqual(defaultMultipleConfig.flags.str.default);
    });
    it("default multiple - with flags", () => {
        const { args, flags } = parseCommandArgs(
            "--num 11 --str world --num 12 --str !",
            explicitMultipleConfig,
        );
        expect(args.length).toEqual(0);

        const num: number[] = flags.num!;
        const str: string[] = flags.str!;

        expect(num).toStrictEqual([11, 12]);
        expect(str).toStrictEqual(["world", "!"]);
    });
});
