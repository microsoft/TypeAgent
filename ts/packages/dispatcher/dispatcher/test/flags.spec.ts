// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ObjectValue } from "@typeagent/agent-sdk";
import { parseParams } from "../src/command/parameters.js";

describe("Flag parsing", () => {
    const typeFlags = {
        flags: {
            bool: { description: "testing", type: "boolean" },
            num: { description: "testing", type: "number" },
            str: { description: "testing", type: "string" },
            obj: { description: "testing", type: "json" },
        },
    } as const;
    const o1 = { hello: "str", num: 11, bool: true };
    const o2 = { ...o1, obj: o1, arr: [o1, o1] };
    it("type", () => {
        const params = parseParams("", typeFlags);
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const bool: boolean = flags.bool!; // Use ! to make sure the type is correct
        const num: number = flags.num!; // Use ! to make sure the type is correct
        const str: string = flags.str!; // Use ! to make sure the type is correct
        const obj: ObjectValue = flags.obj!; // Use ! to make sure the type is correct

        expect(bool).toBe(undefined);
        expect(num).toBe(undefined);
        expect(str).toBe(undefined);
        expect(obj).toBe(undefined);
    });
    it("type - with flags", () => {
        const params = parseParams(
            `--bool --num 11 --str world --obj '${JSON.stringify(o2)}'`,
            typeFlags,
        );
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const bool: boolean = flags.bool!;
        const num: number = flags.num!;
        const str: string = flags.str!;
        const obj: ObjectValue = flags.obj!;

        expect(bool).toBe(true);
        expect(num).toBe(11);
        expect(str).toBe("world");
        expect(obj).toStrictEqual(o2);
    });

    const multipleFlags = {
        flags: {
            num: { description: "testing", multiple: true, type: "number" },
            str: { description: "testing", multiple: true, type: "string" },
            obj: { description: "testing", multiple: true, type: "json" },
        },
    } as const;
    it("multiple", () => {
        const params = parseParams("", multipleFlags);
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const num: number[] = flags.num!; // Use ! to make sure the type is correct
        const str: string[] = flags.str!; // Use ! to make sure the type is correct
        const obj: ObjectValue[] = flags.obj!; // Use ! to make sure the type is correct

        expect(num).toBe(undefined);
        expect(str).toBe(undefined);
        expect(obj).toBe(undefined);
    });
    it("multiple - with flag input", () => {
        const params = parseParams(
            `--num 11 --str world --obj '${JSON.stringify(o1)}' --num 12 --str ! --obj '${JSON.stringify(o2)}'`,
            multipleFlags,
        );
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const num: number[] = flags.num!;
        const str: string[] = flags.str!;
        const obj: ObjectValue[] = flags.obj!; // Use ! to make sure the type is correct

        expect(num).toStrictEqual([11, 12]);
        expect(str).toStrictEqual(["world", "!"]);
        expect(obj).toStrictEqual([o1, o2]);
    });

    const typeWithDefaultFlags = {
        flags: {
            bool: { description: "testing", type: "boolean", default: false },
            num: { description: "testing", type: "number", default: 10 },
            str: { description: "testing", type: "string", default: "hello" },
            obj: { description: "testing", type: "json", default: o1 },
        },
    } as const;
    it("type default", () => {
        const params = parseParams("", typeWithDefaultFlags);
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const bool: boolean = flags.bool;
        const num: number = flags.num;
        const str: string = flags.str;
        const obj: object = flags.obj;

        expect(bool).toBe(typeWithDefaultFlags.flags.bool.default);
        expect(num).toBe(typeWithDefaultFlags.flags.num.default);
        expect(str).toBe(typeWithDefaultFlags.flags.str.default);
        expect(obj).toStrictEqual(typeWithDefaultFlags.flags.obj.default);
    });
    it("type default - with flag input", () => {
        const params = parseParams(
            `--bool --num 11 --str world --obj '${JSON.stringify(o2)}'`,
            typeWithDefaultFlags,
        );
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const bool: boolean = flags.bool;
        const num: number = flags.num;
        const str: string = flags.str;
        const obj: object = flags.obj;

        expect(bool).toBe(true);
        expect(num).toBe(11);
        expect(str).toBe("world");
        expect(obj).toStrictEqual(o2);
    });

    const defaultValueFlags = {
        flags: {
            bool: { description: "testing", default: false },
            num: { description: "testing", default: 10 },
            str: { description: "testing", default: "hello" },
            obj: { description: "testing", default: o1 },
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
        const obj: object = flags.obj;
        const defStr: string = flags.defStr!; // Use ! to make sure the type is correct

        expect(bool).toBe(defaultValueFlags.flags.bool.default);
        expect(num).toBe(defaultValueFlags.flags.num.default);
        expect(str).toBe(defaultValueFlags.flags.str.default);
        expect(obj).toStrictEqual(defaultValueFlags.flags.obj.default);
        expect(defStr).toBe(undefined);
    });

    it("default - with flag input", () => {
        const params = parseParams(
            `--bool --num 11 --str world --defStr default --obj '${JSON.stringify(o2)}'`,
            defaultValueFlags,
        );
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const bool: boolean = flags.bool;
        const num: number = flags.num;
        const str: string = flags.str;
        const obj: object = flags.obj;
        const defStr: string = flags.defStr!; // Use ! to make sure the type is correct

        expect(bool).toBe(true);
        expect(num).toBe(11);
        expect(str).toBe("world");
        expect(obj).toStrictEqual(o2);
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
            obj: { description: "testing", multiple: true, default: [o1, o1] },
        },
    } as const;
    it("default multiple", () => {
        const params = parseParams("", defaultMultipleConfig);
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const num: readonly number[] = flags.num;
        const str: readonly string[] = flags.str;
        const obj: readonly object[] = flags.obj;

        expect(num).toStrictEqual(defaultMultipleConfig.flags.num.default);
        expect(str).toStrictEqual(defaultMultipleConfig.flags.str.default);
        expect(obj).toStrictEqual(defaultMultipleConfig.flags.obj.default);
    });
    it("default multiple - with flag input", () => {
        const params = parseParams(
            `--num 11 --str world --obj '${JSON.stringify(o1)}' --num 12 --str ! --obj '${JSON.stringify(o2)}'`,
            defaultMultipleConfig,
        );
        const args: undefined = params.args;
        expect(args).toStrictEqual(undefined);

        const flags = params.flags;
        const num: number[] = flags.num;
        const str: string[] = flags.str;
        const obj: object[] = flags.obj;

        expect(num).toStrictEqual([11, 12]);
        expect(str).toStrictEqual(["world", "!"]);
        expect(obj).toStrictEqual([o1, o2]);
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
