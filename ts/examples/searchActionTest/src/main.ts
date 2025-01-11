// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
import { ChatModelWithStreaming, openai } from "aiclient";
import { CalendarSearchAction, CalendarDateTime } from "./calSearchSchema.js";
import {
    TypeChatLanguageModel,
    TypeChatJsonTranslator,
    createJsonTranslator,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";
import { readSchemaFile } from "common-utils";

import * as fs from "fs";

const envPath = new URL("../../../.env", import.meta.url);
dotenv.config({ path: envPath });

const schemaText = readSchemaFile("./calSearchSchema.ts");
const preamble = "You are a service that translates user calendar queries.\n";
/**
 * Create a JSON translator designed to work for Chat
 * @param model language model to use
 * @param schema schema for the chat response
 * @param typeName typename of the chat response
 * @param preamble text to prepend to the prompt
 * @returns
 */
export function createChatTranslator<T extends object>(
    model: TypeChatLanguageModel,
    schema: string,
    typeName: string,
    preamble: string = "",
): TypeChatJsonTranslator<T> {
    const validator = createTypeScriptJsonValidator<T>(schema, typeName);
    const translator = createJsonTranslator<T>(model, validator);

    translator.createRequestPrompt = createRequestPrompt;
    return translator;

    function createRequestPrompt(request: string): string {
        return (
            preamble +
            `Your responses are represented as JSON objects of type "${typeName}" using the following TypeScript definitions:\n` +
            `\`\`\`\n${schema}\`\`\`\n` +
            `The following is a user request:\n` +
            `"""\n${request}\n"""\n` +
            `The following is your JSON response with 2 spaces of indentation and no properties with the value undefined:\n`
        );
    }
}

function createModel(
    preferLocal: boolean,
): [openai.ApiSettings, ChatModelWithStreaming] {
    // First see if there is a local model
    let apiSettings: openai.ApiSettings | undefined;
    if (preferLocal) {
        apiSettings = openai.localOpenAIApiSettingsFromEnv(
            openai.ModelType.Chat,
            undefined,
            undefined,
            ["action tester"],
        );
    }
    if (!apiSettings) {
        // Create default model
        apiSettings = openai.apiSettingsFromEnv(
            openai.ModelType.Chat,
            undefined,
            "GPT_4_O",
        );
    }
    const chatModel = openai.createJsonChatModel(apiSettings, [
        "searchActionTest",
    ]);

    return [apiSettings, chatModel];
}

const testfile = "./calendar_sample_parsed_seed17.json";

interface CalResult {
    attendees?: string;
    state?: string;
    meetingtype?: string;
    start?: string;
    end?: string;
    keyword?: string;
}
interface TestItem {
    label: string;
    utterance: string;
    parsed_label: CalResult;
}

interface OutDateTimeRange {
    start: string;
    end?: string;
}

function isStartOrEndDay(day: string): boolean {
    return (
        day === "StartOfWeek" ||
        day === "EndOfWeek" ||
        day === "StartOfMonth" ||
        day === "EndOfMonth"
    );
}

function convertCalDateTime(
    calDateTime: CalendarDateTime,
    isStart = true,
): string {
    switch (calDateTime?.specialDateTime) {
        case "Now":
            return "now";
        case "InThePast":
            return "error: past";
        case "InTheFuture":
            return "error: future";
    }
    let accum = "now";
    if (calDateTime.month !== undefined) {
        accum += ".";
        accum += calDateTime.month;
        if (calDateTime.day !== undefined) {
            if (
                calDateTime.day === "StartOfMonth" ||
                calDateTime.day === "EndOfMonth"
            ) {
                accum += ".";
                accum += calDateTime.day.toLocaleLowerCase();
            } else {
                accum += " ";
                accum += calDateTime.day;

                if (calDateTime.hms === undefined) {
                    if (isStart) {
                        accum += ".startofday";
                    } else {
                        accum += ".endofday";
                    }
                }
            }
        } else {
            if (isStart) {
                accum += ".startofmonth";
            } else {
                accum += ".endofmonth";
            }
        }
    } else if (calDateTime.week !== undefined) {
        if (calDateTime.week === "0") {
            if (isStart) {
                accum += ".startofweek";
            } else {
                accum += ".endofweek";
            }
        } else {
            accum += ".";
            accum += calDateTime.week;
            if (calDateTime.day !== undefined) {
                accum += ".";
                if (
                    calDateTime.day === "StartOfWeek" ||
                    calDateTime.day === "EndOfWeek"
                ) {
                    accum += calDateTime.day.toLocaleLowerCase();
                } else {
                    accum += calDateTime.day;
                }
            } else {
                if (isStart) {
                    accum += ".startofweek";
                } else {
                    accum += ".endofweek";
                }
            }
        }
    } else if (
        calDateTime.day !== undefined &&
        calDateTime.day !== "0" &&
        calDateTime.day !== "Now" &&
        calDateTime.day.toLocaleLowerCase() !== "today"
    ) {
        accum += ".";
        if (
            calDateTime.day === "StartOfWeek" ||
            calDateTime.day === "EndOfWeek"
        ) {
            accum += calDateTime.day.toLocaleLowerCase();
        } else {
            accum += calDateTime.day;
        }
    }
    if (calDateTime.hms !== undefined) {
        accum += ".";
        switch (calDateTime.hms) {
            case "Noon":
            case "12:00:00":
                if (isStart) {
                    accum += "12:00:00";
                } else {
                    accum += "11:59:59";
                }
                break;
            case "Midnight":
            case "00:00:00":
            case "08:00:00":
                if (isStart) {
                    accum += "startofday";
                } else {
                    accum += "23:59:59";
                }
                break;
            default:
                accum += calDateTime.hms;
                break;
        }
    } else if (
        calDateTime.day !== undefined &&
        !isStartOrEndDay(calDateTime.day) &&
        calDateTime.month === undefined
    ) {
        if (isStart) {
            accum += ".startofday";
        } else {
            accum += ".endofday";
        }
    }
    return accum;
}

function getDateTimeRange(
    start: CalendarDateTime,
    end?: CalendarDateTime,
): OutDateTimeRange {
    const outdtr = {} as OutDateTimeRange;
    outdtr.start = convertCalDateTime(start);
    if (end !== undefined) {
        outdtr.end = convertCalDateTime(end, false);
    }
    return outdtr;
}

function getState(start?: CalendarDateTime, end?: CalendarDateTime) {
    if (
        start &&
        start.specialDateTime === "Now" &&
        (end === undefined ||
            end.specialDateTime === "InTheFuture" ||
            end.specialDateTime === "Now")
    ) {
        return "upcoming";
    } else if (
        start &&
        start.specialDateTime === "InTheFuture" &&
        end === undefined
    ) {
        return "upcoming";
    } else if (
        start &&
        start.specialDateTime === "InThePast" &&
        (end === undefined || end.specialDateTime === "Now")
    ) {
        return "completed";
    } else if (start == undefined && end && end.specialDateTime === "Now") {
        return "completed";
    } else {
        return undefined;
    }
}

async function runTest(): Promise<void> {
    // Create Model
    //
    let [_apiSettings, chatModel] = createModel(false);

    const chatTranslator = createChatTranslator<CalendarSearchAction>(
        chatModel,
        schemaText,
        "CalendarSearchAction",
        preamble,
    );

    // read JSON from test file
    const testJSON = fs.readFileSync(
        new URL(testfile, import.meta.url),
        "utf8",
    );
    const testData = JSON.parse(testJSON) as TestItem[];
    for (let i = 0; i < testData.length; ++i) {
        const testItem = testData[i];
        console.log(`\n\n${testItem.label}\n${testItem.utterance}`);
        const chatResponse = await chatTranslator.translate(testItem.utterance);
        console.log(JSON.stringify(chatResponse, undefined, 2));
        if (chatResponse.success) {
            const chatAction = chatResponse.data;
            const syntheticResult: CalResult = {};
            const state = getState(
                chatAction.parameters.start,
                chatAction.parameters.end,
            );
            if (state !== undefined) {
                syntheticResult.state = state;
                console.log(state);
            } else if (chatAction.parameters.start) {
                const outdtr = getDateTimeRange(
                    chatAction.parameters.start,
                    chatAction.parameters.end,
                );
                console.log(outdtr);
            }
        }
    }
}

await runTest();
