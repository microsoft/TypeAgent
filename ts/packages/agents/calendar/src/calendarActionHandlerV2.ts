// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    parseCalendarDateTime,
    calcEndDateTime,
    getQueryParamsFromTimeRange
} from "./datetime/calendarDateTimeParser.js";
import {
    createCalendarGraphClient,
    CalendarClient,
    getTimeZoneName,
    GraphEntity,
    getUniqueLocalId,
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
    createActionResultFromTextDisplay,
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
}*/

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
}

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

/*async function getParticipantsToAdd(
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
}*/

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
    let error = "Failed to execute the action!";

    switch (action.actionName) {
        case "addEvent":
            debug(chalk.green("Handling ADD_EVENT action ..."));
            actionEvent = action.parameters.event;
            if (actionEvent.timeRange != undefined) {
                if (
                    actionEvent.timeRange.startDateTime !== undefined &&
                    actionEvent.timeRange.startDateTime?.day !== undefined
                ) {
                    let startDateTime = parseCalendarDateTime(
                        actionEvent.timeRange.startDateTime,
                    );
                    if (startDateTime !== undefined) {
                        let endDateTimeRes = calcEndDateTime(
                            startDateTime,
                            actionEvent.timeRange.duration ?? "1h",
                        );
                        if (
                            endDateTimeRes.success &&
                            endDateTimeRes.parsedDateTime !== undefined
                        ) {
                            let endDateTime = endDateTimeRes.parsedDateTime;

                            let participantsToAdd: string[] | undefined = [];
                            if (
                                actionEvent.participants &&
                                actionEvent.participants.length > 0
                            ) {
                                participantsToAdd =
                                    await client.getEmailAddressesOfUsernamesLocal(
                                        actionEvent.participants,
                                    );
                            }

                            actionEvent.description =
                                actionEvent.description ?? "Meeting";
                            let eventid = await client.createCalendarEvent(
                                actionEvent.description ?? "Meeting",
                                actionEvent.description ?? "",
                                startDateTime,
                                endDateTime,
                                getTimeZoneName(),
                                participantsToAdd,
                            );

                            if (eventid !== undefined) {
                                const localId = addCalendarEntity(
                                    calendarContext,
                                    eventid,
                                    actionEvent.description,
                                    participantsToAdd ?? [],
                                );
                                debug(
                                    chalk.bgCyanBright(
                                        `Successfully added the (local eventid:${localId}) event:${eventid}`,
                                    ),
                                );
                                const displayText =
                                    await populateMeetingDetails(
                                        startDateTime,
                                        endDateTime,
                                        actionEvent.description,
                                        eventid,
                                    );
                                debug(displayText);

                                let result =
                                    createActionResultFromHtmlDisplay(
                                        displayText,
                                    );

                                if (result && localId) {
                                    result.entities = [
                                        {
                                            name: `${actionEvent.description}`,
                                            type: ["event"],
                                            additionalEntityText: localId,
                                            uniqueId: localId,
                                        },
                                    ];
                                    return result;
                                } //end if(result && localId)
                            } else {
                                debug(
                                    chalk.bgRedBright(
                                        "Failed to add the event, please try again!",
                                    ),
                                );
                                return createActionResultFromError(
                                    "Failed to add the event, please try again!",
                                );
                            }
                        }
                    }
                } else {
                    error = "Missing start date";
                }
            } else {
                error = "Missing time range";
            }
            break;

        case "findEvents":
            debug(chalk.green("Handling FIND_EVENTS action ..."));
            actionEvent = action.parameters.eventReference as EventReference;
            console.log(actionEvent);

            if (actionEvent && actionEvent.eventid) {
                const lastLocalEventId = actionEvent.eventid;
                const lastGraphEventId = getGraphEventId(
                    lastLocalEventId ?? "",
                    calendarContext,
                );
                if (lastGraphEventId !== undefined) {
                    const meeting =
                        calendarContext.mapGraphEntity?.get(lastLocalEventId);
                    if (meeting) {
                        return populateMeetingDetailsFromEvent(
                            actionEvent?.description!,
                            meeting,
                        );
                    }
                } else {
                    // the eventid is coming from the cache, but it's not in the mapGraphEntity
                    if (actionEvent && actionEvent.description) {
                        const events = await client.findEventsFromEmbeddings(
                            actionEvent?.description,
                        );

                        if (events) {
                            return populateMeetingDetailsFromEvent(
                                actionEvent?.description!,
                                events,
                            );
                        }
                    }
                }
            } else if (
                actionEvent &&
                (actionEvent.timeRange &&
                    actionEvent.timeRange?.startDateTime && actionEvent.timeRange?.endDateTime)
            ) {
                let findQuery = getQueryParamsFromTimeRange(actionEvent.timeRange?.startDateTime, actionEvent.timeRange?.endDateTime);
                if (findQuery !== undefined) {
                    let results: any =
                        await client.findCalendarEventsByDateRange(findQuery);
                    return populateMeetingDetailsFromEvent(
                        actionEvent.description!,
                        results,
                    );
                } else {
                    const err =
                        "Please provide a valid date and time range to search for events.";
                    debug(chalk.bgYellowBright(err));
                    return createActionResultFromError(err);
                }
            } else if (actionEvent && actionEvent.description) {
                let findResults = await client.findEventsFromEmbeddings(
                    actionEvent.description,
                );

                if (findResults?.length === 0) {
                    findResults = await client.findCalendarEventsBySubject(
                        actionEvent.description,
                    );
                }

                return populateMeetingDetailsFromEvent(
                    actionEvent.description,
                    findResults,
                );
            } else if (
                actionEvent &&
                actionEvent.participants &&
                actionEvent.participants.length > 0 &&
                actionEvent.timeRange?.startDateTime && actionEvent.timeRange?.endDateTime
            ) {
                let findQuery = getQueryParamsFromTimeRange(actionEvent.timeRange?.startDateTime, actionEvent.timeRange?.endDateTime);
                if (
                    actionEvent?.participants?.length > 0 &&
                    findQuery !== undefined
                ) {
                    debug(findQuery);
                    let results: any =
                        await client.findCalendarEventsByDateRange(findQuery);

                    if (Array.isArray(results)) {
                        const findResults = results.filter((result) => {
                            if (result.attendees) {
                                const eventAttendees = result.attendees.map(
                                    (attendee: any) =>
                                        attendee.emailAddress.name.toLowerCase(),
                                );

                                return actionEvent?.participants?.some(
                                    (participant: string) =>
                                        eventAttendees.some((name: string) =>
                                            name.includes(
                                                participant.toLowerCase(),
                                            ),
                                        ),
                                );
                            }
                            return false;
                        });

                        if (findResults.length > 0) {
                            return populateMeetingDetailsFromEvent(
                                actionEvent.description!,
                                findResults,
                            );
                        }
                    }
                } else {
                    const err =
                        "Please provide a valid date and time range to search for events.";
                    debug(chalk.bgYellowBright(err));
                    return createActionResultFromError(err);
                }
            } else {
                const err =
                    "Please provide participant and  valid date and time range to search for events.";
                debug(chalk.bgYellowBright(err));
                return createActionResultFromError(err);
            }
            break;

        default:
            throw new Error(`Unknown action: ${(action as any).actionName}`);
    }

    return createActionResultFromError(error);
}


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

/*
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
}*/
