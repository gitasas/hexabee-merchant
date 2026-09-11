# hexabee-merchant — agent context

Next.js app serving two audiences from one codebase:

- **Merchant portal** — `app/(merchant-portal)/merchant/*` at merchant.hexabee.buzz
- **Public checkout** — `app/pay/*`, `app/pay-preview` at checkout.hexabee.buzz

Part of the HexaBee project (see the parent repo's `CLAUDE.md` for the whole
architecture). This is a **separate GitHub repo**: commit and push here as well.
`main` = production, `staging` = staging (`git push origin main:staging`).

Keep this file current when you add a feature or learn a non-obvious rule.

## Pages

Portal (all require a merchant session): `dashboard`, `invoices`,
`payment-links`, `payment_methods`, `settings`, plus `login`, `register`,
`onboarding`. Portal chrome (sidebar/topbar/tabbar) lives in `PortalShell.tsx`
— add new nav links to its `NAV` array (and a label to both languages in
`i18n.tsx`). **Chrome is applied by the `(portal)` route-group layout, never
by pathname branching** — layouts are not re-rendered on client-side
navigation, so a pathname branch leaves stale chrome after login/logout (this
bug shipped once). New authenticated portal pages go inside
`merchant/(portal)/`; bare pages (auth, onboarding) stay outside the group.

**The portal is bilingual (EN/LT).** All merchant-facing UI strings live in
`app/(merchant-portal)/i18n.tsx` (`useLang()` hook, `LangProvider` wraps every
branch of `merchant/layout.tsx`, `LangToggle` renders the EN|LT switcher).
Never hardcode English text in a portal page — add the string to **both** the
`en` and `lt` dictionaries (`lt` is typed as `Dict = typeof en`, so a missing
key fails the build). Counts use the `ltPlural` helper; dates use `t.locale`.
The choice persists in `localStorage` (`hb_lang`) and defaults to LT for
Lithuanian browsers.

The **public checkout is bilingual too**, with its own payer-facing dictionary
in `app/pay/i18n.tsx` (`usePayLang`, `PayLangProvider`, `PayLangToggle` — the
toggle is self-styled because the public pages load no portal CSS). It covers
`/pay/[slug]` (invoice, POS and payment-link screens), `/pay/success`,
`/pay/failed`, `/payment-success` and `/pay-preview`, and shares the `hb_lang`
storage key. Exception: the jsPDF receipt on `/payment-success` stays English —
jsPDF's built-in fonts cannot render Lithuanian diacritics.

Public: `/pay/[slug]` (invoice payment; `?mode=pos` QR screen, `?pl=` payment
link, `?r=`/`?a=` prefill, `?payload=` from the Gmail extension),
`/pay/success`, `/pay/failed`, `/payment-success`, `/pay-preview`.

## How the pay page fills its fields

Priority: dropped-PDF result → `?a=`/`?r=` URL params → ledger lookup by
reference (`/api/pay/[slug]/invoice-lookup`) → manual entry. A PDF-derived
amount is never overwritten by the lookup. If the invoice IBAN differs from the
merchant's registered one, the payer sees a mismatch warning.

**Per-invoice currency** (multi-currency merchants, e.g. UK + Baltic clients):
resolution order is payer PDF → BCC-ledger invoice matched by reference →
`?c=` template param → merchant default. Methods and fees follow the resolved
currency automatically; single-currency merchants only ever hit the default.

**Stripe payments must never require the merchant IBAN** — it is display-only.
The Connect account is resolved server-side from the slug in
`/api/payment/stripe`; the client must not send it.

## Fee mode

`merchants.fee_mode` (`merchant` | `payer`) drives POS, the static pay link and
invoice payments; payment links carry their own choice, baked into the amount at
creation — never gross up a payment-link amount again. Gross-up must mirror
`calculateHexabeeFee` in the parent repo's `index.js`: standard tier 2% + 20
minor units (GBP) / 2.9% + 25 (other currencies); iDEAL, bank transfer and
Pay by Bank 1% of the amount with a 50-minor-unit minimum; BNPL
(Klarna/Afterpay/Billie) 6.9% + 30 minor units.

