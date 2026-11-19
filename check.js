// Refund Check: a traveller's refund ticket read against the order's event log.
// Plain code. No model. Every fact and flag points at the log line it came from.
// A fact with no line behind it reads "not found", and the verdict is then "Escalate", never a guess.

export const RULES = {
  windowDays: 30, // the unused-eSIM refund window, counted from purchase
  freshHours: 24, // a supplier status check older than this before the ticket is not trusted
  duplicateMinutes: 10, // two orders for the same plan this close together look like a double purchase
};

// eSIM profile states as a supplier's provisioning server (SM-DP+) reports them.
const STATES = ["released", "downloaded", "installed", "enabled", "disabled", "deleted"];
const SCANNED_STATES = new Set(["downloaded", "installed", "enabled", "disabled", "deleted"]);
const INSTALLED_STATES = new Set(["installed", "enabled", "disabled", "deleted"]);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
const HOUR = 3600e3;
const DAY = 24 * HOUR;

/* ---------- times, all UTC ---------- */

export const fmtDay = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
export const fmtClock = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};
export const dayCount = (n) => (n === 0 ? "less than a day" : `${n} day${n === 1 ? "" : "s"}`);
export const fmt = (ms) => `${fmtDay(ms)}, ${fmtClock(ms)}`;
// times in replies go to travellers in their own zone; the side panel stays in UTC
export const TZ = { Japan: "Asia/Tokyo", Turkey: "Europe/Istanbul", Kenya: "Africa/Nairobi", Thailand: "Asia/Bangkok", Portugal: "Europe/Lisbon" };
export const fmtLocal = (ms, region) => {
  const zone = TZ[region];
  if (!zone) return fmt(ms);
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" }).format(ms);
  return `${clock} ${region} time on ${day}`;
};
export const fmtSpan = (ms) => {
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR);
  return `${d} day${d === 1 ? "" : "s"}, ${h} h`;
};

const TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z$/;
const ORDER_RE = /\b[A-Z]{2,4}-\d{4,8}\b/;

/* ---------- the order log ---------- */

/**
 * One event per line: an ISO time in UTC, an event name, then key=value pairs.
 *   2026-11-02T09:14:07Z order_paid order=ES-40213 plan=Japan-10GB-15d amount=18.00 currency=USD
 * Every event keeps its line and the position of each part, so a fact can point at the exact text.
 * A line that does not read this way is kept as unread, never skipped quietly.
 */
export function parseLog(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const events = [];
  const unread = [];
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith("#")) return;
    const m = raw.match(/^(\s*)(\S+)\s+(\S+)/);
    if (!m || !TIME_RE.test(m[2]) || !/^[a-z][a-z_]*$/.test(m[3])) {
      unread.push({ line: i, why: !m ? "Not a time, an event and details" : !TIME_RE.test(m[2]) ? "The time is not an ISO time in UTC" : "The event name is not read" });
      return;
    }
    const at = { start: m[1].length, end: m[1].length + m[2].length };
    const evStart = raw.indexOf(m[3], at.end);
    const ev = { start: evStart, end: evStart + m[3].length };
    const kv = {}, pos = {};
    for (const p of raw.slice(ev.end).matchAll(/([a-z_]+)=(\S+)/g)) {
      const s = ev.end + p.index;
      kv[p[1]] = p[2];
      pos[p[1]] = { start: s, end: s + p[0].length };
    }
    events.push({ line: i, time: Date.parse(m[2]), event: m[3], kv, pos, at, ev });
  });
  return { lines, events, unread };
}

/** Refs to one log event: the time and event name, plus any key=value parts named. */
function logRef(e, ...keys) {
  const out = [{ doc: "log", line: e.line, ...e.at }, { doc: "log", line: e.line, ...e.ev }];
  for (const k of keys) if (e.pos[k]) out.push({ doc: "log", line: e.line, ...e.pos[k] });
  return out;
}
const lineNo = (e) => `line ${e.line + 1}`;

