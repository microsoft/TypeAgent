// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Args, Command, Flags } from '@oclif/core';
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import { Triple } from '../lib/restaurantTypes.js';
import {
  isBlankNode,
  normalizeBlankNodeId,
  unescapeValue,
  parseNQuadLine,
  getLocalName,
  memoize
} from '../lib/parsingUtils.js';


export default class Parse extends Command {
  static description = 'Parse restaurant data from N-Quad format';

  static examples = [
    '<%= config.bin %> parse path/to/data.nq path/to/output.json',
    '<%= config.bin %> parse path/to/data.nq path/to/output.json --debug',
  ];

  static flags = {
    debug: Flags.boolean({
      char: 'd',
      description: 'Enable debug mode for extra logging',
      default: false,
    }),
  };

  static args = {
    input: Args.string({
      description: 'Path to input N-Quad file',
      required: true,
    }),
    output: Args.string({
      description: 'Path to output JSON file',
      required: true,
    }),
  };

  /**
   * Processes triples with blank nodes into a nested structure
   * @param triples Array of Triple objects
   * @returns Processed entities
   */
  private processBlankNodes(triples: Triple[]): { [id: string]: any } {
    const blankNodeMap: { [id: string]: any } = {};
    const result: { [id: string]: any } = {};

    this.log(`Total triples: ${triples.length}`);

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

    this.log(`Found ${blankNodeSubjects.size} unique blank node subjects`);
    this.log(`Found ${blankNodeObjects.size} unique blank node objects`);

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
        } else if (object.startsWith('http')) {
          // URI reference
          if (predicate.includes('type')) {
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
        } else if (object.startsWith('http')) {
          // URI reference
          if (predicate.includes('type')) {
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
    const resolveBlankNode = (obj: any): any => {
      if (!obj) return obj;

      // Base case: not an object
      if (typeof obj !== 'object') return obj;

      // Handle arrays
      if (Array.isArray(obj)) {
        return obj.map((item) => resolveBlankNode(item));
      }

      // Handle blank node reference
      if (obj._ref && typeof obj._ref === 'string' && isBlankNode(obj._ref)) {
        const normRef = normalizeBlankNodeId(obj._ref);
        return resolveBlankNode(blankNodeMap[normRef]);
      }

      // Handle regular object
      const result: any = {};
      for (const key in obj) {
        result[key] = resolveBlankNode(obj[key]);
      }
      return result;
    };

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
   * @returns Array of restaurant entities
   */
  private extractRestaurants(
    entities: { [id: string]: any },
    triples: Triple[],
  ): any[] {
    this.log('Starting restaurant extraction...');
    const restaurants: { [id: string]: any } = {};
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
        this.log(
          `Progress: Found ${totalRestaurantsCount} restaurants so far`,
        );
        lastPrintedCount =
          Math.floor(totalRestaurantsCount / 10000) * 10000;
      }
    };

    // Create indexing with Maps for better performance
    const triplesBySubject = new Map<string, Triple[]>();
    const triplesByObject = new Map<string, Triple[]>();

    // Optimize predicate checks with regex
    const typeRegex = /type$/;
    const restaurantRegex = /(Restaurant|FoodEstablishment)$/;

    this.log('Building indexes...');
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
    this.log('Indexes built successfully');

    this.log('Identifying restaurant blank nodes...');
    // First, identify all blank nodes that are restaurants
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
    this.log(`Found ${restaurantByBlankNode.size} restaurant blank nodes`);

    this.log('Processing parent entities of restaurant blank nodes...');
    // Find the parent entity of restaurant blank nodes
    for (const blankNodeId of restaurantByBlankNode) {
      const restaurantBlankNode = blankNodeId;

      // Use the index to find parent connections
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
              '@id': parentId,
              '@type': 'Restaurant',
              '@source': 'parent',
              [parentProperty]: {},
            };

            checkAndPrintProgress();
          }

          // Find all triples related to this restaurant blank node
          const restaurantTriples =
            triplesBySubject.get(restaurantBlankNode) || [];
          const parentPropertyObj = restaurants[parentId][parentProperty];

          // Add restaurant data to the parent entity
          restaurantTriples.forEach((rt) => {
            const propName = memoizedGetLocalName(rt.predicate);
            let value: any;

            if (rt.isObjectBlankNode) {
              // Handle nested blank nodes
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

    this.log('Processing standalone restaurants...');
    // Add standalone restaurants (not linked to any parent)
    for (const blankNodeId of restaurantByBlankNode) {
      // Skip if this restaurant is already a child
      if (childRestaurants.has(blankNodeId)) {
        continue;
      }

      // This is a standalone restaurant, collect all its properties
      const restaurantTriples = triplesBySubject.get(blankNodeId) || [];

      // Initialize all properties at once
      const restaurantData = {
        '@id': blankNodeId,
        '@type': 'Restaurant',
        '@source': 'standalone',
      };

      // Build a properties object first, then assign all at once
      const properties: { [key: string]: any } = {};
      restaurantTriples.forEach((rt) => {
        const propName = memoizedGetLocalName(rt.predicate);

        if (rt.isObjectBlankNode) {
          // Handle nested blank nodes
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

    this.log('Processing restaurants from "item" properties in entities...');
    // Also check for entities that refer to restaurants through 'item' property
    for (const entityId in entities) {
      const entity = entities[entityId];

      if (entity.item && typeof entity.item === 'object') {
        // Check if the item is a restaurant
        if (
          entity.item.type === 'Restaurant' ||
          entity.item.type === 'FoodEstablishment'
        ) {
          const restaurantId = entityId + '#item';
          restaurants[restaurantId] = {
            '@id': restaurantId,
            '@type': 'Restaurant',
            '@source': 'item',
            ...entity.item,
          };
          checkAndPrintProgress();
        }
      }
    }

    this.log('Processing direct restaurant entities...');
    // Direct search for entities with type restaurant
    for (const entityId in entities) {
      const entity = entities[entityId];

      // Check for restaurant type
      if (
        entity.type === 'Restaurant' ||
        entity.type === 'FoodEstablishment'
      ) {
        restaurants[entityId] = {
          '@id': entityId,
          '@type': 'Restaurant',
          '@source': 'direct',
          ...entity,
        };
        checkAndPrintProgress();
      }
    }

    this.log(
      `Extraction complete! Total restaurants found: ${Object.keys(restaurants).length}`,
    );
    return Object.values(restaurants);
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Parse);
    const inputFilePath = args.input;
    const outputFilePath = args.output;
    const debug = flags.debug;

    if (!fs.existsSync(inputFilePath)) {
      this.error(`Input file not found: ${inputFilePath}`);
      return;
    }

    try {
      this.log(`Processing file: ${inputFilePath}`);

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
            this.warn(`Parse error on line ${lineCount}: ${line}`);
          }
        }

        // Print progress for large files
        if (lineCount % 10000 === 0) {
          this.log(`Processed ${lineCount} lines...`);
        }
      }

      this.log(
        `Finished reading file. Total lines: ${lineCount}, Successfully parsed: ${triples.length}, Parse errors: ${parseErrors}`,
      );

      // Process triples with blank nodes
      this.log('Processing blank nodes and building entity graph...');
      const allEntities = this.processBlankNodes(triples);

      // Extract restaurants
      this.log('Extracting restaurant data...');
      const restaurantsArray = this.extractRestaurants(allEntities, triples);

      this.log(`Found ${restaurantsArray.length} restaurants`);

      if (debug && restaurantsArray.length === 0) {
        // Debug: list some of the entity types found
        const types = new Set<string>();
        triples.forEach((triple) => {
          if (triple.predicate.includes('type')) {
            types.add(triple.object);
          }
        });
        this.log('Entity types found in the data:');
        types.forEach((type) => this.log(` - ${type}`));
      }

      // Create the output directory if it doesn't exist
      const outputDir = path.dirname(outputFilePath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Write the result to the output file
      fs.writeFileSync(
        outputFilePath,
        JSON.stringify(restaurantsArray, null, 2),
      );

      this.log(
        `Successfully processed ${triples.length} triples and found ${restaurantsArray.length} restaurants.`,
      );
      this.log(`Output saved to ${outputFilePath}`);
    } catch (error) {
      this.error(`Error processing file: ${error}`);
    }
  }
}