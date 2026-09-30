// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Workaround for a jest + signal-exit interaction that makes ESM tests flaky.
//
// When an ESM test imports a core module, jest-runtime builds a synthetic ES
// module for it (jest-runtime `_importCoreModule`). It snapshots the export
// names from `Object.keys(coreModule)` when the synthetic module is
// constructed, then re-enumerates `Object.entries(coreModule)` when the module
// is evaluated. For the "process" core module those two enumerations must
// agree.
//
// signal-exit@3 (pulled in transitively via proper-lockfile) installs an
// enumerable own property `process.__signal_exit_emitter__` at load time. If
// that property first appears between construction and evaluation of the
// "process" synthetic module, jest tries to `setExport` a name that was not in
// the declared export list and throws
//   ReferenceError: Export '__signal_exit_emitter__' is not defined in module
// which fails the whole test file. The ordering depends on module link/eval
// order, so the failure is intermittent.
//
// Pre-installing the emitter as a NON-enumerable property before any test
// module loads makes signal-exit reuse it (its `if (process.__signal_exit_emitter__)`
// branch) instead of creating an enumerable one. Because it is never
// enumerable, it cannot change the synthetic module's export names.

const { EventEmitter } = require("node:events");

if (!process.__signal_exit_emitter__) {
    // Match the shape signal-exit@3 initializes in its else branch so it reuses
    // this emitter transparently.
    const emitter = new EventEmitter();
    emitter.count = 0;
    emitter.emitted = {};
    Object.defineProperty(process, "__signal_exit_emitter__", {
        value: emitter,
        enumerable: false,
        writable: true,
        configurable: true,
    });
}

// Registering a signal-exit callback also wraps process.emit. It is normally
// inherited from EventEmitter, so that assignment adds an enumerable own key.
// Materialize it before Jest snapshots the exports; keep it writable so real
// signal-exit registration and cleanup still work. Preserve an existing own
// property (including any instrumentation and its descriptor).
if (!Object.prototype.hasOwnProperty.call(process, "emit")) {
    Object.defineProperty(process, "emit", {
        value: process.emit,
        enumerable: true,
        writable: true,
        configurable: true,
    });
}
