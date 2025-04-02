// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "fs";
import * as readline from "readline";
import path from "path";
import { homedir } from "os";

// Define interfaces for our data structures
interface Triple {
    subject: string;
    predicate: string;
    object: string;
    graph?: string;
    isObjectBlankNode?: boolean;
}

interface Restaurant {
    [key: string]: any;
}

/**
 * Checks if a string is a blank node identifier (handles various formats)
 * @param str The string to check
 * @returns Whether the string is a blank node identifier
 */
function isBlankNode(str: string): boolean {
    // Handle different blank node formats
    return str.startsWith("_:") || str.match(/^_:[a-zA-Z0-9]+/) !== null;
}

/**
 * Normalizes a blank node ID to a consistent format
 * @param id The blank node ID
 * @returns The normalized ID
 */
function normalizeBlankNodeId(id: string): string {
    // Just return the original ID since we'll use it as a lookup key
    return id;
}

/**
 * Unescapes characters in a string value from N-Quads
 * @param value The value to unescape
 * @returns The unescaped value
 */
function unescapeValue(value: string): string {
    // If it's a literal value enclosed in quotes
    if (
        value.startsWith('"') &&
        (value.endsWith('"') || value.includes('"@') || value.includes('"^^'))
    ) {
        // Extract the actual string content and language tag if present
        let content: string;
        let lang = "";

        if (value.includes('"@')) {
            const parts = value.split('"@');
            content = parts[0].substring(1);
            lang = parts[1];
        } else if (value.includes('"^^')) {
            const parts = value.split('"^^');
            content = parts[0].substring(1);
        } else {
            content = value.substring(1, value.length - 1);
        }

        const unescaped = content
            .replace(/\\"/g, '"')
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\\\/g, "\\");

        return lang ? `${unescaped} (${lang})` : unescaped;
    }

    // If it's a URL
    if (value.startsWith("<") && value.endsWith(">")) {
        return value.substring(1, value.length - 1);
    }

    // If it's a blank node, return as is
    return value;
}

/**
 * Parses an N-Quad line into a Triple object
 * @param line A line from an N-Quad file
 * @returns A Triple object or null if the line is invalid
 */
