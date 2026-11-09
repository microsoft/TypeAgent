// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TypeAgent lifecycle adapter for upstream engine.js:
// https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/blob/f9e92cbc0224d1413c11dda15b284ee41b9fc48f/web/assets/engine.js

export function createLifecycle(options, defaultGetDocument) {
    const concurrency = options.concurrency ?? 1;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
        throw new RangeError("PDF concurrency must be an integer from 1 to 4");
    }
    const signal = options.signal;
    let task;
    let destroyed;
    let failed = false;
    const abortError = () =>
        new DOMException("PDF extraction cancelled", "AbortError");
    const check = () => {
        if (signal?.aborted) throw abortError();
        if (failed) throw new Error("PDF extraction has ended");
    };
    const destroy = () => {
        destroyed ??= Promise.resolve().then(() => task?.destroy());
        return destroyed;
    };
    const open = (data) => {
        check();
        if (task) throw new Error("Converter opens one PDF per extraction");
        const parameters = { ...options.getDocumentOptions };
        delete parameters.url;
        parameters.data = new Uint8Array(
            data instanceof ArrayBuffer ? data.slice(0) : data,
        );
        parameters.isEvalSupported = false;
        parameters.fontExtraProperties = true;
        if (options.password !== undefined)
            parameters.password = options.password;
        if (options.worker !== undefined) parameters.worker = options.worker;
        task = (options.getDocument ?? defaultGetDocument)(parameters);
        if (options.onPassword) task.onPassword = options.onPassword;
        return task;
    };
    const run = async (work) => {
        check();
        let cancel;
        const aborted = new Promise((resolve, reject) => {
            cancel = () => {
                reject(abortError());
                void destroy().catch(() => {});
            };
        });
        signal?.addEventListener("abort", cancel, { once: true });
        try {
            check();
            const result = await Promise.race([
                Promise.resolve().then(work),
                aborted,
            ]);
            check();
            if (options.retainPdf === false) {
                await destroy();
                return { ...result, pdf: null, destroy };
            }
            return { ...result, destroy };
        } catch (error) {
            failed = true;
            await destroy().catch(() => {});
            throw error;
        } finally {
            signal?.removeEventListener("abort", cancel);
        }
    };
    return { concurrency, check, open, run };
}
