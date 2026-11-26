// Life OS – widgets & snel invoeren voor Scriptable (iPhone)
// Eén script voor alle widgets. Kies per widget het type via "Parameter":
//   kot · uitgave · inkomst · lijstje · taak · voorschot · stage · stagetaken · overzicht
// Tik op een widget → je vult meteen bedrag/omschrijving in → opgeslagen in je Life OS.

const APP_URL = "https://vansteenkisteade-cmyk.github.io/Life-OS/";
const KC = "lifeos.";              // sleutelhanger-prefix
const TYPES = {
  kot:       {label: "Kot",        symbol: "house.fill",              color: "#e0661b"},
  uitgave:   {label: "Uitgave",    symbol: "cart.fill",        color: "#1f7a43"},
  inkomst:   {label: "Inkomst",    symbol: "eurosign",   color: "#1f7a43"},
  lijstje:   {label: "Lijstje",    symbol: "checklist",              color: "#d6336c"},
  taak:      {label: "Taak",       symbol: "checkmark.circle.fill",  color: "#2f4a7a"},
  voorschot: {label: "Voorschot",  symbol: "person.2.fill",          color: "#b98200"},
  stage:     {label: "Stage",      symbol: "briefcase.fill",         color: "#0e7c74"},
  stagetaken:{label: "Stage",      symbol: "briefcase.fill",         color: "#0e7c74"},
  overzicht: {label: "Life OS",    symbol: "square.grid.2x2.fill",   color: "#1c1b19"},
  rustig:    {label: "Life OS",    symbol: "square.grid.2x2.fill",   color: "#1c1b19"}
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
  const [settings, tasks, kot, others, day, tx, stage] = await Promise.all(["settings", "tasks", "kot", "others", "day", "tx-" + month, "stage"].map(n => getDoc(n).then(r => r.data).catch(() => null)));
  return {settings: settings || {}, tasks: (tasks && tasks.items) || [], kot: kot || {items: [], statements: [], payments: []}, others: (others && others.items) || [], day: (day && day.items) || [], tx: (tx && tx.items) || [], stage: stage || {}};
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
    get, owe, stage: stageStats(D.stage)
  };
}
const hm = min => { min = Math.round(min || 0); return Math.floor(min / 60) + "u" + pad(min % 60); };
function stageStats(st) {
  st = st || {}; const es = (st.entries || []).slice().sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from));
  const goal = (+st.goal || 130) * 60, tot = es.reduce((a, e) => a + (e.minutes || 0), 0);
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const ws = iso(d);
  return {tot, goal, goalH: +st.goal || 130, pct: Math.min(100, Math.round(tot / goal * 100)), left: Math.max(0, goal - tot), week: es.filter(e => e.date >= ws).reduce((a, e) => a + e.minutes, 0),
    count: es.length, last: es[es.length - 1] || null, tasks: (st.tasks || []).filter(t => !t.done).sort((a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999")), place: st.place || ""};
}
const dueLabel = d => { const t = today(); if (d === t) return "vandaag"; if (d === addDays(t, 1)) return "morgen"; return d.slice(8, 10) + "/" + d.slice(5, 7); };

/* ---------------- widget tekenen (2.0-design) ---------------- */
const WPARAM = String((typeof args !== "undefined" && args.widgetParameter) || "").trim().toLowerCase();
const THEME = /\b(donker|dark|zwart)\b/.test(WPARAM) ? "dark" : /\b(licht|light|wit)\b/.test(WPARAM) ? "light" : "auto";
const dyn = (l, d) => THEME === "light" ? l : THEME === "dark" ? d : Color.dynamic(l, d);
const DARKP = {"#e0661b":"#f08a4b", "#1f7a43":"#4cc27a", "#d6336c":"#f06595", "#2f4a7a":"#86a8e8", "#b98200":"#e0b23a", "#0e7c74":"#3cc7b9", "#1c1b19":"#ecebe7"};
const hexMix = (a, b, t) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return "#" + A.map((v, i) => Math.round(v * t + B[i] * (1 - t)).toString(16).padStart(2, "0")).join(""); };
const C = {bg: dyn(new Color("#ffffff"), new Color("#141413")), text: dyn(new Color("#1c1b19"), new Color("#ecebe7")), muted: dyn(new Color("#6b6a66"), new Color("#a5a49e")), line: dyn(new Color("#ece9e2"), new Color("#ffffff", 0.12)), white: new Color("#ffffff")};
const hexOf = type => (TYPES[type] || TYPES.overzicht).color;
const tint = type => { const h = hexOf(type); return dyn(new Color(h), new Color(DARKP[h] || h)); };
const soft = (type, a) => { const h = hexOf(type); return dyn(new Color(h, a), new Color(DARKP[h] || h, a + 0.04)); };
// kaartachtergrond: een vleugje categoriekleur, zoals de omrande kaarten in de app
const wash = (type, a = 0.07) => { const h = hexOf(type); return dyn(new Color(hexMix(h, "#ffffff", a)), new Color(hexMix(DARKP[h] || h, "#141413", a + 0.05))); };
const onTint = type => hexOf(type) === "#1c1b19" ? C.bg : dyn(C.white, new Color("#141413"));   // tekst op een volle kleurknop
const RED = dyn(new Color("#c92a2a"), new Color("#ff6b6b"));
const SURF = dyn(new Color("#f6f4ef"), new Color("#22221f"));
const runUrl = type => `scriptable:///run/${encodeURIComponent(Script.name())}?type=${type}`;
function sym(st, name, size, color) { const i = st.addImage(SFSymbol.named(name).image); i.imageSize = new Size(size, size); i.tintColor = color; return i; }
function txt(st, s, size, color, weight) {
  const t = st.addText(s);
  t.font = weight === 8 ? Font.heavySystemFont(size) : weight === 7 ? Font.boldSystemFont(size) : weight === 6 ? Font.semiboldSystemFont(size) : weight === 5 ? Font.mediumSystemFont(size) : Font.systemFont(size);
  t.textColor = color || C.text; t.lineLimit = 1; t.minimumScaleFactor = 0.7; return t;
}
// het nieuwe logo: een L uit vier categorieblokjes + roze punt
function logoImage(px) {
  const dc = new DrawContext(); dc.size = new Size(px, px); dc.opaque = false; dc.respectScreenScale = true;
  const u = px / 24, cell = (x, y, c) => { const p = new Path(); p.addRoundedRect(new Rect(x * u, y * u, 6 * u, 6 * u), 1.8 * u, 1.8 * u); dc.addPath(p); dc.setFillColor(new Color(c)); dc.fillPath(); };
  cell(3, 2, "#2f4a7a"); cell(3, 9, "#0e7c74"); cell(3, 16, "#e0661b"); cell(10, 16, "#1f7a43");
  dc.setFillColor(new Color("#d6336c")); dc.fillEllipse(new Rect(17.9 * u, 18.4 * u, 3.2 * u, 3.2 * u));
  return dc.getImage();
}
function brand(st, size = 18) { const i = st.addImage(logoImage(size)); i.imageSize = new Size(size, size); return i; }
function header(w, type, size) {
  const T = TYPES[type] || TYPES.overzicht;
  const st = w.addStack(); st.centerAlignContent();
  if (type === "overzicht") brand(st, size); else iconTile(st, type, size + 6);
  st.addSpacer(7); txt(st, T.label, size * 0.75, type === "overzicht" ? C.text : tint(type), 7);
}
function line(w, text, size = 12, color = C.muted, bold = false) { return txt(w, text, size, color, bold ? 7 : 4); }
// vol gekleurd icoontegeltje met wit symbool (zoals in de app)
function iconTile(st, type, s = 26, symbol) {
  const ic = st.addStack(); ic.size = new Size(s, s); ic.cornerRadius = Math.round(s * 0.32); ic.backgroundColor = tint(type); ic.centerAlignContent();
  sym(ic, symbol || TYPES[type].symbol, Math.round(s * 0.5), onTint(type)); return ic;
}
function cap(st, title, color) { return txt(st, title, 10, color, 7); }
// volle kleurknop, net als de primaire knoppen in de app
function pillButton(w, type, label, url, opts = {}) {
  const b = w.addStack(); b.url = url || runUrl(type); b.backgroundColor = tint(type); b.cornerRadius = opts.r || 12;
  b.setPadding(opts.py || 7, 8, opts.py || 7, 8); b.centerAlignContent();
  b.addSpacer(); sym(b, "plus", opts.fs ? opts.fs - 1 : 10, onTint(type)); b.addSpacer(4); txt(b, label, opts.fs || 12, onTint(type), 7); b.addSpacer();
  return b;
}
async function buildWidget(type) {
  const w = new ListWidget(); w.backgroundColor = C.bg; w.setPadding(14, 14, 14, 14);
  w.url = (type === "overzicht" || type === "rustig") ? APP_URL : runUrl(type);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  if (!kcGet("refresh")) { header(w, type, 18); w.addSpacer(); line(w, "Tik om te koppelen", 12, C.muted); w.url = `scriptable:///run/${encodeURIComponent(Script.name())}`; return w; }
  let S = null; try { S = stats(await loadAll()); } catch (e) { S = null; }
  const fam = config.widgetFamily || "small";
  if (type === "stage") { stageWidget(w, S, fam); return w; }
  if (type === "stagetaken") { stageTasksWidget(w, S, fam); return w; }
  if (type === "rustig") { calmWidget(w, S, fam); return w; }
  if (type === "overzicht" || fam === "medium" || fam === "large") { await bigWidget(w, S, fam); return w; }
  smallWidget(w, type, S);
  return w;
}

/* kleine widget: één categorie, één cijfer, één knop, in de kleur van die categorie */
function smallWidget(w, type, S) {
  w.setPadding(14, 14, 12, 14); w.backgroundColor = wash(type);
  const top = w.addStack(); top.centerAlignContent();
  iconTile(top, type, 28); top.addSpacer(8); txt(top, TYPES[type].label, 13, tint(type), 7);
  w.addSpacer();
  if (!S) { txt(w, "Geen verbinding", 12, C.muted); }
  else if (type === "lijstje") {
    if (S.list.length) { S.list.slice(0, 3).forEach(i => todo(w, i.text, 12, "lijstje")); if (S.list.length > 3) txt(w, `+${S.list.length - 3} meer`, 10, C.muted, 5); }
    else { txt(w, "Alles gedaan", 16, C.text, 8); txt(w, "niets meer voor vandaag", 10, C.muted, 5); }
  } else if (type === "taak") {
    const x = S.next[0];
    if (x) { const t = w.addText(x.title); t.font = Font.boldSystemFont(15); t.textColor = C.text; t.lineLimit = 2; t.minimumScaleFactor = 0.8; w.addSpacer(5);
      duePill(w, x.deadline, x.time); }
    else txt(w, "Geen deadlines", 15, C.text, 8);
    if (S.late) { w.addSpacer(3); txt(w, `${S.late} te laat`, 10, RED, 7); }
  } else {
    const val = type === "kot" ? eur(S.kot) : type === "uitgave" ? eur(S.out) : type === "inkomst" ? eur(S.in) : (S.get ? "+" + eur(S.get) : S.owe ? "-" + eur(S.owe) : eur(0));
    const sub = type === "kot" ? "terug van mama" : type === "uitgave" ? "uitgegeven deze maand" : type === "inkomst" ? "verdiend deze maand" : (S.get && S.owe ? `jij moet ${eur(S.owe)}` : S.owe ? "jij moet nog" : "te krijgen");
    txt(w, val, 26, C.text, 8); txt(w, sub, 10, C.muted, 5);
  }
  w.addSpacer(9);
  pillButton(w, type, "Toevoegen");
}
function duePill(st, d, time) {
  const soon = d <= addDays(today(), 1);
  const r = st.addStack(); const pill = r.addStack(); pill.setPadding(2, 7, 2, 7); pill.cornerRadius = 7;
  pill.backgroundColor = soon ? dyn(new Color("#c92a2a", 0.12), new Color("#ff6b6b", 0.18)) : soft("taak", 0.12);
  txt(pill, dueLabel(d) + (time ? " · " + time : ""), 10, soon ? RED : tint("taak"), 7);
  return r;
}

/* stage-widget: klein en middelgroot */
function progressBar(st, width, pct, h = 7) {
  const bar = st.addStack(); bar.size = new Size(width, h); bar.cornerRadius = h / 2; bar.backgroundColor = soft("stage", 0.18);
  const fill = bar.addStack(); fill.size = new Size(Math.max(h, Math.round(width * pct / 100)), h); fill.cornerRadius = h / 2; fill.backgroundColor = tint("stage");
  bar.addSpacer();
}
function stageWidget(w, S, fam) {
  const medium = fam !== "small";
  w.setPadding(14, medium ? 16 : 14, 12, medium ? 16 : 14); w.backgroundColor = wash("stage");
  w.url = runUrl("stage");
  const top = w.addStack(); top.centerAlignContent();
  iconTile(top, "stage", 28); top.addSpacer(8); txt(top, "Stage", 13, tint("stage"), 7);
  if (!S) { w.addSpacer(); txt(w, "Geen verbinding", 12, C.muted); w.addSpacer(); return; }
  const G = S.stage;
  if (medium) { top.addSpacer(); if (G.place) txt(top, G.place, 10, C.muted, 5); }
  w.addSpacer();
  if (!medium) {
    const v = w.addStack(); v.bottomAlignContent(); txt(v, hm(G.tot), 23, C.text, 8); v.addSpacer(2); txt(v, "/" + G.goalH + "u", 10, C.muted, 6);
    w.addSpacer(6); progressBar(w, 128, G.pct); w.addSpacer(5);
    txt(w, G.tot >= G.goal ? "doel gehaald" : `${G.pct}% · nog ${hm(G.left)}`, 10, C.muted, 5);
  } else {
    const body = w.addStack(); body.topAlignContent();
    const left = body.addStack(); left.layoutVertically(); left.size = new Size(150, 0);
    const v = left.addStack(); v.bottomAlignContent(); txt(v, hm(G.tot), 26, C.text, 8); v.addSpacer(3); txt(v, "/ " + G.goalH + "u", 12, C.muted, 6);
    left.addSpacer(5); progressBar(left, 146, G.pct); left.addSpacer(6);
    const row = left.addStack(); row.spacing = 12;
    [[G.pct + "%", "klaar"], [hm(G.left), "te doen"], [hm(G.week), "deze week"]].forEach(([a, b]) => { const c = row.addStack(); c.layoutVertically(); txt(c, a, 12, C.text, 7); txt(c, b, 9, C.muted, 5); });
    body.addSpacer(14);
    const right = body.addStack(); right.layoutVertically();
    cap(right, G.tasks.length ? "Te doen voor stage" : "Laatste keer", tint("stage")); right.addSpacer(5);
    if (G.tasks.length) G.tasks.slice(0, 2).forEach(t => { const r = right.addStack(); r.centerAlignContent(); sym(r, "circle", 11, tint("stage")); r.addSpacer(6); txt(r, t.title, 12, C.text, 5); if (t.deadline) { r.addSpacer(4); txt(r, dueLabel(t.deadline), 9, t.deadline <= addDays(today(), 1) ? RED : C.muted, 7); } right.addSpacer(4); });
    else if (G.last) { txt(right, `${G.last.date.slice(8, 10)}/${G.last.date.slice(5, 7)} · ${hm(G.last.minutes)}`, 12, C.text, 7); const t = right.addText(G.last.what || ""); t.font = Font.systemFont(11); t.textColor = C.muted; t.lineLimit = 2; }
    else txt(right, "Nog geen uren", 12, C.muted);
    right.addSpacer();
  }
  w.addSpacer(medium ? 6 : 9);
  pillButton(w, "stage", "Uren toevoegen", runUrl("stage"), medium ? {py: 6} : {});
}

/* stage-widget met stagetaken i.p.v. uren */
function stageTasksWidget(w, S, fam) {
  const medium = fam !== "small";
  w.setPadding(14, medium ? 16 : 14, 12, medium ? 16 : 14); w.backgroundColor = wash("stage");
  w.url = runUrl("stage");
  const top = w.addStack(); top.centerAlignContent();
  iconTile(top, "stage", 28, "checklist"); top.addSpacer(8); txt(top, medium ? "Te doen voor stage" : "Stagetaken", 13, tint("stage"), 7);
  if (!S) { w.addSpacer(); txt(w, "Geen verbinding", 12, C.muted); w.addSpacer(); return; }
  const G = S.stage, n = 3;
  if (G.tasks.length) { top.addSpacer(); const c = top.addStack(); c.setPadding(1, 7, 1, 7); c.cornerRadius = 8; c.backgroundColor = soft("stage", 0.14); txt(c, String(G.tasks.length), 11, tint("stage"), 7); }
  w.addSpacer(medium ? 8 : 9);
  if (G.tasks.length) {
    G.tasks.slice(0, n).forEach(t => {
      const r = w.addStack(); r.centerAlignContent();
      const soon0 = t.deadline && t.deadline <= addDays(today(), 1);
      sym(r, soon0 ? "exclamationmark.circle.fill" : "circle", 11, soon0 ? RED : tint("stage")); r.addSpacer(6);
      const tt = r.addText(t.title); tt.font = Font.mediumSystemFont(medium ? 13 : 12); tt.textColor = C.text; tt.lineLimit = 1; tt.minimumScaleFactor = 0.8;
      if (t.deadline && medium) { r.addSpacer(4); duePill(r, t.deadline); }
      w.addSpacer(medium ? 4 : 5);
    });
    if (G.tasks.length > n) txt(w, `+${G.tasks.length - n} meer`, 10, C.muted, 5);
  } else { txt(w, "Niets open", 15, C.text, 8); txt(w, "geen stagetaken meer", 10, C.muted, 5); }
  w.addSpacer();
  pillButton(w, "stage", "Uren toevoegen", runUrl("stage"));
}

/* middelgrote en grote widget: zoals het startscherm van Life OS 2.0 */
function todo(st, text, size = 12, type = "lijstje") {
  const r = st.addStack(); r.centerAlignContent();
  sym(r, "circle", size - 1, tint(type)); r.addSpacer(size > 12 ? 8 : 6); txt(r, text, size, C.text, 5);
  st.addSpacer(size > 12 ? 6 : 3);
}
function crow(st, type, value, label, large) {
  const b = st.addStack(); b.url = runUrl(type); b.centerAlignContent();
  b.borderWidth = 1; b.borderColor = C.line; b.cornerRadius = 14; b.setPadding(large ? 8 : 5, large ? 9 : 7, large ? 8 : 5, large ? 9 : 7);
  iconTile(b, type, large ? 26 : 22); b.addSpacer(7);
  const col = b.addStack(); col.layoutVertically();
  txt(col, label, 9, tint(type), 7);
  txt(col, value, large ? 16 : 13, C.text, 8);
  b.addSpacer();
  return b;
}
function buttons(w, types, tall) {
  const row = w.addStack(); row.spacing = tall ? 8 : 6;
  types.forEach(t => {
    const b = row.addStack(); b.url = runUrl(t); b.centerAlignContent();
    b.backgroundColor = tall ? tint(t) : soft(t, 0.13); b.cornerRadius = tall ? 13 : 10; b.setPadding(tall ? 10 : 6, 6, tall ? 10 : 6, 6);
    b.addSpacer();
    sym(b, tall ? "plus" : TYPES[t].symbol, tall ? 12 : 11, tall ? onTint(t) : tint(t));
    b.addSpacer(4);
    txt(b, TYPES[t].label, tall ? 13 : 10, tall ? onTint(t) : tint(t), 7);
    b.addSpacer();
  });
}
async function bigWidget(w, S, fam) {
  const large = fam === "large";
  w.url = APP_URL;
  // donker: geen puur zwart maar een diep nachtblauw, net als de getinte kleine widgets
  w.backgroundColor = dyn(new Color("#ffffff"), new Color(hexMix("#86a8e8", "#141413", 0.17)));
  w.setPadding(large ? 16 : 12, large ? 16 : 14, large ? 16 : 11, large ? 16 : 14);
  const d = new Date(), h = d.getHours();
  const top = w.addStack(); top.centerAlignContent();
  brand(top, large ? 20 : 17); top.addSpacer(6);
  if (large) txt(top, (h < 12 ? "Goeiemorgen" : h < 18 ? "Goeiemiddag" : "Goeienavond") + ", Ade", 17, C.text, 8);
  else txt(top, "Life OS", 13, C.text, 8);
  top.addSpacer();
  txt(top, d.toLocaleDateString("nl-BE", {weekday: large ? "long" : "short", day: "numeric", month: "short"}), 10, C.muted, 5);
  w.addSpacer(large ? 12 : 7);
  if (!S) { txt(w, "Geen verbinding · tik om opnieuw te proberen", 12, C.muted); w.addSpacer(); return; }
  const body = w.addStack(); body.topAlignContent();
  // links: het lijstje, zonder kader
  const left = body.addStack(); left.layoutVertically();
  left.setPadding(large ? 2 : 0, 0, 0, 0);
  const lh = left.addStack(); lh.centerAlignContent(); cap(lh, "Vandaag", tint("lijstje")); lh.addSpacer();
  if (S.list.length) txt(lh, String(S.list.length), 10, tint("lijstje"), 7);
  left.addSpacer(large ? 7 : 3);
  const nL = large ? 5 : 2;
  if (S.list.length) S.list.slice(0, nL).forEach(i => todo(left, i.text, large ? 15 : 12));
  else { txt(left, "Alles gedaan", large ? 15 : 12, C.muted, 6); left.addSpacer(3); }
  if (large && S.list.length > nL) { txt(left, `+${S.list.length - nL} meer`, 10, C.muted, 5); left.addSpacer(2); }
  if (large) {
    left.addSpacer(); 
    const dl = left.addStack(); dl.layoutVertically();
    const dh = dl.addStack(); dh.centerAlignContent(); cap(dh, "Eerste deadline", tint("taak")); if (S.late) { dh.addSpacer(5); txt(dh, `${S.late} te laat`, 10, RED, 7); }
    dl.addSpacer(4);
    if (S.next.length) { const x = S.next[0]; txt(dl, x.title, 13, C.text, 6); dl.addSpacer(3); duePill(dl, x.deadline, x.time); }
    else txt(dl, "Geen deadlines", 12, C.muted, 5);
  }
  left.addSpacer();
  body.addSpacer(large ? 10 : 8);
  // rechts: categorierijen zoals op het startscherm
  const right = body.addStack(); right.layoutVertically(); right.spacing = large ? 6 : 4; right.size = new Size(large ? 126 : 112, 0);
  crow(right, "kot", eur(S.kot), large ? "Terug van mama" : "Kot", large);
  if (large || !(S.get || S.owe)) crow(right, "uitgave", eur(S.out), "Uitgegeven", large);
  if (S.get || S.owe) crow(right, "voorschot", S.get ? "+" + eur(S.get) : "-" + eur(S.owe), S.get ? "Te krijgen" : "Jij moet nog", large);
  if (large) crow(right, "inkomst", eur(S.in), "Verdiend", large);
  w.addSpacer(large ? 12 : 7);
  if (large) { buttons(w, ["uitgave", "inkomst", "lijstje", "voorschot"]); w.addSpacer(7); buttons(w, ["kot", "taak"], true); }
  else buttons(w, ["kot", "uitgave", "taak", "lijstje"]);
}


/* rustige grote widget: je dag centraal, cijfers als één rustige regel, weinig knoppen */
function calmWidget(w, S, fam) {
  const large = fam !== "medium";
  w.url = APP_URL;
  w.backgroundColor = dyn(new Color("#ffffff"), new Color(hexMix("#86a8e8", "#141413", 0.17)));
  w.setPadding(large ? 20 : 14, 20, large ? 18 : 12, 20);
  const d = new Date(), h = d.getHours();
  const top = w.addStack(); top.centerAlignContent();
  const greet = (h < 12 ? "Goeiemorgen" : h < 18 ? "Goeiemiddag" : "Goeienavond") + ", Ade";
  brand(top, 16); top.addSpacer(7);
  if (large) { txt(top, d.toLocaleDateString("nl-BE", {weekday: "long", day: "numeric", month: "long"}), 11, C.muted, 6); w.addSpacer(8); txt(w, greet, 24, C.text, 8); }
  else { txt(top, greet, 15, C.text, 8); top.addSpacer(); txt(top, d.toLocaleDateString("nl-BE", {weekday: "short", day: "numeric", month: "short"}), 10, C.muted, 6); }
  if (!S) { w.addSpacer(); txt(w, "Geen verbinding · tik om opnieuw te proberen", 12, C.muted); w.addSpacer(); return; }
  w.addSpacer(large ? 14 : 8);
  // je dag
  const lh = w.addStack(); lh.centerAlignContent();
  cap(lh, "Vandaag", tint("lijstje"));
  if (S.list.length) { lh.addSpacer(6); txt(lh, `${S.list.length} open`, 10, C.muted, 6); }
  w.addSpacer(large ? 8 : 5);
  const nL = large ? 3 : 2;
  if (S.list.length) S.list.slice(0, nL).forEach(i => { const r = w.addStack(); r.centerAlignContent(); sym(r, "circle", large ? 15 : 13, tint("lijstje")); r.addSpacer(10); txt(r, i.text, large ? 16 : 14, C.text, 5); w.addSpacer(large ? 7 : 4); });
  else { txt(w, "Niets meer te doen vandaag", large ? 16 : 14, C.muted, 5); w.addSpacer(6); }
  w.addSpacer();
  if (large) {
    // volgende deadline als één zin
    if (S.next.length) {
      const x = S.next[0], soon = x.deadline <= addDays(today(), 1);
      const r = w.addStack(); r.centerAlignContent();
      const dot = r.addStack(); dot.size = new Size(6, 6); dot.cornerRadius = 3; dot.backgroundColor = soon ? RED : tint("taak"); r.addSpacer(7);
      txt(r, x.title, 13, C.text, 6); r.addSpacer(6); txt(r, dueLabel(x.deadline), 12, soon ? RED : C.muted, 6);
      w.addSpacer(10);
    }
    // dunne lijn + drie rustige cijfers
    const ln = w.addStack(); ln.size = new Size(0, 1); ln.backgroundColor = C.line; ln.addSpacer();
    w.addSpacer(10);
    const nums = w.addStack(); nums.topAlignContent();
    const cell = (type, label, value) => { const c = nums.addStack(); c.layoutVertically(); c.url = runUrl(type); txt(c, label, 10, tint(type), 7); c.addSpacer(2); txt(c, value, 17, C.text, 8); };
    cell("kot", "Kot", eur(S.kot)); nums.addSpacer();
    cell("uitgave", "Uitgegeven", eur(S.out)); nums.addSpacer();
    if (S.get || S.owe) cell("voorschot", S.get ? "Te krijgen" : "Jij moet", (S.get ? "+" : "-") + eur(S.get || S.owe)); else cell("inkomst", "Verdiend", eur(S.in));
    w.addSpacer(12);
  }
  // drie zachte knoppen
  const row = w.addStack(); row.spacing = 8;
  [["kot", "Kot"], ["taak", "Taak"], ["lijstje", "Lijstje"]].forEach(([t, l]) => {
    const b = row.addStack(); b.url = runUrl(t); b.backgroundColor = soft(t, 0.13); b.cornerRadius = 12; b.setPadding(8, 6, 8, 6); b.centerAlignContent();
    b.addSpacer(); sym(b, "plus", 11, tint(t)); b.addSpacer(4); txt(b, l, 12, tint(t), 7); b.addSpacer();
  });
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
async function saveStage(d) {
  const rec = {id: uid(), date: d.date, from: d.from, to: d.to, pause: d.pause || 0, minutes: d.minutes, what: d.what || ""};
  let tot = 0;
  await updateDoc("stage", x => { x = x || {goal: 130, student: "Ade Vansteenkiste", opleiding: "Master Sporttraining & Coaching – UGent", place: "Bonami Sportmedisch Centrum", mentor: "", entries: [], tasks: [], history: []}; x.entries = (x.entries || []).concat(rec); tot = x.entries.reduce((a, e) => a + (e.minutes || 0), 0); return x; });
  return `Stage · ${hm(rec.minutes)} op ${d.date.slice(8, 10)}/${d.date.slice(5, 7)} · totaal ${hm(tot)}`;
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
  const items = d.per && d.per.length
    ? d.per.map(p => ({id: uid(), dir: "in", date, amount: p.amount, person: p.name, desc, note: "", paid: false, paidDate: ""}))
    : names.map(p => ({id: uid(), dir: debt ? "out" : "in", date, amount, person: p, desc, note: "", paid: false, paidDate: ""}));
  if (d.per && d.per.length) {
    const own = Math.round((d.total - d.per.reduce((a, p) => a + p.amount, 0)) * 100) / 100;
    if (d.withMe && own > 0) {
      const tx = {id: uid(), kind: "out", date, amount: own, desc: `${ucf(desc) || "Gedeelde rekening"} (mijn deel)`, cat, party: "", method: "Bank", domain: domainOf(settings.expenseCats, cat), note: `Mijn deel van ${eur(d.total)}, samen met ${names.join(", ")}`, taskId: "", hours: null};
      items.forEach(it => it.shareTxId = tx.id);
      await pushItem(month, tx);
    }
    await updateDoc("others", x => { x = x || {items: []}; x.items = (x.items || []).concat(items); return x; });
    return `Voorschot · ${d.per.map(p => p.name + " " + eur(p.amount)).join(", ")}${d.withMe && own > 0 ? " · jouw deel " + eur(own) : ""}`;
  }
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap">
<style>
:root{--bg:#ffffff;--surface:#fff;--s2:#f6f4ef;--border:#ece9e2;--text:#1c1b19;--t2:#6b6a66;--t3:#9b9a96;--accent:${T.color};--on:#fff;--ok:#1f7a43;--okbg:#e4f2e9;--warn:#c92a2a;--ease:cubic-bezier(0.23,1,0.32,1)}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--surface:#1c1c1a;--s2:#22221f;--border:#2e2e2b;--text:#ecebe7;--t2:#b3b2ab;--t3:#85847e;--accent:${DARKP[T.color] || T.color};--on:#141413;--okbg:#18301f;--ok:#4cc27a;--warn:#ff6b6b}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.4 Inter,-apple-system,system-ui,sans-serif;padding:64px 18px calc(110px + env(safe-area-inset-bottom))}
h1{font-family:"Space Grotesk",-apple-system,system-ui,sans-serif;font-size:30px;font-weight:700;margin:4px 0 2px;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
h1 i{width:14px;height:14px;border-radius:5px;background:var(--accent);display:inline-block}
.sub{color:var(--t2);font-size:14px;margin-bottom:18px}
label.l{display:block;font-size:13px;font-weight:600;color:var(--t2);margin:16px 0 6px}
.amount{width:100%;border:0;border-bottom:2px solid var(--border);background:none;font-family:"Space Grotesk",-apple-system,system-ui,sans-serif;font-size:44px;font-weight:700;transition:border-color 150ms ease;letter-spacing:-.02em;color:var(--text);padding:6px 0;font-variant-numeric:tabular-nums}
.amount:focus{outline:none;border-color:var(--accent)}
input.t,select.t{width:100%;min-height:48px;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:12px;padding:12px 14px;font-size:17px;transition:border-color 150ms ease,box-shadow 150ms ease}
input.t:focus,select.t:focus,textarea.t:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:999px;padding:9px 15px;font-size:15px;font-weight:500;transition:transform 160ms var(--ease),background-color 150ms ease,border-color 150ms ease,color 150ms ease}
.chip.on{background:var(--accent);color:var(--on);border-color:var(--accent);font-weight:600}
.chip:active,.btn:active,.card:active{transform:scale(.97)}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.card{transition:transform 160ms var(--ease),border-color 150ms ease,background-color 150ms ease;border:2px solid var(--border);background:var(--surface);border-radius:14px;padding:12px;text-align:left;color:var(--text)}
.card b{display:block;font-size:16px}.card span{font-size:13px;color:var(--t2)}
.card.on{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--surface))}
.row{display:flex;gap:8px;align-items:center}
.split{display:flex;gap:8px;align-items:center;font-size:14px;color:var(--t2)}
.split input{width:96px;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:10px;padding:9px;font-size:16px}
.check{display:flex;gap:10px;align-items:flex-start;background:var(--s2);border-radius:12px;padding:12px;margin-top:14px;font-size:15px}
.check input{width:22px;height:22px;margin:0;accent-color:var(--accent)}
@media (prefers-reduced-motion:reduce){.chip,.card,.btn{transition:none}.chip:active,.btn:active,.card:active{transform:none}}
.bar{position:fixed;left:0;right:0;bottom:0;padding:12px 18px calc(12px + env(safe-area-inset-bottom));background:linear-gradient(transparent,var(--bg) 30%)}
.btn{width:100%;border:0;border-radius:16px;padding:16px;font-size:18px;font-weight:700;background:var(--accent);color:var(--on);transition:transform 160ms var(--ease),opacity 150ms ease}
.btn:disabled{opacity:.35}
.err{color:var(--warn);font-size:14px;min-height:20px;margin-top:10px}
.done{display:none;text-align:center;padding:40px 10px}
.done .tick{width:64px;height:64px;border-radius:50%;background:var(--okbg);color:var(--ok);display:grid;place-items:center;font-size:34px;margin:0 auto 14px}
.done p{color:var(--t2);margin:6px 0 22px}
.hidden{display:none}
.tri{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.tri label{display:block;min-width:0}.l2{display:block;font-size:13px;font-weight:600;color:var(--t2);margin-bottom:6px}.tri .t{display:block;width:100%;min-width:0;max-width:100%;height:52px;padding:0 8px;-webkit-appearance:none;appearance:none;text-align:center;font-size:17px;line-height:52px}.tri input[type=time]::-webkit-date-and-time-value{text-align:center}
textarea.t{width:100%;border:1px solid var(--border);background:var(--surface);color:var(--text);border-radius:12px;padding:12px 14px;font-size:16px;font-family:inherit;resize:vertical}
.prow{display:grid;grid-template-columns:1fr 110px 40px;gap:8px;margin-bottom:8px;align-items:center}
.prow .t{padding:11px 12px}.prow .pa{text-align:right;font-variant-numeric:tabular-nums}
.prow .x{border:0;background:var(--s2);color:var(--t2);border-radius:10px;height:44px;font-size:20px}
.mine{margin-top:14px;background:var(--s2);border-radius:12px;padding:12px 14px;font-size:15px;color:var(--t2);display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap}
.mine b{color:var(--text);font-size:20px;font-variant-numeric:tabular-nums}.mine span{font-size:12px;color:var(--t3)}
.mine.bad,.mine.bad b{color:var(--warn)}
.pick{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;border:1px solid var(--border);background:var(--surface);border-radius:12px;padding:8px 12px;font-size:15px;color:var(--t2)}
.hint{font-size:12px;color:var(--t3);margin-top:6px}
.pick.on{border-color:var(--text);color:var(--text)}
.pick input{border:0;background:none;color:var(--text);font-size:16px;font-family:inherit;text-align:right;min-width:0}
.seg3{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;background:var(--s2);border-radius:12px;padding:4px;margin-bottom:18px}
.seg3 button{border:0;background:none;color:var(--t2);border-radius:9px;padding:10px 4px;font-size:14px;font-weight:600}
.seg3 button.on{background:var(--surface);color:var(--accent);box-shadow:0 1px 3px rgba(0,0,0,.15)}
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
const TITLES = {stage:"Stage-uren",kot:"Kot",uitgave:"Uitgave",inkomst:"Inkomst",lijstje:"Lijstje",taak:"Taak",voorschot:"Voorschot of schuld"};
const $ = s => document.querySelector(s);
const st = {cat: CTX.defaultCat || "", date: CTX.today, dir: "in", settled: false, urgent: false, split: "gelijk"};
const parseAmount = s => { s = String(s || "").trim().replace(/[€\\s]/g, ""); if (s.includes(",")) s = s.replace(/\\./g, "").replace(",", "."); const v = parseFloat(s); return isFinite(v) ? Math.round(v * 100) / 100 : NaN; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const chips = (name, opts, cur) => '<div class="chips" data-g="' + name + '">' + opts.map(o => '<button type="button" class="chip' + (o[0] === cur ? " on" : "") + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>').join("") + '</div>';
const dates = (past) => past ? [[CTX.today, "Vandaag"], [CTX.yesterday, "Gisteren"], [CTX.dayBefore, "Eergisteren"]] : [[CTX.today, "Vandaag"], [CTX.tomorrow, "Morgen"], [CTX.dayAfter, "Overmorgen"], [CTX.nextWeek, "Volgende week"], ["", "Geen datum"]];
function splitSeg() { return '<div class="seg3" style="grid-template-columns:1fr 1fr;margin-top:14px">' + [["gelijk", "Iedereen evenveel"], ["apart", "Elk een ander bedrag"]].map(o => '<button type="button" data-split="' + o[0] + '" class="' + (st.split === o[0] ? "on" : "") + '">' + o[1] + '</button>').join("") + '</div>'; }
const fmt = v => "€ " + (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");
function addRow(name) {
  const r = document.createElement("div"); r.className = "prow";
  r.innerHTML = '<input class="t pn" placeholder="Naam"><input class="t pa" inputmode="decimal" placeholder="€ 0,00"><button type="button" class="x" aria-label="Verwijderen">×</button>';
  if (name) r.querySelector(".pn").value = name;
  r.querySelector(".x").addEventListener("click", () => { r.remove(); calcMine(); validate(); });
  r.querySelectorAll("input").forEach(i => i.addEventListener("input", () => { calcMine(); validate(); }));
  $("#rows").appendChild(r); (name ? r.querySelector(".pa") : r.querySelector(".pn")).focus(); calcMine();
}
function rowsData() { return Array.from(document.querySelectorAll(".prow")).map(r => ({name: r.querySelector(".pn").value.trim().replace(/\\s+/g, " ").replace(/(^|\\s)\\S/g, m => m.toUpperCase()), amount: parseAmount(r.querySelector(".pa").value)})); }
function calcMine() {
  const m = $("#mine"); if (!m) return;
  const tot = parseAmount($("#total").value), sum = rowsData().reduce((a, r) => a + (r.amount > 0 ? r.amount : 0), 0);
  if (!(tot > 0)) { m.textContent = "Vul eerst het totaal in"; m.className = "mine"; return; }
  const mine = Math.round((tot - sum) * 100) / 100;
  if (mine < -0.004) { m.innerHTML = "Samen <b>" + fmt(sum) + "</b>, dat is meer dan het totaal"; m.className = "mine bad"; }
  else { m.innerHTML = "Jouw deel <b>" + fmt(mine) + "</b><span>" + fmt(tot) + " − " + fmt(sum) + " van anderen</span>"; m.className = "mine"; }
}
function draw() {
  let h = ""; const keepAmt = $("#amount") ? $("#amount").value : "", keepDesc = $("#desc") ? $("#desc").value : "";
  $("#ttl").textContent = ORIG === "kot" ? (TYPE === "kot" ? "Kot" : st.dir === "out" ? "Schuld bij iemand" : "Voorschot voor iemand") : TITLES[TYPE];
  $("#dot").style.background = TYPE === "voorschot" ? (CTX.othersColor || "") : "";
  $("#sw").innerHTML = ORIG !== "kot" ? "" : '<div class="seg3">' + [["kot", "Kot · " + CTX.recipient], ["in", "Voorschot"], ["out", "Schuld"]].map(o => '<button type="button" data-sw="' + o[0] + '" class="' + ((TYPE === "kot" ? "kot" : st.dir) === o[0] ? "on" : "") + '">' + esc(o[1]) + '</button>').join("") + '</div>';
  if (TYPE === "stage") { $("#sub").textContent = (CTX.place ? CTX.place + " · " : "") + CTX.stageTot + " van " + CTX.goal + "u";
    h = '<div class="pick on"><span>Datum</span><input type="date" id="sdate" value="' + CTX.today + '" max="' + CTX.today + '"></div>' +
      '<div class="tri"><label><span class="l2">Van</span><input class="t" type="time" id="from" value="' + CTX.lastFrom + '"></label><label><span class="l2">Tot</span><input class="t" type="time" id="to" value="' + CTX.lastTo + '"></label></div>' +
      '<div class="pick" style="margin-top:10px"><span>Pauze (minuten)</span><input id="pause" inputmode="numeric" placeholder="0" style="width:90px"></div>' +
      '<div class="mine" id="scalc"></div>' +
      '<label class="l">Wat heb je gedaan?</label><textarea class="t" id="what" rows="4" placeholder="bv. inspanningstest op de fiets meegevolgd"></textarea>';
  } else if (TYPE === "kot") { $("#sub").textContent = "Voorgeschoten voor " + CTX.recipient;
    h = '<input class="amount" id="amount" inputmode="decimal" placeholder="€ 0,00">' +
      '<label class="l">Categorie</label>' + chips("cat", CTX.cats.map(c => [c, c]), st.cat) +
      '<label class="l">Omschrijving (optioneel)</label><input class="t" id="desc" placeholder="bv. Colruyt">' +
      '<label class="l">Wanneer</label>' + chips("date", dates(true), st.date) + '<div class="pick"><span>Andere datum</span><input type="date" id="customDate" max="' + CTX.today + '"></div>' +
      '<label class="check"><input type="checkbox" id="settled"><span>Al terugbetaald door ' + esc(CTX.recipient) + '</span></label>';
  } else if (TYPE === "uitgave" || TYPE === "inkomst") { $("#sub").textContent = TYPE === "inkomst" ? "Geld dat binnenkwam" : "Iets dat je zelf betaalde";
    h = '<input class="amount" id="amount" inputmode="decimal" placeholder="€ 0,00">' +
      '<label class="l">Omschrijving</label><input class="t" id="desc" placeholder="' + (TYPE === "inkomst" ? "bv. shift zaterdag" : "bv. Delhaize") + '">' +
      '<label class="l">Categorie</label>' + chips("cat", CTX.cats.map(c => [c, c]), st.cat) +
      '<div id="hoursWrap" class="' + (st.cat === "Studentenjob" ? "" : "hidden") + '"><label class="l">Gewerkte uren</label><input class="t" id="hours" inputmode="decimal" placeholder="bv. 8"></div>' +
      '<label class="l">Wanneer</label>' + chips("date", dates(true), st.date) + '<div class="pick"><span>Andere datum</span><input type="date" id="customDate" max="' + CTX.today + '"></div>';
  } else if (TYPE === "lijstje") { $("#sub").textContent = "Kort iets voor vandaag of morgen";
    h = '<input class="t" id="text" placeholder="bv. boodschappen doen" style="font-size:20px;padding:14px">' +
      '<label class="l">Voor wanneer</label>' + chips("date", [[CTX.today, "Vandaag"], [CTX.tomorrow, "Morgen"]], st.date);
  } else if (TYPE === "taak") { $("#sub").textContent = "Met deadline en eventueel een herinnering";
    h = '<input class="t" id="title" placeholder="Wat moet er gebeuren?" style="font-size:20px;padding:14px">' +
      '<label class="l">Deadline</label><div class="pick on"><span>Datum</span><input type="date" id="deadline" value="' + CTX.today + '" min="' + CTX.today + '"></div>' +
      '<div class="hint">Leeg maken = geen deadline</div>' +
      '<label class="l">Herinnering om (optioneel)</label><input class="t" id="time" type="time">' +
      '<label class="l">Categorie</label>' + chips("cat", CTX.cats.map(c => [c, c]).concat([["__new", "+ Nieuwe"]]), st.cat) +
      '<input class="t hidden" id="newCat" placeholder="Naam nieuwe categorie" style="margin-top:8px">' +
      '<label class="check"><input type="checkbox" id="urgent"><span>Dringend (prioriteit Hoog)</span></label>';
  } else if (TYPE === "voorschot" && st.dir === "in" && st.split === "apart") { $("#sub").textContent = "Elk een ander bedrag";
    h = (ORIG === "kot" ? "" : '<div class="cards"><button type="button" class="card on" data-dir="in"><b>Voorschot</b><span>Ik betaalde · zij moeten mij</span></button><button type="button" class="card" data-dir="out"><b>Schuld</b><span>Zij betaalden · ik moet hen</span></button></div>') +
      splitSeg() +
      '<label class="l">Totaal van de rekening</label><input class="amount" id="total" inputmode="decimal" placeholder="€ 0,00" style="font-size:36px">' +
      '<label class="l">Wie moet jou wat terugbetalen</label><div id="rows"></div>' +
      '<div class="chips" style="margin-top:8px"><button type="button" class="chip" id="addRow">+ Persoon</button>' + CTX.persons.slice(0, 8).map(p => '<button type="button" class="chip" data-p="' + esc(p) + '">' + esc(p) + '</button>').join("") + '</div>' +
      '<div class="mine" id="mine"></div>' +
      '<label class="l">Waarvoor</label><input class="t" id="desc" placeholder="bv. café, boodschappen">' +
      '<label class="check"><input type="checkbox" id="withMe" checked><span>Mijn deel als uitgave bij Financiën</span></label>' +
      '<label class="l">Categorie van de uitgave</label><select class="t" id="cat">' + CTX.expenseCats.map(c => '<option' + (c === CTX.ownCat ? " selected" : "") + '>' + esc(c) + '</option>').join("") + '</select>';
  } else if (TYPE === "voorschot") { $("#sub").textContent = "Met vrienden of anderen";
    h = (ORIG === "kot" ? "" : '<div class="cards"><button type="button" class="card' + (st.dir === "in" ? " on" : "") + '" data-dir="in"><b>Voorschot</b><span>Ik betaalde · zij moeten mij</span></button><button type="button" class="card' + (st.dir === "out" ? " on" : "") + '" data-dir="out"><b>Schuld</b><span>Zij betaalden · ik moet hen</span></button></div>') +
      (st.dir === "in" ? splitSeg() : "") +
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
  if (TYPE === "stage") { const up = () => { const m = smin(); const over = tm($("#to").value) != null && tm($("#from").value) != null && tm($("#to").value) <= tm($("#from").value); $("#scalc").innerHTML = m > 0 ? "Duur <b>" + Math.floor(m / 60) + "u" + String(m % 60).padStart(2, "0") + "</b><span>" + (Math.round(m / 6) / 10).toString().replace(".", ",") + " uur" + (over ? " · tot na middernacht" : "") + "</span>" : "Vul van en tot in"; validate(); };
    ["from", "to", "pause"].forEach(i => $("#" + i).addEventListener("input", up)); up(); }
  const first = $("#amount") || $("#text") || $("#title") || $("#what"); if (first) setTimeout(() => first.focus(), 250);
}
function wire() {
  document.querySelectorAll("[data-sw]").forEach(b => b.addEventListener("click", () => { const v = b.dataset.sw; if (v === "kot") TYPE = "kot"; else { TYPE = "voorschot"; st.dir = v; } draw(); }));
  const cd = $("#customDate");
  if (cd) cd.addEventListener("change", () => { if (!cd.value) return; st.date = cd.value; document.querySelectorAll('[data-g="date"] .chip').forEach(x => x.classList.remove("on")); cd.parentNode.classList.add("on"); validate(); });
  document.querySelectorAll("[data-g]").forEach(g => g.addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; st[g.dataset.g] = b.dataset.v; if ($("#newCat")) { const nw = b.dataset.v === "__new"; $("#newCat").classList.toggle("hidden", !(g.dataset.g === "cat" ? nw : !$("#newCat").classList.contains("hidden"))); if (g.dataset.g === "cat" && nw) setTimeout(() => $("#newCat").focus(), 50); } if (g.dataset.g === "date" && cd) { cd.value = ""; cd.parentNode.classList.remove("on"); } g.querySelectorAll(".chip").forEach(x => x.classList.toggle("on", x === b)); if (g.dataset.g === "cat" && $("#hoursWrap")) $("#hoursWrap").classList.toggle("hidden", b.dataset.v !== "Studentenjob"); validate(); }));
  document.querySelectorAll("[data-dir]").forEach(b => b.addEventListener("click", () => { st.dir = b.dataset.dir; draw(); }));
  document.querySelectorAll("[data-split]").forEach(b => b.addEventListener("click", () => { st.split = b.dataset.split; draw(); }));
  if ($("#rows")) { $("#addRow").addEventListener("click", () => addRow("")); if (!$("#rows").children.length) addRow(""); $("#total").addEventListener("input", calcMine); setTimeout(() => $("#total").focus(), 250); }
  const calc = () => { const t = parseAmount($("#tot").value), n = parseInt($("#n").value, 10); if (t > 0 && n > 1) { $("#amount").value = (Math.round(t / n * 100) / 100).toFixed(2).replace(".", ","); $("#withMe").checked = true; } validate(); };
  if ($("#tot")) { $("#tot").addEventListener("input", calc); $("#n").addEventListener("input", calc); }
  document.querySelectorAll("[data-p]").forEach(b => { if (!$("#rows")) return; b.addEventListener("click", () => { const empty = Array.from(document.querySelectorAll(".prow .pn")).find(i => !i.value.trim()); if (empty) { empty.value = b.dataset.p; empty.parentNode.querySelector(".pa").focus(); } else addRow(b.dataset.p); b.classList.add("on"); validate(); }); });
  if ($("#pp")) $("#pp").addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (!b) return; const cur = $("#names").value.split(/,|\\s+en\\s+/i).map(s => s.trim()).filter(Boolean); if (!cur.some(c => c.toLowerCase() === b.dataset.p.toLowerCase())) cur.push(b.dataset.p); $("#names").value = cur.join(", "); b.classList.add("on"); validate(); });
  if ($("#desc") && $("#cat") && $("#cat").tagName === "SELECT") { let touched = false; $("#cat").addEventListener("change", () => touched = true); $("#desc").addEventListener("input", () => { if (!touched && /caf|resto|eten|drink|drank|bar|pint|bier|cola|koffie|friet|frit|pizza|lunch|kebab|snack|burger|sushi/i.test($("#desc").value) && CTX.expenseCats.includes("Eten buitenshuis")) $("#cat").value = "Eten buitenshuis"; }); }
  document.querySelectorAll("input").forEach(i => i.addEventListener("input", validate));
}
const tm = t => { const m = /^(\\d{1,2}):(\\d{2})/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
function smin() { const a = tm($("#from").value), b = tm($("#to").value); if (a == null || b == null) return 0; let d = b - a; if (d <= 0) d += 1440; return Math.max(0, d - (parseInt($("#pause").value, 10) || 0)); }
function collect() {
  const d = {date: st.date, kind: TYPE};
  if ($("#amount")) d.amount = parseAmount($("#amount").value);
  if (TYPE === "kot") { d.cat = st.cat; d.desc = $("#desc").value; d.settled = $("#settled").checked; if (!(d.amount > 0)) return "Vul een bedrag in, bv. 5,45"; if (!d.cat) return "Kies een categorie"; }
  if (TYPE === "uitgave" || TYPE === "inkomst") { d.cat = st.cat; d.desc = $("#desc").value; d.hours = $("#hours") ? parseAmount($("#hours").value) || null : null; if (!(d.amount > 0)) return "Vul een bedrag in"; if (!d.cat) return "Kies een categorie"; }
  if (TYPE === "stage") { d.date = $("#sdate").value; d.from = $("#from").value; d.to = $("#to").value; d.pause = Math.max(0, parseInt($("#pause").value, 10) || 0); d.minutes = smin(); d.what = $("#what").value.trim(); if (!d.date) return "Kies een datum"; if (!(d.minutes > 0)) return "Vul van en tot in"; return d; }
  if (TYPE === "lijstje") { d.text = $("#text").value; if (!d.text.trim()) return "Wat wil je doen?"; }
  if (TYPE === "taak") { d.title = $("#title").value; d.date = $("#deadline").value || ""; d.time = $("#time").value; d.reminder = !!d.time; d.cat = st.cat;
    if (d.cat === "__new") { d.cat = $("#newCat").value.trim().replace(/^./, c => c.toUpperCase()); d.newCat = true; if (!d.cat) return "Geef je nieuwe categorie een naam"; } d.urgent = $("#urgent").checked; if (!d.title.trim()) return "Wat moet er gebeuren?"; if (!d.cat) return "Kies een categorie"; }
  if (TYPE === "voorschot" && $("#rows")) {
    d.dir = "in"; d.total = parseAmount($("#total").value); d.per = rowsData().filter(r => r.name && r.amount > 0); d.names = d.per.map(r => r.name); d.amount = d.total;
    d.desc = $("#desc").value; d.withMe = $("#withMe").checked; d.cat = $("#cat").value;
    if (!(d.total > 0)) return "Vul het totaal in";
    if (!d.per.length) return "Vul minstens één persoon met een bedrag in";
    if (d.per.reduce((a, r) => a + r.amount, 0) > d.total + 0.004) return "De bedragen samen zijn meer dan het totaal";
    return d;
  }
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
$("#again").addEventListener("click", () => { $("#done").style.display = "none"; $("#f").style.display = "block"; st.settled = false; st.date = CTX.today; $("#fields").innerHTML = ""; draw(); });
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
  if (type === "stage") { let st = {}; try { st = (await getDoc("stage")).data || {}; } catch (e) {} const es = (st.entries || []).slice().sort((a, b) => (a.date + a.from).localeCompare(b.date + b.from)), last = es[es.length - 1];
    ctx.lastFrom = last ? last.from : "09:00"; ctx.lastTo = last ? last.to : "17:00"; ctx.place = st.place || ""; ctx.goal = +st.goal || 130; ctx.stageTot = hm(es.reduce((a, e) => a + (e.minutes || 0), 0)); }
  if (type === "kot") { ctx.cats = (settings.kot && settings.kot.cats) || ["Eten", "Drank", "Extra"]; ctx.defaultCat = ctx.cats[0]; }
  if (type === "uitgave") { ctx.cats = order(exp, settings.recentOut); ctx.defaultCat = (settings.recentOut || [])[0] || ""; }
  if (type === "inkomst") { ctx.cats = order(inc, settings.recentIn); ctx.defaultCat = (settings.recentIn || [])[0] || ""; }
  if (type === "taak") { ctx.cats = [...new Set([...(settings.taskCats || []), "Studie", "Stage", "Klantproject", "Kampen", "Privé"])]; ctx.defaultCat = ctx.cats.includes("Privé") ? "Privé" : ctx.cats[0]; }
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
      if (k === "taak" && d.newCat) { await updateDoc("settings", x => { x = x || {}; const l = x.taskCats || []; if (!l.includes(d.cat)) x.taskCats = l.concat(d.cat); return x; }); }
      if (k === "kot") label = await saveKot(d);
      else if (k === "uitgave") label = await saveMoney(d, settings, "out");
      else if (k === "inkomst") label = await saveMoney(d, settings, "in");
      else if (k === "lijstje") label = await saveList(d);
      else if (k === "taak") label = await saveTask(d);
      else if (k === "voorschot") label = await saveOthers(d, settings);
      else if (k === "stage") label = await saveStage(d);
      if (closed) break;
      await wv.evaluateJavaScript(`LO.done(${JSON.stringify(label)})`, false);
    } catch (e) {
      if (closed) break;
      await wv.evaluateJavaScript(`LO.fail(${JSON.stringify("Opslaan mislukt: " + (e.message || e))})`, false);
    }
  }
}

async function menu() {
  const keys = ["kot", "uitgave", "inkomst", "lijstje", "taak", "voorschot", "stage"];
  const opts = keys.map(k => "+ " + TYPES[k].label).concat(["Life OS openen", kcGet("refresh") ? "Opnieuw koppelen / ander account" : "Koppelen met Life OS"]);
  const i = await choose("Life OS", opts, kcGet("refresh") ? "Wat wil je toevoegen?" : "Nog niet gekoppeld.");
  if (i === null) return;
  if (i < keys.length) return runAdd(keys[i]);
  if (i === keys.length) return Safari.open(APP_URL + "#snel");
  await setup();
}

/* ---------------- start ---------------- */
if (config.runsInWidget) {
  const type = (WPARAM.replace(/\b(donker|dark|zwart|licht|light|wit)\b/g, "").trim().split(/\s+/)[0]) || "overzicht";
  Script.setWidget(await buildWidget(TYPES[type] ? type : "overzicht"));
} else {
  let q = (args.queryParameters && args.queryParameters.type) || ""; if (q === "stagetaken") q = "stage";
  if (TYPES[q] && q !== "overzicht") await runAdd(q); else await menu();
}
Script.complete();
