import { z } from "zod";

export function formatZodIssues(error: z.ZodError, root = "$"): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.length === 0 ? root : issue.path.join(".");
            return `${path}: ${issue.message}`;
        })
        .join("; ");
}

export function parseJsonText(text: string, label: string): unknown {
    try {
        return JSON.parse(text) as unknown;
    } catch (error) {
        throw new Error(
            `${label} invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

export function parseWithZod<T>(
    schema: z.ZodType<T>,
    value: unknown,
    label: string,
): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
        throw new Error(`${label}: ${formatZodIssues(parsed.error)}`);
    }
    return parsed.data;
}

export function parseJsonWithZod<T>(
    text: string,
    schema: z.ZodType<T>,
    label: string,
): T {
    return parseWithZod(schema, parseJsonText(text, label), label);
}

// Resolve a concrete Zod schema from a versioned registry map.
export function resolveVersionedSchema<T>(
    registry: Readonly<Record<number, z.ZodType<T>>>,
    version: number,
    label: string,
): z.ZodType<T> {
    const schema = registry[version];
    if (schema === undefined) {
        const supported = Object.keys(registry)
            .map(Number)
            .sort((a, b) => a - b)
            .join(", ");
        throw new Error(
            `${label} unsupported version ${version}; supported: ${supported || "(none)"}`,
        );
    }
    return schema;
}

export function parseVersionedWithZod<T>(
    value: unknown,
    registry: Readonly<Record<number, z.ZodType<T>>>,
    label: string,
    versionKey: string = "version",
): T {
    const envelope = z
        .object({ [versionKey]: z.number().int().positive() })
        .passthrough()
        .safeParse(value);
    if (!envelope.success) {
        throw new Error(`${label}: ${formatZodIssues(envelope.error)}`);
    }
    const version = envelope.data[versionKey] as number;
    return parseWithZod(
        resolveVersionedSchema(registry, version, label),
        value,
        `${label} v${version}`,
    );
}
