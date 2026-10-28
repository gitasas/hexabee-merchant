# hexabee-merchant - agent context

Next.js app serving two audiences from one codebase:

- **Merchant portal** - `app/(merchant-portal)/merchant/*` at merchant.hexabee.buzz
- **Public checkout** - `app/pay/*`, `app/pay-preview` at checkout.hexabee.buzz

Part of the HexaBee project (see the parent repo's `CLAUDE.md` for the whole
architecture). This is a **separate GitHub repo**: commit and push here as well.
`main` = production, `staging` = staging (`git push origin main:staging`).

Keep this file current when you add a feature or learn a non-obvious rule.

## Pages

Portal (all require a merchant session): `dashboard`, `invoices`,
`payment-links`, `payment_methods`, `settings`, plus `login`, `register`,
`onboarding`. Portal chrome (sidebar/topbar/tabbar) lives in `PortalShell.tsx`
- add new nav links to its `NAV` array (and a label to both languages in
`i18n.tsx`). **Chrome is applied by the `(portal)` route-group layout, never
by pathname branching** - layouts are not re-rendered on client-side
navigation, so a pathname branch leaves stale chrome after login/logout (this
bug shipped once). New authenticated portal pages go inside
`merchant/(portal)/`; bare pages (auth, onboarding) stay outside the group.

**Settings is one page per section, not one sheet (2026-10-19).** It was a
single 1,700-line component rendering nine cards: **4,934px tall at 1440x900,
5.5 screens, and 6,794px on a phone, 8.4 screens.** The Tele2 key field sat
3.7 screens down on a desktop and 5.6 on a phone, which is why a merchant on
a call could not find it; three buttons on that page all read "Save settings"
and each saved something different.

