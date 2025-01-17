// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAction,
    AppAgent,
    SessionContext,
    ActionResult,
    // Storage,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromError,
    createActionResultFromTextDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import {
    PutMeasurementAction,
    MeasurementAction,
    Measurement,
} from "./measureActionsSchema.js";
import path from "path";
import os from "node:os";
import { createDatabase } from "./database.js";
import { dateTime, ensureDir } from "typeagent";

export function instantiate(): AppAgent {
    return createMeasurementAgent();
}

export function createMeasurementAgent(): AppAgent {
    type MeasureContext = {
        store?: MeasurementTable | undefined;
    };

    return {
        initializeAgentContext,
        updateAgentContext,
        executeAction,
    };

    async function initializeAgentContext(): Promise<MeasureContext> {
        return {};
    }

    async function updateAgentContext(
        enable: boolean,
        context: SessionContext<MeasureContext>,
    ): Promise<void> {
        if (enable) {
            const storageDir = await ensureStorageDir();
            const dbPath = path.join(storageDir, "measurements.db");
            context.agentContext.store = await createMeasurementTable(
                dbPath,
                true,
            );
        } else {
        }
    }

    async function executeAction(
        action: AppAction,
        actionContext: ActionContext<MeasureContext>,
    ) {
        const measureAction = action as MeasurementAction;
        const context = actionContext.sessionContext.agentContext;
        let result: ActionResult | undefined = undefined;
        //let displayText: string | undefined = undefined;
        switch (measureAction.actionName) {
            case "getMeasurement":
            case "putMeasurement":
                result = await handlePutVaultItems(
                    context,
                    measureAction as PutMeasurementAction,
                );
                break;
            case "removeMeasurement":
            default:
                result = createActionResultFromError(
                    `${measureAction.actionName} not implemented`,
                );
                break;
        }
        return result;
    }

    async function handlePutVaultItems(
        context: MeasureContext,
        action: PutMeasurementAction,
    ) {
        const items = action.parameters.items;
        items.forEach((m) => context.store!.put(m));
        return createActionResultFromTextDisplay(
            `Added ${items.length} items to measurements`,
        );
    }

    async function ensureStorageDir() {
        const storagePath = getStoragePath();
        await ensureDir(storagePath);
        return storagePath;
    }

    function getStoragePath() {
        const basePath = path.join(os.homedir(), ".typeagent");
        return path.join(basePath, "measures");
    }
}

interface MeasurementTable {
    put(measurement: Measurement): Promise<void>;
}

async function createMeasurementTable(
    filePath: string,
    ensureExists: boolean,
): Promise<MeasurementTable> {
    const db = await createDatabase(filePath, false);
    const schemaSql = `
    CREATE TABLE IF NOT EXISTS measurements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      whenDate TEXT NOT NULL,
      value REAL NOT NULL,
      units TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_measurements_type ON measurements (type);
    CREATE INDEX IF NOT EXISTS idx_measurements_values ON measurements (value, units);
    CREATE INDEX IF NOT EXISTS idx_measurements_timestamp ON measurements (timestamp);
    `;
    if (ensureExists) {
        db.exec(schemaSql);
    }
    const sql_add = db.prepare(
        `INSERT OR IGNORE INTO measurements (timestamp, type, whenDate, value, units) VALUES (?, ?, ?, ?, ?)`,
    );

    return {
        put,
    };

    async function put(measurement: Measurement): Promise<void> {
        const when = measurement.when ? new Date(measurement.when) : new Date();
        const timestamp = dateTime.timestampString(when);
        if (!measurement.id || measurement.id === "new") {
            sql_add.run(
                timestamp,
                measurement.type,
                when.toISOString(),
                measurement.value.value,
                measurement.value.units,
            );
        }
    }
}
