// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DeepPartialUndefined<T> = T extends object
    ? {
          [P in keyof T]?: DeepPartialUndefined<T[P]> | undefined;
      }
    : T;
