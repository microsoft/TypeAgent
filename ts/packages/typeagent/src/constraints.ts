// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { error, Result, success } from "typechat";

/**
 * Diagnostics emitted during constraints validation
 */
type ValidationDiagnostic = {
    category?: string;
    message: string;
};

/**
 * Create a constraints validator
 * The validator handles arrays as well as all values() of the object
 */
export function createConstraintsValidator<T extends object>(
    validationCallback: (value: T, context: ValidationContext) => void,
): (value: T) => Result<T> {
    return (value: T): Result<T> => {
        // Call the validation callback with context
        const context = new ValidationContext();
        validationCallback(value, context);
        // Collect any diagnostics returned
        if (context.diagnostics.length > 0) {
            return error(context.diagnosticString());
        }
        return success(value);
    };
}

/**
 * Context used to collect diagnostics during constraints checking
 */
class ValidationContext {
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
