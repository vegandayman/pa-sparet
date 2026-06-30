// firebase-config.js
//
// ============================================================================
//  PASTE YOUR FIREBASE CONFIG BELOW. This is the ONLY file you need to edit
//  to connect the app to your own Firebase project.
//
//  How to get this object:
//    1. Go to https://console.firebase.google.com and open your project.
//    2. Click the gear icon (top left) → Project settings.
//    3. Scroll down to "Your apps" and click the </> web app you registered.
//    4. Copy the firebaseConfig object shown there.
//    5. Paste it below, replacing the placeholder values.
//
//  IMPORTANT: Make sure databaseURL is present — it's required for Realtime
//  Database and looks like:
//  https://YOUR-PROJECT-ID-default-rtdb.firebaseio.com
//  (or https://YOUR-PROJECT-ID-default-rtdb.europe-west1.firebasedatabase.app
//  if you chose the EU region)
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
