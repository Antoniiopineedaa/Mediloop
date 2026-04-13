const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");
const crypto = require("crypto");
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

function logActivity(userId, userName, action, details) {
  try {
    db.prepare("INSERT INTO activity_log VALUES (?, ?, ?, ?, ?, ?)").run(
      newId("act"), userId || null, userName || "Sistema", action, details || null, new Date().toISOString()
    );
  } catch (_) {}
}

function timeAgo(isoString) {
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (diff < 60)    return "Ahora";
  if (diff < 3600)  return "Hace " + Math.floor(diff / 60) + " min";
  if (diff < 86400) return "Hace " + Math.floor(diff / 3600) + " h";
  return "Hace " + Math.floor(diff / 86400) + " días";
}

// Genera token QR válido 12 horas. periodOffset=-1 = período anterior (aceptado como válido)
function makeQrToken(rotationId, tutorId, periodOffset) {
  var period = Math.floor(Date.now() / 43200000) + (periodOffset || 0);
  return crypto.createHash("sha256").update(rotationId + ":" + tutorId + ":" + period).digest("hex").slice(0, 32);
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

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ message: "Acceso restringido" });
  return next();
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
  logActivity(id, name.trim(), "Nuevo usuario registrado", "Rol: " + role + " · Email: " + emailLower);
  return res.status(201).json({ user, token: createJWT(user) });
});

router.post("/auth/login", (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: "Faltan campos obligatorios" });

  const emailLower = String(email).toLowerCase().trim();
  if (!emailLower.endsWith("@uji.es")) {
    return res.status(400).json({ message: "Solo se permiten correos @uji.es" });
  }

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(emailLower);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ message: "Credenciales inválidas" });
  }

  const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
  return res.json({ user: payload, token: createJWT(payload) });
});

router.get("/auth/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT id, email, name, role FROM users WHERE id = ?").get(req.user.sub);
  if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
  return res.json(user);
});

router.put("/auth/profile", requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ message: "El nombre es obligatorio" });
  db.prepare("UPDATE users SET name = ? WHERE id = ?").run(String(name).trim(), req.user.sub);
  const user = db.prepare("SELECT id, email, name, role FROM users WHERE id = ?").get(req.user.sub);
  return res.json(user);
});

router.put("/auth/password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ message: "Faltan campos" });
  if (newPassword.length < 6) return res.status(400).json({ message: "La nueva contraseña debe tener al menos 6 caracteres" });
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ message: "Contraseña actual incorrecta" });
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(newPassword, 10), req.user.sub);
  return res.json({ ok: true });
});

// ── Admin ─────────────────────────────────────────────────────────────────────

router.get("/admin/users", requireAuth, requireAdmin, (_req, res) => {
  const users = db.prepare("SELECT id, email, name, role, created_at FROM users WHERE role != 'admin' ORDER BY created_at DESC").all();
  return res.json(users);
});

