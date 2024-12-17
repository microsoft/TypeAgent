// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { GraphClient, DynamicObject, ErrorResponse } from "./graphClient.js";
import registerDebug from "debug";
import chalk from "chalk";
import { createCalendarDataIndex } from "./calendarDataIndex.js";
import { Client } from "@microsoft/microsoft-graph-client";

const debug = registerDebug("typeagent:graphUtils:calendarclient");
const debugError = registerDebug("typeagent:graphUtils:calendarclient:error");

const syncInterval = 30 * 60 * 1000;
export class CalendarClient extends GraphClient {
    private readonly useEmbeddings: Boolean = true;
    private readonly calendarDataIndex = createCalendarDataIndex();
    private readonly calendarDataMap = new Map<string, any>();
    private fCalendarIndexed = false;
    private stopCurrentSyncThread: (() => Promise<void>) | undefined;

    constructor() {
        super("@calendar login");
        this.login();
        this.on("connected", (client: Client) => {
            this.startSyncThread(client);
        });
        this.on("disconnected", () => {
            this.stopSyncThread();
        });
    }

    private async generateEmbedding(events: any, fSync: boolean = false) {
        if (events && events.length > 0) {
            for (const event of events) {
                this.calendarDataMap.set(event.id, event);
                await this.calendarDataIndex.addOrUpdate({
                    eventId: event.id,
                    eventData: event.subject,
                });
            }

            if (fSync) {
                for (const [eventid] of this.calendarDataMap) {
                    let found = events.find(
                        (event: any) => event.id === eventid,
                    );
                    if (!found) {
                        this.calendarDataMap.delete(eventid);
                        this.calendarDataIndex.remove(eventid);
                    }
                }
            }
        }
    }

    private async indexCalendarEvents(client: Client, signal: AbortSignal) {
        try {
            let allEvents: any[] = [];
            let nextPageLink = null;

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 15);
            const startDateStr = startDate.toISOString();

            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 30);
            const endDateStr = endDate.toISOString();

            debug(`Feting calendar events.`);
            do {
                try {
                    let response: any = undefined;
                    response = nextPageLink
                        ? client.api(nextPageLink)
                        : client
                              .api("/me/events")
                              .query({
                                  startDateTime: startDateStr,
                                  endDateTime: endDateStr,
                              })
                              .select("id,subject,bodyPreview,attendees");

                    let responseData = await response?.get();

                    allEvents = allEvents.concat(responseData.value || []);
                    nextPageLink = responseData["@odata.nextLink"];
                } catch (error) {
                    debugError(`Error fetching events:${error}`);
                    return;
                }
                if (signal.aborted) {
                    return;
                }
            } while (nextPageLink);

