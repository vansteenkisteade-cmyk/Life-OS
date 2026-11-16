// Life OS – widgets & snel invoeren voor Scriptable (iPhone)
// Eén script voor alle widgets. Kies per widget het type via "Parameter":
//   kot · uitgave · inkomst · lijstje · taak · voorschot · overzicht
// Tik op een widget → je vult meteen bedrag/omschrijving in → opgeslagen in je Life OS.
 
const APP_URL = "https://vansteenkisteade-cmyk.github.io/Life-OS/";
const KC = "lifeos.";              // sleutelhanger-prefix
const TYPES = {
  kot:       {label: "Kot",        symbol: "cart.fill",              color: "#2a78d6"},
  uitgave:   {label: "Uitgave",    symbol: "creditcard.fill",        color: "#d95926"},
  inkomst:   {label: "Inkomst",    symbol: "eurosign.circle.fill",   color: "#0ca30c"},
  lijstje:   {label: "Lijstje",    symbol: "checklist",              color: "#6250d6"},
  taak:      {label: "Taak",       symbol: "checkmark.circle.fill",  color: "#2f2e2b"},
  voorschot: {label: "Voorschot",  symbol: "person.2.fill",          color: "#c98500"},
  overzicht: {label: "Life OS",    symbol: "square.grid.2x2.fill",   color: "#2f2e2b"}
};
 
/* ---------------- hulpfuncties ---------------- */
const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const addDays = (s, n) => { const [y, m, d] = s.split("-").map(Number); const x = new Date(y, m - 1, d + n); return iso(x); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const r2 = v => (Math.round(v * 100) / 100) || 0;
const eur = v => "€ " + (Math.round((v || 0) * 100) / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const parseAmount = s => { s = String(s || "").trim().replace(/[€\s]/g, ""); if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); const v = parseFloat(s); return isFinite(v) ? r2(v) : NaN; };
const capName = s => String(s || "").trim().replace(/\s+/g, " ").replace(/(^|\s)\S/g, m => m.toUpperCase());
const ucf = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
 
/* Firestore REST-waarden ⇄ gewone JS-objecten */
function enc(v) {
  if (v === null || v === undefined) return {nullValue: null};
  if (typeof v === "boolean") return {booleanValue: v};
  if (typeof v === "number") return Number.isInteger(v) ? {integerValue: String(v)} : {doubleValue: v};
  if (typeof v === "string") return {stringValue: v};
  if (Array.isArray(v)) return v.length ? {arrayValue: {values: v.map(enc)}} : {arrayValue: {}};
  const fields = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) fields[k] = enc(x);
  return {mapValue: {fields}};
}
function dec(v) {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = dec(x); return o; }
  return null;
}
const decDoc = doc => dec({mapValue: {fields: doc.fields || {}}});
 
/* ---------------- instellingen & login ---------------- */
const kcGet = k => Keychain.contains(KC + k) ? Keychain.get(KC + k) : null;
const kcSet = (k, v) => Keychain.set(KC + k, v);
 
async function ask(title, message, fields, okLabel = "OK") {
  const a = new Alert(); a.title = title; if (message) a.message = message;
  fields.forEach(f => { const tf = f.secure ? a.addSecureTextField(f.placeholder || "", f.value || "") : a.addTextField(f.placeholder || "", f.value || ""); if (f.decimal) tf.setDecimalPadKeyboard(); if (f.email) tf.setEmailAddressKeyboard(); });
  a.addAction(okLabel); a.addCancelAction("Annuleer");
  const i = await a.presentAlert(); if (i === -1) return null;
  return fields.map((_, j) => a.textFieldValue(j));
}
async function choose(title, options, message) {
  const a = new Alert(); a.title = title; if (message) a.message = message;
  options.forEach(o => a.addAction(o)); a.addCancelAction("Annuleer");
  const i = await a.presentSheet(); return i === -1 ? null : i;
}
async function info(title, message) { const a = new Alert(); a.title = title; a.message = message || ""; a.addAction("OK"); await a.presentAlert(); }
 
