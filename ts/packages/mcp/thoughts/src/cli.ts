#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ThoughtsProcessor } from "./thoughtsProcessor.js";
import { transcribeWavFile } from "./audioTranscriber.js";
import * as fs from "fs";
import * as path from "path";

interface CliOptions {
    input?: string; // Input file path or "-" for stdin
    output?: string; // Output file path or "-" for stdout
    instructions?: string; // Additional formatting instructions
    model?: string; // Claude model to use
    help?: boolean;
}

function parseArgs(): CliOptions {
    const args = process.argv.slice(2);
    const options: CliOptions = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case "-i":
            case "--input":
                options.input = args[++i];
                break;
            case "-o":
            case "--output":
                options.output = args[++i];
                break;
            case "--instructions":
            case "--instruct":
                options.instructions = args[++i];
                break;
            case "-m":
            case "--model":
                options.model = args[++i];
                break;
            case "-h":
            case "--help":
                options.help = true;
                break;
            default:
                // If not a flag and no input set, treat as input file
                if (!arg.startsWith("-") && !options.input) {
                    options.input = arg;
                }
                break;
        }
    }

    return options;
}

function printHelp() {
    console.log(`
thoughts - Convert raw text or audio into well-formatted markdown

Usage: thoughts [options] [input-file]

Options:
  -i, --input <file>         Input file (text or .wav, or "-" for stdin, default: stdin)
  -o, --output <file>        Output file (or "-" for stdout, default: stdout)
  --instructions <text>      Additional formatting instructions
                             Examples: "Create a technical document"
                                       "Format as meeting notes"
                                       "Organize as a blog post"
  -m, --model <model>        Claude model to use
                             Default: claude-sonnet-4-20250514
  -h, --help                 Show this help message

Environment Variables:
  OPENAI_API_KEY             OpenAI API key for audio transcription

Examples:
  # Read from stdin, write to stdout
  echo "my raw thoughts here" | thoughts

  # Read from text file, write to stdout
  thoughts notes.txt

  # Transcribe audio file and convert to markdown
  thoughts recording.wav -o output.md

  # Read from file, write to output file
  thoughts -i notes.txt -o output.md

  # With custom instructions
  thoughts notes.txt -o output.md --instructions "Format as a technical document"

  # Using pipe
  cat stream_of_consciousness.txt | thoughts > organized.md
`);
}

async function readInput(inputPath?: string): Promise<string> {
    if (!inputPath || inputPath === "-") {
        // Read from stdin
        return new Promise((resolve, reject) => {
            let data = "";
            process.stdin.setEncoding("utf8");
            process.stdin.on("data", (chunk) => {
                data += chunk;
            });
            process.stdin.on("end", () => {
                resolve(data);
            });
            process.stdin.on("error", reject);
        });
    } else {
        // Check if this is a WAV file
        if (inputPath.toLowerCase().endsWith(".wav")) {
            console.error("Transcribing audio file...");
            const result = await transcribeWavFile({
                wavFilePath: inputPath,
            });
            console.error(
                `✓ Transcribed ${result.metadata?.fileSize} bytes of audio`,
            );
            return result.text;
        } else {
            // Read text file
            return fs.readFileSync(inputPath, "utf8");
        }
    }
}

function writeOutput(content: string, outputPath?: string): void {
    if (!outputPath || outputPath === "-") {
        // Write to stdout
        console.log(content);
    } else {
        // Ensure directory exists
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        // Write to file
        fs.writeFileSync(outputPath, content, "utf8");
        console.error(`✓ Markdown written to: ${outputPath}`);
    }
}

async function main() {
    const options = parseArgs();

    if (options.help) {
        printHelp();
        process.exit(0);
    }

    try {
        // Read input
        console.error("Reading input...");
        const rawText = await readInput(options.input);

        if (!rawText.trim()) {
            console.error("Error: No input provided");
            process.exit(1);
        }

        console.error(
            `Processing ${rawText.length} characters with Claude...`,
        );

        // Process thoughts
        const processor = new ThoughtsProcessor(options.model);
        const processOptions: any = { rawText };
        if (options.instructions) {
            processOptions.instructions = options.instructions;
        }
        if (options.model) {
            processOptions.model = options.model;
        }
        const result = await processor.processThoughts(processOptions);

        console.error(
            `✓ Generated ${result.metadata?.outputLength} characters of markdown`,
        );

        // Write output
        writeOutput(result.markdown, options.output);
    } catch (error) {
        console.error(
            "Error:",
            error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
    }
}

main();
