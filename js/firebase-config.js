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

const firebaseConfig = {
  apiKey: "YOUR_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

export { firebaseConfig };