The 1% tier is `PCT_MIN_METHODS` in `app/pay/[slug]/page.tsx` — it must stay in
sync with the matching branch of `calculateHexabeeFee`. A method priced there
but missing from the set gets grossed up at the card rate, so the payer is
overcharged while the badge shows 1%.

**Fee mode applies on the Montonio rail too**, and none of the above maths does.
There the fee is flat and comes in two parts, decided by `/api/payment/montonio`
and nowhere else:

- **€0.39, HexaBee's platform fee — always the payer's**, whatever the fee mode.
- **€0.10, the bank cost** — added only when the fee mode resolves to `payer`.

So a Montonio payer is charged €0.49 or €0.39, never nothing; "the merchant covers
it" means they absorb €0.10. The route re-reads the payment link server-side rather
than trusting the browser, because the amount charged must not be decidable there.
Nothing is baked into a Montonio amount, so a fixed-amount link stores the invoice
amount and the pay page must never gross it up. Three checkout surfaces display the
total and all three go through `montonioFee()` in `app/pay/[slug]/page.tsx`
(pay-link screen, POS screen, invoice screens) — the number on the button has to be
the number the route charges.

## Invoice ledger

`merchant_invoices` is written by the Python backend from BCC'd invoices.
This app reads it (`/api/merchant/invoices`), triggers reminders
(`/api/merchant/invoices/[id]/remind` → internal-token proxy) and marks rows
paid from the Stripe webhook by matching the reference. **Wrap ledger queries in
try/catch** — the table may not exist yet in a fresh environment; degrade to an
empty list instead of a 500.

## Conventions

- Styling is inline `const s: Record<string, React.CSSProperties>` per page —
  match the surrounding page rather than introducing a CSS framework.
- Instant-save toggles (fee mode, reminders) follow one pattern: optimistic
  update → PUT `/api/merchant/profile` → revert and show a message on failure.
- Every `/api/merchant/*` route starts with `getSession()` and scopes queries by
  `merchant_id`. A route once shipped without it and let anyone mark any
  payment paid.
- DB access goes through `lib/db.ts` (`query`, `queryOne`) with parameterised
  SQL; auth through `lib/merchant-auth.ts`.
- Public API responses must not include Stripe account ids; return only fields
  the UI actually renders.

## The Stripe assumption

Stripe was the only rail for most of this codebase's life, so "has a Stripe
account" got written in wherever a readiness check was needed. Six places had to
be fixed on 2026-09-10 alone: the onboarding step order, the portal copy, the
onboarding completion guard, the settings Stripe card, the POS QR gate, the
payment-methods catalogue and the checkout preview. **Where you see
`stripe_account_id` used as a condition, the question is almost always about the
merchant's rail, not about Stripe.** Ask `isOnboardingComplete`, or branch on
`payment_rail` — and remember a Montonio merchant will never satisfy a Stripe
condition, so the failure is silent: they simply never see the thing.

## Onboarding completion

**"Has a Stripe account" is not the definition of a finished setup.** It was, in
six places — the `(portal)` layout and five pages — and a Montonio merchant never
has one, so every check bounced them back to onboarding from the screen that had
just told them they were done. `lib/onboarding.ts` holds the single predicate:
complete means the merchant can take a payment *on the rail they are on*, so
Stripe merchants need `stripe_account_id` and Montonio merchants need their store
keys. Use it rather than re-deriving; six copies of a rule are six chances to drift.

**The rail follows the country.** `payment_rail` is stored — the admin can set it
and the webhook reads it — but every profile save that carries a country
re-derives it in `/api/merchant/profile` (`MONTONIO_COUNTRIES` → `montonio`,
anything else → `stripe`). Until 2026-09-11 only the key-paste and the admin set
it, so a merchant who changed their country to the UK in Settings stayed on
Montonio and kept seeing methods no UK payer could use. Prerequisites are not
checked at that point: a GB merchant with no Stripe account is simply not
finished onboarding, and `isOnboardingComplete` sends them back to connect it.

