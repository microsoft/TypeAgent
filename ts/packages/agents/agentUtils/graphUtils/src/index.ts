// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Legacy exports (existing CalendarClient)
export { createCalendarGraphClient, CalendarClient } from "./calendarClient.js";
export { createMailGraphClient, MailClient } from "./mailClient.js";
export { GraphEntity } from "./graphEntity.js";
export { ErrorResponse } from "./graphClient.js";

// Calendar Provider abstraction (multi-provider support)
export {
    ICalendarProvider,
    CalendarEvent,
    CalendarAttendee,
    CalendarDateRangeQuery,
    TimeSlot,
    CalendarUser,
    DeviceCodeCallback,
    CalendarProviderType,
    CalendarProviderConfig,
} from "./calendarProvider.js";

export {
    MSGraphCalendarProvider,
    getMSGraphCalendarProvider,
} from "./msGraphCalendarProvider.js";
export {
    GoogleCalendarClient,
    getGoogleCalendarClient,
    loadGoogleCalendarSettings,
} from "./googleCalendarClient.js";
export {
    createCalendarProvider,
    createCalendarProviderFromConfig,
    detectConfiguredProvider,
    getAvailableProviders,
    isProviderConfigured,
} from "./calendarProviderFactory.js";

// Email Provider abstraction (multi-provider support)
export {
    IEmailProvider,
    EmailMessage,
    EmailAddress,
    EmailSearchQuery,
    EmailUser,
    EmailDeviceCodeCallback,
    EmailProviderType,
    EmailProviderConfig,
} from "./emailProvider.js";

export {
    MSGraphEmailProvider,
    getMSGraphEmailProvider,
} from "./msGraphEmailProvider.js";
export {
    GoogleEmailClient,
    getGoogleEmailClient,
} from "./googleEmailClient.js";
export {
    createEmailProvider,
    createEmailProviderFromConfig,
    detectConfiguredEmailProvider,
    getAvailableEmailProviders,
    isEmailProviderConfigured,
} from "./emailProviderFactory.js";
