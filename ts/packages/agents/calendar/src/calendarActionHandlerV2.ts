// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseCalendarDateTime } from "datetime-utils";
import {
    createCalendarGraphClient,
    CalendarClient,
    //getNormalizedDateRange,
    //getNormalizedDateTimes,
    //getTimeZoneName,
    GraphEntity,
    //getUniqueLocalId,
    //ErrorResponse,
} from "graph-utils";
import chalk from "chalk";
import {
    CalendarAction,
    //CalendarDateTime,
    Event,
    EventReference,
} from "./calendarActionsSchemaV2.js";
/*import {
    getTimeRangeBasedQuery,
    getNWeeksDateRangeISO,
} from "./calendarQueryHelper.js";*/
import {
    SessionContext,
    AppAction,
    AppAgent,
    ActionContext,
} from "@typeagent/agent-sdk";
import {
    //createActionResultFromTextDisplay,
    createActionResultFromHtmlDisplay,
    createActionResultFromError,
} from "@typeagent/agent-sdk/helpers/action";
import {
    CommandHandlerNoParams,
    CommandHandlerTable,
    getCommandInterface,
} from "@typeagent/agent-sdk/helpers/command";
import {
    displayStatus,
    displaySuccess,
    displayWarn,
} from "@typeagent/agent-sdk/helpers/display";

import registerDebug from "debug";
const debug = registerDebug("typeagent:calendar");
export class CalendarClientLoginCommandHandler
    implements CommandHandlerNoParams
{
    public readonly description = "Log into MS Graph to access calendar";
    public async run(context: ActionContext<CalendarActionContext>) {
        const calendarClient: CalendarClient | undefined =
            context.sessionContext.agentContext.calendarClient;
        if (calendarClient === undefined) {
            throw new Error("Calendar client not initialized");
        }
        if (calendarClient.isAuthenticated()) {
            displayWarn("Already logged in", context);
            return;
        }

        await calendarClient.login((prompt) => {
            displayStatus(prompt, context);
        });

        displaySuccess("Successfully logged in", context);
    }
}

export class CalendarClientLogoutCommandHandler
    implements CommandHandlerNoParams
{
    public readonly description = "Log out of MS Graph to access calendar";
    public async run(context: ActionContext<CalendarActionContext>) {
        const calendarClient: CalendarClient | undefined =
            context.sessionContext.agentContext.calendarClient;
        if (calendarClient === undefined) {
            throw new Error("Calendar client not initialized");
        }
        if (calendarClient.logout()) {
            displaySuccess("Successfully logged out", context);
        } else {
            displayWarn("Already logged out", context);
        }
    }
}

const handlers: CommandHandlerTable = {
    description: "Calendar login command",
    defaultSubCommand: "login",
    commands: {
        login: new CalendarClientLoginCommandHandler(),
        logout: new CalendarClientLogoutCommandHandler(),
    },
};

export function instantiate(): AppAgent {
    return {
        initializeAgentContext: initializeCalendarContext,
        updateAgentContext: updateCalendarContext,
        executeAction: executeCalendarAction,
        ...getCommandInterface(handlers),
    };
}

interface GraphEventRefIds {
    graphEventId: string;
    localEventId: string;
}

export type CalendarActionContext = {
    calendarClient: CalendarClient | undefined;
    graphEventIds: GraphEventRefIds[] | undefined;
    mapGraphEntity: Map<string, GraphEntity> | undefined;
};

async function initializeCalendarContext() {
    return {
        calendarClient: undefined,
        graphEventIds: undefined,
        mapGraphEntity: undefined,
    };
}

/*
function deleteLocalGraphEventId(
    localEventId: string,
    calendarContext: CalendarActionContext,
) {
    if (calendarContext.graphEventIds !== undefined) {
        let index = calendarContext.graphEventIds.findIndex(
            (graphEventRefId) => graphEventRefId.localEventId === localEventId,
        );
        if (index !== -1) {
            calendarContext.graphEventIds.splice(index, 1);
            calendarContext.mapGraphEntity?.delete(localEventId);
        }
    }
}
*/

