// ---------------------------------------------------------------------------
// Firebase config for shared, live-syncing expenses.
//
// These values are NOT secrets. Every Firebase web app ships them in its
// client code; they identify the project, they do not grant access.
// Access is controlled by the Realtime Database rules in the console.
// ---------------------------------------------------------------------------

window.FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDdkkws-d3FVpx0TMn8N8MhuPoJ7wPf7FE",
  authDomain:        "trip-expense-35c6d.firebaseapp.com",
  databaseURL:       "https://trip-expense-35c6d-default-rtdb.firebaseio.com",
  projectId:         "trip-expense-35c6d",
  storageBucket:     "trip-expense-35c6d.firebasestorage.app",
  messagingSenderId: "644066919088",
  appId:             "1:644066919088:web:dab7148befb81935a63175"
};

// The group a first-time visitor is offered when they have none of their own.
window.DEFAULT_TRIP = "stlawrence-sep2026";

// The Google account that administers this app. It can open any group, edit or
// delete anything in one, and delete groups outright.
//
// Changing it here changes what the app offers. It does NOT change what the
// database allows - the same address has to be named in the Realtime Database
// rules in the Firebase console, which is what actually enforces it.
window.ADMIN_EMAIL = "abilashkjm01@gmail.com";

// People who always map to the same name in a group.
//
// When one of these accounts signs in and opens a group that has that name on
// its list and nobody has claimed it, the app links the two silently instead
// of asking. It stops the regulars having to identify themselves over and
// over, and stops a second copy of them being created by accident.
window.PEOPLE_LINKS = {
  "abilashkjm01@gmail.com": "Abilash"
};
