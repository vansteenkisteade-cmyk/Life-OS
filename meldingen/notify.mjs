/* Life OS meldingen – draait elke ±10 minuten via GitHub Actions.
   Leest per gebruiker de taken, kot-gegevens en meldingsvoorkeuren en stuurt web push. */
import admin from "firebase-admin";
import webpush from "web-push";

const TZ = "Europe/Brussels";
const WINDOW_MIN = 90;           // herinneringen tot 90 min te laat nog versturen (GitHub kan vertragen)
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (!sa.project_id) { console.error("FIREBASE_SERVICE_ACCOUNT ontbreekt"); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:lifeos@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
const APP_URL = process.env.APP_URL ? process.env.APP_URL.replace(/\/?$/, "/") : "./";

/* tijd in Brussel als "YYYY-MM-DD" en "HH:MM" */
const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
function local(d = new Date()) { const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value])); return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`, dow: new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`).getUTCDay() }; }
const mins = (date, time) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), +time.slice(0, 2), +time.slice(3, 5)) / 60000;
const addDays = (date, n) => { const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const eur = v => new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(v || 0);
const NOW = local(); const nowMin = mins(NOW.date, NOW.time);
const due = (time) => { const m = mins(NOW.date, time); return nowMin >= m && nowMin - m < WINDOW_MIN; };

async function sendAll(uid, subs, payload) {
  let ok = 0;
  for (const s of subs) {
    if (s.dead) continue;
    try { await webpush.sendNotification(s.data.sub, JSON.stringify(payload), { TTL: 3600, urgency: "high" }); ok++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { await s.ref.delete(); s.dead = true; console.log(uid, "verlopen abonnement verwijderd"); }
      else console.warn(uid, "push mislukt", e.statusCode || e.message);
    }
  }
  return ok;
}

async function run() {
  const users = await db.collection("users").listDocuments();
  console.log(`Brussel ${NOW.date} ${NOW.time} · ${users.length} gebruiker(s)`);
  for (const u of users) {
    const uid = u.id;
    const subsSnap = await u.collection("push").get();
    const subs = subsSnap.docs.map(d => ({ ref: d.ref, data: d.data() })).filter(s => s.data && s.data.sub);
    if (!subs.length) continue;
    const [settingsD, tasksD, kotD, sentD, testD, dayD] = await Promise.all([
      u.collection("docs").doc("settings").get(), u.collection("docs").doc("tasks").get(), u.collection("docs").doc("kot").get(),
      u.collection("meta").doc("sent").get(), u.collection("meta").doc("testpush").get(), u.collection("docs").doc("day").get()
    ]);
    const dayList = ((dayD.data() || {}).items || []).filter(i => !i.done && i.date === NOW.date);
    const settings = settingsD.data() || {};
    const n = Object.assign({ reminders: true, daily: true, dailyTime: "08:00", dayBefore: true, dayBeforeTime: "19:00", kot: true, kotTime: "18:00" }, settings.notify || {});
    const tasks = ((tasksD.data() || {}).items || []).filter(t => t.status !== "Klaar");
    const sent = (sentD.data() || {}).keys || {};
    const out = [];

    // 1. herinneringen op tijdstip (zonder tijd: om het ochtendtijdstip)
    if (n.reminders) for (const t of tasks) {
      if (!t.reminder || !t.deadline) continue;
      const time = t.time || n.dailyTime || "08:00";
      if (t.deadline !== NOW.date || !due(time)) continue;
      const key = `rem:${t.id}:${t.deadline}:${time}`;
      if (!sent[key]) out.push({ key, payload: { title: "🔔 " + t.title, body: t.time ? `Herinnering · ${t.time}` : "Herinnering voor vandaag", tag: "rem-" + t.id, url: APP_URL + "#snel" } });
    }
    // 2. ochtendoverzicht
    if (n.daily && due(n.dailyTime || "08:00")) {
      const key = `daily:${NOW.date}`;
      const today = tasks.filter(t => t.deadline === NOW.date), late = tasks.filter(t => t.deadline && t.deadline < NOW.date);
      if (!sent[key] && (today.length || late.length || dayList.length)) {
        const names = today.slice(0, 3).map(t => t.title).join(", ") + (today.length > 3 ? ` en nog ${today.length - 3}` : "");
        const lijst = dayList.slice(0, 3).map(i => i.text).join(", ") + (dayList.length > 3 ? ` en nog ${dayList.length - 3}` : "");
        out.push({ key, payload: { title: "Vandaag in Life OS", body: [dayList.length ? `Lijstje: ${lijst}` : "", today.length ? `Deadlines: ${names}` : "", late.length ? `${late.length} te laat` : ""].filter(Boolean).join(" · "), tag: "daily", url: APP_URL + "#snel" } });
      } else if (!sent[key]) sent[key] = true; // niets te melden: niet opnieuw proberen vandaag
    }
    // 3. avond ervoor: deadlines van morgen
    if (n.dayBefore && due(n.dayBeforeTime || "19:00")) {
      const key = `daybefore:${NOW.date}`; const tom = addDays(NOW.date, 1);
      const list = tasks.filter(t => t.deadline === tom && !t.reminder);
      if (!sent[key] && list.length) out.push({ key, payload: { title: "Morgen deadline", body: list.slice(0, 4).map(t => t.title).join(", ") + (list.length > 4 ? ` en nog ${list.length - 4}` : ""), tag: "daybefore", url: APP_URL + "#taken" } });
      else if (!sent[key]) sent[key] = true;
    }
    // 4. kot-afrekening op afrekendag
    const kset = settings.kot || {}; const settleDay = kset.settleDay ?? 0;
    if (n.kot && NOW.dow === settleDay && due(n.kotTime || "18:00")) {
      const key = `kot:${NOW.date}`;
      const items = ((kotD.data() || {}).items || []).filter(i => !i.statementId && !i.excluded && !i.settled && i.date <= NOW.date);
      const total = items.reduce((a, i) => a + (i.amount || 0), 0);
      if (!sent[key] && items.length) out.push({ key, payload: { title: "Kot-afrekening klaarmaken", body: `${items.length} item${items.length > 1 ? "s" : ""} · ${eur(total)} voor ${kset.recipient || "mama"}`, tag: "kot", url: APP_URL + "#kot" } });
      else if (!sent[key]) sent[key] = true;
    }
    // 5. testmelding op verzoek
    if (testD.exists) { out.push({ key: null, payload: { title: "Life OS", body: "Testmelding via de server: alles werkt.", tag: "test", url: APP_URL + "#instellingen" } }); await testD.ref.delete(); }

    for (const o of out) { const ok = await sendAll(uid, subs, o.payload); if (o.key && ok) sent[o.key] = true; console.log(uid, o.payload.title, "→", ok, "toestel(len)"); }
    // oude sleutels (ouder dan 3 dagen) opruimen
    const cutoff = addDays(NOW.date, -3);
    for (const k of Object.keys(sent)) { const m = k.match(/(\d{4}-\d{2}-\d{2})/); if (m && m[1] < cutoff) delete sent[k]; }
    await u.collection("meta").doc("sent").set({ keys: sent, updated: new Date().toISOString() });
  }
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