/*
function getGraphEventId(
    localEventId: string,
    calendarContext?: CalendarActionContext,
) {
    let graphEventId = undefined;
    if (localEventId !== undefined && calendarContext !== undefined) {
        let graphEventRefIds = calendarContext.graphEventIds?.find(
            (graphEventRefId) => graphEventRefId.localEventId === localEventId,
        );
        if (graphEventRefIds !== undefined) {
            graphEventId = graphEventRefIds.graphEventId;
        }
    }
    return graphEventId;
}*/

/*
function getLocalEventId(
    graphEventId: string,
    calendarContext?: CalendarActionContext,
) {
    let localEventId = undefined;
    if (graphEventId !== undefined && calendarContext !== undefined) {
        let graphEventRefIds = calendarContext.graphEventIds?.find(
            (graphEventRefId) => graphEventRefId.graphEventId === graphEventId,
        );
        if (graphEventRefIds !== undefined) {
            localEventId = graphEventRefIds.localEventId;
        }
    }
    return localEventId;
}
*/

async function updateCalendarContext(
    enable: boolean,
    context: SessionContext<CalendarActionContext>,
): Promise<void> {
    if (enable) {
        context.agentContext.calendarClient = await createCalendarGraphClient();

        if (context.agentContext.calendarClient) {
            context.agentContext.graphEventIds = [];
            context.agentContext.mapGraphEntity = new Map();
        }
    } else {
        context.agentContext.calendarClient = undefined;
    }
}

async function executeCalendarAction(
    action: AppAction,
    context: ActionContext<CalendarActionContext>,
) {
    let result = await handleCalendarAction(
        action as CalendarAction,
        context.sessionContext.agentContext,
    );
    return result;
}

/*
function findEventsDisplayHtml(events: any[] | GraphEntity): string {
    if (events) {
        if (Array.isArray(events) && events.length > 0) {
            const eventsCopy = events.map(
                (event) => (delete event.attendees, event),
            );

            let htmlEvents: string = `<div style="height: 100px; overflow-y: scroll; border: 1px solid #ccc; padding: 10px; font-family: sans-serif; font-size: small">Outlook Calendar Events`;
            eventsCopy.forEach((event) => {
                const calendarItemLink = `https://outlook.office.com/calendar/item/${encodeURIComponent(event.id)}`;
                htmlEvents +=
                    `<p><a href="${calendarItemLink}" target="_blank">` +
                    `<h4>${event.subject}</a>` +
                    `</p>`;
            });
            htmlEvents += `</div>`;
            return htmlEvents;
        } else {
            const event = events as GraphEntity;
            const calendarItemLink = `https://outlook.office.com/calendar/item/${encodeURIComponent(event.id)}`;
            const htmlEvent =
                `<div>Outlook Calendar Events<a href="${calendarItemLink}" target="_blank">` +
                `<h4>${event.subject}</h4></a><div style="font-size: 12px;">` +
                "</div></div>";
            return htmlEvent;
        }
    }
    return "";
}


async function getParticipantsToAdd(
    participants: string[] | undefined,
    calendarClient: CalendarClient,
): Promise<string[] | undefined> {
    let participantsToAdd: string[] | undefined = [];
    if (participants && participants.length > 0) {
        participantsToAdd =
            await calendarClient.getEmailAddressesOfUsernamesLocal(
                participants,
            );
        if (!participantsToAdd || participantsToAdd?.length === 0) {
            participantsToAdd?.push(...participants);
        }
    }
    return participantsToAdd;
}



async function addParticipantsToMeeting(
    participantsInMeeting: string[] | undefined,
    participantsToAdd: string[] | undefined,
    description: string,
    dateInfo: any,
    calendarClient: CalendarClient,
): Promise<string | undefined | ErrorResponse> {
    let emailAddrsInMeeting: string[] | undefined = await getParticipantsToAdd(
        participantsInMeeting,
        calendarClient,
    );

    let emailAddrsToAdd: string[] | undefined = await getParticipantsToAdd(
        participantsToAdd,
        calendarClient,
    );

    let eventId = undefined;
    if (emailAddrsToAdd && emailAddrsToAdd.length > 0) {
        eventId = await calendarClient.addParticipantsToMeeting(
            description,
            dateInfo ? dateInfo.startDate : undefined,
            dateInfo ? dateInfo.endDate : undefined,
            getTimeZoneName(),
            emailAddrsInMeeting ?? [],
            emailAddrsToAdd,
        );
    }
    return eventId;
}


function updateCalendarEntity(
    calendarContext: CalendarActionContext,
    eventid: string,
    emailAddrsToAdd: string[],
) {
    const localEventId = getLocalEventId(eventid, calendarContext);
    if (localEventId !== undefined) {
        let calendarEvent = calendarContext.mapGraphEntity?.get(localEventId);
        if (calendarEvent !== undefined) {
            calendarEvent.participants?.push(...emailAddrsToAdd);
            calendarEvent.lastModifiedDateTime = new Date().toISOString();
            calendarContext.mapGraphEntity?.set(localEventId, calendarEvent);
        }
    }
    return localEventId;
}

function addCalendarEntity(
    calendarContext: CalendarActionContext,
    eventid: string,
    description: string,
    emailAddrsInMeeting: string[],
): string | undefined {
    if (calendarContext && calendarContext.graphEventIds !== undefined) {
        const localId = getUniqueLocalId();
        calendarContext.graphEventIds.push({
            graphEventId: `${eventid}`,
            localEventId: `${localId}`,
        });

        if (calendarContext.mapGraphEntity !== undefined) {
            calendarContext.mapGraphEntity.set(localId, {
                id: `${eventid}`,
                localId: `${localId}`,
                type: "Event",
                subject: description,
                participants: emailAddrsInMeeting,
                lastModifiedDateTime: new Date().toISOString(),
            });
            return localId;
        }
    }
    return undefined;
}
*/

