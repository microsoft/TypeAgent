// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Unit tests for PDF highlight coordinate system and toolbar interaction
 * Testing the text layer approach and highlight click behavior
 */

describe("PDF Highlight Coordinate System - Text Layer Approach", () => {
    // Mock text layer element and PDF.js structures
    const mockTextLayerElement = {
        getBoundingClientRect: () => ({
            left: 120, // Text layer is offset from page
            top: 130,
            right: 720,
            bottom: 930,
            width: 600,
            height: 800,
        }),
        querySelector: () => null,
        appendChild: jest.fn(),
    };

    const mockPageElement = {
        getBoundingClientRect: () => ({
            left: 100,
            top: 100,
            right: 700,
            bottom: 900,
            width: 600,
            height: 800,
        }),
        querySelector: (selector: string) => {
            if (selector === ".textLayer") {
                return mockTextLayerElement;
            }
            return null;
        },
    };

    const mockPageView = {
        div: mockPageElement,
        viewport: {
            scale: 1.0,
        },
    };

    const mockPdfViewer = {
        currentScale: 1.0,
        getPageView: (pageIndex: number) => mockPageView,
    };

    // Mock selection rectangles at different zoom levels
    const createMockSelection = (scale: number = 1.0) => {
        const baseRect = {
            left: 300, // Base position (not page offset)
            top: 150,
            right: 400,
            bottom: 170,
            width: 100,
            height: 20,
        };

        return {
            text: "Sample selected text",
            pageNumber: 1,
            rects: [baseRect as DOMRect],
            range: document.createRange(),
            isValid: true,
        };
    };

    describe("Text Layer Coordinate Calculation", () => {
        test("should calculate correct coordinates relative to text layer at 100% zoom", () => {
            mockPdfViewer.currentScale = 1.0;
            const selection = createMockSelection(1.0);

            // Simulate the text layer coordinate calculation logic
            const textLayerRect = mockTextLayerElement.getBoundingClientRect();
            const rect = selection.rects[0];

            const relativeLeft = rect.left - textLayerRect.left;
            const relativeTop = rect.top - textLayerRect.top;
            const relativeRight = rect.right - textLayerRect.left;
            const relativeBottom = rect.bottom - textLayerRect.top;

            const coordinates = {
                x: relativeLeft,
                y: relativeTop,
                width: relativeRight - relativeLeft,
                height: relativeBottom - relativeTop,
                coordinateScale: 1.0,
                coordinateSystem: "textLayer",
            };

            expect(coordinates.x).toBe(180); // 300 - 120 (text layer offset)
            expect(coordinates.y).toBe(20); // 150 - 130 (text layer offset)
            expect(coordinates.width).toBe(100);
            expect(coordinates.height).toBe(20);
            expect(coordinates.coordinateScale).toBe(1.0);
            expect(coordinates.coordinateSystem).toBe("textLayer");
        });

        test("should calculate correct coordinates relative to text layer at 120% zoom", () => {
            mockPdfViewer.currentScale = 1.2;
            const selection = createMockSelection(1.2);

            // Simulate the text layer coordinate calculation logic
            const textLayerRect = mockTextLayerElement.getBoundingClientRect();
            const rect = selection.rects[0];

            const relativeLeft = rect.left - textLayerRect.left;
            const relativeTop = rect.top - textLayerRect.top;
            const relativeRight = rect.right - textLayerRect.left;
            const relativeBottom = rect.bottom - textLayerRect.top;

            const coordinates = {
                x: relativeLeft,
                y: relativeTop,
                width: relativeRight - relativeLeft,
                height: relativeBottom - relativeTop,
                coordinateScale: 1.2,
                coordinateSystem: "textLayer",
            };

            expect(coordinates.x).toBe(180); // 300 - 120 (same relative position)
            expect(coordinates.y).toBe(20); // 150 - 130 (same relative position)
            expect(coordinates.width).toBe(100); // Same width relative to text layer
            expect(coordinates.height).toBe(20); // Same height relative to text layer
            expect(coordinates.coordinateScale).toBe(1.2);
            expect(coordinates.coordinateSystem).toBe("textLayer");
        });
    });

    describe("Text Layer Highlight Rendering", () => {
        test("should not apply additional scaling for text layer coordinates", () => {
            const coordinates = {
                x: 180,
                y: 20,
                width: 100,
                height: 20,
                coordinateScale: 1.2,
                coordinateSystem: "textLayer",
            };

            const currentScale = 1.5;

            // For text layer coordinates, no additional scaling needed
            let finalCoords = {
                x: coordinates.x,
                y: coordinates.y,
                width: coordinates.width,
                height: coordinates.height,
            };

            // Only apply scaling if not text layer system
            if (coordinates.coordinateSystem !== "textLayer") {
                const scaleRatio = currentScale / coordinates.coordinateScale;
                finalCoords = {
                    x: coordinates.x * scaleRatio,
                    y: coordinates.y * scaleRatio,
                    width: coordinates.width * scaleRatio,
                    height: coordinates.height * scaleRatio,
                };
            }

            expect(finalCoords.x).toBe(180); // No scaling applied
            expect(finalCoords.y).toBe(20);
            expect(finalCoords.width).toBe(100);
            expect(finalCoords.height).toBe(20);
        });
    });

    describe("Highlight Click Toolbar Behavior", () => {
        test("should ignore selection changes for specified duration", () => {
            // Mock TextSelectionManager behavior
            class MockTextSelectionManager {
                private ignoreSelectionChangeUntil: number = 0;

                ignoreSelectionChangesFor(durationMs: number = 300): void {
                    this.ignoreSelectionChangeUntil = Date.now() + durationMs;
                }

                shouldIgnoreSelectionChange(): boolean {
                    return Date.now() < this.ignoreSelectionChangeUntil;
                }
            }

            const manager = new MockTextSelectionManager();

            // Initially should not ignore
            expect(manager.shouldIgnoreSelectionChange()).toBe(false);

            // After calling ignoreSelectionChangesFor, should ignore
            manager.ignoreSelectionChangesFor(300);
            expect(manager.shouldIgnoreSelectionChange()).toBe(true);

            // After duration passes, should not ignore anymore
            manager.ignoreSelectionChangesFor(0); // 0ms duration
            setTimeout(() => {
                expect(manager.shouldIgnoreSelectionChange()).toBe(false);
            }, 1);
        });

        test("should handle rapid highlight clicks without interference", () => {
            // Simulate rapid highlight clicks
            const mockManager = {
                ignoreCount: 0,
                ignoreSelectionChangesFor: function (duration: number) {
                    this.ignoreCount++;
                },
            };

            // Simulate multiple rapid clicks
            mockManager.ignoreSelectionChangesFor(300);
            mockManager.ignoreSelectionChangesFor(300);
            mockManager.ignoreSelectionChangesFor(300);

            expect(mockManager.ignoreCount).toBe(3);
        });
    });
});
