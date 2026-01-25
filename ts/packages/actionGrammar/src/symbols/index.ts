// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Built-in grammar symbols
 *
 * This module exports all built-in symbol converters and provides
 * initialization for the global symbol registry.
 */

import { globalSymbolRegistry } from "../symbolModule.js";
import { Ordinal } from "./ordinal.js";
import { Cardinal } from "./cardinal.js";
import { CalendarDate } from "./calendarDate.js";

/**
 * Register all built-in symbols with the global registry
 * This should be called once during initialization
 */
export function registerBuiltInSymbols(): void {
    // Global module symbols
    globalSymbolRegistry.registerConverter("Global.Ordinal", Ordinal);
    globalSymbolRegistry.registerConverter("Global.Cardinal", Cardinal);

    // Calendar module symbols
    globalSymbolRegistry.registerConverter(
        "Calendar.CalendarDate",
        CalendarDate,
    );

    // Also register unqualified names for use within their own modules
    globalSymbolRegistry.registerConverter("Ordinal", Ordinal);
    globalSymbolRegistry.registerConverter("Cardinal", Cardinal);
    globalSymbolRegistry.registerConverter("CalendarDate", CalendarDate);
}

// Export individual symbols for direct import
export { Ordinal, convertOrdinalValue } from "./ordinal.js";
export { Cardinal, convertCardinalValue } from "./cardinal.js";
export { CalendarDate, convertCalendarDateValue } from "./calendarDate.js";
