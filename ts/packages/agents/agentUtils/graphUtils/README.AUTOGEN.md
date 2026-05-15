<!-- Copyright (c) Microsoft Corporation. -->
<!-- Licensed under the MIT License. -->

<!-- AUTOGEN:DOCS:START -->

<!-- AUTOGEN:DOCS:HASH:sha256=f1db8817a86e72dd1d2a8df7e79d3951f2e1898fbb5b117963e605d9fd973c36 -->
<!-- AUTOGEN:DOCS:SOURCE: ./README.md (hand-written documentation; this file is the AI-generated companion) -->

# graph-utils — AI-generated documentation

> 🤖 **AI-authored documentation**, regenerated daily and validated for length, tone, and link integrity. Cross-check against the deterministic Reference section below before relying on specifics. Hand-written context from [`./README.md`](./README.md) was provided to the model as authoritative source. May lag the working tree by up to 24h — see the staleness footer at the end of this file.

## Overview

The `graph-utils` package provides utility functions to access Microsoft Graph APIs, facilitating integration with Microsoft services such as calendar and email. It abstracts the complexities of interacting with these APIs, offering a simplified interface for common operations.

## What it does

The `graph-utils` package supports various actions related to calendar and email functionalities. It includes utilities for date range calculations, client creation for calendar and email services, and provider abstractions for multi-provider support (Microsoft Graph and Google Calendar). Key actions include `createCalendarEvent`, `deleteCalendarEvent`, `getCalendarEvents`, `updateCalendarEvent`, `createEmail`, `deleteEmail`, `getEmails`, and `updateEmail`.

## Setup

To use the `graph-utils` package, several environment variables need to be set up. These variables are essential for authenticating and interacting with the Microsoft Graph and Google Calendar APIs. The required environment variables are:

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `MSGRAPH_APP_AUTH_MODE`
- `MSGRAPH_APP_CLIENTID`
- `MSGRAPH_APP_CLIENTSECRET`
- `MSGRAPH_APP_PASSWD`
- `MSGRAPH_APP_REDIRECT_PORT`
- `MSGRAPH_APP_TENANTID`
- `MSGRAPH_APP_USERNAME`

Ensure these variables are correctly configured in your environment. For detailed steps on how to obtain and set these values, refer to the hand-written README.

## Key Files
The `graph-utils` package is structured to provide a clear separation of concerns, with dedicated modules for different functionalities:

- [index.ts](./src/index.ts): Exports utility functions and client creation methods for calendar and email services.
- [calendarClient.ts](./src/calendarClient.ts): Contains the `CalendarClient` class, which handles interactions with the calendar API, including login and data synchronization.
- [calendarDataIndex.ts](./src/calendarDataIndex.ts): Provides methods for managing and searching calendar event embeddings.
- [calendarProvider.ts](./src/calendarProvider.ts): Defines interfaces and types for calendar events, attendees, date range queries, and user information.
- [calendarProviderFactory.ts](./src/calendarProviderFactory.ts): Factory functions to create calendar providers based on configuration.
- [dateUtils.ts](./src/dateUtils.ts): Utility functions for date range calculations.
- [emailProvider.ts](./src/emailProvider.ts): Defines interfaces and types for email messages, addresses, search queries, and user information.
- [emailProviderFactory.ts](./src/emailProviderFactory.ts): Factory functions to create email providers based on configuration.

## How to extend

To extend the `graph-utils` package, follow these steps:

1. **Identify the module to extend**: Determine whether your extension involves calendar functionalities, email functionalities, or general utilities.
2. **Open the relevant file**: For calendar-related extensions, start with [calendarClient.ts](./src/calendarClient.ts) or [calendarProvider.ts](./src/calendarProvider.ts). For email-related extensions, start with [emailProvider.ts](./src/emailProvider.ts).
3. **Follow existing patterns**: Review the existing code to understand the structure and patterns used. Implement your changes following these patterns to maintain consistency.
4. **Add new actions**: If you need to add new actions, ensure they are properly defined and exported in [index.ts](./src/index.ts).
5. **Test your changes**: Write tests to validate your extensions. Ensure that your changes do not break existing functionalities.

By following these steps, you can effectively extend the `graph-utils` package to meet your specific requirements.

## Reference

> ⚙️ **Auto-generated, no AI involvement.** Built deterministically from `package.json`, `src/`, and the workspace dependency graph at the commit recorded in the staleness footer at the end of this file. Hand edits to this file will be overwritten on the next run.

### Entry points

- default → [./dist/index.js](./dist/index.js)

### Dependencies

Workspace:

- [@typeagent/agent-sdk](../../../../packages/agentSdk/README.md)
- [@typeagent/common-utils](../../../../packages/utils/commonUtils/README.md)
- [aiclient](../../../../packages/aiclient/README.md)
- [typeagent](../../../../packages/typeagent/README.md)

External: `@azure/identity`, `@azure/identity-broker`, `@azure/identity-cache-persistence`, `@azure/logger`, `@microsoft/microsoft-graph-client`, `chalk`, `date-fns`, `debug`, `dotenv`, `find-config`, `googleapis`, `open`, `proper-lockfile`, `string-compare`

### Used by

- [calendar](../../../../packages/agents/calendar/README.md)
- [email](../../../../packages/agents/email/README.md)

### Files of interest

`./src/index.ts`, `./src/calendarClient.ts`, `./src/calendarDataIndex.ts`, …and 14 more under `./src/`.

### Environment variables

_9 environment variables referenced from `./src/` (set in `ts/.env` or your shell). See the `## Setup` section above for guidance on obtaining each value._

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `MSGRAPH_APP_AUTH_MODE`
- `MSGRAPH_APP_CLIENTID`
- `MSGRAPH_APP_CLIENTSECRET`
- `MSGRAPH_APP_PASSWD`
- `MSGRAPH_APP_REDIRECT_PORT`
- `MSGRAPH_APP_TENANTID`
- `MSGRAPH_APP_USERNAME`

---

_Auto-generated against commit `556ab5f7a233a9f2daa1716328e0b13e5130f7e6` on `2026-05-15T10:06:08.874Z` by `docs-generate.yml`. Links validated at that commit; the working tree may have drifted by up to 24h. Re-run `pnpm --filter graph-utils docs:verify-links` to spot-check._

<!-- AUTOGEN:DOCS:END -->