function parseNQuadLine(line: string): Triple | null {
    // Skip comments and empty lines
    if (line.trim().length === 0 || line.trim().startsWith("#")) {
        return null;
    }

    // More robust regex pattern to match various N-Quad formats
    const regex =
        /^(?:<([^>]*)>|(_:[^\s]+))\s+<([^>]*)>\s+(?:<([^>]*)>|"([^"\\]*(?:\\.[^"\\]*)*)"(?:@([a-zA-Z-]+)|(?:\^\^<([^>]+)>)?)?|(_:[^\s]+))\s+(?:<([^>]*)>)?\s*\.$/;

    const match = line.match(regex);

    if (!match) {
        // Try alternative parsing for complex cases
        return parseNQuadLineManually(line);
    }

    const subjectUri = match[1];
    const subjectBlankNode = match[2];
    const predicate = match[3];
    const objectUri = match[4];
    const objectLiteral = match[5];
    const objectLang = match[6];
    const objectDatatype = match[7];
    const objectBlankNode = match[8];
    const graph = match[9];

    const subject = subjectUri || subjectBlankNode;
    let object = "";
    let isObjectBlankNode = false;

    if (objectUri) {
        object = objectUri;
    } else if (objectBlankNode) {
        object = objectBlankNode;
        isObjectBlankNode = true;
    } else if (objectLiteral !== undefined) {
        // Format literal with language or datatype if present
        const lang = objectLang ? `@${objectLang}` : "";
        const datatype = objectDatatype ? `^^<${objectDatatype}>` : "";
        object = `"${objectLiteral}"${lang}${datatype}`;
    }

    return {
        subject,
        predicate,
        object,
        graph,
        isObjectBlankNode,
    };
}

/**
 * Manual parsing for N-Quad lines that don't match the regex
 * @param line A line from an N-Quad file
 * @returns A Triple object or null if the line is invalid
 */
function parseNQuadLineManually(line: string): Triple | null {
    // Remove trailing dot and split by whitespace
    const trimmedLine = line.trim();
    if (!trimmedLine.endsWith(" .") && !trimmedLine.endsWith(".")) {
        console.error(`Invalid N-Quad line (no trailing dot): ${line}`);
        return null;
    }

    const withoutDot = trimmedLine.substring(
        0,
        trimmedLine.length - (trimmedLine.endsWith(" .") ? 2 : 1),
    );

    // Split by whitespace, but respect quotes and URIs
    const parts: string[] = [];
    let current = "";
    let inQuotes = false;
    let inUri = false;
    let escaped = false;

    for (let i = 0; i < withoutDot.length; i++) {
        const char = withoutDot[i];

        if (char === '"' && !escaped) {
            inQuotes = !inQuotes;
            current += char;
        } else if (char === "<" && !inQuotes) {
            inUri = true;
            current += char;
        } else if (char === ">" && inUri) {
            inUri = false;
            current += char;
        } else if (char === "\\" && inQuotes) {
            escaped = true;
            current += char;
        } else if (char === " " && !inQuotes && !inUri) {
            if (current) {
                parts.push(current);
                current = "";
            }
        } else {
            escaped = false;
            current += char;
        }
    }

    if (current) {
        parts.push(current);
    }

    // Need at least subject, predicate, and object
    if (parts.length < 3) {
        console.error(`Invalid N-Quad line (not enough parts): ${line}`);
        return null;
    }

    const subject = parts[0];
    const predicate = parts[1];
    const object = parts[2];
    const graph = parts.length > 3 ? parts[3] : undefined;

    // Check if subject is a blank node
    const isSubjectBlankNode = isBlankNode(subject);

    // Check if object is a blank node
    const isObjectBlankNode = isBlankNode(object);

    // Clean up URI brackets
    const cleanSubject = isSubjectBlankNode
        ? subject
        : subject.replace(/[<>]/g, "");
    const cleanPredicate = predicate.replace(/[<>]/g, "");
    const cleanObject = isObjectBlankNode
        ? object
        : object.startsWith("<")
          ? object.replace(/[<>]/g, "")
          : object;
    const cleanGraph = graph ? graph.replace(/[<>]/g, "") : undefined;

    return {
        subject: cleanSubject,
        predicate: cleanPredicate,
        object: cleanObject,
        graph: cleanGraph!,
        isObjectBlankNode,
    };
}

/**
 * Extracts the local name from a URI
 * @param uri The URI
 * @returns The local name
 */
function getLocalName(uri: string): string {
    const lastSlashIndex = uri.lastIndexOf("/");
    const lastHashIndex = uri.lastIndexOf("#");
    const lastSeparatorIndex = Math.max(lastSlashIndex, lastHashIndex);

    if (lastSeparatorIndex !== -1) {
        return uri.substring(lastSeparatorIndex + 1);
    }

    return uri;
}

/**
 * Processes triples with blank nodes into a nested structure
 * @param triples Array of Triple objects
 * @returns Processed entities
 */
function processBlankNodes(triples: Triple[]): { [id: string]: any } {
    const blankNodeMap: { [id: string]: any } = {};
    const result: { [id: string]: any } = {};

    console.log(`Total triples: ${triples.length}`);

    // Count blank nodes for debugging
    const blankNodeSubjects = new Set<string>();
    const blankNodeObjects = new Set<string>();

    triples.forEach((triple) => {
        if (!triple) return;

        if (isBlankNode(triple.subject)) {
            blankNodeSubjects.add(triple.subject);
        }

        if (triple.isObjectBlankNode) {
            blankNodeObjects.add(triple.object);
        }
    });

    console.log(`Found ${blankNodeSubjects.size} unique blank node subjects`);
    console.log(`Found ${blankNodeObjects.size} unique blank node objects`);

    // First, identify all blank nodes and their properties
    triples.forEach((triple) => {
        if (!triple) return;

        const { subject, predicate, object, isObjectBlankNode } = triple;

        // Process blank nodes as subjects
        if (isBlankNode(subject)) {
            const normSubject = normalizeBlankNodeId(subject);

            // Initialize if this blank node hasn't been seen before
            if (!blankNodeMap[normSubject]) {
                blankNodeMap[normSubject] = {};
            }

            // Get property name
            const propertyName = getLocalName(predicate);

            // Handle object value
            let value: any;

            if (isObjectBlankNode) {
                // If object is a blank node, we'll reference it later
                value = { _ref: normalizeBlankNodeId(object) };
            } else if (object.startsWith("http")) {
                // URI reference
                if (predicate.includes("type")) {
                    // For type predicates, just store the type
                    value = getLocalName(object);
                } else {
                    value = object;
                }
            } else {
                // Literal value
                value = unescapeValue(object);
            }

            // Add to blank node properties
            if (blankNodeMap[normSubject][propertyName]) {
                if (!Array.isArray(blankNodeMap[normSubject][propertyName])) {
                    blankNodeMap[normSubject][propertyName] = [
                        blankNodeMap[normSubject][propertyName],
                    ];
                }
                blankNodeMap[normSubject][propertyName].push(value);
            } else {
                blankNodeMap[normSubject][propertyName] = value;
            }
        }
        // Process non-blank nodes as subjects (these are our top-level entities)
        else {
            if (!result[subject]) {
                result[subject] = {};
            }

            const propertyName = getLocalName(predicate);

            let value: any;

            if (isObjectBlankNode) {
                // If object is a blank node, we'll reference it later
                value = { _ref: normalizeBlankNodeId(object) };
            } else if (object.startsWith("http")) {
                // URI reference
                if (predicate.includes("type")) {
                    // For type predicates, just store the type
                    value = getLocalName(object);
                } else {
                    value = object;
                }
            } else {
                // Literal value
                value = unescapeValue(object);
            }

            // Add to entity properties
            if (result[subject][propertyName]) {
                if (!Array.isArray(result[subject][propertyName])) {
                    result[subject][propertyName] = [
                        result[subject][propertyName],
                    ];
                }
                result[subject][propertyName].push(value);
            } else {
                result[subject][propertyName] = value;
            }
        }
    });

    // Second, resolve blank node references recursively
    function resolveBlankNode(obj: any): any {
        if (!obj) return obj;

        // Base case: not an object
        if (typeof obj !== "object") return obj;

        // Handle arrays
        if (Array.isArray(obj)) {
            return obj.map((item) => resolveBlankNode(item));
        }

        // Handle blank node reference
        if (obj._ref && typeof obj._ref === "string" && isBlankNode(obj._ref)) {
            const normRef = normalizeBlankNodeId(obj._ref);
            return resolveBlankNode(blankNodeMap[normRef]);
        }

        // Handle regular object
        const result: any = {};
        for (const key in obj) {
            result[key] = resolveBlankNode(obj[key]);
        }
        return result;
    }

    // Resolve all references in the result
    for (const key in result) {
        result[key] = resolveBlankNode(result[key]);
    }

    return result;
}

/**
 * Extracts restaurants from the processed data
 * @param entities Object containing all entities
 * @param triples Original triples array for additional lookups
 * @returns Object containing only restaurant entities
 */
function extractRestaurants(
    entities: { [id: string]: any },
    triples: Triple[],
): { [id: string]: Restaurant } {
    console.time("extractRestaurants");
    const restaurants: { [id: string]: Restaurant } = {};
    const restaurantByBlankNode = new Set<string>();
    const childRestaurants = new Set<string>();

    let totalRestaurantsCount = 0;
    let lastPrintedCount = 0;

    // Memoize expensive functions
    const memoizedGetLocalName = memoize(getLocalName);
    const memoizedUnescapeValue = memoize(unescapeValue);
    const memoizedNormalizeBlankNodeId = memoize(normalizeBlankNodeId);

    // Function to check and print progress
    const checkAndPrintProgress = () => {
        totalRestaurantsCount = Object.keys(restaurants).length;
        if (totalRestaurantsCount >= lastPrintedCount + 10000) {
            console.log(
                `Progress: Found ${totalRestaurantsCount} restaurants so far`,
            );
            lastPrintedCount =
                Math.floor(totalRestaurantsCount / 10000) * 10000;
        }
    };

    // Create indexing with Maps for better performance
    const triplesBySubject = new Map<string, Triple[]>();
    const triplesByObject = new Map<string, Triple[]>();

    // Optimize predicate checks with regex instead of includes
    const typeRegex = /type$/;
    const restaurantRegex = /(Restaurant|FoodEstablishment)$/;

    console.log("Building indexes...");
    console.time("buildIndexes");
    // Build indexes once - O(n) operation
    triples.forEach((triple) => {
        if (!triple) return;

        // Index by subject
        if (!triplesBySubject.has(triple.subject)) {
            triplesBySubject.set(triple.subject, []);
        }
        triplesBySubject.get(triple.subject)!.push(triple);

        // Index by object for blank nodes
        if (triple.isObjectBlankNode) {
            if (!triplesByObject.has(triple.object)) {
                triplesByObject.set(triple.object, []);
            }
            triplesByObject.get(triple.object)!.push(triple);
        }
    });
    console.timeEnd("buildIndexes");
    console.log("Indexes built successfully");

    console.log("Identifying restaurant blank nodes...");
    console.time("identifyBlankNodes");
    // First, identify all blank nodes that are restaurants - O(n) operation
    triples.forEach((triple) => {
        if (!triple) return;

        if (
            isBlankNode(triple.subject) &&
            typeRegex.test(triple.predicate) &&
            restaurantRegex.test(triple.object)
        ) {
            // Track that this blank node is a restaurant
            restaurantByBlankNode.add(
                memoizedNormalizeBlankNodeId(triple.subject),
            );
        }
    });
    console.timeEnd("identifyBlankNodes");
    console.log(`Found ${restaurantByBlankNode.size} restaurant blank nodes`);

    console.log("Processing parent entities of restaurant blank nodes...");
    console.time("processParentEntities");
    // Find the parent entity of restaurant blank nodes
    for (const blankNodeId of restaurantByBlankNode) {
        const restaurantBlankNode = blankNodeId;

        // Use the index to find parent connections - O(1) lookup instead of O(n) filtering
        const parentConnections =
            triplesByObject.get(restaurantBlankNode) || [];

        parentConnections.forEach((triple) => {
            const parentId = triple.subject;
            const parentProperty = memoizedGetLocalName(triple.predicate);

            if (!isBlankNode(parentId)) {
                // Only process if the parent is not itself a blank node (we want top-level entities)
                // Track that this restaurant is a child
                childRestaurants.add(restaurantBlankNode);

                if (!restaurants[parentId]) {
                    // Initialize the object with all its properties at once
                    restaurants[parentId] = {
                        "@id": parentId,
                        "@type": "Restaurant",
                        "@source": "parent",
                        [parentProperty]: {},
                    };

                    checkAndPrintProgress();
                }

                // Find all triples related to this restaurant blank node - O(1) lookup
                const restaurantTriples =
                    triplesBySubject.get(restaurantBlankNode) || [];
                const parentPropertyObj = restaurants[parentId][parentProperty];

                // Add restaurant data to the parent entity
                restaurantTriples.forEach((rt) => {
                    const propName = memoizedGetLocalName(rt.predicate);
                    let value: any;

                    if (rt.isObjectBlankNode) {
                        // Handle nested blank nodes - O(1) lookup with lazy loading
                        const nestedTriples =
                            triplesBySubject.get(rt.object) || [];
                        value = {};

                        nestedTriples.forEach((nt) => {
                            const nestedPropName = memoizedGetLocalName(
                                nt.predicate,
                            );
                            value[nestedPropName] = memoizedUnescapeValue(
                                nt.object,
                            );
                        });
                    } else {
                        value = memoizedUnescapeValue(rt.object);
                    }

                    parentPropertyObj[propName] = value;
                });
            }
        });
    }
    console.timeEnd("processParentEntities");

    console.log("Processing standalone restaurants...");
    console.time("processStandaloneRestaurants");
    // Add standalone restaurants (not linked to any parent) - O(1) checks with Set
    for (const blankNodeId of restaurantByBlankNode) {
        // Skip if this restaurant is already a child - O(1) check with Set
        if (childRestaurants.has(blankNodeId)) {
            continue;
        }

        // This is a standalone restaurant, collect all its properties - O(1) lookup
        const restaurantTriples = triplesBySubject.get(blankNodeId) || [];

        // Initialize all properties at once
        const restaurantData: Restaurant = {
            "@id": blankNodeId,
            "@type": "Restaurant",
            "@source": "standalone",
        };

        // Build a properties object first, then assign all at once
        const properties: { [key: string]: any } = {};
        restaurantTriples.forEach((rt) => {
            const propName = memoizedGetLocalName(rt.predicate);

            if (rt.isObjectBlankNode) {
                // Handle nested blank nodes - O(1) lookup
                const nestedTriples = triplesBySubject.get(rt.object) || [];
                const nestedProps: { [key: string]: any } = {};

                nestedTriples.forEach((nt) => {
                    const nestedPropName = memoizedGetLocalName(nt.predicate);
                    nestedProps[nestedPropName] = memoizedUnescapeValue(
                        nt.object,
                    );
                });

                properties[propName] = nestedProps;
            } else {
                properties[propName] = memoizedUnescapeValue(rt.object);
            }
        });

        // Assign all properties at once
        Object.assign(restaurantData, properties);
        restaurants[blankNodeId] = restaurantData;
        checkAndPrintProgress();
    }
    console.timeEnd("processStandaloneRestaurants");

    console.log("Processing restaurants from 'item' properties in entities...");
    console.time("processItemProperties");
    // Also check for entities that refer to restaurants through 'item' property
    for (const entityId in entities) {
        const entity = entities[entityId];

        if (entity.item && typeof entity.item === "object") {
            // Check if the item is a restaurant - use direct property check instead of includes
            if (
                entity.item.type === "Restaurant" ||
                entity.item.type === "FoodEstablishment"
            ) {
                const restaurantId = entityId + "#item";
                restaurants[restaurantId] = {
                    "@id": restaurantId,
                    "@type": "Restaurant",
                    "@source": "item",
                    ...entity.item,
                };
                checkAndPrintProgress();
            }
        }
    }
    console.timeEnd("processItemProperties");

    console.log("Processing direct restaurant entities...");
    console.time("processDirectEntities");
    // Direct search for entities with type restaurant
    for (const entityId in entities) {
        const entity = entities[entityId];

        // Use direct property check instead of includes
        if (
            entity.type === "Restaurant" ||
            entity.type === "FoodEstablishment"
        ) {
            restaurants[entityId] = {
                "@id": entityId,
                "@type": "Restaurant",
                "@source": "direct",
                ...entity,
            };
            checkAndPrintProgress();
        }
    }
    console.timeEnd("processDirectEntities");

    console.timeEnd("extractRestaurants");
    console.log(
        `Finished! Total restaurants found: ${Object.keys(restaurants).length}`,
    );
    return restaurants;
}

// Simple memoization function
function memoize<T, R>(fn: (arg: T) => R): (arg: T) => R {
    const cache = new Map<T, R>();
    return (arg: T): R => {
        if (cache.has(arg)) {
            return cache.get(arg)!;
        }
        const result = fn(arg);
        cache.set(arg, result);
        return result;
    };
}

/**
 * Main function to process an N-Quad file
 * @param inputFilePath Path to the input N-Quad file
 * @param outputFilePath Path to save the output JSON file
 * @param debug Whether to enable debug mode
 */
export async function processNQuadFile(
    inputFilePath: string,
    outputFilePath: string,
    debug: boolean = false,
): Promise<void> {
    try {
        console.log(`Processing file: ${inputFilePath}`);

        // Create a read stream for the input file
        const fileStream = fs.createReadStream(inputFilePath);

        // Create a readline interface to read line by line
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });

        const triples: Triple[] = [];
        let lineCount = 0;
        let parseErrors = 0;

        // Process each line
        for await (const line of rl) {
            lineCount++;
            const triple = parseNQuadLine(line);

            if (triple) {
                triples.push(triple);
            } else {
                parseErrors++;
                if (debug) {
                    console.error(`Parse error on line ${lineCount}: ${line}`);
                }
            }

            // Print progress for large files
            if (lineCount % 10000 === 0) {
                console.log(`Processed ${lineCount} lines...`);
            }
        }

        console.log(
            `Finished reading file. Total lines: ${lineCount}, Successfully parsed: ${triples.length}, Parse errors: ${parseErrors}`,
        );

        // Process triples with blank nodes
        console.log("Processing blank nodes and building entity graph...");
        const allEntities = processBlankNodes(triples);

        // Extract restaurants
        console.log("Extracting restaurant data...");
        const restaurants = extractRestaurants(allEntities, triples);

        // Convert to array
        const restaurantsArray = Object.values(restaurants);

        console.log(`Found ${restaurantsArray.length} restaurants`);

        if (debug && restaurantsArray.length === 0) {
            // Debug: list some of the entity types found
            const types = new Set<string>();
            triples.forEach((triple) => {
                if (triple.predicate.includes("type")) {
                    types.add(triple.object);
                }
            });
            console.log("Entity types found in the data:");
            types.forEach((type) => console.log(` - ${type}`));
        }

        // Write the result to the output file
        fs.writeFileSync(
            outputFilePath,
            JSON.stringify(restaurantsArray, null, 2),
        );

        console.log(
            `Successfully processed ${triples.length} triples and found ${restaurantsArray.length} restaurants.`,
        );
        console.log(`Output saved to ${outputFilePath}`);
    } catch (error) {
        console.error("Error processing file:", error);
    }
}

async function getSubfolders(parentDir: string): Promise<string[]> {
    const subfolders: string[] = [];
    const items = await fs.promises.readdir(parentDir, { withFileTypes: true });

    for (const item of items) {
        if (item.isDirectory()) {
            subfolders.push(path.join(parentDir, item.name));
        }
    }

    return subfolders;
}

async function main() {
    const parentFolder = path.join(
        homedir(),
        "Downloads",
        "restaurant common crawl",
    );
    const subfolders = await getSubfolders(parentFolder);
    for (const folder of subfolders) {
        const inputFile = path.join(folder, path.basename(folder));
        const outputFile = path.join(
            folder,
            path.basename(inputFile, path.extname(inputFile)) + ".json",
        );

        await processNQuadFile(inputFile, outputFile);
    }

    console.log("Conversion complete!");
}

main().catch(console.error);