- `settings/sections.ts` is the ordered list, read by the sub-nav, the index
  and the back link. **Slugs are English while labels translate** - a slug is
  an address that gets bookmarked and pasted to a merchant ("open this and
  paste the key there"), so it must not change with the language toggle.
- Six sections: `business`, `connections`, `sending`, `links`, `options`,
  `team`. Each fetches what it needs rather than sharing one giant state.
- **The section menu lives in `PortalShell`'s own sidebar, nested under
  Settings and shown only while Settings is open.** Not a second column
  beside the content - two menus on one screen is two places to look for the
  same thing - and not always expanded, which would make the shortest list in
  the portal the longest. On a phone the sidebar is a five-icon tab bar with
  no room to nest, so the index page is the menu and `.hb-backlink` is the
  way out of a section.
- **The index carries the status chips** - can I take a payment, can I send a
  text - because that answer used to require scrolling through three separate
  cards. The payment chip asks the merchant's **rail**, never Stripe alone.
- ⚠️ **Yellow means "something still needs doing".** `hb-btn primary` is used
  only while a task is unfinished: no Tele2 key yet, or a field differing
  from what is stored. A form that is already filled in gets a plain button,
  which is also how the colour answers "have I got unsaved changes?" - a
  question none of these pages could answer before. Buttons stay **enabled**
  when clean; pressing one simply saves the same values.
- **Tele2 credentials sit with the Montonio keys under `connections`**, not
  because both are "API keys" - grouping by technical kind is how a page ends
  up making sense only to whoever built it - but because both are the same
  job: a one-time setup, by the owner, pasted from a third party, that either
  works or does not. The SMS **message text** is daily work and stays in
  `sending`, which carries a status line and a link when no key is stored.

**The portal is bilingual (EN/LT).** All merchant-facing UI strings live in
`app/(merchant-portal)/i18n.tsx` (`useLang()` hook, `LangProvider` wraps every
branch of `merchant/layout.tsx`, `LangToggle` renders the EN|LT switcher).
Never hardcode English text in a portal page - add the string to **both** the
`en` and `lt` dictionaries (`lt` is typed as `Dict = typeof en`, so a missing
key fails the build). Counts use the `ltPlural` helper; dates use `t.locale`.
The choice persists in `localStorage` (`hb_lang`) and defaults to LT for
Lithuanian browsers.

The **public checkout is bilingual too**, with its own payer-facing dictionary
in `app/pay/i18n.tsx` (`usePayLang`, `PayLangProvider`, `PayLangToggle` - the
toggle is self-styled because the public pages load no portal CSS). It covers
`/pay/[slug]` (invoice, POS and payment-link screens), `/pay/success`,
`/pay/failed`, `/payment-success` and `/pay-preview`, and shares the `hb_lang`
storage key. **The downloadable PDF receipt follows the toggle too** (fixed
2026-09-23) - it was English on every payment until then, whatever the payer had
selected, because jsPDF's built-in fonts are WinAnsi and could not render
Lithuanian diacritics or the euro sign. `app/payment-success/receipt-font.ts`
embeds a subset of Noto Sans; its header documents the regeneration command and
the jsPDF trap that made an earlier subset fail to load. **`npm run
verify:receipt-font` proves the font still works** - jsPDF parses an embedded TTF
inside a PubSub handler and swallows whatever it throws, so a broken font passes
`addFont`, passes the build, and dies on the payer's first click. The page now
falls back to ASCII on Helvetica if that ever happens, and says so in the console.
Receipt strings live under `t.receipt`, separate from `t.successPage`, because a
printed document says different things than a screen - and because ✓ has no glyph
in Noto Sans, so the PDF spells its status out in words.

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

**Stripe payments must never require the merchant IBAN** - it is display-only.
The Connect account is resolved server-side from the slug in
`/api/payment/stripe`; the client must not send it.

## Fee mode

`merchants.fee_mode` (`merchant` | `payer`) drives POS, the static pay link and
invoice payments; payment links carry their own choice, baked into the amount at
creation - never gross up a payment-link amount again. Gross-up must mirror
`calculateHexabeeFee` in the parent repo's `index.js`: standard tier 2% + 20
minor units (GBP) / 2.9% + 25 (other currencies); iDEAL, bank transfer and
Pay by Bank 1% of the amount with a 50-minor-unit minimum; BNPL
(Klarna/Afterpay/Billie) 6.9% + 30 minor units.

The 1% tier is `PCT_MIN_METHODS` in `app/pay/[slug]/page.tsx` - it must stay in
sync with the matching branch of `calculateHexabeeFee`. A method priced there
but missing from the set gets grossed up at the card rate, so the payer is
overcharged while the badge shows 1%.

**The accounting export and the dashboard count the Montonio platform fee.**
Every paid Montonio payment carries HexaBee's €0.39, invoiced monthly rather
than deducted; both report it so the merchant has something to reconcile the
invoice against (both reported 0 until 2026-09-11). The export's `Fee billing`
column says `deducted` (Stripe) or `invoiced monthly` (Montonio) because `Net`
means "what landed" on one rail and "what you keep after our invoice" on the
other. `merchant_payments.payer_fee` records what the payer was charged on top
(€0.49 or €0.39 by fee mode), so `Invoice amount` = `Gross` − `Payer fee` is
exact; on Stripe those two columns stay blank rather than guess at a gross-up.

**Fee mode applies on the Montonio rail too**, and none of the above maths does.
There the fee is flat, it is €0.49, and `/api/payment/montonio` decides - nowhere
else - whether the payer is charged it at all:

- `fee_mode = 'payer'` → the payer pays the invoice **+ €0.49**.
- `fee_mode = 'merchant'` → the payer pays the invoice and **nothing else**.

HexaBee invoices the merchant €0.39 per paid invoice monthly either way, and
Montonio invoices them €0.10, so the setting never touches our revenue - only
whether the merchant already collected it from the payer. **Corrected 2026-09-24:**
until then the payer was charged €0.39 even in merchant mode, so "I cover the fee"
still put a fee on the customer's screen. The route re-reads the payment link server-side rather
than trusting the browser, because the amount charged must not be decidable there.
Nothing is baked into a Montonio amount, so a fixed-amount link stores the invoice
amount and the pay page must never gross it up. Three checkout surfaces display the
total and all three go through `montonioFee()` in `app/pay/[slug]/page.tsx`
(pay-link screen, POS screen, invoice screens) - the number on the button has to be
the number the route charges.

**The counter fee can differ from the invoice fee (2026-09-30).**
`merchants.pos_fee_payer_max` is an amount above which the merchant absorbs the
€0.49 rather than the customer, and it applies to **POS and tap payments only**.
`montonioCounterFee()` in `app/pay/methods.ts` is the display side and mirrors
the branch in `/api/payment/montonio` exactly; `montonioFee()` stays for
invoices and payment links, which ignore the threshold. Four callers had to
move: the till screen (recomputed as the operator types, or it would quote a fee
the payment will not charge), `/api/pos/request`, `/api/pos/tap/[slug]`, and
`/api/pay/[slug]`, which now returns the threshold so the till can quote at all.
Varying by amount is legal where varying by method is not - see the parent
repo's `CLAUDE.md`.

## One method catalogue for every checkout surface

`app/pay/methods.ts` holds the method lists, the visibility rules
(`visibleMethods`), the Montonio fee (`montonioFee`) and the Stripe gross-up
maths. `/pay/[slug]` (invoice, POS and payment-link screens) and `/pay-preview`
(where the Gmail extension sends payers) all import from it. The preview kept
its own copy until 2026-09-11 and had drifted four ways at once: no filtering by
the merchant's toggles, no wallet row, no Stripe gross-up, and "Pay" on a rail
about to add a fee. **It is a real checkout, not a demo** - a payer arriving from
Gmail must see exactly what one arriving by link sees. Add a method or change a
fee there, and nowhere else.

**`/payment-success` decides what to say from the payment's status, never from
the URL.** Montonio sends a payer who cancelled at the bank to the same return
URL as one who paid, and the page used to greet both with "Payment successful -
Paid ✓" and a receipt. Three states: paid; still confirming (a bank notification
can trail the redirect by a few seconds, so it polls); and not paid once the polls
are spent, with a link back to the pay page carrying the reference only - the
charged total already contains the fee, so prefilling it would add the fee twice.

**The receipt itemises the fee, because the payer's accountant needs a line for
it.** A Montonio receipt (`/api/payment/receipt/[paymentId]`) returns
`payer_fee` and `invoice_amount` from `merchant_payments.payer_fee`, and both
the page and the PDF show "Invoice amount / Payment link fee / Total paid" with
the merchant (and their company code) as **Paid to**. The footer states that the
fee is a service charge received by the merchant and that HexaBee receives no
funds from the payer - which is the accounting truth on this rail: all of the
€60.49 lands with the merchant, who books the €0.49 as service income against
HexaBee's €0.39 and Montonio's €0.10 invoices. A merchant (Jumera, 2026-09-16)
asked how *their client* would account for the fee; until then the receipt
showed one total and nothing to book it against. Rows older than the column
have `payer_fee = null` and fall back to the single-amount layout; Stripe
sessions do too, since their gross-up is baked in and not recorded.

**`<html lang>` follows the payer's language toggle** (`PayLangProvider`). The
root layout hardcodes `en`, and Montonio's checkout reads its language from
that attribute, so every Lithuanian payer was handed an English bank page.

## Payer inbox - what a bare pay link shows

`/pay/<slug>` with nothing after it used to open an empty amount/reference
form, because a click carries no amount, no reference and no identity. Since
2026-09-16 it opens the **payer inbox** (`app/pay/PayerInbox.tsx`) whenever
the merchant has ever BCC'd an invoice (`uses_ledger` on `/api/pay/[slug]`):
the payer enters the address the invoice was sent to, a six-digit code
proves they can read it, and the page lists their unpaid invoices from
`merchant_invoices` - for this merchant first, then every other HexaBee
merchant that invoiced the same address. "Pay" is a link to
`/pay/<slug>?r=<number>`, the same screen a `?a=&r=` template link opens, so
nothing downstream changed. `/mano` is the same inbox with no merchant.

