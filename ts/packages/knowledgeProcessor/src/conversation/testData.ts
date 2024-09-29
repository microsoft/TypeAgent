import path from "path";
import { AnswerResponse } from "./answerSchema.js";
import {
    asyncArray,
    getFileName,
    readAllLines,
    writeJsonFile,
} from "typeagent";
import { ConversationManager } from "./conversationManager.js";

export type SearchAnswer = {
    query: string;
    answer?: AnswerResponse | undefined;
};

export async function searchBatch(
    cm: ConversationManager,
    filePath: string,
    destPath: string | undefined,
    concurrency: number,
    progress?: (
        item: string,
        index: number,
        total: number,
        result: SearchAnswer,
    ) => void | boolean,
): Promise<void> {
    if (!destPath) {
        destPath = path.join(
            path.dirname(filePath),
            `${getFileName(filePath)}_result.json`,
        );
    }
    let lines = await readAllLines(filePath, undefined, true, true);
    let results = await asyncArray.mapAsync(
        lines,
        concurrency,
        async (query, index) => {
            const rr = await cm.search(query);
            return { query, answer: rr?.response?.answer };
        },
        progress
            ? (item, index, answer) =>
                  progress(item, index, lines.length, answer)
            : undefined,
    );
    await writeJsonFile(destPath, results);
}
