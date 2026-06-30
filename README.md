# På Spåret — Multiplayer Trivia Game

A live, multiplayer trivia game modelled after the Swedish TV show *På Spåret*.
Hosted on GitHub Pages, real-time sync via Firebase Realtime Database.

---

## Project structure

```
/
├── index.html          ← Landing page (choose Host / Join / Admin)
├── host.html           ← TV display view  [coming soon]
├── player.html         ← Mobile player view  [coming soon]
├── admin.html          ← Quiz builder  ✅ ready now
├── css/
│   ├── styles.css      ← Shared design tokens
│   ├── admin.css
│   ├── host.css        [coming soon]
│   └── player.css      [coming soon]
└── js/
    ├── firebase-config.js   ← YOUR KEYS GO HERE (see Step 1 below)
    ├── firebase-sync.js     ← Firebase wrapper
    ├── quiz-schema.js       ← Quiz JSON shape + validation
    ├── scoring.js           ← All scoring logic
    ├── admin.js / admin-ui.js
    ├── host.js / host-ui.js / host-media.js   [coming soon]
    ├── player.js / player-ui.js               [coming soon]
    └── round-types/                           [coming soon]
```

---

## Step 1 — Create a Firebase project

1. Go to **https://console.firebase.google.com**
2. Click **Add project**, give it a name (e.g. `pa-sparet`), click through the
   setup wizard (you can disable Google Analytics if you like).
3. Once the project is created, click the **`</>`** (Web) icon on the project
   overview page to register a web app.
4. Give the app a nickname (e.g. `pa-sparet-web`). **Do not** enable Firebase
   Hosting — you're using GitHub Pages instead.
5. Firebase will show you a config block that looks like this:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "pa-sparet.firebaseapp.com",
  databaseURL: "https://pa-sparet-default-rtdb.firebaseio.com",
  projectId: "pa-sparet",
  storageBucket: "pa-sparet.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123",
};
```

6. Open **`js/firebase-config.js`** in this repo and paste your values in,
   replacing the placeholder strings. That file is the only one you need to edit.

---

## Step 2 — Enable Realtime Database

1. In the Firebase console left sidebar, go to **Build → Realtime Database**.
2. Click **Create Database**.
3. Choose a region (e.g. `europe-west1` for Sweden/EU — closer = lower latency).
4. When asked about security rules, choose **Start in test mode** for now.
   (You'll tighten the rules in Step 3 below.)
5. Copy the database URL — it looks like
   `https://pa-sparet-default-rtdb.firebaseio.com`.
   Make sure this matches the `databaseURL` value in your `firebase-config.js`.

---

## Step 3 — Set security rules

In the Firebase console, go to **Realtime Database → Rules** and replace the
contents with the following, then click **Publish**:

```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": true,

        "meta": {
          ".write": true
        },
        "quiz": {
          ".write": true
        },
        "currentQuestion": {
          ".write": true
        },
        "questionMeta": {
          ".write": true
        },

        "players": {
          "$playerId": {
            ".write": "auth == null || $playerId === auth.uid"
          }
        },

        "answers": {
          "$questionId": {
            "$playerId": {
              ".write": true
            }
          }
        }
      }
    }
  }
}
```

> **Note:** This is a permissive ruleset suitable for a private party game
> where you trust all participants. It prevents players from writing to
> *other* players' nodes but does not require authentication. For a more
> locked-down setup, enable Firebase Anonymous Auth and tighten the player
> write rules to `"$playerId === auth.uid"`.

---

## Step 4 — Push to GitHub and enable GitHub Pages

1. Create a new repository on GitHub (public or private — Pages works with both
   if you have the right plan).
2. Push this folder to the repo:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

3. In the GitHub repo, go to **Settings → Pages**.
4. Under **Source**, choose **Deploy from a branch**, select `main`, folder `/`
   (root). Click **Save**.
5. After a minute or two, GitHub will give you a URL like
   `https://YOUR_USERNAME.github.io/YOUR_REPO/`.
6. Open `https://YOUR_USERNAME.github.io/YOUR_REPO/admin.html` to test the
   quiz builder.

> **Important:** Because the JS files use ES modules (`type="module"`), the
> files *must* be served over HTTP/HTTPS — they will not work if you just
> double-click `admin.html` to open it as a `file://` URL. Always use the
> GitHub Pages URL, or run a local server (see below).

---

## Local development (optional)

If you want to test locally before pushing:

```bash
# Python 3 (usually pre-installed on Mac/Linux)
python3 -m http.server 8000

# Then open http://localhost:8000/admin.html
```

Or with Node:
```bash
npx serve .
```

---

## Using the quiz builder

1. Open `/admin.html`
2. Click **Load sample quiz** to see a complete example of all four round types.
3. Use the **Add a round** buttons to add rounds in the order they'll play.
4. Fill in questions — each round type has its own form fields.
   - **Closest Wins**: click the map to drop a pin on the target location.
   - **Music Round**: add up to 4 blanks (artist/title), one point each.
   - **Destination Trivia**: toggle between multiple-choice and free-text.
5. Click **Export JSON** to download your quiz file.
   - The builder validates before exporting and tells you what's missing.
6. Your draft is auto-saved in your browser's localStorage, so closing the tab
   won't lose your work.

---

## What's coming next

- `player.html` — mobile join + answer interface, with reconnection support
- `host.html` — TV display with YouTube playback, clue reveals, leaderboard
- `index.html` — landing page (room code entry, host/join routing)
- Round-type modules for all four question types