Why it exists: the merchant's accounting software decides whether `?a=&r=`
can go into an email at all (Rivilė needs a programmer, Centas cannot), and
the Gmail extension only helps payers who installed it. BCC plus a bare link
works from any program and any mail client on either side, which is the
product's whole claim. It is the first brick of a payer login - history,
receipts and financing offers belong on the list screen later.

Mechanics, and where each piece lives:

- `POST /api/pay/me/identify` checks the ledger holds *something* for the
  address before asking the backend to send a code. Saying "no invoices for
  this address" is deliberate - an invoice is no secret to its recipient, and
  it stops someone invoiced at a colleague's address waiting on an empty list.
- Codes are issued, hashed, rate-limited (3 per 10 min) and verified (5
  guesses, 10-minute life) in the **Python backend** (`app/payer_codes.py`,
  `POST /api/plugin/payer/{code,verify}`, table `payer_codes`), because that
  is where Resend already sends mail. This app only relays.
- A verified payer gets the `hb_payer` cookie (`lib/payer-auth.ts`, **12
  months** since 2026-10-07, raised from 30 days). Thirty days did not match
  what these invoices are: an association bills **once a year** and a school
  monthly, so nearly every payer would have re-requested a code before their
  next invoice - the exact friction the inbox exists to remove. The length is
  **one constant**, `SESSION_DAYS`, because the cookie `maxAge` and the JWT
  expiry both encode it and changing one alone signs the payer out silently
  while the browser still sends a cookie. It authorises no payment - the bank
  app authenticates every one - so SCA does not reach it; the trade is a shared
  device keeping a year of access to that payer's invoices, which is what the
  logout button is for.
  It is signed with `MERCHANT_JWT_SECRET` like the merchant session, so its
  token carries `kind: 'payer'` and `verifySession` in `merchant-auth.ts`
  refuses it - a payer token must never open the portal.
- `GET /api/pay/me?slug=` returns only rows with an invoice number: without
  one the pay page could not look the invoice up, so it could not be paid
  from here anyway.
- The manual form is one click away in both directions (`showManual`); a
  merchant with no ledger rows never sees the inbox at all.
- **Settings offers the plain pay link as a QR** ("QR code for your invoices",
  2026-09-17): copy-as-image (`ClipboardItem` PNG - falls back to a download
  where the browser refuses) or download PNG, for the invoice template or the
  email body. A prospect's clients "are wary of clicking links"; a scan opens
  the very same page, inbox included. The POS QR (`?mode=pos`) is a different
  thing - it asks for an amount and is for counters, not invoices.
- **The referral ask lives on `/payment-success`, not on the checkout page**
  (2026-10-07). `loopPrefix` used to render under the payment buttons on
  `/pay/[slug]`, where it asked the payer to think about our business while
  they were trying to settle theirs - next to the single action that page
  exists for. It now appears **only when `isPaid`**, under the receipt, where
  the payer has just succeeded in about fifteen seconds and has something to
  recommend. The button uses the **Web Share API** - the payer is almost always
  on a phone, having just paid in their banking app, so the native share sheet
  is the shortest path to whoever they have in mind - and falls back to the
  clipboard on desktop. Neither failing shows an error: nothing on a receipt is
  worth an error. The old `loopPrefix`/`loopLink` strings were deleted rather
  than left unused, so nobody re-attaches the line to the checkout page because
  the string still exists.
- **The pay page no longer advertises the Gmail extension** (removed
  2026-09-16 with the `extHint*` strings and `hasExtension()`). The extension
  still works for anyone who has it - `?payload=` is still honoured - but the
  inbox replaced it as the answer to "the link carried nothing", so nothing
  points payers at the Web Store any more.

## POS v2 - the till enters the amount, the customer taps

`?mode=pos` used to redirect **the merchant's own device** to the checkout.
That works for a Stripe card on a tablet and not at all on the Montonio rail,
where the payer authenticates in their own banking app - handing the customer
the merchant's phone was never a checkout. Rebuilt 2026-09-23:

1. The till opens `/pay/<slug>?mode=pos`, enters the amount and presses
   **"Show to customer"** → `POST /api/pos/request` creates a `pos_requests`
   row and the screen turns into the waiting state (amount, QR, "waiting").
2. The customer taps a **static NFC sticker** or scans that QR → `/tap/<slug>`
   → `GET /api/pos/tap/<slug>` serves this merchant's newest live request →
   they see the amount (**never type it**) and pick a method.
3. `/api/payment/montonio` takes `pos_request_id`, claims the request and
   records `payment_id`. The fee is still decided in that route and nowhere
   else.
4. The Montonio webhook flips `pos_requests` to `paid`; the till polls
   `GET /api/pos/request?id=` every 2 s and shows **"Paid ✓"** with the amount
   that actually arrived - so a mismatch is visible at the counter instead of
   being found in the books.

**The sticker URL is static on purpose.** The amount lives in the request, not
in the tag, so one ~€1 NTAG sticker lasts forever and never has to be
re-programmed. Settings shows this link separately from the till QR: the till
QR opens the merchant's own screen, the sticker link is what the customer taps.

**No merchant session on `/api/pos/request`** - the till may be any device at
the counter, and the pay page it lives on has never required one. What bounds
the abuse: every route leads to money landing in *this merchant's* account;
exactly one request is live per merchant (a new one supersedes the last, which
is also why a corrected typo cannot be paid); requests die after ten minutes;
and the confirmation shows the paid amount. If tills ever become shared across
staff, a session is the next step, not a rewrite.

