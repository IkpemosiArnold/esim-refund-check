import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkRequest, checkAll, parseLog, parseTicket, RULES } from "./check.js";
import { cases, example } from "./samples.js";

const all = checkAll(cases);
const by = (id) => all.find((r) => r.id === id);
const fact = (r, key) => r.facts.find((f) => f.key === key);
const flag = (r, kind) => r.flags.find((f) => f.kind === kind);
const textOf = (r, ref) => (ref.doc === "log" ? r.log.lines : r.ticket.lines)[ref.line].slice(ref.start, ref.end);
const linesOf = (refs) => [...new Set(refs.filter((x) => x.doc === "log").map((x) => x.line + 1))];

// A small builder for one-off cases: a ticket and log lines.
const ticket = (body, { received = "2026-11-19T10:00Z", order = "ES-50001", from = "Sam K." } = {}) =>
  [from && `From: ${from}`, received && `Received: ${received}`, order && `Order: ${order}`, "Subject: Refund", "", body].filter((l) => l !== null && l !== undefined && l !== false).join("\n");
const PAID = "2026-11-10T10:00:00Z order_paid order=ES-50001 plan=Japan-10GB-15d amount=18.00 currency=USD card=1111";
const FRESH = (state) => `2026-11-19T10:05:00Z status_check order=ES-50001 state=${state} source=SM-DP+`;
const run = (body, logLines, opts) => checkRequest({ ticket: ticket(body, opts), log: logLines.join("\n") });

/* ---------- the sample ---------- */

test("sample: 2 refund, 2 no, 2 escalate, in order", () => {
  assert.deepEqual(all.map((r) => [r.from, r.label]), [
    ["Hana R.", "Refund: yes"],
    ["Tunde B.", "Refund: no"],
    ["Lucia M.", "Refund: no"],
    ["Oskar P.", "Escalate"],
    ["Wen T.", "Refund: yes"],
    ["Amara O.", "Escalate"],
  ]);
});

test("sample flags: each case shows the edge case it is there for", () => {
  assert.deepEqual(all.map((r) => r.flags.map((f) => f.kind)), [
    [],
    ["goodwill"],
    ["not-installed", "claim"],
    ["outage"],
    ["duplicate"],
    ["lock"],
  ]);
});

test("the try-your-own example is a no: unused, but 37 days after purchase", () => {
  const r = checkRequest(example);
  assert.equal(r.label, "Refund: no");
  assert.equal(fact(r, "within").value, "no");
  assert.equal(fact(r, "scanned").value, "no");
  assert.match(r.reply.join(" "), /37 days before your message/);
});

/* ---------- fact 1: within 30 days ---------- */

test("fact 1: within 30 days points at the order_paid line and the ticket's received line", () => {
  const f = fact(by("hana"), "within");
  assert.equal(f.value, "yes");
  assert.deepEqual(linesOf(f.refs), [1]);
  assert.ok(f.refs.some((x) => x.doc === "ticket" && textOf(by("hana"), x) === "2026-11-19T07:42Z"));
  assert.ok(f.refs.some((x) => textOf(by("hana"), x) === "order_paid"));
  assert.match(f.text, /16 days, 22 h later/);
});

test("fact 1: exactly 30 days is inside the window, one minute more is not", () => {
  const at30 = run("Refund please.", [PAID, "2026-12-10T10:00:00Z status_check order=ES-50001 state=released"], { received: "2026-12-10T10:00Z" });
  assert.equal(fact(at30, "within").value, "yes");
  assert.equal(at30.label, "Refund: yes");
  const over = run("Refund please.", [PAID, "2026-12-10T10:01:00Z status_check order=ES-50001 state=released"], { received: "2026-12-10T10:01Z" });
  assert.equal(fact(over, "within").value, "no");
  assert.equal(over.label, "Refund: no");
});

test("fact 1: no order_paid line reads not found and escalates", () => {
  const r = run("Refund please.", [FRESH("released")]);
  assert.equal(fact(r, "within").value, "not found");
  assert.match(fact(r, "within").text, /No order_paid line for ES-50001/);
  assert.equal(r.label, "Escalate");
});

test("fact 1: a ticket with no received time, or one with no time zone, reads not found", () => {
  const none = run("Refund please.", [PAID, FRESH("released")], { received: null });
  assert.equal(fact(none, "within").value, "not found");
  assert.equal(none.label, "Escalate");
  const local = run("Refund please.", [PAID, FRESH("released")], { received: "2026-11-19 10:00" });
  assert.equal(fact(local, "within").value, "not found");
  assert.ok(fact(local, "within").refs.some((x) => x.doc === "ticket"));
});