router.delete("/admin/users/:id", requireAuth, requireAdmin, (req, res) => {
  const user = db.prepare("SELECT id, role FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
  if (user.role === "admin") return res.status(403).json({ message: "No se puede eliminar al administrador" });
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  db.prepare("DELETE FROM rotation_students WHERE student_id = ?").run(req.params.id);
  return res.json({ ok: true });
});

// ── Admin rotaciones ──────────────────────────────────────────────────────────
router.get("/admin/rotations", requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.name as tutor_name
    FROM rotations r
    LEFT JOIN users u ON u.id = r.tutor_id
    ORDER BY r.start_date DESC
  `).all();
  return res.json(rows);
});

router.post("/admin/rotations", requireAuth, requireAdmin, (req, res) => {
  const { hospital, service, startDate, endDate, tutorId } = req.body || {};
  if (!hospital || !service || !startDate || !endDate) {
    return res.status(400).json({ message: "Faltan campos: hospital, service, startDate, endDate" });
  }
  if (tutorId) {
    const tutor = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'tutor'").get(tutorId);
    if (!tutor) return res.status(404).json({ message: "Tutor no encontrado" });
  }
  const id = newId("rot");
  const qr_token = newId("qr");
  db.prepare("INSERT INTO rotations VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    id, hospital, service, startDate, endDate, tutorId || null, qr_token, "planificada"
  );
  return res.status(201).json({ ok: true, id });
});

router.delete("/admin/rotations/:id", requireAuth, requireAdmin, (req, res) => {
  const rotation = db.prepare("SELECT id FROM rotations WHERE id = ?").get(req.params.id);
  if (!rotation) return res.status(404).json({ message: "Rotación no encontrada" });
  db.prepare("DELETE FROM rotation_students WHERE rotation_id = ?").run(req.params.id);
  db.prepare("DELETE FROM rotations WHERE id = ?").run(req.params.id);
  return res.json({ ok: true });
});

// ── Rotaciones ────────────────────────────────────────────────────────────────
router.get("/rotations", requireAuth, (req, res) => {
  if (req.user.role === "tutor") {
    const rows = db.prepare("SELECT * FROM rotations WHERE tutor_id = ? ORDER BY start_date ASC").all(req.user.sub);
    return res.json(rows);
  }
  // student: rotations they're enrolled in (include tutor name/email)
  const rows = db.prepare(`
    SELECT r.*, u.name as tutor_name, u.email as tutor_email
    FROM rotations r
    JOIN rotation_students rs ON rs.rotation_id = r.id
    LEFT JOIN users u ON u.id = r.tutor_id
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

// Token QR rotatorio (12h) — solo el tutor dueño de la rotación
router.get("/tutor/rotations/:id/qr", requireAuth, requireRole("tutor"), (req, res) => {
  const rotation = db.prepare("SELECT * FROM rotations WHERE id = ? AND tutor_id = ?").get(req.params.id, req.user.sub);
  if (!rotation) return res.status(404).json({ message: "Rotación no encontrada" });

  const token = makeQrToken(rotation.id, rotation.tutor_id);
  const period = Math.floor(Date.now() / 43200000);
  const expiresAt = new Date((period + 1) * 43200000).toISOString();
  const msLeft = (period + 1) * 43200000 - Date.now();

  return res.json({ token, expiresAt, msLeft, rotationId: rotation.id, service: rotation.service, hospital: rotation.hospital });
});

// ── QR ────────────────────────────────────────────────────────────────────────
router.get("/qr-image/:token", async (req, res) => {
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
    pendingEvaluations: [],
    pendingSignatures: []
  });
});

