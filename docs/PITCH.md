# Pitch — Quita

For the video, the submission form, and the questions a judge will actually ask.
Companion to [`VIDEO_SCRIPT.md`](VIDEO_SCRIPT.md), which is the shot-by-shot version.

Tone throughout: an engineer showing something that works. The strongest move available is
declaring a limitation before anyone finds it.

---

## The one-liner

> Credit life insurance where the loss ratio is a computation, not a disclosure.

## The 30-second elevator

> When a borrower dies, credit life insurance pays off the debt so it doesn't land on the family.
> Across Latin America it's effectively compulsory on consumer credit, and almost nobody can
> check whether it works. The insurer reports the loss ratio; you either believe it or you don't.
>
> Quita makes those numbers checkable. Loan events happen on Ethereum. The insurance logic runs
> on Creditcoin, and it reconstructs the insured balance from Ethereum events whose inclusion was
> cryptographically proved by the Attestcoin precompile — inside the transaction, no oracle
> operator anywhere. Premium collected and claims paid are on-chain counters that only move when
> something was proved. So the loss ratio stops being a press release and becomes a view
> function.

## The 2-minute pitch

**The problem is not fraud. It's that nobody can check.**

> Credit life cover — "seguro prestamista" in Brazil, "desgravamen" in Spanish-speaking Latin
> America — extinguishes a borrower's debt on death. It's one of the most profitable and least
> transparent lines in consumer finance. The recurring complaints are a low share of premium
> returned as claims and a large share captured as commission by the bank that sold it.
>
> I want to be careful here: the market figures I've seen come from litigation analysis, not from
> audited statistics, and I've marked them that way everywhere they appear. But that's exactly
> the point. The structural problem isn't that the numbers are bad. It's that a loss ratio is a
> disclosure about numbers nobody outside the insurer can see. You can't audit a claim about a
> private database.

**What Quita does.**

> Quita is not an insurer. It's infrastructure a lender puts underneath a credit life book so the
> numbers become verifiable.
>
> Two chains, deliberately split. Loans originate on Ethereum Sepolia, where a minimal contract
> emits four events and nothing else. All the insurance logic lives on Creditcoin CC3. The
> insurance can never invent the balance it's covering, because that balance is reconstructed
> from proved Ethereum events — the Attestcoin BlockProver precompile verifies Merkle inclusion
> synchronously, inside the Creditcoin transaction. State only changes if the precompile returns
> true.

**Where the real engineering went.**

> The precompile proves a transaction was included. It deliberately does *not* tell you three
> things, and each one is an attack if you skip it.
>
> It doesn't check whether the transaction succeeded. So we decode the receipt and revert unless
> status is 1 — otherwise a reverted transaction's simulated logs could settle a fraudulent
> claim.
>
> It doesn't tell you who emitted the log. So we validate the emitter address, not just the event
> signature — otherwise anyone deploys a clone of our origin contract and emits whatever they
> like.
>
> And it doesn't pin the source chain, so we do.
>
> That last one surfaced a gap in the protocol's own base contract: `ASCBase.execute` is external
> and not virtual, so it can't be overridden and doesn't pass the chain key to the handler. Our
> entrypoint is `executeFromSource`, and we leave the inherited one deliberately inert rather
> than merely discouraged. That's written up in our integration doc.

**The line I want you to hold me to.**

> Death is a fact about the world. No protocol can verify it. So the death attestation in Quita
> is *trusted* — mitigated by a 2-of-3 attestor threshold and a challenge window, not eliminated.
> I'm not going to pretend otherwise.
>
> But look at where that trust sits. The payout is `min(sumInsured, outstanding)`, and
> `outstanding` is read from proved state, never from the attestation. An attestor who lies about
> the amount changes nothing. The financially consequential quantity is the verified one. That
> separation is the design, not a gap in it.

---

## The three claims that carry the pitch

1. **The loss ratio is a view function over proved inputs.** Not a report. Anyone can read it,
   continuously, without asking the insurer.