/* ---------- the ticket ---------- */

const CLAIMS = [
  { kind: "scanned", re: /\b(?:never|didn['’]t|did not|haven['’]t|have not|not)\s+(?:even\s+)?scan(?:ned)?\b/i },
  { kind: "installed", re: /\b(?:never|didn['’]t|did not|haven['’]t|have not|not)\s+(?:even\s+)?(?:install(?:ed)?|activate(?:d)?)\b/i },
];
const LOCK_RE = /\b(?:carrier[- ]locked|carrier[- ]lock|sim[- ]locked|network[- ]locked|locked to (?:my |the |a )?(?:carrier|network|provider))\b/i;

/**
 * A ticket: optional header lines (From, Received, Order, Subject), a blank line, then the traveller's words.
 * Read from it: who wrote, when it arrived (UTC), the order number, and two kinds of claim the log can check.
 */
export function parseTicket(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const t = { lines, from: null, received: null, receivedBad: null, order: null, claims: [], locks: [] };
  let head = true;
  lines.forEach((l, i) => {
    if (head) {
      const h = l.match(/^(From|Received|Order|Subject):[ \t]*(.*)$/i);
      if (h) {
        const key = h[1].toLowerCase(), val = h[2].trim();
        const start = h[0].length - h[2].length + (h[2].length - h[2].trimStart().length);
        const span = { line: i, start, end: start + val.length };
        if (key === "from" && val) t.from = { value: val, ...span };
        if (key === "received" && val) {
          const m = val.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)\s*(Z|UTC)$/i);
          if (m) t.received = { time: Date.parse(`${m[1]}T${m[2]}Z`), ...span };
          else t.receivedBad = { value: val, ...span };
        }
        if (key === "order") {
          const m = val.match(ORDER_RE);
          if (m) t.order = { value: m[0], line: i, start: start + m.index, end: start + m.index + m[0].length };
        }
        return;
      }
      head = false;
      if (!l.trim()) return;
    }
    if (!t.order) {
      const m = l.match(ORDER_RE);
      if (m) t.order = { value: m[0], line: i, start: m.index, end: m.index + m[0].length };
    }
    for (const c of CLAIMS) {
      const m = l.match(c.re);
      if (m) t.claims.push({ kind: c.kind, text: m[0], line: i, start: m.index, end: m.index + m[0].length });
    }
    const k = l.match(LOCK_RE);
    if (k) t.locks.push({ text: k[0], line: i, start: k.index, end: k.index + k[0].length });
  });
  return t;
}
const tRef = (x) => ({ doc: "ticket", line: x.line, start: x.start, end: x.end });

/* ---------- the check ---------- */

const humanDevice = (d) => (d ? d.replace(/-/g, " ") : null);
const humanPlan = (p) => (p ? p.replace(/-/g, " ") : null);
const regionOf = (plan) => (plan ? plan.split("-")[0] : null);
const an = (w) => (/^[aeiou]/i.test(w) ? "an" : "a");

function fact(key, label, value, text, refs) {
  const good = key === "within" ? "yes" : "no";
  const effect = value === "not found" ? "none" : value === good ? "allows" : "blocks";
  return { key, label, value, effect, text, refs };
}

/**
 * Check one refund request.
 * @param {{ticket: string, log: string}} input
 */
