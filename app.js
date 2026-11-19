import { checkAll, checkRequest, fmt } from "./check.js?v=1";
import { cases, example } from "./samples.js?v=1";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const icon = (name) => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
};
const glyph = { pass: "check", fail: "cross", none: "none" };
const wide = window.matchMedia("(min-width: 960px)");
const results = checkAll(cases);
let openId = null;

const draw = (node) => requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add("drawn")));

/** Text with the referenced ranges wrapped in an underline span. */
function marked(text, ranges) {
  const frag = document.createDocumentFragment();
  let at = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    if (r.start < at) continue;
    frag.append(text.slice(at, r.start), el("span", "u", text.slice(r.start, r.end)));
    at = r.end;
  }
  frag.append(text.slice(at));
  return frag;
}
const groupRefs = (refs) => {
  const by = new Map();
  for (const r of refs) {
    const k = `${r.doc}:${r.line}`;
    if (!by.has(k)) by.set(k, { doc: r.doc, line: r.line, ranges: [] });
    by.get(k).ranges.push(r);
  }
  return [...by.values()].sort((a, b) => (a.doc === b.doc ? a.line - b.line : a.doc === "ticket" ? -1 : 1));
};
const lineList = (refs) => {
  const g = groupRefs(refs);
  if (!g.length) return "No line";
  const log = g.filter((x) => x.doc === "log").map((x) => x.line + 1);
  const tk = g.some((x) => x.doc === "ticket");
  const parts = [];
  if (log.length) parts.push(`${log.length === 1 ? "Line" : "Lines"} ${log.join(", ")}`);
  if (tk) parts.push(log.length ? "the ticket" : "The ticket");
  return parts.join(" and ");
};

/* ---------- the ticket and the log inside one request ---------- */

function ticketDoc(r) {
  const box = el("div", "doc ticket");
  box.dataset.doc = "ticket";
  let head = true;
  r.ticket.lines.forEach((l, i) => {
    if (head && !l.trim()) { head = false; box.append(el("p", "gap")); return; }
    if (head && !/^(From|Received|Order|Subject):/i.test(l)) head = false;
    const p = el("p", head ? "hd" : "bd", l);
    p.dataset.line = i;
    box.append(p);
  });
  return box;
}
function logDoc(r) {
  const box = el("div", "doc log quiet");
  box.dataset.doc = "log";
  r.log.lines.forEach((l, i) => {
    const p = el("p");
    p.dataset.line = i;
    p.append(el("span", "ln", String(i + 1)), el("span", "tx", l));
    box.append(p);
  });
  return box;
}
/** Mark the lines a fact or flag came from, in this request's ticket and log. */
function markLines(box, r, refs) {
  for (const doc of box.querySelectorAll(".doc")) {
    const lines = doc.dataset.doc === "log" ? r.log.lines : r.ticket.lines;
    for (const p of doc.querySelectorAll("p[data-line]")) {
      if (!p.classList.contains("hit")) continue;
      p.classList.remove("hit");
      (p.querySelector(".tx") || p).replaceChildren(lines[+p.dataset.line]);
    }
    doc.classList.toggle("quiet", !refs.some((x) => x.doc === doc.dataset.doc));
  }
  for (const g of groupRefs(refs)) {
    const p = box.querySelector(`.doc[data-doc="${g.doc}"] p[data-line="${g.line}"]`);
    if (!p) continue;
    const lines = g.doc === "log" ? r.log.lines : r.ticket.lines;
    p.classList.add("hit");
    (p.querySelector(".tx") || p).replaceChildren(marked(lines[g.line], g.ranges));
    requestAnimationFrame(() => requestAnimationFrame(() => p.querySelectorAll(".u").forEach((u) => u.classList.add("on"))));
  }
}

function sources(r, refs) {
  const box = el("div");
  for (const g of groupRefs(refs)) {
    const f = el("div", "src");
    f.append(el("p", "src-h", g.doc === "log" ? `Log, line ${g.line + 1}` : "The ticket"));
    const lines = g.doc === "log" ? r.log.lines : r.ticket.lines;
    const p = el("p", `src-line ${g.doc}`);
    p.append(marked(lines[g.line], g.ranges));
    f.append(p);
    box.append(f);
  }
  return box;
}

