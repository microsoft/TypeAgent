import { ObjectFolder, ObjectFolderSettings, createObjectFolder } from "typeagent";
import { TemporalLogSettings, StorageProvider, createTemporalLog } from "knowledge-processor";
import * as knowLib from "knowledge-processor";
import { createElasicClient } from "./common.js";
import { createKeyValueIndex } from "./keyValueIndex.js";
import { createTextIndex } from "./simplifiedTextIndex.js";

export async function createStorageIndex(
    createNew: boolean,
): Promise<StorageProvider> {
    let uri = process.env.ELASTIC_URI;

    if (!uri) {
        throw new Error("ELASTIC_URI environment variable not set");
    }

    let elasticClient = await createElasicClient(
        uri,
        createNew
    );

    return {
        createObjectFolder: _createObjectFolder,
        createTemporalLog: _createTemporalLog,
        createTextIndex: _createTextIndex,
        createIndex: _createIndex,
        clear
    }

    async function _createObjectFolder<T>(
        basePath: string,
        name: string,
        settings?: ObjectFolderSettings,
    ): Promise<ObjectFolder<T>> {
        // TODO: check to make sure the database is open
        return createObjectFolder<T>(
            basePath,
            settings
        );
    }

    async function _createTemporalLog<T>(
        settings: TemporalLogSettings,
        basePath: string,
        name: string,
    ) {
        return createTemporalLog<T>(
            settings,
            basePath,
        );
    }

    async function _createTextIndex<TSourceId extends knowLib.ValueType>(
        settings: knowLib.TextIndexSettings,
        basePath: string,
        name: string,
        sourceIdType: knowLib.ValueDataType<TSourceId>
    ) {

        // TODO: check to make sure the database is open
        return createTextIndex<string, TSourceId>(
            settings,
            basePath+name,
            elasticClient,
            sourceIdType
        );
    }

    async function _createIndex<TValueId extends knowLib.ValueType>(
        basePath: string,
        name: string,
        valueType: knowLib.ValueDataType<TValueId>,
    ): Promise<knowLib.KeyValueIndex<string, TValueId>> {
        // TODO: check to make sure the database is open
        return createKeyValueIndex<string, TValueId>(
            elasticClient,
            basePath+name
        );
    }

    async function clear() {
        console.log("clear");
    }
}