export function checkRequest({ ticket, log }) {
  const T = parseTicket(ticket);
  const L = parseLog(log);
  const paidAll = L.events.filter((e) => e.event === "order_paid" && e.kv.order);
  const orderIds = [...new Set(paidAll.map((e) => e.kv.order))];

  let order = null;
  let orderNote = null;
  if (T.order) order = T.order.value;
  else if (orderIds.length === 1) {
    order = orderIds[0];
    orderNote = `The ticket names no order. The log has one, ${order}, so this checks that one.`;
  }

  const mine = order ? L.events.filter((e) => e.kv.order === order).sort((a, b) => a.time - b.time) : [];
  const first = (name) => mine.find((e) => e.event === name);
  const paid = first("order_paid");
  const scan = first("qr_scanned");
  const inst = first("profile_installed");
  const act = first("activated");
  const used = mine.find((e) => e.event === "data_session" && Number(e.kv.mb) > 0);
  const installErr = first("install_error");
  const refunded = first("refund_issued");
  const usage = mine.filter((e) => e.event === "usage_report" && e.kv.used_mb != null).at(-1);
  const check = mine.filter((e) => e.event === "status_check" && e.kv.state).at(-1);
  const rec = T.received;

  // A status check counts only if it is recent and names a state this check knows.
  let checkUse = null; // "fresh" | "stale" | "unknown-state" | "no-ticket-time"
  if (check) {
    if (!STATES.includes(check.kv.state)) checkUse = "unknown-state";
    else if (!rec) checkUse = "no-ticket-time";
    else checkUse = check.time >= rec.time - RULES.freshHours * HOUR ? "fresh" : "stale";
  }
  const checkWhy = () =>
    checkUse === "stale"
      ? `The last supplier status check is from ${fmt(check.time)} (${lineNo(check)}), more than ${RULES.freshHours} hours before the ticket.`
      : checkUse === "unknown-state"
        ? `The supplier status check at ${lineNo(check)} says state ${check.kv.state}, which this check does not know.`
        : checkUse === "no-ticket-time"
          ? `There is a supplier status check (${lineNo(check)}), but with no ticket time it cannot be shown to be recent.`
          : `There is no supplier status check for ${order}.`;

  /* fact 1: within 30 days of purchase */
  let within;
  if (!order) {
    within = fact("within", "Within 30 days of purchase", "not found", orderIds.length ? `The ticket names no order, and the log has ${orderIds.length}: ${orderIds.join(", ")}.` : "The ticket names no order, and the log has no order_paid line.", []);
  } else if (!paid) {
    within = fact("within", "Within 30 days of purchase", "not found", `No order_paid line for ${order} in the log.`, T.order ? [tRef(T.order)] : []);
  } else if (!rec) {
    within = fact("within", "Within 30 days of purchase", "not found", `Paid ${fmt(paid.time)} (${lineNo(paid)}), but the ticket has no received time in UTC.`, [...logRef(paid), ...(T.receivedBad ? [tRef(T.receivedBad)] : [])]);
  } else if (rec.time < paid.time) {
    within = fact("within", "Within 30 days of purchase", "not found", `The ticket is dated ${fmt(rec.time)}, before the purchase at ${fmt(paid.time)} (${lineNo(paid)}).`, [...logRef(paid), tRef(rec)]);
  } else {
    const span = rec.time - paid.time;
    const ok = span <= RULES.windowDays * DAY;
    within = fact("within", "Within 30 days of purchase", ok ? "yes" : "no", `Paid ${fmt(paid.time)} (${lineNo(paid)}). Ticket ${fmt(rec.time)}, ${fmtSpan(span)} later.`, [...logRef(paid), tRef(rec)]);
    within.days = Math.floor(span / DAY);
  }

  /* fact 2: QR code scanned */
  let scanned;
  if (!order) scanned = fact("scanned", "QR code scanned", "not found", "No order to look up.", []);
  else if (scan) scanned = fact("scanned", "QR code scanned", "yes", `Scanned ${fmt(scan.time)}${scan.kv.device ? ` on ${humanDevice(scan.kv.device)}` : ""} (${lineNo(scan)}).`, logRef(scan, "device"));
  else if (inst || act) {
    const e = inst || act;
    scanned = fact("scanned", "QR code scanned", "yes", `No scan line, but the eSIM was ${e === inst ? "installed" : "activated"} ${fmt(e.time)} (${lineNo(e)}), so its code was used.`, logRef(e));
  } else if (checkUse === "fresh") {
    const yes = SCANNED_STATES.has(check.kv.state);
    scanned = fact("scanned", "QR code scanned", yes ? "yes" : "no", `Supplier status check ${fmt(check.time)} (${lineNo(check)}): state ${check.kv.state}, ${yes ? "the code has been used" : "the code has not been used"}.`, logRef(check, "state"));
  } else scanned = fact("scanned", "QR code scanned", "not found", `No scan line. ${checkWhy()}`, check ? logRef(check, "state") : []);

  /* fact 3: installed or activated */
  let installed;
  if (!order) installed = fact("installed", "Installed or activated", "not found", "No order to look up.", []);
  else if (inst || act) {
    const bits = [];
    const refs = [];
    if (inst) { bits.push(`Installed ${fmt(inst.time)} (${lineNo(inst)})`); refs.push(...logRef(inst)); }
    if (act) { bits.push(`${inst ? "activated" : "Activated"} ${fmt(act.time)}${act.kv.network ? ` on ${act.kv.network}` : ""} (${lineNo(act)})`); refs.push(...logRef(act, "network")); }
    installed = fact("installed", "Installed or activated", "yes", `${bits.join(", ")}.`, refs);
  } else if (used) {
    installed = fact("installed", "Installed or activated", "yes", `${used.kv.mb} MB of data used ${fmt(used.time)} (${lineNo(used)}), so it was active.`, logRef(used, "mb"));
  } else if (checkUse === "fresh") {
    const yes = INSTALLED_STATES.has(check.kv.state);
    installed = fact("installed", "Installed or activated", yes ? "yes" : "no", `Supplier status check ${fmt(check.time)} (${lineNo(check)}): state ${check.kv.state}, ${yes ? "on a phone" : "not installed"}.`, logRef(check, "state"));
  } else installed = fact("installed", "Installed or activated", "not found", `No install or activation line. ${checkWhy()}`, check ? logRef(check, "state") : []);

  const facts = [within, scanned, installed];

  /* flags: the edge cases, each pointing at its line */
  const flags = [];
  const flag = (kind, escalate, title, text, refs) => flags.push({ kind, escalate, title, text, refs });

  if (L.unread.length) {
    const n = L.unread.length;
    flag("unread", true, `${n} log line${n === 1 ? "" : "s"} not read`, `${L.unread.map((u) => `Line ${u.line + 1}: ${u.why.toLowerCase()}`).join(". ")}. A scan or install could be in ${n === 1 ? "it" : "them"}, so a person reads ${n === 1 ? "it" : "them"}.`, L.unread.map((u) => ({ doc: "log", line: u.line, start: 0, end: L.lines[u.line].length })));
  }
  if (!order) {
    flag("order", true, orderIds.length ? "Which order?" : "No order found", orderIds.length ? `The ticket names no order and the log has ${orderIds.length}. Ask which one.` : "The ticket names no order and the log has none. Ask for the order number.", paidAll.flatMap((e) => logRef(e)));
  }
  if (refunded) {
    flag("refunded", true, "Already refunded", `A refund was issued ${fmt(refunded.time)} (${lineNo(refunded)}). Do not refund twice; a person checks what the traveller is seeing.`, logRef(refunded, "amount"));
  }
  if (check && checkUse === "fresh") {
    const contra = (check.kv.state === "released" && [scan, inst, act].find((e) => e && e.time <= check.time)) || (check.kv.state === "downloaded" && [inst, act].find((e) => e && e.time <= check.time));
    if (contra) flag("conflict", true, "The log disagrees with itself", `The supplier status check (${lineNo(check)}) says ${check.kv.state}, but ${lineNo(contra)} shows ${contra.event} earlier. A person checks with the supplier.`, [...logRef(check, "state"), ...logRef(contra)]);
  }
  const plan = paid?.kv.plan;
  const region = regionOf(plan);
  const live = act || inst;
  if (live && rec) {
    const outage = L.events.find((e) => e.event === "supplier_status" && e.kv.state === "outage" && (!e.kv.region || !region || e.kv.region === region) && e.time >= live.time && e.time <= rec.time);
    if (outage) {
      const restored = L.events.find((e) => e.event === "supplier_status" && e.kv.state === "restored" && e.kv.region === outage.kv.region && e.time > outage.time && e.time <= rec.time);
      flag("outage", true, "Supplier outage during the trip", `The supplier logged an outage${outage.kv.region ? ` in ${outage.kv.region}` : ""} ${fmt(outage.time)} (${lineNo(outage)}), after the eSIM went live${restored ? `, marked restored ${fmt(restored.time)} (${lineNo(restored)})` : ", still open when the ticket came in"}. This is not a policy refund: a person gets the traveller connected and decides on a credit.`, [...logRef(outage, "region", "state"), ...(restored ? logRef(restored, "state") : [])]);
      flags.at(-1).outage = outage;
      flags.at(-1).restored = restored;
    }
  }
  if (paid && plan) {
    const dup = paidAll.find((e) => e.kv.order !== order && e.kv.plan === plan && Math.abs(e.time - paid.time) <= RULES.duplicateMinutes * 60e3);
    if (dup) {
      const mins = Math.round(Math.abs(dup.time - paid.time) / 60e3);
      flag("duplicate", false, "Duplicate purchase", `Order ${dup.kv.order} for the same plan was paid ${mins} minute${mins === 1 ? "" : "s"} ${dup.time < paid.time ? "earlier" : "later"} (${lineNo(dup)})${dup.kv.card && dup.kv.card === paid.kv.card ? ", on the same card" : ""}. Looks like a double purchase. Only ${order} is checked here.`, [...logRef(dup, "order", "plan", "card"), ...logRef(paid, "plan")]);
      flags.at(-1).other = dup;
      flags.at(-1).minutes = mins;
    }
  }
  if (installed.value === "yes" && usage && Number(usage.kv.used_mb) === 0 && !used) {
    flag("goodwill", false, "Installed, 0 MB used", `The usage report shows 0 MB used (${lineNo(usage)}). The rule still says no refund. A person may decide on a goodwill credit.`, logRef(usage, "used_mb"));
  }
  if (scanned.value === "yes" && installed.value === "no") {
    flag("not-installed", false, "Scanned, never installed", `Scanned ${scan ? fmt(scan.time) : ""}${scan ? ` (${lineNo(scan)})` : ""} but not installed${installErr ? `, with an install error (${lineNo(installErr)})` : ""}. The rule says no refund. Help finish the install or check a reissue first.`, [...(scan ? logRef(scan) : []), ...(installErr ? logRef(installErr, "code") : []), ...(check ? logRef(check, "state") : [])]);
  }
  for (const c of T.claims) {
    const f = c.kind === "scanned" ? scanned : installed;
    if (f.value !== "yes") continue;
    const e = c.kind === "scanned" ? scan || inst || act : inst || act || used;
    flag("claim", false, `Ticket says "${c.text}"`, `The log shows ${c.kind === "scanned" ? "a scan" : "an install"} ${e ? `${fmt(e.time)} (${lineNo(e)})` : ""}. The reply gives the time and device and asks, without accusing.`, [tRef(c), ...(e ? logRef(e, "device") : [])]);
  }
  for (const k of T.locks) {
    flag("lock", false, "Carrier lock mentioned", `The ticket mentions a lock ("${k.text}"). A phone locked to its carrier may refuse an eSIM from another provider, or install it and show no service. Only a status check shows whether the code was used.`, [tRef(k)]);
  }

  /* the verdict */
  const missing = facts.filter((f) => f.value === "not found");
  const esc = flags.filter((f) => f.escalate);
  let verdict;
  if (missing.length || esc.length) verdict = "escalate";
  else if (within.value === "no") verdict = "no";
  else if (scanned.value === "yes" || installed.value === "yes") verdict = "no";
  else verdict = "yes";

  const r = {
    verdict,
    label: verdict === "yes" ? "Refund: yes" : verdict === "no" ? "Refund: no" : "Escalate",
    state: verdict === "yes" ? "pass" : verdict === "no" ? "fail" : "none",
    order,
    orderNote,
    from: T.from?.value ?? null,
    received: rec?.time ?? null,
    plan: humanPlan(plan),
    amount: paid?.kv.amount ? `${paid.kv.currency ? paid.kv.currency + " " : ""}${paid.kv.amount}` : null,
    card: paid?.kv.card ?? null,
    facts,
    flags,
    missing: missing.map((f) => f.key),
    ticket: T,
    log: L,
  };
  r.headline = headline(r, { scan, inst, act });
  r.next = nextStep(r);
  r.reply = draftReply(r, { scan, inst, act, check, paid });
  return r;
}