Works on the Stripe rail too (`/tap` grosses up with `grossUpAmountStr` when
the fee mode says payer), but it was built for Montonio, where it is the only
way a counter payment can work at all. Fits €50+ tickets - €0.49 on a €3 coffee
is 16 %.

## Invoice ledger

`merchant_invoices` is written by the Python backend from BCC'd invoices.
This app reads it (`/api/merchant/invoices`), triggers reminders
(`/api/merchant/invoices/[id]/remind` → internal-token proxy) and marks rows
paid from the Stripe webhook by matching the reference. **Wrap ledger queries in
try/catch** - the table may not exist yet in a fresh environment; degrade to an
empty list instead of a 500.

**Settling an invoice paid outside HexaBee (2026-09-30).** A bank transfer into
the merchant's own account never reaches us, so the row stayed `issued` and the
dunning loop kept chasing someone who had already paid. `POST
/api/merchant/invoices/[id]/paid` closes it (`DELETE` reopens), and the Invoices
table grew a "Settle" column for it. `/invoice-paid?t=<claim_token>` is the
payer's end of the same problem, reached from the reminder email.

- **Marking paid writes only `merchant_invoices`.** No `merchant_payments` row is
  created: this is money HexaBee never handled, and it must not reach the
  dashboard's takings or our monthly invoice to the merchant. `paid_source`
  (`hexabee` | `manual` | `centas` | NULL for older rows) keeps them apart, and
  both webhooks stamp `'hexabee'`. The export prints it as **Paid by**.
  - ⚠️ **Ask `lib/paid-source.ts`, never `paid_source === 'manual'`.** When
    the Centas reader added a third value on 2026-10-23, the accounting CSV
    and the Invoices page were both still a two-branch test, so every row
    closed from a merchant's own accounting reported as **"HexaBee"** - to
    their accountant, claiming a payment we never handled. `paidSourceKey`,
    `hexabeeProcessed` and `canReopen` hold that decision once; the CSV's
    labels are a complete `Record<PaidSource, string>`, so a fourth value
    fails the build rather than defaulting to "HexaBee".
  - **NULL reads as `hexabee` by reasoning, not as a fallback:** before the
    column existed, only a webhook could close an invoice.
- **`DELETE` refuses anything but `paid_source='manual'`** - a webhook-settled
  invoice records real money, and reopening it would restart the reminders.
- **A payer claim sets `payer_claimed_at`, never `status`.** It stops the
  automatic reminders (the backend filters on it) without asserting payment. The
  portal shows it as "Customer says paid" plus a banner, because it is the one
  row on that page that needs the merchant to go and look at their bank.
- **`POST /api/merchant/invoices/[id]/resume-reminders` undoes a false claim**,
  clearing it and resetting `reminders_sent` so the loop really can run again -
  clearing alone leaves a late claim permanently silencing the invoice. It keeps
  `last_reminder_at`, so nothing fires the same afternoon.
- **`GET /api/pay/invoice-paid` is read-only and `POST` performs the claim.**
  Mail clients prefetch links, so a mutating GET would claim invoices for payers
  who never clicked.
- **The Invoices page derives the outstanding total from the rows it is showing,
  never from the response.** `/api/merchant/invoices` used to compute it and the
  page held it in state, so the moment a merchant settled an invoice the yellow
  box still showed its amount and called it unpaid - the table had updated in
  place and the total had not. Any figure summarising rows that the page mutates
  locally has to be derived on render, or it will disagree with what is on
  screen. It also shows a zero rather than vanishing when the last invoice is
  settled, which is exactly when the merchant is looking for confirmation.
- **A disabled action must say what is missing, by name, as visible text.** The
  "Send reminder" button is dead for a row whose PDF gave no invoice number,
  amount or payer, and a generic tooltip left the merchant with nowhere to go -
  tooltips on a disabled button do not open on a touch screen at all. The row
  now prints "Missing: invoice number, amount" under the button.
- The three columns arrive by backend migration, so `/api/merchant/invoices`
  drops each one individually on a missing-column error (`OPTIONAL`) rather than
  falling through to the catch-all that answers "no invoices at all".

**The ledger is grouped by what a row needs doing to it (2026-10-16), and it
had to stop hiding rows first.** Baltijos licėjus asked for paid invoices to be
coloured light green so they could be skipped. The colour is there, but it was
the smaller half of the problem:

- ⚠️ **`/api/merchant/invoices` ran `LIMIT 200` with no pagination and nothing
  on screen saying so.** Kauno Valdorfo BCC'd 432 invoices in one day and saw
  200; worse, the outstanding total is derived from the rows, so **the yellow
  box under-reported the debt** by everything past the limit. Any sort or
  filter built on top would have inherited the lie - "12 unpaid" while 40 were
  unpaid and 28 were never fetched.
- The route now loads **every unpaid row with no limit** (that is the work, and
  it is bounded in practice because rows stop being unpaid) and the **newest
  300 paid ones**, plus a `paidSummary` counted in SQL. The summary is the one
  figure on this page that does not come from the rows, and it exists so the
  page can say "showing the newest 300 of 812" instead of quietly showing a
  slice. Everything else stays derived from the rows on screen - see the note
  above about the total that went stale when a merchant settled an invoice.
- Groups, in order: `unreadable` → `claimed` → `overdue` → `noRecipient` →
  `unsent`, then collapsed: `scheduled` → `paid` → `nothingToPay`. The order is
  what blocks what, not the date: an unreadable row can never be matched to a
  payment, and "not sent" is last because it is one batch button rather than N
  decisions.
- ⚠️ **`claimed` must never be folded into the paid group.** `payer_claimed_at`
  means the payer said they paid, so the reminders stopped - but nobody saw the
  money and `status` is still `issued`. It is the one row that needs the
  merchant to open their bank, so green would bury it and grouping it with the
  overdue rows makes it look like an ordinary debtor.
