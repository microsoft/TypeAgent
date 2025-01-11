// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface Turtle {
    forward(pixel: number): void;
    left(degrees: number): void;
    right(degrees: number): void;
    penUp(): void;
    penDown(): void;
}