async function setup() {
  // stap 1: Firebase-config (uit config.js)
  const cfg = await ask("Life OS koppelen", "Plak je apiKey en projectId uit config.js (stap 4 van het stappenplan).", [{placeholder: "apiKey (AIza…)", value: kcGet("apiKey") || ""}, {placeholder: "projectId", value: kcGet("projectId") || ""}], "Volgende");
  if (!cfg) return false;
  const apiKey = cfg[0].trim().replace(/["',]/g, ""), projectId = cfg[1].trim().replace(/["',]/g, "");
  if (!apiKey || !projectId) { await info("Ontbreekt", "Vul zowel apiKey als projectId in."); return false; }
  // stap 2: inloggen met je Life OS-account
  const cred = await ask("Inloggen", "Met hetzelfde e-mailadres en wachtwoord als in de Life OS-app. Je wachtwoord wordt niet bewaard.", [{placeholder: "E-mailadres", email: true}, {placeholder: "Wachtwoord", secure: true}], "Inloggen");
  if (!cred) return false;
  const req = new Request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`);
  req.method = "POST"; req.headers = {"Content-Type": "application/json"};
  req.body = JSON.stringify({email: cred[0].trim(), password: cred[1], returnSecureToken: true});
  const res = await req.loadJSON();
  if (!res.idToken) { await info("Inloggen mislukt", (res.error && res.error.message) || "Controleer je gegevens."); return false; }
  kcSet("apiKey", apiKey); kcSet("projectId", projectId); kcSet("refresh", res.refreshToken); kcSet("uid", res.localId);
  await info("Gekoppeld ✓", "Je widgets tonen nu je Life OS-gegevens.");
  return true;
}
let TOKEN = null;
async function token() {
  if (TOKEN) return TOKEN;
  const apiKey = kcGet("apiKey"), refresh = kcGet("refresh"); if (!apiKey || !refresh) return null;
  const req = new Request(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`);
  req.method = "POST"; req.headers = {"Content-Type": "application/x-www-form-urlencoded"};
  req.body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}`;
  const res = await req.loadJSON();
  if (!res.id_token) return null;
  if (res.refresh_token) kcSet("refresh", res.refresh_token);
  TOKEN = res.id_token; return TOKEN;
}
const docUrl = name => `https://firestore.googleapis.com/v1/projects/${kcGet("projectId")}/databases/(default)/documents/users/${kcGet("uid")}/docs/${name}`;
async function getDoc(name) {
  const req = new Request(docUrl(name)); req.headers = {Authorization: "Bearer " + await token()};
  const res = await req.loadJSON();
  if (req.response.statusCode === 404) return {data: null, updateTime: null};
  if (req.response.statusCode >= 300) throw new Error((res.error && res.error.message) || "Lezen mislukt (" + req.response.statusCode + ")");
  return {data: decDoc(res), updateTime: res.updateTime};
}
// lees–wijzig–schrijf met controle: als de app intussen iets wijzigde, opnieuw proberen
async function updateDoc(name, change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const {data, updateTime} = await getDoc(name);
    const next = change(data ? JSON.parse(JSON.stringify(data)) : null);
    const pre = updateTime ? `currentDocument.updateTime=${encodeURIComponent(updateTime)}` : "currentDocument.exists=false";
    const req = new Request(docUrl(name) + "?" + pre);
    req.method = "PATCH"; req.headers = {Authorization: "Bearer " + await token(), "Content-Type": "application/json"};
    req.body = JSON.stringify({fields: enc(next).mapValue.fields});
    const res = await req.loadJSON();
    if (req.response.statusCode < 300) return next;
    const st = res.error && res.error.status;
    if (!["FAILED_PRECONDITION", "ALREADY_EXISTS", "ABORTED", "NOT_FOUND"].includes(st)) throw new Error((res.error && res.error.message) || "Opslaan mislukt (" + req.response.statusCode + ")");
  }
  throw new Error("Opslaan lukte niet (te veel gelijktijdige wijzigingen). Probeer opnieuw.");
}
const pushItem = (name, item) => updateDoc(name, d => { d = d || {items: []}; d.items = d.items || []; d.items.push(item); return d; });
 
/* ---------------- gegevens voor de widgets ---------------- */
async function loadAll() {
  const month = today().slice(0, 7);
  const [settings, tasks, kot, others, day, tx] = await Promise.all(["settings", "tasks", "kot", "others", "day", "tx-" + month].map(n => getDoc(n).then(r => r.data).catch(() => null)));
  return {settings: settings || {}, tasks: (tasks && tasks.items) || [], kot: kot || {items: [], statements: [], payments: []}, others: (others && others.items) || [], day: (day && day.items) || [], tx: (tx && tx.items) || []};
}
function kotOpen(k) {
  const items = k.items || [], ids = new Set((k.statements || []).map(s => s.id));
  const claimed = items.filter(i => i.statementId && ids.has(i.statementId)).reduce((a, i) => a + i.amount, 0);
  const paid = (k.payments || []).reduce((a, p) => a + p.amount, 0);
  const unclaimed = items.filter(i => !i.statementId && !i.excluded && !i.settled).reduce((a, i) => a + i.amount, 0);
  return r2(claimed - paid + unclaimed);
}
function stats(D) {
  const t = today();
  const openTasks = D.tasks.filter(x => x.status !== "Klaar" && x.deadline).sort((a, b) => (a.deadline + (a.time || "")).localeCompare(b.deadline + (b.time || "")));
  const get = r2(D.others.filter(i => !i.paid && i.dir !== "out").reduce((a, i) => a + i.amount, 0));
  const owe = r2(D.others.filter(i => !i.paid && i.dir === "out").reduce((a, i) => a + i.amount, 0));
  return {
    kot: kotOpen(D.kot),
    out: r2(D.tx.filter(x => x.kind === "out").reduce((a, x) => a + x.amount, 0)),
    in: r2(D.tx.filter(x => x.kind === "in").reduce((a, x) => a + x.amount, 0)),
    list: D.day.filter(i => !i.done && i.date === t),
    late: openTasks.filter(x => x.deadline < t).length,
    next: openTasks.filter(x => x.deadline >= t).slice(0, 6),
    get, owe
  };
}
const dueLabel = d => { const t = today(); if (d === t) return "vandaag"; if (d === addDays(t, 1)) return "morgen"; return d.slice(8, 10) + "/" + d.slice(5, 7); };
 
/* ---------------- widget tekenen ---------------- */
const C = {bg: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")), text: Color.dynamic(new Color("#2f2e2b"), new Color("#ecebe7")), muted: Color.dynamic(new Color("#6b6a66"), new Color("#a5a49e"))};
const tint = type => { const c = (TYPES[type] || TYPES.overzicht).color; return c === "#2f2e2b" ? C.text : new Color(c); };
const runUrl = type => `scriptable:///run/${encodeURIComponent(Script.name())}?type=${type}`;
function header(w, type, size) {
  const T = TYPES[type] || TYPES.overzicht;
  const st = w.addStack(); st.centerAlignContent();
  const img = st.addImage(SFSymbol.named(T.symbol).image); img.imageSize = new Size(size, size); img.tintColor = tint(type);
  st.addSpacer(6);
  const tx = st.addText(T.label); tx.font = Font.boldSystemFont(size * 0.8); tx.textColor = C.text;
}
function line(w, text, size = 12, color = C.muted, bold = false) { const t = w.addText(text); t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size); t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = 0.7; return t; }
async function buildWidget(type) {
  const w = new ListWidget(); w.backgroundColor = C.bg; w.setPadding(14, 14, 14, 14);
  w.url = type === "overzicht" ? APP_URL + "#snel" : `scriptable:///run/${encodeURIComponent(Script.name())}?type=${type}`;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (!kcGet("refresh")) { header(w, type, 18); w.addSpacer(); line(w, "Tik om te koppelen", 12, C.muted); w.url = `scriptable:///run/${encodeURIComponent(Script.name())}`; return w; }
  let S = null; try { S = stats(await loadAll()); } catch (e) { S = null; }
  const fam = config.widgetFamily || "small";
  if (type === "overzicht" || fam === "medium" || fam === "large") { await bigWidget(w, S, fam); return w; }
  smallWidget(w, type, S);
  return w;
}
 
 
 