/* ---------- fact 2: QR scanned ---------- */

test("fact 2: a qr_scanned line makes it yes and points at that line", () => {
  const r = by("tunde");
  const f = fact(r, "scanned");
  assert.equal(f.value, "yes");
  assert.equal(f.effect, "blocks");
  assert.deepEqual(linesOf(f.refs), [3]);
  assert.ok(f.refs.some((x) => textOf(r, x) === "qr_scanned"));
  assert.ok(f.refs.some((x) => textOf(r, x) === "device=iOS-18.1"));
});

test("fact 2: not scanned needs a fresh supplier check with state released, and points at it", () => {
  const r = by("hana");
  const f = fact(r, "scanned");
  assert.equal(f.value, "no");
  assert.deepEqual(linesOf(f.refs), [3]);
  assert.ok(f.refs.some((x) => textOf(r, x) === "state=released"));
});

test("fact 2: a log with no scan line and no status check is not found, never taken as not scanned", () => {
  const r = run("Refund please.", [PAID, "2026-11-10T10:00:02Z qr_emailed order=ES-50001"]);
  assert.equal(fact(r, "scanned").value, "not found");
  assert.equal(fact(r, "installed").value, "not found");
  assert.equal(r.label, "Escalate");
  assert.match(r.next, /status check/);
});

test("fact 2: a status check more than 24 hours before the ticket is not trusted", () => {
  const r = by("amara");
  assert.equal(fact(r, "scanned").value, "not found");
  assert.match(fact(r, "scanned").text, /more than 24 hours before the ticket/);
  assert.deepEqual(linesOf(fact(r, "scanned").refs), [3]);
  assert.equal(r.headline, "Scan and install status not found");
  // the same check, 23 hours before the ticket, is trusted
  const ok = run("Refund please.", [PAID, "2026-11-18T11:00:00Z status_check order=ES-50001 state=released"]);
  assert.equal(fact(ok, "scanned").value, "no");
  assert.equal(RULES.freshHours, 24);
});

test("fact 2: a state the check does not know is not found", () => {
  const r = run("Refund please.", [PAID, FRESH("pending")]);
  assert.equal(fact(r, "scanned").value, "not found");
  assert.match(fact(r, "scanned").text, /state pending, which this check does not know/);
});

/* ---------- fact 3: installed or activated ---------- */

test("fact 3: install and activation lines both make it yes, each pointed at", () => {
  const r = by("tunde");
  const f = fact(r, "installed");
  assert.equal(f.value, "yes");
  assert.deepEqual(linesOf(f.refs), [4, 5]);
  assert.ok(f.refs.some((x) => textOf(r, x) === "profile_installed"));
  assert.ok(f.refs.some((x) => textOf(r, x) === "activated"));
});

test("fact 3: an activation line alone is enough; no data needs to be used", () => {
  const r = run("Refund please.", [PAID, "2026-11-12T08:00:00Z activated order=ES-50001 network=partner-JP-2"]);
  assert.equal(fact(r, "installed").value, "yes");
  assert.equal(fact(r, "scanned").value, "yes");
  assert.equal(r.label, "Refund: no");
});

test("fact 3: a fresh check with state downloaded is scanned, not installed", () => {
  const r = by("lucia");
  assert.equal(fact(r, "scanned").value, "yes");
  assert.equal(fact(r, "installed").value, "no");
  assert.deepEqual(linesOf(fact(r, "installed").refs), [5]);
});

/* ---------- the edge cases ---------- */

test("edge: installed with 0 MB used is still no, flagged for a goodwill decision by a person", () => {
  const r = by("tunde");
  assert.equal(r.label, "Refund: no");
  const f = flag(r, "goodwill");
  assert.equal(f.escalate, false);
  assert.deepEqual(linesOf(f.refs), [6]);
  assert.ok(f.refs.some((x) => textOf(r, x) === "used_mb=0"));
  assert.match(r.next, /team lead for a goodwill decision/);
});

test("edge: no goodwill flag once data has been used", () => {
  const r = run("Refund please.", [PAID, "2026-11-12T08:00:00Z activated order=ES-50001", "2026-11-13T00:00:00Z data_session order=ES-50001 mb=12", "2026-11-18T23:59:00Z usage_report order=ES-50001 used_mb=0"]);
  assert.equal(flag(r, "goodwill"), undefined);
});