- ⚠️ **`unsent` asks `source`, never `sent_at` alone (fixed 2026-10-28).** A
  BCC row is emailed by the merchant from their own mail client, so nothing
  ever stamps `sent_at` on it - the `Invoice` type has said "NULL for every BCC
  row forever" since the column existed, and `groupOf` simply never asked. Every
  BCC invoice therefore sat in "not sent yet" permanently, and the backend's
  batch send filters `source = 'upload'`, so the single button offered against
  that group could not act on one row of it. At 432 BCC'd invoices in a day that
  is the whole "needs attention" list, unclearable. `awaitingSend()` now
  requires `source` to be `'upload'`; a NULL source (column unreadable) keeps
  the old test rather than guessing, because guessing `'bcc'` would silently
  empty the group of real work and guessing `'upload'` would restore the bug.
  Found by a merchant watching a demo, not by a type check - the types were
  right and the question asked of them was wrong.
- Headers and bands are ordinary `<tr>`s with `colSpan`, so the column widths,
  the hairlines and the table-to-cards mobile rule all keep working with no
  second layout. `groupOf` is the single place a row's group is decided.

**An invoice can be read perfectly and still owe nothing (2026-10-02).** A
merchant who applies the payer's prepayment on the invoice itself prints
`Mokėti: 0,00` under a total of 1043,40, or a negative when the payer overpaid.
`lib/invoice-amount.ts` holds the two predicates - `isPayable` and
`isSettledToNothing` - and every surface asks them rather than re-deriving:

- `/api/pay/[slug]/invoice-lookup` returns `nothing_to_pay`, and `/pay/[slug]`
  hides the payment methods and says so. The amount alone would have looked like
  an ordinary cheap invoice, and the payer would have been charged the flat fee
  on top of nothing.
- ⚠️ **A new drop must clear everything the last drop set (2026-10-06).**
  Dropping a settled invoice and then one this parser could not read left the
  previous reference in the field and its "nothing to pay" note on screen
  beside a live payment button - three answers from two invoices at once.
  Clearing inside each branch cannot fix that, because a branch knows what it
  is about to set and not what the last one did, so `handleInvoiceFile` clears
  the amount, reference, note, `nothingToPay` and both purposes **where the
  drop begins**. Add a field a drop can fill, and clear it there too.
- ⚠️ **`maxOutputTokens` was 2048 in `/api/invoice/parse` until 2026-10-06** -
  the exact ceiling that truncated `index.js` on 2026-10-05, raised there and
  never raised here, with a 6000-character text window against that file's
  15000. On VAL24535 (47 line items, 8591 characters of glyph-split text) the
  reply came back unparseable, the call fell through to the rules, which find
  nothing on such a PDF, and the response read every field `null` with
  `engine: "regex"`. **`engine` is the tell**: `regex` on an invoice the model
  should have read means the call failed, not that the document was poor. Now
  8192 and 15000, and VAL24535 reads 434.80 / VAL24535 / `1070 Jonas Darašas`.
  A lesson learned in one parser has to be carried to the other one the same
  day; these two are the pair this repo keeps getting wrong.
- ⚠️ **The dropped-PDF path did not ask the predicates, and "every surface"
  above was wrong until 2026-10-06.** `handleInvoiceFile` filled the amount on `Number(amount) > 0`,
  so a zero or a credit fell into the "could not find the amount" branch. Two
  consequences, the second serious: the amber "amount not found" line sat
  directly under the green "invoice read - details filled in below" box,
  contradicting it, and **`manualAmount` kept whatever the previous invoice had
  left in it**. Dropping NUOM-2691 (payable `0.00`) after VAL24654 therefore
  offered **Pay €317.76** to a payer who owed nothing. Found by dropping a real
  invoice on the production pay page, not by reading the code.
  - It now asks the same two predicates and reaches the same three states the
    ledger lookup does: settled to nothing (amount cleared, `nothingToPay`,
    note under the reference), payable (amount filled), or genuinely unreadable
    (amount **cleared**, error shown). Clearing in that last branch matters too
    - the message tells the payer to type the amount, so leaving the last
    invoice's number in the field invites them to pay it.
  - The green box says `dropDonePartial` when an error is showing, so it stops
    claiming fields were filled while the line below says they were not.
  - The `?a=` branch keeps its `> 0` test and is fine: it runs once on mount, so
    there is no earlier value to leave behind, and a link carrying `?r=` has the
    ledger lookup behind it. The hazard was stale state inside one session,
    which only the drop handler creates.
- `PayerInbox` still lists the invoice - it is the payer's statement, and a line
  that vanished would alarm more than it explains - but with no **Pay** button.
- The Invoices page keeps it out of `unpaidCount` and `awaitingPayerCount`,
  disables **Send reminder** and says why. It was already out of `outstanding`,
  which only ever summed amounts `> 0`.
- The status stays `issued`, never `paid`: nobody paid anything, and `paid`
  would put it in the dashboard's takings and in HexaBee's monthly invoice.

## SMS to customers with no email (2026-10-15)

Some customers have no email address at all - in a garden association that is
why paper invoices still go out - and the payer inbox cannot serve them,
because it verifies by email. They get the same pay link by text, carrying
`?r=<invoice number>` so the pay page reads the amount and the payment purpose
from the ledger and nothing is typed.

This app holds the editor, the batch screen and the price; the Python backend
(`app/sms_sender.py`) does the sending. Settings has a card for the merchant's
own Tele2 credentials and message; the Invoices page shows a second batch card
beside the email one, and a **Remind by SMS** button on any row that has a
number.