/* kleine widget: één soort, één cijfer, één knop */
function smallWidget(w, type, S) {
  w.setPadding(14, 14, 12, 14);
  const top = w.addStack(); top.centerAlignContent();
  const ic = top.addStack(); ic.size = new Size(26, 26); ic.cornerRadius = 8; ic.backgroundColor = soft(type, 0.18); ic.centerAlignContent();
  sym(ic, TYPES[type].symbol, 13, tint(type));
  top.addSpacer(7); txt(top, TYPES[type].label, 13, C.text, 7);
  w.addSpacer();
  if (!S) { txt(w, "Geen verbinding", 12, C.muted); }
  else if (type === "lijstje") {
    if (S.list.length) { S.list.slice(0, 3).forEach(i => todo(w, i.text)); if (S.list.length > 3) txt(w, `+${S.list.length - 3} meer`, 10, C.muted); }
    else { txt(w, "Alles gedaan", 15, C.text, 7); txt(w, "niets meer voor vandaag", 10, C.muted); }
  } else if (type === "taak") {
    const x = S.next[0];
    if (x) { const t = w.addText(x.title); t.font = Font.boldSystemFont(14); t.textColor = C.text; t.lineLimit = 2; t.minimumScaleFactor = 0.8; w.addSpacer(4);
      const soon = x.deadline <= addDays(today(), 1);
      const r = w.addStack(); const pill = r.addStack(); pill.setPadding(2, 6, 2, 6); pill.cornerRadius = 6;
      pill.backgroundColor = soon ? new Color("#e5484d", 0.16) : SURF;
      txt(pill, dueLabel(x.deadline) + (x.time ? " · " + x.time : ""), 10, soon ? RED : C.muted, 6); w.addSpacer(3); }
    else { txt(w, "Geen deadlines", 14, C.text, 7); }
    if (S.late) txt(w, `${S.late} te laat`, 10, RED, 6);
  } else {
    const val = type === "kot" ? eur(S.kot) : type === "uitgave" ? eur(S.out) : type === "inkomst" ? eur(S.in) : (S.get ? "+" + eur(S.get) : S.owe ? "−" + eur(S.owe) : eur(0));
    const sub = type === "kot" ? "terug van mama" : type === "uitgave" ? "uitgegeven deze maand" : type === "inkomst" ? "verdiend deze maand" : (S.get && S.owe ? `jij moet ${eur(S.owe)}` : S.owe ? "jij moet nog" : "te krijgen");
    txt(w, val, 24, C.text, 7); txt(w, sub, 10, C.muted, 5);
  }
  w.addSpacer(8);
  const btn = w.addStack(); btn.backgroundColor = soft(type, 0.16); btn.cornerRadius = 10; btn.setPadding(6, 8, 6, 8); btn.centerAlignContent();
  btn.addSpacer(); sym(btn, "plus", 10, tint(type)); btn.addSpacer(4); txt(btn, "Toevoegen", 11, C.text, 7); btn.addSpacer();
}
 
