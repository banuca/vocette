# Murmur Phase 2 — accounts and multi-device

A brief, written to be handed to an implementer in one piece. Copy it whole.

---

You own end-to-end implementation of Murmur's next milestone, in
`https://github.com/banuca/murmur` at `main`, on top of `v0.4.0`. Work
autonomously. Do not stop after discovery, a plan, a feature or an internal
phase.

**Outcome:** a Murmur account that a person can create, sign in to, and use on
more than one computer, so their settings and transcript history follow them —
without weakening a single privacy promise the product currently makes.
Complete implementation, integration, testing, fixes and documentation in one
continuous effort.

## The promise you must not break

Murmur 0.4 says, in its README, its About page and SECURITY.md: no account, no
shared backend, no telemetry, your own API key, transcripts stay on your
computer. Phase 2 makes an account *possible*, not *required*. Every one of
those sentences must remain true for a user who never signs in, and the product
must keep working entirely offline with no account at all. If a change would
make the account mandatory, or make the app useless without a network, it is
out of scope — say so rather than building it.

For a user who does sign in, the promise becomes narrower and must be restated
honestly in the same three places, in plain language, before the feature ships:
what leaves the device, what the server can read, what it cannot, how long it
is kept, and how to delete all of it.

## Architecture

Keep Electron, TypeScript, Vite, plain DOM/CSS, the existing state machine and
the main-process platform boundary. No UI framework rewrite. Sync belongs in
the main process behind a small interface, alongside the platform adapters, and
must load lazily: a missing network, an expired session or an unreachable
server must never prevent the application opening or a local dictation
completing.

The client is the source of truth for anything the user is currently editing.
Treat the server as a replica, not as the master copy.

## Mandatory: the server cannot read transcripts

Transcripts and settings sync **end-to-end encrypted**. The server stores
ciphertext and metadata it needs for routing and conflict resolution, and
nothing else. Derive the encryption key from the user's credential on the
device; never send it anywhere. A server operator with full database access —
including you — must not be able to read a single transcript. Design for that
and demonstrate it, rather than asserting it.

**Do not sync the transcription API key by default.** It is a credential for a
third-party account with a billing relationship, and pushing it between devices
turns one compromise into several. If you offer it at all, make it explicitly
opt-in, separately encrypted, and clearly explained.

If end-to-end encryption cannot be made to work for some part of the feature,
cut that part. Do not fall back to server-readable data quietly.

## Scope

- Create an account, sign in, sign out, and see on which devices the account is
  currently signed in — with the ability to revoke a device.
- Sync settings and transcript history between devices, including a first sync
  onto a device that already has local history. Merge; never silently discard.
- Deterministic conflict resolution, specified in writing before it is built,
  including what happens when the same entry is deleted on one device and
  edited on another.
- Deletion that means deletion: delete an account and everything the server
  holds for it, confirmed by the server, visible in the interface.
- Export before deletion, so leaving is not punitive.
- Honest sync status in the interface: last synced, pending, failed and why.
  A failure must be visible and retryable, never silent.
- Sessions held in OS-backed secure storage, with the same honesty as the
  existing API key handling where that storage is unfit.

Do not add telemetry, analytics, crash reporting, marketing email, social
login that leaks the user's identity to a third party, or any feature whose
purpose is engagement rather than dictation.

## Decisions you must put to the product owner, with a recommendation

Do not choose these alone:

1. **Who runs the server, and where.** Hosting costs money and creates a legal
   controller relationship. Name candidate providers, their cost at 10, 1,000
   and 10,000 users, and the jurisdiction the data sits in.
2. **Whether accounts are free.** If the answer is "free for now", say what the
   bill looks like at the point where that stops being true.
3. **Authentication.** Passkeys, email plus password, or a magic link — with
   the effect of each on the end-to-end encryption key, since a password reset
   with no password means either recovery codes or lost data.
4. **Account recovery.** Recovery codes, a second device, or none. There is no
   painless answer here: real end-to-end encryption means a lost credential can
   mean lost data, and the user has to be told before they rely on it.
5. **What happens to the 0.4 local-only user.** Nothing at all, or an offer?

## Legal and operational reality

Running an account service makes the operator a data controller. Before any
public launch, state in writing what is collected, the lawful basis for holding
it, where it is stored, how long it is kept, and how a user exercises deletion
and portability. Switzerland's FADP and the EU GDPR both apply to a service
open to their residents. A privacy policy and a terms of service are part of
this milestone, not an afterthought — but they are *drafts for a lawyer to
review*, and must be labelled as such. Do not claim compliance; describe what
the system does and let a professional judge it.

Say plainly, before building: this is the point at which a spare-time MIT
project acquires an ongoing operational and legal burden. If the product owner
does not want that burden, the honest alternative is user-provided storage —
their own file-sync folder, or a bring-your-own-bucket arrangement — which
gives multi-device use with no server, no account and no controller
relationship. Cost that option out alongside the account, and recommend one.

## Security

Preserve everything 0.4 established: sandboxed renderers, context isolation,
the restrictive CSP, sender validation, all network access in the main process,
cancellation ownership and audio cleanup. Additionally:

- No secret, session token or key material in the renderer or in any log,
  diagnostic or error message.
- Server endpoints authenticated and rate-limited; no endpoint that enumerates
  users or accounts.
- Every server-side input validated against a schema. Assume a hostile client.
- Dependencies added for this work justified one by one. A sync client is not a
  reason to acquire forty transitive packages.

## Verification

The evidence rules from 0.4 carry over unchanged and are not negotiable:

- A mocked test is not a pass on a real system. A configured CI job is not a
  pass.
- Never mark a platform verified from a different one.
- Exercise the real client against a real running server instance, including
  the cases that matter: two devices editing at once, a device offline for a
  week then reconnecting, a revoked session, a failed sync, a server returning
  500, and a deliberately corrupted payload.
- Prove the encryption claim: show a database dump and demonstrate that the
  transcripts in it are unreadable without a key that never left the device.
- Do not claim more than the evidence supports.

macOS and Linux remain unrun as of 0.4. Do not describe them as working.

## Handoff

Update README, SECURITY, CONTRIBUTING, the changelog, the platform matrix and
the verification records. Add a document describing the sync protocol and the
threat model it is built against. Return: a summary of what was delivered; a
reviewable diff; automated, integration, manual and security results kept
separate; the exact commands to run client and server locally; remaining
defects and limitations with severity; and the decisions listed above with
their answers recorded.

**No commit, push, merge, release, paid service, hosting account or publishing
without separate authorization. Routine local implementation, testing and
packaging are authorized.**