router.get("/dashboard/tutor", requireAuth, requireRole("tutor"), (req, res) => {
  const myEvalCount = db.prepare("SELECT COUNT(*) as n FROM evaluations WHERE student_id IN (SELECT student_id FROM rotation_students rs JOIN rotations r ON r.id = rs.rotation_id WHERE r.tutor_id = ?) OR student_id IS NULL").get(req.user.sub).n;
  const totalEvalCount = db.prepare("SELECT COUNT(*) as n FROM evaluations").get().n;
  const avgRow = myEvalCount > 0
    ? db.prepare("SELECT AVG((theory + practical + communication) / 3.0) as avg FROM evaluations WHERE student_id IN (SELECT student_id FROM rotation_students rs JOIN rotations r ON r.id = rs.rotation_id WHERE r.tutor_id = ?)").get(req.user.sub)
    : null;
  const avg = avgRow && avgRow.avg != null ? Math.round(avgRow.avg * 10) / 10 : 0;

  const studentCount = db.prepare(`
    SELECT COUNT(DISTINCT rs.student_id) as n FROM rotation_students rs
    JOIN rotations r ON r.id = rs.rotation_id WHERE r.tutor_id = ?
  `).get(req.user.sub).n;

  // Calcular ranking real: posición del tutor por promedio de notas entre todos los tutores
  const allTutors = db.prepare(`
    SELECT r.tutor_id, AVG((e.theory + e.practical + e.communication) / 3.0) as avg
    FROM evaluations e
    JOIN rotation_students rs ON rs.student_id = e.student_id
    JOIN rotations r ON r.id = rs.rotation_id
    WHERE r.tutor_id IS NOT NULL
    GROUP BY r.tutor_id
    ORDER BY avg DESC
  `).all();
  let rank = 1;
  for (var i = 0; i < allTutors.length; i++) {
    if (allTutors[i].tutor_id === req.user.sub) { rank = i + 1; break; }
  }
  const totalTutors = db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'tutor'").get().n;
  const rankStr = allTutors.length > 0 ? "#" + rank + " de " + totalTutors : "Sin datos";

  return res.json({
    stats: {
      studentsEvaluated: myEvalCount || 0,
      averageScore: avg > 0 ? avg + "/5" : "—",
      globalRank: rankStr
    },
    kpis: { students: studentCount, avg, achievements: myEvalCount }
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
  db.prepare("INSERT INTO attendance_confirmed VALUES (?, ?, ?, ?, ?)").run(row.id, row.student_name, row.area, time, row.student_id);
  const tutor = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.sub);
  logActivity(row.student_id, row.student_name, "Asistencia confirmada", row.area + " · Confirmada por " + (tutor ? tutor.name : "Tutor"));
  return res.json({ ok: true });
});

router.post("/attendance/:id/reject", requireAuth, requireRole("tutor"), (req, res) => {
  const row = db.prepare("SELECT * FROM attendance_pending WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ message: "Asistencia no encontrada" });
  db.prepare("DELETE FROM attendance_pending WHERE id = ?").run(req.params.id);
  const tutor = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.sub);
  logActivity(row.student_id, row.student_name, "Asistencia rechazada", row.area + " · Rechazada por " + (tutor ? tutor.name : "Tutor"));
  return res.json({ ok: true });
});

router.get("/attendance/my", requireAuth, requireRole("student"), (req, res) => {
  const pending = db.prepare("SELECT id, area, scanned_at FROM attendance_pending WHERE student_id = ? ORDER BY rowid DESC").all(req.user.sub);
  const confirmed = db.prepare("SELECT id, area, time FROM attendance_confirmed WHERE student_id = ? ORDER BY rowid DESC LIMIT 20").all(req.user.sub);
  return res.json({ pending, confirmed });
});

router.post("/attendance/qr-checkin", requireAuth, requireRole("student"), (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub);
  if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

  const token = String(req.body?.token || "").trim();
  let area = String(req.body?.area || "Área desconocida").trim().slice(0, 80);
  let rotationId = null;

  if (token) {
    // 1. Intenta con el token estático (compatibilidad hacia atrás)
    let rotation = db.prepare("SELECT * FROM rotations WHERE qr_token = ?").get(token);

    // 2. Si no coincide, valida con el token rotatorio de 12h
    if (!rotation) {
      const enrolled = db.prepare(`
        SELECT r.* FROM rotations r
        JOIN rotation_students rs ON rs.rotation_id = r.id
        WHERE rs.student_id = ?
      `).all(user.id);

      for (var i = 0; i < enrolled.length; i++) {
        var rot = enrolled[i];
        if (token === makeQrToken(rot.id, rot.tutor_id) || token === makeQrToken(rot.id, rot.tutor_id, -1)) {
          rotation = rot;
          break;
        }
      }
    }

    if (!rotation) return res.status(401).json({ message: "QR inválido o expirado" });
    area = rotation.service + " · " + rotation.hospital;
    rotationId = rotation.id;
  }

  const existing = db.prepare("SELECT id FROM attendance_pending WHERE student_id = ? AND rotation_id IS ? AND area = ?").get(user.id, rotationId, area);
  if (existing) return res.status(409).json({ message: "Ya tienes un registro de asistencia pendiente para esta área" });

  const id = newId("qr");
  db.prepare("INSERT INTO attendance_pending VALUES (?, ?, ?, ?, ?, ?)").run(
    id, user.id, user.name, rotationId, area, new Date().toISOString()
  );
  return res.status(201).json({ ok: true, id });
});

// Simulación de check-in (sin necesidad de escanear QR físico — solo demo)
router.post("/attendance/simulate", requireAuth, requireRole("student"), (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.sub);
  if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

  const rotationId = String(req.body?.rotationId || "").trim();
  if (!rotationId) return res.status(400).json({ message: "Falta rotationId" });

  const rotation = db.prepare(`
    SELECT r.* FROM rotations r
    JOIN rotation_students rs ON rs.rotation_id = r.id
    WHERE r.id = ? AND rs.student_id = ?
  `).get(rotationId, user.id);
  if (!rotation) return res.status(403).json({ message: "No estás inscrito en esta rotación" });

  const area = rotation.service + " · " + rotation.hospital;
  const existing = db.prepare("SELECT id FROM attendance_pending WHERE student_id = ? AND rotation_id = ?").get(user.id, rotationId);
  if (existing) return res.status(409).json({ message: "Ya tienes una asistencia pendiente para esta rotación" });

  const id = newId("qr");
  db.prepare("INSERT INTO attendance_pending VALUES (?, ?, ?, ?, ?, ?)").run(
    id, user.id, user.name, rotationId, area, new Date().toISOString()
  );
  return res.status(201).json({ ok: true, id, area });
});

