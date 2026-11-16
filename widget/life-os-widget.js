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
    next: openTasks.filter(x => x.deadline >= t).slice(0, 3),
    get, owe
  };
}
const dueLabel = d => { const t = today(); if (d === t) return "vandaag"; if (d === addDays(t, 1)) return "morgen"; return d.slice(8, 10) + "/" + d.slice(5, 7); };

/* ---------------- widget tekenen ---------------- */
const C = {bg: Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e")), text: Color.dynamic(new Color("#2f2e2b"), new Color("#ecebe7")), muted: Color.dynamic(new Color("#6b6a66"), new Color("#a5a49e"))};
function header(w, type, size) {
  const T = TYPES[type] || TYPES.overzicht;
  const st = w.addStack(); st.centerAlignContent();
  const img = st.addImage(SFSymbol.named(T.symbol).image); img.imageSize = new Size(size, size); img.tintColor = new Color(T.color);
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
  if (type === "overzicht" || fam === "medium" || fam === "large") {
    header(w, "overzicht", 16); w.addSpacer(8);
    if (!S) { line(w, "Geen verbinding", 12); return w; }
    line(w, S.list.length ? `Lijstje: ${S.list.slice(0, 3).map(i => i.text).join(", ")}` : "Lijstje: niets voor vandaag", 12, C.text);
    w.addSpacer(4);
    if (S.next.length) S.next.slice(0, fam === "large" ? 3 : 2).forEach(x => line(w, `• ${x.title} · ${dueLabel(x.deadline)}`, 12, C.text));
    else line(w, "Geen deadlines", 12);
    if (S.late) line(w, `${S.late} te laat`, 12, new Color("#d03b3b"), true);
    w.addSpacer();
    line(w, `Kot ${eur(S.kot)}${S.get ? ` · anderen +${eur(S.get)}` : ""}${S.owe ? ` · jij −${eur(S.owe)}` : ""}`, 11);
    return w;
  }
  header(w, type, 20); w.addSpacer();
  const big = (txt) => line(w, txt, 22, C.text, true);
  if (!S) { line(w, "Tik om toe te voegen", 12); return w; }
  if (type === "kot") { big(eur(S.kot)); line(w, "nog terug van mama", 11); }
  else if (type === "uitgave") { big(eur(S.out)); line(w, "uitgegeven deze maand", 11); }
  else if (type === "inkomst") { big(eur(S.in)); line(w, "verdiend deze maand", 11); }
  else if (type === "lijstje") { if (S.list.length) { S.list.slice(0, 3).forEach(i => line(w, "○ " + i.text, 12, C.text)); } else line(w, "Niets voor vandaag", 12); }
  else if (type === "taak") { if (S.next[0]) { line(w, S.next[0].title, 13, C.text, true); line(w, dueLabel(S.next[0].deadline), 11); } else line(w, "Geen deadlines", 12); if (S.late) line(w, `${S.late} te laat`, 11, new Color("#d03b3b")); }
  else if (type === "voorschot") { big(`+${eur(S.get)}`); line(w, S.owe ? `jij moet ${eur(S.owe)}` : "te krijgen", 11); }
  w.addSpacer(2); line(w, "+ toevoegen", 10, new Color((TYPES[type] || TYPES.overzicht).color), true);
  return w;
}

/* ---------------- invoeren ---------------- */
const guessOwnCat = (desc, cats) => { if (/caf|resto|eten|drink|drank|bar|pint|bier|cola|koffie|friet|frit|pizza|lunch|kebab|snack|burger|sushi/i.test(desc || "") && cats.includes("Eten buitenshuis")) return "Eten buitenshuis"; return cats.includes("Vrije tijd") ? "Vrije tijd" : cats[0]; };
const domainOf = (list, name) => ((list || []).find(c => c.name === name) || {}).domain || "Privé";
async function pickDate(allowPast) {
  const opts = allowPast ? ["Vandaag", "Gisteren", "Eergisteren"] : ["Vandaag", "Morgen", "Overmorgen", "Volgende week", "Geen datum"];
  const i = await choose("Wanneer?", opts); if (i === null) return null;
  const t = today();
  return allowPast ? addDays(t, -i) : [t, addDays(t, 1), addDays(t, 2), addDays(t, 7), ""][i];
}
async function addKot(settings) {
  const cats = (settings.kot && settings.kot.cats) || ["Eten", "Drank", "Extra"];
  const v = await ask("Kot · voorgeschoten", "Bedrag en (optioneel) omschrijving", [{placeholder: "Bedrag, bv. 5,45", decimal: true}, {placeholder: "Omschrijving, bv. Colruyt"}], "Volgende");
  if (!v) return null; const amount = parseAmount(v[0]); if (!(amount > 0)) { await info("Ongeldig bedrag", "Vul een bedrag in, bv. 5,45"); return null; }
  const ci = await choose("Categorie", cats); if (ci === null) return null;
  const item = {id: uid(), date: today(), amount, cat: cats[ci], desc: ucf(v[1].trim()), statementId: "", excluded: false, settled: false};
  await pushItem("kot", item);
  return `Kot · ${cats[ci]} · ${eur(amount)}${item.desc ? " · " + item.desc : ""}`;
}
async function addMoney(settings, kind) {
  const list = kind === "in" ? (settings.incomeCats || []) : (settings.expenseCats || []);
  const recent = (kind === "in" ? settings.recentIn : settings.recentOut) || [];
  const names = list.map(c => c.name); const ordered = [...recent.filter(n => names.includes(n)), ...names.filter(n => !recent.includes(n))];
  const v = await ask(kind === "in" ? "Inkomst" : "Uitgave", "Bedrag en omschrijving", [{placeholder: "Bedrag", decimal: true}, {placeholder: kind === "in" ? "bv. shift zaterdag" : "bv. Delhaize"}], "Volgende");
  if (!v) return null; const amount = parseAmount(v[0]); if (!(amount > 0)) { await info("Ongeldig bedrag", "Vul een bedrag in, bv. 12,50"); return null; }
  const ci = await choose("Categorie", ordered); if (ci === null) return null;
  const cat = ordered[ci];
  let hours = null;
  if (kind === "in" && cat === "Studentenjob") { const h = await ask("Gewerkte uren", "Optioneel", [{placeholder: "bv. 8", decimal: true}]); if (h && h[0]) hours = parseAmount(h[0]) || null; }
  const date = await pickDate(true); if (date === null) return null;
  const desc = ucf(v[1].trim()) || cat;
  const tx = {id: uid(), kind, date, amount, desc, cat, party: "", method: "Bank", domain: domainOf(list, cat), note: "", taskId: "", hours};
  await pushItem("tx-" + date.slice(0, 7), tx);
  return `${kind === "in" ? "Inkomst" : "Uitgave"} · ${cat} · ${eur(amount)}`;
}
async function addList() {
  const v = await ask("Lijstje", "Wat wil je doen?", [{placeholder: "bv. boodschappen doen"}], "Volgende");
  if (!v || !v[0].trim()) return null;
  const i = await choose("Voor wanneer?", ["Vandaag", "Morgen"]); if (i === null) return null;
  const date = i === 1 ? addDays(today(), 1) : today();
  await pushItem("day", {id: uid(), text: ucf(v[0].trim()), date, done: false, taskId: ""});
  return `Lijstje ${i === 1 ? "morgen" : "vandaag"} · ${ucf(v[0].trim())}`;
}
async function addTask(settings) {
  const v = await ask("Nieuwe taak", "Titel en optioneel een tijd voor een herinnering (bv. 18:00)", [{placeholder: "Wat moet er gebeuren?"}, {placeholder: "Tijd (optioneel)"}], "Volgende");
  if (!v || !v[0].trim()) return null;
  const date = await pickDate(false); if (date === null) return null;
  const cats = settings.taskCats || ["Studie", "Stage", "Klantproject", "Kampen", "Privé"];
  const ci = await choose("Categorie", cats); if (ci === null) return null;
  const tm = /^(\d{1,2})[:u.h]?(\d{2})?$/.exec(v[1].trim().toLowerCase()); const time = tm && +tm[1] < 24 ? pad(+tm[1]) + ":" + (tm[2] || "00") : "";
  const t = {id: uid(), title: ucf(v[0].trim()), deadline: date, cat: cats[ci], type: "indienen", client: "", amount: null, priority: "Middel", status: "Te doen", note: "", reminder: !!time, time};
  await pushItem("tasks", t);
  return `Taak · ${t.title}${date ? " · " + dueLabel(date) : ""}${time ? " om " + time : ""}`;
}
async function addOthers(settings) {
  const di = await choose("Wat is het?", ["Voorschot · ik betaalde, zij moeten mij", "Schuld · zij betaalden, ik moet hen"]); if (di === null) return null;
  const debt = di === 1;
  const v = await ask(debt ? "Schuld" : "Voorschot", debt ? "Bedrag per persoon, aan wie, waarvoor" : "Bedrag per persoon (of totaal, zie volgende stap), wie, waarvoor", [{placeholder: "Bedrag", decimal: true}, {placeholder: "Wie (meerdere: komma of en)"}, {placeholder: "Waarvoor, bv. café"}], "Volgende");
  if (!v) return null;
  let amount = parseAmount(v[0]); const names = v[1].split(/,|\s+en\s+/i).map(capName).filter(Boolean); const desc = v[2].trim();
  if (!(amount > 0) || !names.length) { await info("Onvolledig", "Vul een bedrag en minstens één naam in."); return null; }
  const expCats = (settings.expenseCats || []).map(c => c.name); const cat = guessOwnCat(desc, expCats);
  let withMe = debt;
  if (!debt) {
    const s = await choose("Deed je zelf mee?", ["Nee, alleen zij", `Ja, bedrag is per persoon (${eur(amount)}) + mijn deel als uitgave`, `Ja, ${eur(amount)} is het totaal: delen door ${names.length + 1}`]);
    if (s === null) return null;
    if (s === 2) amount = r2(amount / (names.length + 1));
    withMe = s > 0;
  }
  const date = today(), month = "tx-" + date.slice(0, 7);
  const items = names.map(p => ({id: uid(), dir: debt ? "out" : "in", date, amount, person: p, desc, note: "", paid: false, paidDate: ""}));
  if (withMe) {
    if (debt) {
      const txs = items.map(it => { const tx = {id: uid(), kind: "out", date, amount, desc: `${ucf(desc) || "Schuld"} (betaald door ${it.person})`, cat, party: it.person, method: "Bank", domain: domainOf(settings.expenseCats, cat), note: "Schuld: " + it.person + " schoot voor", taskId: "", hours: null}; it.txId = tx.id; return tx; });
      await updateDoc(month, d => { d = d || {items: []}; d.items = (d.items || []).concat(txs); return d; });
    } else {
      const tx = {id: uid(), kind: "out", date, amount, desc: `${ucf(desc) || "Gedeelde rekening"} (mijn deel)`, cat, party: "", method: "Bank", domain: domainOf(settings.expenseCats, cat), note: "Mijn deel, samen met " + names.join(", "), taskId: "", hours: null};
      items.forEach(it => it.shareTxId = tx.id);
      await pushItem(month, tx);
    }
  }
  await updateDoc("others", d => { d = d || {items: []}; d.items = (d.items || []).concat(items); return d; });
  return `${debt ? "Schuld aan" : "Voorschot voor"} ${names.join(", ")} · ${eur(amount)}${names.length > 1 ? " p.p." : ""}${withMe ? " · eigen deel als uitgave" : ""}`;
}
async function runAdd(type) {
  if (!await token()) { if (!await setup()) return; }
  let settings = {}; try { settings = (await getDoc("settings")).data || {}; } catch (e) { await info("Geen verbinding", "Controleer je internet en probeer opnieuw."); return; }
  while (true) {
    let label = null;
    try {
      if (type === "kot") label = await addKot(settings);
      else if (type === "uitgave") label = await addMoney(settings, "out");
      else if (type === "inkomst") label = await addMoney(settings, "in");
      else if (type === "lijstje") label = await addList();
      else if (type === "taak") label = await addTask(settings);
      else if (type === "voorschot") label = await addOthers(settings);
    } catch (e) { await info("Opslaan mislukt", String(e.message || e)); return; }
    if (!label) return;
    const a = new Alert(); a.title = "Opgeslagen ✓"; a.message = label; a.addAction("Klaar"); a.addAction("Nog één toevoegen");
    if (await a.presentAlert() !== 1) return;
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
