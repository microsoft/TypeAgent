// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    HistoryContext,
    ParamValueType,
    equalNormalizedParamValue,
    normalizeParamString,
    normalizeParamValue,
} from "../explanation/requestAction.js";

import registerDebug from "debug";
import {
    TransformRecordJSON,
    TransformsJSON,
} from "./constructionJSONTypes.js";
const debugConstConflict = registerDebug("typeagent:const:conflict");

export type TransformEntityRecord = { entityTypes: string[] };
type TransformValueRecord = {
    value: ParamValueType;
    count: number;
    conflicts?: Map<ParamValueType, number> | undefined;
};

type TransformRecord = TransformEntityRecord | TransformValueRecord;

function isTransformEntityRecord(
    record: Readonly<TransformRecord | TransformRecordJSON>,
): record is Readonly<TransformEntityRecord> {
    return (record as TransformEntityRecord).entityTypes !== undefined;
}

export class Transforms {
    // paramName -> (text -> value)
    private readonly transforms = new Map<
        string,
        Map<string, TransformRecord>
    >();

    public add(
        paramName: string,
        text: string,
        value: ParamValueType,
        original: boolean,
    ) {
        let map = this.transforms.get(paramName);
        if (map === undefined) {
            map = new Map();
            this.transforms.set(paramName, map);
        }
        // Case insensitive/non-diacritic match
        // Use the count ot heuristic to prefer values original to user request
        // and not from a synonym or alternative suggested by GPT
        this.addTransformRecord(map, normalizeParamString(text), {
            value,
            count: original ? 1 : 0,
        });
    }

    public addEntity(paramName: string, text: string, entityTypes: string[]) {
        let map = this.transforms.get(paramName);
        if (map === undefined) {
            map = new Map();
            this.transforms.set(paramName, map);
        }
        // Case insensitive/non-diacritic match
        this.addTransformRecord(map, normalizeParamString(text), {
            entityTypes,
        });
    }

    private addTransformRecord(
        map: Map<string, TransformRecord>,
        text: string,
        value: Readonly<TransformRecord>,
        clone?: boolean,
        cacheConflicts?: boolean,
    ) {
        const existingValue = map.get(text);
        // REVIEW: how do we deal with conflict transforms?
        if (existingValue !== undefined) {
            if (isTransformEntityRecord(existingValue)) {
                // Heuristic to prefer entity type over value
                return;
            }

            if (!isTransformEntityRecord(value)) {
                if (cacheConflicts) {
                    const normConflictValue = normalizeParamValue(value.value);
                    const normExistingValue = normalizeParamValue(
                        existingValue.value,
                    );

                    if (normConflictValue === normExistingValue) {
                        existingValue.count += value.count;
                        return;
                    }

                    // store the conflict if it is enabled.
                    let existingConflictCount: number;
                    if (existingValue.conflicts === undefined) {
                        // Initialize the conflict map with the existing value.
                        existingValue.conflicts = new Map();
                        existingConflictCount = 0;
                        debugConstConflict(text, existingValue.value);
                    } else {
                        existingConflictCount =
                            existingValue.conflicts.get(normConflictValue) ?? 0;
                    }

                    // Add the conflict value
                    if (
                        debugConstConflict.enabled &&
                        existingConflictCount === 0 &&
                        !existingValue.conflicts.has(normConflictValue)
                    ) {
                        debugConstConflict(text, value.value);
                    }

                    existingConflictCount += value.count;
                    // Switch the value in use if the count is higher
                    if (existingValue.count <= existingConflictCount) {
                        existingValue.conflicts.delete(normConflictValue);
                        existingValue.conflicts.set(
                            normExistingValue,
                            existingValue.count,
                        );
                        existingValue.count = existingConflictCount;
                        existingValue.value = value.value;
                    } else {
                        existingValue.conflicts.set(
                            normConflictValue,
                            existingConflictCount,
                        );
                    }
                } else {
                    if (
                        equalNormalizedParamValue(
                            existingValue.value,
                            value.value,
                        )
                    ) {
                        // No need to replace if the value is the same. Just update the count.
                        if (value.count > existingValue.count) {
                            existingValue.count = value.count;
                            existingValue.conflicts = undefined;
                        }
                        return;
                    }

                    // Heuristic to prefer values original to user request
                    // and not from a synonym or alternative suggested by GPT
                    // If the same, we prefer the latest value
                    if (existingValue.count <= value.count) {
                        existingValue.value = value.value;
                        existingValue.count = value.count;
                        existingValue.conflicts = undefined;
                        debugConstConflict(
                            text,
                            existingValue.value,
                            value.value,
                        );
                    }
                }
            }
        } else {
            map.set(text, clone ? structuredClone(value) : value);
        }
    }

