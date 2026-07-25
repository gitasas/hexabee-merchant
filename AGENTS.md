@CLAUDE.md

# hexabee-merchant

Merchant portal (merchant.hexabee.buzz) + public checkout (checkout.hexabee.buzz).
Read [CLAUDE.md](CLAUDE.md) before changing anything — it covers the pay-page
data flow, fee mode, the invoice ledger, env vars and the rules that are easy to
get wrong (notably: Stripe payments must never require the merchant IBAN, and
`MERCHANT_JWT_SECRET` must never have a fallback).

`main` = production, `staging` = staging. Verify with
`MERCHANT_JWT_SECRET=x npm run build` and by exercising the flow on staging —
there is no automated test suite.
