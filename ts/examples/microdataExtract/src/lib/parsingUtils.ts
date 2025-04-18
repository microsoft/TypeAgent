// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Triple } from './restaurantTypes.js';

/**
 * Checks if a string is a blank node identifier (handles various formats)
 * @param str The string to check
 * @returns Whether the string is a blank node identifier
 */
export function isBlankNode(str: string): boolean {
  // Handle different blank node formats
  return str.startsWith('_:') || str.match(/^_:[a-zA-Z0-9]+/) !== null;
}

/**
 * Normalizes a blank node ID to a consistent format
 * @param id The blank node ID
 * @returns The normalized ID
 */
export function normalizeBlankNodeId(id: string): string {
  // Just return the original ID since we'll use it as a lookup key
  return id;
}

/**
 * Unescapes characters in a string value from N-Quads
 * @param value The value to unescape
 * @returns The unescaped value
 */
export function unescapeValue(value: string): string {
  // If it's a literal value enclosed in quotes
  if (
    value.startsWith('"') &&
    (value.endsWith('"') || value.includes('"@') || value.includes('"^^'))
  ) {
    // Extract the actual string content and language tag if present
    let content: string;
    let lang = '';

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
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');

    return lang ? `${unescaped} (${lang})` : unescaped;
  }

  // If it's a URL
  if (value.startsWith('<') && value.endsWith('>')) {
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
export function parseNQuadLine(line: string): Triple | null {
  // Skip comments and empty lines
  if (line.trim().length === 0 || line.trim().startsWith('#')) {
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
  let object = '';
  let isObjectBlankNode = false;

  if (objectUri) {
    object = objectUri;
  } else if (objectBlankNode) {
    object = objectBlankNode;
    isObjectBlankNode = true;
  } else if (objectLiteral !== undefined) {
    // Format literal with language or datatype if present
    const lang = objectLang ? `@${objectLang}` : '';
    const datatype = objectDatatype ? `^^<${objectDatatype}>` : '';
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
export function parseNQuadLineManually(line: string): Triple | null {
  // Remove trailing dot and split by whitespace
  const trimmedLine = line.trim();
  if (!trimmedLine.endsWith(' .') && !trimmedLine.endsWith('.')) {
    console.error(`Invalid N-Quad line (no trailing dot): ${line}`);
    return null;
  }

  const withoutDot = trimmedLine.substring(
    0,
    trimmedLine.length - (trimmedLine.endsWith(' .') ? 2 : 1),
  );

  // Split by whitespace, but respect quotes and URIs
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let inUri = false;
  let escaped = false;

  for (let i = 0; i < withoutDot.length; i++) {
    const char = withoutDot[i];

    if (char === '"' && !escaped) {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === '<' && !inQuotes) {
      inUri = true;
      current += char;
    } else if (char === '>' && inUri) {
      inUri = false;
      current += char;
    } else if (char === '\\' && inQuotes) {
      escaped = true;
      current += char;
    } else if (char === ' ' && !inQuotes && !inUri) {
      if (current) {
        parts.push(current);
        current = '';
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
    : subject.replace(/[<>]/g, '');
  const cleanPredicate = predicate.replace(/[<>]/g, '');
  const cleanObject = isObjectBlankNode
    ? object
    : object.startsWith('<')
      ? object.replace(/[<>]/g, '')
      : object;
  const cleanGraph = graph ? graph.replace(/[<>]/g, '') : undefined;

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
export function getLocalName(uri: string): string {
  const lastSlashIndex = uri.lastIndexOf('/');
  const lastHashIndex = uri.lastIndexOf('#');
  const lastSeparatorIndex = Math.max(lastSlashIndex, lastHashIndex);

  if (lastSeparatorIndex !== -1) {
    return uri.substring(lastSeparatorIndex + 1);
  }

  return uri;
}

// Simple memoization function
export function memoize<T, R>(fn: (arg: T) => R): (arg: T) => R {
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