    public merge(transforms: Transforms, cacheConflicts?: boolean) {
        transforms.transforms.forEach((textTransform, paramName) => {
            const existing = this.transforms.get(paramName);
            if (existing !== undefined) {
                textTransform.forEach((value, key) => {
                    this.addTransformRecord(
                        existing,
                        key,
                        value,
                        true,
                        cacheConflicts,
                    );
                });
            } else {
                this.transforms.set(paramName, new Map(textTransform));
            }
        });
    }

    public get(
        paramName: string,
        text: string,
        history?: HistoryContext,
    ): ParamValueType | undefined {
        const textTransform = this.transforms.get(paramName);
        if (textTransform === undefined) {
            throw new Error(
                `Internal error: no transform found for ${paramName}`,
            );
        }
        // Case insensitive/non-diacritic match
        const record = textTransform.get(normalizeParamString(text));
        if (record === undefined) {
            return undefined;
        }
        if (isTransformEntityRecord(record)) {
            // TODO: Better history matching heuristic. Currently it will just the first one in the list.
            return history?.entities.find((entity) =>
                record.entityTypes.every((entityType) =>
                    entity.type.includes(entityType),
                ),
            )?.name;
        }
        return record.value;
    }

    public getConflicts(
        paramName: string,
        text: string,
    ): ParamValueType[] | undefined {
        const textTransform = this.transforms.get(paramName);
        if (textTransform === undefined) {
            throw new Error(
                `Internal error: no transform found for ${paramName}`,
            );
        }
        // Case insensitive/non-diacritic match
        const record = textTransform.get(normalizeParamString(text));
        if (
            record === undefined ||
            isTransformEntityRecord(record) ||
            record.conflicts === undefined
        ) {
            return undefined;
        }
        return Array.from(record.conflicts.keys());
    }

    public toJSON() {
        const transformsJSON: TransformsJSON = [];
        this.transforms.forEach((transformMap, name) => {
            const transform: [string, TransformRecordJSON][] = [];
            for (const [text, record] of transformMap.entries()) {
                if (isTransformEntityRecord(record)) {
                    transform.push([text, record]);
                } else {
                    transform.push([
                        text,
                        {
                            value: record.value,
                            count: record.count,
                            conflicts: record.conflicts
                                ? Array.from(record.conflicts.entries())
                                : undefined,
                        },
                    ]);
                }
            }
            transformsJSON.push({
                name,
                transform,
            });
        });
        return transformsJSON;
    }

    public static fromJSON(transformsJSON: TransformsJSON) {
        const transforms = new Transforms();
        for (const transform of transformsJSON) {
            const transformRecords: [string, TransformRecord][] =
                transform.transform.map(([text, record]) => {
                    if (isTransformEntityRecord(record)) {
                        return [text, record];
                    }
                    // Legacy format for count, convert to new format
                    const count =
                        (record.count ?? (record as any).original) ? 1 : 0;
                    const valueRecord = {
                        value: record.value,
                        count,
                        conflicts: record.conflicts
                            ? new Map(record.conflicts)
                            : undefined,
                    };
                    return [text, valueRecord];
                });
            transforms.transforms.set(
                transform.name,
                new Map(transformRecords),
            );
        }
        return transforms;
    }

    public toString(prefix = "  ") {
        const transforms = Array.from(this.transforms.entries());
        const result = [];
        for (const [paramName, transformMap] of transforms) {
            result.push(`${prefix}${paramName}:`);
            for (const [key, value] of transformMap) {
                result.push(
                    `${prefix}  ${key} -> ${isTransformEntityRecord(value) ? `(entity types: ${value.entityTypes.join(", ")})` : value.value}`,
                );
            }
        }
        return result.join("\n");
    }
}