/* middelgrote en grote widget: overzicht + snelknoppen */
const RED = new Color("#e5484d");
const soft = (t, a) => { const c = (TYPES[t] || TYPES.overzicht).color; return c === "#2f2e2b" ? Color.dynamic(new Color("#2f2e2b", a), new Color("#ecebe7", a)) : new Color(c, a); };
const SURF = Color.dynamic(new Color("#f4f4f2"), new Color("#2a2a2c"));
function sym(st, name, size, color) { const i = st.addImage(SFSymbol.named(name).image); i.imageSize = new Size(size, size); i.tintColor = color; return i; }
function txt(st, s, size, color, weight) {
  const t = st.addText(s); t.font = weight === 7 ? Font.boldSystemFont(size) : weight === 6 ? Font.semiboldSystemFont(size) : weight === 5 ? Font.mediumSystemFont(size) : Font.systemFont(size);
  t.textColor = color || C.text; t.lineLimit = 1; t.minimumScaleFactor = 0.75; return t;
}
function section(st, title, color, extra) {
  const r = st.addStack(); r.centerAlignContent();
  const dot = r.addStack(); dot.size = new Size(6, 6); dot.cornerRadius = 3; dot.backgroundColor = color; r.addSpacer(5);
  const t = txt(r, title.toUpperCase(), 9, C.muted, 6);
  if (extra) { r.addSpacer(4); txt(r, extra, 9, RED, 6); }
  st.addSpacer(4);
}
function todo(st, text) {
  const r = st.addStack(); r.centerAlignContent();
  sym(r, "circle", 10, C.muted); r.addSpacer(6); txt(r, text, 12, C.text);
  st.addSpacer(3);
}
function due(st, x) {
  const r = st.addStack(); r.centerAlignContent();
  const t = today(), soon = x.deadline <= addDays(t, 1);
  txt(r, x.title, 12, C.text); r.addSpacer(5);
  const pill = r.addStack(); pill.setPadding(1, 5, 1, 5); pill.cornerRadius = 5;
  pill.backgroundColor = soon ? new Color("#e5484d", 0.16) : SURF;
  txt(pill, dueLabel(x.deadline), 9, soon ? RED : C.muted, 6);
  st.addSpacer(3);
}
function statTile(st, type, value, label, large) {
  const b = st.addStack(); b.url = runUrl(type); b.centerAlignContent();
  b.backgroundColor = SURF; b.cornerRadius = 12; b.setPadding(large ? 7 : 5, 8, large ? 7 : 5, 8);
  const ic = b.addStack(); ic.size = new Size(large ? 24 : 20, large ? 24 : 20); ic.cornerRadius = large ? 7 : 6; ic.backgroundColor = soft(type, 0.18); ic.centerAlignContent();
  sym(ic, TYPES[type].symbol, large ? 12 : 10, tint(type));
  b.addSpacer(7);
  const col = b.addStack(); col.layoutVertically();
  txt(col, value, large ? 15 : 13, C.text, 7);
  txt(col, label, 9, C.muted, 4);
  b.addSpacer();
  return b;
}
function buttons(w, types, tall) {
  const row = w.addStack(); row.spacing = 6;
  types.forEach(t => {
    const b = row.addStack(); b.url = runUrl(t); b.centerAlignContent();
    b.backgroundColor = soft(t, tall ? 0.2 : 0.14); b.cornerRadius = tall ? 12 : 10; b.setPadding(tall ? 9 : 6, 6, tall ? 9 : 6, 6);
    b.addSpacer();
    sym(b, tall ? "plus.circle.fill" : TYPES[t].symbol, tall ? 14 : 11, tint(t));
    b.addSpacer(4);
    txt(b, TYPES[t].label, tall ? 13 : 10, C.text, tall ? 7 : 6);
    b.addSpacer();
  });
}
async function bigWidget(w, S, fam) {
  const large = fam === "large";
  w.url = APP_URL;
  w.setPadding(large ? 16 : 12, 15, large ? 14 : 11, 15);
  const top = w.addStack(); top.centerAlignContent();
  const logo = top.addStack(); logo.size = new Size(18, 18); logo.cornerRadius = 5; logo.backgroundColor = C.text; logo.centerAlignContent();
  sym(logo, "bolt.fill", 10, C.bg);
  top.addSpacer(6); txt(top, "Life OS", 13, C.text, 7);
  top.addSpacer();
  const d = new Date(); txt(top, d.toLocaleDateString("nl-BE", {weekday: "long", day: "numeric", month: "short"}), 10, C.muted, 5);
  w.addSpacer(large ? 12 : 6);
  if (!S) { txt(w, "Geen verbinding · tik om opnieuw te proberen", 12, C.muted); w.addSpacer(); return; }
  const body = w.addStack(); body.topAlignContent();
  const left = body.addStack(); left.layoutVertically();
  section(left, "Vandaag", tint("lijstje"));
  const nL = large ? 5 : 2;
  if (S.list.length) S.list.slice(0, nL).forEach(i => todo(left, i.text));
  else { txt(left, "Alles gedaan ✓", 12, C.muted); left.addSpacer(3); }
  if (large && S.list.length > nL) { txt(left, `+${S.list.length - nL} meer`, 10, C.muted); left.addSpacer(3); }
  left.addSpacer(large ? 10 : 4);
  section(left, "Deadlines", tint("taak"), S.late ? `${S.late} te laat` : "");
  const nD = large ? 5 : 1;
  if (S.next.length) S.next.slice(0, nD).forEach(x => due(left, x));
  else txt(left, "Geen deadlines", 12, C.muted);
  body.addSpacer(10);
  const right = body.addStack(); right.layoutVertically(); right.spacing = large ? 6 : 4; right.size = new Size(large ? 128 : 112, 0);
  statTile(right, "kot", eur(S.kot), large ? "terug van mama" : "kot", large);
  if (large || !(S.get || S.owe)) statTile(right, "uitgave", eur(S.out), "uitgegeven", large);
  if (S.get || S.owe) statTile(right, "voorschot", S.get ? "+" + eur(S.get) : "−" + eur(S.owe), S.get ? (S.owe && large ? `jij −${eur(S.owe)}` : "te krijgen") : "jij moet nog", large);
  if (large) statTile(right, "inkomst", eur(S.in), "verdiend", large);
  w.addSpacer();
  if (large) { buttons(w, ["uitgave", "inkomst", "lijstje", "voorschot"]); w.addSpacer(6); buttons(w, ["kot", "taak"], true); }
  else buttons(w, ["kot", "uitgave", "taak", "lijstje"]);
}
 
/* ---------------- invoeren (mooi formulier) ---------------- */
const guessOwnCat = (desc, cats) => { if (/caf|resto|eten|drink|drank|bar|pint|bier|cola|koffie|friet|frit|pizza|lunch|kebab|snack|burger|sushi/i.test(desc || "") && cats.includes("Eten buitenshuis")) return "Eten buitenshuis"; return cats.includes("Vrije tijd") ? "Vrije tijd" : cats[0]; };
const domainOf = (list, name) => ((list || []).find(c => c.name === name) || {}).domain || "Privé";
 
