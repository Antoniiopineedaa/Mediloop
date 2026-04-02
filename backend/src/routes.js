const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const db = require("./db");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "mediloop-secret-dev-2026";
const JWT_EXPIRES = "7d";

// ── Debug (temporal) ──────────────────────────────────────────────────────────
router.get("/debug/db", (req, res) => {
  try {
    const users = db.prepare("SELECT COUNT(*) as n FROM users").get();
    const sample = db.prepare("SELECT id, email, role FROM users LIMIT 4").all();
    res.json({ userCount: users.n, users: sample, nodeVersion: process.version });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Utilidades ────────────────────────────────────────────────────────────────
function newId(prefix) {
  return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
}

function timeAgo(isoString) {
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (diff < 60)    return "Ahora";
  if (diff < 3600)  return "Hace " + Math.floor(diff / 60) + " min";
  if (diff < 86400) return "Hace " + Math.floor(diff / 3600) + " h";
  return "Hace " + Math.floor(diff / 86400) + " días";
}

function createJWT(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ message: "No autorizado" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (_) {
    return res.status(401).json({ message: "Token inválido o expirado" });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) return res.status(403).json({ message: "Permisos insuficientes" });
    return next();
  };
}

// ── Health ────────────────────────────────────────────────────────────────────
router.get("/health", (_req, res) => res.json({ ok: true }));

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post("/auth/register", (req, res) => {
  const { email, name, password, role } = req.body || {};

  if (!email || !name || !password || !role) {
    return res.status(400).json({ message: "Faltan campos obligatorios" });
  }
  const emailLower = email.toLowerCase().trim();
  if (!emailLower.endsWith("@uji.es")) {
    return res.status(400).json({ message: "Solo se permiten correos @uji.es" });
  }
  if (!["student", "tutor"].includes(role)) {
    return res.status(400).json({ message: "Rol inválido" });
  }
  if (password.length < 6) {
    return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(emailLower);
  if (existing) return res.status(409).json({ message: "Ya existe una cuenta con ese correo" });

  const hash = bcrypt.hashSync(password, 10);
  const id = newId(role === "tutor" ? "tut" : "stu");
  db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)").run(
    id, emailLower, name.trim(), role, hash, new Date().toISOString()
  );
  const user = { id, email: emailLower, name: name.trim(), role };
  return res.status(201).json({ user, token: createJWT(user) });
});

router.post("/auth/login", (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: "Faltan campos obligatorios" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(email).toLowerCase().trim());
  if (!user) return res.status(401).json({ message: "Credenciales inválidas" });
  if (role && user.role !== role && user.role !== "admin") return res.status(401).json({ message: "Credenciales inválidas" });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ message: "Credenciales inválidas" });

  const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
  return res.json({ user: payload, token: createJWT(payload) });
});

router.get("/auth/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, email, name, role FROM users WHERE id = ?").get(req.user.sub);
  if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
  return res.json(user);
});

// ── Rotaciones ────────────────────────────────────────────────────────────────
router.get("/rotations", requireAuth, (req, res) => {
  if (req.user.role === "tutor") {
    const rows = db.prepare("SELECT * FROM rotations WHERE tutor_id = ? ORDER BY start_date ASC").all(req.user.sub);
    return res.json(rows);
  }
  // student: rotations they're enrolled in
  const rows = db.prepare(`
    SELECT r.* FROM rotations r
    JOIN rotation_students rs ON rs.rotation_id = r.id
    WHERE rs.student_id = ?
    ORDER BY r.start_date ASC
  `).all(req.user.sub);
  return res.json(rows);
});

router.post("/rotations", requireAuth, requireRole("tutor"), (req, res) => {
  const { hospital, service, startDate, endDate } = req.body || {};
  if (!hospital || !service || !startDate || !endDate) {
    return res.status(400).json({ message: "Faltan campos obligatorios" });
  }
  const id = newId("rot");
  const qr_token = newId("qr");
  db.prepare("INSERT INTO rotations VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, hospital, service, startDate, endDate, req.user.sub, qr_token, "planificada"
  );
  return res.status(201).json({ id, hospital, service, startDate, endDate, tutorId: req.user.sub, qrToken: qr_token, status: "planificada" });
});

