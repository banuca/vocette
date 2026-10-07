# What real users complain about in dictation apps — research for Murmur

Compiled 25 September 2026. Web research only. Audience: the Murmur planning agent.

Products covered: Wispr Flow, Superwhisper, Aqua Voice, Willow Voice, VoiceInk, MacWhisper, Handy, Windows voice typing (Win+H) and Voice Access, Dragon. Where a frustration shows up in close relatives (Whispering, OpenWhispr, Hex, OpenSuperWhisper), it is included and labelled.

---

## 0. Method, evidence quality and limits (read first)

### Source types and how they are counted

| Label | Meaning | Weight |
|---|---|---|
| **U** | Primary user report: Hacker News comment, GitHub issue, app-store / Microsoft Store / Product Hunt review, Microsoft Q&A post, vendor feedback-board post, independent blog | Counted |
| **V** | Vendor acknowledgement: the product's own help article, changelog, status page, or a founder reply | Counted separately (shows the problem is common enough to document) |
| **J** | Independent journalism or explainer | Context only |
| **C** | Competitor-written "review" or "alternatives" page | **Not counted.** Used only to find leads, which were then checked against primary sources where possible |

"Source count" = number of distinct U sources + V sources. A GitHub issue with 80 confirming comments counts as **one** source (the comment count is noted). Several reviewers on one store listing count as one source unless quoted separately.

### Rank

