<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b7cd1dce77abd3b1156d5e23d9ab61ea8ff19bd554c866d4249a22657b5292b2 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# graph-utils — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `graph-utils` package provides utility functions for accessing Microsoft Graph APIs, enabling integration with Microsoft services such as calendars and email. It simplifies the process of interacting with these APIs by offering a unified interface for common operations, making it easier to work with Microsoft Graph and Google Calendar services.

## What it does

The `graph-utils` package is designed to facilitate interactions with Microsoft Graph and Google Calendar APIs. It provides a set of utilities and abstractions for managing calendar and email functionalities. The package supports the following key actions:

- Calendar-related actions: `createCalendarEvent`, `deleteCalendarEvent`, `getCalendarEvents`, and `updateCalendarEvent`. These actions allow you to create, update, retrieve, and delete calendar events.
- Email-related actions: `createEmail`, `deleteEmail`, `getEmails`, and `updateEmail`. These actions enable you to manage email messages, including sending, deleting, retrieving, and updating emails.

The package also includes utilities for date range calculations, embedding management for calendar events, and provider abstractions to support multiple services, such as Microsoft Graph and Google Calendar.

## Setup

To use the `graph-utils` package, you need to configure the following environment variables:

- `GOOGLE_CALENDAR_CLIENT_ID`: The client ID for your Google Calendar API application.
- `GOOGLE_CALENDAR_CLIENT_SECRET`: The client secret for your Google Calendar API application.
- `MSGRAPH_APP_CLIENTID`: The client ID for your Microsoft Graph API application.
- `MSGRAPH_APP_TENANTID`: The tenant ID for your Microsoft Graph API application.

These environment variables are essential for authenticating and interacting with the respective APIs. Refer to the hand-written README for detailed instructions on how to obtain and set these values. Ensure that they are correctly configured in your environment before using the package.

## Key Files

The `graph-utils` package is organized into several key files, each responsible for specific functionalities:

- [index.ts](./src/index.ts): The main entry point of the package, exporting utility functions and client creation methods for calendar and email services.
- [calendarClient.ts](./src/calendarClient.ts): Implements the `CalendarClient` class, which manages interactions with the calendar API, including login, synchronization, and data management.
- [calendarDataIndex.ts](./src/calendarDataIndex.ts): Provides methods for managing and searching calendar event embeddings, enabling efficient event retrieval.
- [calendarProvider.ts](./src/calendarProvider.ts): Defines interfaces and types for calendar-related entities, such as events, attendees, and date range queries.
- [calendarProviderFactory.ts](./src/calendarProviderFactory.ts): Contains factory functions to create calendar providers based on the configured environment variables.
- [dateUtils.ts](./src/dateUtils.ts): Offers utility functions for date range calculations, such as determining the current week or month.
- [emailProvider.ts](./src/emailProvider.ts): Defines interfaces and types for email-related entities, such as messages, addresses, and search queries.
- [emailProviderFactory.ts](./src/emailProviderFactory.ts): Contains factory functions to create email providers based on the configured environment variables.
- [googleCalendarClient.ts](./src/googleCalendarClient.ts): Implements the `ICalendarProvider` interface for the Google Calendar API, including OAuth authentication and token management.

## How to extend

To extend the `graph-utils` package, follow these steps:

1. **Determine the area to extend**: Identify whether your extension involves calendar functionalities, email functionalities, or general utilities.
2. **Locate the relevant file**:
   - For calendar-related extensions, start with [calendarClient.ts](./src/calendarClient.ts), [calendarProvider.ts](./src/calendarProvider.ts), or [calendarProviderFactory.ts](./src/calendarProviderFactory.ts).
   - For email-related extensions, begin with [emailProvider.ts](./src/emailProvider.ts) or [emailProviderFactory.ts](./src/emailProviderFactory.ts).
3. **Understand the existing structure**: Review the existing code to understand the design patterns and conventions used in the package.
4. **Implement new functionality**: Add your new functionality by following the established patterns. For example, you can create new provider implementations or extend existing ones.
5. **Update exports**: Ensure that any new actions or utilities are properly exported in [index.ts](./src/index.ts) so they can be accessed by other parts of the system.
6. **Write tests**: Add tests to validate your changes and ensure that they do not introduce regressions. Use the existing test cases as a reference for writing new ones.

By following these steps, you can effectively contribute to and extend the `graph-utils` package to support additional features or integrate with new services.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → `./dist/index.js` _(not found on disk)_

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../../packages/agentSdk/README.md)
- [@typeagent/aiclient](../../../../packages/aiclient/README.md)
- [@typeagent/common-utils](../../../../packages/utils/commonUtils/README.md)
- [typeagent](../../../../packages/typeagent/README.md)

External: `@azure/identity`, `@azure/identity-broker`, `@azure/identity-cache-persistence`, `@azure/logger`, `@microsoft/microsoft-graph-client`, `chalk`, `date-fns`, `debug`, `dotenv`, `find-config`, `googleapis`, `open`, `proper-lockfile`, `string-compare`

### Used by

- [calendar](../../../../packages/agents/calendar/README.md)
- [email](../../../../packages/agents/email/README.md)

### Files of interest

`./src/index.ts`, `./src/calendarClient.ts`, `./src/calendarDataIndex.ts`, …and 14 more under `./src/`.

### Environment variables

_4 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `MSGRAPH_APP_CLIENTID`
- `MSGRAPH_APP_TENANTID`

---

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-05T09:01:32.154Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter graph-utils docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
