# Calendar Agent

This package contains the schema defintion and implemtation for implementing a Calendar Agent
that interacts with the Outlook using MS Graph APIs.

This agent depends on the utility library [graph-utils](../graphUtils/src/calendarClient.ts) to implement different calendar actions.

To build the calendar agent, it needs to provide a manifest and an instantiation entry point.  
These are declared in the `package.json` as export paths:

- `./agent/manifest` - The location of the JSON file for the manifest.
- `./agent/handlers` - an ESM module with an instantiation entry point.

### Manifest

When loading calendar agent in a NPM package, the dispatcher first loads the [calendarManifest.json](./src/calendarManifest.json).

### Sample User Requests

To work with the MS Graph, we need a valid demo tenant which comes with pre-existing M365 users. In order to see the calendar event you will need to set that up.

```
create a code reivew meeting tomorrow at 11:00am

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
