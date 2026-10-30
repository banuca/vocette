# Vocette

**Private dictation for Windows.** Hold a shortcut and speak. When you let go, your words are typed into the app you are using. By default, the speech is turned into text on your own PC, not in the cloud.

Vocette is for people who write a lot and must keep their words confidential: translators, and small law and notary firms. It understands 25 European languages, needs no account, and works offline once its speech model is downloaded.

**[Download Vocette](https://github.com/banuca/vocette/releases)** and choose the newest Vocette release. The Windows installer is not signed yet, so Windows may say it protected your PC. Choose **More info**, then **Run anyway**.

## Free and Pro

Everyone starts with 30 days of Pro, free. After that, Vocette carries on as Free unless you subscribe.

| | Free | Pro |
|---|---|---|
| Price | US$0 | US$9.99 a month, or US$99 a year |
| Dictation, on your PC or through your own cloud provider | 10,000 words a month | No limit |
| Clean-up, spoken corrections and history | Yes | Yes |
| Your words: names and terms spelled your way | 50 | 500 |
| Replacements and snippets | 20 | 200 |
| AI polish: a dictation rewritten in the style you choose | No | Yes |

Pro is a subscription through Polar and covers up to 10 devices. Cancel any time: Pro stays on until the end of the period you have paid for.

**Teams:** US$120 per seat a year, from 3 seats, by arrangement.

## Privacy

With the on-device engine, which is the default, your audio and your text stay on your PC. The one exception is AI polish, if you switch it on and choose a cloud provider. Audio is never written to disk, and your history is kept only on your PC.

Vocette goes online only for these:

- **The speech model**, once, when you press **Download**: 935 MB from this repository's releases on GitHub, checked against fixed SHA-256 hashes before first use.
- **Cloud transcription**, only if you choose it: each recording, with your word list, goes to the provider you set up, using your own key, or to a server of your own.
- **AI polish** (Pro), only if you switch it on: the text of each dictation, never the audio, goes to the provider you choose, with your instructions and word list. Choose Ollama or LM Studio to keep it on your PC.
- **Your Pro licence**, only once you activate a key: your key and a device label go to Polar, and Vocette then checks your subscription with Polar at most once a day.
- **Updates**: a daily check asks GitHub for the latest version number. The first-run card offers it, ticked, and you can turn it off in **About**. An update is downloaded only when you press **Download and install**.
- **Anonymous counts**, only if you tick **Help improve Vocette**: once a day, eight values such as your version, your plan and how many days you dictated in the last seven. No words, no audio and no ID. **About → Show what is sent** shows the exact report.

There is no crash reporting and no other analytics. [SECURITY.md](SECURITY.md) lists every request in full.

## Languages

The on-device engine uses NVIDIA's Parakeet TDT 0.6B v3 speech model. It recognises 25 European languages, and you do not have to tell it which one you are speaking:

Bulgarian, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek, Hungarian, Italian, Latvian, Lithuanian, Maltese, Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish and Ukrainian.

For other languages, you can use a cloud provider with your own key.

## What you need

- **Windows 10 or 11, 64-bit.** Vocette is tested on Windows 11.
- **A 935 MB download** for the speech model, once, and about 1 GB of free disk space for it.
- **About 1 GB of memory** while you dictate. Vocette frees it after 5 minutes of rest. No graphics card is needed.

**Mac and Linux are betas.** There are builds for Macs with Apple silicon and for Linux (x64). Our automated checks build them and run the speech engine on both, but they have not yet been tested on a real Mac or Linux PC. [Platform support](docs/platform-support.md) says what works where.

## Limits

- **Accuracy outside English is not measured yet.** Vocette runs its own int8 version of NVIDIA's model and has tested its accuracy only in English. NVIDIA's [model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) gives NVIDIA's own results for each language, measured on the original model.
- **The clean-up rules are English only.** Removing filler words and acting on "scratch that" or "new line" work in English. In other languages, clean-up removes only hesitation sounds such as "äh" and "euh".
- **The installer is not signed yet**, so Windows may warn you the first time you run it.

## More

- [How Vocette works](docs/engineering.md): dictation, settings, platforms, the Pro licence and building from source
- [Security](SECURITY.md): what the app is allowed to do, and every network request it makes
- [Platform support](docs/platform-support.md): what works on each system, and what has been tested
- [Changelog](CHANGELOG.md)
- [Licence](LICENSE): MIT

Vocette is open source and independent, with no affiliation to any commercial dictation product. Speech model: NVIDIA Parakeet TDT 0.6B v3, CC BY 4.0; ONNX export by the sherpa-onnx project (k2-fsa); weights quantised to int8 by Vocette.
