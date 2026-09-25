# Brief 06 — Cloud without a key: local and self-hosted transcription servers

Queue item 6 of `docs/launch-plan.md`. Free. One commit. After 07a (it extends the
readiness function 07a introduces).

## Why

whisper.cpp's server, Speaches, LM Studio, a corporate Whisper deployment — none need a
key, yet `src/main/transcription-service.ts` throws "Add an API key" before sending
anything, and the readiness gate treats "no key" as "not set up". The settings store
already allows `http://localhost` endpoints precisely for these servers.

## What the user sees

In Settings → Transcription → Cloud: with a **custom endpoint** filled in, the key becomes
optional. The badge reads "No key needed for this server" when there is no key and a
custom endpoint is set; "Key required" only when the endpoint is empty (OpenAI). Record
works with no key against a custom endpoint. If that server answers 401/403, the error says
"The server at <host> refused the request (HTTP 401). If it needs a key, add one in
Settings." A **Test connection** button beside the endpoint field sends one second of
silence as a WAV to `{endpoint}/audio/transcriptions` and reports "Connected — the server
answered in 180 ms" or the error sentence (an empty-text answer to silence counts as
connected).

## Design

- `transcription-service.ts`: throw the missing-key error only when `endpoint` is empty;
  omit the `Authorization` header entirely when the key is empty (never `Bearer `);
  `humanApiError(status, message, endpoint)` — for 401/403 with a custom endpoint use the
  host wording above.
- `src/shared/engine.ts` `engineReady`: cloud → `apiKeySource !== 'none' ||
  apiEndpoint.trim() !== ''`; the not-ready reason for cloud stays "Add your API key in
  Settings before recording." Update `setup-guide.ts` (`api-key` step only when cloud, no
  key and no endpoint) and every readiness caller.
- Test connection: IPC `transcription:test` (fromMain-guarded) building a 1 s 16 kHz
  silent WAV with the existing `encodeWavPcm16` logic (copy into a small shared helper or
  `src/main/wav.ts` from 07a — do not import renderer code into main), calling the service
  with a 10 s timeout, returning `{ ok, ms, error }`. Preload wrapper; button + result line
  in the cloud section.

## Tests

`tests/transcription-service.test.ts`: custom endpoint + no key → request sent without
Authorization; default endpoint + no key → throws before fetch; 401 wording per endpoint.
`tests/setup-guide.test.ts`, readiness tests updated. Test-connection handler logic unit
tested through an extracted pure function if practical.

## Done when

`npm run typecheck && npx vitest run && npm run lint` pass. Do not commit.
