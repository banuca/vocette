# Common English words — `common-words.txt`

The vocabulary correction (`src/shared/vocabulary-correction.ts`) turns a near-miss
of one of the user's own terms into the term, but must never turn a real word into
one: "coffee" stays "coffee" even with "koffi" in the list. This file is the list of
real words it checks against.

- **72,835 words, 665,851 bytes**, one per line, lower-case, letters only (accented
  letters included), at least two letters, sorted, no duplicates, LF line endings.
- SHA-256 `d198bbdb916d4e8e903b7c07925ef0332283952540e748f9218066ec006add4d`.
- Loaded by `src/main/common-words.ts` in the main process only, on the first
  dictation that has a vocabulary. The build gives it a chunk of its own
  (`out/main/chunks/`); the renderer never carries it.

## Source

SCOWL (Spell Checker Oriented Word Lists) by Kevin Atkinson — since 2026 also called
the English Speller Database (ESDB) — official release **2026.02.25**: tag
[`rel-2026.02.25`](https://github.com/en-wl/wordlist/releases/tag/rel-2026.02.25) of
<https://github.com/en-wl/wordlist>, commit `7e99edab8e32f9f9ea2b15f249ca8d4d67237410`,
as linked from <https://wordlist.aspell.net/>. Downloaded 28 September 2026.

Parameters: SCOWL **size 50** ("medium"), spellings **A** (American, en_US) and **B**
(British, en_GB), variant level **1** — the level the official speller dictionaries
use. Every entry is lower-cased, so proper nouns count too ("Monday" protects
"monday"). Each accented word is kept both with and without its accents ("café",
"cafe"). Entries with an apostrophe, hyphen, dot, digit or space are dropped, as are
single letters.

## How it was generated

SCOWL builds its database with Python 3 (3.7 or later) and SQLite (3.33 or later,
which Python includes); the filtering step uses Node. On Windows run this in Git Bash
and write `python` for `python3`.

```sh
curl -L -o wordlist-rel-2026.02.25.tar.gz \
  https://github.com/en-wl/wordlist/archive/refs/tags/rel-2026.02.25.tar.gz
tar -xzf wordlist-rel-2026.02.25.tar.gz
cd wordlist-rel-2026.02.25
# SCOWL reads its data as UTF-8; Windows Python needs to be told.
export PYTHONUTF8=1
# What SCOWL's `make` runs: builds scowl.db from data/ (about two minutes).
python3 combine.py create-db scowl.db
{ python3 scowl --db scowl.db word-list 50 A,B 1
  python3 scowl --db scowl.db word-list 50 A,B 1 --deaccent
} 2>/dev/null | node -e '
  const words = new Set()
  for (const line of require("fs").readFileSync(0, "utf8").split(/\r?\n/)) {
    const word = line.toLowerCase()
    if (/^\p{L}{2,}$/u.test(word)) words.add(word)
  }
  process.stdout.write([...words].sort().join("\n") + "\n")
' > common-words.txt
```

The source archive downloaded on 28 September 2026 had SHA-256
`74e7cc3e9e03e609c1c74bb7e8862fcd988cdd64768dcbee4611581b7e633852` (GitHub builds these
archives on request, so a later download may differ byte for byte; the tag's commit is
the fixed reference). Two runs from a clean extraction gave the same output, byte for
byte. As a check on the database build, `word-list 60 A 1 --deaccent` and
`word-list 60 B 1 --deaccent` from the same database match SCOWL's published plain
word lists for that release (`en_US.txt` and `en_GB-ise.txt` in
[en-wl/wordlist-diff](https://github.com/en-wl/wordlist-diff/tree/rel-2026.02.25))
line for line.

## Copyright and permission notice

SCOWL's `Copyright` file adds a second notice only for word lists that use the
Australian spelling (`D`) or region (`AU`), and a third only for generated word lists
larger than size 80. This list is neither, so the notice before the file's first `===`
is the one that applies. Reproduced verbatim:

```text
Copyright 2000-2026 by Kevin Atkinson

Permission to use, copy, modify, distribute, and sell any part of SCOWLv2, or
word lists created from it, is hereby granted without fee, provided that the
above copyright notice appears in all copies and that both the above
copyright notice and this notice appear in supporting documentation.  Kevin
Atkinson makes no representations about the suitability of this database for
any purpose.  It is provided "as is" without express or implied warranty.

SCOWL is derived from many sources, most of which are in the Public Domain.
Data from the Corpus of Contemporary American English (COCA) was also used.

All data from COCA comes from 3-gram data that is not freely available;
however, the usage is within the rights given by the NDA that was signed when
purchasing the data.  More information on COCA is available at
https://www.english-corpora.org/coca/.

The primary source of words for SCOWL comes from 12dicts and ENABLE2K.  Both
are in the Public Domain, but Alan Beale <biljir@pobox.com> deserves special
credit as he is the author of 12dicts and a major contributor to ENABLE2K.  In
addition, he gave me an incredible amount of feedback and created a number of
special lists in order to help improve the overall quality of SCOWL.
```

The app credits the list on its About page ("Word list: SCOWL, © Kevin Atkinson").
