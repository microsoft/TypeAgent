// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    CommandHandler,
    CommandMetadata,
    CommandResult,
    ConsoleWriter,
    InteractiveIo,
    parseNamedArguments,
} from "interactive-app";
import { SchemaStudio } from "./studio.js";
import fs from "fs";
import { bingWithGrounding, urlResolver } from "azure-ai-foundry";
import registerDebug from "debug";

export function createURLResolverCommands(
    studio: SchemaStudio,
): CommandHandler {
    const argDef: CommandMetadata = {
        description:
            "Resolves the supplied utterance + URLs in the supplied file",
        options: {
            file: {
                description: "The file to open",
                type: "string",
                defaultValue: "examples/schemaStudio/data/urls.txt",
            },
            all: {
                description: "If true, will process all URLs in the file",
                type: "boolean",
                defaultValue: true,
            },
        },
    };

    const handler: CommandHandler = async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);
        const runStarted = Date.now();

        registerDebug.enable("*");

        io.writer.writeLine(`Opening file: ${namedArgs.file}`);
        const urls = fs.readFileSync(namedArgs.file, "utf-8").split("\n");

        // ignore the first line which is a comment
        urls.shift();

        io.writer.writeLine(`Loaded ${urls.length} URLs.`);

        // get the grounding config
        const groundingConfig = bingWithGrounding.apiSettingsFromEnv();

        // delete the output file if it exists
        const outputFile = "examples/schemaStudio/data/resolved.txt";
        if (fs.existsSync(outputFile)) {
            fs.unlinkSync(outputFile);
        }

        // Start checking each URL
        let passCount = 0;
        let failCount = 0;
        let redirectCount = 0;
        let contentFilteringCount = 0;
        for (const url of urls) {
            const temp = url.split("\t");

            if (temp.length < 2) {
                io.writer.writeLine(
                    `Skipping invalid line: '${url}'. Expected format: "utterance\\tsite"`,
                );
                continue;
            }

            const utterance = temp[0] ? temp[0].trim() : "";
            const site = temp[1] ? temp[1].trim() : "";

            const resolved = await urlResolver.resolveURLWithSearch(
                utterance,
                groundingConfig,
            );
            let passFail = "";

            // resolved site matches expected site accounting for varying / at the end
            // TODO: handle redirects + default parameters, etc.
            if (resolved === null) {
                // resolved site was blocked by content filtering
                passFail = "CONTENT_FILTERING";
                contentFilteringCount++;
            } else if (resolved === undefined) {
                // unable to resolve
                passFail = "FAIL";
                failCount++;
            } else if (sitesMatch(resolved[0], site, io.writer)) {
                passFail = "PASS";
                passCount++;
            } else if (resolved[0]?.startsWith(site)) {
                // resolved site starts with expected site, indicating a redirect
                passFail = "REDIRECT";
                redirectCount++;
            } else {
                // sites don't match
                passFail = "FAIL";
                failCount++;
            }

            const rr =
                resolved === null
                    ? "<CONTENT_FILTERING>"
                    : resolved === undefined
                      ? "<ERROR>"
                      : resolved;

            io.writer.writeLine(
                `${passFail}: Resolved '${utterance}' to '${rr}' (expected: ${site})`,
            );

            fs.appendFileSync(
                outputFile,
                `${passFail}\t${utterance}\t${site}\t${rr}\n`,
            );
        }

        io.writer.writeLine(
            "URL resolution complete. Results written to resolved.txt",
        );
        io.writer.writeLine(
            `Passed: ${passCount}, Failed: ${failCount}, Redirect: ${redirectCount}, Content Filtering: ${contentFilteringCount}`,
        );

        io.writer.writeLine(`Duration: ${Date.now() - runStarted}ms`);
    };

    handler.metadata = argDef;

    return handler;
}

