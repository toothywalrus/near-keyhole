# 0011: Live quotes are keyless and carry no `confidentiality` field

**Context.** The plan was a live 1Click dry quote "with `confidentiality` set". Measured 2026-11-05: a keyless dry quote works with `depositType: INTENTS`, but setting `confidentiality` to `basic` or `advanced`, or using `depositType: CONFIDENTIAL_INTENTS`, answers `401: User authentication is required for confidential intent quotes`.

**Decision.** The free path quotes without the field. Per the docs' changelog every 1Click swap has settled confidentially since 2026-10-27 with no API change, so nothing is lost in what the quote says. `npm run copy` asserts the 401, so we find out if it changes. `copy/confidential-adapter.ts` holds the mainnet request written against the docs, and is labeled unexercised.

**Consequences.** A real confidential path needs a user's JWT (NEP-413 or ERC-191 signature exchanged at `/api/auth/authenticate/{apiKey}`), and so an owner's decision.
