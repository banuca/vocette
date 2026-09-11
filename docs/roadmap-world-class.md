# Murmur — roadmap to a world-class paid product

Synthesis of four codebase audits, four market and technology research passes, and three
competing roadmap proposals, resolved into one ranked plan.

Written against Murmur v0.4.0 (branch `main`, latest commit `83d7fa8`). Every file and line
reference below was checked against the working tree on 11 September 2026.

---

## 1. Where Murmur stands today

### What exists

Murmur is a 6,800-line Electron and TypeScript push-to-talk dictation app. It records on a
global chord, posts the audio to an OpenAI-compatible `/audio/transcriptions` endpoint using
the user's own key, strips four filler words with a regex, writes the result to the clipboard
and injects Ctrl+V. It has a tray, a click-through overlay, a local JSON history store, a
versioned settings store with OS-encrypted key storage, three platform adapters and 28 vitest
files. There is no server, no account, no telemetry and no auto-update.

The engineering is better than the product. The concurrency work is genuinely careful: the
dictation state machine has watchdogs, request-id guards and cancellation races covered by a
967-line test file; the history store has crash-safe atomic writes with backup recovery; the
platform layer reports honestly what it cannot do rather than failing silently. That
temperament is the asset the rest of this roadmap is built on.

### What is missing

| Area | State today | Evidence |
|---|---|---|
| Custom vocabulary | None. The `prompt` field that exists for exactly this is spent on a fixed generic sentence | `src/main/transcription-service.ts:39-41`, `:80` |
| Post-processing | A regex removing "um", "uh", "erm", "hmm", plus spacing and capitalisation. 31 lines total | `src/shared/cleanup.ts` |
| Cleanup gate | Silently inert unless language is exactly `'en'`, including on Automatic | `src/main/dictation-controller.ts:441` |
| Local / offline | Blocked by one line rejecting an empty API key | `src/main/transcription-service.ts:60` |
| Clipboard | Overwritten permanently, never restored | `src/main/index.ts` (`writeClipboard`, `clipboard.writeText`) |
| Paste verification | None. The status says "Copied and pasted" whether or not it landed | `src/main/dictation-controller.ts` (`pasteOrExplain`) |
| Latency | No instrumentation anywhere. `durationMs` is audio length, not the wait | `src/shared/types.ts:35` |
| Upload size | Opus transcoded to PCM16 WAV, roughly 5.3x inflation | `src/renderer/audio-prep.ts` |
| Capture start | The microphone opens cold *after* the 250 ms hold delay; 400-750 ms of speech is lost | `src/renderer/recorder.ts`, `src/shared/shortcuts.ts` |
| App identity | The target process ID is obtained for the elevation check and then discarded | `src/main/foreground.ts:86` |
| Response shape | Only `payload.text` is read; segments, word timings and confidence are discarded | `src/main/transcription-service.ts` |
| Licensing and sale | Nothing. Zero occurrences of licence, trial, activation or purchase in `src/` | — |

Two structural hazards worth naming now, because they destroy user data rather than merely
annoying:

- `isHistoryEntry` (`src/main/history-store.ts:19-29`) is an all-or-nothing predicate applied
  as a **filter** in the constructor (`:75`), and the history file carries no version marker.
  Add a required sixth field and every existing transcript is silently dropped;
  `takeWarning()` returns null because the JSON parsed fine, and the next write persists the
  emptied array over the user's data. **Every new history field must be optional.**
- `getPublic()` (`src/main/settings-store.ts:228`) projects by deletion, not by allow-list:
  `const { encryptedApiKey: _key, version: _version, ...values } = this.settings`. Any new
  `StoredSettings` field crosses the IPC bridge to the renderer at runtime with no compile
  error. A licence token added later would leak by default.

And one that wastes effort on every future change: every settings rule is written twice, once
in `normaliseSettings` (load path, `:121-190`) and again in `update()` (save path,
`:264-339`). `SETTINGS_VERSION = 5` is written on every save and read by nothing —
`normaliseSettings` never inspects `candidate.version`. There is no migration chain, only an
idempotent normaliser. That is forward-safe but cannot express a migration that rewrites a
value of the same shape.

### The competitive picture

**The category is real and funded.** Wispr Flow raised $280M at a $2B valuation in August 2026,
$361M total. Its pricing sets the ceiling: free at 2,000 words per week on desktop, Pro at
$15/user/month or $12 annual, Growth at $23 monthly or $18 annual with SSO and org-wide HIPAA
enforcement (fetched from `wisprflow.ai/pricing`).

