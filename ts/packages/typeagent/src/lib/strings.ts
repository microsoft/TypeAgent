// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Is x a prefix of y
export function stringPrefixCompare(x: string, y: string): number {
    // Find the length of the shorter string
    const length = Math.min(x.length, y.length);
    // Compare the substrings up to the length of the shorter string
    for (let i = 0; i < length; ++i) {
        if (x[i] < y[i]) {
            return -1;
        } else if (x[i] > y[i]) {
            return 1;
        }
    }

    // If all characters are equal up to the minLength, then check the lengths
    if (x.length < y.length) {
        return -1; // x is a prefix of y, since it is shorter
    } else if (x.length > y.length) {
        return 1; // yis a prefix of x
    }

    // Same chars, same length
    return 0;
}

export function lowerAndSort(values: string[] | undefined): void {
    if (values) {
        for (let i = 0; i < values.length; ++i) {
            values[i] = values[i].toLowerCase();
        }
        values.sort();    
    }
}

export function lowerCase(values: string[] | undefined): void {
    if (values) {
        for (let i = 0; i < values.length; ++i) {
            values[i] = values[i].toLowerCase();
        }
    }
}

const caseInsensitiveOptions: Intl.CollatorOptions = { sensitivity: 'base' };  

export function stringCompare(x: string | undefined, y: string | undefined, caseSensitive: boolean): number {
    if (x === undefined) {
         return y === undefined ? 0 : -1;  
    }
    if (y === undefined) {
        return 1;
    }       
    return caseSensitive ? x.localeCompare(y) : x.localeCompare(y, undefined, caseInsensitiveOptions);    
}

export function stringEquals(x: string | undefined, y: string | undefined, caseSensitive: boolean): boolean {
    return caseSensitive ? x === y : stringCompare(x, y, caseSensitive) === 0;    
}

// Uses the djb2 hash
export function stringHashCode(value: string): number {  
    let hash = 5381;  
    for (let i = 0; i < value.length; i++) {  
        hash = (hash * 33) ^ value.charCodeAt(i);  
    }  
    return hash >>> 0; // Ensure the hash is a positive 32-bit integer  
}

export function stringCompareArray(  
    x: string[] | undefined,  
    y: string[] | undefined,  
    caseSensitive: boolean  
): number {  
    if (x === undefined) {
        return y === undefined ? 0 : -1;  
   }
   if (y === undefined) {
       return 1;
   }       
    const xLength = x.length;  
    const yLength = y.length;  
    const minLength = Math.min(xLength, yLength);  
    for (let i = 0; i < minLength; i++) {  
        const cmp = stringCompare(x[i], y[i], caseSensitive);  
        if (cmp !== 0) {  
            return cmp;  
        }  
    }  
    // If items are equal, then shorter string is less in ascending order 
    return (xLength === yLength) ? 0 : (xLength < yLength) ? -1 : 1;
}

export function* getStringChunks(
    values: Iterable<string>,
    maxChunkLength: number,
    maxCharsPerChunk: number,
): IterableIterator<string[]> {
    let chunk: string[] = [];
    let totalCharsInChunk = 0;
    for (let value of values) {
        if (value.length > maxCharsPerChunk) {
            // Truncate strings that are too long
            value = value.slice(0, maxCharsPerChunk);
        }
        if (chunk.length === maxChunkLength || value.length + totalCharsInChunk > maxCharsPerChunk) {
            if (totalCharsInChunk > 0) {
                yield chunk;
            }
            chunk = [];
            totalCharsInChunk = 0;
        }
        chunk.push(value);
        totalCharsInChunk += value.length;
    }
    
    if (totalCharsInChunk > 0) {
        yield chunk;
    }
}

export function stringsToSet(values: string, separator: string= ","): Set<string> {
    let keys = values.split(separator);
    const set = new Set<string>();
    for (let key of keys) {
        key = key.trim();
        if (key) {
            set.add(key);
        }
    }
    return set;
}