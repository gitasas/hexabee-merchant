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

**Stripe payments must never require the merchant IBAN** — it is display-only.
The Connect account is resolved server-side from the slug in
`/api/payment/stripe`; the client must not send it.

## Fee mode

`merchants.fee_mode` (`merchant` | `payer`) drives POS, the static pay link and
invoice payments; payment links carry their own choice, baked into the amount at
creation — never gross up a payment-link amount again. Gross-up must mirror
`calculateHexabeeFee` in the parent repo's `index.js`: standard tier 2% + 20
minor units (GBP) / 2.9% + 25 (other currencies); iDEAL and bank transfer 1%
of the amount with a 50-minor-unit minimum; BNPL (Klarna/Afterpay/Billie)
6.9% + 30 minor units.

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

## Environment variables

`MERCHANT_JWT_SECRET` (**mandatory — no fallback, app must fail to boot**),
`DATABASE_URL`, `BACKEND_URL` (Node payments backend), `ADMIN_API_BASE_URL`
(FastAPI), `INTERNAL_SERVICE_TOKEN`, `BACKEND_API_TOKEN`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_STRIPE_ENV`, `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_CHECKOUT_URL`, `NEXT_PUBLIC_INBOUND_DOMAIN`.

`NEXT_PUBLIC_*` values are baked in at build time — after changing one, redeploy
(a staging branch build will not pick up a variable added after it was built).

## Verifying changes

`MERCHANT_JWT_SECRET=x npx tsc --noEmit` and `MERCHANT_JWT_SECRET=x npm run build`.
There are no automated tests: exercise the real flow on staging — pay page in a
browser, Stripe test card `4242 4242 4242 4242`, then check the merchant
dashboard and the invoice status.
