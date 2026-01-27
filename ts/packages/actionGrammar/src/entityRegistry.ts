// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar Entity Registry
 *
 * Provides runtime registration of entities for grammar validation and conversion.
 * Entities can have validators (for matching) and converters (for converting to typed values).
 *
 * - Cache clients use validators only (fast matching)
 * - Agent clients use converters (matching + typed conversion)
 */

/**
 * Entity validator tests if a token matches an entity type.
 * Used by cache clients that only need to know if a match occurred.
 */
export interface EntityValidator {
    /**
     * Validate if a token matches this entity type
     * @param token The token to validate
     * @returns true if the token matches
     */
    validate(token: string): boolean;
}

/**
 * Entity converter both validates and converts tokens to typed values.
 * Used by agent clients that need the actual converted value.
 *
 * @template T The type of value this converter produces
 */
export interface EntityConverter<T> {
    /**
     * Validate if a token matches this entity type
     * @param token The token to validate
     * @returns true if the token matches
     */
    validate(token: string): boolean;

    /**
     * Convert a matching token to its typed value
     * @param token The token to convert
     * @returns The converted value, or undefined if conversion fails
     */
    convert(token: string): T | undefined;
}

/**
 * Registry for managing entity types.
 * Entities are registered at runtime by calling register() functions.
 */
export class EntityRegistry {
    private validators = new Map<string, EntityValidator>();
    private converters = new Map<string, EntityConverter<any>>();

    /**
     * Register an entity with just a validator (for matching only)
     */
    registerValidator(name: string, validator: EntityValidator): void {
        this.validators.set(name, validator);
    }

    /**
     * Register an entity with both validator and converter
     */
    registerConverter<T>(name: string, converter: EntityConverter<T>): void {
        // Converter can also be used as validator
        this.validators.set(name, {
            validate: (token: string) => converter.validate(token),
        });
        this.converters.set(name, converter);
    }

    /**
     * Get a validator for an entity (for cache clients)
     */
    getValidator(name: string): EntityValidator | undefined {
        return this.validators.get(name);
    }

    /**
     * Get a converter for an entity (for agent clients)
     */
    getConverter<T>(name: string): EntityConverter<T> | undefined {
        return this.converters.get(name) as EntityConverter<T> | undefined;
    }

    /**
     * Check if an entity is registered
     */
    hasEntity(name: string): boolean {
        return this.validators.has(name);
    }

    /**
     * Get all registered entity names
     */
    getEntityNames(): string[] {
        return Array.from(this.validators.keys());
    }
}

/**
 * Global entity registry instance
 * Entities must be explicitly registered before use
 */
export const globalEntityRegistry = new EntityRegistry();

/**
 * Helper to create a simple validator from a predicate function
 */
export function createValidator(
    test: (token: string) => boolean,
): EntityValidator {
    return { validate: test };
}

/**
 * Helper to create a converter from validate and convert functions
 */
export function createConverter<T>(
    validate: (token: string) => boolean,
    convert: (token: string) => T | undefined,
): EntityConverter<T> {
    return { validate, convert };
}
