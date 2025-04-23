// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import * as readline from "readline";
import { Readable, Writable } from "stream";
import { fileURLToPath } from "url";
import { FileSystem } from "./index.js";
import path from "path";

export type Path = string;

/**
 * Write object as JSON to a stream
 * @param: stream to write to
 */
export function writeObject(writer: Writable, obj: any): Promise<void> {
    const json = toJsonLine(obj);
    return new Promise<void>((resolve, reject) => {
        writer.write(json, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

/**
 * Write objects to a stream or file. Objects are written in JSON line format
 * @param output stream or file to write to
 * @param objects objects to write
 */
export async function writeObjects<T>(
    output: Writable | fs.PathLike,
    objects: T[],
): Promise<void> {
    if (objects.length > 0) {
        if (isWritable(output)) {
            for (const obj of objects) {
                await writeObject(output, obj);
            }
        } else {
            await writeObjectsImpl(output, "w", objects);
        }
    }
}

/**
 * Append objects to a stream or file. Objects are appended in JSON line format
 * @param output stream or file to write to
 * @param objects objects to write
 */
export async function appendObjects<T>(
    output: Writable | fs.PathLike,
    objects: T[],
): Promise<void> {
    if (isWritable(output)) {
        for (const obj of objects) {
            await writeObject(output, obj);
        }
    } else {
        await writeObjectsImpl(output, "a", objects);
    }
}

/**
 * Iteratively read objects from stream or file with JSON lines.
 * Objects are read in JSON line format and deserialized
 * @param output stream or file to read from
 * @returns: Asynchronous iterator over objects
 */
export async function* readObjects<T>(
    input: Readable | fs.PathLike,
): AsyncIterableIterator<T> {
    for await (const line of readLines(input)) {
        const obj = JSON.parse(line);
        yield obj;
    }
}

/**
 * Iteratively search for objects from a stream or file
 * Yield matching objects
 * @param input filePath or stream
 */
export async function* filterObjects<T>(
    input: Readable | fs.PathLike,
    predicate: (value: T) => boolean,
) {
    for await (const obj of readObjects<T>(input)) {
        if (predicate(obj)) {
            yield obj;
        }
    }
}

/**
 * Iteratively streams lines from the input stream...
 * @param input a Readable object or a filePath
 */
export async function* readLines(
    input: Readable | fs.PathLike,
): AsyncIterableIterator<string> {
    let readStream: fs.ReadStream | undefined;
    let rl: readline.Interface | undefined;

    if (isReadable(input)) {
        rl = readline.createInterface(input);
    } else {
        if (!fs.existsSync(input)) {
            return;
        }
        readStream = fs.createReadStream(input);
        rl = readline.createInterface(readStream);
    }
    try {
        for await (const line of rl) {
            yield line;
        }
    } finally {
        if (readStream) {
            await closeReader(readStream);
        }
        if (rl) {
            rl.close();
        }
    }
}

/**
 * Read all objects from a file or stream containing Json lines.
 * Each object is on its own JSON line
 * @param input stream or file to read
 * @returns array of objects
 */
export async function readAllObjects<T>(input: Readable | Path): Promise<T[]> {
    let items: T[] = [];
    for await (const obj of readObjects<T>(input)) {
        items.push(obj);
    }
    return items ?? [];
}

type WriteMode = "w" | "a";

async function writeObjectsImpl<T>(
    filePath: fs.PathLike,
    mode: WriteMode,
    objects: T[],
): Promise<void> {
    const writer = await createWriteStream(filePath, mode);
    try {
        for (let obj of objects) {
            await writeObject(writer, obj);
        }
    } finally {
        await closeWriter(writer);
    }
}

async function createWriteStream(
    filePath: fs.PathLike,
    mode?: WriteMode,
): Promise<fs.WriteStream> {
    return new Promise<fs.WriteStream>((resolve, reject) => {
        const writer = fs.createWriteStream(filePath, { flags: mode });
        writer.on("open", (fd) => {
            resolve(writer);
        });
        writer.on("error", (err) => {
            writer.close();
            reject(err);
        });
    });
}

async function closeWriter(writer: fs.WriteStream): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        writer.close((err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

async function closeReader(reader: fs.ReadStream): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        reader.close((err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
            ("");
        });
    });
}

/**
 * Get full path
 * @param filePath
 * @param basePath
 * @returns
 */
export function getAbsolutePath(
    filePath: string,
    basePath: string | URL,
): string {
    if (path.isAbsolute(filePath)) {
        // already absolute
        return filePath;
    }
    return fileURLToPath(new URL(filePath, basePath));
}

/**
 * Get the name of the file referenced by filePath, without extension
 * @param filePath
 * @returns
 */
export function getFileName(filePath: string): string {
    return path.basename(filePath, path.extname(filePath));
}

/**
 * Read all text from a file.
 * @param filePath can be direct or relative
 * @param basePath if filePath is relative, then this is a basePath
 * @returns
 */
export async function readAllText(
    filePath: string,
    basePath?: string,
): Promise<string> {
    if (basePath) {
        filePath = path.join(basePath, filePath);
    }
    return fs.promises.readFile(filePath, "utf-8");
}

/**
 * Read all lines from the given filePath
 * @param filePath
 * @param basePath (optional) If filePath is a relative path
 * @param removeEmpty
 * @param trim
 * @returns
 */
export async function readAllLines(
    filePath: string,
    basePath?: string | undefined,
    removeEmpty: boolean = false,
    trim: boolean = false,
): Promise<string[]> {
    let lines = (await readAllText(filePath, basePath)).split(/\r?\n/);
    lines = trim ? lines.map((l) => l.trim()) : lines;
    lines = removeEmpty ? lines.filter((l) => l.length > 0) : lines;
    return lines;
}

/**
 * Write the given lines to a file
 * @param lines
 * @param filePath
 * @param basePath
 */
export async function writeAllLines(
    lines: string[],
    filePath: string,
    basePath?: string,
) {
    if (basePath) {
        filePath = path.join(basePath, filePath);
    }
    const buffer = lines.join("\n");
    await fs.promises.writeFile(filePath, buffer);
}

/**
 * Read a JSON object from the given file.
 * @param filePath
 * @param validator
 * @returns
 */
export async function readJsonFile<T>(
    filePath: string,
    defaultValue?: T | undefined,
    fSys?: FileSystem | undefined,
    validator?: ((obj: any) => T) | undefined,
): Promise<T | undefined> {
    try {
        let json;
        if (fSys) {
            json = await fSys.read(filePath);
        } else {
            json = await fs.promises.readFile(filePath, {
                encoding: "utf-8",
            });
        }
        if (json.length > 0) {
            const obj = JSON.parse(json);
            return validator ? validator(obj) : <T>obj;
        }
    } catch (err: any) {
        if (err.code !== "ENOENT") {
            throw err;
        }
    }
    return defaultValue ?? undefined;
}

/**
 * Write a json object to a file
 * @param filePath
 * @param value
 * @param fSys
 * @returns
 */
export async function writeJsonFile(
    filePath: string,
    value: any,
    fSys?: FileSystem,
): Promise<void> {
    const json = JSON.stringify(value);
    return fSys
        ? fSys.write(filePath, json)
        : fs.promises.writeFile(filePath, json);
}

/**
 * Writes an object array to a multiple json files, one per object
 * @param destFolderPath
 * @param baseFileName
 * @param objects
 * @param fSys
 */
export async function writeJsonFiles(
    destFolderPath: string,
    baseFileName: string,
    objects: any[],
    fSys?: FileSystem,
) {
    if (objects.length === 0) {
        return;
    }
    await ensureDir(destFolderPath);
    const padLength = objects.length.toString().length;
    for (let i = 0; i < objects.length; ++i) {
        let fileId = (i + 1).toString().padStart(padLength, "0");
        let turnFilePath = path.join(
            destFolderPath,
            `${baseFileName}_${fileId}.json`,
        );
        await writeJsonFile(turnFilePath, objects[i], fSys);
    }
}

export async function readFile(
    filePath: string,
    fSys?: FileSystem,
): Promise<Buffer | undefined> {
    try {
        let buffer: Buffer;
        if (fSys) {
            buffer = await fSys.readBuffer(filePath);
        } else {
            buffer = await fs.promises.readFile(filePath);
        }
        return buffer.length > 0 ? buffer : undefined;
    } catch (err: any) {
        if (err.code !== "ENOENT") {
            throw err;
        }
    }
    return undefined;
}

export function writeFile(
    filePath: string,
    buffer: Buffer,
    fSys?: FileSystem,
): Promise<void> {
    return fSys
        ? fSys.write(filePath, buffer)
        : fs.promises.writeFile(filePath, buffer);
}

export async function readMapFile<K, V>(
    filePath: string,
    fSys?: FileSystem,
    validator?: (obj: any) => [[K, V]],
): Promise<Map<K, V>> {
    const entries = await readJsonFile<[[K, V]]>(
        filePath,
        undefined,
        fSys,
        validator,
    );
    return new Map<K, V>(entries);
}

export async function writeMapFile<K, V>(
    filePath: string,
    map: Map<K, V>,
): Promise<void> {
    // Convert the Map to an array of key-value pairs
    const entries = Array.from(map.entries());
    await writeJsonFile(filePath, entries);
}

/**
 * Remove file from given file system
 * @param filePath
 * @param fSys
 * @returns true if success, else false
 */
export async function removeFile(
    filePath: string,
    fSys?: FileSystem,
): Promise<boolean> {
    try {
        if (fSys) {
            await fSys.removeFile(filePath);
        } else {
            await fs.promises.unlink(filePath);
        }
        return true;
    } catch {}
    return false;
}

export async function ensureDir(
    folderPath: string,
    fSys?: FileSystem,
): Promise<string> {
    if (fSys) {
        await fSys.ensureDir(folderPath);
    } else {
        if (!fs.existsSync(folderPath)) {
            await fs.promises.mkdir(folderPath, { recursive: true });
        }
    }
    return folderPath;
}

/**
 * Remove directory from given file system
 * @param folderPath
 * @param fSys
 * @returns true if success. False if folder does not exist
 */
export async function removeDir(
    folderPath: string,
    fSys?: FileSystem,
): Promise<boolean> {
    try {
        if (fSys) {
            await fSys.rmdir(folderPath);
        } else {
            await fs.promises.rm(folderPath, { recursive: true, force: true });
        }
        return true;
    } catch (err: any) {
        if (err.code !== "ENOENT") {
            throw err;
        }
    }
    return false;
}

export async function cleanDir(folderPath: string, fSys?: FileSystem) {
    await removeDir(folderPath, fSys);
    await ensureDir(folderPath, fSys);
}

/**
 * Remove file from given file system
 * @param oldPath
 * @param newPath
 * @param fSys
 * @returns true if success. False if it does not exist
 */
export function renameFileSync(oldPath: string, newPath: string): boolean {
    try {
        fs.renameSync(oldPath, newPath);
        return true;
    } catch (err: any) {
        if (err.code !== "ENOENT") {
            throw err;
        }
    }
    return false;
}

export async function writeBlobFile(
    filePath: string,
    blob: Blob,
    fSys?: FileSystem,
): Promise<void> {
    const buffer = Buffer.from(await blob.arrayBuffer());
    return fSys
        ? fSys.write(filePath, buffer)
        : fs.promises.writeFile(filePath, buffer);
}

export function readFileFromRelativePathSync(
    basePath: string,
    relativePath: string,
): string {
    const fullPath = fileURLToPath(new URL(relativePath, basePath));
    return fs.readFileSync(fullPath, "utf-8");
}

/**
 * Serialize object to JSON line
 * @param obj
 * @returns
 */
export function toJsonLine(obj: any): string {
    return JSON.stringify(obj) + "\n";
}

/**
 * Serialize array to Json Lines
 * @param objects
 * @returns
 */
export function toJsonLines(objects: any[]): string {
    if (objects.length === 1) {
        return toJsonLine(objects[0]);
    }

    let json = "";
    for (let obj of objects) {
        json += toJsonLine(obj);
    }
    return json;
}

/**
 * Deserialize json lines into objects
 * @param lines
 * @returns
 */
export function fromJsonLines<T>(lines: string): T[] {
    let objects: T[] = [];
    if (lines.length > 0) {
        for (let json in lines.split(/\r?\n/)) {
            json = json.trim();
            if (json.length > 0) {
                objects.push(JSON.parse(json));
            }
        }
    }
    return objects;
}

export function getDistinctValues<T>(
    items: T[],
    keyAccessor: (item: T) => string,
): T[] {
    if (items.length == 0) {
        return items;
    }

    const distinct = new Map<string, T>();
    for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        distinct.set(keyAccessor(item), item);
    }
    return [...distinct.values()];
}

/**
 * Returns true if the path is to a directory
 * @param path
 * @returns true or false
 */
export function isDirectoryPath(path: string): boolean {
    try {
        return fs.statSync(path).isDirectory();
    } catch {}
    return false;
}

/**
 * Returns true if the path is to a file
 * @param path
 * @returns true or false
 */
export function isFilePath(path: string): boolean {
    try {
        return fs.statSync(path).isFile();
    } catch {}
    return false;
}

function isWritable(writer: any): writer is Writable {
    return typeof writer === "function" && writer instanceof Writable;
}

function isReadable(reader: any): reader is Readable {
    return typeof reader === "function" && reader instanceof Readable;
}