export const checkAll = (cases) => cases.map((c) => ({ id: c.id, ...checkRequest(c) }));

/* ---------- the words around the verdict ---------- */

const has = (r, kind) => r.flags.find((f) => f.kind === kind);
const factOf = (r, key) => r.facts.find((f) => f.key === key);

function headline(r, { inst, act }) {
  if (!r.order) return has(r, "order").title;
  if (r.verdict === "escalate") {
    if (has(r, "outage")) return "Supplier outage during the trip";
    if (has(r, "refunded")) return "Already refunded";
    if (has(r, "conflict")) return "The log disagrees with itself";
    if (has(r, "unread")) return "Log lines not read";
    const m = r.missing;
    if (m.includes("within")) return "Purchase date not found";
    if (m.includes("scanned") && m.includes("installed")) return "Scan and install status not found";
    return m.includes("scanned") ? "Scan status not found" : "Install status not found";
  }
  const w = factOf(r, "within");
  if (w.value === "no") return `Asked ${w.days} days after purchase`;
  if (r.verdict === "no") {
    if (inst && act) return "Installed and activated";
    if (inst || act) return inst ? "Installed" : "Activated";
    if (factOf(r, "installed").value === "yes") return "Installed";
    return "QR scanned, not installed";
  }
  return `Not scanned or installed, ${dayCount(w.days)} in`;
}

