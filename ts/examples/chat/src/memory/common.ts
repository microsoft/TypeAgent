import { ArgDef } from "interactive-app";

export function argSourceFile(defaultValue?: string | undefined): ArgDef {
    return {
        description: "Path to source file",
        type: "path",
        defaultValue,
    };
}
export function argDestFile(defaultValue?: string | undefined): ArgDef {
    return {
        description: "Path to output file",
        type: "path",
        defaultValue,
    };
}
