// ---------------------------------------------------------------------------
// Firebase config for shared, live-syncing trip expenses.
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

// The one shared sheet everybody lands on when they open Expenses from the
// site menu. Change this string if you ever want a clean sheet for a new trip.
window.DEFAULT_TRIP = "stlawrence-sep2026";

// PIN for the admin panel on the Expenses page. Change it to whatever you like.
// Honest limit: this page is public, so anyone determined can read this file
// and find the PIN. It stops the other travellers editing the roster by
// accident - it is a guard rail, not real security.
window.ADMIN_PIN = "5001";