/* opslaan per soort (zelfde gegevens als de app) */
async function saveKot(d) {
  const item = {id: uid(), date: d.date || today(), amount: d.amount, cat: d.cat, desc: ucf((d.desc || "").trim()), statementId: "", excluded: false, settled: !!d.settled};
  await pushItem("kot", item);
  return `Kot · ${d.cat} · ${eur(d.amount)}${item.desc ? " · " + item.desc : ""}${d.settled ? " · al terugbetaald" : ""}`;
}
async function saveMoney(d, settings, kind) {
  const list = kind === "in" ? (settings.incomeCats || []) : (settings.expenseCats || []);
  const desc = ucf((d.desc || "").trim()) || d.cat;
  const tx = {id: uid(), kind, date: d.date || today(), amount: d.amount, desc, cat: d.cat, party: "", method: "Bank", domain: domainOf(list, d.cat), note: "", taskId: "", hours: kind === "in" && d.cat === "Studentenjob" && d.hours ? d.hours : null};
  await pushItem("tx-" + tx.date.slice(0, 7), tx);
  return `${kind === "in" ? "Inkomst" : "Uitgave"} · ${d.cat} · ${eur(d.amount)}${desc !== d.cat ? " · " + desc : ""}`;
}
async function saveList(d) {
  const text = ucf(d.text.trim());
  await pushItem("day", {id: uid(), text, date: d.date, done: false, taskId: ""});
  return `Lijstje ${d.date === today() ? "vandaag" : "morgen"} · ${text}`;
}
async function saveTask(d) {
  const t = {id: uid(), title: ucf(d.title.trim()), deadline: d.date || "", cat: d.cat, type: "indienen", client: "", amount: null, priority: d.urgent ? "Hoog" : "Middel", status: "Te doen", note: "", reminder: !!d.reminder, time: d.time || ""};
  await pushItem("tasks", t);
  return `Taak · ${t.title}${t.deadline ? " · " + dueLabel(t.deadline) : ""}${t.time ? " om " + t.time : ""}`;
}
async function saveOthers(d, settings) {
  const debt = d.dir === "out", names = d.names, amount = d.amount, desc = (d.desc || "").trim(), date = d.date || today();
  const cat = d.cat || guessOwnCat(desc, (settings.expenseCats || []).map(c => c.name));
  const month = "tx-" + date.slice(0, 7);
  const items = names.map(p => ({id: uid(), dir: debt ? "out" : "in", date, amount, person: p, desc, note: "", paid: false, paidDate: ""}));
  if (d.withMe) {
    if (debt) {
      const txs = items.map(it => { const tx = {id: uid(), kind: "out", date, amount, desc: `${ucf(desc) || "Schuld"} (betaald door ${it.person})`, cat, party: it.person, method: "Bank", domain: domainOf(settings.expenseCats, cat), note: "Schuld: " + it.person + " schoot voor", taskId: "", hours: null}; it.txId = tx.id; return tx; });
      await updateDoc(month, x => { x = x || {items: []}; x.items = (x.items || []).concat(txs); return x; });
    } else {
      const tx = {id: uid(), kind: "out", date, amount, desc: `${ucf(desc) || "Gedeelde rekening"} (mijn deel)`, cat, party: "", method: "Bank", domain: domainOf(settings.expenseCats, cat), note: "Mijn deel, samen met " + names.join(", "), taskId: "", hours: null};
      items.forEach(it => it.shareTxId = tx.id);
      await pushItem(month, tx);
    }
  }
  await updateDoc("others", x => { x = x || {items: []}; x.items = (x.items || []).concat(items); return x; });
  return `${debt ? "Schuld aan" : "Voorschot voor"} ${names.join(", ")} · ${eur(amount)}${names.length > 1 ? " p.p." : ""}${d.withMe ? " · eigen deel als uitgave" : ""}`;
}
 
