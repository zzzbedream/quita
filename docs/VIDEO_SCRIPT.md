# Video Script (3–4 min)

Target 3:45. The video is a mandatory submission field — it is the one deliverable that cannot be
skipped.

Tone: an engineer showing something that works. No music, no stock footage, no hype. The strongest
move available is declaring your own limitations before anyone asks.

---

## 0:00–0:30 — The problem

**On screen:** title card, then the deck problem slide.

> "Credit life insurance pays off your debt when you die, so it does not land on your family.
> Across Latin America it is effectively compulsory on consumer credit, and it is one of the most
> profitable and least transparent lines in the market.
>
> The recurring complaint is always the same: very little of the premium comes back as claims,
> and a large share is captured as commission by the bank that sold it. In Brazil, tying the
> policy to the loan has been litigated for years.
>
> But notice the real problem. Every one of those numbers is a disclosure. The insurer tells you
> the loss ratio. Nobody outside the insurer can check it."

---

## 0:30–1:00 — What Quita is

**On screen:** architecture diagram.

> "Quita is a credit life layer where those numbers are not disclosed, they are computed from
> events that were cryptographically proved.
>
> The loan lives on Ethereum. The insurance lives on Creditcoin. The insurance can never invent
> the balance it is covering, because that balance is reconstructed from Ethereum events whose
> inclusion was verified by the Attestcoin Protocol — inside the transaction, with no oracle
> operator anywhere in the path.
>
> I am one developer. Let me show you it running."

---

## 1:00–2:30 — Live demo

**On screen:** terminal, then both block explorers.

**[1:00] Probe.** Run `npm run probe`.

> "That is the Creditcoin precompile itself telling me which chains it can verify. chainKey one
> is Ethereum Sepolia. This is live, right now."

**[1:15] Originate.** Run `demo.full.ts`.

> "I am originating a loan on Sepolia. Twenty-five thousand. Note what is in the event: no name,
> no national id — a salted commitment. That is an LGPD requirement, not a preference."

**[1:30] The wait.** *(Cover ~13 minutes here; edit down, never cut to hide it.)*

> "Now we wait for Ethereum finality. This is not our latency. This is the cost of not trusting
> anyone. A centralised oracle answers in two seconds and you take its word. We are waiting for
> the moment the fact becomes provable."

Fill with the verified-vs-trusted table and the two attack vectors:

> "Two things the protocol gives you that are easy to get wrong. First: the prover proves a
> transaction was *included*, not that it *succeeded*. A reverted transaction is still in the
> block and still provable. If you do not check the receipt status, I can emit a death
> attestation, revert the transaction, prove it, and collect. Second: matching the event
> signature is not authentication. Anyone can deploy a contract with the same event. If you do
> not pin the emitter address, I clone your contract and mint claims all day."

**[2:00] Verified.** Proof lands on Creditcoin.

> "Verified. The loan now exists on Creditcoin with the correct balance, and no human asserted
> it."

Show both explorers side by side.

> "Same event. Two chains. Nothing in between."

**[2:15] Claim.** Two attestations, challenge window, settle.

> "Two attestors of three sign the death. Then a challenge window — two minutes here, twenty-four
> hours in production, and it is a parameter, not a trick.
>
> Settled. The lender is paid. Note who got paid: the lender, not the family. In credit life the
> insured life is the borrower but the beneficiary is the creditor. That is the product working
> correctly."

---

## 2:30–3:15 — Verified vs trusted

**On screen:** the table.

> "This is the slide I most want you to read.
>
> Verified: the loan exists. The principal. Every repayment. The outstanding balance. Premium
> collected. That the transaction succeeded. That the log came from our contract. That the proof
> is not a replay. And the payout amount.
>
> Trusted: that the person actually died.
>
> Death is a fact about the world. No protocol can verify it, and anyone who tells you they have
> oracle-ised mortality is describing a trusted attestor with extra steps. We use Attestcoin for
> exactly what it does: proving a transaction happened on Ethereum.
>
> What matters is that the amount is not trusted. The payout is the minimum of the sum insured
> and the verified outstanding balance. An attestor who lies about the amount changes nothing,
> because we never read the amount from the attestation. That separation is the design."

---

## 3:15–4:00 — Ecosystem fit and limitations

**On screen:** roadmap and limitations slide.

> "Creditcoin has spent nine years recording real-world loans on-chain — over a hundred million
> dollars of them, two million borrowers through partners like Aella. There is no risk layer on
> top of any of it. Loan Flow on Creditcoin EVM is on their roadmap; we are a non-trivial first
> consumer of it.
>
> What I am not claiming. Death attestation is trusted. The stablecoin is a mock. The mortality
> table is a declared placeholder pending BR-EMS 2021 from SUSEP — I would rather ship an honest
> placeholder than invented numbers presented as real. And we are not the insurer; we are
> infrastructure for the people who are.
>
> All four source events are verified, seventy-nine tests, and the full technical write-up is in
> the repo. Thank you."

---

## Production notes

- **Record one clean run before the real take.** Non-negotiable insurance.
- Terminal at ~150% zoom. Numbers must be legible after 1080p compression.
- Edit the finality wait down, but keep it visible and keep the timer on screen. Never cut to
  make it look instant.
- Explorer tabs logged out, so nothing personal appears.
- Upload unlisted to YouTube, copy the URL into the form.
- If time runs short, cut section 3:15–4:00 first and keep the demo. The demo is the submission.
