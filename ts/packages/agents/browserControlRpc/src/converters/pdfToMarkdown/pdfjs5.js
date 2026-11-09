// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// TypeAgent PDF.js 5 adapter for upstream engine.js:
// https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/blob/f9e92cbc0224d1413c11dda15b284ee41b9fc48f/web/assets/engine.js

export function normalizeOperatorList(operators, codes) {
    const fnArray = [];
    const argsArray = [];
    for (let index = 0; index < operators.fnArray.length; index++) {
        const operation = operators.fnArray[index];
        const args = operators.argsArray[index];
        if (operation !== codes.constructPath || typeof args[0] !== "number") {
            fnArray.push(operation);
            argsArray.push(args);
            continue;
        }
        const [paint, [path]] = args;
        const pathOperations = [];
        const coordinates = [];
        let startX = 0;
        let startY = 0;
        for (let offset = 0; path && offset < path.length; ) {
            const draw = path[offset++];
            switch (draw) {
                case 0:
                    if (
                        path[offset + 2] === 1 &&
                        path[offset + 5] === 1 &&
                        path[offset + 8] === 1 &&
                        path[offset + 11] === 3 &&
                        path[offset + 4] === path[offset + 1] &&
                        path[offset + 6] === path[offset + 3] &&
                        path[offset + 9] === path[offset] &&
                        path[offset + 10] === path[offset + 7]
                    ) {
                        pathOperations.push(codes.rectangle);
                        coordinates.push(
                            path[offset],
                            path[offset + 1],
                            path[offset + 3] - path[offset],
                            path[offset + 7] - path[offset + 1],
                        );
                        offset += 12;
                        break;
                    }
                    pathOperations.push(codes.moveTo);
                    startX = path[offset++];
                    startY = path[offset++];
                    coordinates.push(startX, startY);
                    break;
                case 1:
                    pathOperations.push(codes.lineTo);
                    coordinates.push(path[offset++], path[offset++]);
                    break;
                case 2:
                    pathOperations.push(codes.curveTo);
                    for (let coordinate = 0; coordinate < 6; coordinate++)
                        coordinates.push(path[offset++]);
                    break;
                case 3:
                    pathOperations.push(codes.closePath);
                    break;
                default:
                    throw new Error(
                        `Unsupported PDF.js 5 drawing operation: ${draw}`,
                    );
            }
        }
        fnArray.push(codes.constructPath, paint);
        argsArray.push([pathOperations, coordinates], []);
    }
    return { ...operators, fnArray, argsArray };
}
