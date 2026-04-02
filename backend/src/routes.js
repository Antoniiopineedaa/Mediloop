const express = require("express");
const fs = require("fs");
const path = require("path");

const router = express.Router();

const users = [
  {
    id: "stu-1",
    email: "alumno@mediloop.app",
    password: "123456",
    role: "student",
    name: "Ana Martínez"
  },
  {
    id: "tut-1",
    email: "tutor@mediloop.app",
    password: "123456",
    role: "tutor",
    name: "Dr. María González"
  }
];

const rotations = [
  {
    id: "rot-1",
    hospital: "Hospital General de Castellón",
    service: "Medicina Interna",
    startDate: "2026-03-01",
    endDate: "2026-04-15",
    status: "en curso"
  },
  {
    id: "rot-2",
    hospital: "Centro de Salud 9 de Octubre",
    service: "Atención Primaria",
    startDate: "2026-04-20",
    endDate: "2026-05-20",
    status: "planificada"
  }
];

const defaultStore = {
  attendancePending: [
    { id: "att-1", name: "Ana García Rodríguez", scannedAt: "hace 2 min" },
    { id: "att-2", name: "Carlos Mendoza López", scannedAt: "hace 5 min" }
  ],
  attendanceConfirmed: [
    { id: "att-3", name: "María Fernández", time: "08:30" },
    { id: "att-4", name: "José Martínez", time: "08:45" },
    { id: "att-5", name: "Laura Sánchez", time: "09:15" }
  ],
  evaluations: [],
  tutorPosts: [
  {
    id: "post-1",
    author: "Dr. Patricia Ruiz",
    text: "¿Alguien tiene experiencia evaluando estudiantes de intercambio internacional?",
    likes: 12,
    comments: 5,
    ago: "Hace 2h"
  },
  {
    id: "post-2",
    author: "Dr. Miguel Torres",
    text: "Excelente webinar sobre evaluación por competencias. ¡Muy recomendado!",
    likes: 8,
    comments: 3,
    ago: "Hace 4h"
  }
  ]
};

const dataDir = path.join(__dirname, "..", "data");
const storePath = path.join(dataDir, "store.json");

function ensureStoreFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify(defaultStore, null, 2), "utf8");
  }
}

function readStore() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      attendancePending: Array.isArray(parsed.attendancePending) ? parsed.attendancePending : defaultStore.attendancePending,
      attendanceConfirmed: Array.isArray(parsed.attendanceConfirmed) ? parsed.attendanceConfirmed : defaultStore.attendanceConfirmed,
      evaluations: Array.isArray(parsed.evaluations) ? parsed.evaluations : defaultStore.evaluations,
      tutorPosts: Array.isArray(parsed.tutorPosts) ? parsed.tutorPosts : defaultStore.tutorPosts
    };
  } catch (_err) {
    fs.writeFileSync(storePath, JSON.stringify(defaultStore, null, 2), "utf8");
    return { ...defaultStore };
  }
}

function writeStore(nextStore) {
  ensureStoreFile();
  fs.writeFileSync(storePath, JSON.stringify(nextStore, null, 2), "utf8");
}

function createToken(user) {
  return Buffer.from(
    JSON.stringify({ sub: user.id, role: user.role, email: user.email })
  ).toString("base64url");
}

function parseToken(token) {
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch (_err) {
    return null;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = parseToken(token);
  if (!payload || !payload.sub) {
    return res.status(401).json({ message: "No autorizado" });
  }
  req.user = payload;
  return next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ message: "Permisos insuficientes" });
    }
    return next();
  };
}

router.post("/auth/login", (req, res) => {
  const { email, password, role } = req.body || {};
  const user = users.find(
    (u) =>
      u.email.toLowerCase() === String(email || "").toLowerCase() &&
      u.password === password &&
      u.role === role
  );
  if (!user) {
    return res.status(401).json({ message: "Credenciales inválidas" });
  }
  return res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    },
    token: createToken(user)
  });
});

