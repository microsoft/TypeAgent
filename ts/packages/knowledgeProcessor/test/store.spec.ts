import { createFileNameGenerator, generateTimestampString } from "typeagent";

describe("Storage", () => {
    test("idGen", () => {
        const nameGenerator = createFileNameGenerator(
            generateTimestampString,
            (name: string) => true,
        );
        const maxNames = 64;
        let prevName = "";
        for (let i = 0; i < maxNames; ++i) {
            const objFileName = nameGenerator.next().value;
            expect(objFileName).not.toEqual(prevName);
            prevName = objFileName;
        }
    });
});
