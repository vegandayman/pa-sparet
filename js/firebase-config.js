// firebase-config.js
//
// ============================================================================
//  PASTE YOUR FIREBASE CONFIG BELOW. This is the ONLY file you need to edit
//  to connect the app to your own Firebase project.
//
//  How to get this object:
//    1. Go to https://console.firebase.google.com and create a project.
//    2. In the project, click the </> "Web app" icon to register a web app.
//    3. Firebase will show you a config object that looks like the one below
//       — copy it and paste it in place of the placeholder values.
//    4. Make sure you've also enabled "Realtime Database" (not Firestore)
//       in the Firebase console (Build > Realtime Database > Create Database).
//
//  Full step-by-step instructions are in README.md.
// ============================================================================

// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCmCCH4IW37HatXNI1RRGbt12C-Wv83_CA",
  authDomain: "pa-sparet-2026.firebaseapp.com",
  projectId: "pa-sparet-2026",
  storageBucket: "pa-sparet-2026.firebasestorage.app",
  messagingSenderId: "28890647170",
  appId: "1:28890647170:web:eedeff8d787f31806a029b",
  measurementId: "G-X1HX1DESKC"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
