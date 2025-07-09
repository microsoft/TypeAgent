// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ensureDirSync, writeObjectToUniqueFile } from "./common.js";
import { dateTime } from "typeagent";
import path from "path";

export class KnowproLog {
    constructor(public baseLogDir: string) {
        ensureDirSync(baseLogDir);
    }

    public writeFile(commandName: string, obj: any) {
        try {
            const timestamp = new Date();
            const dirPath = this.ensureLogDir(timestamp, commandName);
            const fileName = `${dateTime.timestampString(timestamp)}.json`;
            let filePath = path.join(dirPath, fileName);
            writeObjectToUniqueFile(filePath, obj);
        } catch (ex) {
            console.log(`Error while writing log file:\n{ex}`);
        }
    }

    public ensureLogDir(timestamp: Date, commandName?: string): string {
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