/** An expandable row inside a request: a fact or a flag. */
function subRow(r, box, { state, word, glyphName, title, meta, text, refs }) {
  const li = el("li", "row-item sub-item");
  const b = el("button", "row");
  b.type = "button";
  b.setAttribute("aria-expanded", "false");
  const st = el("span", `status st-${state}`);
  st.append(icon(glyphName || glyph[state]), el("span", null, word));
  const val = el("span", "val");
  val.append(el("b", null, title), el("span", "meta", meta));
  const chev = icon("chev");
  chev.classList.add("chev");
  b.append(st, val, chev);
  let ev = null;
  b.addEventListener("click", () => {
    const open = b.getAttribute("aria-expanded") === "true";
    for (const other of box.querySelectorAll(".sub-item > .row[aria-expanded='true']")) if (other !== b) other.click();
    b.setAttribute("aria-expanded", String(!open));
    if (open) { ev?.remove(); ev = null; markLines(box, r, []); return; }
    ev = el("div", "evidence enter");
    ev.append(el("p", "fact-text", text));
    if (refs.length) {
      ev.append(sources(r, refs));
      const target = groupRefs(refs).find((g) => g.doc === "log") || groupRefs(refs)[0];
      const j = el("button", "btn text jump", target.doc === "log" ? `Show line ${target.line + 1} in the log` : "Show it in the ticket");
      j.type = "button";
      j.addEventListener("click", () => {
        const p = box.querySelector(`.doc[data-doc="${target.doc}"] p[data-line="${target.line}"]`);
        p?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
      ev.append(j);
    }
    li.append(ev);
    draw(ev);
    markLines(box, r, refs);
  });
  li.append(b);
  return li;
}

const FACT_WORD = { allows: ["pass", "Allows"], blocks: ["fail", "Blocks"], none: ["none", "Not found"] };

/** Everything about one request, result first. */
function detail(r, { own = false } = {}) {
  const box = el("div", "evidence");
  box.append(el("p", "side-h", `${own ? "Your ticket" : `Ticket from ${r.from}`}${r.received ? `, ${fmt(r.received)}` : ""}${r.order ? ` · ${r.order}` : ""}`));
  box.append(el("p", `side-title st-${r.state}`, r.label));
  const why = el("p", "reason");
  const g = icon(glyph[r.state]);
  g.style.color = `var(--${r.state})`;
  why.append(g, el("span", null, r.headline));
  box.append(why);
  const nx = el("p", "next");
  nx.append(el("b", null, "Next: "), r.next);
  box.append(nx);

  box.append(el("p", "ev-h", "The three facts the rule needs"));
  if (r.orderNote) box.append(el("p", "note", r.orderNote));
  const facts = el("ul", "rows sub-rows");
  for (const f of r.facts) {
    const [state, word] = FACT_WORD[f.effect];
    facts.append(subRow(r, box, { state, word, title: `${f.label}: ${f.value}`, meta: lineList(f.refs), text: f.text, refs: f.refs }));
  }
  box.append(facts);

  if (r.flags.length) {
    box.append(el("p", "ev-h", r.flags.length === 1 ? "One flag" : `${r.flags.length} flags`));
    const fl = el("ul", "rows sub-rows");
    for (const f of r.flags) {
      fl.append(subRow(r, box, { state: "none", word: f.escalate ? "Escalate" : "Flag", glyphName: f.escalate ? "none" : "flag", title: f.title, meta: lineList(f.refs), text: f.text, refs: f.refs }));
    }
    box.append(fl);
  }

  box.append(el("p", "ev-h", "Reply draft. A person reads and sends it."));
  const reply = el("div", "reply");
  for (const para of r.reply) {
    const p = el("p");
    // keep order numbers and times in one piece when the line wraps
    for (const part of para.split(/(\b[A-Z]{2,4}-\d{4,8}\b|\d{1,2} [A-Z][a-z]{2}, \d{2}:\d{2} UTC|\d{2}:\d{2} UTC)/)) {
      if (!part) continue;
      p.append(/^[A-Z]{2,4}-\d|\d{2}:\d{2} UTC$/.test(part) ? el("span", "nobr", part) : part);
    }
    reply.append(p);
  }
  box.append(reply);
  const act = el("div", "actions");
  const copy = el("button", "btn quiet", "Copy draft");
  copy.type = "button";
  const said = el("p", "copied", "");
  said.setAttribute("aria-live", "polite");
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(r.reply.join("\n\n"));
      said.textContent = "Copied.";
    } catch {
      said.textContent = "Copy is blocked here. Select the text instead.";
    }
  });
  act.append(copy, said);
  box.append(act);

  box.append(el("p", "ev-h", own ? "Your ticket" : "The ticket"));
  box.append(ticketDoc(r));
  box.append(el("p", "ev-h", own ? "Your order log" : "The order log, sample"));
  box.append(logDoc(r));
  return box;
}

