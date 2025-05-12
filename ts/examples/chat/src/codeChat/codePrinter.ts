// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { InteractiveIo } from "interactive-app";
import { MemoryConsoleWriter } from "../memoryWriter.js";
import {
    BreakPointSuggestions,
    Breakpoint,
    Bug,
    CodeAnswer,
    CodeDocumentation,
    CodeReview,
    LineDoc,
    LineReview,
    RelevantLine,
} from "code-processor";
import chalk from "chalk";
import { pathToFileURL } from "url";

export class CodePrinter extends MemoryConsoleWriter {
    constructor(io: InteractiveIo) {
        super(io);
    }

    public writeCode(lines: string | string[]): void {
        if (typeof lines === "string") {
            this.writeInColor(chalk.cyanBright, lines);
        } else {
            this.writeCodeLines(lines);
        }
    }

    public writeCodeLines(lines: string[]): void {
        for (let i = 0; i < lines.length; ++i) {
            this.writeCodeLine(i + 1, lines[i]);
        }
    }

    public writeCodeLine(lineNumber: number, line: string): void {
        this.write(`${lineNumber} `);
        this.writeInColor(chalk.cyanBright, line);
    }

    public writeBug(bug: Bug) {
        this.writeInColor(
            chalk.redBright,
            `⚠️ ${bug.severity}: ${bug.comment}`,
        );
    }

    public writeComment(comment: LineReview) {
        this.writeInColor(
            chalk.white,
            `💬 ${comment.severity}: ${comment.comment}`,
        );
    }

    public writeBreakpoint(breakpoint: Breakpoint) {
        this.writeInColor(
            chalk.redBright,
            `🛑 ${breakpoint.priority}: ${breakpoint.comment}`,
        );
    }

    public writeRelevantLine(line: RelevantLine) {
        this.writeInColor(
            chalk.redBright,
            `💡 ${line.relevance}: ${line.comment}`,
        );
    }

    public writeDocLine(line: LineDoc) {
        this.writeInColor(chalk.greenBright, `✍🏼 ${line.comment}`);
    }

    public writeCodeReview(
        line: string,
        lineNumber: number,
        review: CodeReview,
    ): void {
        if (review.bugs) {
            const bug = review.bugs.find((b) => b.lineNumber === lineNumber);
            if (bug) {
                this.writeBug(bug);
            }
        }

        if (review.comments) {
            const comment = review.comments.find(
                (c) => c.lineNumber === lineNumber,
            );
            if (comment) {
                this.writeComment(comment);
            }
        }
    }

    public writeBreakpoints(
        line: string,
        lineNumber: number,
        review: BreakPointSuggestions,
    ): void {
        if (review.breakPoints) {
            const breakpoint = review.breakPoints.find(
                (b) => b.lineNumber === lineNumber,
            );
            if (breakpoint) {
                this.writeBreakpoint(breakpoint);
            }
        }
    }

    public writeAnswer(
        line: string,
        lineNumber: number,
        answer: CodeAnswer,
    ): void {
        if (answer.answerLines) {
            const relevantLine = answer.answerLines.find(
                (l) => l.lineNumber === lineNumber,
            );
            if (relevantLine) {
                this.writeRelevantLine(relevantLine);
            }
        }
    }

    public writeDocs(
        line: string,
        lineNumber: number,
        docs: CodeDocumentation,
    ): void {
        if (docs.comments) {
            const relevantLine = docs.comments.find(
                (l) => l.lineNumber === lineNumber,
            );
            if (relevantLine) {
                this.writeDocLine(relevantLine);
            }
        }
    }

    public writeAllDocs(lines: string[], docs: CodeDocumentation): void {
        for (let i = 0; i < lines.length; ++i) {
            this.writeDocs(lines[i], i + 1, docs);
            this.writeCodeLine(i + 1, lines[i]);
        }
    }

    public writeFullCodeReview(
        lines: string[],
        review: CodeReview,
        showTitle: boolean = true,
    ): void {
        if (showTitle) {
            this.writeHeading("\nCODE REVIEW\n");
        }
        for (let i = 0; i < lines.length; ++i) {
            this.writeCodeReview(lines[i], i + 1, review);
            this.writeCodeLine(i + 1, lines[i]);
        }
    }

    public writeSourceLink(sourcePath: string | undefined): void {
        if (sourcePath) {
            this.writeInColor(
                chalk.blueBright,
                pathToFileURL(sourcePath).toString(),
            );
        }
    }

    public writeScore(score: number): void {
        this.writeInColor(chalk.green, `[${score}]`);
    }

    public writeTimestamp(timestamp?: Date): void {
        if (timestamp) {
            this.writeInColor(chalk.gray, timestamp.toString());
        }
    }
}