router.get("/rotations/:id/students", requireAuth, requireRole("tutor"), (req, res) => {
  const rotation = db.prepare("SELECT * FROM rotations WHERE id = ? AND tutor_id = ?").get(req.params.id, req.user.sub);
  if (!rotation) return res.status(404).json({ message: "Rotación no encontrada" });
  const students = db.prepare(`
    SELECT u.id, u.name, u.email FROM users u
    JOIN rotation_students rs ON rs.student_id = u.id
    WHERE rs.rotation_id = ?
  `).all(req.params.id);
  return res.json(students);
});

router.post("/rotations/:id/enroll", requireAuth, requireRole("tutor"), (req, res) => {
  const { studentEmail } = req.body || {};
  if (!studentEmail) return res.status(400).json({ message: "Falta el correo del alumno" });
  const rotation = db.prepare("SELECT * FROM rotations WHERE id = ? AND tutor_id = ?").get(req.params.id, req.user.sub);
  if (!rotation) return res.status(404).json({ message: "Rotación no encontrada" });
  const student = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'student'").get(studentEmail.toLowerCase().trim());
  if (!student) return res.status(404).json({ message: "Alumno no encontrado" });
  const existing = db.prepare("SELECT 1 FROM rotation_students WHERE rotation_id = ? AND student_id = ?").get(req.params.id, student.id);
  if (existing) return res.status(409).json({ message: "El alumno ya está en esta rotación" });
  db.prepare("INSERT INTO rotation_students VALUES (?, ?)").run(req.params.id, student.id);
  return res.json({ ok: true, student: { id: student.id, name: student.name, email: student.email } });
});

router.delete("/rotations/:id/enroll/:studentId", requireAuth, requireRole("tutor"), (req, res) => {
  db.prepare("DELETE FROM rotation_students WHERE rotation_id = ? AND student_id = ?").run(req.params.id, req.params.studentId);
  return res.json({ ok: true });
});

