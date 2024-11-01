// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createCalendarGraphClient,
    CalendarClient,
    getNormalizedDateRange,
    getNormalizedDateTimes,
    getTimeZoneName,
    GraphEntity,
    getUniqueLocalId,
    ErrorResponse,
} from "graph-utils";
import chalk from "chalk";
import {
    CalendarAction,
    Event,
    EventReference,
} from "./calendarActionsSchema.js";
import {
    getTimeRangeBasedQuery,
    getNWeeksDateRangeISO,
} from "./calendarQueryHelper.js";
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

export class CalendarClientLoginCommandHandler
    implements CommandHandlerNoParams
{
    public readonly description = "Log into the MS Graph to access calendar";
    public async run(context: ActionContext<CalendarActionContext>) {
        const calendarClient: CalendarClient | undefined =
            context.sessionContext.agentContext.calendarClient;
        if (!calendarClient?.isGraphClientInitialized()) {
            await calendarClient?.initGraphClient(true);
        }
    }
}

const handlers: CommandHandlerTable = {
    description: "Calendar login commmand",
    defaultSubCommand: new CalendarClientLoginCommandHandler(),
    commands: {
        login: new CalendarClientLoginCommandHandler(),
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

async function getParticipantsToAdd(
    participants: string[] | undefined,
    calendarClient: CalendarClient | undefined,
): Promise<string[] | undefined> {
    let participantsToAdd: string[] | undefined = [];
    if (participants && participants.length > 0) {
        participantsToAdd =
            await calendarClient?.getEmailAddressesOfUsernamesLocal(
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
    calendarClient: CalendarClient | undefined,
): Promise<string | undefined | ErrorResponse> {
    if (!calendarClient) return undefined;

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
        eventId = await calendarClient?.addParticipantsToMeeting(
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

export async function handleCalendarAction(
    action: CalendarAction,
    calendarContext: CalendarActionContext,
) {
    let actionEvent: EventReference | Event | undefined;

    if (
        !calendarContext.calendarClient ||
        !calendarContext.calendarClient?.isGraphClientInitialized()
    ) {
        return createActionResultFromError(
            "Use @calendar login to log into MS Graph and then try your requesy again.",
        );
    }

    switch (action.actionName) {
        case "addEvent":
            console.log(chalk.green("Handling ADD_EVENT action ..."));
            const err =
                "To set up a meeting, please provide more details such as the date, time, participants, and description of the event.";

            actionEvent = action.parameters.event;
            let response: any = undefined;
            if (
                actionEvent != undefined &&
                (actionEvent.day != undefined ||
                    actionEvent.timeRange != undefined)
            ) {
                response = await getNormalizedDateTimes(
                    actionEvent.day,
                    actionEvent.timeRange
                        ? actionEvent.timeRange.startTime
                        : undefined,
                    actionEvent.timeRange
                        ? actionEvent.timeRange.endTime
                        : undefined,
                    actionEvent.timeRange
                        ? actionEvent.timeRange.duration
                        : "1",
                    true,
                );

                if (
                    response === undefined ||
                    (response.startDate === undefined &&
                        response.endDate === undefined)
                ) {
                    if (action.parameters.event?.translatedDate) {
                        response = await getNormalizedDateRange(
                            action.parameters.event?.translatedDate,
                            actionEvent.timeRange
                                ? actionEvent.timeRange.startTime
                                : undefined,
                            actionEvent.timeRange
                                ? actionEvent.timeRange.endTime
                                : undefined,
                            actionEvent.timeRange
                                ? actionEvent.timeRange.duration
                                : "1",
                            true,
                        );
                    }
                }

                if (
                    response != undefined &&
                    response.startDate != undefined &&
                    response.endDate != undefined
                ) {
                    if (
                        actionEvent.description == "" ||
                        actionEvent.description == undefined
                    ) {
                        actionEvent.description = "** Generated Event **";
                    }

                    let participantsToAdd: string[] | undefined = [];
                    if (
                        actionEvent.participants &&
                        actionEvent.participants.length > 0
                    ) {
                        participantsToAdd =
                            await calendarContext.calendarClient?.getEmailAddressesOfUsernamesLocal(
                                actionEvent.participants,
                            );
                    }

                    let eventid =
                        await calendarContext.calendarClient?.createCalendarEvent(
                            actionEvent.description,
                            actionEvent.description ?? "",
                            response.startDate,
                            response.endDate,
                            getTimeZoneName(),
                            participantsToAdd,
                        );
                    if (eventid != undefined) {
                        const localId = addCalendarEntity(
                            calendarContext,
                            eventid,
                            actionEvent.description,
                            participantsToAdd ?? [],
                        );
                        console.log(
                            chalk.bgCyanBright(
                                `Successfully added the (local eventid:${localId}) event:${eventid}`,
                            ),
                        );
                        const displayText = await populateMeetingDetails(
                            response.startDate,
                            response.endDate,
                            actionEvent.description,
                            eventid,
                        );
                        console.log(displayText);

                        let result =
                            createActionResultFromHtmlDisplay(displayText);

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
                        }
                    } else {
                        console.log(
                            chalk.bgRedBright(
                                "Failed to add the event, please try again!",
                            ),
                        );
                        return createActionResultFromError(
                            "Failed to add the event, please try again!",
                        );
                    }
                } else {
                    console.log(
                        chalk.bgYellowBright(
                            action.parameters.fuzzyResponse
                                ? action.parameters.fuzzyResponse
                                : err,
                        ),
                    );
                    return createActionResultFromError(err);
                }
            } else {
                console.log(
                    chalk.bgYellowBright(
                        action.parameters.fuzzyResponse
                            ? action.parameters.fuzzyResponse
                            : err,
                    ),
                );
                return createActionResultFromError(err);
            }
            break;

        case "findEvents":
            console.log(chalk.green("Handling FIND_EVENTS action ..."));
            actionEvent = action.parameters.eventReference as EventReference;

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
                        calendarContext.calendarClient
                            ?.findEventsFromEmbeddings(actionEvent?.description)
                            .then((events) => {
                                if (events) {
                                    return populateMeetingDetailsFromEvent(
                                        actionEvent?.description!,
                                        events,
                                    );
                                }
                            });
                    }
                }
            } else if (actionEvent && actionEvent.day) {
                let findQuery = getTimeRangeBasedQuery(actionEvent);
                if (findQuery !== undefined) {
                    let results: any =
                        await calendarContext.calendarClient?.findCalendarEventsByDateRange(
                            findQuery,
                        );
                    return populateMeetingDetailsFromEvent(
                        actionEvent.description!,
                        results,
                    );
                } else {
                    const err =
                        "Please provide a valid date and time range to search for events.";
                    console.log(chalk.bgYellowBright(err));
                    return createActionResultFromError(err);
                }
            } else if (actionEvent && actionEvent.description) {
                let findResults =
                    await calendarContext.calendarClient?.findEventsFromEmbeddings(
                        actionEvent.description,
                    );

                if (findResults.length === 0) {
                    findResults =
                        await calendarContext.calendarClient?.findCalendarEventsBySubject(
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
                actionEvent.participants.length > 0
            ) {
                let findQuery = getTimeRangeBasedQuery(actionEvent);
                if (
                    actionEvent?.participants?.length > 0 &&
                    findQuery !== undefined
                ) {
                    console.log(findQuery);
                    let results: any =
                        await calendarContext.calendarClient?.findCalendarEventsByDateRange(
                            findQuery,
                        );

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
                    console.log(chalk.bgYellowBright(err));
                    return createActionResultFromError(err);
                }
            } else {
                const err =
                    "Please provide participant and  valid date and time range to search for events.";
                console.log(chalk.bgYellowBright(err));
                return createActionResultFromError(err);
            }
            break;

        case "addParticipants":
            console.log(chalk.green("Handling ADD_PARTICIPANTS action ..."));
            actionEvent = action.parameters.eventReference;
            let participantsToAdd = action.parameters.participants;
            if (
                actionEvent != undefined &&
                actionEvent.description != undefined
            ) {
                let dateInfo: any = undefined;

                if (actionEvent.timeRange != undefined) {
                    dateInfo = await getNormalizedDateTimes(
                        actionEvent.day,
                        actionEvent.timeRange.startTime,
                        actionEvent.timeRange.endTime,
                        actionEvent.timeRange.duration,
                        false,
                    );
                } else {
                    let { startDateTime, endDateTime } =
                        getNWeeksDateRangeISO(2);

                    dateInfo = {
                        startDate: startDateTime,
                        endDate: endDateTime,
                    };
                }

                let eventId = await addParticipantsToMeeting(
                    actionEvent.participants,
                    participantsToAdd,
                    actionEvent.description ?? "** Generated Event **",
                    dateInfo,
                    calendarContext.calendarClient,
                );

                if (eventId && typeof eventId === "string") {
                    // todo: check if the event is in the mapGraphEntity, add it if not
                    // the event won't be in the context if it's an exisitng event in the calendar
                    const localId = updateCalendarEntity(
                        calendarContext,
                        eventId,
                        participantsToAdd,
                    );

                    console.log(
                        chalk.bgCyanBright(
                            `Successfully added pariticipant(s) for (local eventid:${localId}) event:${eventId}`,
                        ),
                    );

                    const displayText = await populateMeetingDetailsMin(
                        "Meeting was updated",
                        actionEvent.description,
                        eventId,
                    );
                    console.log(displayText);

                    let result = createActionResultFromHtmlDisplay(displayText);
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
                    }
                } else {
                    console.log(
                        chalk.bgRedBright(
                            "Failed to add the event, please try again!",
                        ),
                    );
                    return createActionResultFromError(
                        "Failed to add the event, please try again!",
                    );
                }
            } else {
                if (actionEvent?.eventid) {
                    const lastLocalEventId = actionEvent?.eventid;
                    const lastGraphEventId = getGraphEventId(
                        lastLocalEventId ?? "",
                        calendarContext,
                    );

                    if (lastLocalEventId !== undefined) {
                        const meeting =
                            calendarContext.mapGraphEntity?.get(
                                lastLocalEventId,
                            );
                        if (meeting) {
                            let participantsToAdd =
                                action.parameters.participants;
                            let participantsInMeeting = meeting.participants;

                            let emailAddrsInMeeting: string[] | undefined =
                                await getParticipantsToAdd(
                                    participantsInMeeting,
                                    calendarContext.calendarClient,
                                );

                            let emailAddrsToAdd: string[] | undefined =
                                await getParticipantsToAdd(
                                    participantsToAdd,
                                    calendarContext.calendarClient,
                                );

                            if (
                                lastGraphEventId &&
                                emailAddrsToAdd &&
                                emailAddrsToAdd.length > 0
                            ) {
                                let eventId =
                                    await calendarContext.calendarClient?.addParticipantsToExistingMeeting(
                                        lastGraphEventId,
                                        emailAddrsInMeeting,
                                        emailAddrsToAdd,
                                    );

                                // add the new participants to the mapGraphEntity
                                if (eventId && typeof eventId === "string") {
                                    meeting.participants?.push(
                                        ...emailAddrsToAdd,
                                    );
                                    calendarContext.mapGraphEntity?.set(
                                        lastLocalEventId,
                                        meeting,
                                    );
                                    console.log(
                                        chalk.bgCyanBright(
                                            `Successfully added the participants to the (local eventid:${lastLocalEventId}) event:${eventId}`,
                                        ),
                                    );
                                    const displayText =
                                        await populateMeetingDetailsMin(
                                            "Meeting was updated",
                                            meeting.subject,
                                            eventId,
                                        );
                                    console.log(displayText);

                                    let result =
                                        createActionResultFromHtmlDisplay(
                                            displayText,
                                        );

                                    result.entities = [
                                        {
                                            name: `${meeting.subject}`,
                                            type: ["event"],
                                            additionalEntityText:
                                                lastLocalEventId,
                                            uniqueId: lastLocalEventId,
                                        },
                                    ];
                                    return result;
                                } else {
                                    // Could happen because the calendar event was deleted
                                    // and clear the entity from the context

                                    let err = eventId as ErrorResponse;
                                    if (err.code === "ErrorItemNotFound") {
                                        deleteLocalGraphEventId(
                                            lastLocalEventId,
                                            calendarContext,
                                        );

                                        return createActionResultFromError(
                                            "Looks like the event was deleted, please try again!",
                                        );
                                    } else {
                                        return createActionResultFromError(
                                            "Failed to add the participants to the event, please try again!",
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
            break;
        default:
            throw new Error(`Unknown action: ${(action as any).actionName}`);
    }
    return createActionResultFromError("Failed to execute the action!");
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