function statusCell(r) {
  const st = el("span", `status st-${r.state}`);
  st.append(icon(glyph[r.state]), el("span", null, r.label));
  return st;
}

function render() {
  const n = (v) => results.filter((r) => r.verdict === v).length;
  $("summary").replaceChildren(
    el("span", "sum-main", `Refund: ${n("yes")} of ${results.length}`),
    el("span", "sum-side", `${n("no")} no, ${n("escalate")} to a person`),
  );
  const ul = $("list");
  ul.replaceChildren();
  if (wide.matches && !openId) openId = results[0].id;
  for (const r of results) {
    const li = el("li", "row-item");
    const b = el("button", "row");
    b.type = "button";
    b.setAttribute("aria-expanded", String(openId === r.id));
    const val = el("span", "val");
    const flagN = r.flags.length;
    const nb = (t) => t.replace(/ /g, "\u00a0");
    const plan = r.plan ? r.plan.split(" ").slice(0, 2).join(" ") : r.order ?? "no order";
    val.append(el("b", null, r.headline), el("span", "meta", `${nb(r.from ?? "No name")} · ${nb(plan)}${flagN ? ` · ${nb(`${flagN} flag${flagN === 1 ? "" : "s"}`)}` : ""}`));
    const chev = icon("chev");
    chev.classList.add("chev");
    b.append(statusCell(r), val, chev);
    b.addEventListener("click", () => {
      openId = openId === r.id && !wide.matches ? null : r.id;
      render();
      if (!wide.matches && openId) document.querySelector(`[data-id="${openId}"]`)?.scrollIntoView({ block: "nearest" });
    });
    li.dataset.id = r.id;
    li.append(b);
    if (openId === r.id && !wide.matches) {
      const d = detail(r);
      d.classList.add("enter");
      li.append(d);
      draw(d);
    }
    ul.append(li);
  }
  const side = $("side");
  if (wide.matches) {
    const d = detail(results.find((x) => x.id === openId));
    side.replaceChildren(d);
    side.scrollTop = 0;
    draw(d);
  } else side.replaceChildren();
}

/* ---------- check your own ---------- */
function checkOwn() {
  const ticket = $("own-ticket").value.trim();
  const log = $("own-log").value.trim();
  const err = $("own-error");
  const say = (t) => { err.textContent = t; err.hidden = false; };
  if (!ticket) return say("Paste a ticket first.");
  if (!log) return say("Paste the order log too. Without it every fact is not found.");
  if (ticket.length > 4000 || log.length > 20000) return say("That is longer than one ticket and one order log.");
  err.hidden = true;
  const r = checkRequest({ ticket, log });
  const d = detail(r, { own: true });
  d.classList.add("enter");
  $("own-out").replaceChildren(d);
  draw(d);
}

$("own-check").addEventListener("click", checkOwn);
$("own-sample").addEventListener("click", () => {
  $("own-ticket").value = example.ticket;
  $("own-log").value = example.log;
  checkOwn();
});
$("why-btn").addEventListener("click", () => {
  const b = $("why-btn");
  const open = b.getAttribute("aria-expanded") === "true";
  b.setAttribute("aria-expanded", String(!open));
  $("chain").hidden = open;
});
wide.addEventListener("change", () => render());
render();
