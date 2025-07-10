// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ensureDirSync,
    writeObjectToFile,
    writeObjectToUniqueFile,
} from "./common.js";
import { changeFileExt, dateTime, ensureDir } from "typeagent";
import path from "path";

export class KnowproLog {
    constructor(public baseLogDir: string) {
        ensureDirSync(baseLogDir);
    }

    public writeCommandResult(commandName: string, obj: any) {
        try {
            const timestamp = new Date();
            const dirPath = this.ensureCommandLogDir(timestamp, commandName);
            const fileName = `${dateTime.timestampString(timestamp)}.json`;
            let filePath = path.join(dirPath, fileName);
            writeObjectToUniqueFile(filePath, obj);
        } catch (ex) {
            console.log(`Error while writing log file:\n{ex}`);
        }
    }

    public async writeTestReport(
        report: TestRunReport,
        fileName: string,
        timestamp?: Date,
    ) {
        const logDir = path.join(this.baseLogDir, "testReports");
        await ensureDir(logDir);

        timestamp ??= new Date();
        const outputPath = path.join(
            logDir,
            changeFileExt(
                fileName,
                ".json",
                dateTime.timestampString(timestamp),
            ),
        );
        writeObjectToFile(outputPath, report);
    }

    private ensureCommandLogDir(timestamp: Date, commandName?: string): string {
        let dirName: string;
        if (commandName) {
            dirName = `${commandName}_${dateTime.timestampStringShort(timestamp)}`;
        } else {
            dirName = dateTime.timestampStringShort(timestamp);
        }
        const dirPath = path.join(this.baseLogDir, dirName);
        ensureDirSync(dirPath);
        return dirPath;
    }
}

export interface TestRunReport<T = any> {
    name: string;
    timeRange: dateTime.TimestampRange;
    srcData: string;
    countRun: number;
    errors: T[];
    rawResults?: T[] | undefined;
}
