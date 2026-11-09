// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export function fixturePdf() {
    const stream =
        "BT /F1 20 Tf 50 740 Td (Papero fixture title) Tj ET\nBT /F1 12 Tf 50 700 Td (Operator glyph text with local PDF.js.) Tj ET\nBT /F1 12 Tf 0 1 -1 0 500 250 Tm (Rotated text) Tj ET\n50 620 m 250 620 l S\n50 590 m 250 590 l S\n50 560 m 250 560 l S\n50 560 m 50 620 l S\n150 560 m 150 620 l S\n250 560 m 250 620 l S\nBT /F1 12 Tf 60 600 Td (Name) Tj 100 0 Td (Value) Tj ET\nBT /F1 12 Tf 60 570 Td (Alpha) Tj 100 0 Td (One) Tj ET\n";
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1))
        pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Uint8Array.from(Buffer.from(pdf));
}