/* het formulier (HTML in Scriptable) */
function formHTML(type, ctx) {
  const T = TYPES[type];
  return `<!DOCTYPE html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<style>
:root{--bg:#fbfbfa;--surface:#fff;--s2:#f2f2f0;--border:#e5e4e0;--text:#2f2e2b;--t2:#6b6a66;--t3:#9b9a96;--accent:${T.color};--ok:#0a8a0a;--okbg:#e5f3e5;--warn:#c03030}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--surface:#1f1f1e;--s2:#2a2a28;--border:#363632;--text:#ecebe7;--t2:#b3b2ab;--t3:#85847e;--okbg:#18301a;--ok:#4cc24c;--warn:#f08a8a}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.4 -apple-system,system-ui,sans-serif;padding:64px 18px calc(110px + env(safe-area-inset-bottom))}
h1{font-size:26px;margin:4px 0 2px;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
h1 i{width:12px;height:12px;border-radius:4px;background:var(--accent);display:inline-block}
.sub{color:var(--t2);font-size:14px;margin-bottom:18px}
label.l{display:block;font-size:13px;font-weight:600;color:var(--t2);margin:16px 0 6px}
.amount{width:100%;border:0;border-bottom:2px solid var(--border);background:none;font-size:42px;font-weight:700;letter-spacing:-.02em;color:var(--text);padding:6px 0;font-variant-numeric:tabular-nums}
.amount:focus{outline:none;border-color:var(--accent)}
input.t,select.t{width:100%;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:12px;padding:12px 14px;font-size:17px}
input.t:focus{outline:2px solid var(--accent);border-color:transparent}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:999px;padding:9px 15px;font-size:15px;font-weight:500}
.chip.on{background:var(--text);color:var(--bg);border-color:var(--text)}
.chip:active,.btn:active,.card:active{transform:scale(.97)}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.card{border:1.5px solid var(--border);background:var(--surface);border-radius:14px;padding:12px;text-align:left;color:var(--text)}
.card b{display:block;font-size:16px}.card span{font-size:13px;color:var(--t2)}
.card.on{border-color:var(--text);background:var(--s2)}
.row{display:flex;gap:8px;align-items:center}
.split{display:flex;gap:8px;align-items:center;font-size:14px;color:var(--t2)}
.split input{width:96px;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:10px;padding:9px;font-size:16px}
.check{display:flex;gap:10px;align-items:flex-start;background:var(--s2);border-radius:12px;padding:12px;margin-top:14px;font-size:15px}
.check input{width:22px;height:22px;margin:0;accent-color:var(--accent)}
.bar{position:fixed;left:0;right:0;bottom:0;padding:12px 18px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 30%)}
.btn{width:100%;border:0;border-radius:14px;padding:16px;font-size:18px;font-weight:700;background:var(--text);color:var(--bg)}
.btn:disabled{opacity:.35}
.err{color:var(--warn);font-size:14px;min-height:20px;margin-top:10px}
.done{display:none;text-align:center;padding:40px 10px}
.done .tick{width:64px;height:64px;border-radius:50%;background:var(--okbg);color:var(--ok);display:grid;place-items:center;font-size:34px;margin:0 auto 14px}
.done p{color:var(--t2);margin:6px 0 22px}
.hidden{display:none}
.seg3{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;background:var(--s2);border-radius:12px;padding:4px;margin-bottom:18px}
.seg3 button{border:0;background:none;color:var(--t2);border-radius:9px;padding:10px 4px;font-size:14px;font-weight:600}
.seg3 button.on{background:var(--surface);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.15)}
</style></head><body>
<script>window.onerror=function(m,u,l){document.body.insertAdjacentHTML("afterbegin","<p style=\\"color:#f08a8a\\">Fout: "+m+" (regel "+l+")</p>")};</script>
<form id="f" autocomplete="off" onsubmit="return false">
<h1><i id="dot"></i><span id="ttl"></span></h1><div class="sub" id="sub"></div><div id="sw"></div>
<div id="fields"></div>
<div class="err" id="err"></div>
<div class="bar"><button class="btn" id="save" type="submit">Opslaan</button></div>
</form>
<div class="done" id="done"><div class="tick">✓</div><h2 style="margin:0">Opgeslagen</h2><p id="doneTxt"></p>
<div class="bar" style="position:static;background:none;padding:0"><button class="btn" id="again">Nog één toevoegen</button><p style="font-size:13px;color:var(--t3);margin-top:14px">Klaar? Veeg dit venster naar beneden.</p></div></div>
<script>
const CTX = ${JSON.stringify(ctx)}, ORIG = ${JSON.stringify(type)}; let TYPE = ORIG;
const TITLES = {kot:"Kot",uitgave:"Uitgave",inkomst:"Inkomst",lijstje:"Lijstje",taak:"Taak",voorschot:"Voorschot of schuld"};
const $ = s => document.querySelector(s);
const st = {cat: CTX.defaultCat || "", date: CTX.today, dir: "in", settled: false, urgent: false};
const parseAmount = s => { s = String(s || "").trim().replace(/[€\\s]/g, ""); if (s.includes(",")) s = s.replace(/\\./g, "").replace(",", "."); const v = parseFloat(s); return isFinite(v) ? Math.round(v * 100) / 100 : NaN; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const chips = (name, opts, cur) => '<div class="chips" data-g="' + name + '">' + opts.map(o => '<button type="button" class="chip' + (o[0] === cur ? " on" : "") + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>').join("") + '</div>';
const dates = (past) => past ? [[CTX.today, "Vandaag"], [CTX.yesterday, "Gisteren"], [CTX.dayBefore, "Eergisteren"]] : [[CTX.today, "Vandaag"], [CTX.tomorrow, "Morgen"], [CTX.dayAfter, "Overmorgen"], [CTX.nextWeek, "Volgende week"], ["", "Geen datum"]];
function draw() {
  let h = ""; const keepAmt = $("#amount") ? $("#amount").value : "", keepDesc = $("#desc") ? $("#desc").value : "";
  $("#ttl").textContent = ORIG === "kot" ? (TYPE === "kot" ? "Kot" : st.dir === "out" ? "Schuld bij iemand" : "Voorschot voor iemand") : TITLES[TYPE];
  $("#dot").style.background = TYPE === "kot" ? "" : (CTX.othersColor || "");
  $("#sw").innerHTML = ORIG !== "kot" ? "" : '<div class="seg3">' + [["kot", "Kot · " + CTX.recipient], ["in", "Voorschot"], ["out", "Schuld"]].map(o => '<button type="button" data-sw="' + o[0] + '" class="' + ((TYPE === "kot" ? "kot" : st.dir) === o[0] ? "on" : "") + '">' + esc(o[1]) + '</button>').join("") + '</div>';
  if (TYPE === "kot") { $("#sub").textContent = "Voorgeschoten voor " + CTX.recipient;
    h = '<input class="amount" id="amount" inputmode="decimal" placeholder="€ 0,00">' +
      '<label class="l">Categorie</label>' + chips("cat", CTX.cats.map(c => [c, c]), st.cat) +
      '<label class="l">Omschrijving (optioneel)</label><input class="t" id="desc" placeholder="bv. Colruyt">' +
      '<label class="l">Wanneer</label>' + chips("date", dates(true), st.date) +
      '<label class="check"><input type="checkbox" id="settled"><span>Al terugbetaald door ' + esc(CTX.recipient) + '</span></label>';
  } else if (TYPE === "uitgave" || TYPE === "inkomst") { $("#sub").textContent = TYPE === "inkomst" ? "Geld dat binnenkwam" : "Iets dat je zelf betaalde";
    h = '<input class="amount" id="amount" inputmode="decimal" placeholder="€ 0,00">' +
      '<label class="l">Omschrijving</label><input class="t" id="desc" placeholder="' + (TYPE === "inkomst" ? "bv. shift zaterdag" : "bv. Delhaize") + '">' +
      '<label class="l">Categorie</label>' + chips("cat", CTX.cats.map(c => [c, c]), st.cat) +
      '<div id="hoursWrap" class="' + (st.cat === "Studentenjob" ? "" : "hidden") + '"><label class="l">Gewerkte uren</label><input class="t" id="hours" inputmode="decimal" placeholder="bv. 8"></div>' +
      '<label class="l">Wanneer</label>' + chips("date", dates(true), st.date);
  } else if (TYPE === "lijstje") { $("#sub").textContent = "Kort iets voor vandaag of morgen";
    h = '<input class="t" id="text" placeholder="bv. boodschappen doen" style="font-size:20px;padding:14px">' +
      '<label class="l">Voor wanneer</label>' + chips("date", [[CTX.today, "Vandaag"], [CTX.tomorrow, "Morgen"]], st.date);
  } else if (TYPE === "taak") { $("#sub").textContent = "Met deadline en eventueel een herinnering";
    h = '<input class="t" id="title" placeholder="Wat moet er gebeuren?" style="font-size:20px;padding:14px">' +
      '<label class="l">Deadline</label>' + chips("date", dates(false), st.date) +
      '<label class="l">Herinnering om (optioneel)</label><input class="t" id="time" type="time">' +
      '<label class="l">Categorie</label>' + chips("cat", CTX.cats.map(c => [c, c]), st.cat) +
      '<label class="check"><input type="checkbox" id="urgent"><span>Dringend (prioriteit Hoog)</span></label>';
  } else if (TYPE === "voorschot") { $("#sub").textContent = "Met vrienden of anderen";
    h = (ORIG === "kot" ? "" : '<div class="cards"><button type="button" class="card' + (st.dir === "in" ? " on" : "") + '" data-dir="in"><b>Voorschot</b><span>Ik betaalde · zij moeten mij</span></button><button type="button" class="card' + (st.dir === "out" ? " on" : "") + '" data-dir="out"><b>Schuld</b><span>Zij betaalden · ik moet hen</span></button></div>') +
      '<label class="l">Bedrag per persoon</label><input class="amount" id="amount" inputmode="decimal" placeholder="€ 0,00" style="font-size:36px">' +
      '<div class="split" style="margin-top:10px">Rekening delen: <input id="tot" inputmode="decimal" placeholder="totaal €"> ÷ <input id="n" inputmode="numeric" placeholder="pers." style="width:70px"></div>' +
      '<label class="l" id="whoL">' + (st.dir === "out" ? "Aan wie moet je terugbetalen" : "Wie moet jou terugbetalen") + '</label><input class="t" id="names" placeholder="bv. Lotte, Jens">' +
      (CTX.persons.length ? '<div class="chips" style="margin-top:8px" id="pp">' + CTX.persons.slice(0, 10).map(p => '<button type="button" class="chip" data-p="' + esc(p) + '">' + esc(p) + '</button>').join("") + '</div>' : "") +
      '<label class="l">Waarvoor</label><input class="t" id="desc" placeholder="bv. café, tickets">' +
      '<label class="check"><input type="checkbox" id="withMe"' + (st.dir === "out" ? " checked" : "") + '><span id="withMeL">' + (st.dir === "out" ? "Ook als uitgave bij Financiën (het was voor jezelf)" : "Ik deed zelf ook mee: mijn deel als uitgave") + '</span></label>' +
      '<label class="l">Categorie van de uitgave</label><select class="t" id="cat">' + CTX.expenseCats.map(c => '<option' + (c === CTX.ownCat ? " selected" : "") + '>' + esc(c) + '</option>').join("") + '</select>';
  }
  $("#fields").innerHTML = h;
  if (keepAmt && $("#amount")) $("#amount").value = keepAmt; if (keepDesc && $("#desc")) $("#desc").value = keepDesc;
  wire(); validate();
  const first = $("#amount") || $("#text") || $("#title"); if (first) setTimeout(() => first.focus(), 250);
}
function wire() {
  document.querySelectorAll("[data-sw]").forEach(b => b.addEventListener("click", () => { const v = b.dataset.sw; if (v === "kot") TYPE = "kot"; else { TYPE = "voorschot"; st.dir = v; } draw(); }));
  document.querySelectorAll("[data-g]").forEach(g => g.addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; st[g.dataset.g] = b.dataset.v; g.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b)); if (g.dataset.g === "cat" && $("#hoursWrap")) $("#hoursWrap").classList.toggle("hidden", b.dataset.v !== "Studentenjob"); validate(); }));
  document.querySelectorAll("[data-dir]").forEach(b => b.addEventListener("click", () => { st.dir = b.dataset.dir; document.querySelectorAll("[data-dir]").forEach(x => x.classList.toggle("on", x === b)); $("#whoL").textContent = st.dir === "out" ? "Aan wie moet je terugbetalen" : "Wie moet jou terugbetalen"; $("#withMeL").textContent = st.dir === "out" ? "Ook als uitgave bij Financiën (het was voor jezelf)" : "Ik deed zelf ook mee: mijn deel als uitgave"; $("#withMe").checked = st.dir === "out" || parseInt(($("#n") || {}).value, 10) > 1; }));
  const calc = () => { const t = parseAmount($("#tot").value), n = parseInt($("#n").value, 10); if (t > 0 && n > 1) { $("#amount").value = (Math.round(t / n * 100) / 100).toFixed(2).replace(".", ","); $("#withMe").checked = true; } validate(); };
  if ($("#tot")) { $("#tot").addEventListener("input", calc); $("#n").addEventListener("input", calc); }
  if ($("#pp")) $("#pp").addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (!b) return; const cur = $("#names").value.split(/,|\\s+en\\s+/i).map(s => s.trim()).filter(Boolean); if (!cur.some(c => c.toLowerCase() === b.dataset.p.toLowerCase())) cur.push(b.dataset.p); $("#names").value = cur.join(", "); b.classList.add("on"); validate(); });
  if ($("#desc") && $("#cat") && $("#cat").tagName === "SELECT") { let touched = false; $("#cat").addEventListener("change", () => touched = true); $("#desc").addEventListener("input", () => { if (!touched && /caf|resto|eten|drink|drank|bar|pint|bier|cola|koffie|friet|frit|pizza|lunch|kebab|snack|burger|sushi/i.test($("#desc").value) && CTX.expenseCats.includes("Eten buitenshuis")) $("#cat").value = "Eten buitenshuis"; }); }
  document.querySelectorAll("input").forEach(i => i.addEventListener("input", validate));
}
function collect() {
  const d = {date: st.date, kind: TYPE};
  if ($("#amount")) d.amount = parseAmount($("#amount").value);
  if (TYPE === "kot") { d.cat = st.cat; d.desc = $("#desc").value; d.settled = $("#settled").checked; if (!(d.amount > 0)) return "Vul een bedrag in, bv. 5,45"; if (!d.cat) return "Kies een categorie"; }
  if (TYPE === "uitgave" || TYPE === "inkomst") { d.cat = st.cat; d.desc = $("#desc").value; d.hours = $("#hours") ? parseAmount($("#hours").value) || null : null; if (!(d.amount > 0)) return "Vul een bedrag in"; if (!d.cat) return "Kies een categorie"; }
  if (TYPE === "lijstje") { d.text = $("#text").value; if (!d.text.trim()) return "Wat wil je doen?"; }
  if (TYPE === "taak") { d.title = $("#title").value; d.time = $("#time").value; d.reminder = !!d.time; d.cat = st.cat; d.urgent = $("#urgent").checked; if (!d.title.trim()) return "Wat moet er gebeuren?"; if (!d.cat) return "Kies een categorie"; }
  if (TYPE === "voorschot") { d.dir = st.dir; d.names = $("#names").value.split(/,|\\s+en\\s+/i).map(s => s.trim().replace(/\\s+/g, " ").replace(/(^|\\s)\\S/g, m => m.toUpperCase())).filter(Boolean); d.desc = $("#desc").value; d.withMe = $("#withMe").checked; d.cat = $("#cat").value; if (!(d.amount > 0)) return "Vul een bedrag in"; if (!d.names.length) return st.dir === "out" ? "Aan wie?" : "Voor wie?"; }
  return d;
}
function validate() { const d = collect(); $("#save").disabled = typeof d === "string"; $("#err").textContent = ""; return d; }
let CB = null, PENDING = null;
window.LO = {
  wait(cb) { CB = cb; if (PENDING) { const p = PENDING; PENDING = null; CB = null; cb(p); } },
  done(label) { $("#f").style.display = "none"; $("#done").style.display = "block"; $("#doneTxt").textContent = label; $("#save").disabled = false; $("#save").textContent = "Opslaan"; },
  fail(msg) { $("#err").textContent = msg; $("#save").disabled = false; $("#save").textContent = "Opslaan"; }
};
$("#f").addEventListener("submit", () => { const d = collect(); if (typeof d === "string") { $("#err").textContent = d; return; } $("#save").disabled = true; $("#save").textContent = "Opslaan…"; const json = JSON.stringify(d); if (CB) { const c = CB; CB = null; c(json); } else PENDING = json; });
$("#again").addEventListener("click", () => { $("#done").style.display = "none"; $("#f").style.display = "block"; st.settled = false; st.date = CTX.today; draw(); });
draw();
</script></body></html>`;
}
 