function nextStep(r) {
  if (r.verdict === "yes") return `Cancel the unused eSIM with the supplier, then refund ${r.amount ?? "the order"}${r.card ? ` to the card ending ${r.card}` : ""} and send the reply.`;
  if (r.verdict === "no") {
    if (has(r, "goodwill")) return "Send the reply and pass it to a team lead for a goodwill decision.";
    if (has(r, "not-installed")) return "Send the reply and help with the install. No refund under the rule.";
    return "Send the reply. No refund under the rule.";
  }
  if (has(r, "outage")) return "To a team lead now: get the traveller connected, then decide on a credit.";
  if (has(r, "refunded")) return "To a person: check the earlier refund before anything else.";
  if (has(r, "conflict")) return "To a person: ask the supplier which line is right.";
  if (has(r, "unread")) return "To a person: read the unread log lines, then check again.";
  if (!r.order) return "Ask the traveller which order, then check again.";
  if (r.missing.includes("within")) return "To a person: find the purchase record, then check again.";
  return "Run a supplier status check for this order, then check again.";
}

function draftReply(r, { scan, inst, act, check, paid }) {
  const first = r.from ? r.from.split(/\s+/)[0] : "there";
  const p = [`Hi ${first},`];
  const order = r.order;
  const w = factOf(r, "within");

  if (r.verdict === "yes") {
    p.push(`Thanks for writing. I checked order ${order}. The eSIM has not been scanned or installed (our network partner's status check, ${fmt(check.time)}), and you wrote ${dayCount(w.days)} after buying it, inside our 30-day window.`);
    p.push(`So it qualifies for a full refund of ${r.amount ?? "the amount paid"}, back to the card you paid with. The QR code in your email will stop working once it is cancelled. Refunds usually show within two weeks, depending on your bank.`);
    const dup = has(r, "duplicate");
    if (dup) p.push(`I can also see order ${dup.other.kv.order} for the same plan, paid ${dup.minutes} minute${dup.minutes === 1 ? "" : "s"} ${dup.other.time < paid.time ? "earlier" : "later"}. That one is not affected and stays yours to use.`);
  } else if (r.verdict === "no") {
    if (w.value === "no") {
      p.push(`Thanks for writing. I checked order ${order}. It was bought on ${fmtDay(paid.time)}, ${dayCount(w.days)} before your message. Our refund window for unused eSIMs is 30 days from purchase, so I'm not able to refund it.`);
      p.push("If something is stopping the eSIM from working, reply here and we'll help you set it up.");
    } else if (inst || act || factOf(r, "installed").value === "yes") {
      const e = inst || act;
      p.push(`Thanks for writing. I checked order ${order}. ${e ? `The eSIM was ${inst ? "installed" : "activated"} on ${fmt(e.time)}${inst && act ? ` and connected to a network at ${fmtClock(act.time)}` : ""}.` : "The eSIM is installed on a phone."} Under our refund policy, an eSIM that has been installed or activated can't be refunded, even when no data has been used.`);
      if (has(r, "goodwill")) p.push("I can see the usage report shows no data used, so I've asked a team lead to look at your case. You'll hear back on this thread.");
    } else {
      const dev = scan?.kv.device ? humanDevice(scan.kv.device) : null;
      p.push(`Thanks for writing. I checked order ${order}. The QR code was scanned on ${scan ? fmt(scan.time) : "your order"}${dev ? ` from ${an(dev)} ${dev} phone` : ""}, and the eSIM did not finish installing after that. Under our refund policy a scanned eSIM can't be refunded, but we can help you get this one working.`);
      p.push("Reply with your phone model and any error message you saw, and we'll help you finish the install or check whether it can be reissued.");
    }
    if (has(r, "claim")) p.push(`You mentioned it was never ${has(r, "claim").title.includes("install") ? "installed" : "scanned"}. If that wasn't you, tell us and we'll look into it.`);
  } else {
    const out = has(r, "outage");
    if (out) {
      const rg = out.outage.kv.region;
      p.push(`Sorry you're stuck. Our network partner logged an outage${rg ? ` in ${rg}` : ""} from ${fmtLocal(out.outage.time, rg)}${out.restored ? `, marked fixed at ${fmtLocal(out.restored.time, rg)}` : ""}, which explains the lost data. I've raised your case with a team lead now, to get you connected and put this right.`);
      p.push("In the meantime, please check that data roaming is on for the eSIM line, then restart your phone. If your phone lists more than one network for this eSIM, picking another one by hand in Settings can also help. We'll update you here.");
    } else if (has(r, "refunded")) {
      const rf = r.log.events.find((e) => e.event === "refund_issued" && e.kv.order === order);
      p.push(`Thanks for writing. A refund for order ${order} was issued on ${fmtDay(rf.time)}. A team member is checking your message and will reply here.`);
    } else if (!order) {
      const ids = [...new Set(r.log.events.filter((e) => e.event === "order_paid" && e.kv.order).map((e) => e.kv.order))];
      p.push(ids.length > 1 ? `Thanks for writing. Which order is this about? I can see ${ids.length} on your account: ${ids.join(" and ")}.` : "Thanks for writing. Could you send the order number from your receipt email? I'll check it as soon as I have it.");
    } else {
      p.push(`Thanks for writing. Before I can confirm a refund for order ${order}, I need to check the eSIM's status with our network partner. There's nothing you need to do; I'll reply here once I have it.`);
      if (has(r, "lock")) p.push("You mentioned your phone is locked to your carrier. That would explain why it isn't working, and I'll include it in the check. If your phone showed an error, a screenshot of it helps.");
    }
  }
  return p;
}
