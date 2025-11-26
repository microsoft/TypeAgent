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