// Confirmar todos los pendientes de golpe (solo los del tutor autenticado)
router.post("/attendance/confirm-all", requireAuth, requireRole("tutor"), (req, res) => {
  const pending = db.prepare(`
    SELECT ap.* FROM attendance_pending ap
    LEFT JOIN rotation_students rs ON rs.student_id = ap.student_id
    LEFT JOIN rotations r ON r.id = rs.rotation_id AND r.tutor_id = ?
    WHERE r.tutor_id = ? OR ap.rotation_id IS NULL
  `).all(req.user.sub, req.user.sub);
  const time = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const stmt = db.prepare("INSERT INTO attendance_confirmed VALUES (?, ?, ?, ?, ?)");
  pending.forEach(row => {
    db.prepare("DELETE FROM attendance_pending WHERE id = ?").run(row.id);
    stmt.run(row.id, row.student_name, row.area, time, row.student_id);
  });
  return res.json({ ok: true, confirmed: pending.length });
});

// ── Evaluaciones ─────────────────────────────────────────────────────────────
router.post("/evaluations", requireAuth, requireRole("tutor"), (req, res) => {
  const { studentName, studentId, rotation, theory, practical, communication, comments } = req.body || {};
  if (!studentName || !rotation) return res.status(400).json({ message: "Faltan campos obligatorios" });
  const evaluation = {
    id:            newId("eval"),
    student_name:  studentName,
    student_id:    studentId || null,
    rotation,
    theory:        Number(theory || 0),
    practical:     Number(practical || 0),
    communication: Number(communication || 0),
    comments:      comments || "",
    created_at:    new Date().toISOString()
  };
  db.prepare("INSERT INTO evaluations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    evaluation.id, evaluation.student_name, evaluation.student_id, evaluation.rotation,
    evaluation.theory, evaluation.practical, evaluation.communication,
    evaluation.comments, evaluation.created_at
  );
  const total = Math.round((evaluation.theory + evaluation.practical + evaluation.communication) / 3 * 10) / 10;
  const tutorName = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.sub);
  logActivity(req.user.sub, tutorName ? tutorName.name : "Tutor", "Evaluación creada",
    "Alumno: " + evaluation.student_name + " · Nota: " + total + "/5 · Rotación: " + evaluation.rotation);
  return res.status(201).json({ ...evaluation, total });
});

router.get("/evaluations", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM evaluations ORDER BY created_at DESC").all();
  const mapped = rows.map(r => ({
    id: r.id, studentName: r.student_name, studentId: r.student_id, rotation: r.rotation,
    theory: r.theory, practical: r.practical, communication: r.communication,
    comments: r.comments, createdAt: r.created_at,
    total: Math.round((r.theory + r.practical + r.communication) / 3 * 10) / 10
  }));
  if (req.user.role === "tutor") return res.json(mapped);
  // Para alumnos: filtrar por student_id si existe, si no por nombre (retrocompat)
  const user = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.sub);
  const name = user ? user.name.toLowerCase() : "";
  return res.json(mapped.filter(e =>
    (e.studentId && e.studentId === req.user.sub) ||
    (!e.studentId && e.studentName.toLowerCase() === name)
  ));
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

// ── Admin: Cursos ─────────────────────────────────────────────────────────────
router.get("/admin/courses", requireAuth, requireAdmin, (_req, res) => {
  const courses = db.prepare(`
    SELECT c.*, COUNT(s.id) as subject_count
    FROM courses c LEFT JOIN subjects s ON s.course_id = c.id
    GROUP BY c.id ORDER BY c.year ASC
  `).all();
  return res.json(courses);
});

