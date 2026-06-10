const firebaseConfig = {
  apiKey: "AIzaSyDzYt5HnrpEL7MyNJQAOReC9JbMqeYvHV4",
  authDomain: "rpg-survival-a7169.firebaseapp.com",
  databaseURL: "https://rpg-survival-a7169-default-rtdb.firebaseio.com",
  projectId: "rpg-survival-a7169",
  storageBucket: "rpg-survival-a7169.firebasestorage.app",
  messagingSenderId: "707433762966",
  appId: "1:707433762966:web:2c00ea9db486839ffe72b7"
};

firebase.initializeApp(firebaseConfig);
const db   = firebase.database();
const auth = firebase.auth();
