# Grammar Generator Project

## Overview
The new grammar generator leverages Claude's capabilities to automatically generate grammars from schemas, offering a streamlined approach to grammar creation and maintenance.

## Key Design Decisions

### Action Naming Convention
- **Use exact action names**: `scheduleEvent` instead of `ScheduleEvent`
- **Purpose**: Enables precise targeting of specific actions during grammar extension
- **Benefit**: More granular control when updating individual grammar rules

### File Format Choice
- **Format**: AGR text files instead of JSON
- **Advantages**:
  - Significantly more compact
  - Enhanced readability for Claude
  - Better suited for AI processing and generation

## Implementation Strategy

### Incremental Updates
When new examples are introduced:
1. Target the specific rule (e.g., `scheduleEvent`)
2. Extend only that particular grammar rule
3. Avoid regenerating the entire grammar

### Required Components for Updates
The system needs to handle:
- **Existing grammar**: The current grammar state
- **New example**: The incoming data to incorporate
- **Shared symbols**: Information about common elements like `<Polite>`

## Next Steps
Focus on implementing the incremental update mechanism to efficiently handle new examples while maintaining grammar consistency and shared symbol relationships.