router.post("/admin/courses", requireAuth, requireAdmin, (req, res) => {
  const { name, year } = req.body || {};
  if (!name || !year) return res.status(400).json({ message: "Faltan campos: name, year" });
  const y = parseInt(year);
  if (y < 2 || y > 6) return res.status(400).json({ message: "El año debe ser entre 2 y 6" });
  const existing = db.prepare("SELECT id FROM courses WHERE year = ?").get(y);
  if (existing) return res.status(409).json({ message: "Ya existe un curso para ese año" });
  const id = newId("course");
  db.prepare("INSERT INTO courses VALUES (?, ?, ?, ?)").run(id, String(name).trim(), y, new Date().toISOString());
  return res.status(201).json({ ok: true, id });
});

router.delete("/admin/courses/:id", requireAuth, requireAdmin, (req, res) => {
  const course = db.prepare("SELECT id FROM courses WHERE id = ?").get(req.params.id);
  if (!course) return res.status(404).json({ message: "Curso no encontrado" });
  db.prepare("DELETE FROM subjects WHERE course_id = ?").run(req.params.id);
  db.prepare("DELETE FROM courses WHERE id = ?").run(req.params.id);
  return res.json({ ok: true });
});

// ── Admin: Asignaturas ────────────────────────────────────────────────────────
router.get("/admin/subjects", requireAuth, requireAdmin, (req, res) => {
  const courseId = req.query.courseId;
  let rows;
  if (courseId) {
    rows = db.prepare(`
      SELECT s.*, c.name as course_name, c.year as course_year
      FROM subjects s JOIN courses c ON c.id = s.course_id
      WHERE s.course_id = ? ORDER BY s.name ASC
    `).all(courseId);
  } else {
    rows = db.prepare(`
      SELECT s.*, c.name as course_name, c.year as course_year
      FROM subjects s JOIN courses c ON c.id = s.course_id
      ORDER BY c.year ASC, s.name ASC
    `).all();
  }
  return res.json(rows);
});

router.post("/admin/subjects", requireAuth, requireAdmin, (req, res) => {
  const { name, courseId } = req.body || {};
  if (!name || !courseId) return res.status(400).json({ message: "Faltan campos: name, courseId" });
  const course = db.prepare("SELECT id FROM courses WHERE id = ?").get(courseId);
  if (!course) return res.status(404).json({ message: "Curso no encontrado" });
  const id = newId("subj");
  db.prepare("INSERT INTO subjects VALUES (?, ?, ?, ?)").run(id, String(name).trim(), courseId, new Date().toISOString());
  return res.status(201).json({ ok: true, id });
});

router.delete("/admin/subjects/:id", requireAuth, requireAdmin, (req, res) => {
  const subj = db.prepare("SELECT id FROM subjects WHERE id = ?").get(req.params.id);
  if (!subj) return res.status(404).json({ message: "Asignatura no encontrada" });
  db.prepare("DELETE FROM subjects WHERE id = ?").run(req.params.id);
  return res.json({ ok: true });
});

// ── Admin: Alumnos de una rotación ───────────────────────────────────────────
router.get("/admin/rotations/:id/students", requireAuth, requireAdmin, (req, res) => {
  const rotation = db.prepare("SELECT id FROM rotations WHERE id = ?").get(req.params.id);
  if (!rotation) return res.status(404).json({ message: "Rotación no encontrada" });
  const students = db.prepare(`
    SELECT u.id, u.name, u.email FROM users u
    JOIN rotation_students rs ON rs.student_id = u.id
    WHERE rs.rotation_id = ?
    ORDER BY u.name ASC
  `).all(req.params.id);
  return res.json(students);
});

router.post("/admin/rotations/:id/students", requireAuth, requireAdmin, (req, res) => {
  const { studentEmail } = req.body || {};
  if (!studentEmail) return res.status(400).json({ message: "Falta el correo del alumno" });
  const rotation = db.prepare("SELECT id FROM rotations WHERE id = ?").get(req.params.id);
  if (!rotation) return res.status(404).json({ message: "Rotación no encontrada" });
  const student = db.prepare("SELECT * FROM users WHERE email = ? AND role = 'student'").get(String(studentEmail).toLowerCase().trim());
  if (!student) return res.status(404).json({ message: "Alumno no encontrado" });
  const existing = db.prepare("SELECT 1 FROM rotation_students WHERE rotation_id = ? AND student_id = ?").get(req.params.id, student.id);
  if (existing) return res.status(409).json({ message: "El alumno ya está en esta rotación" });
  db.prepare("INSERT INTO rotation_students VALUES (?, ?)").run(req.params.id, student.id);
  return res.status(201).json({ ok: true, student: { id: student.id, name: student.name, email: student.email } });
});