**The bottom of the market has collapsed into free.** Windows Voice Access ships on-device,
offline and unlimited in the operating system (Microsoft support documentation). Apple's
SpeechAnalyzer and SpeechTranscriber APIs (WWDC25, macOS 26) made high-quality on-device ASR
free infrastructure for any Mac developer; MacStories measured a CLI tool using them running
2.2x faster than MacWhisper's Large-v3 Turbo with no noticeable quality difference. Roughly
twenty free local dictation apps appeared on Hacker News in under a year. Handy alone is free,
open-source, offline, Mac/Windows/**Linux**, no account, no caps, and already does more than
Murmur v0.4.0.

**So "an Electron app that posts audio to an OpenAI endpoint with a bring-your-own key" is
below the free floor, not above it.** This is the single most important finding in the research
and the whole roadmap is built around it.

**Where paid money actually is.** The proven indie band is one-off. VoiceInk sells $25 / $39 /
$49 by device count with its GPL-3 source public and openly says so (`tryvoiceink.com`).
MacWhisper sells around €59 direct. Superwhisper is $8.49/month with a widely reported but
unconfirmed $249.99 lifetime. Aqua Voice is $8/month annual and publishes roughly 450 ms
release-to-text and 6.24% WER at the launch of its Avalon model (`aquavoice.com/info/faq`).
Dragon has effectively left the market: Professional v16 is $699.99, Windows-only, no major
update since 2023; Dragon for Mac was discontinued in 2018; Dragon Anywhere Mobile ended sales
and renewals on 1 July 2026. That is a stranded professional cohort with no successor.

**Two unserved flanks.** Nobody funded ships Linux — not Wispr, Willow, Aqua, Superwhisper,
MacWhisper or VoiceInk. Talon supports X11 and explicitly refuses Wayland. Separately, Wispr's
own documentation states that its context-aware formatting is **macOS-only**, and that Linux,
iPad, Chromebooks, virtual machines and remote desktop environments are not supported at all.

**The trust opening.** Wispr was found uploading screenshots of the active window to cloud
infrastructure, and its CTO publicly apologised. Aqua's default is retaining transcripts for
model improvement with an opt-out. Those are claims Murmur's architecture cannot make and does
not need to.

**Evidence caveat, stated plainly.** Nearly every "comparison" and "alternatives" page ranking
for these queries is published by a competing dictation app (spokenly, getvoibe, lumevoice,
willowvoice, blablatype, dictaflow and a dozen more). Where a number matters above, it is from
a vendor pricing page, Microsoft or Apple documentation, Hacker News, or a GitHub issue.
Secondary-source figures — Superwhisper's lifetime price, Wispr's WER and RAM numbers,
Trustpilot scores — are **unverified** and must not be repeated in Murmur's own marketing.
Murmur should measure and publish its own latency on a fixed audio set instead.

### The name problem

"Murmur" is already the name of at least four other dictation products, several on macOS:
MurmurType (distributed on Setapp), MurmurAI (Gumroad), murmurtype.com, murmur.you, plus two
GitHub dictation projects. It also collides with Mumble's `murmurd` daemon and MurmurHash.
`electron-builder.yml:1` claims the reverse-DNS `dev.murmur.app` for a domain nobody owns. This
is a commercial blocker, not a detail. See section 6.

---

## 2. The thesis — what a paying user is actually buying

**A dictation tool that gets *your* words right, is provably yours, and does not get in the
way — bought once, not rented.**

The three source proposals argued for three different headlines: speed, accuracy, and privacy.
They are resolved as follows, and the resolution is the thesis.

### Accuracy on the user's own words is the pitch

The arithmetic decides it. Time saved = typing time − (speaking time + **fixing time**), and
fixing time dominates everything. Shaving 1.5 seconds off a take is worth less than not having
to reach for the mouse, double-click a word and retype a colleague's name — which costs 6-10
seconds and happens on every take until the tool is taught. A 20-second dictation with two
wrong proper nouns is a net loss against typing.

Nobody but Murmur knows that your colleague is "Kirinde", that your employer writes
"ITU-T G.9960", or that your commit messages are imperative mood and your Slack messages are
not. That knowledge lives in the user's own vocabulary list, their corrections, their foreground
app and their local history file — data a server-side competitor would have to exfiltrate to
match, which is exactly what its customers fear. It compounds weekly, and compounding
personalisation is the only switching cost available to a product with no accounts and no
server.

### Privacy and ownership are the proof and the moat

They are not a separate pitch. They are what makes the accuracy layer credible, and what a
funded competitor cannot copy after a screenshot-upload incident. The architecture is already
right: exactly one outbound network call in the entire codebase
(`src/main/transcription-service.ts`), and all three renderers declare `connect-src 'none'`
(`src/renderer/index.html:7`, `overlay.html:7`, `recorder.html:7`), so a complete and
auditable network ledger is a day's work rather than an architecture. The endpoint is already
user-configurable and the settings store already permits `http` on localhost specifically so a
self-hosted whisper.cpp can be used — a single line blocks it today.

### Speed is hygiene, not the pitch — but the hygiene must be done

Murmur cannot win a latency race. It is an Electron app proxying someone else's API on the
user's key, against a competitor publishing roughly 450 ms and another that rewrote its
infrastructure with $361M. Below about one second nobody perceives a difference anyway.

But four of Murmur's current latency defects are self-inflicted and cheap to remove: the
microphone opening cold after the hold delay, the 5.3x WAV inflation, no retry on a transient
failure, and a blind paste that claims success. Fix them, measure them, and do not build the
pitch on them. The local engine later delivers speed as a by-product of privacy, which is the
only framing under which people actually choose the private option.

### Who is paying

Not the Wispr user who wants the cleverest rewrite. The lawyer, the clinician, the NGO analyst,
the Dragon refugee, the Linux developer, and the engineer dictating prompts into Claude Code
and Cursor. People who need dictation that works air-gapped, has no data processor to name in a
DPIA, does not meter their words, and does not stop working when a vendor changes its pricing.
They pay once, for a signed build with support behind it.

---

## 3. The ranked roadmap

| # | Feature | One line | Effort | Tier |
|---|---|---|---|---|
| 1 | Custom vocabulary | Your names, acronyms and product codes biased into the recogniser | Medium | Free |
| 2 | Cleanup that actually runs | The filler switch stops being silently inert on Automatic | Small | Free |
| 3 | Key-free local and self-hosted endpoints | Delete the one line blocking whisper.cpp, LM Studio and Ollama | Small | Free |
| 4 | Clipboard custody and honest delivery | Give the clipboard back; stop claiming an unverified paste | Small | Free |
| 5 | Latency breakdown and payload discipline | Measure every phase; drop the pointless WAV transcode | Medium | Free |
| 6 | Spoken replacements and snippets | `spoken => written` rules, and voice-triggered text blocks | Small | Free / Pro |
| 7 | History as a correction workspace | Edit, re-run cleanup, undo a delete | Medium | Free |
| 8 | Silent retry and an in-window Retry | One backed-off retry before the user ever sees a failure | Small | Free |
| 9 | Start listening at the keypress | Stop losing the first 400-750 ms of every take | Medium | Free |
| 10 | Network ledger and offline lock | Watch every byte leave, or forbid any from leaving | Medium | Free |
| 11 | Learn from corrections | Every edit becomes a term it never gets wrong again | Medium | Pro |
| 12 | Polish pass with a visible diff | LLM cleanup that honours self-corrections and shows what it changed | Large | Pro |
| 13 | Offline licence and entitlement | Ed25519, verified on-device, works air-gapped, no server | Medium | Pro gate |
| 14 | Signed Windows build and opt-in update check | The thing actually being sold | Medium | Pro |
| 15 | On-device transcription engine | Parakeet v3 locally: no key, no bill, no network, about 0.5 s | Large | Pro |
| 16 | Per-app style buckets | Email, work chat, personal chat, other — from data already discarded | Medium | Pro |

Ordering rule: cheap visible wins that are also foundations first; then the Pro value that
justifies a price; then the licence and signing that let you charge; then the two large bets.
Items 13-16 must be re-evaluated against real evidence from items 1-12, not built on faith.

---

### 1. Custom vocabulary

**What the user sees.** A new Settings card, "Your words", with a plain text area: one term per
line — names, acronyms, product codes, project names. Every dictation sends those terms to the
provider as recognition bias, so "Kirinde", "ITU-T", "Dataverse" and "koffi" come back spelled
correctly on the first take instead of "Kurindi", "I-T-U-T", "data verse" and "coffee". One
honest line under the box states which biasing channel the currently selected model supports.

**Why it wins.** It is the cheapest real accuracy gain available in this codebase, because the
plumbing already exists and is being wasted: `buildPrompt(language)`
(`src/main/transcription-service.ts:39-41`) already appends a `prompt` field on every request
and currently spends that entire biasing channel on a generic sentence. Every paid competitor
ships a vocabulary; Murmur has the field and no user content in it. It is also the foundation
that features 6, 11 and 16 all read or write.

**Files that change.** `src/shared/types.ts` (`PublicSettings`, `SettingsUpdate`);
`src/main/settings-store.ts` (`StoredSettings`, `DEFAULT_SETTINGS`, `normaliseSettings`,
`update()`); `src/main/transcription-service.ts` (`TranscribeInput`, `buildPrompt`, the
`body.append` block); `src/main/dictation-controller.ts` (`WorkflowSettings`,
`TranscriptionPayload`); `src/main/index.ts` (`workflowSettings()`, `transcribe()`);
`src/renderer/pages/settings.ts` (markup, query handle, `syncControlValues`, save object);
`tests/transcription-service.test.ts`, `tests/settings-store.test.ts`. Full brief in section 7.

**Effort.** Medium — about seven small edits across five files, all in patterns the codebase
already uses. No new architecture.

**Risk.** The `keywords` request parameter must be verified against the live API before
shipping; if it is rejected, the prompt-append path still works on every OpenAI-compatible
endpoint including Groq and local servers, and the feature ships with that path only.
Over-biasing is the second risk: a long list of rare terms can make a model hallucinate them
into unrelated audio, which is one reason to cap the free tier at 25 terms.

**Tier.** Free, capped at 25 terms. Unlimited is Pro.

---

### 2. Cleanup that actually runs

**What the user sees.** The "Light cleanup" switch stops being silently inert. Today
`src/main/dictation-controller.ts:441` gates it on `settings.language === 'en'`, so a user who
picks Automatic — the first entry in the language list, and a reasonable choice — gets no
cleanup at all from a switch that shows as on. After this change the language-neutral repairs
(spacing around punctuation, collapsed duplicates, sentence capitalisation) apply to every
language, the English filler dictionary applies to `en` and `auto`, capitalisation is skipped
for scripts with no case, and the switch label says what it does.

**Why it wins.** It is a trust bug directly on the accuracy path, and it is nearly free. A user
who turns on a switch and sees no effect concludes the product does not work, not that an
invisible language gate is the cause.

**Files that change.** `src/shared/cleanup.ts` (signature becomes
`lightCleanup(input, language)`, body split into always-applied repairs, the filler dictionary,
and the two capitalisation passes); `src/main/dictation-controller.ts:441-443`;
`src/renderer/pages/settings.ts` (the "Light cleanup" toggle label and hint, currently worded
"For explicitly English dictation…"); `tests/cleanup.test.ts`.

**Effort.** Small.

**Risk.** Low. The only judgement call is whether `auto` gets the English filler dictionary. It
should: the overwhelmingly common case is an English speaker who left the language on
Automatic, and the pattern only matches um/uh/erm/hmm, which are not words in the other
supported languages. Add a test asserting a German sentence survives intact.

**Tier.** Free.

---

### 3. Key-free local and self-hosted endpoints

**What the user sees.** Murmur stops demanding an API key when a custom endpoint is configured,
so whisper.cpp, LM Studio, Ollama, Speaches, a self-hosted server or an internal corporate
Whisper deployment all work with no key and no account. The Transcription card gains one-click
presets that fill the endpoint and model together, and the setup checklist stops saying "add an
API key" when a keyless local endpoint is in use.

**Why it wins.** The blocker is literally one line — `if (!input.apiKey) throw` at
`src/main/transcription-service.ts:60` — while the settings store already goes out of its way
to permit `http://localhost` endpoints and already accepts an arbitrary model name against a
custom endpoint. The intent is in the code and the door is bolted. Removing it makes "your
audio never leaves your machine" literally true today, for the technical early adopters who are
the only people who will find Murmur before it has a landing page, with none of the packaging
risk of feature 15. It is also the cheapest way to de-risk that bet: if nobody uses this,
reconsider shipping a 250-670 MB model in the installer.

**Files that change.** `src/main/transcription-service.ts:60` (gate the throw on the endpoint
being non-default; omit the `Authorization` header entirely rather than sending `Bearer `) and
`humanApiError` (the 401 wording currently tells a local-server user to add a key);
`src/shared/types.ts` (`hasApiKey` is the readiness gate — introduce
`transcriptionConfigured(settings)` beside it); `src/main/index.ts` (`workflowSettings()`'s
`apiKeyConfigured`, the first-launch page choice); `src/main/dictation-controller.ts` (the key
check in `startDictation`); `src/renderer/setup-guide.ts`;
`src/renderer/recording-control.ts` (pure, tested, currently blocks on a missing key);
`src/renderer/pages/settings.ts`; `tests/transcription-service.test.ts`,
`tests/setup-guide.test.ts`, `tests/recording-control.test.ts`.

**Effort.** Small.

**Risk.** The capability plumbing is the trap, not the one-line throw. `apiKeyConfigured` gates
the record button, the setup checklist and the first-launch page; miss one and a user with a
working local endpoint is still nagged to add a key. The gate must be precise: keyless is
allowed **only** when a custom endpoint is set, never as a general relaxation. Add a "Test
engine" button beside the existing microphone test, because a local server that is not running
otherwise fails at the worst possible moment. Say honestly in the UI that small local models
are usually worse on technical vocabulary.

**Tier.** Free.

---

### 4. Clipboard custody and honest delivery

**What the user sees.** Murmur stops stealing the clipboard. What was copied before is saved
and restored after the paste settles. Where a paste cannot be verified, the status says
"Copied" rather than "Copied and pasted".

**Why it wins.** Every paid competitor has an open bug here: VoiceInk documents a
clipboard-restore race, VocaMac issue #104 documents a 300-400 ms window where the wrong
content pastes, VoiceStudio #287 pastes stale content, openai/codex #11103 has Superwhisper
racing Codex's own clipboard writes, and Wispr's own troubleshooting page admits it leaves the
transcript on the clipboard and does not restore the previous contents. Murmur already does the
hard half honestly — it captures the foreground window at take start, re-checks before pasting,
detects elevated targets and falls back to "Copied — paste manually" rather than lying.
Finishing it makes "more reliable than anything you are paying for" a testable claim. It is
also on-thesis: the clipboard is the user's, and taking it without giving it back is the same
disrespect the pitch is against.

**Files that change.** `src/main/index.ts` (`writeClipboard` becomes save-and-return-restore;
a new `restoreClipboard` entry on `DictationDeps` wired in `createDictationController()`);
`src/main/dictation-controller.ts` (`pasteOrExplain` owns the sequence, the existing
`PASTE_DELAY_MS` settle and the double foreground check; the existing `ownsAttempt` guards
already cover cancellation mid-paste); `tests/dictation-controller.test.ts`.

**Effort.** Small.

**Risk.** The restore delay is a race by construction: too early and the target pastes the old
clipboard, too late and the user's own Ctrl+V a second later gets the transcript. Ship a
conservative named constant beside `PASTE_DELAY_MS`, make it a setting, and tune it against
the instrumentation from feature 5 rather than by guess. Skip the restore entirely when the
paste was refused, so the transcript stays available for a manual paste — that fallback must
not regress. Non-text clipboard contents (an image, a file list) cannot be round-tripped
through `readText`: detect that case and leave the clipboard alone rather than destroying it,
and say so in the UI.

**Tier.** Free.

---

### 5. Latency breakdown and payload discipline

**What the user sees.** Every completed dictation reports where its milliseconds went —
microphone open, record, audio delivery, transcribe, paste. The overlay shows the total on
success; History carries a "Last dictation" strip with the breakdown. At the same time the
PCM16 WAV transcode is dropped for the cloud path, cutting the upload roughly 5.3x (a 30-second
take goes from about 960 KB to about 180 KB).

**Why it wins.** You cannot defend a speed claim you do not measure, and nobody currently knows
whether Murmur's p50 is 1.8 s or 4 s. Every other change becomes a provable before-and-after
instead of a feeling. The WAV removal is close to free: `src/renderer/audio-prep.ts` justifies
it as "the format whisper-family models transcribe best", which is unsubstantiated — the API
decodes Opus server-side to the same 16 kHz PCM. It also relieves the stop watchdog, which
currently has to cover the MediaRecorder flush *and* the whole decode, resample, trim and
encode, so a long take on a slow machine loses its audio outright.

**Files that change.** `src/renderer/audio-prep.ts` (make the output format a parameter; keep
the silence trim); `src/main/dictation-controller.ts` (phase stamps on the existing named
transition points; split the prep budget out of `STOP_WATCHDOG_MS`); `src/shared/types.ts`
(an optional `timings` field on `WorkflowStatus` **only**); `src/renderer/overlay.ts`;
`src/renderer/pages/history.ts`; `tests/audio-prep.test.ts` (the first test of
`prepareForTranscription` itself, including the silent fallback path),
`tests/dictation-controller.test.ts`.

**Effort.** Medium.

**Risk.** Do **not** persist timings onto `HistoryEntry` in the same change — see the
`isHistoryEntry` filter hazard in section 1. Keep them in `WorkflowStatus`; persist later as
optional fields with a test that an entry lacking them still loads. Accuracy after dropping the
WAV must be verified on a fixed set of ten phrases including names and numbers, not assumed.
Verify that Groq- and whisper.cpp-hosted endpoints accept WebM/Opus per preset.

**Tier.** Free.

---

### 6. Spoken replacements and snippets

**What the user sees.** A second list in the same "Your words" card: `spoken => written` rules,
one per line. "console log => console.log()", "arrow function => =>", "itu => ITU",
"my address => 4 Rue de Varembé, Geneva". Applied after transcription, case-insensitive,
whole-word, longest rule first, never re-entering an already-replaced span. That single
mechanism covers both the corrections vocabulary cannot reach (homophones, expansions, spoken
punctuation) and the snippet case (a spoken trigger expanding to a block of text).

**Why it wins.** Superwhisper's documentation draws this line explicitly and shipping only one
of the two is the common gap: a vocabulary entry tells the recogniser a term *exists*; a
replacement rewrites what you said into what you meant. They are different stages and must be
wired to different points in the pipeline. It is also the cheapest route to snippets, which
every competitor charges for — and Wispr's own FAQ states flatly that dynamic variables are not
supported, leaving `{date}`, `{time}`, `{clipboard}` as an unclaimed differentiator to add
later on the same mechanism.

**Files that change.** `src/shared/cleanup.ts` (a pure exported `applyReplacements(text, rules)`
plus a pure rule parser that ignores malformed lines rather than throwing); `src/shared/types.ts`;
`src/main/settings-store.ts` (the same five-place recipe as feature 1);
`src/main/dictation-controller.ts` (composed at the single post-processing seam, after
`lightCleanup`); `src/main/index.ts` (`workflowSettings()`); `src/renderer/pages/settings.ts`;
`tests/cleanup.test.ts`.

**Effort.** Small.

**Risk.** Escaping. Rules must be treated as literal strings, not regular expressions, or a user
typing `console.log()` as a search term breaks the pass. Whole-word matching is required so
"itu" does not fire inside "situation". Both need tests.

**Tier.** Free at 10 rules; unlimited is Pro. Bulk CSV import and export is table stakes for
anyone migrating off a competitor and costs almost nothing — ship it free.

---

### 7. History as a correction workspace

**What the user sees.** Per-entry actions go from two (Copy, Delete) to five: Edit (inline, saves
the corrected text), Copy, Re-run cleanup (re-applies the current vocabulary and replacement
rules to the stored text), Delete, and Undo after a delete.

**Why it wins.** Two jobs at once. It fixes the product's worst small failure — a mis-clicked
Delete on a long dictation is currently unrecoverable behind a `window.confirm` — and it is the
data-collection surface for feature 11. You cannot learn from corrections until there is a place
where corrections happen. Building the edit surface before the learning loop keeps each unit
small enough that a failure points at one cause.

**Files that change.** `src/shared/types.ts` (`HistoryEntry` gains `originalText?` and
`editedAt?`, both **optional**); `src/main/history-store.ts` (an `update(id, text)` method beside
`add()`/`delete()`, reusing the existing `persist()` snapshot path; leave `isHistoryEntry`'s five
required fields untouched); `src/main/index.ts` (two handlers inside `registerIpc()`, each with
the `fromMain(event)` guard its 24 siblings use — note `app:info` is the one sibling missing it,
so do not copy that handler as a template); `src/preload/index.ts` (two wrappers; channel strings
are retyped here and nothing compares them to the main-process literals, so a typo is a silent
no-op); `src/renderer/pages/history.ts` (the per-entry actions div is built imperatively, so new
buttons append without touching the list or grouping code); `tests/history-store.test.ts`.

**Effort.** Medium.

**Risk.** The `isHistoryEntry` filter, above. Add a test asserting that an entry without the new
optional fields still loads. Second, an in-place edit could conflict with a concurrent retention
prune: route the edit through the same serialised persist tail the store already uses.

**Tier.** Free.

---

### 8. Silent retry and an in-window Retry

**What the user sees.** A 429, a 503 or a dropped connection triggers one bounded retry with
backoff, honouring `Retry-After`, before the user is told anything. If it still fails, the
already-retained take is offered as a button on the History page and the record control, not
only as a tray menu item.

**Why it wins.** Rate limits and transient gateway errors are routine on OpenAI-compatible
endpoints, and today a single one costs the take a 4.5-second error toast plus a hunt through
the system tray. One invisible retry makes most failures stop existing. The button half is
nearly free: `retryLastDictation` is already exposed on the preload bridge and already wired
end to end in main — no renderer code calls it.

**Files that change.** `src/main/transcription-service.ts` (the fetch is already in its own
try/catch with `humanApiError` next door; the retry loop, `Retry-After` parse and backoff live
entirely inside that block, invisible to the controller);
`src/renderer/recording-control.ts` (a pure, tested function — a `retryable` branch is testable
without a browser); `src/renderer/pages/history.ts` (the toolbar is a flex row with a spacer, so
the button drops in with no CSS); `tests/transcription-service.test.ts`,
`tests/recording-control.test.ts`.

**Effort.** Small.

**Risk.** A retry must not silently double a request the user pays for: cap at one, only for
429/5xx/network, never for 401/413, and surface the added wait in the overlay. It must respect
the caller's `AbortSignal`, which is already ANDed with the service timeout, so a cancelled take
cannot retry from the grave.

**Tier.** Free.

---

### 9. Start listening at the keypress

**What the user sees.** The microphone opens the instant the chord is satisfied, in parallel
with the hold delay, instead of after it. If the delay elapses with the chord still held,
recording begins on an already-open device. If the user lets go early, the stream closes and no
take exists. Time to listening falls from 400-750 ms to roughly the device-open time alone, and
usually to zero because the open completes inside the hold delay.

**Why it wins.** The clipped first word is the most damaging failure in push-to-talk dictation,
the most common complaint in the category, and today it is silent — the user has no idea "send"
went missing from "send it by Friday". It costs nothing in privacy posture: the microphone
still only opens when you press the chord, just 250 ms earlier.

**Files that change.** `src/main/shortcut-controller.ts` (the arm timer already exists; add
`onArm()` fired when the chord is satisfied and `onDisarm()` on cancel);
`src/main/dictation-controller.ts` (new `prepareDictation()` / `abandonPreparation()` alongside
`startDictation`, sending new `recorder:prepare` / `recorder:discard` messages through the
existing `sendToRecorder` dep); `src/renderer/recorder.ts` (split `start()` into open-then-hold
and a `begin()` that constructs the MediaRecorder on the already-open stream; `cleanupTake` is
the matching release); `src/main/index.ts` and `src/preload/recorder.ts` for the two channels;
`tests/recorder-race.test.ts` (already covers late-resolving microphone opens).

**Effort.** Medium.

**Risk.** The race surface is real: prepare, abandon, prepare within 250 ms must not leave two
streams open or one orphaned, and a device that opens after the abandon must close itself. A
prepared-but-never-started stream needs a hard ceiling so a stuck modifier cannot hold the
microphone open indefinitely. Do **not** extend this into a permanently warm stream with a
pre-roll buffer — that leaves the operating system microphone indicator lit all day and is a
privacy-posture decision the owner has not made.

**Tier.** Free.

---

### 10. Network ledger and offline lock

**What the user sees.** A new Privacy page listing every outbound request this session:
timestamp, destination host, bytes sent, bytes received, duration, outcome — and saying plainly
when the list is empty. A single "Offline lock" switch makes the app refuse any network call at
all: dictation either runs on a local engine or fails with an honest message, never silently
falls back to the cloud. The ledger is in memory only and is gone when the app quits.

**Why it wins.** It turns the privacy promise into something the user watches happen. It is
uniquely cheap here because there is exactly one fetch call site and all three renderers are
locked to `connect-src 'none'`, so the ledger is provably complete rather than best-effort — and
that completeness is checkable against the MIT source. It is also the choke point every later
network feature registers through, including Murmur's own update check, so no future feature can
quietly add a call.

**Files that change.** New `src/main/network-ledger.ts` (a bounded in-memory ring with
`record`/`list`/`clear` and an `isLocked()` gate — pure, injectable, unit-testable);
`src/main/transcription-service.ts` (wrap the fetch; throw before it when locked);
`src/main/index.ts` (construct, pass into `transcribe()`, two IPC handlers);
`src/main/settings-store.ts` and `src/shared/types.ts` (`offlineLock`, and extend `Page`);
`src/preload/index.ts`; `src/renderer/main.ts` (nav button and dispatch branch — adding a page
costs four edits and no layout work); new `src/renderer/pages/privacy.ts`.

**Effort.** Medium.

**Risk.** The ledger must never record transcript text or audio bytes, only counts and hosts, or
it becomes the leak it was built to disprove. Enforce that with a test asserting the entry type
has no text field. The offline lock must be enforced inside `transcription-service.ts` itself,
in main, so no future call path and no hand-edited settings file can bypass it.

**Tier.** Free. This is evidence, not a feature to sell.

---

### 11. Learn from corrections

**What the user sees.** When a History entry is edited, Murmur diffs the original against the
correction. A word-level change that looks like a proper noun or a technical term ("Kurindi" to
"Kirinde") is offered as a vocabulary term; a phrase-level change that recurs is offered as a
replacement rule. Suggestions appear as a small "3 suggested terms" banner in the "Your words"
card with Accept or Dismiss per item. Nothing is added automatically and nothing is sent
anywhere.

**Why it wins.** This is the thesis made mechanical, and the compounding asset. Willow markets
an auto-dictionary as a paid feature; Wispr's dictionary is manual entry only. Murmur can do it
better and more honestly because it already keeps a local history store — the mechanism needs no
new data collection, no server and no telemetry. A user two months in has a Murmur measurably
more accurate than a fresh install of anything else.

**Files that change.** New pure module `src/shared/corrections.ts` (`diffCorrections`, no
Electron, no I/O — the same shape as `cleanup.ts` and `setup-guide.ts`, both pure and already
tested); `src/main/index.ts` (call it from the history-update handler added in feature 7;
accumulate pending suggestions in a small third store built on `src/main/atomic-json.ts`, which
both existing stores already inject as a persistence interface); `src/preload/index.ts`;
`src/renderer/pages/settings.ts`; new `tests/corrections.test.ts`.

**Effort.** Medium.

**Risk.** False positives are the failure mode: suggesting every typo turns the banner into
noise and the user switches it off. Be conservative — require the changed token to be
non-dictionary-shaped (capitalised mid-sentence, containing digits or internal punctuation, or
unusually long), and require a phrase rule to recur at least twice. Suggest, never auto-apply: a
wrongly auto-applied term poisons every future dictation and is very hard to diagnose.

**Tier.** Pro.

---

### 12. Polish pass with a visible diff

**What the user sees.** An optional second call, to any OpenAI-compatible chat endpoint
including a local Ollama or LM Studio, that turns raw ASR into finished text: paragraphs,
sentence boundaries, spoken lists made into real lists, and self-corrections honoured, so "the
deadline is Tuesday, no sorry, Wednesday" pastes as Wednesday. Three intensities: Off
(verbatim), Light (today's regex), Polish. A hard latency budget: if the call has not returned
in time, the raw text is pasted and the overlay says so. The History entry keeps both texts and
shows a diff of exactly what changed, with one click back to verbatim.

**Why it wins.** Self-correction handling is what people mean when they call Wispr magic, and
regex provably cannot do it. But the differentiator is not the rewrite — everyone has that — it
is the diff and the revert. The loudest complaint about every paid competitor is over-aggressive
rewriting: "sounds weirdly formal", "the soul gone", casual phrasing formalised into a different
meaning, with nobody showing what changed. For a product whose pitch is that nothing happens to
your words without your say-so, a visible diff is the trust-preserving version of AI cleanup and
costs almost nothing once the text is already stored twice.

**Files that change.** New `src/main/polish-service.ts` (modelled directly on
`transcription-service.ts`: same fetch shape, same `AbortSignal` composition, same
human-error mapping, its own budget constant, routed through the ledger and refused by the
offline lock unless the endpoint is local); `src/main/dictation-controller.ts` (a new
`polish(text, context, signal)` entry on `DictationDeps`, inserted at the single
post-processing seam where the existing `ownsAttempt` guards already cover cancellation);
`src/main/index.ts` (`createDictationController()`, and `recordHistory` extended to carry both
texts); `src/main/settings-store.ts` and `src/shared/types.ts`;
`src/renderer/pages/settings.ts`; `src/renderer/pages/history.ts` (reuse the `<mark>`
highlighting already written for search); new `tests/polish-service.test.ts` plus controller
cases for budget-exceeded and cancel-during-polish.

**Effort.** Large.

**Risk.** Latency is the whole game — published time-to-first-token figures for fast cloud
providers run 0.8-0.9 s, which would blow any sensible budget on its own. Measure before
promising; if the budget is regularly exceeded, the honest answer is to default it off and say
so. The system prompt must name the input as speech-to-text output and forbid preamble, or the
model greets the user into their email — test for it. Model identifiers change on a schedule
(Gemini 2.5 Flash-Lite retires 16 October 2026), so the model name must live in settings with a
default, never hard-coded. This also doubles the number of places a transcript exists in
flight; the existing zeroing discipline must extend to the polish path. State plainly that
cleanup fixes grammar and structure, not misheard words.

**Tier.** Pro.

---

### 13. Offline licence and entitlement

**What the user sees.** A fourth page, Account. An unlicensed Murmur dictates without limit and
keeps 25 vocabulary terms and 10 replacement rules; Pro features show as disabled with a stated
reason. A licence key pasted into the field is verified entirely on-device against a public key
compiled into the main process — no activation call, no account, no network. It works on a
machine that has never touched a network.

**Why it wins.** Nothing above can be charged for until this exists, which is why it sits here
rather than first: it should not be built before there are Pro features worth gating. Offline
verification is not a compromise, it is the feature — it is what lets Murmur be sold into
air-gapped facilities, secure rooms and regulated environments that Wispr and Aqua structurally
cannot enter, and it keeps the written no-network promise intact.

**Files that change.** New `src/main/licence.ts` (node:crypto Ed25519 verify over a JSON
payload, public key as a module constant; pure and testable without Electron). Storage reuses
`src/main/secure-storage.ts` (`assessSecureStorage` with an injectable probe) and the
`SettingsStore` credential pattern rather than inventing a second mechanism — that store already
models an encrypted-at-rest blob, a session-only variant, a source enum, a projection excluding
the secret, and an honest refusal where OS storage is unfit. `src/shared/capabilities.ts` (a
`licensed` capability id, which inherits the disabled-with-a-reason control and tray gate for
free); `src/main/index.ts` (`app:info` carries licence status — and that handler is the one
missing its `fromMain(event)` guard, so fix it in the same change; plus checkout and
manage-licence entries in the two-item external URL allow-list);
`src/renderer/pages/about.ts` and a new Account page.

**Effort.** Medium.

**Risk.** Under MIT anyone can fork and delete the check — say so plainly rather than
engineering against it. The real risks are mundane: `getPublic()` leaking the token (convert it
to an explicit allow-list in the same change); a clock-dependent expiry failing on a machine
with a wrong clock (verify the signature and issue date, do not hard-expire a perpetual
licence); and `SETTINGS_VERSION` being write-only, which means a future migration that needs to
relocate the licence has no mechanism — wire version dispatch here, while the file has only
been round-tripped once.

**Tier.** This is the gate itself.

---

### 14. Signed Windows build and opt-in update check

**What the user sees.** The Windows installer is code-signed, so SmartScreen stops warning
people who have just paid. A version check runs only if the user turns it on, states exactly
what the request contains before the first one is made, appears in the network ledger like any
other call, and never downloads anything on its own.

**Why it wins.** This is the first thing actually being sold. An unsigned binary that asks for
microphone and global-keyboard access is unsellable, and doubly absurd for a product whose pitch
is trustworthiness. The update check is the harder half: `CONTRIBUTING.md`, `SECURITY.md` and
`README.md` currently promise users there will never be an update call. That promise must be
renegotiated in writing — opt-in, refusable, visible in the ledger — or the first thing the
privacy product does is break its own word. Doing it that way is itself the differentiator;
everyone else's updater is silent and unrefusable.

**Files that change.** `electron-builder.yml` (Windows signing configuration; the absent
top-level `publish:` key is where the update feed is declared);
`.github/workflows/ci.yml` (the `package` job already builds per-OS and runs
`scripts/check-native-packaging.mjs` — a tag-triggered release job forks from there, adding
signing secrets and swapping the artifact upload for a publish step);
`scripts/check-native-packaging.mjs` (extend to assert a signature is present and that the
package version matches the tag); `src/main/settings-store.ts` (an `updateCheck` setting,
default off); `src/renderer/pages/about.ts`; `src/main/index.ts` (the external URL allow-list);
and the three documents making the promise, edited in the same change, not later.

**Effort.** Medium.

**Risk.** The Windows signing identity is an unmade decision: Azure Trusted Signing requires a
verifiable organisation identity three years old, which an individual seller may not clear, and
an OV or EV certificate is the fallback. Settle that before writing any of this. Separately,
`docs/delivery-report.md` records that electron-builder fails reproducibly with EBUSY/EPERM
writing into the synced Desktop on this machine — a paid release must not be produced there.

**Tier.** Pro. This is what the money buys.

---

### 15. On-device transcription engine

**What the user sees.** Murmur transcribes locally with no server of any kind. Parakeet TDT
0.6B v3 (int8 ONNX, about 670 MB, 25 European languages, roughly 30x real time on a laptop CPU)
as the default local engine, with a small Whisper model as the long-tail-language fallback. The
model is fetched once from a checksummed mirror — an event that appears in the ledger — or
installed from an offline bundle for air-gapped machines.

**Why it wins.** It removes the last network leg entirely, makes the offline lock usable rather
than punitive, removes the API-key onboarding wall that caps the market at technical users, and
takes the marginal cost of a dictation to zero — which is what makes a one-off price honest. A
15-second take transcribes in roughly 0.5 s, so the private choice is also the fast one, which
is the only framing under which people pick it. It is a Windows and Linux play specifically:
VoiceInk, MacWhisper and the strongest local-first rivals are macOS-only because they build on
WhisperKit and FluidAudio, so Parakeet via ONNX gives Windows the quality Mac users already get
free.

**Files that change.** `package.json` (add the sherpa-onnx Node addon — one dependency covering
Parakeet, Whisper, Moonshine and a local VAD); new `src/main/local-engine.ts` exposing the same
contract `DictationDeps.transcribe` already has, so `src/main/index.ts` `transcribe()` becomes a
two-line router and the controller is untouched; new `src/main/model-store.ts` (download,
SHA-256 verification, userData placement, routed through the ledger);
`src/main/settings-store.ts`; `src/shared/capabilities.ts` (a `localEngine` id so an
unsupported CPU degrades with a sentence); `electron-builder.yml` (asarUnpack) and
`scripts/check-native-packaging.mjs` (assert it survived packaging per architecture, exactly as
it already does for koffi and uiohook-napi); `src/renderer/pages/about.ts` (Parakeet is
CC-BY-4.0 and requires a real attribution line).

**Effort.** Large. The largest item here and the only one that can go wrong at packaging time.

**Risk.** Installer and download size — measure the addon per platform before committing.
Native packaging across three operating systems is the defect class that has already shipped
once in this repository, which is why the packaging check script exists. Electron idle memory is
the incumbent's most-quoted weakness, so publish measured figures with the model loaded and
unloaded, and unload after some idle period. Licence detail matters: Parakeet is CC-BY-4.0 and
needs attribution; Moonshine's non-English weights are **not** commercially licensed, so a
multilingual local mode cannot use them. Windows only at first.

**Tier.** Pro. This is the anchor of the paid tier.

---

### 16. Per-app style buckets

**What the user sees.** Murmur notices which application it is about to paste into and sorts it
into one of four user-editable buckets — email, work chat, personal chat, other — each with its
own formatting and register and its own vocabulary subset. Nothing about the app is transmitted.

**Why it wins.** The identity is already computed and discarded: `GetWindowThreadProcessId` at
`src/main/foreground.ts:86` already yields the target process ID for the elevation check, and
the macOS tracker already reads `processIdentifier`. Four buckets from the process name and
window title deliver most of the perceived intelligence with no accessibility API and no
permission prompt on Windows — where the category leader's equivalent feature does not exist at
all, because its own documentation says context-aware formatting is macOS-only.

**Files that change.** `src/main/foreground.ts` (add `QueryFullProcessImageNameW` to the
existing koffi loads; capture the identity in `capture()`, not only `check()`, because the
identity is needed at take start); `src/main/platform/types.ts` (`TargetTracker` gains
`appIdentity()`, covering Windows, macOS, X11 and the null tracker in one edit);
`src/main/platform/macos-native.ts` (`bundleIdentifier`, one more selector on the object already
held); `src/main/platform/linux-native.ts` (WM_CLASS on X11);
`src/main/dictation-controller.ts` (`ForegroundState` gains `appId`);
`src/shared/capabilities.ts`; new pure `src/shared/app-profiles.ts` for the mapping, testable
with no native module.

**Effort.** Medium.

**Risk.** Windows browsers are one process for every site, so a browser resolves to "browser"
and nothing finer without reading the window title — accept that for v1 and say so. Wayland
cannot do this at all and the capability system must report it rather than silently
mis-bucketing. A wrong bucket is worse than no bucket, so default unknown apps to "other" and
change nothing.

**Tier.** Pro.

---

## 4. Monetisation

### Recommendation

**A one-time licence at $39 (two devices) and $69 (five devices), sold through a merchant of
record, with the app staying MIT and the licence enforced by an offline Ed25519 key.** Free and
unlicensed keeps full unlimited dictation plus 25 vocabulary terms and 10 replacement rules.
Pro unlocks unlimited lists, the polish pass, the learning loop, per-app buckets and the bundled
local engine. 30-day refund. 70% student discount, which costs nothing at zero marginal cost.
Later, an organisational licence at roughly $50 per seat per year.

**No subscription.** The customer already pays their provider directly. Charging monthly on top
of a user's own token spend is the loudest live grievance in the category — Superwhisper gates
bring-your-own-key behind $8.49/month and gets called out for it. "You pay your provider
directly; we never take a cut and never charge you monthly" is true, campaignable, and means the
existing copy in `src/renderer/pages/about.ts` ("built for people—not subscriptions") and
`README.md` ("no subscription, no shared backend") stays literally true rather than having to be
recanted. Reword only the line calling Murmur "an independent MIT-licensed project" to add that
paid builds fund it — do not delete the honesty.

### The MIT licence reality, stated plainly

`LICENSE` grants everyone the right to use, copy, modify, merge, publish, distribute,
sublicense and sell copies. v0.4.0 is already published, so that grant is **irrevocable for that
snapshot**. Anyone may build it, strip a licence check and give it away, and your own buyers may
legitimately compile it themselves for free. Put that on the pricing page rather than hiding it.

It does not prevent selling. VoiceInk is GPL-3 on GitHub, sells $25-49 lifetime licences, and
openly says "every line is out there for you to read, audit, or run yourself". MacWhisper, Krita
and Kdenlive earn on the same principle. What the buyer pays for is real and not in the
repository: a signed and notarised build, auto-updates, the bundled model, and someone to email.

**Do not relicense, and do not go open-core.** The Aseprite path — keep the source public,
forbid redistributing compiled binaries — is legally available to a sole author for future
versions and would restore pricing power. Reject it anyway, for a reason specific to this
product: Murmur hooks the global keyboard, records the microphone, and by feature 16 inspects
the foreground application. Inspectable source is the only thing that makes an app like that
installable by the privacy-motivated buyer this entire thesis targets. Open-core is worse still,
because the natural Pro module is exactly the personalisation and context layer, which is
precisely the code that most needs to be readable. Trade the pricing power for the trust.
MIT/commercial dual licensing gives no leverage either: dual licensing only creates pressure
against a copyleft side such as AGPL, and MIT already grants everything.

**What actually protects the business:** a trademark on the renamed product (that, not
copyright, is what stops someone selling your build under your name); being the only signed,
notarised, auto-updating distribution; the compounding personal data on the buyer's machine; and
support. Treat the licence check as a courtesy lock and spend no engineering on obfuscating it.

### Merchant of record — mandatory, not a convenience

A Switzerland-based seller of digital services into the EU has a **zero registration
threshold**: VAT is owed from the first €39 sale to a German consumer, with quarterly non-Union
OSS filings and per-country rates. Separately, Switzerland requires foreign digital providers to
register for Swiss VAT above CHF 100,000 worldwide turnover, at 8.1%.

- **Paddle** — 5% + $0.50, no monthly fee, all-inclusive: global tax registration, filing and
  remittance, subscription billing, card processing, fraud, chargebacks, localised checkout,
  24/7 buyer support. Products under $10 need custom pricing, so keep every SKU at $10 or above.
  On a $49 licence that is $2.95, netting $46.05 (94.0%).
- **Polar** — restructured May 2026: Starter is now $0/month at 5% + $0.50 (the 4% + $0.40 rate
  is grandfathered for organisations created before 27 May 2026). Same headline rate as Paddle,
  but with licence-key issuance and activation built in, which removes the need for a separate
  licensing vendor.
- **Rule out Lemon Squeezy** — Stripe-owned since July 2024, in friendly maintenance while the
  team builds Stripe Managed Payments, with worse international fees (5% + $0.50 base, plus 1.5%
  international, plus 0.5% subscription).
- **Rule out Stripe Managed Payments** — 3.5% on top of standard Stripe fees, roughly 6.4% +
  $0.30 domestic and often over 8% international, and largely US-only in 2026.
- **Do not start on raw Stripe.** It is cheaper per transaction (2.9% + $0.30) and leaves the
  legal duty to register, collect, file and remit entirely with you. Revisit only above roughly
  CHF 150k/year, where ~6% of revenue outweighs an accountant.

**Recommendation: Polar Starter**, for the built-in licence-key issuance; Paddle if you prefer
the more established tax operation. Both are the same headline rate for a new seller.

### Licence key mechanics

Self-signed Ed25519, verified offline, roughly 100 lines. Keygen's own cryptography
documentation recommends Ed25519 over 2048-bit RSA for smaller signatures and higher security,
with offline verification that is entirely client-side: decode the payload, verify against an
embedded public key, check the issue date, then parse.

- The merchant of record issues the key on purchase.
- A small local signing step produces the Ed25519-signed licence blob; the private key never
  leaves the owner's machine.
- `src/main/licence.ts` verifies it with `node:crypto` against a public key compiled into the
  main process. No activation call. No account. Works air-gapped.
- Storage reuses `src/main/secure-storage.ts` and the existing `SettingsStore` credential
  pattern; gating reuses `src/shared/capabilities.ts`.
- Cost: zero, ongoing. Hosted alternatives are priced for companies — Keygen's free Dev tier
  caps at 100 active licensed users and Standard reportedly starts around $99/month; Cryptolens
  Business from about €199/month; LicenseSpring from about $199/month (all secondary-source).
  Paying $99/month for licensing before you have $99/month of revenue is the classic mistake.

### Real competitor pricing

| Product | Price | Model | Platforms | Source |
|---|---|---|---|---|
| Wispr Flow | Free 2,000 words/wk; Pro $15/mo or $12 annual; Growth $23/$18 | Subscription, cloud only | Mac, Win, iOS, Android | `wisprflow.ai/pricing` (primary) |
| Aqua Voice | Free 1,000 words; Pro $8/mo annual ($10 monthly); Max $24/mo annual; Team $12/user | Subscription, cloud only | Mac, Win, iOS | `aquavoice.com/pricing`, `/info/faq` (primary) |
| Willow Voice | Free 2,000 words/wk; Pro $15/mo or $144/yr; Business $35/user | Subscription, no offline mode | Mac, Win, iOS, Android | secondary |
| Superwhisper | Free 3,000-word trial then free tier; Pro $8.49/mo, $6.79/mo yearly; lifetime reported $249.99 | Subscription + lifetime | Mac, Win, iOS | homepage primary; lifetime price **unconfirmed** |
| MacWhisper | ~€59 one-off direct; App Store IAP $6.99-$99.99 incl. Pro Lifetime $89.99/$99.99 | One-off | macOS | App Store listing primary; €59 secondary |
| VoiceInk | $25 / $39 / $49 by device count (reg. $49/$49/$69), GPL-3 source public | One-off, lifetime updates, 14-day refund | macOS, Apple Silicon | `tryvoiceink.com` (primary) |
| Dragon Professional | $699.99 | Perpetual, abandoned | Windows | secondary |
| Talon | Free; on-device engine behind a reported $25/mo supporter tier | Patreon | Mac, Win, Linux X11 only | secondary |
| Handy | Free | Open source, offline | Mac, Win, Linux | secondary |

Gross margin at $39-69 with bring-your-own-key is about 94%: inference cost per user is zero by
construction, and the only per-sale cost is the merchant of record.

### Before any money changes hands

1. Settle the employment-IP question with a person (section 6).
2. Add a CLA or DCO to `CONTRIBUTING.md`. It currently has neither.
3. Fix `LICENSE`, which says "Voice Hotkey contributors" while `package.json` and
   `electron-builder.yml` say "Murmur contributors".
4. Rename.
5. Sign the Windows installer.
6. Ship **Windows only** for the first paid release. macOS and Linux have never been run outside
   unit tests; `docs/platform-support.md`, `docs/delivery-report.md` and `README.md` all say so.
   Selling a Mac build that has never been launched buys refunds and a reputation that outlasts
   the revenue.
7. Then the licence code, then a one-page site with the price, the honest platform matrix, terms,
   privacy and refund policy, and a plain statement that the source is MIT and you may build it
   yourself. Terms of service, an EULA, a privacy policy and a refund policy are legally required
   to take consumer payments in the EU and Switzerland, and the 14-day right of withdrawal for
   digital goods needs an explicit waiver at checkout or every sale is refundable for two weeks.

---

## 5. What NOT to build, and why

**Streaming transcription over WebSocket.** Large, touches the recorder, controller, service and
types, and buys a perception improvement on a dimension Murmur cannot lead. Streaming's
structural advantage is overlapping transcription with speech, which only pays on long
utterances; for a 3-10 second push-to-talk take the fixed costs dominate and batch also gets
full-utterance context, which is better on exactly the names and alphanumerics this product is
about. AssemblyAI additionally bills WebSocket *session* duration rather than audio duration,
which is a trap for any warm-socket design. If streaming is ever revisited, use only the cheap
version — `stream=true` with SSE deltas on the HTTP endpoint Murmur already calls — feature-
detected and falling back silently, because Groq, whisper-1 and self-hosted servers may 400 on
an unknown parameter and would otherwise break dictation outright.

**A permanently warm microphone with a pre-roll ring buffer.** Feature 9 gets most of the
benefit. A warm stream leaves the OS microphone indicator lit all day, which is a privacy-posture
decision that contradicts the thesis.

**Queueing a second dictation while one is transcribing.** Real gap — the second press is
currently dropped silently with no sound, no overlay change and no tray change. But two
concurrent takes mean two paste targets, two foreground verdicts and two chances to paste into
the wrong window, and the cancellation semantics are an unmade decision. If it is built later,
cap the queue at two and refuse the third with an audible cue. For now, just make the drop
audible.

**Voice commands and hands-free VAD.** Dragon and Talon own this. It is a large surface with a
hard command/dictation separation problem and is orthogonal to the thesis.

**Long-form chunking above the five-minute cap.** Wrong user. Push-to-talk users dictate
sentences and paragraphs.

**Audio retention.** Storage cost, privacy cost, and the text-diff correction loop (feature 11)
buys the same learning more cheaply. If it is ever built it must be off after any upgrade, state
exactly where files sit and when they expire, prove the purge with a test, and be removed on
uninstall — and if the expiry cannot be made reliable, do not ship it at all.

**Windows caret context via UI Automation, and select-text-and-say-the-change editing.**
Genuinely the ceiling of the accuracy angle, and on Windows it needs no permission prompt. But:
Chromium and Electron targets — Slack, Teams, VS Code, Notion, Cursor, the apps people dictate
into most — expose nothing to UI Automation until a client wakes the tree, and waking it costs
the user measurable memory and CPU; on macOS the obvious way to force it
(`AXEnhancedUserInterface`) makes Chromium replay buffered keystrokes and duplicate the user's
typing (screenpipe issue #3884), so only `AXManualAccessibility` is safe; and Microsoft's UIA is
now a documented EDR-evasion technique (Akamai research), so enterprise security questionnaires
will ask. Reading the screen is also a promise change, not just a feature. Do not build it until
features 1-12 have proven the angle converts, and then only opt-in per application with a
visible exclusion list.

**A licence server, an account system, telemetry or crash reporting.** Each contradicts the
written privacy promise, and none is needed: offline Ed25519 verification does the whole job.

**Relicensing to BUSL, PolyForm or source-available.** Argued in section 4 — it destroys the one
asset that makes a keyboard-hooking, microphone-recording app installable.

**The Settings page refactor, an IPC channel-constants file, and de-duplicating the settings
validation.** All genuine defects. None is a feature. Fix the duplication opportunistically when
a specific bug bites, or fold it into feature 6, which is the first change to need a validated
collection.

**Internationalisation, statistics charts, streaks, weekly summaries.** Retention theatre for a
product with no retention problem yet.

**macOS and Linux polish.** Nothing on either platform has ever been run outside unit tests.
Every feature above is Windows-first.

---

## 6. Decisions only the product owner can make

Each with a recommendation.

**1. The employment IP question.** The first commit carries an `@itu.int` work identity. ITU
staff intellectual-property rules may bear on ownership of work committed from a work identity.
*Recommendation: settle this with a person in HR or legal before anything else on this list.
Nothing else matters until it is clear. This is not a code search.*

**2. The name.** "Murmur" is at least four other dictation products, one distributed on Setapp,
plus `murmurd` and MurmurHash. `electron-builder.yml` already claims a domain nobody owns.
*Recommendation: rename before any paid launch. It costs almost nothing at v0.4.0 and after the
first sale means refunds, re-signing under a new identity, broken installer upgrade paths and a
dead update feed. Check trademark and app-store collisions on the new name first.*

**3. Licence going forward.** Stay MIT and sell the build, or keep v0.4.0 MIT and make future
versions source-available.
*Recommendation: stay MIT. See section 4. The trust is the product.*

**4. CLA or DCO.** `CONTRIBUTING.md` has neither, and one human holds all copyright across seven
commits today.
*Recommendation: add a DCO now, before the first external pull request. It is the cheapest
irreversible decision on this list, and merging one outside contribution without it ends
unilateral licence control permanently.*

**5. Windows code-signing identity.** Azure Trusted Signing requires a verifiable organisation
identity three years old, which an individual seller may not clear; an OV or EV certificate is
the fallback and is slower and more expensive.
*Recommendation: check Azure Trusted Signing eligibility first, because it is the cheapest path;
budget for an OV certificate if you do not qualify. Settle it before feature 14, not during.*

**6. Price and tier line.** $39/$69 one-off with a 25-term free cap is the recommendation, but
the exact free/Pro boundary is a judgement about who you want using it.
*Recommendation: keep everything that is just better engineering free (features 1-10) and price
only what costs you real bytes or real per-platform work (the local engine) plus the two
features built on top of it. "The free app is fast and honest; the paid app works with no
network and no bill" is a sentence a buyer understands.*

**7. Renegotiating the no-update-calls promise.** `CONTRIBUTING.md`, `SECURITY.md` and
`README.md` all promise there will never be an update call, as part of the privacy contract.
*Recommendation: renegotiate it explicitly in those three documents in the same change that adds
the check, make it opt-in and refusable, and show it in the network ledger. A paid desktop app
you cannot patch is a liability. Do not ship it quietly.*

**8. First paid platform.** Windows only, or wait for macOS.
*Recommendation: Windows only. macOS is where the paying dictation market is, but Murmur has
never been launched there, and the local engine, licence and signing work only has to clear one
platform first.*

**9. Whether to run a free tier at all.** The category standard is a capped free tier (3,000
words total at Superwhisper, 1,000 at Aqua, 2,000/week at Wispr).
*Recommendation: never meter dictation — that is the Otter cautionary tale and it contradicts
the zero-marginal-cost position. Cap the clever parts (vocabulary size, replacement rules,
polish) instead.*

**10. Whether to pursue the organisational tier.** A per-seat commercial licence in the Obsidian
mould is worth far more per user than a consumer one-off, and Murmur's no-server, no-account
architecture is a compliance story its funded competitors structurally cannot tell.
*Recommendation: not yet. Build it only after a consumer licence has sold, and sell it as a
support and indemnity agreement rather than a copyright restriction, since under MIT you cannot
restrict use but you can sell an agreement — and procurement buys agreements.*

---

## 7. Feature 1 in implementation detail — custom vocabulary

A build brief precise enough to hand to an implementer.

### Why this is feature 1

- **One focused effort.** No new architecture. The vocabulary is stored as a single
  newline-delimited string — a flat scalar exactly like the twelve settings already in
  `StoredSettings` — so it needs no keyed-collection validation path and no migration. The
  transcription side is a widening of a function that already exists. Roughly seven small edits
  across five files, all in patterns the codebase already uses.
- **Independently testable on Windows by a non-technical person**, with a controlled
  before-and-after that needs no logs, no devtools and no timing measurement.
- **No server, no account, no unmade decision.** It needs nothing about pricing, the licence,
  the rename, the IP question, signing or a merchant of record. It works against the user's
  existing key and endpoint, adds no network call, stores nothing outside the existing settings
  file, and transmits nothing that was not already being transmitted.
- **Visibly improves the product on day one** for anyone who dictates a colleague's name.
- **Foundation for later paid features.** Features 6, 11 and 16 all read or write this field.

### Verify first, before writing any UI

Send a single request to the configured endpoint with a `keywords` field and confirm a 200
rather than a 400. OpenAI's speech-to-text guide documents `keywords` for `gpt-transcribe` and
`gpt-4o-transcribe`, but this post-dates reliable knowledge and must be checked. If it is
rejected, the feature still ships via the prompt-append path — only the honest note under the
text area changes, and that note must be written from a verified result.

### File-by-file changes

**`src/shared/types.ts`**

```ts
// In PublicSettings, after `language`:
  /** Newline-delimited recognition bias terms. Empty = none. */
  vocabulary: string