// ── QR ────────────────────────────────────────────────────────────────────────
router.get("/qr-image/:token", requireAuth, async (req, res) => {
  const rotation = db.prepare("SELECT * FROM rotations WHERE qr_token = ?").get(req.params.token);
  if (!rotation) return res.status(404).json({ message: "Rotación no encontrada" });
  try {
    const buffer = await QRCode.toBuffer(req.params.token, { width: 280, margin: 2 });
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=3600");
    return res.send(buffer);
  } catch (_) {
    return res.status(500).json({ message: "Error generando QR" });
  }
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get("/dashboard/student", requireAuth, requireRole("student"), (req, res) => {
  const rotations = db.prepare(`
    SELECT r.* FROM rotations r
    JOIN rotation_students rs ON rs.rotation_id = r.id
    WHERE rs.student_id = ?
    ORDER BY r.start_date ASC
  `).all(req.user.sub);

  const now = new Date().toISOString().slice(0, 10);
  const active = rotations.find(r => r.start_date <= now && r.end_date >= now) || rotations[0] || null;
  const evalCount = db.prepare("SELECT COUNT(*) as n FROM evaluations WHERE student_name = (SELECT name FROM users WHERE id = ?)").get(req.user.sub).n;

  return res.json({
    progress: { completed: rotations.filter(r => r.end_date < now).length, total: rotations.length },
    nextRotation: active,
    rotations,
    pendingEvaluations: evalCount === 0 ? [{ id: "eval-1", type: "tutor->estudiante" }] : [],
    pendingSignatures: []
  });
});

router.get("/dashboard/tutor", requireAuth, requireRole("tutor"), (req, res) => {
  const evalCount = db.prepare("SELECT COUNT(*) as n FROM evaluations").get().n;
  const avgRow = evalCount > 0
    ? db.prepare("SELECT AVG((theory + practical + communication) / 3.0) as avg FROM evaluations").get()
    : { avg: 4.8 };
  const avg = Math.round((avgRow.avg || 4.8) * 10) / 10;

  const studentCount = db.prepare(`
    SELECT COUNT(DISTINCT rs.student_id) as n FROM rotation_students rs
    JOIN rotations r ON r.id = rs.rotation_id WHERE r.tutor_id = ?
  `).get(req.user.sub).n;

  return res.json({
    stats: {
      studentsEvaluated: evalCount || 0,
      averageScore: avg + "/5",
      averageTime: "15 min",
      globalRank: "#1"
    },
    kpis: { students: studentCount, avg, achievements: 12 }
  });
});

// ── Asistencia ────────────────────────────────────────────────────────────────
router.get("/attendance/pending", requireAuth, requireRole("tutor"), (req, res) => {
  const rows = db.prepare(`
    SELECT ap.* FROM attendance_pending ap
    LEFT JOIN rotation_students rs ON rs.student_id = ap.student_id
    LEFT JOIN rotations r ON r.id = rs.rotation_id AND r.tutor_id = ?
    WHERE r.tutor_id = ? OR ap.rotation_id IS NULL
    ORDER BY rowid ASC
  `).all(req.user.sub, req.user.sub);
  return res.json(rows.map(r => ({ id: r.id, name: r.student_name, area: r.area, scannedAt: r.scanned_at })));
});

router.get("/attendance/confirmed", requireAuth, requireRole("tutor"), (req, res) => {
  res.json(db.prepare("SELECT id, student_name as name, area, time FROM attendance_confirmed ORDER BY rowid DESC LIMIT 50").all());
});

router.post("/attendance/:id/confirm", requireAuth, requireRole("tutor"), (req, res) => {
  const row = db.prepare("SELECT * FROM attendance_pending WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ message: "Asistencia no encontrada" });
  const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  db.prepare("DELETE FROM attendance_pending WHERE id = ?").run(req.params.id);
  db.prepare("INSERT INTO attendance_confirmed VALUES (?, ?, ?, ?)").run(row.id, row.student_name, row.area, time);
  return res.json({ ok: true });
});

router.post("/attendance/:id/reject", requireAuth, requireRole("tutor"), (req, res) => {
  const row = db.prepare("SELECT id FROM attendance_pending WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ message: "Asistencia no encontrada" });
  db.prepare("DELETE FROM attendance_pending WHERE id = ?").run(req.params.id);
  return res.json({ ok: true });
});

router.post("/attendance/qr-checkin", requireAuth, requireRole("student"), (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub);
  if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

  const token = String(req.body?.token || "").trim();
  let area = String(req.body?.area || "Área desconocida").trim().slice(0, 80);
  let rotationId = null;

  if (token) {
    const rotation = db.prepare("SELECT * FROM rotations WHERE qr_token = ?").get(token);
    if (!rotation) return res.status(404).json({ message: "QR inválido o expirado" });
    area = rotation.service + " · " + rotation.hospital;
    rotationId = rotation.id;
  }

  const existing = db.prepare("SELECT id FROM attendance_pending WHERE student_id = ? AND rotation_id IS ? AND area = ?").get(user.id, rotationId, area);
  if (existing) return res.status(409).json({ message: "Ya tienes un registro de asistencia pendiente para esta área" });

  const id = newId("qr");
  db.prepare("INSERT INTO attendance_pending VALUES (?, ?, ?, ?, ?, ?)").run(
    id, user.id, user.name, rotationId, area, "Ahora mismo"
  );
  return res.status(201).json({ ok: true, id });
});

// Confirmar todos los pendientes de golpe
router.post("/attendance/confirm-all", requireAuth, requireRole("tutor"), (req, res) => {
  const pending = db.prepare("SELECT * FROM attendance_pending").all();
  const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const stmt = db.prepare("INSERT INTO attendance_confirmed VALUES (?, ?, ?, ?)");
  pending.forEach(row => {
    db.prepare("DELETE FROM attendance_pending WHERE id = ?").run(row.id);
    stmt.run(row.id, row.student_name, row.area, time);
  });
  return res.json({ ok: true, confirmed: pending.length });
});

// ── Evaluaciones ─────────────────────────────────────────────────────────────
router.post("/evaluations", requireAuth, requireRole("tutor"), (req, res) => {
  const { studentName, rotation, theory, practical, communication, comments } = req.body || {};
  if (!studentName || !rotation) return res.status(400).json({ message: "Faltan campos obligatorios" });
  const evaluation = {
    id:            newId("eval"),
    student_name:  studentName,
    rotation,
    theory:        Number(theory || 0),
    practical:     Number(practical || 0),
    communication: Number(communication || 0),
    comments:      comments || "",
    created_at:    new Date().toISOString()
  };
  db.prepare("INSERT INTO evaluations VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    evaluation.id, evaluation.student_name, evaluation.rotation,
    evaluation.theory, evaluation.practical, evaluation.communication,
    evaluation.comments, evaluation.created_at
  );
  return res.status(201).json({ ...evaluation, total: Math.round((evaluation.theory + evaluation.practical + evaluation.communication) / 3 * 10) / 10 });
});

router.get("/evaluations", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM evaluations ORDER BY created_at DESC").all();
  const mapped = rows.map(r => ({
    id: r.id, studentName: r.student_name, rotation: r.rotation,
    theory: r.theory, practical: r.practical, communication: r.communication,
    comments: r.comments, createdAt: r.created_at,
    total: Math.round((r.theory + r.practical + r.communication) / 3 * 10) / 10
  }));
  if (req.user.role === "tutor") return res.json(mapped);
  const user = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.sub);
  const firstName = user ? user.name.split(" ")[0].toLowerCase() : "";
  return res.json(mapped.filter(e => e.studentName.toLowerCase().includes(firstName)));
});

// ── Alumnos (para tutores) ────────────────────────────────────────────────────
router.get("/users/students", requireAuth, requireRole("tutor"), (_req, res) => {
  const students = db.prepare("SELECT id, name, email FROM users WHERE role = 'student' ORDER BY name ASC").all();
  return res.json(students);
});

// ── Comunidad Tutores ─────────────────────────────────────────────────────────
router.get("/community/tutor-posts", requireAuth, requireRole("tutor"), (_req, res) => {
  const rows = db.prepare("SELECT * FROM tutor_posts ORDER BY created_at DESC LIMIT 20").all();
  res.json(rows.map(r => ({ id: r.id, author: r.author, text: r.text, likes: r.likes, comments: r.comments, ago: timeAgo(r.created_at) })));
});

router.post("/community/tutor-posts", requireAuth, requireRole("tutor"), (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ message: "Texto requerido" });
  const user = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.sub);
  const post = { id: newId("tpost"), author: user ? user.name : "Tutor", text, likes: 0, comments: 0, created_at: new Date().toISOString() };
  db.prepare("INSERT INTO tutor_posts VALUES (?, ?, ?, ?, ?, ?)").run(post.id, post.author, post.text, post.likes, post.comments, post.created_at);
  return res.status(201).json({ ...post, ago: "Ahora" });
});