function sitesMatch(
    resolved: string | undefined | null,
    site: string,
    io: ConsoleWriter,
): boolean {
    // Check if resolved site matches expected site accounting for varying / at the end
    if (
        resolved === site ||
        (site.endsWith("/") && site === `${resolved}/`) ||
        (resolved?.endsWith("/") && `${site}/` === resolved)
    ) {
        return true;
    }

    try {
        // now, is the resolved site just a subdomain of the expected site?
        const resolvedUrl = new URL(resolved!);
        const siteUrl = new URL(site);

        // Check if resolved is a subdomain of site by reversing the hostname parts and comparing them
        const resolvedParts = resolvedUrl.hostname.split(".").reverse();
        const siteParts = siteUrl.hostname.split(".").reverse();

        // we only match subdomains that have one extra part
        if (siteParts.length - resolvedParts.length > 1) {
            return false;
        }

        let bigParts;
        let smallParts;

        if (siteParts.length > resolvedParts.length) {
            bigParts = siteParts;
            smallParts = resolvedParts;
        } else {
            bigParts = resolvedParts;
            smallParts = siteParts;
        }

        for (let i = 0; i < smallParts.length; i++) {
            // special case for culture redirects
            if (i == smallParts.length - 1) {
                if (
                    (smallParts[i] === "en" || bigParts[i] === "en") &&
                    (smallParts[i] === "www" || bigParts[i] === "www")
                ) {
                    return true;
                }
            }

            if (smallParts[i] !== bigParts[i]) {
                return false;
            }
        }

        return true;
    } catch (e) {
        io.writeLine(`Error parsing URL ('${resolved}', '${site}'): ${e}`);
        // If we can't parse the URL, we assume it
        return false;
    }
}

export function createURLValidateCommands(
    studio: SchemaStudio,
): CommandHandler {
    const argDef: CommandMetadata = {
        description: "Validates that supplied utterance and URL matches.",
        options: {
            file: {
                description: "The file to open",
                type: "string",
                defaultValue: "examples/schemaStudio/data/urls.txt",
            },
            all: {
                description: "If true, will process all URLs in the file",
                type: "boolean",
                defaultValue: true,
            },
            flushAgents: {
                description:
                    "Deletes all agents except the one in the api settings.",
                type: "boolean",
                defaultValue: false,
            },
            deleteThreads: {
                description: "Deletes all threads.",
                type: "boolean",
                defaultValue: false,
            },
        },
    };

    const handler: CommandHandler = async function handleCommand(
        args: string[],
        io: InteractiveIo,
    ): Promise<CommandResult> {
        const namedArgs = parseNamedArguments(args, argDef);
        const runStarted = Date.now();

        if (namedArgs.flushAgents) {
            io.writer.writeLine("Flushing agents...");
            await urlResolver.flushAgent(
                bingWithGrounding.apiSettingsFromEnv(),
            );
            return;
        }

        if (namedArgs.deleteThreads) {
            io.writer.writeLine("Deleting threads...");
            await urlResolver.deleteThreads(
                bingWithGrounding.apiSettingsFromEnv(),
            );
            return;
        }

        registerDebug.enable("*");

        io.writer.writeLine(`Opening file: ${namedArgs.file}`);
        const urls = fs.readFileSync(namedArgs.file, "utf-8").split("\n");

        // ignore the first line which is a comment
        urls.shift();

        io.writer.writeLine(`Loaded ${urls.length} URLs.`);

        // get the grounding config
        const groundingConfig = bingWithGrounding.apiSettingsFromEnv();

        // delete the output file if it exists
        const outputFile = "examples/schemaStudio/data/validated.txt";
        if (fs.existsSync(outputFile)) {
            fs.unlinkSync(outputFile);
        }

        // Start checking each URL
        let passCount = 0;
        let failCount = 0;
        for (const url of urls) {
            const temp = url.split("\t");

            if (temp.length < 2) {
                io.writer.writeLine(
                    `Skipping invalid line: ${url}. Expected format: "utterance\\tsite"`,
                );
                continue;
            }

            const utterance = temp[0] ? temp[0].trim() : "";
            const site = temp[1] ? temp[1].trim() : "";

            const siteValidity: urlResolver.urlValidityAction | undefined =
                await urlResolver.validateURL(utterance, site, groundingConfig);

            io.writer.writeLine(
                `${siteValidity?.urlValidity}\t${utterance} (${site})`,
            );

            fs.appendFileSync(
                outputFile,
                `${utterance}\t${site}\t${siteValidity?.urlValidity}\t${siteValidity?.explanation}\n`,
            );
        }

        io.writer.writeLine(
            "URL resolution complete. Results written to resolved.txt",
        );
        io.writer.writeLine(`Passed: ${passCount}, Failed: ${failCount}`);
        io.writer.writeLine(`Duration: ${Date.now() - runStarted}ms`);
    };

    handler.metadata = argDef;

    return handler;
}