- ⚠️ **`smsSegments` in `lib/sms-template.ts` is a second implementation of
  `segments()` in `sms_sender.py`**, and it has to be - the editor prices the
  message as the merchant types, which cannot be a request per keystroke. This
  is the exact kind of pairing this repo keeps getting wrong, so: `npm run
  verify:sms` pins 14 boundary cases and checks the default templates are
  byte-identical to the Python ones, `hexabee-backend/scripts/check_sms.py`
  pins the same cases there, and the editor asks
  `/api/merchant/sms/preview` once typing settles and **renders a red mismatch
  warning** if the two disagree. Run both after touching either file.
- ⚠️ **The price, not the character count, is what the card shows.** One
  Lithuanian letter moves the message from GSM-7 (160 characters a segment) to
  UCS-2 (70), so a polite Lithuanian sentence costs double. Nobody reads
  "UCS-2" and thinks about money; everybody reads a doubled euro figure. The
  defaults are diacritic-free as a starting point, and the merchant may
  overwrite them - Gytis's call: do not shorten the link, let them pay for the
  extra segments if they want the words.
- **The monthly allowance is printed above the button, every time.** Tele2 cap
  an account at 10 000 a month and have **no endpoint to query what is left**,
  so the figure comes from the backend counting its own rows. A number nobody
  looks at until it runs out is the Resend cliff with extra steps.
- **`{link}` is required** - `/api/merchant/sms-settings` refuses a template
  without it. A text telling someone they owe money with no way to pay it is
  worse than sending nothing: it costs the merchant and confuses the reader.
- **The token is write-only.** `GET` answers `hasToken`, never the value, and
  an absent `token` key means "leave it alone" while an empty string means
  "remove it" - otherwise a merchant saving their message text would silently
  lose their credentials. Owner-only, like the bank details; the message text
  is staff-editable, like the letter template.
- ⚠️ **The sender name must be the one Tele2 activated, and the field used to
  suggest otherwise (2026-10-19).** Its placeholder was the merchant's own
  `business_name`, which is the wrong answer: Tele2 accept only a sender name
  they have themselves purchased and activated, and refuse everything else
  with `Invalid sender name provided, verify that SenderName was acquired and
  still active`. SB „Žaluma" hit exactly that on a live call on 2026-10-16 -
  their own name failed and only the activated one worked. The placeholder is
  gone and `smsSenderNote` says the name must match character for character.
  A field that guesses an answer the merchant cannot verify on that screen is
  worse than an empty one. `smsTokenWhere` also says the key is one long line
  **inside** the file Tele2 send, not the file itself - which is the question
  that merchant actually asked.
- **`sms_sent_at` is independent of `sent_at`** and both are in `OPTIONAL` in
  `/api/merchant/invoices`. A customer with no address gets the text and never
  a letter, so one NULL must not read as "we have not contacted them".
- An invoice settling to nothing is **never** texted, though it is still
  emailed - see the predicates below.

## API keys expire, and the portal now says when (2026-10-23)

Both third-party keys on `settings/connections` stop working on a date, and
`expiryNote()` on that page renders both. **It prints the number of days, not
only the date** - `2026-11-22` asks the reader to do subtraction and nobody
does it - and turns red (`.hb-note-warn`) at 21 days, which is enough notice
to ask a bookkeeper for a new key before it is an emergency.

⚠️ **The two failures are not alike, and that is why one of them matters far
more.** An expired **Tele2** key fails a send loudly: the batch stops and says
so. An expired **Centas** key answers `{"success":0}`, which the reader treats
as "no documents", which cannot be told apart from "nobody owes anything" - so
nothing closes, no screen reports a fault, and reminders quietly resume
reaching people who have already paid. On the Centas card the date is the only
warning there will ever be.

- **Centas** (`centas_token_valid_until`) comes from Centas's own `/verify`,
  called by the backend **before the key is stored**. An unproven key is
  refused rather than saved, because once it is in the database a wrong key and
  an empty company look identical.
- **Tele2** (`tele2_token_valid_until`) is **decoded out of the key**, which is
  a JWT - `lib/jwt-exp.ts`, mirrored by `token_expiry()` in `sms_sender.py`
  because the admin panel writes this column too. Ten identical cases are
  pinned by `npm run verify:sms` and `scripts/check_sms.py`, beside the
  segment pair. Tele2 said on the telephone that their keys do not expire; SB
  „Žaluma"'s expires on 2027-01-31. ⚠️ `smsTokenWhere` had promised since
  2026-10-15 that "we will tell you before yours runs out" with **nothing
  behind it** - now true, and the sentence says what actually happens.
  - **The signature is never verified, and must not be.** Tele2 sign with a
    secret we do not hold; this reads a date off our own merchant's own
    credential to print it. A forged `exp` misleads only its forger.
  - ⚠️ An `exp` given in **milliseconds** is refused, not believed: it lands
    in the year 56000 and prints as a comfortable far-future date, the one
    answer worse than none. Both sides bound the year to 2020-2100.
  - It is written **only when the key is**: a new key brings its own date,
    clearing the key clears the date, and a save that does not touch the key
    must not touch the date. The portal re-fetches after storing a key,
    because the date is only knowable once the backend has decoded it - the
    one place a stale value here would actively mislead.
- Both key fields are **owner-only**, like the bank details.
- `/api/merchant/centas-settings` proxies both halves to
  `/api/plugin/merchant-centas`, because validation needs Centas and that is
  where `verify_token` lives. A backend 5xx is answered as "not connected" so
  this app can deploy first, exactly as `/api/merchant/sms-settings` degrades
  on a missing column.
