const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Chemin vers la base de données SQLite dans le dossier data/ à la racine
const dbPath = path.join(__dirname, '../../data/chat.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erreur lors de l\'ouverture de la base SQLite :', err.message);
  } else {
    console.log('Connexion réussie à la base SQLite (chat.db).');
  }
});

function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Activation des clés étrangères
      db.run('PRAGMA foreign_keys = ON;', (err) => {
        if (err) return reject(err);
      });

      // Table des utilisateurs
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `, (err) => {
        if (err) return reject(err);
      });

      // Table des messages
      db.run(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          kind TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
      `, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

function createUser(name, passwordHash) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO users (name, password_hash) VALUES (?, ?)`;
    db.run(sql, [name, passwordHash], function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, name });
    });
  });
}

function findUserByName(name) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM users WHERE name = ?`;
    db.get(sql, [name], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function saveMessage(userId, kind, body) {
  return new Promise((resolve, reject) => {
    const sql = `INSERT INTO messages (user_id, kind, body) VALUES (?, ?, ?)`;
    db.run(sql, [userId, kind, body], function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID });
    });
  });
}

function getUserHistory(userId) {
  return new Promise((resolve, reject) => {
    const sql = `SELECT id, kind, body, created_at FROM messages WHERE user_id = ? ORDER BY id ASC`;
    db.all(sql, [userId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

module.exports = {
  db,
  initDatabase,
  createUser,
  findUserByName,
  saveMessage,
  getUserHistory
};