// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ASCII spinner animation for showing Claude is thinking
 */
export class Spinner {
    private frames: string[] = [
        "⠋ thinking",
        "⠙ thinking",
        "⠹ thinking",
        "⠸ thinking",
        "⠼ thinking",
        "⠴ thinking",
        "⠦ thinking",
        "⠧ thinking",
        "⠇ thinking",
        "⠏ thinking",
    ];
    private interval: NodeJS.Timeout | null = null;
    private currentFrame = 0;
    private isSpinning = false;

    /**
     * Start the spinner animation
     */
    start(): void {
        if (this.isSpinning) {
            return;
        }

        this.isSpinning = true;
        this.currentFrame = 0;

        // Hide cursor
        process.stdout.write("\x1B[?25l");

        // Show first frame
        process.stdout.write("\x1b[90m" + this.frames[0] + "\x1b[0m");

        this.interval = setInterval(() => {
            this.currentFrame = (this.currentFrame + 1) % this.frames.length;

            // Move cursor to start of line, clear line, write new frame
            process.stdout.write(
                "\r\x1B[K\x1b[90m" + this.frames[this.currentFrame] + "\x1b[0m",
            );
        }, 80); // 80ms for smooth animation
    }

    /**
     * Stop the spinner animation and clear the line
     */
    stop(): void {
        if (!this.isSpinning) {
            return;
        }

        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        // Clear the line and show cursor
        process.stdout.write("\r\x1B[K");
        process.stdout.write("\x1B[?25h");

        this.isSpinning = false;
    }
}
