<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=d1517772d8ca463903dd5399018883acd8c7ba20da7a63a8b4c92710e6e5df02 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# graph-utils — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `graph-utils` package provides utility functions for accessing Microsoft Graph APIs and integrating with Microsoft services such as calendars and email. It abstracts common operations, making it easier to interact with these APIs in a consistent and efficient manner.

## What it does

The `graph-utils` package supports a variety of actions related to calendar and email management. It provides functionality for creating, updating, retrieving, and deleting calendar events and emails. Additionally, it includes abstractions for working with multiple providers, such as Microsoft Graph and Google Calendar, enabling integration with different services.

Key capabilities include:

- **Calendar Management**: Actions like `createCalendarEvent`, `deleteCalendarEvent`, `getCalendarEvents`, and `updateCalendarEvent` allow for comprehensive calendar event handling.
- **Email Management**: Actions such as `createEmail`, `deleteEmail`, `getEmails`, and `updateEmail` facilitate email operations.
- **Data Indexing and Search**: The package includes tools for managing and searching calendar event embeddings, enabling efficient semantic search.
- **Provider Abstraction**: Unified interfaces for interacting with different calendar and email providers, including Microsoft Graph and Google APIs.

This package is used by other agents, such as the `calendar` and `email` agents, to provide higher-level functionality.

## Setup

To use the `graph-utils` package, you need to configure the following environment variables:

- `GOOGLE_CALENDAR_CLIENT_ID`: The client ID for the Google Calendar API. Obtain this from the Google Cloud Console by creating a project and enabling the Calendar API.
- `GOOGLE_CALENDAR_CLIENT_SECRET`: The client secret for the Google Calendar API. This is provided alongside the client ID in the Google Cloud Console.
- `MSGRAPH_APP_CLIENTID`: The client ID for the Microsoft Graph API. You can obtain this by registering an application in the Azure portal.
- `MSGRAPH_APP_TENANTID`: The tenant ID for the Microsoft Graph API. This is also available in the Azure portal when registering your application.

Ensure these environment variables are set in your environment (e.g., in a `.env` file or directly in your shell) before using the package. For more detailed instructions on obtaining these values, refer to the hand-written README.

## Key Files

The `graph-utils` package is structured into several key modules, each responsible for specific functionalities:

- [index.ts](./src/index.ts): The main entry point of the package, exporting utility functions and client creation methods for calendar and email services.
- [calendarClient.ts](./src/calendarClient.ts): Implements the `CalendarClient` class, which handles interactions with the calendar API, including authentication and data synchronization.
- [calendarDataIndex.ts](./src/calendarDataIndex.ts): Provides methods for managing and searching calendar event embeddings, enabling semantic search capabilities.
- [calendarProvider.ts](./src/calendarProvider.ts): Defines interfaces and types for calendar-related entities, such as events, attendees, and date range queries.
- [calendarProviderFactory.ts](./src/calendarProviderFactory.ts): Contains logic for detecting and creating the appropriate calendar provider based on the environment configuration.
- [dateUtils.ts](./src/dateUtils.ts): Includes utility functions for date calculations, such as determining the current week or month.
- [emailProvider.ts](./src/emailProvider.ts): Defines interfaces and types for email-related entities, such as messages, addresses, and search queries.
- [emailProviderFactory.ts](./src/emailProviderFactory.ts): Contains logic for detecting and creating the appropriate email provider based on the environment configuration.
- [googleCalendarClient.ts](./src/googleCalendarClient.ts): Implements the Google Calendar provider, including OAuth authentication and token management.

## How to extend

To extend the `graph-utils` package, follow these steps:

1. **Identify the area to extend**: Determine whether your changes involve calendar functionalities, email functionalities, or general utilities.
2. **Locate the relevant file**:
   - For calendar-related extensions, start with [calendarClient.ts](./src/calendarClient.ts), [calendarProvider.ts](./src/calendarProvider.ts), or [calendarProviderFactory.ts](./src/calendarProviderFactory.ts).
   - For email-related extensions, start with [emailProvider.ts](./src/emailProvider.ts) or [emailProviderFactory.ts](./src/emailProviderFactory.ts).
   - For date-related utilities, refer to [dateUtils.ts](./src/dateUtils.ts).
3. **Follow existing patterns**: Review the existing code to understand the structure and conventions. Implement your changes in a consistent manner.
4. **Add new actions**: If your extension requires new actions, define them in the appropriate module and ensure they are exported in [index.ts](./src/index.ts).
5. **Test your changes**: Write tests to validate your new functionality. Ensure that your changes do not introduce regressions or break existing features.

By following these steps, you can effectively contribute to and expand the functionality of the `graph-utils` package.

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

_Auto-generated against commit `366aaf867a7e8e5d130b6c87a365516bab725269` on `2026-07-07T09:05:05.703Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter graph-utils docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