Rank is a judgement of **frequency** (source count) × **severity** (does it lose or corrupt the user's words?) × **relevance to a Windows push-to-talk app**. It is not a pure count. Price has the highest raw count but ranks 7th because it does not break the core loop.

### Limits you should know about

1. **Reddit could not be read.** Reddit blocks this tool's crawler (search and fetch both refused). I did not use mirrors or archives to get round the site owner's block. Every "Reddit says" claim below is therefore **second-hand** and marked as such. This is the biggest gap: AI over-editing and "worse after the trial" complaints are said to be common on r/WisprFlow but I could not verify that.
2. **G2 returned 403.** No G2 data.
3. **Wispr Flow's Trustpilot profile has been removed.** Trustpilot now shows "This profile has been removed… goes against our guidelines" (checked on .com and .es). The widely repeated "2.7/5 on Trustpilot" cannot be verified any more.
4. **Apple's review feed only reaches back about six weeks** for busy apps (10 pages × 50). Wispr iOS reviews sampled cover roughly 4 Aug – 21 Sep 2026, plus the 50 "most helpful".
5. **Most store reviews are for iOS keyboards.** A large share of iOS complaints (keyboard switching, iPad) do not transfer to a Windows desktop app and were left out unless the underlying failure (lost dictation, stuck processing, price) transfers.
6. **Open-source bias.** Handy, VoiceInk, Whispering and OpenWhispr have public issue trackers, so they look buggier by volume. Wispr, Superwhisper, Aqua and Willow do not. Counts reflect visibility, not relative quality.
7. **Hacker News skews towards developers who build their own tools.** Many commenters are launching competitors (flagged where known: Lucid Voice, OpenWhispr, Wisprkey, DuckType, Talkie, FreeFlow, DictaFlow). Their complaints were excluded from counts or flagged.
8. **Dates.** Almost all evidence is 2025–2026. Exceptions are flagged (a few 2024 Microsoft Q&A threads; Dragon's Capterra reviews are mostly 2017–2022).
9. Quotes from GitHub are verbatim (fetched with the GitHub CLI). Quotes from web pages were extracted by an automated reader; key ones were re-fetched for exact wording. Anything I could not confirm word for word is marked *(paraphrase)*.

### Competitor-written pages (treat as low-quality evidence)

These dominate search results for "Wispr Flow review / alternatives". Most are written by rivals selling a replacement: getvoibe.com (Voibe), spokenly.app, willowvoice.com/blog (Willow), metawhisp.com, yaps.ai, embertype.com, modelpiper.com, dictaflow.io and the "Jacob/Ryan Shrott" Medium posts (DictaFlow's founder), softorbits.net, bossai.tech, usevoicy.com, speakmac.app, weesperneonflow.ai, blabby.ai / blabb.io, whisper.remskill.com, lumevoice.com, getspeakup.app, letterly.app, vocai.net, taskdumpr.com, snailtext.app, voicedash.ai, tryvoiceink.com/best-dictation-apps-windows (VoiceInk's own), wisprflow.ai/best-dictation-apps (Wispr's own). Affiliate-disclosed reviewers: filipkonecny.com, zackproser.com. The "trust gap / 60% of the time" narrative, the "800 MB RAM / 8% CPU idle" figure and the "banned the user" story all reach search results mainly through these pages (see §5, unverified claims register).

---

## 1. Ranked top 20 frustrations

### Summary table

| # | Frustration (users' terms) | Theme | Sources (U + V) | Main products |
|---|---|---|---|---|
| 1 | "It transcribed, but nothing pasted — or it pasted my old clipboard" | Paste / clipboard / wrong window | 16 (13 + 3) | Handy, Wispr (Win), Superwhisper (Win, iOS), VoiceInk, Aqua, Whispering, OpenWhispr |
| 2 | "Incredible when it works" — stuck on *transcribing / processing*, then fails | Reliability | 17 (14 + 3) | Wispr, Superwhisper, VoiceInk, Handy, Willow, Whispering |
| 3 | "I talked for 15 minutes and it was simply gone" — long dictations lost | Lost recordings | 13 (11 + 2) | Handy, VoiceInk, Wispr, Superwhisper, Willow, MacWhisper |
| 4 | Gets names, jargon and accents wrong; vocabulary doesn't stick; invents text in silence | Accuracy | 16 (13 + 3) | All; Windows Voice Access/Win+H worst; Whisper-based apps hallucinate |
| 5 | Too slow — slow to start, slow to return text, lags the PC | Latency | 17 (14 + 3) | Wispr, Willow, Superwhisper, VoiceInk, Handy, Whispering |
| 6 | First words cut off — "I learned to wait a second before talking" | First word cut off | 11 (8 + 3) | Handy, VoiceInk, Wispr, Superwhisper, Aqua |
| 7 | "Another monthly subscription"; word caps; paywalled local models | Price | 20 (19 + 1) | Wispr, Willow, Superwhisper, Aqua, MacWhisper, Dragon |
| 8 | Audio and on-screen context shipped to the cloud; keystroke/URL logging | Privacy / cloud | 13 (11 + 2) | Wispr, Aqua, Willow, cloud modes generally |
| 9 | Won't install, won't open, crashes, breaks after an update | Reliability | 13 (12 + 1) | Wispr (Windows), Handy (Windows), Superwhisper, VoiceInk |
| 10 | Can't bind the key I want; shortcut stops working; Win key opens Start | Hotkeys | 14 (13 + 1) | Handy, Whispering, VoiceInk, OpenWhispr, Wispr |
| 11 | Wrong language, or silently translated into English | Multilingual | 14 (11 + 3) | Superwhisper, OpenWhispr, Willow, Wispr, VoiceInk |
| 12 | AI "clean-up" changes my meaning, answers me, ignores my style | AI over-editing | 8 (5 + 3), likely under-counted | Wispr, Superwhisper, Whispering, VoiceInk, Willow |
| 13 | Setup friction: logins, captchas, API keys, model downloads, dependencies, antivirus scares | Onboarding | 15 (12 + 3) | Wispr, Handy, Whispering, Superwhisper, Aqua |
| 14 | Heavy on RAM/CPU/battery | Resources | 14 (12 + 2) | Wispr (Win), Handy, VoiceInk, Superwhisper, Dragon |
| 15 | "It wipes whatever I had copied" | Clipboard | 9 (6 + 3) | VoiceInk, Superwhisper, Wispr, OpenSuperWhisper |
| 16 | Useless in terminals and coding CLIs; paste collapsed or dropped; commands mangled | Code / terminals | 9 (8 + 1) | Wispr, MacWhisper, Superwhisper, OpenWhispr, Handy |
| 17 | Music not restored, media player started, room noise and TV transcribed | Background audio | 12 (9 + 3) | Handy, VoiceInk, Wispr, Superwhisper, Aqua |
| 18 | Bluetooth headphones drop to "phone-call quality"; AirPods hijacked | Bluetooth | 10 (7 + 3) | VoiceInk, Handy, Aqua, Wispr, Superwhisper, OpenWhispr |
| 19 | Needs the internet; no offline mode | Offline | 10 (7 + 3) | Wispr, Aqua, Win+H, Willow, Superwhisper (iOS) |
| 20 | Text lands in whichever window has focus when it finishes, not where I started | Wrong window | 7 (5 + 2) | VoiceInk, OpenWhispr, Wispr, Aqua |

**By theme:** reliability / crashes / hotkeys → 2, 9, 10 · paste / wrong window / clipboard → 1, 15, 20 · lost recordings → 3 · accuracy → 4 · latency → 5 · first word → 6 · price → 7 · privacy → 8 · multilingual → 11 · AI over-editing → 12 · onboarding → 13 · resources → 14 · code/terminals → 16 · background audio → 17 · Bluetooth → 18 · offline → 19.

---

### 1. Dictated text doesn't arrive — nothing pastes, the old clipboard pastes, or it pastes twice
**Theme:** paste / wrong window / clipboard · **Sources:** 16 (13 U + 3 V) · **Products:** Handy, Wispr Flow (Windows), Superwhisper (Windows, iOS), VoiceInk, Aqua, Whispering, OpenWhispr.

In users' terms: *"It transcribed fine — I can see it in history — but nothing appeared in my app, or it pasted whatever was already on my clipboard."*

- **Handy #502** (the most-discussed Handy issue, 89 comments, opened 30 Dec 2025) — https://github.com/cjpais/Handy/issues/502 — "some non-zero chunk of the time, Handy seems to paste the clipboard into the window rather than whatever I've just said." A Windows user (4 Jan 2026): "it puts whatever is on my clipboard in." Another (22 Feb 2026): the rate "is at least 75 %". The maintainer raised the paste delay step by step to 190 ms without curing it: "Hm maybe a simple delay here is not enough."
- **Superwhisper for Windows** feedback board, Mick Pavey, 12 Nov 2025 — https://feedback.superwhisper.com/board/p/windows-version — "Superwhisper transcribes my voice into text fine (it appears in the mini window) but it doesn't paste into the application that I'm in. I've tried word, slack and notepad... but nothing appears."
- **Wispr Flow, Microsoft Store**, Naydee, 2★, 14 Sep 2025 — https://apps.microsoft.com/detail/9n1b9jwb3m35 — "way too many bugs regarding it Not actually typing where you selected at all. So if you're interested in constantly having to open an interface to copy the last paragraph… go right ahead."

Other sources: Handy #612 (pasting stopped after an update), #439 (direct paste uses wrong keyboard layout), #93 (Dvorak); VoiceInk #159; Superwhisper iOS review "OscarGenesin" (10 Apr 2026, "never was able to paste"); Aqua Product Hunt review, Jake Crump (long text block not pasted correctly, *paraphrase*); Whispering #856; HN PickledJesus https://news.ycombinator.com/item?id=44950090 ("the auto-paste feature is frustrating"); anthropics/claude-code #38620 (Wispr's simulated Ctrl+V broken on Windows); OpenWhispr #224. Vendor: Wispr "Fix text not pasting after dictation" https://docs.wisprflow.ai/articles/7971211038-fix-text-not-pasting-after-dictation ; Wispr known issue on non-QWERTY layouts and the Windows "Update admin settings to paste!" notice https://docs.wisprflow.ai/articles/1621472516-flow-fails-to-detect-text-fields-or-inserts-incorrectly-on-non-qwerty-keyboard-layouts ; Superwhisper "Text not pasting, pasting twice, or pasting old text" https://superwhisper.com/docs/common-issues/pasting-issues .

Causes seen in the evidence: a race between writing the clipboard and the simulated Ctrl+V under CPU load; keyboard-layout mismatch; elevated (Run as administrator) target windows on Windows; apps that ignore synthetic paste (VMs, some terminals); clipboard-restore firing before the target app has read the clipboard.

### 2. "Great when it works" — hangs on *transcribing / processing*, spins, then fails
**Theme:** reliability · **Sources:** 17 (14 U + 3 V) · **Products:** Wispr Flow, Superwhisper, VoiceInk, Handy, Willow, Whispering, MacWhisper.

- Wispr iOS, FalseHen, 1★, 21 Sep 2026 — https://apps.apple.com/us/app/wispr-flow-ai-voice-keyboard/id6497229487?see-all=reviews — "It's incredible when it works, but that's less than 50% of the time."
- Wispr iOS, Tilden-Katz, 4★, 16 Mar 2026 (same URL) — "it'll just pause and it'll just spin processing, and then it'll just fail, and then you have to start all over again."
- VoiceInk #321, 1 Oct 2025 — https://github.com/Beingpax/VoiceInk/issues/321 — "Keeps hanging at 'Transcribing' infinitely." A paying user: "i just paid for the app, and it immediately stops working the next day."

Other sources: Wispr iOS Stoidykins (14 Dec 2025, "processing spiral"); Wispr Microsoft Store, Daniel, 4★, 24 Apr 2026 ("very useful, the software is so unstable"); Wispr Product Hunt, Shaunny (~Feb 2026, Windows); Handy #1213 (Windows 11 stuck on "transcribing" after sleep), #1228; VoiceInk #338; Superwhisper iOS Miro_MK (10 Apr 2026); Willow iOS "E R Burgess" (27 Apr 2026, Mac app "constantly has middleware failure issues"); HN threekindwords https://news.ycombinator.com/item?id=47042753 ("handy too buggy"); HN blueboo https://news.ycombinator.com/item?id=44950642 (Whispering "glitches and ux failures"); HN blopker https://news.ycombinator.com/item?id=48533220 ("Most of these apps are incredibly buggy and crash all the time"). Vendor: Wispr status incident, 21 Jan 2026, Mac and Windows, about 2.5 hours — https://statuspage.incident.io/wispr-flow/incidents/01KFH1SEDXQSREP1CHMPXVHR47 ; Wispr "Fix slow or failed transcription" https://docs.wisprflow.ai/articles/4984532368-fix-taking-longer-than-usual-and-transcription-errors ; Superwhisper troubleshooting lists "'No voice found' or stuck processing" https://superwhisper.com/docs/common-issues/troubleshooting .

Second-hand only (not counted): the "worked in the trial, then ~60% of the time after paying" Reddit post, reported by competitor pages.

### 3. Long dictations silently lost
**Theme:** lost recordings · **Sources:** 13 (11 U + 2 V) · **Products:** Handy, VoiceInk, Wispr Flow, Superwhisper, Willow, MacWhisper.

- Handy #783, Windows 11, 11 Feb 2026 — https://github.com/cjpais/Handy/issues/783 — a 15-minute recording: "the entire recording was simply lost - gone! I can't find it in the history". Maintainer: "Highly recommend shorter recordings for now".
- Handy #1332, 25 Apr 2026 — https://github.com/cjpais/Handy/issues/1332 — "Large recordings are silently lost - recording is not saved, text is not outputted."
- Wispr iOS, "0501 1322 19", 3★, 29 Aug 2026 — https://apps.apple.com/us/app/wispr-flow-ai-voice-keyboard/id6497229487?see-all=reviews — "there's an error with the transcription and nothing can be found… at this point it is costing me intellectual property".

Other sources: VoiceInk #67 ("the sudden loss of the recording"), #727 (middle of long recordings missing); Wispr iOS gancaycomia (2 Oct 2025, "keeps on losing my transcription every time I do something long-form, especially when I'm using my AirPods"); Wispr iOS Pixeldr (26 Apr 2026, "after say, 7-8 minutes of recording, it would stop listening… Wispr never started recording again"); Superwhisper iOS TheGreenGoose (19 Aug 2026, "Usage stops abruptly, the dictated text is lost"); Willow iOS "E R Burgess" ("it makes me lose valuable information that I can't get back"); HN blopker (crash "taking the recorded audio with them. Macwhisper is incredibly bad at this"); Wispr Microsoft Store Naydee ("go on and on speaking entire paragraphs to then find out it wasn't listening all along"). Vendor: Wispr "Very long dictation stopped automatically" and **Retry** of saved audio (same slow/failed article); Wispr known issue "iOS: Missing audio chunks during unstable internet" https://docs.wisprflow.ai/collections/5686269587-known_issues .

Note: Wispr's desktop app now keeps failed audio for retry. Users treat that as the minimum.

### 4. Names, jargon and accents come out wrong; custom vocabulary doesn't stick; text appears from silence
**Theme:** accuracy · **Sources:** 16 (13 U + 3 V) · **Products:** all. Windows Voice Access and Win+H get the harshest reports; Whisper-based apps hallucinate in silence.

- HN frankdilo, 15 Jan 2026 — https://news.ycombinator.com/item?id=46629201 — "What's missing for me to switch from something like Wispr Flow is the ability to provide a dictionary for commonly mistaken words (name of your company, people, code libraries)."
- Microsoft Q&A, 26 Feb 2026 — https://learn.microsoft.com/en-us/answers/questions/5790297/problems-with-voice-access-for-windows-11-consiste — Voice Access "is excruciatingly slow to correctly reproduce abstruse words, even when I 'add them to vocabulary'"; it "now always types '!the' whenever I dictate 'the'". Follow-up, 4 Mar 2026, on Win+H: "borderline hopeless… it gets all the specialised vocabulary wrong."
- OpenWhispr #462, 18 Mar 2026 — https://github.com/OpenWhispr/openwhispr/issues/462 — silence produces "Thank you for watching!", "Please subscribe", "Subtitles by…".

Other sources: HN QuantumGood https://news.ycombinator.com/item?id=48825187 ("I say 'Knight' to Wispr or Google and see 'night'"); HN nr378 https://news.ycombinator.com/item?id=49747122 (switched through four apps and "found WisprFlow the least accurate of the 4"); HN blueboo (Wispr "poor transcriptions (oh THATS why they're fast)"); HN luigi23 https://news.ycombinator.com/item?id=46630637 (macOS built-in dictation is "trash if: you're not a native speaker or have accent… use novel words like 'claude code'"); Microsoft Q&A 3917901 (Jan 2025, "diction" → "addiction") https://learn.microsoft.com/en-us/answers/questions/3917901/why-is-voice-access-on-windows-11-so-incredibly-po ; Microsoft Q&A 5897711 (May 2026, accuracy worse after an update) https://learn.microsoft.com/en-ca/answers/questions/5897711/voice-typing-accuracy-got-worse ; Wispr iOS Jaclyncastro (Aug 2026, inconsistent on some words, *paraphrase*); Dragon on Capterra (foreign names, numbers; mostly older reviews) https://www.capterra.com/p/251641/Dragon-Professional-Individual/reviews/ ; VoiceInk #151 (hallucination); Superwhisper iOS Phil Ciccone (12 Sep 2026, "makes things up"). Vendor: Wispr "Transcription suddenly got worse" (names and technical terms repeated wrongly → use the dictionary) https://docs.wisprflow.ai/articles/6901148133-transcription-suddenly-got-worse-or-feels-less-accurate ; Wispr blog, 14 Jan 2026: a Bluetooth headset in a pocket gives "basically no audio, and sometimes Wispr Flow can produce preposterous hallucinations" https://wisprflow.ai/post/transcription-quality ; Superwhisper troubleshooting: "Gibberish, repeated, or made-up text".

### 5. Too slow — slow to start listening, slow to return text, or it drags the whole PC
**Theme:** latency · **Sources:** 17 (14 U + 3 V) · **Products:** Wispr Flow, Willow, Superwhisper, VoiceInk, Handy, Whispering.

- HN qingcharles, 17 Sep 2026 — https://news.ycombinator.com/item?id=49747579 — "Wispr lagged my PC to hell; plus, the cost. The quality was excellent, though."
- VoiceInk #277, 4 Sep 2025 — https://github.com/Beingpax/VoiceInk/issues/277 — start delay "at least 500ms… compared to other apps like Wispr Flow or Willow Voice, etc. where I'd say that they feel very instantaneous, if not within 100ms".
- Wispr status, 21 Jan 2026 — https://statuspage.incident.io/wispr-flow/incidents/01KFH1SEDXQSREP1CHMPXVHR47 — "transcriptions are taking longer than usual to process" (desktop Mac and Windows).

Other sources: Willow Product Hunt, Paul Sussman ("The only area I'd like to see improved is response time") https://www.producthunt.com/products/willow-voice/reviews ; HN arach https://news.ycombinator.com/item?id=47044153 (Handy "latency to be just a bit too much"); HN mrroryflint https://news.ycombinator.com/item?id=46629690 ("always a 1-2sec delay before it would actually start transcribing even if the icon was displayed"); Handy #1132 and #1646 (regressions); VoiceInk #321 ("30+ seconds… where it was 1-3 seconds before the update"); Superwhisper iOS TakeTheFire (6 May 2026, "incredibly slow"); HN d4rkp4ttern https://news.ycombinator.com/item?id=44432703 (Willow "almost instantaneous" vs Superwhisper, *paraphrase*); HN tefkah https://news.ycombinator.com/item?id=49815368 (OpenSuperWhisper "long startup time"); Whispering #706 (Windows, RTX 4090, "very slow"); HN BizarroLand https://news.ycombinator.com/item?id=47052621 (about 25 s to transcribe a long ramble on a 10th-gen i7 laptop). Vendor: Wispr status history (incident 27 Jun 2026) https://statuspage.incident.io/wispr-flow/history ; Wispr "Taking longer than usual" article.

What users call good: recording that starts "within 100ms" (VoiceInk #277) and text about one second after release (HN pstroqaty https://news.ycombinator.com/item?id=44949314 : "It takes about 1 second for an average sentence to appear after release").

### 6. First words cut off
**Theme:** first word cut off · **Sources:** 11 (8 U + 3 V) · **Products:** Handy (Mac and Windows), VoiceInk, Wispr Flow, Superwhisper, Aqua.

- Handy #1283, 12 Apr 2026, 32 comments — https://github.com/cjpais/Handy/issues/1283 — "~500ms delay between pressing the shortcut and audio actually being captured… the first word or syllable is lost." Maintainer, 2 Jul 2026: "This is probably the highest priority issue for me at the moment."
- Handy #1879, Windows 11, 9 Aug 2026 — https://github.com/cjpais/Handy/issues/1879 — "first few words lost, or first few syllables. Sometimes one syllable, sometimes 1 word, sometimes 3-5 words (!)" and "Why does the app visually show it's recording audio when it's not".
- HN kuatroka, 15 Jan 2026 — https://news.ycombinator.com/item?id=46630138 — "I kind of learned to wait for one or two seconds before talking. I am using it with the AirPods".

Other sources: HN BizarroLand ("it cut off the words I'm using at the beginning"); HN mrroryflint (AirPods Max); VoiceInk #277 (worse with "pause media" on); VoiceInk #385 (first 2–3 words; AirPods Max and a USB webcam mic; workaround "Leaving the Sound > Input pane open in System Setting"); Aqua HN, bklyn11201 plus founder reply "might be due to AirPods mic init latency" https://news.ycombinator.com/item?id=43637348 . Vendor: Wispr known issue "Missing first words in transcriptions" — "Pause briefly before speaking. Wait a moment after pressing the hotkey, especially on wireless mics." https://docs.wisprflow.ai/articles/3566082841-fix-missing-first-words-in-transcriptions ; Wispr blog (Bluetooth mics "can clip the beginning or end of speech"); Superwhisper changelog 2.16.1, Jun 2026, "Fixed words occasionally being dropped at the start" https://superwhisper.com/changelog .

The fix users converge on: keep the microphone warm or keep a short pre-roll buffer, and show "ready" only once audio is actually arriving. After Handy added a grey "not ready" state, the #1879 reporter wrote: "as soon as it switches to pink it captures every syllable."

### 7. Subscription fatigue, price and word caps
**Theme:** price · **Sources:** 20 (19 U + 1 V) — the highest raw count · **Products:** Wispr Flow (US$15/month or $12/month annually; free tier 2,000 words/week on desktop), Willow ($15/$12), Aqua ($10/$8; only 1,000 free words in total), Superwhisper ($8.49/month or $249.99 lifetime — secondary figures), MacWhisper (upsell), Dragon (~$699, secondary figure). Pricing pages: https://wisprflow.ai/pricing , https://willowvoice.com/pricing , https://aquavoice.com/pricing ; VoiceInk sells one-time licences from $25 https://tryvoiceink.com/buy .

- HN toddmorey, 10 Apr 2025 — https://news.ycombinator.com/item?id=43639535 — "And man it's another monthly subscription."
- Wispr iOS, Eric081978, 2★, 12 Sep 2026 — "the free version gives you 1000 words per week whereas to upgrade cost $15 a month. That is just way too much… if they wanted to charge me $5 I would do it."
- Superwhisper iOS, Thanark, 1★, 22 Mar 2026 — https://apps.apple.com/us/app/superwhisper/id6471464415?see-all=reviews — "When the free trial expires, it purposefully will lock you out of ANY decent model".

Other sources: HN hagbard_c https://news.ycombinator.com/item?id=45924583 ; HN varenc https://news.ycombinator.com/item?id=45923961 ; HN kuatroka https://news.ycombinator.com/item?id=46630025 ("It felt a bit ridiculous having to pay when it's all powered by such small models"); HN prepend https://news.ycombinator.com/item?id=48198223 ("Wisprflow is not $12/month better than ios"); HN qingcharles ("plus, the cost"); HN sparkling https://news.ycombinator.com/item?id=49334327 ("Just canceled my WisprFlow subscription… to switch to a open source, free, local alternative"); HN d4rkp4ttern https://news.ycombinator.com/item?id=44952476 ("hope to ditch my Wispr Flow sub soon"); Wispr iOS WSPJason ("At $15 per month, it's beyond my budget as a student"), SkyeNainai ("out of words for the week" for two weeks), Beetlejuice_potato_farm ("Say NO to subscription keyboards"), Jbigs69 ("Charge people $3 for the app - one-time purchase, unlimited use"); Superwhisper iOS "Yes???????" ("To charge $250 for lifetime buy is straight up delusion"); Willow iOS Narrator99 (25 Jul 2026, "Company claims unlimited dictation but there's actually a weekly word limit") https://apps.apple.com/us/app/willow-dictation-ai-keyboard/id6753057525?see-all=reviews ; Willow Product Hunt, SaaS Master ("The free tier is 2,000 words a week"); MacWhisper App Store, Tommy1664 (Aug 2025, aggressive Pro upselling, *paraphrase*) https://apps.apple.com/us/app/macwhisper/id1668083311?see-all=reviews ; Dragon on Capterra (cost; a paid support fee after six months, *paraphrase*). Vendor: Wispr known issue "Weekly Word Limit Not Resetting" https://docs.wisprflow.ai/articles/3715544288-weekly-word-limit-not-resetting-troubleshooting-guide . Excluded: comments by makers of cheaper rivals (Lucid Voice, OpenWhispr, Wisprkey).

### 8. Privacy — audio and on-screen context sent to the cloud
**Theme:** privacy / cloud / screenshots · **Sources:** 13 (11 U + 2 V) · **Products:** Wispr Flow, Aqua, Willow, cloud modes of Superwhisper/VoiceInk, Windows voice typing (Azure).

- Wensen Wu, forensic write-up of Wispr Flow 1.4.752 on macOS, 4 Apr 2026 — https://www.wensenwu.com/thoughts/wispr-flow-investigation (HN discussion https://news.ycombinator.com/item?id=47781148) — "Every keystroke is intercepted — Wispr Flow installs a system-wide CGEventTap that captures every key press before any application receives it"; app/URL logging; uploads while "Usage data sharing is off". No competing product disclosed.
- HN fxtentacle on Aqua, 9 Apr 2025 — https://news.ycombinator.com/item?id=43637679 — "This looks like it'll slurp up all your data and upload it into a cloud. Thanks, no. I want privacy, offline mode and source code for something as crucial to system security as an input method."
- HN throw14082020 (builds a rival app), 14 Jun 2026 — https://news.ycombinator.com/item?id=48531184 — "many of these dictations app opt you into Context awareness, which means your entire page contents get streamed to their server."

Other sources: HN canada_dry https://news.ycombinator.com/item?id=43639318 ("Accuracy is important, but privacy is more so."); HN replete https://news.ycombinator.com/item?id=43642885 ; HN d4rkp4ttern https://news.ycombinator.com/item?id=46497820 ("did not like non-local aspect", *paraphrase*); HN rusackas https://news.ycombinator.com/item?id=48577831 ; HN czarofvan https://news.ycombinator.com/item?id=47781591 ; HN wi5eif6E https://news.ycombinator.com/item?id=46630418 ("A settings option to keep no recording history at all would be terrific."); Wispr Product Hunt, Shaunny ("If you value your privacy and your PC's stability, look elsewhere.") https://www.producthunt.com/products/wisprflow/reviews ; Willow iOS Narrator99 ("Wonder what they're doing with my data"). Vendor: Wispr's security overview — Context Awareness "can use relevant text from the active app", separate "Dictation Cloud Storage" setting https://docs.wisprflow.ai/articles/3467817258-security-and-compliance-faq ; Aqua founder: inference "runs in a datacenter (for now)" https://news.ycombinator.com/item?id=43638122 .

Second-hand only (not counted): periodic screenshots of the active window; the company banning the user who reported it and the CTO apologising. Both come mainly from competitor pages (ModelPiper, EmberType, Voibe) citing Reddit.

### 9. Won't install, won't open, crashes, or breaks after an update — worst on Windows
**Theme:** reliability · **Sources:** 13 (12 U + 1 V) · **Products:** Wispr Flow (Windows), Handy (Windows 10/11, GPU), Superwhisper (Mac/iOS), VoiceInk, Aqua.

- **Wispr Flow's older Microsoft Store listing** (publisher Wispr AI, Inc., released 26 Feb 2025, x64 only) — https://apps.microsoft.com/detail/9n1b9jwb3m35 — 3.1★ from 33 ratings. The 20 written reviews average 1.85★ and **13 of them describe the app not launching or showing a blank white window** (Nov 2025 – Mar 2026). Patrick, 27 Mar 2026: "Literally doesn't open. That's the first step of any application and it fails!" Noa, 9 Dec 2025: "all that popped up was a blank white screen." Balance: a newer listing (XP88W11PJ2V0T8, updated Jun 2026) shows 5.0★ from 13 ratings with 2 written reviews, so this may have been fixed. Reviews were read from the Store's ratings service: https://storeedgefd.dsx.mp.microsoft.com/v9.0/ratings/product/9N1B9JWB3M35?market=US&locale=en-US
- Handy #436, "Handy crashing Windows 11", 24 comments — https://github.com/cjpais/Handy/issues/436 ; #537, crashes on CPUs without AVX2, 44 comments; #1755, GPU acceleration "triggers UNEXPECTED_STORE_EXCEPTION BSOD on Windows 11 / RTX 5090".
- Superwhisper iOS, Phil Ciccone, 2★, 12 Sep 2026 — "The Mac version crashes constantly."

Other sources: Wispr Microsoft Store, Nurlan (30 Apr 2026, "Doesn't work on ARM processors (Snapdragon)"); Handy #785, #1489, #99 (Windows crashes); VoiceInk #413 (crash on finishing), #827 (lost custom modes on upgrade to 2.0); Superwhisper iOS "tony tech reviews" ("The newest update keeps crashing the app when you run the local whisper model"); Aqua Product Hunt, Rohan Chaubey (occasional crashes, *paraphrase*); anthropics/claude-code #38620 and #93782 (host-app updates silently broke dictation paste). Vendor: Superwhisper troubleshooting, "App won't launch or install" covering "Windows DLL and Vulkan errors, installer problems".

### 10. Hotkeys — can't bind the key you want, conflicts, layout problems, stops after an OS update
**Theme:** reliability / hotkeys · **Sources:** 14 (13 U + 1 V) · **Products:** Handy, Whispering, VoiceInk, OpenWhispr, Wispr Flow, OpenSuperWhisper.

- Whispering #500, 12 May 2025 — https://github.com/EpicenterHQ/epicenter/issues/500 — "Global shortcuts are not working (99,5% of the time) on Windows (2 different PCs)."
- Handy #917, 28 Feb 2026 — https://github.com/cjpais/Handy/issues/917 — with Win+Space, "the start menu of windows shows up whenever I let go of the keyboard shortcut."
- Handy #906, 26 Feb 2026 — https://github.com/cjpais/Handy/issues/906 — the backtick shortcut "fails on UK keyboard layout unless OS is set to US".

Other sources: Handy #96 (65 comments, can't change from Ctrl+Space), #92 (every binding reports a conflict), #1174 (can't set Ctrl+Win on Windows 11), #966 (can't assign RCtrl/RWin/RAlt/Menu), #1143 (first press after launch fails, Windows); VoiceInk #735 (global shortcut broken on macOS 26, 20 comments); OpenWhispr #220; Wensen Wu (Wispr "145 spacebar presses suppressed in under 10 minutes" by a stuck modifier); HN mncharity https://news.ycombinator.com/item?id=46633799 ("A cautionary user experience report. The default hotkey upon download is ctrl+space…"); HN tefkah ("something is overriding the default Opt+` shortcut"). Vendor: Wispr's shortcut rules — Fn can't be used on Windows, no single keys, three keys at most, Caps Lock and left/right click unassignable https://docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts .

### 11. Wrong language, or silently translated into English
**Theme:** multilingual · **Sources:** 14 (11 U + 3 V) · **Products:** Superwhisper, OpenWhispr, Willow, Wispr Flow, VoiceInk, Handy.

- Superwhisper iOS, guy_debord, 1★, 8 Apr 2026 — "Auto language is useless, it always translates back into English no matter what models or custom models you make." AG1981x, 20 Mar 2026: "the app still translates everything into English."
- OpenWhispr #188, 4 Feb 2026 — https://github.com/OpenWhispr/openwhispr/issues/188 — "When I speak Spanish, it is automatically translated English"; French and German users confirm the same.
- Wispr help — "If you dictate in one language but Flow types another — or mixes scripts mid-sentence" https://docs.wisprflow.ai/articles/5899191431-flow-is-transcribing-in-the-wrong-language ; and "Flow detects one language per dictation, not per word." https://docs.wisprflow.ai/articles/3191899797-use-flow-with-multiple-languages

Other sources: Superwhisper feedback board, "Auto language detection", 116 votes https://superwhisper.userjot.com/ ; VoiceInk #179 (quick language switch, 12 comments), #2 (more than one default language); Willow Product Hunt, Martijn van Noordennen (fast mode sometimes translates non-English speech into English, *paraphrase*); Willow iOS Itisss24 ("It doesn't understand bangla language."); Wispr iOS OzZY85 (19 Sep 2026, Arabic comes out "in English formatting (left to right)"); HN strokirk https://news.ycombinator.com/item?id=47044774 ("I've had a lot of issues trying to transcribe Swedish with all the products I've used so far."); Handy #1853 (French accents missing). Vendor: Wispr ×2 (above), Superwhisper troubleshooting "Transcribed in English instead of my language".

### 12. AI "clean-up" changes what you meant, answers you instead of transcribing, or ignores your style
**Theme:** AI over-editing · **Sources:** 8 (5 U + 3 V), plus 2 second-hand. Probably under-counted: Reddit is said to be full of these and could not be read. · **Products:** Wispr Flow (Smart Formatting, Backtrack), Superwhisper (AI modes), Whispering (transformations), VoiceInk (context mode), Willow (second-hand).

- **Wispr's own help centre** (Android) — https://docs.wisprflow.ai/articles/6568835559-why-wispr-flow-sometimes-removes-or-changes-words-on-android-smart-formatting — Smart Formatting "judges filler versus intended content rather than following fixed rules, so it can drop or rewrite words that mattered", and on Android it cannot be switched off.
- **Superwhisper's troubleshooting index** lists "AI answers instead of transcribing" as a common issue — https://superwhisper.com/docs/common-issues/troubleshooting
- HN PickledJesus, 19 Aug 2025 — https://news.ycombinator.com/item?id=44950090 — "despite an extreme amount of prompt engineering, I can't seem to stop the transformation model occasionally responding to my message rather than just transforming it".

Other sources: HN threekindwords ("superwhisper too clever"); Wispr iOS fjalkdj (17 Sep 2026, "I changed the writing style and it literally doesn't respect it at all"); VoiceInk #281 (the app's own built-in "Wispr flow" vocabulary hint leaked into dictated output) https://github.com/Beingpax/VoiceInk/issues/281 ; Superwhisper App Store, 3★, Jul 2025 (automatic punctuation can't be turned off, *paraphrase*). Vendor: Wispr "Smart Formatting & Backtrack" — Backtrack "removes filler words, false starts, and self-corrections"; desktop has "Undo AI edit" https://docs.wisprflow.ai/articles/5373093536-how-do-i-use-smart-formatting-and-backtrack . Second-hand (competitor page): an App Store review of 28 May 2026, "Instead of transcribing what I say, it's trying to rewrite what I say", and Willow reportedly treating "delete" as an edit command.

The tension: other users want **more** clean-up. HN sputknick on Handy, 23 Sep 2026 — https://news.ycombinator.com/item?id=49810584 — "you can't have it clean up your grammar mistakes, it just records your words exactly as is." What satisfies both is a clearly labelled choice with the raw words always recoverable.

### 13. Setup friction — accounts, captchas, API keys, model downloads, missing dependencies, antivirus scares
**Theme:** onboarding · **Sources:** 15 (12 U + 3 V) · **Products:** Wispr Flow, Handy, Whispering, Superwhisper, Aqua.

- Wispr Microsoft Store, Erik, 1★, 30 Jan 2026 — "Application will not authenticate or properly start. Tried on multiple computers."
- Whispering #674, 27 comments, 18 Aug 2025 — https://github.com/EpicenterHQ/epicenter/issues/674 — FFmpeg installed via winget and by hand, "Whispering still couldn't detect FFmpeg"; also HN hn1986 https://news.ycombinator.com/item?id=44947704 .
- Handy #1579, model download from Hugging Face fails, 47 comments — https://github.com/cjpais/Handy/issues/1579 ; #1922 "no model can be downloaded at the first start"; HN oybng https://news.ycombinator.com/item?id=46632312 — "On Windows this depends on webview2… No mention of this requirement in the readme."

Other sources: Wispr iOS gghhhuuy (20 Sep 2026, a valid Apple subscription not recognised, "impossible to sign up"); Handy #1891 (Windows Defender flagged the installer as a Trojan); Whispering #440 (flagged as a Trojan on Windows 11), #573 ("Will not install, driving me crazy."); HN iAMkenough https://news.ycombinator.com/item?id=43648279 (Aqua's pricing page "requires a Google account to view"); Superwhisper iOS Annoyed4w (useless "Without OpenAI or Gemini"). Vendor: Wispr login help (captchas, "Keep Flow open while completing browser sign-in", rate limits) https://docs.wisprflow.ai/articles/1753832329-login-issues-with-wispr-flow ; Wispr known issues (captcha blocking login, redirect loops); Wispr Windows installer: "SmartScreen can still show 'Windows protected your PC' for a newly published release" https://docs.wisprflow.ai/articles/9633655004-installing-wispr-flow-on-windows-what-to-expect-from-the-downloadable-installer .

### 14. Heavy on RAM, CPU or battery
**Theme:** resources · **Sources:** 14 (12 U + 2 V) · **Products:** Wispr Flow (Windows), Handy, VoiceInk, Superwhisper, Dragon, local-model apps generally.

- Wispr Product Hunt, Shaunny, ~Feb 2026, Windows — https://www.producthunt.com/products/wisprflow/reviews — installed "five times" across four versions; ~800 MB RAM and crashes (*paraphrase*); "If you value your privacy and your PC's stability, look elsewhere."
- VoiceInk #634, 11 Apr 2026 — https://github.com/Beingpax/VoiceInk/issues/634 — "Without any trigger, VoiceInk just starts using 100% of one core."
- HN thread on Handy, Sep 2025 — https://news.ycombinator.com/item?id=45399106 — around 120 MB on an M3 Max "doing nothing" (*paraphrase*).

Other sources: HN qingcharles ("lagged my PC to hell"); Handy #1213 (process grew from 9 MB to 691 MB while stuck), #1279 (memory grows), #1005 (process stays open in the background); Superwhisper iOS Skeeterharris (battery; "phone heating up"); Wispr iOS Janejrank (overheating; microphone stays on); Dragon on Capterra (Jan 2025, high RAM, *paraphrase*); HN shade https://news.ycombinator.com/item?id=45928585 (real-time Whisper and battery, *paraphrase*); HN zachlatta https://news.ycombinator.com/item?id=47040867 (a local LLM step makes "the total pipeline take too long"). Vendor: Superwhisper changelog ("Fix CPU usage when not in use issue"; "Fixed CPU usage spike that occurred after extended use"); Superwhisper performance tips (keeping models loaded costs memory) https://superwhisper.com/docs/common-issues/performance-tips .

### 15. "It wipes whatever I had copied"
**Theme:** clipboard · **Sources:** 9 (6 U + 3 V) · **Products:** VoiceInk, Superwhisper (until Sep 2026), Wispr Flow (after failed insertion), OpenSuperWhisper.

- VoiceInk #485, 10 Jan 2026 — https://github.com/Beingpax/VoiceInk/issues/485 — "it copies that transcription to the clipboard so I lose whatever I had previously copied." The restore option's minimum delay was one second.
- VoiceInk #185, 22 Jul 2025 — https://github.com/Beingpax/VoiceInk/issues/185 — "retain it and after pasting bring it back to the clipboard just like SuperWhisper does."
- HN d4rkp4ttern, 19 Aug 2025 — https://news.ycombinator.com/item?id=44952476 — among the things that "make a huge difference": "how the clipboard is handled during recording (does it copy to clipboard? does it clear it after text output?)".

Other sources: openai/codex #11103 (a clipboard race inserted Codex's reply instead of the Superwhisper dictation) https://github.com/openai/codex/issues/11103 ; manaflow-ai/cmux #12660 (clipboard restoration led to nothing being inserted); a Superwhisper feedback post asking to stop dictations going into clipboard history. Vendor: Superwhisper changelog 2.18.3, 3 Sep 2026, "Your clipboard contents are now preserved after dictation"; Superwhisper's pasting doc (if the target reads slowly, "Restore clipboard" makes it paste the old content); Wispr: "a failed insertion may leave transcript text there".

Trade-off to design for: restore too soon → frustration 1 (old clipboard pasted); restore too late or never → frustration 15.

### 16. Terminals and coding tools — paste collapsed, dropped or blocked; commands mangled by formatting
**Theme:** code editors / terminals · **Sources:** 9 (8 U + 1 V); very high reaction counts · **Products:** Wispr Flow, MacWhisper, Superwhisper, OpenWhispr, Handy — in Claude Code, Codex CLI, VS Code, Windows Terminal, WSL.

- anthropics/claude-code #3412, 12 Jul 2025, **309 reactions** — https://github.com/anthropics/claude-code/issues/3412 — dictated text "appears as a collapsed block (e.g., `[Pasted text +34 lines]`) with no way to preview or edit the content before submission." Windows confirmation, 5 Nov 2025. Companion issue #23134 (159 reactions): "When dictating into Claude Code, it automatically collapses into [Pasted Text]."
- anthropics/claude-code #93782, 12 Sep 2026 — https://github.com/anthropics/claude-code/issues/93782 — Wispr Flow text inserted by clipboard + simulated Ctrl+V into the VS Code terminal (Remote-WSL) "is silently dropped" after an update. #38620 is the same on Windows 11 in March 2026.
- Wispr help — in WSL, Linux VMs and SSH, "Flow transcribes, but you must use Paste last transcript"; context-aware formatting can transform shell commands (*paraphrase*) — https://docs.wisprflow.ai/articles/6478598909-using-flow-with-linux-wsl-and-terminal-applications

Other sources: microsoft/vscode #282290 (Wispr Flow keeps flipping VS Code into "Screen Reader Optimized" mode) https://github.com/microsoft/vscode/issues/282290 ; OpenWhispr #184 ("In codex cli the transcription is treated as an image"); OpenWhispr #179 comment ("in CLI (Windows at least), programmes like `codex`, `claude code` etc. usually doesn't allow direct paste"); Handy #1018 ("Append trailing space does not work in Windows Terminal").

### 17. Background audio and noise — music not restored, media players started, room noise transcribed
**Theme:** background audio / music · **Sources:** 12 (9 U + 3 V) · **Products:** Handy, VoiceInk, Wispr Flow, Superwhisper, Aqua.

- VoiceInk #640, 13 Apr 2026 — https://github.com/Beingpax/VoiceInk/issues/640 — "Mute Audio While Recording"… "fails to restore audio in ~50% of cases… The system volume remains at 0".
- VoiceInk #208, 3 Aug 2025 — https://github.com/Beingpax/VoiceInk/issues/208 — "no music player was runnig, so now Apple Music always starts."
- Wispr iOS, gancaycomia, 2 Oct 2025 — "This app is great in normal, calm, quiet environments, but it honestly… works terribly in any other situation."

Other sources: Handy #192 (request to pause/resume media automatically), #998 (mute fails with a USB audio interface; asks for "Pause While Recording"), #336 (the app's own start sound muted too); VoiceInk #331 (pause media only when playing through speakers); HN blopker ("Microphone bleed… the system mic will pick up the speaker sounds, causing duplicate (approximately) transcriptions"); HN sidhusmart in https://news.ycombinator.com/item?id=45399106 (Handy "Struggles a bit in noisy settings", *paraphrase*); Aqua HN bklyn11201 https://news.ycombinator.com/item?id=43637065 ("Music playing on Youtube in Chrome, Airpods in, the desktop and the sandbox/demo just don't work."). Vendor: Wispr auto-mute (on by default on Windows; audio started just before dictation may be missed; stops trying to restore volume "after three failed attempts") https://docs.wisprflow.ai/articles/7231650589-auto-mute-music-while-dictating-on-macos-how-audio-detection-works ; Wispr blog ("Background noise or nearby conversations can cause the model to pick up unintended speech"); Superwhisper 1.44.1 (media now pauses during recording).

### 18. Bluetooth headsets — music drops to "phone-call quality", AirPods hijacked, volume jumps
**Theme:** Bluetooth · **Sources:** 10 (7 U + 3 V), plus 2 explainers · **Products:** VoiceInk, Handy, Aqua, Wispr Flow, Superwhisper, OpenWhispr; on Windows it is a platform-wide Bluetooth behaviour.

- VoiceInk #459, 31 Dec 2025 — https://github.com/Beingpax/VoiceInk/issues/459 — "after I stop recording… there is a degradation of audio because the headphones are still in that lower quality mode."
- VoiceInk #957 (iOS), 19 Sep 2026 — https://github.com/Beingpax/VoiceInk/issues/957 — "degrades audio from other apps… to phone-call quality: mono, muffled, and low fidelity."
- Handy #646, 22 Jan 2026 — https://github.com/cjpais/Handy/issues/646 — the feedback sound "causes AirPods to switch routing to the Mac, interrupting the user's music"; later comments: output volume jumps "to 100%".

Other sources: Aqua HN bklyn11201 (above); VoiceInk #660 (input doesn't follow Bluetooth device changes); Handy #491 (Windows 11 crash with a Bluetooth mic); OpenWhispr #1138 (Bluetooth headset mic not working on Windows; fix via disabling Exclusive Mode). Vendor: Wispr AirPods help ("dictation cuts out mid-sentence"; use the built-in mic) https://docs.wisprflow.ai/articles/8533503284-knwon-audio-playback-airpod-issues-ios-macos ; Wispr auto-mute (on Mac, Bluetooth headsets can delay audio restoration by up to 5.5 s); Superwhisper 1.44.1 ("Fix mute when using bluetooth headphones"). Explainers: MakeUseOf https://www.makeuseof.com/windows-bluetooth-classic-audio-limitations/ ; How-To Geek (older article) https://www.howtogeek.com/354321/why-bluetooth-headsets-are-terrible-on-windows-pcs/ .

Mechanism on Windows: Classic Bluetooth cannot carry high-quality stereo (A2DP) and the headset microphone at once. Opening the headset mic switches the device to the Hands-Free profile, so everything playing becomes mono, call-quality audio until the mic closes. LE Audio on newer Windows 11 hardware avoids this; most headsets still don't. A dictation app can't fix it, but it can avoid opening the headset mic and can explain what's happening.

### 19. Needs the internet — no offline mode
**Theme:** offline · **Sources:** 10 (7 U + 3 V) · **Products:** Wispr Flow, Aqua, Windows voice typing, Willow (second-hand), Superwhisper iOS (local models paywalled).

- Wispr help — Flow "cannot function offline"; on Mac and Windows failed dictations are saved to retry later — https://docs.wisprflow.ai/articles/3834764683-why-vpns-or-security-tools-can-block-wispr-flow
- HN replete, 10 Apr 2025 — https://news.ycombinator.com/item?id=43642885 — "I would pay for a completely offline version of this, cloud voice data is non-starter for me".
- Microsoft support — voice typing "uses online speech recognition, which is powered by Azure Speech services"; "you'll need to be connected to the internet" — https://support.microsoft.com/en-us/windows/use-voice-typing-to-talk-instead-of-type-on-your-pc-fec94565-c4bd-329d-e59a-af033fa5689f

Other sources: HN Danox https://news.ycombinator.com/item?id=48204030 ("It requires a constant internet connection to function and cannot be used offline"); HN fxtentacle ("I want privacy, offline mode"); Ask HN, 22 Sep 2026, "Anyone using a Wispr Flow alternative that is non-cloud?" https://news.ycombinator.com/item?id=49809670 ; Aqua Product Hunt, Kamil Debbagh and Alexander Williams (want offline; "requires network access", *paraphrase*); Superwhisper iOS Thanark. Vendor: Aqua FAQ, "Cloud dictation needs an internet connection" https://aquavoice.com/info/faq . Contrast: Windows Voice Access works "without an internet connection" https://support.microsoft.com/en-us/topic/get-started-with-voice-access-bd2aa2dc-46c2-486c-93ae-3d75f7d053a4 but its dictation gets the complaints in item 4.

### 20. Text lands in whatever window is focused when it finishes, not where you started
**Theme:** wrong window · **Sources:** 7 (5 U + 2 V) · **Products:** VoiceInk, OpenWhispr, Wispr Flow, Aqua, generic.

- HN ajolly, 21 Aug 2025 — https://news.ycombinator.com/item?id=44974122 — "The killer feature I'm still looking for is software that will… insert the text into the text box that was active when I started talking, not ended talking."
- OpenWhispr #179, 1 Feb 2026 — https://github.com/OpenWhispr/openwhispr/issues/179 — "I often jump between screens for context… the input element is not always in focus when [it] finishes" — wants a copy-only mode.
- VoiceInk #95, 21 May 2025 — https://github.com/Beingpax/VoiceInk/issues/95 — "the DeepL window opens instead, and the text goes into DeepL".

Other sources: HN alxlu https://news.ycombinator.com/item?id=43639892 (a hotkey that sends output to a chosen app, *paraphrase*); Wispr Microsoft Store Naydee. Vendor: Wispr pasting help (text can land in the wrong place if focus moves, *paraphrase*); Superwhisper pasting doc ("losing cursor focus during processing").

### Also seen, below the top 20

- **Nagging notifications and marketing** — Willow's "You haven't used Willow in a while!" (Product Hunt; Willow says it's since fixed); Wispr iOS Jbigs69 ("I don't need recurring marketing emails"); Wispr iOS VirtualPanther ("continuous advertising pep talk").
- **Support that doesn't answer** — Wispr iOS (EarlyFreak), Superwhisper iOS (Greviewed "support never replies"), Willow iOS (JETherenthere "no method of contacting them"; E R Burgess refund refused), Dragon (paid support after six months).
- **Auto-start at login without asking** — Wispr turns on launch-at-login "without confirmation" (installer doc); Handy #122, "it continuously sets itself to auto start again".
- **Stops when you pause to think** — Windows voice typing by design (see §3); a mid-recording pause dropped everything after it in Handy (#783 comment).

---

## 2. What users love and would pay for — what "works like Wispr Flow" must include

Ordered by how often it comes up as the reason someone chose, kept or switched to an app.

| # | Must-have | Evidence |
|---|---|---|
| 1 | **Text appears where the cursor is, in any app** | Wispr iOS Tilden-Katz: "the fact that it works everywhere, including my desktop, is fantastic." Product Hunt Yangyang Dai prefers Wispr because it "keeps working across apps" https://www.producthunt.com/products/wisprflow/reviews |
| 2 | **Feels instant** — recording starts on key-down; text ~1 s after release | VoiceInk #277 ("very instantaneous, if not within 100ms"); HN pstroqaty (~1 s per sentence); Aqua PH Kamil Debbagh: "insanely fast and accurate. especially for coding." https://www.producthunt.com/products/aqua/reviews |
| 3 | **Punctuation, capitals, paragraphs and lists without dictating them** | Wispr iOS "Reviews When Warranted": "It capitalizes and adds punctuation properly. It automatically adds bullet points, lists, and paragraphs." Tilden-Katz: "the ability to make lists is fantastic." |
| 4 | **Light clean-up: drops ums, handles self-corrections — with a verbatim option** | HN cm2012 https://news.ycombinator.com/item?id=48143529 ("Wispr flow cuts out ums. I love it"); Willow PH SaaS Master (fixes spoken corrections, *paraphrase*); HN sputknick wants grammar clean-up; Wispr offers a "None" clean-up level and "Undo AI edit" |
| 5 | **Gets my names and jargon right** — a custom dictionary plus find-and-replace | HN frankdilo (a dictionary is what's "missing for me to switch"); Superwhisper users praise "custom vocabulary and replace rules" (HN felizuno); Tilden-Katz: "you're going to have to build a dictionary over time, which is fine." |
| 6 | **Private or local, ideally works offline** | Superwhisper App Store 5★: "Offline functionality is a standout feature"; HN replete: "I would pay for a completely offline version"; Superwhisper iOS 4–5★: "ability to do it on device so I have privacy" |
| 7 | **A fair price** — one-time licence, cheap tier, or a generous free tier | HN d4rkp4ttern names "VoiceInk (one time payment)" as a favourite; Wispr iOS Jbigs69 and Eric081978 would pay $3–5; HN fragmede calls Wispr's free tier "generous" |
| 8 | **Hold-to-talk and a hands-free toggle, plus a cancel key** | HN d4rkp4ttern ("allow flexible recording toggle shortcuts"); HN PickledJesus has "record and cancel actions bound to side buttons on my mouse"; OpenWhispr #290 (cancel with Esc); Wispr defaults to Esc for cancel |
| 9 | **Can always see whether it's listening** | HN d4rkp4ttern ("show a visual icon with waves etc showing recording"); PickledJesus ("I do miss having a taskbar icon to see if I'm recording or not"); Handy #1879 (wants the overlay coloured until the audio stream is really arriving) |
| 10 | **Nothing is ever lost** — history with audio, retry, paste-last | HN baxtr ("I want both, the transcript and the audio"); Handy HN BizarroLand keeps 99,999 recordings; Superwhisper board "Re-process with different settings" (106 votes); Wispr ships Retry and "Paste last transcript" hotkeys |
| 11 | **Leaves my clipboard alone** | VoiceInk #185 ("just like SuperWhisper does"); d4rkp4ttern's clipboard criterion |
| 12 | **Pause and resume a long dictation** | Superwhisper board "Pause Recording" (194 votes); Superwhisper App Store "Missing: pause button" (*paraphrase*) |
| 13 | **See words appear while speaking** (or at least early feedback) | HN BizarroLand ("slowly roll out the text as you talk"); Wispr Microsoft Store Naydee on Windows' built-in tool: "it works in real time so if it's not recognizing your text area or theres a mic glitch you at least you'll be able to tell"; OpenWhispr #296 |
| 14 | **Context-aware formatting** (tone per app, names spelled from screen) — wanted, but it drives the privacy complaints | Aqua PH Leslie Barry ("it has good context, which is great"); set against item 8 of §1 |
| 15 | **Works when whispering or in quiet offices** | Wispr iOS Chidoapp: "I can literally whisper and it still transcribes perfectly!" |
| 16 | **Accessibility** — a lifeline for RSI, mobility and dyslexia users | Wispr iOS Randallf.lhtx ("Fantastic dictation for people with disabilities"); HN simonjgreen; claude-code #23134 (people who rely on dictation "including disability") |
| 17 | Sync vocabulary and settings across machines (nice to have) | Superwhisper board "Synchronize across devices" (363 votes, the top request) |

Murmur's recent commits (per the repo's git log) already cover custom vocabulary, toggle mode and cancellation. I have not checked how any of them behave.

---

## 3. What Windows users complain about, compared with Mac users

### Windows-specific

1. **The app won't start at all.** Wispr's older Store listing: 13 of 20 written reviews say it won't open or shows a blank white window (Nov 2025 – Mar 2026), e.g. Jermaine, 17 Dec 2025: "failed to open on my Windows OS laptop… uninstalling/reinstalling to no avail." Wispr on iOS sits at 4.8★ from ~16K ratings, so the Windows gap is stark. A newer listing looks healthier (5.0★, 13 ratings).
2. **Windows on ARM (Snapdragon / Copilot+ PCs) not supported.** Wispr: "Windows on ARM and Snapdragon are unsupported" https://docs.wisprflow.ai/articles/1036674442-supported-devices-and-system-requirements ; Microsoft Store Nurlan (Apr 2026); Handy #1682 (Windows on ARM GPU transcription failure).
3. **Elevated (Run as administrator) apps.** Windows blocks input from a normal-privilege app into an elevated one. Wispr tells users to run Flow as administrator too (non-QWERTY/admin article); Handy #434 freezes and must be killed from Task Manager when the target app is elevated.
4. **Hotkeys fight Windows.** Fn can't be used (Wispr); Win-key shortcuts pop the Start menu on release (Handy #917); Ctrl+Win and right-hand modifiers won't register (Handy #1174, #966); UK layout breaks backtick (Handy #906); global shortcuts fail "99,5% of the time" (Whispering #500); the first press after launch fails (Handy #1143).
5. **Sleep and resume break it.** Handy #1213 (stuck on "transcribing" after sleep even after restarting the app), #1341.
6. **GPU acceleration is a minefield on PCs.** Vulkan errors and blue screens (Handy #1755 RTX 5090, #2047 Intel Arc, #99 Vulkan.dll), AMD GPUs outputting "!!!!" (Handy #428), "4090, and slow… I think gpu is not activated" (Whispering #706), Superwhisper's "Windows DLL and Vulkan errors" page. Local models that feel instant on Apple Silicon can be slow on ordinary laptops (HN BizarroLand: ~25 s on a 10th-gen i7; HN genewitch https://news.ycombinator.com/item?id=44952735 : "all of the whisper 'clones' run poorly, if at all, on windows").
7. **Antivirus and SmartScreen scares.** Defender flagged Handy's installer (#1891) and Whispering (#440, #273) as Trojans; Wispr warns SmartScreen may show "Windows protected your PC".
8. **Missing runtime dependencies.** WebView2 (Handy, HN oybng), FFmpeg (Whispering #674, HN hn1986), Python (OpenWhispr #29 "spawn python ENOENT").
9. **Terminals, WSL and VS Code.** Simulated paste dropped in Windows Terminal, the VS Code terminal and WSL (claude-code #38620, #93782; OpenWhispr #179 comment); trailing space ignored in Windows Terminal (Handy #1018); Wispr needs "Paste last transcript" in WSL.
10. **Locked-down corporate PCs.** VPNs, proxies and security tools block cloud dictation ("Connection lost", Wispr connection help); remote and managed apps restrict the clipboard (Wispr pasting help). A DictaFlow founder claims clipboard-paste apps "simply don't work" over RDP/Citrix (vendor claim, HN https://news.ycombinator.com/item?id=46720497).
11. **Bluetooth headsets drop to call quality** as soon as the headset mic opens (Hands-Free profile); Windows users notice it more than Mac users. Wispr turns auto-mute on by default on Windows.
12. **Overlay and display quirks.** Overlay missing on secondary monitors (Handy #811) and wrong under display scaling (#263).
13. **Auto-start you can't turn off** (Handy #122); Wispr enables launch-at-login without asking.
14. **Windows gets features later and fewer choices.** VoiceInk and MacWhisper are Mac-only; Superwhisper's Windows 1.0 only arrived in late 2025 and early users found "Pompt capability is missing on the windows version… for the same price" (feedback board, 11 Nov 2025).
15. **The built-in tools are the baseline, and it's low.**
    - Win+H stops when you pause or type, by design. Question, 21 Oct 2024: "Dictation stops listening after a short vocal pause of 5-10 seconds or so". Another user, 21 Nov 2024: "makes the application virtually useless". Microsoft's answer: there is no setting to prevent it https://learn.microsoft.com/en-us/answers/questions/3954956/windows-10-dictation-stops-after-vocal-pause-or-wh . A 2025 thread says you have to keep pressing Win+H after an update https://learn.microsoft.com/en-us/answers/questions/3886046/windows-voice-typing-doesnt-stay-on .
    - It needs the internet (Azure Speech).
    - Punctuation commands are unreliable: "comma" failed more than 75% of the time for one user (Jun 2024, *paraphrase*) https://learn.microsoft.com/en-us/answers/questions/4009593/windows-11-dictation-feature-(win-h)-fails-to-cons ; "question mark" typed literally; brackets never closed (Feb 2026).
    - Voice Access (offline) is worse at dictation; one user reports about 80% of commands misrecognised (Feb 2026, *paraphrase*) https://learn.microsoft.com/en-us/answers/questions/5767884/can-anything-be-done-to-improve-voice-access-speec .
    - Formatting: "My first thought was giving Windows built in dictation tool, but the formatting was awful" (HN https://news.ycombinator.com/item?id=45924025).
    - One thing Windows users do credit the built-in tool with is **real-time feedback**, so you know it's listening (Naydee).
16. **Dragon** is still the reference for some Windows veterans but is expensive (commonly cited at ~US$699 — secondary figure), RAM-hungry, needs training, and is winding down for individuals. Nuance ended sale of Dragon Home 15 and the Professional 15 editions on 27 Feb 2023 https://nuance.custhelp.com/app/answers/detail/a_id/29838/~/dragon-professional-v14-and-v15-product-advisory-notice . The Dragon Professional Individual product page now redirects to microsoft.com/health-solutions (checked 25 Sep 2026). Windows 10 users are told to move to Windows 11 + v16 for OS-related issues https://nuance.custhelp.com/app/answers/detail/a_id/29940/~/dragon-and-windows-10-end-of-support . Aqua PH reviewer Alexander Williams, "a very long-time user of Dragon Dictate", switched.

### Mac-specific (for contrast)

- Permission hurdles (Accessibility, Input Monitoring); Secure Input swallows shortcuts (Wispr hotkey doc; Handy #1999).
- macOS updates break global shortcuts (VoiceInk #735 on macOS 26; Handy #1578).
- AirPods Handoff and volume jumps (Handy #646); Fn/Globe shortcuts on non-Apple keyboards (Handy #1925); the orange "mic in use" dot puts developers off always-on mic fixes (Handy maintainer in #1283).
- Clamshell mode needs an external mic (Wispr requirements).
- Mac users mostly complain about **choice and polish**. Windows users complain that it **doesn't run, doesn't paste, or fights the OS**. Apple Silicon makes local models fast (HN lxe: "whisper.cpp + Metal gives <500ms latency on M1", *paraphrase*), so "local and instant" is easier to promise on a Mac than on an average Windows laptop.

---

## 4. Quick wins, and claims not to make

### Quick wins — cheap to avoid, and good claims once built *and tested*

Each line: the claim · the frustration it answers · what has to be true first.

1. **"Your words are never lost."** (#3, #2) Audio is written to disk as you speak (crash-safe), kept in history, with **Retry** and a **Paste last** hotkey. *True only if a crash or failed transcription still leaves a playable file.*
2. **"Types into the window you started in — or tells you it didn't."** (#20, #1) Record the target window at key-down; if focus has moved or paste can't land, don't paste into the wrong app — keep the text ready and show a clear notice. *Needs a test with focus changed mid-dictation.*
3. **"Leaves your clipboard alone."** (#15) Restore the previous clipboard only after the paste has been read, or insert without the clipboard where possible. *Test under CPU load — that is when Handy's race shows up.*
4. **"Starts listening the instant you press."** (#6) Short pre-roll buffer or warm mic while armed; the "listening" indicator only turns on when audio frames arrive; warn when a Bluetooth mic is selected. *Measure lost milliseconds on a Bluetooth headset and on the laptop mic.*
5. **"Says what you said."** (#12) Verbatim by default, or clean-up as a clearly labelled mode; the model never answers the dictation; raw text always one click away; find-and-replace kept separate from AI. *Test with dictated questions ("what's the capital of France?") and negations ("don't…", "not…").*
6. **"Silence stays silent."** (#4) Voice-activity check that drops empty or near-empty recordings instead of sending them to the model — this removes "Thank you for watching" hallucinations. *Test: press and release without speaking; pocketed headset.*
7. **"Your language stays your language."** (#11) Explicit language choice, never auto-translate to English, optionally a language per hotkey.
8. **"Honest about where it can't type."** (#1, Windows) Detect elevated windows and say "this window is running as administrator"; a terminal mode with no trailing full stop or capitalisation, and an optional type-out mode for apps that collapse or block pastes.
9. **"Pauses your music only if it's playing, and always puts it back."** (#17) Plus a plain note about Bluetooth: using the laptop mic keeps headphones in stereo (#18).
10. **"No account needed" / "no API key needed" / "works offline"** (#13, #19) — only if each is literally true for the default setup.
11. **Signed installer; no WebView2/FFmpeg/Python hunt; asks before starting at login; no marketing notifications.** (#13, Windows)
12. **Hotkeys that behave on Windows** (#10): right-hand modifiers, mouse side buttons, layout-independent, and swallowing the Win key so Start doesn't pop up.
13. **Publish measured numbers instead of adjectives** (#5, #14): idle RAM, key-release-to-text time on named hardware, with the method.

### Claims NOT to make (unverifiable, outdated or risky)

- **"Most accurate", "X% accuracy", "better than Wispr / Superwhisper / Dragon"** — no benchmark we control; accuracy swings with mic, accent and domain. When Wispr launched its "Canto" model, HN commenters asked for real examples rather than headline metrics (https://news.ycombinator.com/item?id=49744715, *paraphrase*).
- **"Instant", "zero latency", "under N ms"** without a published method and hardware.
- **"Never cuts off your first word"** — Bluetooth wake-up delay is hardware/OS; claim only a measured buffer.
- **"100% private" / "nothing leaves your device"** if anything makes a network call (cloud model, LLM clean-up, telemetry, update checks). Only claim what a user can verify, e.g. "works with Wi-Fi off".
- **"Works in every app"** — elevated windows, games, RDP/Citrix/VDI, secure password fields and some terminals are known exceptions.
- **"Works offline"** unless every default feature does.
- **"Supports 100 languages" / "handles mixed languages"** unless tested; Wispr's own docs admit one language per dictation.
- **"Unlimited"** if there is any cap — Willow is being called "Misleading" for exactly that.
- **"Fixes Bluetooth audio quality"** — it's a Bluetooth profile limitation; we can only avoid triggering it.
- **Compliance badges** (HIPAA, GDPR-compliant, SOC 2) without the certification or a proper assessment.
- **"Free forever" / "no subscription, ever"** unless the business model is settled.
- **"Runs on Windows on ARM"** unless tested on a Snapdragon machine. If it is true, it's a genuine differentiator: Wispr doesn't.
- **Anything about a competitor's current behaviour taken from competitor pages** — see the register below. Safer still: don't name competitors; describe what Murmur does.

---

## 5. Unverified-claims register (do not repeat without checking)

| Claim often repeated | Where it comes from | Status |
|---|---|---|
| Wispr Flow is "2.7/5 on Trustpilot" | Competitor pages; an affiliate blog (filipkonecny.com, "2.7/5 (39 reviews)") | **Cannot verify** — Trustpilot has removed the profile ("goes against our guidelines") |
| Wispr "works ~60% of the time after the trial" / "day-two drop" | A Reddit post (unreadable here), amplified by Voibe and by DictaFlow's founder on Medium | **Unverified.** Related primary evidence exists: iOS review "less than 50% of the time" (21 Sep 2026) |
| Wispr uses "800 MB RAM and 8% CPU at idle", "8–10 s to start" | 800 MB traces to one Product Hunt review (paraphrased); CPU and start-up figures unsourced in what I saw | **Single source / unsourced** |
| Wispr "takes screenshots of your screen every few seconds" | Competitor pages citing a 2025 incident | **Historical, unverified.** Wispr's current docs describe Context Awareness using "relevant text from the active app" with its own setting |
| Wispr "banned the user who found it; the CTO apologised" | Competitor pages citing Reddit | **Unverified** |
| Superwhisper for Windows "saves recordings by default; stores API keys in plain text" | Spokenly (competitor) | **Unverified** |
| Willow "reads 'delete' as a command"; "desktop won't work offline" | Competitor pages | **Unverified** |
| Dragon Professional costs US$699 | Secondary sites | **Unverified at source** — Nuance's page no longer lists individual pricing |
| "Microsoft deprecated offline speech recognition for voice typing" | A community answer on Microsoft Q&A (5897711) | **Not an official Microsoft statement.** Microsoft's page does say voice typing needs the internet |

---

## Appendix: main primary sources by product

- **Wispr Flow** — Microsoft Store reviews (ratings service) https://storeedgefd.dsx.mp.microsoft.com/v9.0/ratings/product/9N1B9JWB3M35?market=US&locale=en-US ; iOS reviews https://apps.apple.com/us/app/wispr-flow-ai-voice-keyboard/id6497229487?see-all=reviews (RSS: https://itunes.apple.com/us/rss/customerreviews/page=1/id=6497229487/sortby=mostrecent/json); Product Hunt https://www.producthunt.com/products/wisprflow/reviews ; Known Issues https://docs.wisprflow.ai/collections/5686269587-known_issues ; status https://statuspage.incident.io/wispr-flow/history ; forensic report https://www.wensenwu.com/thoughts/wispr-flow-investigation ; VS Code #282290; Claude Code #38620, #93782.
- **Superwhisper** — Windows feedback thread https://feedback.superwhisper.com/board/p/windows-version ; board https://superwhisper.userjot.com/ ; troubleshooting https://superwhisper.com/docs/common-issues/troubleshooting ; changelog https://superwhisper.com/changelog ; iOS reviews https://apps.apple.com/us/app/superwhisper/id6471464415?see-all=reviews
- **Aqua Voice** — HN "Show HN: Aqua Voice 2" (Apr 2025) https://news.ycombinator.com/item?id=43634005 ; Product Hunt https://www.producthunt.com/products/aqua/reviews ; FAQ https://aquavoice.com/info/faq
- **Willow Voice** — iOS reviews https://apps.apple.com/us/app/willow-dictation-ai-keyboard/id6753057525?see-all=reviews ; Product Hunt https://www.producthunt.com/products/willow-voice/reviews
- **VoiceInk** — issues https://github.com/Beingpax/VoiceInk/issues (645 issues; most-discussed listed in §1)
- **MacWhisper** — App Store https://apps.apple.com/us/app/macwhisper/id1668083311?see-all=reviews ; HN blopker https://news.ycombinator.com/item?id=48533220
- **Handy** — issues https://github.com/cjpais/Handy/issues (761 issues; 76 with "windows" in the title); HN threads https://news.ycombinator.com/item?id=46628397 (Jan 2026) and https://news.ycombinator.com/item?id=45399106 (Sep 2025)
- **Whispering / OpenWhispr** — https://github.com/EpicenterHQ/epicenter/issues , https://github.com/OpenWhispr/openwhispr/issues ; HN "Show HN: Whispering" https://news.ycombinator.com/item?id=44942731
- **Cross-product HN threads** — "Free alternative to Wispr Flow, Superwhisper, and Monologue" (Feb 2026) https://news.ycombinator.com/item?id=47040375 ; "Why do voice transcription apps charge monthly…" (Nov 2025) https://news.ycombinator.com/item?id=45923352 ; "Anyone using a Wispr Flow alternative that is non-cloud?" (Sep 2026) https://news.ycombinator.com/item?id=49809670 ; Wispr "Canto" launch (Sep 2026) https://news.ycombinator.com/item?id=49744715
- **Windows built-in** — Microsoft Q&A threads cited in §3; Microsoft support pages for voice typing and Voice Access.
- **Dragon** — Capterra https://www.capterra.com/p/251641/Dragon-Professional-Individual/reviews/ (mostly 2017–2022; one Jan 2025); Nuance advisories cited in §3.