router.get("/auth/me", requireAuth, (req, res) => {
  const user = users.find((u) => u.id === req.user.sub);
  if (!user) {
    return res.status(404).json({ message: "Usuario no encontrado" });
  }
  return res.json({ id: user.id, email: user.email, role: user.role, name: user.name });
});

router.get("/rotations", requireAuth, requireRole("student"), (_req, res) => {
  res.json(rotations);
});

router.get("/dashboard/student", requireAuth, requireRole("student"), (_req, res) => {
  res.json({
    progress: { completed: 1, total: 4 },
    nextRotation: rotations[0],
    pendingEvaluations: [
      { id: "eval-1", type: "tutor->estudiante", rotationId: "rot-1" },
      { id: "eval-2", type: "estudiante->hospital", rotationId: "rot-1" }
    ],
    pendingSignatures: [{ id: "sig-1", rotationId: "rot-1", role: "estudiante" }]
  });
});

router.get("/dashboard/tutor", requireAuth, requireRole("tutor"), (_req, res) => {
  res.json({
    stats: {
      studentsEvaluated: 127,
      averageScore: "4.8/5",
      averageTime: "15 min",
      globalRank: "#23"
    },
    kpis: { students: 23, avg: 4.8, achievements: 12 }
  });
});

router.get("/attendance/pending", requireAuth, requireRole("tutor"), (_req, res) => {
  const store = readStore();
  res.json(store.attendancePending);
});

router.get("/attendance/confirmed", requireAuth, requireRole("tutor"), (_req, res) => {
  const store = readStore();
  res.json(store.attendanceConfirmed);
});

router.post("/attendance/:id/confirm", requireAuth, requireRole("tutor"), (req, res) => {
  const store = readStore();
  const idx = store.attendancePending.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ message: "Asistencia no encontrada" });
  const item = store.attendancePending.splice(idx, 1)[0];
  store.attendanceConfirmed.unshift({
    id: item.id,
    name: item.name,
    time: new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
  });
  writeStore(store);
  return res.json({ ok: true });
});

router.post("/attendance/:id/reject", requireAuth, requireRole("tutor"), (req, res) => {
  const store = readStore();
  const idx = store.attendancePending.findIndex((a) => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ message: "Asistencia no encontrada" });
  store.attendancePending.splice(idx, 1);
  writeStore(store);
  return res.json({ ok: true });
});

router.post("/evaluations", requireAuth, requireRole("tutor"), (req, res) => {
  const store = readStore();
  const { studentName, rotation, theory, practical, communication, comments } = req.body || {};
  if (!studentName || !rotation) {
    return res.status(400).json({ message: "Faltan campos obligatorios" });
  }
  const evaluation = {
    id: `eval-${store.evaluations.length + 1}`,
    studentName,
    rotation,
    theory: Number(theory || 0),
    practical: Number(practical || 0),
    communication: Number(communication || 0),
    comments: comments || "",
    createdAt: new Date().toISOString()
  };
  store.evaluations.push(evaluation);
  writeStore(store);
  return res.status(201).json(evaluation);
});

router.get("/evaluations", requireAuth, (req, res) => {
  const store = readStore();
  if (req.user.role === "tutor") return res.json(store.evaluations);
  return res.json(
    store.evaluations.filter((e) => e.studentName.toLowerCase().includes("ana"))
  );
});

router.get("/community/tutor-posts", requireAuth, requireRole("tutor"), (_req, res) => {
  const store = readStore();
  res.json(store.tutorPosts);
});

router.post("/community/tutor-posts", requireAuth, requireRole("tutor"), (req, res) => {
  const store = readStore();
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ message: "Texto requerido" });
  const post = {
    id: `post-${store.tutorPosts.length + 1}`,
    author: "Dr. María González",
    text,
    likes: 0,
    comments: 0,
    ago: "Ahora"
  };
  store.tutorPosts.unshift(post);
  writeStore(store);
  return res.status(201).json(post);
});

module.exports = router;

