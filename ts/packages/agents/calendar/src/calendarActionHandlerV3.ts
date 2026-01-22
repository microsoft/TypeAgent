// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    AppAction,
    AppAgent,
    ActionContext,
    ActionResult,
} from "@typeagent/agent-sdk";
import { CalendarActionV3 } from "./calendarActionsSchemaV3.js";
import chalk from "chalk";

// Calendar action handler V3 - simplified, grammar-friendly version
export class CalendarActionHandlerV3 implements AppAgent {
    public async executeAction(
        action: AppAction,
        context: ActionContext,
    ): Promise<ActionResult | undefined> {
        const calendarAction = action as CalendarActionV3;

        console.log(
            chalk.cyan(
                `\n[Calendar V3] Executing action: ${calendarAction.actionName}`,
            ),
        );
        console.log(
            chalk.gray(
                `Parameters: ${JSON.stringify(calendarAction.parameters, null, 2)}`,
            ),
        );

        switch (calendarAction.actionName) {
            case "scheduleEvent":
                await this.handleScheduleEvent(calendarAction, context);
                break;
            case "findEvents":
                await this.handleFindEvents(calendarAction, context);
                break;
            case "addParticipant":
                await this.handleAddParticipant(calendarAction, context);
                break;
            case "findTodaysEvents":
                await this.handleFindTodaysEvents(context);
                break;
            case "findThisWeeksEvents":
                await this.handleFindThisWeeksEvents(context);
                break;
            default:
                console.log(
                    chalk.red(
                        `Unknown action: ${(calendarAction as any).actionName}`,
                    ),
                );
        }

        return undefined;
    }

    private async handleScheduleEvent(
        action: CalendarActionV3 & { actionName: "scheduleEvent" },
        context: ActionContext,
    ): Promise<void> {
        const { description, date, time, location, participant } =
            action.parameters;

        console.log(chalk.green(`\n✓ Would schedule event:`));
        console.log(chalk.white(`  Description: ${description}`));
        console.log(chalk.white(`  Date: ${date}`));
        if (time) {
            console.log(chalk.white(`  Time: ${time}`));
        }
        if (location) {
            console.log(chalk.white(`  Location: ${location}`));
        }
        if (participant) {
            console.log(chalk.white(`  Participant: ${participant}`));
        }

        context.actionIO.appendDisplay(
            `Scheduled: ${description} on ${date}${time ? ` at ${time}` : ""}`,
        );
    }

    private async handleFindEvents(
        action: CalendarActionV3 & { actionName: "findEvents" },
        context: ActionContext,
    ): Promise<void> {
        const { date, description, participant } = action.parameters;

        console.log(chalk.green(`\n✓ Would search for events:`));
        if (date) {
            console.log(chalk.white(`  Date: ${date}`));
        }
        if (description) {
            console.log(chalk.white(`  Description: ${description}`));
        }
        if (participant) {
            console.log(chalk.white(`  Participant: ${participant}`));
        }

        context.actionIO.appendDisplay(
            `Searching for events${date ? ` on ${date}` : ""}${description ? ` matching "${description}"` : ""}`,
        );
    }

    private async handleAddParticipant(
        action: CalendarActionV3 & { actionName: "addParticipant" },
        context: ActionContext,
    ): Promise<void> {
        const { description, participant } = action.parameters;

        console.log(chalk.green(`\n✓ Would add participant:`));
        console.log(chalk.white(`  Event: ${description}`));
        console.log(chalk.white(`  Participant: ${participant}`));

        context.actionIO.appendDisplay(
            `Added ${participant} to ${description}`,
        );
    }

    private async handleFindTodaysEvents(
        context: ActionContext,
    ): Promise<void> {
        console.log(chalk.green(`\n✓ Would find today's events`));

        context.actionIO.appendDisplay(`Showing today's schedule`);
    }

    private async handleFindThisWeeksEvents(
        context: ActionContext,
    ): Promise<void> {
        console.log(chalk.green(`\n✓ Would find this week's events`));

        context.actionIO.appendDisplay(`Showing this week's schedule`);
    }
}

// Instantiate function required by the agent loader
export function instantiate(): AppAgent {
    return new CalendarActionHandlerV3();
}

// Validation functions for entity types
// These will be called by the grammar matcher to validate wildcard matches

export function validateCalendarDate(value: string): boolean {
    // TODO: Implement sophisticated date parsing
    // For now, accept any non-empty string
    return value.trim().length > 0;
}

export function validateCalendarTime(value: string): boolean {
    // TODO: Implement sophisticated time parsing
    // For now, accept any non-empty string
    return value.trim().length > 0;
}

export function validateEventDescription(value: string): boolean {
    // Accept any non-empty string as event description
    return value.trim().length > 0;
}

export function validateLocationName(value: string): boolean {
    // Accept any non-empty string as location
    return value.trim().length > 0;
}

export function validateParticipantName(value: string): boolean {
    // Accept any non-empty string as participant name
    return value.trim().length > 0;
}

// Default export
export default CalendarActionHandlerV3;
