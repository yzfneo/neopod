# Specification: Implement On-Demand Episode Generation

## Overview

This track enables users to generate custom podcast episodes by providing specific article URLs. It leverages the existing AI summarization and TTS (Text-to-Speech) pipeline but shifts from an automated daily crawl to a user-triggered process.

## User Stories

- As a user, I want to paste one or more URLs into the web interface so I can generate a custom podcast episode about those specific topics.
- As a user, I want to configure the tone of the generated episode (Casual vs. Professional) using a custom system prompt.
- As a user, I want to see the progress of the generation (Crawling -> Summarizing -> Generating Audio).
- As a user, I want to listen to and share the generated custom episode.

## Technical Requirements

- **URL Ingestion:** API endpoint to receive and validate URLs.
- **Content Extraction:** Capability to fetch and extract clean text from the provided URLs (reusing or extending existing crawler logic).
- **Custom Prompts:** Update the AI summarization logic to accept a user-defined tone or system prompt.
- **On-Demand Workflow:** A Cloudflare Worker workflow that coordinates the steps for a specific user request.
- **Storage:** Store custom episodes in Cloudflare R2 and metadata in KV, separate from daily automated episodes if necessary.
- **Frontend:** New UI component/page for URL input and configuration.

## Success Criteria

- Users can successfully generate a podcast episode from a single URL.
- Users can successfully generate a podcast episode from multiple URLs.
- The generated episode reflects the custom tone settings.
- The episode is playable via the web interface.
