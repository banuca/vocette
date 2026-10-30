# The self-check recording: `self-check.wav`

The on-device engine reads this recording after every model load and is used only if its
words come back (`src/main/engine/self-check.ts`).

- **What it says:** "It is a truth universally acknowledged", the opening words of
  *Pride and Prejudice* by Jane Austen (1813).
- **Reader:** Karen Savage, for LibriVox: *Pride and Prejudice (version 3)*, chapter 1,
  recorded in September 2007. A solo reading.
- **Licence:** public domain. LibriVox volunteers dedicate every recording to the public
  domain, and anyone may reuse them for any purpose without permission or credit
  (<https://librivox.org/pages/public-domain/>). The archive.org item carries the Creative
  Commons public domain dedication (<http://creativecommons.org/licenses/publicdomain/>).
  LibriVox warns that a book's text can still be in copyright outside the USA; Austen died in
  1817, so this one is out of copyright everywhere. Nothing needs to be credited.
- **Source:**
  - LibriVox catalogue page: <https://librivox.org/pride-and-prejudice-by-jane-austen-2/>
  - archive.org item: <https://archive.org/details/pride_prejudice_krs_librivox>
  - The file, the item's original upload:
    <https://archive.org/download/pride_prejudice_krs_librivox/pride_and_prejudice_01_austen.mp3>.
    4,547,912 bytes, 44.1 kHz mono VBR MP3, 284 s. MD5 `59aa81cfafdc7f8462ead8a3c2128236` and
    SHA-1 `bf9e8f3bd2b4bc1687def7ad2f34c9fa5199f683`, as archive.org lists them; SHA-256
    `da5348b393fb6e732f238cfa8bfe04759781649bfad5183629bc650097d1c34a`. Downloaded
    30 October 2026.

## How it was cut

The words run from 11.80 s to 13.73 s of the chapter. With ffmpeg 9.0.2:

```sh
ffmpeg -i pride_and_prejudice_01_austen.mp3 -af "atrim=start=11.6:end=13.77,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.02,afade=t=out:st=2.15:d=0.02,aresample=16000:resampler=soxr" -ac 1 -c:a pcm_s16le -map_metadata -1 -fflags +bitexact -flags:a +bitexact self-check.wav
```

The result is 2.17 s of 16 kHz mono PCM16: 34,720 samples, 69,484 bytes, SHA-256
`71e41bf591c73affb142e0124e64a72724f8fec7231fd0bceda392298f5d507a`, which
`tests/self-check.test.ts` checks.

## Why this phrase

Common words, no names or numbers, and nothing spelt differently in British and US English.
On a Core Ultra 7 265U the shipping model (q8rr) read it as "It is a truth universally
acknowledged." in all 28 decodes: with 1, 2, 3 and 4 threads, each time as cut, 12 dB quieter,
6 dB louder, with noise at 30 dB and at 20 dB SNR, with 40 ms trimmed from the start, and with
300 ms of silence in front. The retired q8 model and the full-precision export read it the
same way in the same seven conditions.
