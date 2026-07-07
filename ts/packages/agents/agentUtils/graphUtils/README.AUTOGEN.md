<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=b7cd1dce77abd3b1156d5e23d9ab61ea8ff19bd554c866d4249a22657b5292b2 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# graph-utils — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `graph-utils` package provides utility functions for accessing Microsoft Graph APIs, enabling integration with Microsoft services such as calendars and email. It simplifies the process of interacting with these APIs by offering a unified interface for common operations.

## What it does

The `graph-utils` package supports a range of actions related to calendar and email management. It provides utilities for creating, updating, retrieving, and deleting calendar events and emails. The package also includes abstractions for working with multiple providers, such as Microsoft Graph and Google Calendar, allowing for flexible integration with different services.

Key actions include:

- Calendar-related actions: `createCalendarEvent`, `deleteCalendarEvent`, `getCalendarEvents`, and `updateCalendarEvent`.
- Email-related actions: `createEmail`, `deleteEmail`, `getEmails`, and `updateEmail`.

The package also includes utilities for date range calculations and embedding-based data indexing for efficient search and retrieval of calendar events.

## Setup

To use the `graph-utils` package, you need to configure the following environment variables:

- `GOOGLE_CALENDAR_CLIENT_ID`: The client ID for Google Calendar API.
- `GOOGLE_CALENDAR_CLIENT_SECRET`: The client secret for Google Calendar API.
- `MSGRAPH_APP_CLIENTID`: The client ID for Microsoft Graph API.
- `MSGRAPH_APP_TENANTID`: The tenant ID for Microsoft Graph API.

These variables are required for authenticating with the respective APIs. Refer to the hand-written README for detailed instructions on how to obtain these values. Ensure they are set in your environment before using the package.

## Key Files

The `graph-utils` package is organized into several key modules, each responsible for specific functionalities:

- [index.ts](./src/index.ts): The main entry point, exporting utility functions and client creation methods for calendar and email services.
- [calendarClient.ts](./src/calendarClient.ts): Implements the `CalendarClient` class, which manages interactions with the calendar API, including login and data synchronization.
- [calendarDataIndex.ts](./src/calendarDataIndex.ts): Provides methods for managing and searching calendar event embeddings, enabling efficient semantic search.
- [calendarProvider.ts](./src/calendarProvider.ts): Defines interfaces and types for calendar events, attendees, date range queries, and user information.
- [calendarProviderFactory.ts](./src/calendarProviderFactory.ts): Factory functions for creating calendar providers based on the detected configuration.
- [dateUtils.ts](./src/dateUtils.ts): Contains utility functions for date range calculations, such as determining the current week or month.
- [emailProvider.ts](./src/emailProvider.ts): Defines interfaces and types for email messages, addresses, search queries, and user information.
- [emailProviderFactory.ts](./src/emailProviderFactory.ts): Factory functions for creating email providers based on the detected configuration.
- [googleCalendarClient.ts](./src/googleCalendarClient.ts): Implements the Google Calendar provider, including OAuth authentication and token management.

## How to extend

To extend the `graph-utils` package, follow these steps:

1. **Determine the area to extend**: Identify whether your extension involves calendar functionalities, email functionalities, or general utilities.
2. **Locate the relevant file**:
   - For calendar-related extensions, start with [calendarClient.ts](./src/calendarClient.ts), [calendarProvider.ts](./src/calendarProvider.ts), or [calendarProviderFactory.ts](./src/calendarProviderFactory.ts).
   - For email-related extensions, start with [emailProvider.ts](./src/emailProvider.ts) or [emailProviderFactory.ts](./src/emailProviderFactory.ts).
   - For date-related utilities, refer to [dateUtils.ts](./src/dateUtils.ts).
3. **Follow existing patterns**: Review the existing code to understand the structure and conventions. Implement your changes in a consistent manner.
4. **Add new actions**: If your extension requires new actions, define them in the appropriate module and ensure they are exported in [index.ts](./src/index.ts).
5. **Test your changes**: Write tests to validate your new functionality. Ensure that your changes do not introduce regressions or break existing features.

By adhering to these guidelines, you can effectively contribute to and extend the functionality of the `graph-utils` package.

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

_Auto-generated against commit `15ef5aa0362e3296bd9d6bd2f001fab704375d27` on `2026-07-06T09:20:03.630Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter graph-utils docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
