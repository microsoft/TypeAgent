// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";

export function getElapsedString(elapsedMs: number, showParts = true) {
    const seconds = elapsedMs / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(3)}s`;
    }
    const minutes = showParts ? Math.floor(seconds / 60) : 0;
    const hours = Math.floor(minutes / 60);
    const hourStr = hours > 0 ? `${hours}h ` : "";
    const minuteStr =
        minutes > 0 ? `${Math.floor(minutes - hours * 60)}m ` : "";
    const secondStr = `${
        minutes > 0 ? Math.floor(seconds - minutes * 60) : seconds.toFixed(3)
    }s`;
    return `${hourStr}${minuteStr}${secondStr}`;
}

export function getColorElapsedString(elapsedMs: number) {
    return chalk.greenBright(`[${getElapsedString(elapsedMs)}]`);
}

/**
 * Print a record in columns
 * @param record record to print
 * @param sort true if keys should be sorted
 */
export function printRecord(
    record: Record<string, any>,
    title?: string,
    sort: boolean = false,
    minKeyColWidth = 16,
): void {
    if (title) {
        console.log(chalk.underline(chalk.bold(title)));
    }
    const keys = Object.keys(record);
    if (sort) {
        keys.sort();
    }
    let maxLength = getMaxLength(keys);
    if (maxLength < minKeyColWidth) {
        maxLength = minKeyColWidth;
    }
    for (const key of keys) {
        let value = record[key];
        let label = value !== undefined ? value.label : undefined;
        if (!label) {
            label = key;
        }
        let text = valueToString(value);
        printField(label, text, maxLength);
    }
    return;

    function getMaxLength(values: string[]): number {
        let maxLength = 0;
        values.forEach((v) => {
            maxLength = v.length > maxLength ? v.length : maxLength;
        });
        return maxLength;
    }

    function printField(
        name: string,
        value: any,
        paddedNameLength?: number,
    ): void {
        const paddedName = paddedNameLength
            ? name.padEnd(paddedNameLength)
            : name;
        console.log(`${paddedName}  ${value}`);
    }
}

export function valueToString(value: any): string {
    let text;
    if (value === undefined) {
        text = "?";
    } else if (typeof value === "string") {
        text = value;
    } else if (Array.isArray(value)) {
        text = "";
        for (const item of value) {
            if (text.length > 0) {
                text += "\n";
            }
            text += valueToString(item);
        }
    } else if (typeof value === "object") {
        const textValue = value["value"];
        text = textValue ? textValue : JSON.stringify(value);
    } else {
        text = value.toString();
    }
    return text;
}

export function printRecordAsHtml(
    record: Record<string, any>,
    title?: string,
    sort: boolean = false,
    cellPadding: number = 5,
): string {
    const keys = Object.keys(record);
    if (sort) {
        keys.sort();
    }
    let rows = "";
    for (const key of keys) {
        let value = record[key];
        let label = value !== undefined ? value.label : undefined;
        if (!label) {
            label = key;
        }
        let text = valueToString(value);
        rows += `<tr><td>${label}</td><td>${text}</td></tr>`;
    }
    const style = "border: 1px solid lightgray; border-collapse: collapse;";
    if (title) {
        return `
        <div>
        <div><b>${title}</b></div>
        <table cellPadding="${cellPadding}" border="1" style="${style}">${rows}</table>
        </div>`;
    }
    return `
    <div>
    <table cellPadding="${cellPadding}" border="1" style="${style}">${rows}</table>
    </div>`;
}
