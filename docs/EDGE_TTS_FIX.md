# Fix EdgeTTS Timeout (403 Forbidden)

## Summary

Resolved the persistent 403 Forbidden/Timeout errors with EdgeTTS by replacing the outdated `@echristian/edge-tts` (and other attempted libraries) with a custom `EdgeTTSClient`. The root cause was missing/incorrect `Sec-MS-GEC` anti-abuse tokens and outdated browser headers that Microsoft's API now strictly enforces (specifically requiring Edge v144+ signatures).

## Changes

### 1. Custom EdgeTTS Client

Created `workflow/edge-tts-client.ts` which implements:

- **Verified `Sec-MS-GEC` Generation**: Uses the correct seconds-based rounding and SHA256 hashing.
- **Latest Version Signatures**: Uses `Sec-MS-GEC-Version: 1-144.0.3719.115` and matching `User-Agent`/`Sec-CH-UA` headers (Feb 2026 stable).
- **Native WebSocket**: Compatible with Cloudflare Workers (using `ws` and standard `crypto`).

### 2. Workflow Update

Updated `workflow/tts.ts` to:

- Remove dependency on `@echristian/edge-tts`.
- Use the new `EdgeTTSClient` for synthesis.
- Retain the safety timeout wrapper.

## Verification

### Automated Test

Ran `tests/custom-client-test.ts` which successfully:

1.  Connected to the Microsoft Speech API WebSocket.
2.  Passed the handshake (received `turn.start`).
3.  Synthesized audio ("Hello, this is a final verification...").
4.  Saved a valid MP3 file (`tests/final-output.mp3`).

```bash
$ npx tsx tests/custom-client-test.ts
Testing custom EdgeTTSClient...
Synthesizing...
✅ Success! Duration: 2585ms
Audio size: 29520 bytes
Saved to tests/final-output.mp3
```

### Context7 Best Practices

The solution aligns with the "best practices" discovered via Context7 (mocking full browser headers), but updated with the _correct_ current version string (v144) as effective in Feb 2026, superseding the outdated documentation (v130).
