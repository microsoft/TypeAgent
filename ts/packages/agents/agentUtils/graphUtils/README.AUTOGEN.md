<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b7cd1dce77abd3b1156d5e23d9ab61ea8ff19bd554c866d4249a22657b5292b2 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# graph-utils — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `graph-utils` package provides utility functions for accessing Microsoft Graph APIs, enabling integration with Microsoft services such as calendars and email. It simplifies the process of interacting with these APIs by offering a unified interface for common operations. The package also supports integration with Google Calendar, making it a versatile tool for managing calendar and email functionalities across multiple providers.

## What it does

The `graph-utils` package is designed to handle operations related to calendar and email services. It provides a set of actions that allow for creating, updating, retrieving, and deleting calendar events and emails. These actions include:

- Calendar-related actions: `createCalendarEvent`, `deleteCalendarEvent`, `getCalendarEvents`, and `updateCalendarEvent`.
- Email-related actions: `createEmail`, `deleteEmail`, `getEmails`, and `updateEmail`.

The package also includes utilities for date range calculations, embedding generation for calendar data, and provider abstractions to support multiple services such as Microsoft Graph and Google Calendar. It determines the appropriate provider to use based on the environment variables configured.

## Setup

To use the `graph-utils` package, you need to configure the following environment variables:

- `GOOGLE_CALENDAR_CLIENT_ID`: The client ID for your Google Calendar API application.
- `GOOGLE_CALENDAR_CLIENT_SECRET`: The client secret for your Google Calendar API application.
- `MSGRAPH_APP_CLIENTID`: The client ID for your Microsoft Graph API application.
- `MSGRAPH_APP_TENANTID`: The tenant ID for your Microsoft Graph API application.

These environment variables are essential for authenticating and interacting with the respective APIs. To obtain the values for these variables, you may need to register applications in the Google Cloud Console and Microsoft Azure Portal. Refer to the hand-written README for detailed instructions on setting up these credentials.

## Key Files

The `graph-utils` package is organized into several key files, each responsible for specific functionalities:

- [index.ts](./src/index.ts): The main entry point of the package, exporting utility functions and client creation methods for calendar and email services.
- [calendarClient.ts](./src/calendarClient.ts): Implements the `CalendarClient` class, which manages interactions with the calendar API, including login, synchronization, and data management.
- [calendarDataIndex.ts](./src/calendarDataIndex.ts): Provides methods for managing and searching calendar event embeddings, enabling efficient event lookups.
- [calendarProvider.ts](./src/calendarProvider.ts): Defines interfaces and types for calendar-related entities such as events, attendees, and date range queries.
- [calendarProviderFactory.ts](./src/calendarProviderFactory.ts): Contains factory functions to create calendar providers based on the configured environment variables.
- [dateUtils.ts](./src/dateUtils.ts): Offers utility functions for date range calculations, such as determining the current week or month.
- [emailProvider.ts](./src/emailProvider.ts): Defines interfaces and types for email-related entities, including messages, addresses, and search queries.
- [emailProviderFactory.ts](./src/emailProviderFactory.ts): Contains factory functions to create email providers based on the configured environment variables.
- [googleCalendarClient.ts](./src/googleCalendarClient.ts): Implements the `ICalendarProvider` interface for Google Calendar, including OAuth authentication and token management.

## How to extend

To extend the `graph-utils` package, follow these steps:

1. **Determine the area to extend**: Identify whether your extension involves calendar functionalities, email functionalities, or general utilities.
2. **Locate the relevant file**:
   - For calendar-related extensions, start with [calendarClient.ts](./src/calendarClient.ts), [calendarProvider.ts](./src/calendarProvider.ts), or [calendarProviderFactory.ts](./src/calendarProviderFactory.ts).
   - For email-related extensions, focus on [emailProvider.ts](./src/emailProvider.ts) or [emailProviderFactory.ts](./src/emailProviderFactory.ts).
   - For date-related utilities, refer to [dateUtils.ts](./src/dateUtils.ts).
3. **Follow existing patterns**: Review the existing code to understand the structure, naming conventions, and patterns. Implement your changes in a consistent manner.
4. **Add new actions**: If your extension requires new actions, define them in the appropriate files and ensure they are exported in [index.ts](./src/index.ts).
5. **Update provider factories**: If your extension involves a new provider, update the relevant factory file (e.g., [calendarProviderFactory.ts](./src/calendarProviderFactory.ts) or [emailProviderFactory.ts](./src/emailProviderFactory.ts)) to include logic for detecting and creating the new provider.
6. **Write tests**: Add unit and integration tests to validate your changes. Ensure that your modifications do not introduce regressions or break existing functionality.

By adhering to these guidelines, you can effectively extend the `graph-utils` package to support additional features or integrate with new providers.

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

_Auto-generated against commit `88f04471002e27f82ae1ddf73a7ae8acdfe09b5d` on `2026-07-03T09:02:51.801Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter graph-utils docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