// In SettingsUpdate, after `language?`:
  vocabulary?: string

// New exported constants, beside the existing limits:
export const MAX_VOCABULARY_CHARS = 2000
export const MAX_VOCABULARY_TERMS = 100
export const MAX_VOCABULARY_TERM_CHARS = 48
```

Also add a pure exported helper, because both main and renderer need the same parse:

```ts
export function parseVocabulary(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= MAX_VOCABULARY_TERM_CHARS)
    .slice(0, MAX_VOCABULARY_TERMS)
}
```

**`src/main/settings-store.ts`** — five edits, the standard recipe:

1. `StoredSettings`: add `vocabulary: string` after `language`.
2. `DEFAULT_SETTINGS`: add `vocabulary: ''`.
3. `normaliseSettings` (the **load** path, around the `language` branch): add
   `vocabulary: typeof candidate.vocabulary === 'string' ? candidate.vocabulary.slice(0, MAX_VOCABULARY_CHARS) : ''`
4. `update()` (the **save** path, near the `language` line): add
   `if (typeof update.vocabulary === 'string') this.settings.vocabulary = update.vocabulary.slice(0, MAX_VOCABULARY_CHARS)`
   — note this follows the existing silent-clamp convention for strings (as `microphoneId`
   does) rather than throwing.
5. Leave `SETTINGS_VERSION` at 5. There is no migration to run: an absent field defaults to
   empty on load, which is exactly right. Bumping the number would be documentation only,
   because nothing reads it.

`getPublic()` needs no edit — it spreads everything except `encryptedApiKey` and `version`, so
the field crosses automatically. (That same behaviour is the leak hazard noted in section 1; it
is correct here and must be fixed before a secret is ever added.)

**`src/main/transcription-service.ts`**

1. `TranscribeInput`: add `terms: string[]`.
2. `buildPrompt(language: string, terms: string[]): string` — append the terms to the existing
   per-language prompt, highest-value **last**, because `whisper-1` uses only the last 224
   tokens and weights later tokens more heavily:

```ts
function buildPrompt(language: string, terms: string[]): string {
  const base = PROMPTS[language] ?? GENERIC_PROMPT
  if (terms.length === 0) return base
  return `${base} Terms that may appear: ${terms.join(', ')}.`
}
```

3. In the `body.append` block, beside the existing `gpt-transcribe` `languages[]` special case,
   add the dedicated field for the model families that support it:

```ts
const supportsKeywords = input.model.startsWith('gpt-transcribe')
  || input.model.startsWith('gpt-4o-transcribe')