- ⚠️ **The Centas card prints when the accounting was last read, and the
  Settings index carries a chip when it has gone stale.** This is the only
  failure on either page that reports nothing anywhere else: an expired token,
  an unreachable Centas and an empty company all answer `{"success":0}`, which
  the backend reads as "no documents", which is indistinguishable from "nobody
  owes anything". So invoices stop closing and the merchant's reminders go back
  to chasing customers who have already paid, with no error on any screen.
  - The healthy line is shown too ("last read ..."), because a warning nobody
    has ever seen in its normal state is a warning nobody trusts.
  - The **index chip appears only when something is wrong** - expired or stale.
    A fourth green badge there would bury the two that answer "can I be paid
    at all", which is what that screen is for.
  - The text says what it means for them, not that an error occurred: bank
    transfers will not close, and reminders may reach people who have paid.
- **The Centas card is gated to `business_country === 'LT'`, or to anyone who
  already has a key stored.** Centas is Lithuanian software; offering it to a
  UK merchant on Stripe is noise on the page where they look for the settings
  that decide whether they can take money. The second half of the condition
  stops a card from vanishing - and hiding a live integration - if someone
  changes their country.

`isSettledToNothing` is deliberately **not** the negation of `isPayable` - a row
whose amount could not be read is also not payable, but that is a failure to
show the merchant, not a balance to report to the payer. Same split as
"could not be read" versus "no recipient yet".

**`due_date` (2026-09-29) is the column the reminder schedule runs on**, and the
Invoices table shows it with a "N days overdue" note. It is written by the
backend, so this app only displays it - but note what that catch-all would have
done on a split deploy: ship this app before the backend migration and the
`SELECT` fails on the missing column, the catch answers "no invoices", and the
merchant sees an empty ledger with no error anywhere. `/api/merchant/invoices`
therefore retries once with `NULL::date AS due_date` when the error mentions the
column, so a pending backend deploy costs that one column rather than the page.
Keep that shape when adding further columns to this query.

## Conventions

- Styling is inline `const s: Record<string, React.CSSProperties>` per page -
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
`payment_rail` - and remember a Montonio merchant will never satisfy a Stripe
condition, so the failure is silent: they simply never see the thing.

## Onboarding completion

**"Has a Stripe account" is not the definition of a finished setup.** It was, in
six places - the `(portal)` layout and five pages - and a Montonio merchant never
has one, so every check bounced them back to onboarding from the screen that had
just told them they were done. `lib/onboarding.ts` holds the single predicate:
complete means the merchant can take a payment *on the rail they are on*, so
Stripe merchants need `stripe_account_id` and Montonio merchants need their store
keys. Use it rather than re-deriving; six copies of a rule are six chances to drift.

**The rail follows the country.** `payment_rail` is stored - the admin can set it
and the webhook reads it - but every profile save that carries a country
re-derives it in `/api/merchant/profile` (`MONTONIO_COUNTRIES` → `montonio`,
anything else → `stripe`). Until 2026-09-11 only the key-paste and the admin set
it, so a merchant who changed their country to the UK in Settings stayed on
Montonio and kept seeing methods no UK payer could use. **One exception:** a
Baltic merchant taking payments through Stripe with no Montonio store yet stays
on Stripe - that is the documented way to start while Montonio's KYC runs, and
flipping them would turn a working checkout into one with no buttons. GB always
switches: Montonio does not serve UK payers, so nothing works there until Stripe
is connected, and `isOnboardingComplete` sends them to connect it.

**`merchants.montonio_sandbox` - staging's way of onboarding without keys.**
`POST /api/merchant/montonio-sandbox` flags the row and `/api/payment/montonio`
then sends no keys, which the Node backend takes as its env sandbox store. The
endpoint refuses unless **`MONTONIO_SANDBOX_ONBOARDING=true`**, which is set on
staging only. A merchant with neither keys nor the flag is refused a payment
outright (409) - there is no silent fallback any more, because in production
that fallback would have been HexaBee holding a merchant's money.

**A Montonio merchant is put on `payer` when they first answer the country
question** (2026-09-24), because the column default is `'merchant'` and that now
means they absorb the whole €0.49 - the opposite of what every outreach letter
promises them. It happens in `/api/merchant/profile`, gated on
`onboarding_country_set` so it can only ever be the first answer; the merchant's
Settings toggle wins afterwards, and a `feeMode` in the same request wins over
both.

**Google sign-up no longer invents a business name** (2026-09-24). It used to
insert the person's Google display name into `business_name`, and every
payer-facing surface is built from that column - the payee on the pay page and
the receipt, the slug, the pay link, the QR, the BCC ledger address. The first
real merchant, a school, went live as a private individual's name on invoices to
parents. The column is now NULL until the merchant says what their business is
called, and both onboarding and Settings say in one line what the field is for.
`isOnboardingComplete` already required a name, so nothing downstream regressed;
everything that renders it already handled null. To repair a row that is already
wrong, use the admin's **Name / link** button (`PUT /api/admin/merchants/{id}/identity`)
rather than asking the merchant to correct it.

**Baltic onboarding also asks for payments per month and a phone (2026-09-30)**,
both requested by Montonio's BD contact and both forwarded with the partner
announcement in `notifyPartnerIfBaltic`. They are required in the form, written
with `COALESCE` like every other profile field so a Settings save cannot wipe
them, and deliberately **not** part of `isOnboardingComplete` - the two merchants
who registered before they existed would otherwise be thrown back into
onboarding. The announcement passes them only when present; being announced
matters more than being announced completely.

**IBAN is required off the UK**, at onboarding and in Settings, normalised to
no spaces and upper case. It is where a manual payer sends money and how
`/pay-preview` (the Gmail extension) finds the merchant on an invoice -
`WHERE iban = $1`, so a stored IBAN with spaces was never found. GB merchants
give a sort code and account number instead.

**Bank details are written only when the request carries them.** The fee-mode
and reminder toggles PUT one field each to `/api/merchant/profile`; that route
used to write `iban = $2` unconditionally, so every toggle erased the IBAN and
sort code. `touchesBank` gates the three columns now.

## Assets and country coverage

