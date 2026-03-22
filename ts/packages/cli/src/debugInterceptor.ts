// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import chalk from "chalk";

const DEBUG_GUTTER = chalk.dim("  │ ");
const DEBUG_GUTTER_CONT = chalk.dim("  │   ");
const DEBUG_GUTTER_LAST = chalk.dim("  … ");
const GUTTER_WIDTH = 4; // "  │ " visible chars
const CONT_INDENT = 6; // "  │   " visible chars
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
let originalStderrWrite: typeof process.stderr.write | null = null;

// Patterns to silently drop from stderr output.
const SUPPRESSED_STDERR_PATTERNS = [
    /\[DEP0190\]/,
    /Use `node --trace-deprecation \.\.\.` to show where the warning was created/,
];

type ActiveSpinner = {
    isActive(): boolean;
    writeAbove(content: string): void;
};
let getSpinner: (() => ActiveSpinner | null) | null = null;

export function setSpinnerAccessor(fn: () => ActiveSpinner | null): void {
    getSpinner = fn;
}

export type PromptRenderer = {
    /** Number of screen rows the prompt occupies (input + rule + hint) */
    rows(): number;
    /** Redraw the prompt at the current cursor position */
    redraw(): void;
};

const VISIBLE_LINES = 4;

/**
 * Soft-wrap a debug line into multiple screen rows with continuation indent.
 * Returns the wrapped output string and the number of screen rows it occupies.
 */
function wrapDebugLine(
    line: string,
    termWidth: number,
): { output: string; rows: number } {
    const stripped = line.replace(ANSI_RE, "");
    const firstLineMax = termWidth - GUTTER_WIDTH;

    if (stripped.length <= firstLineMax) {
        return {
            output: DEBUG_GUTTER + chalk.dim(stripped),
            rows: 1,
        };
    }

    const contLineMax = termWidth - CONT_INDENT;
    const parts: string[] = [];

    // First row gets the normal gutter
    parts.push(DEBUG_GUTTER + chalk.dim(stripped.substring(0, firstLineMax)));
    let offset = firstLineMax;

    // Continuation rows get deeper indent
    while (offset < stripped.length) {
        const chunk = stripped.substring(offset, offset + contLineMax);
        parts.push(DEBUG_GUTTER_CONT + chalk.dim(chunk));
        offset += contLineMax;
    }

    return {
        output: parts.join("\n"),
        rows: parts.length,
    };
}

/**
 * Collapsible debug output panel with ring buffer.
 *
 * Collapsed (default): shows last N debug lines + summary line, rendered
 * in-place above the spinner. Updates as new lines arrive.
 * Hooks spinner.writeAbove so external writes (agent output) don't
 * corrupt the panel's cursor tracking.
 *
 * Expanded: flushes the full buffer above the spinner so all lines
 * scroll naturally; new lines continue streaming above spinner.
 */
export class DebugPanel {
    private buffer: string[] = [];
    private capacity: number;
    private expanded = false;
    private stream: NodeJS.WriteStream;
    private flushedCount = 0;
    // Track actual screen rows rendered (accounts for wrapped lines)
    private panelRowCount = 0;

    // Spinner hook state
    private hookedSpinnerRef: ActiveSpinner | null = null;
    private originalWriteAbove: ((content: string) => void) | null = null;
    private rendering = false;

    // Prompt hook — when set, debug output renders above the prompt
    private promptRenderer: PromptRenderer | null = null;

    constructor(capacity = 200, stream?: NodeJS.WriteStream) {
        this.capacity = capacity;
        this.stream = stream ?? process.stdout;
    }

    get lineCount(): number {
        return this.buffer.length;
    }

    get isExpanded(): boolean {
        return this.expanded;
    }

    setPromptRenderer(renderer: PromptRenderer | null): void {
        this.promptRenderer = renderer;
    }

    push(line: string): void {
        if (this.buffer.length >= this.capacity) {
            this.buffer.shift();
            if (this.flushedCount > 0) this.flushedCount--;
        }
        this.buffer.push(line);

        const spinner = getSpinner?.();
        const termWidth = this.stream.columns || 120;
        const { output } = wrapDebugLine(line, termWidth);

        if (spinner?.isActive()) {
            if (this.expanded) {
                this.writeAboveRaw(output);
                this.flushedCount = this.buffer.length;
            } else {
                this.ensureHooked();
                this.renderCollapsed();
            }
        } else if (this.promptRenderer) {
            // At the prompt — silently buffer; user can Ctrl+D to review
        } else {
            // No spinner, no prompt — render immediately
            this.stream.write(output + "\n");
            this.flushedCount = this.buffer.length;
        }
    }

    toggle(): void {
        this.expanded = !this.expanded;
        if (this.expanded) {
            this.clearPanelRows();
            this.flushBuffer();
        } else {
            this.flushedCount = 0;
            this.ensureHooked();
            this.renderCollapsed();
        }
    }

    reset(): void {
        this.clearPanelRows();
        this.unhookSpinner();
        this.buffer = [];
        this.expanded = false;
        this.flushedCount = 0;
    }

    /**
     * Stop live rendering (clear panel from screen, unhook spinner)
     * but preserve the buffer so it can be dumped later.
     */
    stopRendering(): void {
        this.clearPanelRows();
        this.unhookSpinner();
        this.expanded = false;
        this.flushedCount = 0;
    }

