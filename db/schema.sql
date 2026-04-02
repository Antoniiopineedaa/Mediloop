-- Esquema inicial de base de datos para Mediloop (PostgreSQL)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Tabla de usuarios genéricos
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'tutor', 'coordinator', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Estudiantes
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  nia TEXT NOT NULL,
  curso INT NOT NULL CHECK (curso BETWEEN 2 AND 6),
  grupo TEXT,
  plan_estudios TEXT
);

-- Tutores / médicos
CREATE TABLE tutors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  especialidad TEXT,
  servicio_principal TEXT,
  hospital_id UUID
);

-- Hospitales / centros
CREATE TABLE hospitals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('hospital', 'centro_salud', 'otro')),
  direccion TEXT,
  ciudad TEXT,
  lat NUMERIC,
  lng NUMERIC
);

ALTER TABLE tutors
  ADD CONSTRAINT tutors_hospital_fk
  FOREIGN KEY (hospital_id) REFERENCES hospitals(id);

-- Servicios / unidades
CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  nombre TEXT NOT NULL,
  tipo TEXT
);

-- Rotaciones de prácticas
CREATE TABLE rotations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id UUID NOT NULL REFERENCES students(id),
  tutor_id UUID NOT NULL REFERENCES tutors(id),
  hospital_id UUID NOT NULL REFERENCES hospitals(id),
  service_id UUID NOT NULL REFERENCES services(id),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  horario TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('planificada', 'en_curso', 'finalizada', 'cancelada'))
);

-- Sesiones concretas de prácticas (días/turnos)
CREATE TABLE practice_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rotation_id UUID NOT NULL REFERENCES rotations(id),
  fecha DATE NOT NULL,
  turno TEXT NOT NULL CHECK (turno IN ('manana', 'tarde', 'noche')),
  qr_token TEXT UNIQUE,
  estado_asistencia TEXT NOT NULL CHECK (
    estado_asistencia IN ('pendiente', 'marcada_estudiante', 'validada_tutor', 'incidencia')
  ),
  observaciones TEXT
);

-- Actas de prácticas / firmas digitales
CREATE TABLE practice_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rotation_id UUID NOT NULL UNIQUE REFERENCES rotations(id),
  horas_totales INT,
  resumen TEXT,
  estado_firma TEXT NOT NULL CHECK (
    estado_firma IN ('borrador', 'firmada_estudiante', 'firmada_tutor', 'completada')
  ),
  firma_estudiante_at TIMESTAMPTZ,
  firma_tutor_at TIMESTAMPTZ
);

-- Logs de auditoría (para firmas y acciones importantes)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rúbricas
CREATE TABLE rubrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre TEXT NOT NULL,
  descripcion TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('eval_estudiante', 'eval_tutor_hospital')),
  activo BOOLEAN NOT NULL DEFAULT TRUE
);

-- Criterios de rúbrica
CREATE TABLE rubric_criteria (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rubric_id UUID NOT NULL REFERENCES rubrics(id),
  nombre TEXT NOT NULL,
  descripcion TEXT,
  peso NUMERIC,
  min_valor INT NOT NULL DEFAULT 1,
  max_valor INT NOT NULL DEFAULT 5
);

-- Evaluaciones
CREATE TABLE evaluations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rubric_id UUID NOT NULL REFERENCES rubrics(id),
  rotation_id UUID NOT NULL REFERENCES rotations(id),
  evaluador_id UUID NOT NULL REFERENCES users(id),
  evaluado_tipo TEXT NOT NULL CHECK (evaluado_tipo IN ('student', 'tutor', 'hospital')),
  evaluado_id UUID NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('borrador', 'enviada')),
  comentarios_generales TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Respuestas por criterio
CREATE TABLE evaluation_answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  evaluation_id UUID NOT NULL REFERENCES evaluations(id),
  criterion_id UUID NOT NULL REFERENCES rubric_criteria(id),
  valor INT NOT NULL,
  comentario TEXT
);

-- Incidencias
CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reportante_id UUID NOT NULL REFERENCES users(id),
  rotation_id UUID NOT NULL REFERENCES rotations(id),
  tipo TEXT NOT NULL CHECK (
    tipo IN ('docente', 'organizativa', 'logistica', 'seguridad_paciente', 'otro')
  ),
  descripcion TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('abierta', 'en_revision', 'resuelta', 'cerrada')),
  responsable_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