- **`public/hexabee-logo.svg` is mostly empty space.** The artwork occupies
  1037x352 inside a 1500x1000 viewBox, so a rendered height of 160px draws a mark
  about 56px tall. Raising the height adds padding, not logo - which is why it
  "would not get bigger". `hexabee-logo-tight.svg` is the same file cropped to the
  content, used where the mark should fill its box. Do not crop the original: it
  is used in roughly sixteen places, including the portal chrome and the PDF
  receipt template, all sized against that padding.
- **The country dropdowns list only where a payment can actually complete**: GB on
  Stripe, and LT/LV/EE/FI/PL on Montonio. The list used to run to 30 countries, so
  a merchant could pick Germany, finish onboarding and land on a checkout with no
  working method - the failure arriving long after the choice that caused it. Both
  lists (`onboarding/page.tsx`, `settings/page.tsx`) keep a saved country that is
  no longer offered selectable, or the select would fall back to its first option
  and silently move that merchant to the UK on their next save.

## Environment variables

`MERCHANT_JWT_SECRET` (**mandatory - no fallback, app must fail to boot**),
`DATABASE_URL`, `BACKEND_URL` (Node payments backend), `ADMIN_API_BASE_URL`
(FastAPI), `INTERNAL_SERVICE_TOKEN`, `BACKEND_API_TOKEN`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
`NEXT_PUBLIC_STRIPE_ENV`, `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_CHECKOUT_URL`, `NEXT_PUBLIC_INBOUND_DOMAIN`.

Montonio rail: `MONTONIO_SECRET_KEY`, `MONTONIO_ACCESS_KEY` (webhook only - the
Node backend holds its own copies for creating orders). `MONTONIO_SANDBOX_ONBOARDING=true`
**on staging only** - it lets any merchant run on HexaBee's sandbox store; in
production it would let a merchant settle into our account.

`NEXT_PUBLIC_*` values are baked in at build time - after changing one, redeploy
(a staging branch build will not pick up a variable added after it was built).
**Server-side variables need a redeploy too.** A deployment carries the env it
was created with, so adding a variable in the Vercel dashboard does nothing for
deployments already running. This cost an afternoon on the Montonio webhook: it
returned 500 `Not configured` on every delivery while the key sat in the
dashboard, and only a fresh build picked it up. Push an empty commit if there is
nothing else to ship.

## Montonio webhook

`/api/payments/webhooks/montonio` - **the token arrives as a query parameter,
`?order-token=<jwt>`, with an empty POST body**, not as `{ orderToken }` in JSON
the way Montonio's docs example shows. Verified against real sandbox deliveries
(User-Agent `MontonioWebhooks/1.0`). Read both sources and never let body parsing
throw. The JWT signature is the only authentication - there is no shared header -
so verification plus an `accessKey` check is mandatory.

`merchantReference` is `merchant_payments.id`, generated in `/api/payment/montonio`
*before* the order is created, because Montonio requires it unique per store and
an invoice number repeats across retries. It is matched on the primary key, which
is a `uuid` column: a reference of any other shape throws in Postgres, so the
handler shape-checks it and acknowledges anything that is not ours. A 500 here is
never harmless - Montonio retries the same token until it expires.

`senderIban` and `senderName` come back **null** on real bank payments. They are
not a reconciliation fallback; the reference is all there is.

**The webhook counts payment-link uses**, because nothing else can: Stripe passes
the link's short id through session metadata, but Montonio's token carries only
its own fields, so `/api/payment/montonio` stores it on
`merchant_payments.payment_link_short_id` and the webhook posts to
`/api/plugin/payment-links/{short_id}/increment`. It fires only on the delivery
that actually flips the row (`UPDATE … WHERE status <> 'paid'`) - Montonio
redelivers the same token until it expires, and a counter that moved once per
delivery would read four uses for one payment. Failing to count never fails the
webhook: a settled payment must not turn into a retry loop over a counter.

## Debugging a staging 500 - read the logs first

Vercel runtime logs name the cause in one line; deploy dashboards do not. POS v2
cost half an hour to a wrong guess ("the backend migration has not landed") when
the log said `column "currency" does not exist` all along - Railway had deployed
fine. Pull them before theorising about deploys:

`get_runtime_logs` scoped to a `deploymentId` (an unscoped query over a wide
window times out on this plan), or the deployment's **Logs** tab.

**`merchants` has no `currency` column - it is `business_currency`.** Only the
`/api/pay/[slug]` *response* renames it, so copying the response shape into a new
query fails at runtime and never at build time. The same trap exists for any
field that route reshapes.

## Verifying changes

`MERCHANT_JWT_SECRET=x npx tsc --noEmit` and `MERCHANT_JWT_SECRET=x npm run build`.
There are no automated tests: exercise the real flow on staging - pay page in a
browser, Stripe test card `4242 4242 4242 4242`, then check the merchant
dashboard and the invoice status.

`npm run verify:receipt-font` is the one exception - a real check, because the
thing it guards cannot be caught any other way (see the receipt section above).
Run it after touching `app/payment-success/receipt-font.ts`. It was written
against a deliberately broken font, so it is known to fail when it should.

`npm run verify:sms` is the second. It compiles `lib/sms-template.ts` and
checks the segment boundaries and the default templates against the Python
sender's, because that pair is one rule written twice and a disagreement shows
a merchant one price while they are charged another. Pair it with
`cd ../hexabee-backend && python3 scripts/check_sms.py`.

⚠️ `npm run lint` has three pre-existing errors unrelated to any of this -
unused `return_url` in `/api/payment/montonio` and unused `MONTONIO_METHODS` /
`montonioVisible` imports in `app/pay/[slug]/page.tsx`. They predate
2026-10-15 and are noted here so a red lint is not mistaken for something a
new change broke. Clear them when next in those files.