            try {
                debug(`Embedding calendar events.`);
                await this.generateEmbedding(allEvents, true);
                if (!this.fCalendarIndexed) {
                    this.fCalendarIndexed = true;
                    debug(`Calendar events indexed successfully.`);
                }
            } catch (error) {
                debugError(`Error while embedding calendar events:${error}`);
            }
        } catch (error) {
            debugError(`Error while syncing calendar events:${error}`);
        }
    }

    private async startSyncThread(client: Client) {
        await this.stopCurrentSyncThread?.();

        let timeoutId: NodeJS.Timeout;
        const abortController = new AbortController();
        let currentInvocation: Promise<void> | undefined;
        const task = async () => {
            currentInvocation = this.indexCalendarEvents(
                client,
                abortController.signal,
            );
            await currentInvocation;

            if (!abortController.signal.aborted) {
                debug(`Scheduled sync thread: ${syncInterval}ms`);
                timeoutId = setTimeout(task, syncInterval);
            }
        };

        debug("Sync thread starting.");
        if (!this.fCalendarIndexed) {
            task();
        } else {
            debug(`Scheduled sync thread: ${syncInterval}ms`);
            timeoutId = setTimeout(task, syncInterval);
        }

        this.stopCurrentSyncThread = async () => {
            clearTimeout(timeoutId);
            abortController.abort();
            await currentInvocation;
            this.stopCurrentSyncThread = undefined;
            debug("Sync thread stopped.");
        };
    }

    private async stopSyncThread() {
        if (this.stopCurrentSyncThread) {
            await this.stopCurrentSyncThread();
        } else {
            debugError("No sync thread is currently running.");
        }
    }

    async createCalendarEvent(
        subject: string,
        body: string,
        startDateTime: string,
        endDateTime: string,
        timeZone: string,
        attendees: string[] | undefined,
    ): Promise<string | undefined> {
        const client = await this.ensureClient();
        try {
            const newEvent: DynamicObject = {
                subject: subject,
                start: {
                    dateTime: startDateTime,
                    timeZone: timeZone,
                },
                end: {
                    dateTime: endDateTime,
                    timeZone: timeZone,
                },
                body: {
                    contentType: "text",
                    content: body,
                },
                attendees: [],
            };

            if (attendees !== undefined) {
                attendees.forEach((attendee) => {
                    newEvent.attendees.push({
                        type: "required",
                        emailAddress: {
                            address: attendee,
                        },
                    });
                });
            }

            const response = await client.api("/me/events").post(newEvent);

            if (response && response.id) {
                this.calendarDataMap.set(response.id, response);
                this.calendarDataIndex.addOrUpdate({
                    eventId: response.id,
                    eventData: subject,
                });
                return response.id; // Return the ID of the created event
            } else {
                debugError("Failed to create event:", response);
                return undefined;
            }
        } catch (error) {
            debugError(`Error creating event:${error}`);
        }
    }

    public async deleteCalendarEvent(eventId: string): Promise<boolean> {
        const client = await this.ensureClient();
        try {
            await client.api(`/me/events/${eventId}`).delete();
            this.calendarDataIndex.remove(eventId);
            return true;
        } catch (error) {
            debugError(`Error deleting event:${error}`);
            return false;
        }
    }

    public async findFreeSlots(
        startTime: string,
        endTime: string,
        durationInMinutes: number,
    ): Promise<any[]> {
        const client = await this.ensureClient();
        const requestBody = {
            startTime: {
                dateTime: startTime,
                timeZone: "Pacific Standard Time",
            },
            endTime: {
                dateTime: endTime,
                timeZone: "Pacific Standard Time",
            },
            availabilityViewInterval: `${durationInMinutes}`,
        };

        try {
            const response = await client
                .api("/me/calendar/getschedule")
                .post(requestBody);

            const availabilityView = response.availabilityView;

            const freeSlots: { start: string; end: string }[] = [];
            let startDateTime = new Date(startTime);

            for (let i = 0; i < availabilityView.length; i++) {
                if (availabilityView.charAt(i) === "0") {
                    const endDateTime = new Date(
                        startDateTime.getTime() + durationInMinutes * 60000,
                    );
                    freeSlots.push({
                        start: startDateTime.toISOString(),
                        end: endDateTime.toISOString(),
                    });
                }
                startDateTime = new Date(
                    startDateTime.getTime() + durationInMinutes * 60000,
                );
            }

            return freeSlots;
        } catch (error) {
            debugError(`Error retrieving availability:${error}`);
        }
        return [];
    }

    private findBestMatch(events: any, inputSentence: string): any {
        const tokenize = (sentence: string) => {
            return sentence.toLowerCase().match(/\b(\w+)\b/g) || [];
        };
        const inputTokens = new Set(tokenize(inputSentence));

        let bestMatch = null;
        let maxScore = 0;

        for (const event of events) {
            const sentenceTokens = tokenize(event.subject.toLowerCase());
            let score = 0;

            for (const token of sentenceTokens) {
                if (inputTokens.has(token)) {
                    score++;
                }
            }

            if (score > maxScore) {
                maxScore = score;
                bestMatch = event;
            }
        }

        return bestMatch;
    }

    private findBestMatchByParticipants(
        events: any,
        participantsInMeeting: string[],
    ) {
        let bestMatch = null;
        let maxScore = 0;

        for (const event of events) {
            let score = 0;
            if (event.attendees) {
                for (const attendee of event.attendees) {
                    if (
                        participantsInMeeting.includes(
                            attendee.emailAddress.address,
                        )
                    ) {
                        score++;
                    }
                }
            }

            if (score > maxScore) {
                maxScore = score;
                bestMatch = event;
            }
        }
        return bestMatch;
    }

    public async findEventsFromEmbeddings(subject: string): Promise<string[]> {
        let matchingEvents = [];
        if (this.useEmbeddings) {
            let searchResult: any = await this.calendarDataIndex.search(
                subject,
                1,
            );
            if (searchResult) {
                let event = this.calendarDataMap.get(
                    searchResult[0].item.value,
                );

                if (event) {
                    matchingEvents.push(event);
                }
            }
        }
        return matchingEvents;
    }

    public async addParticipantsToMeeting(
        subject: string,
        startTime: string | undefined,
        endTime: string | undefined,
        timeZone: string,
        participantsInMeeting: string[],
        participants: string[] | undefined,
    ): Promise<string | undefined | ErrorResponse> {
        const client = await this.ensureClient();

        if (participants && participants.length > 0) {
            try {
                let allEvents: any[] = [];
                let nextPageLink = null;
                do {
                    try {
                        let response: any = undefined;
                        if (startTime === undefined || endTime === undefined) {
                            response = nextPageLink
                                ? client.api(nextPageLink)
                                : client
                                      .api("/me/events")
                                      .filter(
                                          `startsWith(subject, '${subject}')`,
                                      )
                                      .select(
                                          "id,subject,bodyPreview,attendees",
                                      );
                        } else {
                            response = nextPageLink
                                ? client.api(nextPageLink)
                                : client
                                      .api("/me/events")
                                      .filter(
                                          `start/dateTime ge '${startTime}' and end/dateTime le '${endTime}'`,
                                      )
                                      .select(
                                          "id,subject,bodyPreview,attendees",
                                      );
                        }

                        let responseData = await response?.get();
                        await this.generateEmbedding(responseData.value, false);
                        allEvents = allEvents.concat(responseData.value || []);
                        nextPageLink = responseData["@odata.nextLink"];
                    } catch (error) {
                        debugError(
                            chalk.yellow(`Error fetching events:${error}`),
                        );
                        break;
                    }
                } while (nextPageLink);

                if (allEvents.length > 0) {
                    let matchingEvent = undefined;
                    if (!this.useEmbeddings) {
                        matchingEvent = this.findBestMatch(
                            allEvents,
                            subject.toLocaleLowerCase(),
                        );
                    } else {
                        let searchResult: any =
                            await this.calendarDataIndex.search(subject, 1);
                        if (searchResult) {
                            matchingEvent = allEvents.find(
                                (event) =>
                                    event.id === searchResult[0].item.value,
                            );
                        }
                    }

                    if (!matchingEvent) {
                        matchingEvent = this.findBestMatchByParticipants(
                            allEvents,
                            participantsInMeeting,
                        );
                    }

                    const meetingId = matchingEvent
                        ? matchingEvent.id
                        : undefined;
                    if (meetingId)
                        return await this.addParticipantsToExistingMeeting(
                            meetingId,
                            matchingEvent.attendees,
                            participants,
                        );
                    else {
                        debugError(
                            chalk.yellow(
                                `Could not find any events with the subject:${subject}. Creating a new meeting.`,
                            ),
                        );
                    }
                } else {
                    debugError(
                        chalk.yellow(
                            `Could not find any events with the subject:${subject}. Creating a new meeting.`,
                        ),
                    );
                }
                debug("Participants added successfully.");
            } catch (error) {
                debugError(`Error adding participants to meeting:${error}`);
            }
        }

        return undefined;
    }

    public async addParticipantsToExistingMeeting(
        meetingId: string,
        attendees: any,
        participants: string[],
    ): Promise<string | ErrorResponse | undefined> {
        const client = await this.ensureClient();
        try {
            const payload: DynamicObject = {
                attendees: [],
            };

            if (attendees !== undefined) {
                attendees.forEach((attendee: any) => {
                    payload.attendees.push({
                        type: "required",
                        emailAddress: {
                            address:
                                typeof attendee === "string"
                                    ? attendee
                                    : attendee.emailAddress.address,
                        },
                    });
                });
            }

            if (participants !== undefined) {
                participants.forEach((paddr) => {
                    // if attendee is already in the meeting, skip adding it again
                    const found = attendees.find((addr: any) =>
                        typeof paddr === "string"
                            ? addr === paddr
                            : addr.emailAddress.address === paddr,
                    );

                    if (!found)
                        payload.attendees.push({
                            type: "required",
                            emailAddress: {
                                address: paddr,
                            },
                        });
                });
            }

            if (payload.attendees.length > 0) {
                const url = `/me/events/${meetingId}`;
                await client.api(url).update(payload);
                return meetingId;
            }
        } catch (error: any) {
            debugError(`Error adding participants to meeting:${error}`);
            return { code: error.code as string, message: error };
        }
        return undefined;
    }

    public async createMeetingAndAddParticipants(
        subject: string,
        startTime: string,
        endTime: string,
        timeZone: string,
        attendees: string[],
    ): Promise<string | undefined> {
        const client = await this.ensureClient();
        try {
            const meetingPayload: DynamicObject = {
                subject: subject,
                start: {
                    dateTime: startTime,
                    timeZone: timeZone,
                },
                end: {
                    dateTime: endTime,
                    timeZone: timeZone,
                },
                attendees: [],
            };

            if (attendees !== undefined) {
                attendees.forEach((attendee) => {
                    meetingPayload.attendees.push({
                        type: "required",
                        emailAddress: {
                            address: attendee,
                        },
                    });
                });
            }

            const response = await client
                .api("/me/events")
                .post(meetingPayload);

            if (response && response.id) {
                return response.id; // Return the ID of the created event
            } else {
                debugError("Failed to create event:", response);
                return undefined;
            }
        } catch (error) {
            debugError(
                `Error creating meeting and adding participants:${error}`,
            );
        }
        return undefined;
    }

    public async findCalendarEvents(criteria: any): Promise<any[]> {
        const client = await this.ensureClient();
        try {
            const response = await client
                .api("/me/events")
                .filter(criteria)
                .get();

            return response.value;
        } catch (error) {
            debugError(`Error finding events:${error}`);
            return [];
        }
    }

    public async findCalendarEventsBySubject(subject: string): Promise<any[]> {
        if (!subject) {
            return [];
        }

        const client = await this.ensureClient();
        let allEvents: any[] = [];
        try {
            let nextPageLink = null;
            do {
                try {
                    let response: any = undefined;
                    response = nextPageLink
                        ? client.api(nextPageLink)
                        : client
                              .api("/me/events")
                              .filter(`startsWith(subject, '${subject}')`)
                              .select(
                                  "id,subject,bodyPreview,start,end,attendees",
                              );

                    let responseData = await response?.get();
                    //await this.generateEmbedding(responseData.value, false);

                    allEvents = allEvents.concat(responseData.value || []);
                    nextPageLink = responseData["@odata.nextLink"];
                } catch (error) {
                    debugError(chalk.yellow(`Error fetching events:${error}`));
                    break;
                }
            } while (nextPageLink);
        } catch (error) {
            debugError(`Error finding events:${error}`);
        }
        return allEvents;
    }

    public async findCalendarEventsByDateRange(query: any): Promise<any[]> {
        const client = await this.ensureClient();
        let allEvents: any[] = [];
        let nextLink: string | undefined =
            `/me/calendarView?${query}&$select=subject,bodyPreview,start,end,attendees`;
        while (nextLink) {
            try {
                const response: any = await client.api(nextLink).get();
                const events = response?.value || [];

                allEvents = allEvents.concat(events);
                nextLink = response["@odata.nextLink"];
            } catch (error) {
                debugError(`Error finding events:${error}`);
            }
        }
        return allEvents;
    }

    public async findCalendarView(query: string): Promise<any[]> {
        const client = await this.ensureClient();
        try {
            const uri = `/me/calendarView?${query}`;
            const response = await client.api(uri).get();

            return response.value;
        } catch (error) {
            debugError(`Error finding events:${error}`);
            return [];
        }
    }
}

export async function createCalendarGraphClient(): Promise<CalendarClient> {
    return new CalendarClient();
}