## Assets and country coverage

- **`public/hexabee-logo.svg` is mostly empty space.** The artwork occupies
  1037x352 inside a 1500x1000 viewBox, so a rendered height of 160px draws a mark
  about 56px tall. Raising the height adds padding, not logo — which is why it
  "would not get bigger". `hexabee-logo-tight.svg` is the same file cropped to the
  content, used where the mark should fill its box. Do not crop the original: it
  is used in roughly sixteen places, including the portal chrome and the PDF
  receipt template, all sized against that padding.
- **The country dropdowns list only where a payment can actually complete**: GB on
  Stripe, and LT/LV/EE/FI/PL on Montonio. The list used to run to 30 countries, so
  a merchant could pick Germany, finish onboarding and land on a checkout with no
  working method — the failure arriving long after the choice that caused it. Both
  lists (`onboarding/page.tsx`, `settings/page.tsx`) keep a saved country that is
  no longer offered selectable, or the select would fall back to its first option
  and silently move that merchant to the UK on their next save.

## Environment variables

`MERCHANT_JWT_SECRET` (**mandatory — no fallback, app must fail to boot**),
`DATABASE_URL`, `BACKEND_URL` (Node payments backend), `ADMIN_API_BASE_URL`
(FastAPI), `INTERNAL_SERVICE_TOKEN`, `BACKEND_API_TOKEN`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_STRIPE_ENV`, `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_CHECKOUT_URL`, `NEXT_PUBLIC_INBOUND_DOMAIN`.

Montonio rail: `MONTONIO_SECRET_KEY`, `MONTONIO_ACCESS_KEY` (webhook only — the
Node backend holds its own copies for creating orders).

`NEXT_PUBLIC_*` values are baked in at build time — after changing one, redeploy
(a staging branch build will not pick up a variable added after it was built).
**Server-side variables need a redeploy too.** A deployment carries the env it
was created with, so adding a variable in the Vercel dashboard does nothing for
deployments already running. This cost an afternoon on the Montonio webhook: it
returned 500 `Not configured` on every delivery while the key sat in the
dashboard, and only a fresh build picked it up. Push an empty commit if there is
nothing else to ship.

## Montonio webhook

`/api/payments/webhooks/montonio` — **the token arrives as a query parameter,
`?order-token=<jwt>`, with an empty POST body**, not as `{ orderToken }` in JSON
the way Montonio's docs example shows. Verified against real sandbox deliveries
(User-Agent `MontonioWebhooks/1.0`). Read both sources and never let body parsing
throw. The JWT signature is the only authentication — there is no shared header —
so verification plus an `accessKey` check is mandatory.

`merchantReference` is `merchant_payments.id`, generated in `/api/payment/montonio`
*before* the order is created, because Montonio requires it unique per store and
an invoice number repeats across retries. It is matched on the primary key, which
is a `uuid` column: a reference of any other shape throws in Postgres, so the
handler shape-checks it and acknowledges anything that is not ours. A 500 here is
never harmless — Montonio retries the same token until it expires.

`senderIban` and `senderName` come back **null** on real bank payments. They are
not a reconciliation fallback; the reference is all there is.

**The webhook counts payment-link uses**, because nothing else can: Stripe passes
the link's short id through session metadata, but Montonio's token carries only
its own fields, so `/api/payment/montonio` stores it on
`merchant_payments.payment_link_short_id` and the webhook posts to
`/api/plugin/payment-links/{short_id}/increment`. It fires only on the delivery
that actually flips the row (`UPDATE … WHERE status <> 'paid'`) — Montonio
redelivers the same token until it expires, and a counter that moved once per
delivery would read four uses for one payment. Failing to count never fails the
webhook: a settled payment must not turn into a retry loop over a counter.

## Verifying changes

`MERCHANT_JWT_SECRET=x npx tsc --noEmit` and `MERCHANT_JWT_SECRET=x npm run build`.
There are no automated tests: exercise the real flow on staging — pay page in a
browser, Stripe test card `4242 4242 4242 4242`, then check the merchant
dashboard and the invoice status.
