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

const testfile = "./calendar_sample_parsed_seed25.json";
//const testfile = "./singleTest.json";
interface CalResult extends TestItem {
    original: CalendarSearchAction;
    attendees?: string;
    state?: string;
    meetingtype?: string;
    start?: string;
    end?: string;
    keyword?: string;
    syntheticLabel?: string;
    timeDelta?: boolean;
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
        day === "EndOfMonth" ||
        day === "StartOfDay" ||
        day === "EndOfDay" ||
        day === "StartOfYear" ||
        day === "EndOfYear"
    );
}

function isNumberString(str: string): boolean {
    return /^\d+$/.test(str);
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
            if (
                calDateTime.month === undefined &&
                calDateTime.week === undefined &&
                calDateTime.hms === undefined &&
                calDateTime.year === undefined &&
                (calDateTime.day === undefined ||
                    calDateTime.day === "0" ||
                    calDateTime.day?.toLocaleLowerCase() === "today")
            ) {
                return "now.endofday";
            } else {
                return "error: future";
            }
    }
    let accum = "now";
    if (
        calDateTime.year !== undefined &&
        calDateTime.year !== "0" &&
        (isNumberString(calDateTime.year) ||
            isStartOrEndDay(calDateTime.year) ||
            calDateTime.year.startsWith("+") ||
            calDateTime.year.startsWith("-"))
    ) {
        accum += ".";
        accum += calDateTime.year.toLocaleLowerCase();
    }
    if (calDateTime.year === "0") {
        if (isStart) {
            accum += ".startofyear";
        } else {
            accum += ".endofyear";
        }
    }

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
    } else if (
        (calDateTime.day === "0" ||
            calDateTime.day?.toLocaleLowerCase() === "today") &&
        calDateTime.hms === undefined
    ) {
        if (isStart) {
            accum += ".startofday";
        } else {
            accum += ".endofday";
        }
    }
    if (calDateTime.hms !== undefined && calDateTime.hms !== "Now") {
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
        calDateTime.day !== "0" &&
        calDateTime.day !== "Now" &&
        calDateTime.day.toLocaleLowerCase() !== "today" &&
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
        (end === undefined ||
            end.specialDateTime === "Now" ||
            end.specialDateTime === "InThePast")
    ) {
        return "completed";
    } else if (start == undefined && end && end.specialDateTime === "Now") {
        return "completed";
    } else {
        return undefined;
    }
}

export function refineTest(testoutfile: string) {
    const testJSON = fs.readFileSync(
        new URL(testoutfile, import.meta.url),
        "utf8",
    );
    const testData = JSON.parse(testJSON) as CalResult[];
    const outfilename = `./${testoutfile}.refined.json`;
    const outFile = fs.createWriteStream(outfilename, {
        flags: "w",
    });
    outFile.write(`[\n`);
    // loop through the test data, and reprocess
    for (let i = 0; i < testData.length; ++i) {
        const testItem = testData[i];
        const chatAction = testItem.original;
        const syntheticResult: CalResult = {
            label: testItem.label,
            utterance: testItem.utterance,
            parsed_label: testItem.parsed_label,
            original: chatAction,
        };
        const state = getState(
            chatAction.parameters.start,
            chatAction.parameters.end,
        );
        if (state !== undefined) {
            syntheticResult.state = state;
            // console.log(state);
        } else if (chatAction.parameters.start) {
            const outdtr = getDateTimeRange(
                chatAction.parameters.start,
                chatAction.parameters.end,
            );
            syntheticResult.start = outdtr.start;
            if (outdtr.end !== undefined) {
                syntheticResult.end = outdtr.end;
            }
            const compareStart = "{" + outdtr.start + "}";
            if (compareStart !== testItem.parsed_label.start) {
                syntheticResult.timeDelta = true;
            }
            if (outdtr.end !== undefined) {
                const compareEnd = "{" + outdtr.end + "}";
                if (compareEnd !== testItem.parsed_label.end) {
                    syntheticResult.timeDelta = true;
                }
            }
            // console.log(outdtr);
        }
        if (chatAction.parameters.attendees !== undefined) {
            syntheticResult.attendees =
                chatAction.parameters.attendees.join(", ");
        }
        if (chatAction.parameters.singleEvent !== undefined) {
            syntheticResult.meetingtype = "single";
        } else {
            syntheticResult.meetingtype = "multiple";
        }
        if (chatAction.parameters.meetingDescriptionKeyphrases !== undefined) {
            syntheticResult.keyword =
                chatAction.parameters.meetingDescriptionKeyphrases.join(" ");
        }
        syntheticResult.syntheticLabel = createSyntheticLabel(syntheticResult);
        outFile.write(`${JSON.stringify(syntheticResult, undefined, 2)}`);
        if (i < testData.length - 1) {
            outFile.write(`,\n`);
        } else {
            outFile.write(`\n`);
        }
    }
    outFile.write(`]\n`);
    outFile.close();
}

