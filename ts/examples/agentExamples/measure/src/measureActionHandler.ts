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
    createActionResultFromHtmlDisplay,
    createActionResultFromTextDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import {
    PutMeasurementAction,
    MeasurementAction,
    Measurement,
    MeasurementFilter,
    MeasurementRange,
    MeasurementTimeRange,
    GetMeasurementAction,
} from "./measureActionsSchema.js";
import path from "path";
import os from "node:os";
import {
    createDatabase,
    sql_appendCondition,
    sql_makeInClause,
} from "./database.js";
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
                result = await handleGetMeasurements(
                    context,
                    measureAction as GetMeasurementAction,
                );
                break;
            case "putMeasurement":
                result = await handlePutMeasurements(
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

    async function handleGetMeasurements(
        context: MeasureContext,
        action: GetMeasurementAction,
    ) {
        const filter = action.parameters.filter;
        const matches = context.store!.get(filter);
        if (!matches || matches.length === 0) {
            return createActionResultFromTextDisplay("No measurements found");
        }
        const html = measurementsToHtml(matches);
        const csv = measurementsToCsv(matches);
        return createActionResultFromHtmlDisplay(html, csv);
    }

    async function handlePutMeasurements(
        context: MeasureContext,
        action: PutMeasurementAction,
    ) {
        const items = action.parameters.items;
        items.forEach((m) => context.store!.put(m));
        return createActionResultFromTextDisplay(
            `Added ${items.length} measurements`,
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

    function measurementsToHtml(measures: Measurement[]) {
        let html = "<table>";
        html +=
            "<th><td>Type</td><td>When</td><td>Value</td><td>Units</td></th>";
        for (const m of measures) {
            html += measurementToHtml(m);
        }
        html += "</table>";
        return html;
    }

    function measurementToHtml(measure: Measurement) {
        let html = "";
        html += `<td>${measure.type}</td>`;
        html += `<td>${measure.when}</td>`;
        html += `<td>${measure.value.value}</td>`;
        html += `<td>${measure.value.units}</td>`;
        return html;
    }

    function measurementsToCsv(measures: Measurement[]) {
        let csvHeader = "Type, When, Value, Units\n";
        let rows = measures.map((m) => measurementToCsv(m)).join("\n");
        return csvHeader + rows;
    }

    function measurementToCsv(measure: Measurement) {
        return `${measure.type}, ${measure.when}, ${measure.value.value}, ${measure.value.units}`;
    }
}

interface MeasurementTable {
    get(filter: MeasurementFilter): Measurement[];
    put(measurement: Measurement): void;
}

async function createMeasurementTable(
    filePath: string,
    ensureExists: boolean,
): Promise<MeasurementTable> {
    type MeasurementRow = {
        id: number;
        type: string;
        timestamp: string;
        whenDate: string;
        value: number;
        units: string;
    };

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
        get,
        put,
    };

    function get(filter: MeasurementFilter): Measurement[] {
        const sql = filterToSql(filter);
        const stmt = db.prepare(sql);
        let rows = stmt.all();
        let measurements: Measurement[] = [];
        for (const row of rows) {
            const mRow: MeasurementRow = row as MeasurementRow;
            measurements.push({
                id: mRow.id,
                type: mRow.type,
                when: mRow.whenDate,
                value: {
                    value: mRow.value,
                    units: mRow.units,
                },
            });
        }
        return measurements;
    }

    function put(measurement: Measurement): void {
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

    function filterToSql(filter: MeasurementFilter): string {
        let sql = "SELECT * FROM measurements\n";
        let sqlWhere = "";
        if (filter.types && filter.types.length > 0) {
            sqlWhere = sql_appendCondition(
                sqlWhere,
                `type IN (${sql_makeInClause(filter.types)})`,
            );
        }
        if (filter.valueRange) {
            sqlWhere = sql_appendCondition(
                sqlWhere,
                measurementRangeToSql(filter.valueRange),
            );
        }
        if (filter.timeRange) {
            sqlWhere = sql_appendCondition(
                sqlWhere,
                timeRangeToSql(filter.timeRange),
            );
        }
        if (sqlWhere) {
            sql += `WHERE ${sqlWhere}`;
        }
        sql += "ORDER BY type ASC, timestamp ASC";
        return sql;
    }

    function measurementRangeToSql(range: MeasurementRange) {
        let sql = "";
        if (range.start) {
            sql += `value >= ${range.start}`;
        }
        if (range.end) {
            if (sql) {
                sql += " AND ";
            }
            sql += `value <= ${range.end}`;
        }
        if (sql) {
            sql += ` AND units = ${range.units}`;
        }
        return sql;
    }

    function timeRangeToSql(range: MeasurementTimeRange) {
        const startAt = range.start
            ? dateTime.timestampString(new Date(range.start))
            : undefined;
        const endAt = range.end
            ? dateTime.timestampString(new Date(range.end))
            : undefined;
        let sql = "";
        if (startAt) {
            sql += `timestamp >= ${startAt}`;
        }
        if (endAt) {
            if (sql) {
                sql += " AND ";
            }
            sql += `timestamp <= ${endAt}`;
        }
        return sql;
    }
}