if (supportsKeywords && input.terms.length > 0) {
  for (const term of input.terms) body.append('keywords[]', term)
}
body.append('prompt', buildPrompt(input.language, supportsKeywords ? [] : input.terms))
```

Rationale: when `keywords` is available the prompt stays clean and the terms go in the
purpose-built field; otherwise they ride the prompt, which works on whisper-1, Groq and any
local server. If the pre-flight check shows `keywords` is rejected, delete the
`supportsKeywords` branch and keep the prompt path only.

**`src/main/dictation-controller.ts`**

1. `WorkflowSettings`: add `vocabulary: string[]` after `language`.
2. `TranscriptionPayload`: add `vocabulary: string[]`.
3. At the transcribe call site, include it in the payload. No other logic changes.

**`src/main/index.ts`**

1. `workflowSettings()`: add `vocabulary: parseVocabulary(settings.vocabulary)`.
2. `transcribe()`: pass `terms: payload.vocabulary` into `transcriber.transcribe({...})`.

**`src/renderer/pages/settings.ts`** — four edits inside the one 729-line function. Missing any
one of them fails silently, which is why they are listed individually.

1. **Markup**: a new `<section class="settings-card">` in the template literal, placed after the
   "Transcription API" card and before "Recording". The sticky save bar already covers whatever
   is added below it.

```html
<section class="settings-card">
  <div class="settings-heading">
    <div><h2>Your words</h2><p>Names, acronyms and product terms Murmur should expect to hear.</p></div>
  </div>
  <label class="field field-wide"><span>Vocabulary</span>
    <textarea id="vocabulary" rows="6" spellcheck="false"
      placeholder="Kirinde&#10;ITU-T&#10;Dataverse&#10;koffi"></textarea>
    <small id="vocabulary-note">One term per line. Sent with every dictation so the
      recogniser expects them. Up to 100 terms.</small>
  </label>
