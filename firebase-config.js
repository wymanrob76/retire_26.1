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
// Import the functions you need from the SDKs you need
// import { initializeApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
/*const firebaseConfig = {
  apiKey: "AIzaSyCZcWPQtjYm5QfYWKgduSTtmBk7DOHDjBw",
  authDomain: "aura-retire.firebaseapp.com",
  projectId: "aura-retire",
  storageBucket: "aura-retire.firebasestorage.app",
  messagingSenderId: "102115521864",
  appId: "1:102115521864:web:ecab1431fdb13da8dfef7d",
  measurementId: "G-JQR3KF4KEM"
};*/

// firebase-config.js — fill in your Firebase project values below

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyCZcWPQtjYm5QfYWKgduSTtmBk7DOHDjBw",
  authDomain:        "aura-retire.firebaseapp.com",
  projectId:         "aura-retire",
  storageBucket:     "aura-retire.firebasestorage.app",
  messagingSenderId: "102115521864",
  appId:             "1:102115521864:web:ecab1431fdb13da8dfef7d"
};


// Restrict sign-in to these Google accounts only.
// Leave empty [] to allow any Google account (data is still protected by Firestore rules).
const ALLOWED_EMAILS = [
  "rmwymanl@gmail.com",
  "kwyman76@gmail.com"
];
// Initialize Firebase
//const app = initializeApp(firebaseConfig);
//const analytics = getAnalytics(app);

// Only these Google accounts can sign in.
// Add your Gmail address here.
//export const ALLOWED_EMAILS = [];

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
