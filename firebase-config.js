// ---------------------------------------------------------------------------
// Firebase config for shared, live-syncing trip expenses.
//
// Paste the values from the Firebase console here, then save and push.
// Until you do, the expenses page still works — it just keeps everything
// on your own device instead of sharing it.
//
// These values are NOT secrets. Every Firebase web app ships them in its
// client code; they identify the project, they do not grant access.
// Access is controlled by the database rules you set in the console.
// ---------------------------------------------------------------------------

window.FIREBASE_CONFIG = {
  apiKey:            "PASTE_API_KEY",
  authDomain:        "PASTE_PROJECT_ID.firebaseapp.com",
  databaseURL:       "PASTE_DATABASE_URL",
  projectId:         "PASTE_PROJECT_ID",
  storageBucket:     "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId:             "PASTE_APP_ID"
};
