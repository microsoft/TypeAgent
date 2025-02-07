// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TurtleAction =
    | TurtleForward
    | TurtleTurnLeft
    | TurtleTurnRight
    | TurtlePenUp
    | TurtlePenDown;

interface TurtleForward {
    actionName: "forward";
    parameters: {
        pixel: number;
    };
}

interface TurtleTurnLeft {
    actionName: "left";
    parameters: {
        degrees: number;
    };
}

interface TurtleTurnRight {
    actionName: "right";
    parameters: {
        degrees: number;
    };
}

interface TurtlePenUp {
    actionName: "penUp";
}

interface TurtlePenDown {
    actionName: "penDown";
}