</section>
```

2. **Query handle**, beside the others: `const vocabulary = query<HTMLTextAreaElement>('#vocabulary')`.
3. **`syncControlValues`**: `if (vocabulary) vocabulary.value = next.vocabulary`.
4. **Save object**: `vocabulary: vocabulary?.value ?? ''` in the `SettingsUpdate` literal.

Additionally, set `#vocabulary-note` from the current model so the honest limitation is stated:
when the model is `gpt-transcribe`/`gpt-4o-transcribe`, say the terms are sent as a dedicated
keyword list; otherwise say they are added to the transcription prompt and that only the last
few dozen terms are likely to influence it. Update the note inside `syncControlValues` and on
the model `change` listener, using the same pattern as the existing capability notes.

### IPC additions

**None.** The vocabulary rides the existing `settings:get` / `settings:save` channels and the
existing preload wrappers. No new channel, no new preload method, no new renderer type — which
is precisely why this is a safe first feature in a codebase where channel names are retyped
between main and preload with nothing comparing them.

### Settings migration

None required. `normaliseSettings` is an idempotent field-by-field normaliser that has never
read `candidate.version`; an absent `vocabulary` becomes `''`. A v5 file written by an older
build loads cleanly, and a file written by this build loads cleanly in an older build (the field
is dropped). `SETTINGS_VERSION` stays at 5.

