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
    status TEXT DEFAULT 'planificada',
    course_id TEXT,
    subject_id TEXT
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
    time TEXT NOT NULL,
    student_id TEXT
  );

  CREATE TABLE IF NOT EXISTS evaluations (
    id TEXT PRIMARY KEY,
    student_name TEXT NOT NULL,
    student_id TEXT,
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

  CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    year INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    course_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS study_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    creator_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS study_group_members (
    group_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    PRIMARY KEY (group_id, student_id)
  );

  CREATE TABLE IF NOT EXISTS tutor_videos (
    id TEXT PRIMARY KEY,
    tutor_id TEXT NOT NULL,
    tutor_name TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Migrations: add columns if not present (safe on existing DBs)
try { db.prepare("ALTER TABLE attendance_confirmed ADD COLUMN student_id TEXT").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rotations ADD COLUMN course_id TEXT").run(); } catch (_) {}
try { db.prepare("ALTER TABLE rotations ADD COLUMN subject_id TEXT").run(); } catch (_) {}
try { db.prepare("ALTER TABLE evaluations ADD COLUMN student_id TEXT").run(); } catch (_) {}

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

// Admin siempre existe con role = "admin"
const adminUser = db.prepare("SELECT id, role FROM users WHERE id = 'adm-1'").get();
if (!adminUser) {
  db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)").run(
    "adm-1", "admin@uji.es", "Admin Mediloop", "admin", ADMIN_HASH, now
  );
} else if (adminUser.role !== "admin") {
  db.prepare("UPDATE users SET role = 'admin', password_hash = ? WHERE id = 'adm-1'").run(ADMIN_HASH);
}

seedIfEmpty("rotations",
  "INSERT INTO rotations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  [
    ["rot-1", "Hospital General de Castellón", "Medicina Interna", "2026-03-01", "2026-04-15", "tut-1", "qr-rot-1-token", "en curso", "course-4", "subj-5"],
    ["rot-2", "Centro de Salud 9 de Octubre", "Atención Primaria", "2026-04-20", "2026-05-20", "tut-2", "qr-rot-2-token", "planificada", "course-6", "subj-10"]
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
  "INSERT INTO attendance_confirmed VALUES (?, ?, ?, ?, ?)",
  [
    ["att-3", "Ana Martínez", "Medicina Interna", "08:30", "stu-1"],
    ["att-4", "Carlos Pérez", "Medicina Interna", "08:45", "stu-2"]
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

seedIfEmpty("courses",
  "INSERT INTO courses VALUES (?, ?, ?, ?)",
  [
    ["course-2", "2º Medicina", 2, now],
    ["course-3", "3º Medicina", 3, now],
    ["course-4", "4º Medicina", 4, now],
    ["course-5", "5º Medicina", 5, now],
    ["course-6", "6º Medicina", 6, now]
  ]
);

seedIfEmpty("subjects",
  "INSERT INTO subjects VALUES (?, ?, ?, ?)",
  [
    ["subj-1", "Anatomía Clínica", "course-2", now],
    ["subj-2", "Fisiología", "course-2", now],
    ["subj-3", "Patología General", "course-3", now],
    ["subj-4", "Farmacología", "course-3", now],
    ["subj-5", "Medicina Interna", "course-4", now],
    ["subj-6", "Cirugía General", "course-4", now],
    ["subj-7", "Pediatría", "course-5", now],
    ["subj-8", "Ginecología y Obstetricia", "course-5", now],
    ["subj-9", "Rotación Hospitalaria Avanzada", "course-6", now],
    ["subj-10", "Atención Primaria", "course-6", now]
  ]
);

seedIfEmpty("study_groups",
  "INSERT INTO study_groups VALUES (?, ?, ?, ?, ?)",
  [
    ["grp-1", "Anatomía Cardiovascular", "Grupo de estudio para el examen de anatomía del sistema cardiovascular.", "stu-1", now],
    ["grp-2", "Farmacología Básica", "Repaso de conceptos fundamentales de farmacología.", "stu-2", now],
    ["grp-3", "Casos Clínicos", "Análisis y discusión de casos clínicos complejos.", "stu-1", now]
  ]
);

seedIfEmpty("study_group_members",
  "INSERT INTO study_group_members VALUES (?, ?)",
  [
    ["grp-1", "stu-1"],
    ["grp-2", "stu-2"]
  ]
);

seedIfEmpty("tutor_videos",
  "INSERT INTO tutor_videos VALUES (?, ?, ?, ?, ?, ?)",
  [
    ["vid-1", "tut-1", "Dra. María González", "Técnicas de Evaluación Efectiva", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", new Date(Date.now() - 86400000).toISOString()],
    ["vid-2", "tut-2", "Dr. Fernando Ruiz", "Feedback Constructivo en Medicina", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", new Date(Date.now() - 172800000).toISOString()]
  ]
);

seedIfEmpty("activity_log",
  "INSERT INTO activity_log VALUES (?, ?, ?, ?, ?, ?)",
  [
    ["act-seed-1", "stu-1", "Ana Martínez", "Asistencia confirmada", "Medicina Interna · Hospital General", new Date(Date.now() - 3600000).toISOString()],
    ["act-seed-2", "tut-1", "Dra. María González", "Evaluación creada", "Alumno: Carlos Pérez · Nota: 4.3/5", new Date(Date.now() - 7200000).toISOString()],
    ["act-seed-3", "stu-2", "Carlos Pérez", "Asistencia confirmada", "Medicina Interna · Hospital General", new Date(Date.now() - 10800000).toISOString()]
  ]
);

module.exports = db;
