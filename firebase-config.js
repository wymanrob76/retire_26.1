// firebase-config.js — AuraRetire
//
// HOW TO SET UP:
// 1. Create a new Firebase project at console.firebase.google.com
//    Suggested name: aura-retire (or auraretire-XXXX)
// 2. Add a Web App to the project → copy the firebaseConfig object below
// 3. Enable Authentication → Sign-in method → Google → Enable
// 4. Enable Firestore Database → Start in production mode
// 5. Set Firestore rules (see README for the exact rules)
// 6. Add your GitHub Pages domain to Auth → Settings → Authorized domains
// 7. Set ALLOWED_EMAILS to your Gmail address(es)
//
// IMPORTANT: This file is public on GitHub. The Firebase API key is safe
// to expose in a web app — security is enforced by Firestore rules + Auth.
// Only authenticated users with matching emails can access data.

export const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// Only these Google accounts can sign in.
// Add your Gmail address here.
export const ALLOWED_EMAILS = [
  "your.gmail@gmail.com"
];

// Firestore security rules to paste in Firebase console:
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
*/
