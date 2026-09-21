// src/config/firebase.js
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load your downloaded service account JSON file
const serviceAccountPath = path.join(__dirname, "./serviceAccountKey.json");
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

// Initialize Firebase Admin
const app = initializeApp({
  credential: cert(serviceAccount)
});

// Export auth directly so you can use it easily
export const auth = getAuth(app);
export default app;