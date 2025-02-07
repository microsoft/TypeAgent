// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, TypeAgentAction } from "@typeagent/agent-sdk";
import { Turtle } from "./turtleTypes";
import { TurtleAction } from "./turtleActionSchema";

export function createTurtleAgent(turtle: Turtle): AppAgent {
    return {
        async executeAction(
            action: TypeAgentAction<TurtleAction>,
            context,
        ): Promise<undefined> {
            console.log(`Executing action: ${action.actionName}`);
            switch (action.actionName) {
                case "forward":
                    turtle.forward(action.parameters.pixel);
                    break;
                case "left":
                    turtle.left(action.parameters.degrees);
                    break;
                case "right":
                    turtle.right(action.parameters.degrees);
                    break;
                case "penUp":
                    turtle.penUp();
                    break;
                case "penDown":
                    turtle.penDown();
                    break;
                default:
                    throw new Error(
                        `Unknown action: ${(action as TypeAgentAction).actionName}`,
                    );
            }
        },
    };
}
