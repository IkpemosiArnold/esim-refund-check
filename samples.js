// Sample data. Everything here is made up: the travellers (first name and an initial),
// the order numbers, the plans, the masked emails and cards, the partner network names
// and every log line. Times are UTC.

export const cases = [
  {
    id: "hana",
    ticket: `From: Hana R.
Received: 2026-11-19T07:42Z
Order: ES-40213
Subject: Refund, trip cancelled

Hi, my work trip to Japan was cancelled last week. I bought the eSIM early and never opened the email with the code. Can I get my money back?`,
    log: `2026-11-02T09:14:07Z order_paid order=ES-40213 plan=Japan-10GB-15d amount=18.00 currency=USD card=4417
2026-11-02T09:14:09Z qr_emailed order=ES-40213 to=h***@example.com
2026-11-19T07:45:12Z status_check order=ES-40213 state=released source=SM-DP+`,
  },
  {
    id: "tunde",
    ticket: `From: Tunde B.
Received: 2026-11-19T08:15Z
Order: ES-40467
Subject: Refund for Kenya eSIM

Hello, I installed the Kenya eSIM at the airport but the hotel wifi was fine so I never used it. It shows 0 MB used. Please refund.`,
    log: `2026-11-08T05:50:31Z order_paid order=ES-40467 plan=Kenya-5GB-7d amount=11.00 currency=USD card=0932
2026-11-08T05:50:33Z qr_emailed order=ES-40467 to=t***@example.com
2026-11-09T06:28:10Z qr_scanned order=ES-40467 device=iOS-18.1
2026-11-09T06:28:55Z profile_installed order=ES-40467 device=iOS-18.1
2026-11-09T06:33:02Z activated order=ES-40467 network=partner-KE-1
2026-11-18T23:59:00Z usage_report order=ES-40467 used_mb=0 source=supplier`,
  },
  {
    id: "lucia",
    ticket: `From: Lucia M.
Received: 2026-11-19T09:02Z
Order: ES-40389
Subject: eSIM not working, refund

I never scanned the QR code. The eSIM doesn't show up on my phone at all. I want a refund.`,
    log: `2026-11-06T12:40:18Z order_paid order=ES-40389 plan=Turkey-5GB-10d amount=9.50 currency=USD card=7781
2026-11-06T12:40:20Z qr_emailed order=ES-40389 to=l***@example.com
2026-11-08T14:02:44Z qr_scanned order=ES-40389 device=Android-15
2026-11-08T14:03:30Z install_error order=ES-40389 device=Android-15 code=download-interrupted
2026-11-19T09:05:51Z status_check order=ES-40389 state=downloaded source=SM-DP+`,
  },
  {
    id: "oskar",
    ticket: `From: Oskar P.
Received: 2026-11-19T00:20Z
Order: ES-40655
Subject: No data in Tokyo

No data since last night. I'm at the station with no maps and no way to call my hotel. If it can't be fixed today I want my money back.`,
    log: `2026-11-12T19:05:11Z order_paid order=ES-40655 plan=Japan-20GB-30d amount=26.00 currency=USD card=5520
2026-11-12T19:05:13Z qr_emailed order=ES-40655 to=o***@example.com
2026-11-13T21:10:40Z qr_scanned order=ES-40655 device=iOS-17.6
2026-11-13T21:11:22Z profile_installed order=ES-40655 device=iOS-17.6
2026-11-15T02:47:09Z activated order=ES-40655 network=partner-JP-2
2026-11-16T00:00:00Z data_session order=ES-40655 mb=640
2026-11-17T00:00:00Z data_session order=ES-40655 mb=1210
2026-11-18T14:10:00Z supplier_status region=Japan network=partner-JP-2 state=outage
2026-11-19T00:24:00Z status_check order=ES-40655 state=enabled source=SM-DP+`,
  },
  {
    id: "wen",
    ticket: `From: Wen T.
Received: 2026-11-19T10:30Z
Order: ES-40872
Subject: Charged twice

I was charged twice for the Europe plan. I only need one, please refund the second one.`,
    log: `2026-11-17T18:02:15Z order_paid order=ES-40871 plan=Europe-20GB-30d amount=34.00 currency=USD card=2208
2026-11-17T18:02:17Z qr_emailed order=ES-40871 to=w***@example.com
2026-11-17T18:04:41Z order_paid order=ES-40872 plan=Europe-20GB-30d amount=34.00 currency=USD card=2208
2026-11-17T18:04:43Z qr_emailed order=ES-40872 to=w***@example.com
2026-11-18T07:15:02Z qr_scanned order=ES-40871 device=Android-14
2026-11-18T07:15:49Z profile_installed order=ES-40871 device=Android-14
2026-11-19T10:31:20Z status_check order=ES-40872 state=released source=SM-DP+`,
  },
  {
    id: "amara",
    ticket: `From: Amara O.
Received: 2026-11-19T11:05Z
Order: ES-40598
Subject: Can't use eSIM

Hi, I bought a Thailand eSIM but my phone turned out to be locked to my carrier, so I can't use it. Refund please.`,
    log: `2026-11-14T16:22:09Z order_paid order=ES-40598 plan=Thailand-8GB-15d amount=12.00 currency=USD card=6614
2026-11-14T16:22:11Z qr_emailed order=ES-40598 to=a***@example.com
2026-11-14T16:30:00Z status_check order=ES-40598 state=released source=SM-DP+`,
  },
];

// "Fill in an example" in the try-your-own box: an unused eSIM, asked about after the window.
export const example = {
  ticket: `From: Sam K.
Received: 2026-11-19T12:10Z
Order: ES-39954
Subject: Refund

My Portugal trip moved to next year, can I get a refund? I never installed the eSIM.`,
  log: `2026-10-12T15:31:40Z order_paid order=ES-39954 plan=Portugal-10GB-15d amount=16.00 currency=USD card=3390
2026-10-12T15:31:42Z qr_emailed order=ES-39954 to=s***@example.com
2026-11-19T12:12:05Z status_check order=ES-39954 state=released source=SM-DP+`,
};
