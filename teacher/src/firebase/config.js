import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBH6BsxePrtj40uXQHq8-uNW-USDadDXfs",
  authDomain: "rka-academic-tracker.firebaseapp.com",
  projectId: "rka-academic-tracker",
  storageBucket: "rka-academic-tracker.firebasestorage.app",
  messagingSenderId: "775717702646",
  appId: "1:775717702646:web:db8ed71a1101f7b44e55d7"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