router.delete("/admin/rotations/:id/students/:studentId", requireAuth, requireAdmin, (req, res) => {
  db.prepare("DELETE FROM rotation_students WHERE rotation_id = ? AND student_id = ?").run(req.params.id, req.params.studentId);
  return res.json({ ok: true });
});

// ── Admin: Actividad en tiempo real ──────────────────────────────────────────
router.get("/admin/activity", requireAuth, requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 60").all();
  return res.json(rows);
});

// ── Admin: Alertas automáticas ────────────────────────────────────────────────
router.get("/admin/alerts", requireAuth, requireAdmin, (_req, res) => {
  const alerts = [];
  const today = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();

  // 1. Rotaciones activas sin tutor
  const noTutor = db.prepare(`
    SELECT id, service, hospital FROM rotations
    WHERE tutor_id IS NULL AND start_date <= ? AND end_date >= ?
  `).all(today, today);
  noTutor.forEach(function(r) {
    alerts.push({ id: "no-tutor-" + r.id, severity: "critical", icon: "🔴",
      title: "Rotación activa sin tutor", message: "\"" + r.service + "\" en " + r.hospital + " no tiene tutor asignado.", tab: "rotaciones" });
  });

  // 2. Asistencias pendientes > 24h sin revisar
  const oldPending = db.prepare("SELECT *, student_name FROM attendance_pending ORDER BY scanned_at ASC").all();
  oldPending.forEach(function(ap) {
    const h = (nowMs - new Date(ap.scanned_at).getTime()) / 3600000;
    if (h > 24) {
      alerts.push({ id: "pending-old-" + ap.id, severity: "warning", icon: "⏳",
        title: "Asistencia sin confirmar +" + Math.floor(h) + "h", message: ap.student_name + " lleva " + Math.floor(h) + "h esperando confirmación en " + ap.area + ".", tab: "actividad" });
    }
  });

  // 3. Alumnos con nota media baja (< 2/5)
  const lowGrade = db.prepare(`
    SELECT student_name, ROUND(AVG((theory + practical + communication) / 3.0), 1) as avg_grade, COUNT(*) as cnt
    FROM evaluations GROUP BY student_name HAVING avg_grade < 2 AND cnt >= 1
  `).all();
  lowGrade.forEach(function(e) {
    alerts.push({ id: "low-grade-" + e.student_name.replace(/\s+/g, "-"), severity: "critical", icon: "📉",
      title: "Rendimiento bajo detectado", message: e.student_name + " tiene una nota media de " + e.avg_grade + "/5 en " + e.cnt + " evaluación(es).", tab: "usuarios" });
  });

  // 4. Alumnos en rotación activa sin ninguna asistencia registrada
  const activeRots = db.prepare("SELECT id, service, hospital FROM rotations WHERE start_date <= ? AND end_date >= ?").all(today, today);
  activeRots.forEach(function(rot) {
    const students = db.prepare(`
      SELECT u.id, u.name FROM users u
      JOIN rotation_students rs ON rs.student_id = u.id WHERE rs.rotation_id = ?
    `).all(rot.id);
    students.forEach(function(stu) {
      const hasPending  = db.prepare("SELECT 1 FROM attendance_pending WHERE student_id = ?").get(stu.id);
      const hasConfirmed = db.prepare("SELECT 1 FROM attendance_confirmed WHERE student_id = ?").get(stu.id);
      if (!hasPending && !hasConfirmed) {
        alerts.push({ id: "no-att-" + stu.id, severity: "warning", icon: "📍",
          title: "Sin asistencia registrada", message: stu.name + " no tiene ninguna asistencia en \"" + rot.service + "\".", tab: "usuarios" });
      }
    });
  });

  return res.json(alerts);
});

