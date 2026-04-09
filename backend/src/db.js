const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "mediloop.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rotations (
    id TEXT PRIMARY KEY,
    hospital TEXT NOT NULL,
    service TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    tutor_id TEXT,
    qr_token TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'planificada'
  );

  CREATE TABLE IF NOT EXISTS rotation_students (
    rotation_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    PRIMARY KEY (rotation_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS attendance_pending (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    rotation_id TEXT,
    area TEXT NOT NULL,
    scanned_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attendance_confirmed (
    id TEXT PRIMARY KEY,
    student_name TEXT NOT NULL,
    area TEXT NOT NULL,
    time TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evaluations (
    id TEXT PRIMARY KEY,
    student_name TEXT NOT NULL,
    rotation TEXT NOT NULL,
    theory INTEGER DEFAULT 0,
    practical INTEGER DEFAULT 0,
    communication INTEGER DEFAULT 0,
    comments TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tutor_posts (
    id TEXT PRIMARY KEY,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS student_posts (
    id TEXT PRIMARY KEY,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    likes INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
  );
`);

// Migration: add student_id to attendance_confirmed if missing
try { db.prepare("ALTER TABLE attendance_confirmed ADD COLUMN student_id TEXT").run(); } catch (_) {}

function seedIfEmpty(table, sql, rows) {
  const count = db.prepare("SELECT COUNT(*) as n FROM " + table).get().n;
  if (count === 0) {
    const stmt = db.prepare(sql);
    rows.forEach(function(r) { stmt.run(...r); });
  }
}

// Seed demo users (password: 123456)
const DEMO_HASH = bcrypt.hashSync("123456", 10);
const ADMIN_HASH = bcrypt.hashSync("Mediloop2026!", 10);
const now = new Date().toISOString();

seedIfEmpty("users",
  "INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)",
  [
    ["stu-1", "alumno@uji.es", "Ana Martínez", "student", DEMO_HASH, now],
    ["stu-2", "carlos.perez@uji.es", "Carlos Pérez", "student", DEMO_HASH, now],
    ["tut-1", "tutor@uji.es", "Dra. María González", "tutor", DEMO_HASH, now],
    ["tut-2", "dr.ruiz@uji.es", "Dr. Fernando Ruiz", "tutor", DEMO_HASH, now]
  ]
);

// Admin siempre existe (upsert tras el seed)
const adminExists = db.prepare("SELECT id FROM users WHERE id = 'adm-1'").get();
if (!adminExists) {
  db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)").run(
    "adm-1", "admin@uji.es", "Admin Mediloop", "tutor", ADMIN_HASH, now
  );
}

seedIfEmpty("rotations",
  "INSERT INTO rotations VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  [
    ["rot-1", "Hospital General de Castellón", "Medicina Interna", "2026-03-01", "2026-04-15", "tut-1", "qr-rot-1-token", "en curso"],
    ["rot-2", "Centro de Salud 9 de Octubre", "Atención Primaria", "2026-04-20", "2026-05-20", "tut-2", "qr-rot-2-token", "planificada"]
  ]
);

seedIfEmpty("rotation_students",
  "INSERT INTO rotation_students VALUES (?, ?)",
  [
    ["rot-1", "stu-1"],
    ["rot-1", "stu-2"],
    ["rot-2", "stu-1"]
  ]
);

seedIfEmpty("attendance_confirmed",
  "INSERT INTO attendance_confirmed VALUES (?, ?, ?, ?)",
  [
    ["att-3", "Ana Martínez", "Medicina Interna", "08:30"],
    ["att-4", "Carlos Pérez", "Medicina Interna", "08:45"]
  ]
);

seedIfEmpty("tutor_posts",
  "INSERT INTO tutor_posts VALUES (?, ?, ?, ?, ?, ?)",
  [
    ["post-1", "Dra. Patricia Ruiz", "¿Alguien tiene experiencia evaluando estudiantes de intercambio internacional?", 12, 5, new Date(Date.now() - 7200000).toISOString()],
    ["post-2", "Dr. Miguel Torres", "Excelente webinar sobre evaluación por competencias. ¡Muy recomendado!", 8, 3, new Date(Date.now() - 14400000).toISOString()]
  ]
);

seedIfEmpty("student_posts",
  "INSERT INTO student_posts VALUES (?, ?, ?, ?, ?)",
  [
    ["spost-1", "María Rodríguez", "¿Alguien puede explicar la diferencia entre taquicardia sinusal y fibrilación auricular?", 12, new Date(Date.now() - 7200000).toISOString()],
    ["spost-2", "Juan Pérez", "Compartiendo mis apuntes de neuroanatomía. ¡Espero que os sirvan!", 28, new Date(Date.now() - 14400000).toISOString()]
  ]
);

module.exports = db;
