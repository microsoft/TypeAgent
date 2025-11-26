// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { error, success, Result } from "typechat";

/**
 * Represents an object that can validate that an object of T matches constraints on its values.
 * Examples of constraints include number ranges, email address formats, etc.
 * Constraints checking is applied after structural JSON validation
 */
export interface TypeChatConstraintsValidator<T extends object> {
    validateConstraints(value: T): Result<T>;
}

/**
 * Diagnostics emitted during constraints validation
 */
export type ValidationDiagnostic = {
    category?: string;
    message: string;
};

/**
 * Create a constraints validator
 * The validator handles arrays as well as all values() of the object
 */
export function createConstraintsValidator<T extends object>(
    validationCallback: (value: T, context: ValidationContext) => void,
): TypeChatConstraintsValidator<T> {
    const validator: TypeChatConstraintsValidator<T> = {
        validateConstraints: validate,
    };
    return validator;

    function validate(value: T): Result<T> {
        // Call the validation callback with context
        const context = new ValidationContext();
        validationCallback(value, context);
        // Collect any diagnostics returned
        if (context.diagnostics.length > 0) {
            return error(context.diagnosticString());
        }
        return success(value);
    }
}

/**
 * Context used to collect diagnostics during constraints checking
 */
export class ValidationContext {
    private _errors: ValidationDiagnostic[];

    constructor() {
        this._errors = [];
    }
    /**
     * Diagnostics collected so far
     */
    public get diagnostics(): ValidationDiagnostic[] {
        return this._errors;
    }
    /**
     * Add a diagnostic message
     * @param message
     */
    public addMessage(message: string): void {
        this._errors.push({ message: message });
    }
    /**
     * Add a diagnostic
     * @param error
     */
    public addDiagnostic(category: string, message: string): void {
        this._errors.push({ category: category, message: message });
    }
    /**
     * Construct a diagnostic string
     * @param includeCategory whether to include the diagnostic category
     * @returns
     */
    public diagnosticString(): string {
        const diagnostics = this._errors.map((d) =>
            d.category ? d.category + ", " + d.message : d.message,
        );
        return diagnostics.join("\n");
    }
}