router.post("/community/tutor-posts/:id/like", requireAuth, (req, res) => {
  const row = db.prepare("SELECT id FROM tutor_posts WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ message: "Post no encontrado" });
  db.prepare("UPDATE tutor_posts SET likes = likes + 1 WHERE id = ?").run(req.params.id);
  return res.json({ likes: db.prepare("SELECT likes FROM tutor_posts WHERE id = ?").get(req.params.id).likes });
});

// ── Comunidad Alumnos ─────────────────────────────────────────────────────────
router.get("/community/student-posts", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM student_posts ORDER BY created_at DESC LIMIT 20").all();
  res.json(rows.map(r => ({ id: r.id, author: r.author, text: r.text, likes: r.likes, ago: timeAgo(r.created_at) })));
});

router.post("/community/student-posts", requireAuth, requireRole("student"), (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ message: "Texto requerido" });
  const user = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.sub);
  const post = { id: newId("spost"), author: user ? user.name : "Alumno", text, likes: 0, created_at: new Date().toISOString() };
  db.prepare("INSERT INTO student_posts VALUES (?, ?, ?, ?, ?)").run(post.id, post.author, post.text, post.likes, post.created_at);
  return res.status(201).json({ ...post, ago: "Ahora" });
});

router.post("/community/student-posts/:id/like", requireAuth, (req, res) => {
  const row = db.prepare("SELECT id FROM student_posts WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ message: "Post no encontrado" });
  db.prepare("UPDATE student_posts SET likes = likes + 1 WHERE id = ?").run(req.params.id);
  return res.json({ likes: db.prepare("SELECT likes FROM student_posts WHERE id = ?").get(req.params.id).likes });
});

module.exports = router;