async function runAdd(type) {
  if (!await token()) { if (!await setup()) return; }
  let settings = {}, others = [];
  try { const [s, o] = await Promise.all([getDoc("settings"), getDoc("others")]); settings = s.data || {}; others = (o.data && o.data.items) || []; }
  catch (e) { await info("Geen verbinding", "Controleer je internet en probeer opnieuw."); return; }
  const t = today(), exp = (settings.expenseCats || []).map(c => c.name), inc = (settings.incomeCats || []).map(c => c.name);
  const order = (names, recent) => [...(recent || []).filter(n => names.includes(n)), ...names.filter(n => !(recent || []).includes(n))];
  const pc = {}; others.forEach(i => pc[i.person] = (pc[i.person] || 0) + 1);
  const ctx = {today: t, yesterday: addDays(t, -1), dayBefore: addDays(t, -2), tomorrow: addDays(t, 1), dayAfter: addDays(t, 2), nextWeek: addDays(t, 7),
    recipient: (settings.kot && settings.kot.recipient) || "mama", othersColor: (TYPES.voorschot || {}).color || "", persons: Object.keys(pc).sort((a, b) => pc[b] - pc[a]), expenseCats: exp, ownCat: exp.includes("Vrije tijd") ? "Vrije tijd" : exp[0]};
  if (type === "kot") { ctx.cats = (settings.kot && settings.kot.cats) || ["Eten", "Drank", "Extra"]; ctx.defaultCat = ctx.cats[0]; }
  if (type === "uitgave") { ctx.cats = order(exp, settings.recentOut); ctx.defaultCat = (settings.recentOut || [])[0] || ""; }
  if (type === "inkomst") { ctx.cats = order(inc, settings.recentIn); ctx.defaultCat = (settings.recentIn || [])[0] || ""; }
  if (type === "taak") { ctx.cats = settings.taskCats || ["Studie", "Stage", "Klantproject", "Kampen", "Privé"]; ctx.defaultCat = ctx.cats.includes("Privé") ? "Privé" : ctx.cats[0]; }
  const wv = new WebView(), html = formHTML(type, ctx);
  let closed = false; const shown = wv.present(false).then(() => { closed = true; });
  let ready = false;
  for (let i = 0; i < 3 && !ready && !closed; i++) {
    try { await wv.loadHTML(html, "https://lifeos.local/"); await new Promise(r => Timer.schedule(150, false, r)); ready = await wv.evaluateJavaScript("typeof LO === 'object' && !!document.querySelector('#fields').children.length", false); } catch (e) { ready = false; }
  }
  if (!ready && !closed) { await wv.loadHTML(`<meta name="viewport" content="width=device-width"><body style="font:17px -apple-system;padding:24px;background:#141413;color:#eee"><h2>Formulier laadt niet</h2><p>Sluit dit venster en tik opnieuw op de widget. Lukt het nog steeds niet, stuur dan een screenshot.</p></body>`); await shown; return; }
  while (!closed) {
    const res = await Promise.race([wv.evaluateJavaScript("LO.wait(completion)", true), shown.then(() => null)]);
    if (!res || closed) break;
    const d = JSON.parse(res);
    try {
      let label;
      const k = d.kind || type;
      if (k === "kot") label = await saveKot(d);
      else if (k === "uitgave") label = await saveMoney(d, settings, "out");
      else if (k === "inkomst") label = await saveMoney(d, settings, "in");
      else if (k === "lijstje") label = await saveList(d);
      else if (k === "taak") label = await saveTask(d);
      else if (k === "voorschot") label = await saveOthers(d, settings);
      if (closed) break;
      await wv.evaluateJavaScript(`LO.done(${JSON.stringify(label)})`, false);
    } catch (e) {
      if (closed) break;
      await wv.evaluateJavaScript(`LO.fail(${JSON.stringify("Opslaan mislukt: " + (e.message || e))})`, false);
    }
  }
}
 
async function menu() {
  const keys = ["kot", "uitgave", "inkomst", "lijstje", "taak", "voorschot"];
  const opts = keys.map(k => "+ " + TYPES[k].label).concat(["Life OS openen", kcGet("refresh") ? "Opnieuw koppelen / ander account" : "Koppelen met Life OS"]);
  const i = await choose("Life OS", opts, kcGet("refresh") ? "Wat wil je toevoegen?" : "Nog niet gekoppeld.");
  if (i === null) return;
  if (i < keys.length) return runAdd(keys[i]);
  if (i === keys.length) return Safari.open(APP_URL + "#snel");
  await setup();
}
 
/* ---------------- start ---------------- */
if (config.runsInWidget) {
  const type = (args.widgetParameter || "overzicht").trim().toLowerCase();
  Script.setWidget(await buildWidget(TYPES[type] ? type : "overzicht"));
} else {
  const q = (args.queryParameters && args.queryParameters.type) || "";
  if (TYPES[q] && q !== "overzicht") await runAdd(q); else await menu();
}
Script.complete();
 