// ── Admin: Stats enriquecidas ─────────────────────────────────────────────────
router.get("/admin/stats", requireAuth, requireAdmin, (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  return res.json({
    users:       db.prepare("SELECT COUNT(*) as n FROM users WHERE role != 'admin'").get().n,
    students:    db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'student'").get().n,
    tutors:      db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'tutor'").get().n,
    rotations:   db.prepare("SELECT COUNT(*) as n FROM rotations").get().n,
    evals:       db.prepare("SELECT COUNT(*) as n FROM evaluations").get().n,
    attendance:  db.prepare("SELECT COUNT(*) as n FROM attendance_confirmed").get().n,
    pending:     db.prepare("SELECT COUNT(*) as n FROM attendance_pending").get().n,
    activeRots:  db.prepare("SELECT COUNT(*) as n FROM rotations WHERE start_date <= ? AND end_date >= ?").get(today, today).n,
    subjects:    db.prepare("SELECT COUNT(*) as n FROM subjects").get().n,
    courses:     db.prepare("SELECT COUNT(*) as n FROM courses").get().n
  });
});

// ── Grupos de estudio ─────────────────────────────────────────────────────────
router.get("/study-groups", requireAuth, (req, res) => {
  const groups = db.prepare(`
    SELECT sg.*, COUNT(sgm.student_id) as member_count
    FROM study_groups sg
    LEFT JOIN study_group_members sgm ON sgm.group_id = sg.id
    GROUP BY sg.id ORDER BY sg.created_at DESC
  `).all();
  const myGroups = db.prepare("SELECT group_id FROM study_group_members WHERE student_id = ?").all(req.user.sub).map(r => r.group_id);
  return res.json(groups.map(g => ({ ...g, isMember: myGroups.includes(g.id) })));
});

router.post("/study-groups", requireAuth, requireRole("student"), (req, res) => {
  const { name, description } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ message: "El nombre es obligatorio" });
  const id = newId("grp");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO study_groups VALUES (?, ?, ?, ?, ?)").run(id, String(name).trim(), String(description || "").trim(), req.user.sub, now);
  db.prepare("INSERT INTO study_group_members VALUES (?, ?)").run(id, req.user.sub);
  return res.status(201).json({ ok: true, id });
});

router.post("/study-groups/:id/join", requireAuth, requireRole("student"), (req, res) => {
  const group = db.prepare("SELECT id FROM study_groups WHERE id = ?").get(req.params.id);
  if (!group) return res.status(404).json({ message: "Grupo no encontrado" });
  const existing = db.prepare("SELECT 1 FROM study_group_members WHERE group_id = ? AND student_id = ?").get(req.params.id, req.user.sub);
  if (existing) return res.status(409).json({ message: "Ya eres miembro de este grupo" });
  db.prepare("INSERT INTO study_group_members VALUES (?, ?)").run(req.params.id, req.user.sub);
  return res.json({ ok: true });
});

router.delete("/study-groups/:id/leave", requireAuth, requireRole("student"), (req, res) => {
  db.prepare("DELETE FROM study_group_members WHERE group_id = ? AND student_id = ?").run(req.params.id, req.user.sub);
  return res.json({ ok: true });
});

// ── Vídeos de tutores ─────────────────────────────────────────────────────────
router.get("/community/tutor-videos", requireAuth, (_req, res) => {
  const rows = db.prepare("SELECT * FROM tutor_videos ORDER BY created_at DESC LIMIT 20").all();
  return res.json(rows.map(r => ({ id: r.id, tutorName: r.tutor_name, title: r.title, url: r.url, ago: timeAgo(r.created_at) })));
});

router.post("/community/tutor-videos", requireAuth, requireRole("tutor"), (req, res) => {
  const { title, url } = req.body || {};
  if (!title || !url) return res.status(400).json({ message: "Faltan título y URL" });
  const urlStr = String(url).trim();
  if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
    return res.status(400).json({ message: "La URL debe comenzar por http:// o https://" });
  }
  const tutor = db.prepare("SELECT name FROM users WHERE id = ?").get(req.user.sub);
  const id = newId("vid");
  db.prepare("INSERT INTO tutor_videos VALUES (?, ?, ?, ?, ?, ?)").run(
    id, req.user.sub, tutor ? tutor.name : "Tutor", String(title).trim(), urlStr, new Date().toISOString()
  );
  return res.status(201).json({ ok: true, id });
});