test("edge: scanned but never installed is no, flagged with the scan, the install error and the check", () => {
  const r = by("lucia");
  assert.equal(r.label, "Refund: no");
  const f = flag(r, "not-installed");
  assert.deepEqual(linesOf(f.refs), [3, 4, 5]);
  assert.match(r.reply.join(" "), /finish the install or check whether it can be reissued/);
});

test("edge: a supplier outage during the trip escalates, even though the rule alone would say no", () => {
  const r = by("oskar");
  assert.equal(fact(r, "installed").value, "yes");
  assert.equal(r.label, "Escalate");
  const f = flag(r, "outage");
  assert.equal(f.escalate, true);
  assert.deepEqual(linesOf(f.refs), [8]);
  assert.ok(f.refs.some((x) => textOf(r, x) === "state=outage"));
  assert.match(f.text, /still open/);
  assert.match(r.reply.join(" "), /data roaming is on/);
});

test("edge: an outage before the eSIM went live, or in another region, is not flagged", () => {
  const before = run("No data.", [PAID, "2026-11-11T00:00:00Z supplier_status region=Japan state=outage", "2026-11-12T08:00:00Z activated order=ES-50001"]);
  assert.equal(flag(before, "outage"), undefined);
  const elsewhere = run("No data.", [PAID, "2026-11-12T08:00:00Z activated order=ES-50001", "2026-11-14T00:00:00Z supplier_status region=Kenya state=outage"]);
  assert.equal(flag(elsewhere, "outage"), undefined);
  assert.equal(elsewhere.label, "Refund: no");
});

test("edge: an outage marked restored names both lines", () => {
  const r = run("No data.", [PAID, "2026-11-12T08:00:00Z activated order=ES-50001", "2026-11-14T00:00:00Z supplier_status region=Japan state=outage", "2026-11-14T06:00:00Z supplier_status region=Japan state=restored"]);
  assert.deepEqual(linesOf(flag(r, "outage").refs), [3, 4]);
  assert.match(flag(r, "outage").text, /marked restored 14 Nov, 06:00 UTC/);
});

test("edge: a second order for the same plan minutes apart is flagged as a duplicate purchase", () => {
  const r = by("wen");
  assert.equal(r.label, "Refund: yes");
  const f = flag(r, "duplicate");
  assert.equal(f.minutes, 2);
  assert.ok(f.refs.some((x) => textOf(r, x) === "order=ES-40871"));
  assert.match(f.text, /on the same card/);
});

test("edge: only the ticket's order is checked; the other order's scan and install do not count", () => {
  const r = by("wen");
  assert.equal(fact(r, "scanned").value, "no");
  assert.deepEqual(linesOf(fact(r, "scanned").refs), [7]);
});

test("edge: the same plan bought 30 minutes apart is not a duplicate", () => {
  const r = checkRequest({
    ticket: ticket("Refund please.", { order: "ES-50002" }),
    log: [PAID, "2026-11-10T10:30:00Z order_paid order=ES-50002 plan=Japan-10GB-15d amount=18.00 currency=USD", "2026-11-19T10:05:00Z status_check order=ES-50002 state=released"].join("\n"),
  });
  assert.equal(flag(r, "duplicate"), undefined);
  assert.equal(r.label, "Refund: yes");
});