export async function handleCalendarAction(
    action: CalendarAction,
    calendarContext: CalendarActionContext,
) {
    let actionEvent: EventReference | Event | undefined;
    const client = calendarContext.calendarClient;

    if (client === undefined) {
        throw new Error("Calendar client not initialized");
    }
    if (!client.isAuthenticated()) {
        await client.login();
    }
    switch (action.actionName) {
        case "addEvent":
            debug(chalk.green("Handling ADD_EVENT action ..."));
            actionEvent = action.parameters.event;
            if (actionEvent.timeRange != undefined) {
                console.log(action.parameters.event);
                if(actionEvent.timeRange.startDateTime != undefined) {
                    let startDateTime = parseCalendarDateTime(actionEvent.timeRange.startDateTime);
                    console.log("Parsed Start DateTime: " + startDateTime);
                }
                return createActionResultFromHtmlDisplay("Event added!");
            } 
            break;
            
        default:
            throw new Error(`Unknown action: ${(action as any).actionName}`);
    }
    return createActionResultFromError("Failed to execute the action!");
}

/*
async function populateMeetingDetailsFromEvent(
    actionName: string,
    events: any[] | GraphEntity,
) {
    if (events instanceof Array) {
        if (events && events.length > 0) {
            const displayText = findEventsDisplayHtml(events);
            let result = createActionResultFromHtmlDisplay(displayText);
            return result;
        } else {
            const displayText = `You have a meeting free day 😊`;
            let result = createActionResultFromTextDisplay(displayText);
            return result;
        }
    } else {
        const displayText = findEventsDisplayHtml(events);
        let result = createActionResultFromHtmlDisplay(displayText);
        return result;
    }
}


async function populateMeetingDetails(
    startDateTime: string,
    endDateTime: string,
    description: string,
    eventid: string,
) {
    const calendarItemLink = `https://outlook.office.com/calendar/item/${encodeURIComponent(eventid)}`;
    const meetingDetailsHTML =
        `<div>Outlook Meeting Schedule<a href="${calendarItemLink}" target="_blank">` +
        `<h4>${description}</h4></a><div style="font-size: 12px;">Start Time: <span>${startDateTime}</span>` +
        `<br>End Time: <span>${endDateTime}</span>` +
        "</div></div>";
    return meetingDetailsHTML;
}

async function populateMeetingDetailsMin(
    header: string,
    description: string,
    eventid: string,
) {
    const calendarItemLink = `https://outlook.office.com/calendar/item/${encodeURIComponent(eventid)}`;
    const meetingDetailsHTML =
        `<div>Outlook Meeting Schedule<a href="${calendarItemLink}" target="_blank">` +
        `<h4>${header}<br>${description}</h4></a><div style="font-size: 12px;">` +
        "</div></div>";
    return meetingDetailsHTML;
}
*/
