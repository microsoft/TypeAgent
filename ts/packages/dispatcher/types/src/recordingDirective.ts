// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type RecordingDirective = {
    kind: "learn" | "record";
    dev: boolean;
    task: string;
    legacyDevPrefix?: boolean;
};

export function parseRecordingDirective(
    request: string,
): RecordingDirective | undefined {
    const text = request.trimStart();
    const devMatch = text.match(/^dev:\s*/i);
    const dev = devMatch !== null;
    const directiveText = dev ? text.slice(devMatch[0].length) : text;

    const learnMatch = directiveText.match(/^learn:\s*(.*)$/i);
    if (learnMatch) {
        return { kind: "learn", dev, task: learnMatch[1].trim() };
    }

    const rememberMatch = directiveText.match(/^remember how to\s+(.*)$/i);
    if (rememberMatch) {
        return { kind: "learn", dev, task: rememberMatch[1].trim() };
    }

    const recordMatch = directiveText.match(/^record(?::|\s)\s*(.*)$/i);
    if (recordMatch) {
        return { kind: "record", dev, task: recordMatch[1].trim() };
    }

    if (dev && directiveText.trim()) {
        return {
            kind: "record",
            dev: true,
            task: directiveText.trim(),
            legacyDevPrefix: true,
        };
    }

    return undefined;
}