test("edge: the ticket says never scanned while the log shows a scan", () => {
  const r = by("lucia");
  const f = flag(r, "claim");
  assert.ok(f.refs.some((x) => x.doc === "ticket" && textOf(r, x) === "never scanned"));
  assert.deepEqual(linesOf(f.refs), [3]);
  assert.match(r.reply.join(" "), /If that wasn't you, tell us/);
});

test("edge: a claim the log agrees with is not flagged", () => {
  const r = by("hana");
  assert.equal(flag(r, "claim"), undefined);
  const s = checkRequest(example);
  assert.equal(s.ticket.claims[0].kind, "installed");
  assert.equal(flag(s, "claim"), undefined);
});

test("edge: a carrier lock in the ticket is flagged at its words", () => {
  const r = by("amara");
  const f = flag(r, "lock");
  assert.equal(textOf(r, f.refs[0]), "locked to my carrier");
});

test("edge: a refund already issued escalates", () => {
  const r = run("Refund please.", [PAID, FRESH("released"), "2026-11-15T09:00:00Z refund_issued order=ES-50001 amount=18.00"]);
  assert.equal(r.label, "Escalate");
  assert.equal(flag(r, "refunded").escalate, true);
});

test("edge: a status check of released after a scan line is a conflict, and escalates", () => {
  const r = run("Refund please.", [PAID, "2026-11-12T08:00:00Z qr_scanned order=ES-50001", FRESH("released")]);
  assert.equal(fact(r, "scanned").value, "yes");
  assert.equal(r.label, "Escalate");
  assert.deepEqual(linesOf(flag(r, "conflict").refs), [3, 2]);
});

test("edge: a log line that cannot be read escalates instead of being skipped", () => {
  const r = run("Refund please.", [PAID, "12/11/2026 08:00 qr_scanned ES-50001", FRESH("released")]);
  assert.equal(r.label, "Escalate");
  assert.deepEqual(linesOf(flag(r, "unread").refs), [2]);
});

test("edge: a ticket with no order number uses the only order in the log, and says so", () => {
  const r = run("Refund please.", [PAID, FRESH("released")], { order: null });
  assert.equal(r.order, "ES-50001");
  assert.match(r.orderNote, /names no order/);
  assert.equal(r.label, "Refund: yes");
});

test("edge: a ticket with no order number and two orders in the log asks which", () => {
  const r = run("Refund please.", [PAID, "2026-11-11T10:00:00Z order_paid order=ES-50003 plan=Kenya-5GB-7d amount=11.00 currency=USD"], { order: null });
  assert.equal(r.order, null);
  assert.equal(r.label, "Escalate");
  assert.equal(flag(r, "order").title, "Which order?");
  assert.match(r.reply.join(" "), /ES-50001 and ES-50003/);
});

/* ---------- every pointer and every word ---------- */

test("every ref in every sample points at real text on a real line", () => {
  for (const r of all) {
    for (const item of [...r.facts, ...r.flags]) {
      for (const ref of item.refs) {
        const lines = ref.doc === "log" ? r.log.lines : r.ticket.lines;
        assert.ok(ref.line >= 0 && ref.line < lines.length, `${r.id} ${item.key || item.kind}: line ${ref.line}`);
        assert.ok(ref.end > ref.start && textOf(r, ref).trim().length > 0, `${r.id} ${item.key || item.kind}: empty ref`);
      }
    }
  }
});

test("every fact that is found names its line number, and that line is among its refs", () => {
  for (const r of all) {
    for (const f of r.facts) {
      if (f.value === "not found") continue;
      for (const n of [...f.text.matchAll(/line (\d+)/g)].map((m) => +m[1])) assert.ok(linesOf(f.refs).includes(n), `${r.id} ${f.key} line ${n}`);
    }
  }
});

test("parseLog keeps line numbers and parts; parseTicket reads the header and the order", () => {
  const L = parseLog("# export\n2026-11-02T09:14:07Z order_paid order=ES-1234 plan=X\n\n");
  assert.equal(L.events[0].line, 1);
  assert.equal(L.events[0].kv.order, "ES-1234");
  const T = parseTicket("Hi, my order ES-40213 please refund");
  assert.equal(T.order.value, "ES-40213");
  assert.equal(T.received, null);
});

test("replies and public files: no em dashes, no exclamation marks in replies", () => {
  for (const r of [...all, checkRequest(example)]) {
    const text = r.reply.join(" ");
    assert.ok(!text.includes("\u2014") && !text.includes("!"), r.from);
  }
  for (const f of ["README.md", "index.html", "samples.js", "check.js", "app.js", "style.css", "check.test.js", "package.json"]) {
    const s = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!s.includes("\u2014"), `${f} has an em dash`);
  }
});

test("review fixes: cancel before refund, local outage time, carrier lock wording", () => {
  const h = by("hana");
  assert.match(h.next, /^Cancel the unused eSIM/);
  assert.match(h.reply.join(" "), /QR code in your email will stop working once it is cancelled/);
  const o = by("oskar");
  const oText = o.reply.join(" ");
  assert.match(oText, /23:10 Japan time on 18 Nov/);
  assert.ok(!/UTC/.test(oText), "traveller reply should not quote UTC");
  assert.match(oText, /picking another one by hand/);
  const a = by("amara");
  const lock = a.flags.find((f) => f.title === "Carrier lock mentioned");
  assert.ok(lock && !/cannot add/.test(lock.text));
  assert.match(lock.text, /Only a status check shows/);
  assert.match(a.reply.join(" "), /screenshot of it helps/);
  assert.ok(!/couldn't be added/.test(a.reply.join(" ")));
});
