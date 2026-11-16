# Life OS als app: stappenplan

Na deze stappen heb je Life OS als echte app op je iPhone en laptop:
- schermvullend, zonder claude.ai-link en zonder inzoomen;
- werkt **offline** (synchroniseert zodra je weer internet hebt);
- dezelfde data op gsm en laptop;
- **eigen meldingen van "Life OS"**.

Alles is gratis. Reken op ongeveer een uur. Doe de stappen op je **laptop**, behalve stap 8.

Je hebt drie bestanden gekregen:
- `lifeos-app.zip`: de app (deze map)
- `GEHEIM-meldingssleutels.txt`: **nooit uploaden naar GitHub**
- `lifeos-backup.json`: je huidige gegevens (taken, kot-items, instellingen)

---

## Stap 1 – GitHub-account en repository

1. Maak een gratis account op **github.com**. Je gebruikersnaam komt in de link van je app, bv. `adevs.github.io/lifeos`.
2. Klik rechtsboven op **+** → **New repository**.
   - Repository name: `lifeos`
   - Kies **Public**. Dat is nodig voor gratis hosting. Je *code* is dan zichtbaar, je *gegevens* niet: die staan beveiligd in Firebase.
   - Klik op **Create repository**.
3. Klik op **uploading an existing file**.
4. Pak `lifeos-app.zip` uit en sleep **de inhoud** van de map naar het uploadvak (dus `index.html`, `config.js`, `sw.js`, de mappen `icons` en `meldingen`, enz.).
   - ⚠️ Er zit ook een verborgen map **`.github`** in. Op een Mac maak je die zichtbaar met **Cmd + Shift + .** in Finder; sleep ze dan mee. Op Windows: Verkenner → Beeld → Verborgen items.
   - Lukt dat niet? Doe dan na de upload: **Add file → Create new file**, typ als naam `.github/workflows/meldingen.yml` en plak de inhoud van het bestand `meldingen.yml` uit de map `.github/workflows`.
5. Klik op **Commit changes**.

## Stap 2 – De app online zetten (GitHub Pages)

1. Ga in je repository naar **Settings** → **Pages**.
2. Bij *Source*: **Deploy from a branch**, Branch: **main**, map **/ (root)** → **Save**.
3. Na 1–2 minuten staat bovenaan: *Your site is live at* `https://JOUWNAAM.github.io/lifeos/`. **Noteer die link.**

## Stap 3 – Firebase-project (je database en login)

1. Ga naar **console.firebase.google.com** en log in met een Google-account.
2. **Create a project** → naam `lifeos` → Google Analytics mag **uit** → **Create**.
3. Klik op het **</>**-icoon (*Add app → Web*). Naam: `Life OS`, Firebase Hosting **niet** aanvinken → **Register app**.
4. Je ziet een blok `const firebaseConfig = { apiKey: "...", ... }`. **Laat dit venster open**, je hebt het nodig in stap 4.

## Stap 4 – config.js invullen

1. Open in GitHub je repository → klik op `config.js` → het **potloodje** (Edit).
2. Vervang de zes `VUL_IN`-waarden door die uit het Firebase-blok (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId). Laat `vapidPublicKey` staan zoals hij is.
3. **Commit changes**.

## Stap 5 – Inloggen en database aanzetten

**Login:**
1. In Firebase: menu **Build → Authentication → Get started**.
2. Tab **Sign-in method** → **Email/Password** → aanzetten → **Save**.
3. Tab **Settings → Authorized domains** → **Add domain** → `JOUWNAAM.github.io`.

**Database:**
1. **Build → Firestore Database → Create database**.
2. Locatie: **europe-west1 (Belgium)** → *Start in production mode* → **Create**.
3. Tab **Rules**: vervang alles door de inhoud van `firestore.rules` uit de zip → **Publish**.

## Stap 6 – Sleutels voor de meldingen (GitHub Secrets)

1. In Firebase: **⚙ Project settings → Service accounts → Generate new private key → Generate key**. Er wordt een `.json`-bestand gedownload.
2. In GitHub: repository → **Settings → Secrets and variables → Actions → New repository secret**. Maak deze vijf aan:

| Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | de **volledige inhoud** van het gedownloade .json-bestand |
| `VAPID_PUBLIC_KEY` | uit `GEHEIM-meldingssleutels.txt` |
| `VAPID_PRIVATE_KEY` | uit `GEHEIM-meldingssleutels.txt` |
| `VAPID_SUBJECT` | `mailto:` + je e-mailadres, bv. `mailto:ade@voorbeeld.be` |
| `APP_URL` | je link uit stap 2, bv. `https://JOUWNAAM.github.io/lifeos/` |

3. **Verwijder daarna** het .json-bestand en `GEHEIM-meldingssleutels.txt` van je laptop (of bewaar ze veilig). Upload ze nooit naar GitHub.

## Stap 7 – Meldingen-robot aanzetten

1. In GitHub: tab **Actions**. Klik op **I understand my workflows, go ahead and enable them** als dat gevraagd wordt.
2. Klik links op **Life OS meldingen** → **Run workflow** → **Run workflow**.
3. Na ±1 minuut zie je een **groen vinkje**. Vanaf nu draait hij vanzelf elke ±10 minuten.

## Stap 8 – Op je laptop en je iPhone

**Laptop (eerst):**
1. Open je link uit stap 2 → **Account maken** met e-mail + wachtwoord.
2. Kies **Back-up importeren** → `lifeos-backup.json`. Je taken, kot-items en instellingen staan erin.

**iPhone:**
1. Open je link in **Safari** → deelicoon (vierkant met pijl) → **Zet op beginscherm** → **Voeg toe**.
2. Open Life OS **via het nieuwe icoon** en log in met hetzelfde account.
3. Ga naar **Instellingen → Meldingen → Meldingen aanzetten** → **Sta toe**.
4. Tik op **Testmelding**. Je krijgt meteen een melding, en binnen ±10 minuten een tweede via de server.
5. Je oude beginscherm-icoon (de claude.ai-link) mag weg.

---

## Goed om te weten
- **Meldingen** komen elke ±10 minuten. Een herinnering voor 18:00 kan dus tot een paar minuten later binnenkomen. In Instellingen kies je welke je wilt: herinneringen, ochtendoverzicht, deadlines van morgen, kot-afrekening.
- **iPhone**: meldingen werken alleen als je Life OS opent via het icoon op je beginscherm (iOS 16.4 of nieuwer).
- **Offline**: alles wat je zonder internet invult, wordt gesynchroniseerd zodra je weer online bent. Inloggen kan alleen online.
- **GitHub pauzeert** geplande taken in een repository waar 60 dagen niets aan veranderd is. Je krijgt dan een mail: klik in **Actions** op *Enable workflow*.
- **Kosten**: GitHub Pages, GitHub Actions en het gratis Firebase-plan (Spark) volstaan ruim voor jou alleen.
- **Spraak**: gebruik de microfoon van je iPhone-toetsenbord in Snel toevoegen.
- **Mijn lijstje**: typ in Snel toevoegen `- boodschappen` (vandaag) of `- morgen mail prof` (morgen), of gebruik de kaart *Mijn lijstje*. Het ochtendoverzicht toont ook je lijstje.
- **Updates**: krijg je later een nieuwe `index.html` van Claude, upload die dan in je repository (Add file → Upload files, zelfde naam overschrijven). Je data blijft staan.