2. **The payout amount is never trusted.** It comes from the mirrored balance, which only moves
   on a verified proof. Lying about the amount is a no-op.
3. **We closed three holes the precompile leaves to the application**, and found a real gap in
   `ASCBase` while doing it.

---

## Hard questions, and honest answers

**"Isn't the death attestation the whole ballgame? You've just moved the trust."**

> Partly, and I won't dress that up. What I'd push back on is the word *whole*. There are two
> things an attacker wants: to trigger a payout that shouldn't happen, and to control how much
> gets paid. Quita only leaves the first one open, it needs 2 of 3 independent attestors to do
> it, and there's a challenge window before settlement. The amount is closed completely. Attestor
> bonds and slashing are the obvious next step and they're on the roadmap, not in the code.

**"Why not just run the whole thing on one chain?"**

> Because the loan book already exists somewhere else, and that's the realistic case. A lender
> isn't going to move their origination onto your chain so you can insure it. The interesting
> problem is insuring a book you don't control and can't be lied to about. That's what the
> Attestcoin integration buys, and it's why this isn't a bridge — nothing is being moved, a fact
> is being proved.

**"Your loss ratio shows 300%. Isn't that broken?"**

> It's a demo book of nine policies with one claim. A real book prices for roughly one death per
> thousand policy-years. The dashboard says exactly that under the number, because a ratio
> computed from nine policies is a demonstration of the mechanism, not a market-comparable
> figure. I'd rather show a number that's obviously a demo than a tuned one that looks credible.

**"What's actually deployed versus what's mocked?"**

> The contracts on testnet are the same ones in the repo. The settlement asset is a declared mock
> — a freely mintable 6-decimal ERC20 with no value. The mortality table is a declared
> placeholder: flat rates by age band and sex, marked in the contract source as
> `PLACEHOLDER - pending BR-EMS 2021 (SUSEP)`. Plausible magnitudes, not actuarial output. In
> local tests the `0xFD2` precompile is mock bytecode installed at the real address, because it's
> native runtime code and can't exist on a Hardhat node — but on testnet it's the real one.

**"Why isn't there a button to create a policy?"**

> Because there's no code path to create one without a proof. A policy exists only as a
> consequence of a verified `LoanDisbursed` event. If I'd put an operator button there, the whole
> claim of the project would be false. The frontend says that out loud instead of hiding it.

**"Are you using Attestcoin Writability?"**

> No, and deliberately. The documentation says it's undergoing third-party testing and audits, so
> the integration is read-only, Ethereum to Creditcoin. Marking a loan extinguished back on
> Ethereum is the natural use for it once it ships, and that's on the roadmap.

**"You're one person. What did you actually build versus assemble?"**

> Six contracts, an off-chain proving worker with crash-resumable SQLite state, 79 tests, and the
> integration documentation. What I assembled: OpenZeppelin, the Gluwa SDK and `asc-contracts`,
> Hardhat. What I wrote: everything in `contracts/`, the verification hardening, the worker, and
> the test harness that installs mock precompile bytecode so any of it is testable at all.

**"What breaks first if this went to production?"**

> The attestor set. Right now it's a registered list with a threshold, and the economic security
> is zero — nobody loses anything by lying. That needs bonds and slashing before it touches real
> money. After that, the mortality table, which needs a real SUSEP filing. And we'd need a
> settlement asset that exists.

---

## What not to do in the video

- Don't claim the death attestation is verified. It isn't, and a judge who catches that discounts
  everything else.
- Don't present the market figures as audited. Say "litigation analysis, pending cross-check
  against SUSEP" — it costs three seconds and buys the rest of the pitch.
- Don't hide the 300% loss ratio. Explain it. An unexplained number invites the question; an
  explained one demonstrates judgement.
- Don't skip the explorers. Real hashes on Etherscan and Creditcoin Blockscout are the proof that
  this ran. That is the single most persuasive thing in the whole video.
