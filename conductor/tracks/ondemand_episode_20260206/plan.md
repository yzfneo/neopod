# Implementation Plan: Implement On-Demand Episode Generation

This plan follows the project's workflow, including Test-Driven Development (TDD) for new features.

## Phase 1: API and Backend Workflow

- [ ] Task: Design and Implement the On-Demand API Endpoint
  - [ ] Write tests for URL validation and request handling
  - [ ] Implement the endpoint in Cloudflare Workers to receive URL(s) and prompt settings
- [ ] Task: Adapt Content Extraction for Arbitrary URLs
  - [ ] Write tests for fetching and parsing different article structures
  - [ ] Implement or refine the extractor to handle user-provided URLs
- [ ] Task: Integrate Custom Prompting in AI Pipeline
  - [ ] Write tests for the summarization logic with varying system prompts
  - [ ] Update the LLM integration to use user-provided tone settings
- [ ] Task: Coordinate the On-Demand Workflow
  - [ ] Implement the sequence: Fetch -> Summarize -> TTS -> Store
  - [ ] Ensure state tracking (e.g., "processing", "completed") in KV
- [ ] Task: Conductor - User Manual Verification 'Phase 1: API and Backend Workflow' (Protocol in workflow.md)

## Phase 2: Frontend Implementation

- [ ] Task: Create the Custom Generation Page/Component
  - [ ] Design and implement the URL input field and prompt configuration UI
  - [ ] Implement progress indicators for the generation steps
- [ ] Task: Episode Display and Playback
  - [ ] Ensure custom-generated episodes appear in the user's view or a specific "My Episodes" section
  - [ ] Verify playback and sharing functionality
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Frontend Implementation' (Protocol in workflow.md)

## Phase 3: Final Integration and Polish

- [ ] Task: End-to-End Testing
  - [ ] Perform full flow tests from URL input to final audio playback
- [ ] Task: UI/UX Refinement
  - [ ] Polish the dark mode aesthetic for the new components
  - [ ] Ensure bilingual (CN/EN) support for all new UI elements
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Final Integration and Polish' (Protocol in workflow.md)
