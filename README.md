# AuraRetire

Personal retirement planning PWA — mobile-first, Firebase-backed.

---

## First-Time Setup

### 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a new project — suggested name: **aura-retire**
3. Skip Google Analytics (not needed)

### 2. Enable Google Sign-In

1. In the project console: **Authentication → Sign-in method**
2. Enable **Google**
3. Save

### 3. Enable Firestore

1. **Firestore Database → Create database**
2. Choose **Production mode**
3. Pick any region (us-central1 is fine)
4. After creation, go to **Rules** and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

5. **Publish** the rules

### 4. Add a Web App

1. **Project settings (gear icon) → Your apps → Add app → Web**
2. App nickname: AuraRetire
3. **Do not** enable Firebase Hosting (you're using GitHub Pages)
4. Copy the `firebaseConfig` object

### 5. Edit firebase-config.js

Open `firebase-config.js` and fill in:

```js
export const FIREBASE_CONFIG = {
  apiKey:            "your-api-key",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project-id",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "your-sender-id",
  appId:             "your-app-id"
};

export const ALLOWED_EMAILS = [
  "your.gmail@gmail.com"   // ← your Gmail address
];
```

### 6. Add GitHub Pages domain to Firebase Auth

1. **Authentication → Settings → Authorized domains**
2. Add your GitHub Pages domain: `wymanrob76.github.io`

### 7. Push to GitHub Pages

Follow the same process as AuraPool:
- Create a new repo (e.g. `Retire_26.1`)
- Push all files to the `main` branch
- Enable GitHub Pages: **Settings → Pages → Branch: main, folder: / (root)**
- Your app will be live at `https://wymanrob76.github.io/Retire_26.1/`

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | App shell + all CSS |
| `app.js` | Auth, routing, all view rendering |
| `assumptions.js` | Data model + Firestore sync |
| `projection.js` | Year-by-year accumulation & distribution engine |
| `montecarlo.js` | Stochastic simulation (1,000 runs) |
| `firebase-config.js` | **Your credentials go here** |
| `sw.js` | Service worker — bump `CACHE_VERSION` on every deploy |
| `manifest.json` | PWA manifest |

---

## Updating Assumptions

All assumptions are editable in the app under **Settings (⚙)**. Changes are saved to Firestore and persist across sessions and devices.

To force a refresh after a code deploy, bump the version string in `sw.js`:

```js
const CACHE_VERSION = 'v1.0.1';  // increment this
```

---

## Model Notes

- All projections use **nominal dollars** (inflation applied to spending in the distribution phase)
- Spending target is expressed in **today's dollars** and inflated annually
- Social Security income is COLA'd at the rate set in Settings
- LTC reserve (from home sale proceeds) is tracked **separately** from the main portfolio
- Monte Carlo randomises annual returns and inflation; success = portfolio not exhausted before life expectancy
- Inheritance is **excluded** from all calculations by design

---

*Built June 2026 · Stack: Vanilla JS PWA · GitHub Pages · Firebase Auth + Firestore*