export function createTabSeparatedOuput(testoutfile: string) {
    const testJSON = fs.readFileSync(
        new URL(testoutfile, import.meta.url),
        "utf8",
    );
    const testData = JSON.parse(testJSON) as CalResult[];
    const outfilename = `./${testoutfile}.tsv`;
    const outFile = fs.createWriteStream(outfilename, {
        flags: "w",
    });
    outFile.write(`label\tutterance\tsyntheticLabel\n`);
    // loop through the test data, and reprocess
    for (let i = 0; i < testData.length; ++i) {
        const testItem = testData[i];
        outFile.write(`${testItem.label}\t${testItem.utterance}\t`);
        outFile.write(`${testItem.syntheticLabel}\n`);
    }
    outFile.close();
}

function createSyntheticLabel(syntheticResult: CalResult): string {
    let out = "search_calendar(";
    let comma = "";
    if (syntheticResult.state !== undefined) {
        out += `state=[${syntheticResult.state}]`;
    } else if (syntheticResult.start !== undefined) {
        out += `start=[{${syntheticResult.start}}]`;
        if (syntheticResult.end !== undefined) {
            out += `,end=[{${syntheticResult.end}}]`;
        }
        comma = ", ";
    }
    if (syntheticResult.attendees !== undefined) {
        out += `${comma}attendees=[${syntheticResult.attendees}]`;
        comma = ", ";
    }
    if (syntheticResult.meetingtype !== undefined) {
        out += `${comma}meetingtype=[${syntheticResult.meetingtype}]`;
        comma = ", ";
    }
    if (syntheticResult.keyword !== undefined) {
        out += `${comma}keyword=[${syntheticResult.keyword}]`;
    }
    out += `)`;
    return out;
}

export async function runTest(): Promise<void> {
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
    const outfilename = `./${testfile}.out.json`;
    // open output file for writing
    const outFile = fs.createWriteStream(outfilename, {
        flags: "w",
    });
    outFile.write(`[\n`);
    const testData = JSON.parse(testJSON) as TestItem[];
    for (let i = 0; i < testData.length; ++i) {
        const testItem = testData[i];
        console.log(`test: ${i}: ${testItem.utterance}\n${testItem.label}`);
        const chatResponse = await chatTranslator.translate(testItem.utterance);
        console.log(JSON.stringify(chatResponse, undefined, 2));
        if (chatResponse.success) {
            const chatAction = chatResponse.data;
            const syntheticResult: CalResult = {
                label: testItem.label,
                utterance: testItem.utterance,
                parsed_label: testItem.parsed_label,
                original: chatAction,
            };
            const state = getState(
                chatAction.parameters.start,
                chatAction.parameters.end,
            );
            if (state !== undefined) {
                syntheticResult.state = state;
                // console.log(state);
            } else if (chatAction.parameters.start) {
                const outdtr = getDateTimeRange(
                    chatAction.parameters.start,
                    chatAction.parameters.end,
                );
                syntheticResult.start = outdtr.start;
                if (outdtr.end !== undefined) {
                    syntheticResult.end = outdtr.end;
                }
                // console.log(outdtr);
            }
            if (chatAction.parameters.attendees !== undefined) {
                syntheticResult.attendees =
                    chatAction.parameters.attendees.join(", ");
            }
            if (chatAction.parameters.singleEvent !== undefined) {
                syntheticResult.meetingtype = "single";
            } else {
                syntheticResult.meetingtype = "multiple";
            }
            if (
                chatAction.parameters.meetingDescriptionKeyphrases !== undefined
            ) {
                syntheticResult.keyword =
                    chatAction.parameters.meetingDescriptionKeyphrases.join(
                        " ",
                    );
            }
            outFile.write(`${JSON.stringify(syntheticResult, undefined, 2)}`);
            if (i < testData.length - 1) {
                outFile.write(`,\n`);
            } else {
                outFile.write(`\n`);
            }
        } else {
            console.log(
                `\n\n${testItem.label}\n${testItem.utterance} ERROR ${chatResponse.message}`,
            );
        }
    }
    outFile.write(`]\n`);
    outFile.close();
}

await runTest();
//refineTest("./calendar_sample_parsed_seed25.json.out.json");
// createTabSeparatedOuput(
//     "./calendar_sample_parsed_seed17.json.out.json.refined.json",
// );