    /**
     * Write a static collapsed summary to stdout (not in-place updatable).
     * Used after command completes to show last N lines + expand hint.
     */
    renderStaticSummary(): void {
        if (this.buffer.length === 0) return;

        const termWidth = this.stream.columns || 120;
        const tail = this.buffer.slice(-VISIBLE_LINES);
        const hidden = this.buffer.length - tail.length;

        for (const entry of tail) {
            const { output } = wrapDebugLine(entry, termWidth);
            this.stream.write(output + "\n");
        }

        const hiddenText =
            hidden > 0 ? `+${hidden} lines` : `${this.buffer.length} lines`;
        this.stream.write(
            DEBUG_GUTTER_LAST +
                chalk.dim(`${hiddenText} (ctrl+d to expand)`) +
                "\n",
        );
    }

    /**
     * Dump the entire buffer to stdout. Used when user presses ctrl+d
     * after command completes.
     */
    dumpBuffer(): void {
        if (this.buffer.length === 0) return;
        const termWidth = this.stream.columns || 120;
        for (const entry of this.buffer) {
            const { output } = wrapDebugLine(entry, termWidth);
            this.stream.write(output + "\n");
        }
    }

    private ensureHooked(): void {
        const spinner = getSpinner?.();
        if (!spinner || spinner === this.hookedSpinnerRef) return;

        this.unhookSpinner();

        this.hookedSpinnerRef = spinner;
        this.originalWriteAbove = spinner.writeAbove.bind(spinner);

        const self = this;
        const origFn = this.originalWriteAbove;
        (spinner as any).writeAbove = (content: string) => {
            if (self.rendering || self.expanded) {
                origFn(content);
                return;
            }
            self.clearPanelRows();
            origFn(content);
            if (self.buffer.length > 0) {
                self.renderCollapsed();
            }
        };
    }

    private unhookSpinner(): void {
        if (this.hookedSpinnerRef && this.originalWriteAbove) {
            (this.hookedSpinnerRef as any).writeAbove = this.originalWriteAbove;
        }
        this.hookedSpinnerRef = null;
        this.originalWriteAbove = null;
    }

    private writeAboveRaw(content: string): void {
        const fn = this.originalWriteAbove;
        if (fn) {
            fn(content);
        } else {
            const spinner = getSpinner?.();
            if (spinner?.isActive()) {
                spinner.writeAbove(content);
            } else {
                this.stream.write(content + "\n");
            }
        }
    }

    private renderCollapsed(): void {
        const spinner = getSpinner?.();
        if (!spinner?.isActive() || this.rendering) return;

        this.rendering = true;
        try {
            // Clear spinner line
            this.stream.write("\r\x1b[2K");

            // Erase previously rendered screen rows
            for (let i = 0; i < this.panelRowCount; i++) {
                this.stream.write("\x1b[1A\x1b[2K");
            }

            const termWidth = this.stream.columns || 120;
            const total = this.buffer.length;
            const tail = this.buffer.slice(-VISIBLE_LINES);
            const hidden = total - tail.length;

            let totalRows = 0;
            for (const entry of tail) {
                const { output, rows } = wrapDebugLine(entry, termWidth);
                this.stream.write(output + "\n");
                totalRows += rows;
            }

            // Summary line (always fits in one row)
            const hiddenText =
                hidden > 0 ? `+${hidden} lines` : `${total} lines`;
            this.stream.write(
                DEBUG_GUTTER_LAST +
                    chalk.dim(`${hiddenText} (ctrl+d to expand)`) +
                    "\n",
            );
            totalRows += 1;

            this.panelRowCount = totalRows;
        } finally {
            this.rendering = false;
        }
    }

    private clearPanelRows(): void {
        if (this.panelRowCount === 0) return;
        const spinner = getSpinner?.();
        if (!spinner?.isActive()) {
            this.panelRowCount = 0;
            return;
        }

        this.stream.write("\r\x1b[2K");
        for (let i = 0; i < this.panelRowCount; i++) {
            this.stream.write("\x1b[1A\x1b[2K");
        }
        this.panelRowCount = 0;
    }

    private flushBuffer(): void {
        const termWidth = this.stream.columns || 120;
        for (let i = this.flushedCount; i < this.buffer.length; i++) {
            const { output } = wrapDebugLine(this.buffer[i], termWidth);
            this.writeAboveRaw(output);
        }
        this.flushedCount = this.buffer.length;
    }
}

let debugPanel: DebugPanel | null = null;

export function getDebugPanel(): DebugPanel | null {
    return debugPanel;
}

function isSuppressed(line: string): boolean {
    const stripped = line.replace(ANSI_RE, "");
    return SUPPRESSED_STDERR_PATTERNS.some((re) => re.test(stripped));
}

export function installDebugInterceptor(): void {
    if (originalStderrWrite) return;
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    debugPanel = new DebugPanel();

    process.stderr.write = ((chunk: any) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString();
        const lines = text.split("\n").filter(Boolean);
        for (const line of lines) {
            if (!isSuppressed(line)) {
                debugPanel!.push(line);
            }
        }
        return true;
    }) as typeof process.stderr.write;
}

export function removeDebugInterceptor(): void {
    if (originalStderrWrite) {
        process.stderr.write = originalStderrWrite;
        originalStderrWrite = null;
    }
    if (debugPanel) {
        debugPanel.reset();
        debugPanel = null;
    }
}
