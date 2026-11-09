# Third-Party Notices

## Papero

The engine, columns, symbols, TeX font, inline-math, and Markdown export code
comes from https://github.com/beatrizalmeidaf/papero-pdf-text-extractor at
`f9e92cbc0224d1413c11dda15b284ee41b9fc48f`. The full notice also appears in
[LICENSE](LICENSE). Original hashes and local patches are recorded in
[source-manifest.json](source-manifest.json).

MIT License

Copyright (c) 2026 Beatriz Almeida

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## PDF.js

`pdfjs-dist` 5.3.31 is a local runtime dependency, licensed under Apache-2.0.
Its package includes its license. The parent build copies that license to
`dist/converters/pdfToMarkdown/PDFJS-LICENSE`. This converter does not bundle a CDN dependency or set
`GlobalWorkerOptions.workerSrc`.

The parent dev dependency `pdfjs-baseline` alias for `pdfjs-dist` 4.10.38 is test-only and is
not imported by the runtime. TypeScript is a development dependency used for
the parent build and reproducible AST selection of upstream functions.
The parent dev dependency `@napi-rs/canvas` supplies Node qualification globals.

Locally authored adapters and validation scripts retain their Microsoft MIT
headers. Each adapted upstream file identifies its original source URL at the
pin and retains Beatriz Almeida's copyright with explicit TypeAgent modification
attribution. Patches under `ts/tools/scripts/converters/pdfToMarkdown/patches`
reverse to the original hashes in the manifest. Upstream code is not
reattributed to Microsoft.