### Tests to write

**`tests/settings-store.test.ts`** — a new `describe` block copied in shape from the existing
`v4 → v5 migration` block:
- defaults to `''` when absent from the file;
- accepts and persists a multi-line string;
- clamps input longer than `MAX_VOCABULARY_CHARS`;
- survives a save/reload round trip;
- an existing settings file with no `vocabulary` key still loads every other field unchanged.

**`tests/transcription-service.test.ts`** — extend the existing per-model request-shape suite:
- `gpt-transcribe` with three terms sends three `keywords[]` entries and a prompt with no term
  list appended;
- `whisper-1` with three terms sends no `keywords[]` and a prompt ending with the terms;
- a custom model against a custom endpoint takes the prompt path;
- zero terms produces exactly today's request body (regression guard).

**New `tests/vocabulary.test.ts`** for `parseVocabulary`:
- blank lines and surrounding whitespace are dropped;
- CRLF and LF both split;
- terms longer than `MAX_VOCABULARY_TERM_CHARS` are dropped, not truncated;
- the list is capped at `MAX_VOCABULARY_TERMS`;
- order is preserved.

Run `npm run typecheck && npm test` before handing over. Do not treat a green build as a passing
feature — the manual test below is the gate.

### Manual test steps for the owner (Windows)

Run these **one at a time**. Report the result of each before the next is given.

