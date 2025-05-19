# Calendar Agent

Calendar agent is **sample code** that explores how to build a typed calendar agent with structured prompting and LLM. This package contains the schema definition and implementation for building a Calendar Agent that interacts the Outlook mail client using Microsoft Graph API. This [article](https://learn.microsoft.com/en-us/graph/tutorials/typescript-app-only?tabs=aad) explores how to work with typescript and Microsoft Graph APIs. Please visit the [link](https://learn.microsoft.com/en-us/graph/api/resources/calendar?view=graph-rest-1.0) to learn about calendar specific Microsoft Graph APIs.

This agent depends on the utility library [graph-utils](../agentUtils/graphUtils/src/calendarClient.ts) to implement different calendar actions.

The calendar agent uses the Microsoft Graph API to interact with the user's calendar. The agent uses `@microsoft/microsoft-graph-client` library to interact with the Microsoft Graph API. The agent enables operations like create, update, delete, find etc on calendar events.

To build the calendar agent, it needs to provide a manifest and an instantiation entry point.  
These are declared in the `package.json` as export paths:

- `./agent/manifest` - The location of the JSON file for the manifest.
- `./agent/handlers` - an ESM module with an instantiation entry point.

### Prerequisites

The code uses Microsoft Graph to access your Microsoft account, Azure Active Directory, and Outlook Microsoft Graph API. Microsoft Graph [quickstart](https://developer.microsoft.com/en-us/graph/quick-start?state=option-typescript) example makes it easy to create you own graph client. Once you have created your graph client application and demo tenant you can update the following variables in the `.env` file:

```
MSGRAPH_APP_CLIENTID
MSGRAPH_APP_CLIENTSECRET
MSGRAPH_APP_TENANTID
```

Note: You have to just do this once to create a Graph Client application.

### Manifest

When loading calendar agent in a NPM package, the dispatcher first loads the [calendarManifest.json](./src/calendarManifest.json).

### Fix issues with identity cache

The calendar agent uses the `@azure/identity-cache-persistence` package to persist the user's identity information using device code flow, if you are facing issues with the identity cache, you can clear the cache by running the following commands:

```
cd %localappdata%/.IdentityService
del typeagent-tokencache*
```

### Sample User Requests

```
create a code review meeting tomorrow at 11:00am

add Alex and Megan to the meeting

Please set up a dimsum lunch meeting next Friday at noon.

Add Isaiah to the lunch meeting

When is the code review meeting

find the dimsum lunch meeting

Add Megan to the lunch meeting

find all my meetings on Friday
```

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