// ── Racha del tutor ───────────────────────────────────────────────────────────
router.get("/tutor/streak", requireAuth, requireRole("tutor"), (req, res) => {
  // Días únicos con al menos una evaluación creada por este tutor
  // Las evaluaciones no tienen tutor_id directo, usamos rotation_students
  const evalDays = db.prepare(`
    SELECT DISTINCT substr(e.created_at, 1, 10) as day
    FROM evaluations e
    JOIN rotation_students rs ON rs.student_id = e.student_id
    JOIN rotations r ON r.id = rs.rotation_id
    WHERE r.tutor_id = ?
    ORDER BY day DESC
  `).all(req.user.sub).map(r => r.day);

  // También días con asistencias confirmadas del tutor
  const attDays = db.prepare(`
    SELECT DISTINCT substr(ac.time, 1, 10) as day
    FROM attendance_confirmed ac
    JOIN rotation_students rs ON rs.student_id = ac.student_id
    JOIN rotations r ON r.id = rs.rotation_id
    WHERE r.tutor_id = ?
    ORDER BY day DESC
  `).all(req.user.sub).map(r => r.day);

  // Unir y ordenar días únicos
  var allDays = [...new Set([...evalDays])].sort().reverse();

  var streak = 0;
  var today = new Date().toISOString().slice(0, 10);
  var check = today;
  for (var i = 0; i < allDays.length; i++) {
    if (allDays[i] === check) {
      streak++;
      var d = new Date(check);
      d.setDate(d.getDate() - 1);
      check = d.toISOString().slice(0, 10);
    } else if (allDays[i] < check) {
      break;
    }
  }

  return res.json({ streak, totalActiveDays: allDays.length, lastActivity: allDays[0] || null });
});

// ── Auth: Recuperación de contraseña ─────────────────────────────────────────
router.post("/auth/forgot-password", (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ message: "Falta el correo electrónico" });
  const emailLower = String(email).toLowerCase().trim();
  const user = db.prepare("SELECT id, name FROM users WHERE email = ?").get(emailLower);
  // No revelar si el correo existe
  if (!user) return res.json({ ok: true });
  // Eliminar tokens anteriores caducados o del mismo usuario
  db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at < ?").run(user.id, new Date().toISOString());
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hora
  db.prepare("INSERT INTO password_reset_tokens VALUES (?, ?, ?, ?, 0)").run(newId("rst"), user.id, token, expiresAt);
  logActivity(null, "Sistema", "Recuperación de contraseña solicitada", "Email: " + emailLower);

  // Intentar enviar email real si SMTP está configurado
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpHost && smtpUser && smtpPass) {
    try {
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user: smtpUser, pass: smtpPass }
      });
      const resetUrl = (process.env.APP_URL || "https://mediloop.railway.app") + "/index.html?reset=" + token;
      transporter.sendMail({
        from: process.env.SMTP_FROM || smtpUser,
        to: emailLower,
        subject: "Mediloop — Recuperación de contraseña",
        html: "<p>Hola " + user.name + ",</p><p>Haz clic en el siguiente enlace para restablecer tu contraseña (válido 1 hora):</p><p><a href=\"" + resetUrl + "\">" + resetUrl + "</a></p><p>Si no solicitaste esto, ignora este mensaje.</p>"
      }).catch(() => {});
      return res.json({ ok: true });
    } catch (_) {}
  }
  // Demo: devolver el token en la respuesta
  return res.json({ ok: true, resetToken: token });
});

router.post("/auth/reset-password", (req, res) => {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) return res.status(400).json({ message: "Faltan campos" });
  if (newPassword.length < 6) return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres" });
  const row = db.prepare(`
    SELECT prt.*, u.email FROM password_reset_tokens prt
    JOIN users u ON u.id = prt.user_id
    WHERE prt.token = ? AND prt.used = 0 AND prt.expires_at > ?
  `).get(token, new Date().toISOString());
  if (!row) return res.status(400).json({ message: "Enlace inválido o expirado. Solicita uno nuevo." });
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(newPassword, 10), row.user_id);
  db.prepare("UPDATE password_reset_tokens SET used = 1 WHERE token = ?").run(token);
  logActivity(row.user_id, row.email, "Contraseña restablecida", null);
  return res.json({ ok: true });
});

module.exports = router;