**Step 1 — the baseline.** With Murmur running and the "Your words" box empty, open Notepad,
press and hold your dictation shortcut, and say exactly:

> "Please send the ITU-T draft to Kirinde before Friday."

Release. Read the text that lands in Notepad and report it back word for word.

*Expect: at least one of "ITU-T" and "Kirinde" to be wrong. If both are already correct, we pick
different test words before going further, because the test proves nothing otherwise.*

**Step 2 — teach it.** Open Settings, find the new "Your words" card, type these three lines
into the box, and click Save settings:

```
ITU-T
Kirinde
Dataverse
```

Report what the feedback line under the Save button says.

*Expect: "Settings saved."*

**Step 3 — the same sentence again.** Back in Notepad, dictate the identical sentence from
step 1. Report the text word for word.

*Expect: "ITU-T" and "Kirinde" both spelled correctly.*

**Step 4 — it persists.** Quit Murmur from the tray, start it again, open Settings, and confirm
the three lines are still in the box. Report yes or no.

**Step 5 — it does not over-reach.** Dictate a sentence with none of those words in it:

> "The coffee machine on the third floor is broken again."

Report the text.

*Expect: no trace of ITU-T, Kirinde or Dataverse. If any appears, the terms are being
hallucinated into unrelated audio and we reduce the list or change how they are sent.*

**Step 6 — the honest note.** In Settings, change the Model dropdown between `gpt-transcribe`
and `whisper-1` and report whether the small grey text under the vocabulary box changes to
describe a different mechanism.

*Expect: two different sentences, one mentioning a keyword list and one mentioning the
transcription prompt.*

Stop at the first failure and report it; do not continue down the list.
