# Refund Check

A traveller writes in asking for a refund on a travel eSIM. This page reads the ticket against the order's event log and answers in one of three ways: "Refund: yes", "Refund: no" or "Escalate". It never guesses.

The refund rule needs three facts, and each one points at the log line it came from:

1. **Within 30 days of purchase.** The `order_paid` line against the ticket's received time.
2. **QR code scanned.** A `qr_scanned` line says yes. "Not scanned" needs a supplier status check from the last 24 hours with the state `released`. A log with no scan line is not proof, so it reads "not found".
3. **Installed or activated.** A `profile_installed` or `activated` line says yes, even if no data was used. A fresh status check of `released` or `downloaded` says no.

A full refund needs all three to allow it. A fact with no line behind it reads "not found", and the request goes to a person.

It is plain code. There is no model in it. The sample is made up.

## The sample

Six tickets, all received on 19 Nov 2026:

- **Hana R.**, Japan, trip cancelled: **Refund: yes.** A status check minutes after the ticket says the eSIM was never downloaded, and she wrote 16 days after buying it.
- **Tunde B.**, Kenya: **Refund: no**, with a flag. Installed and activated at the airport, and the usage report shows 0 MB. The rule says no; the flag passes it to a person for a goodwill decision.
- **Lucia M.**, Turkey: **Refund: no**, with two flags. Her ticket says she never scanned the code, but line 3 shows a scan from an Android phone, then an install error. The reply gives the time and device without accusing her, and offers to finish the install or check a reissue.
- **Oskar P.**, Tokyo, no data: **Escalate.** Installed and active, so the rule alone says no, but the supplier logged an outage after his eSIM went live. That is not a policy refund. A team lead gets him connected and decides on a credit, and the reply gives him something to try in the meantime.
- **Wen T.**, Europe, charged twice: **Refund: yes**, with a flag. Two orders for the same plan two minutes apart on the same card. Only the second order is checked, and the first order's scan and install lines do not count for it.
- **Amara O.**, Thailand, phone locked to her carrier: **Escalate.** The only status check is from almost five days before the ticket, so "not scanned" and "not installed" read "not found". The next step is a fresh status check. The carrier lock is flagged at her words.

Tap a fact or a flag to see the log line it came from, with the parts it read underlined, and to mark that line in the full log below.

"Check your own" checks a ticket and log you paste, in the browser. "Fill in an example" loads an unused eSIM asked about 37 days after purchase: Refund: no.

## Other edge cases it handles

- A refund already issued for the order: Escalate.
- A status check that says `released` after a scan line: the log disagrees with itself, Escalate.
- A log line it cannot read: Escalate, because a scan could be in it.
- A ticket with no order number: it uses the only order in the log and says so, or asks which order when there are several.
- A ticket with no received time, or one with no time zone: the 30-day fact is not found.
- An outage before the eSIM went live, or in another region: not flagged.

## Formats

The ticket has optional header lines (`From`, `Received` as an ISO time in UTC, `Order`, `Subject`), a blank line, then the traveller's words.

The log has one event per line: an ISO time in UTC, an event name, then `key=value` pairs.

```
2026-11-02T09:14:07Z order_paid order=ES-40213 plan=Japan-10GB-15d amount=18.00 currency=USD card=4417
2026-11-19T07:45:12Z status_check order=ES-40213 state=released source=SM-DP+
```

Events it reads: `order_paid`, `qr_emailed`, `qr_scanned`, `install_error`, `profile_installed`, `activated`, `data_session`, `usage_report`, `supplier_status`, `status_check`, `refund_issued`. Status check states follow the eSIM profile states a supplier reports: `released`, `downloaded`, `installed`, `enabled`, `disabled`, `deleted`.

## Limits

- One order per check. A duplicate purchase is flagged, but the other order is not checked.
- The ticket reader looks for a small set of phrases ("never scanned", "didn't install", "locked to my carrier"). Other languages and other wording are not read.
- A real version would run the supplier status check itself when one is missing or old, instead of asking a person to.
- Outages are matched by region name. A real version would match the partner network too.
- The reply draft is a starting point. Nothing is sent from the page.

## Run the tests

```
node --test
```

Needs Node 20 or later. No dependencies. The tests cover the sample result, each of the three facts (found yes, found no, not found, a stale status check, an unknown state, the 30-day boundary to the minute), every edge case above, that every pointer lands on real text, and that the public files carry no em dashes.

## Open the page locally

```
python3 -m http.server 8832
```

Then open http://localhost:8832. The page makes no network calls beyond its own files.

## Design

The result comes first: how many requests get a refund, then each request with its verdict and the reason. The page is set like a departure board: a yellow sheet in light and a black board in dark, with each ticket on its own row under the time it came in. Opening a ticket reverses the colours. The parts of each log line a fact was read from are underlined. A refund is an outlined tag, no refund is a filled tag and a request for a person is a dashed tag. Each has its own glyph and word, so nothing depends on colour. One family, Archivo, at three widths, and monospace for the log.

Fonts: Archivo (SIL Open Font License), in `fonts/`.

## Provenance

Built on 19 Nov 2026 with AI coding agents, directed by Arnold Ikpemosi Adeyemi.

The travellers (first name and an initial only), order numbers, plans, prices, masked emails and cards, partner network names and log lines are made up. Email addresses use the reserved `example.com` domain.

## Licence

MIT. See `LICENSE`.
