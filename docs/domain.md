## Dominio Mediloop – UJI

### Roles principales

- **Estudiante**
  - Usuario matriculado en Medicina (2º–6º) de la UJI.
  - Accede con credenciales UJI.
  - Consulta sus rotaciones, registra asistencia (QR), firma actas de prácticas y completa evaluaciones sobre tutores/hospitales.

- **Tutor/Médico**
  - Profesional sanitario responsable de uno o varios estudiantes en una rotación.
  - Valida asistencia (check-in), firma actas de prácticas y completa rúbricas de evaluación del estudiante.

- **Coordinador académico**
  - Usuario de la facultad (coordinador de prácticas, responsables de docencia).
  - Configura rotaciones, rúbricas, periodos de evaluación y revisa estadísticas globales.

- **Administrador de sistema**
  - Gestiona parámetros globales (hospitales, servicios, integración con UJI, backups).
  - No participa directamente en las prácticas.

### Entidades principales

- **Usuario**
  - Campos básicos: `id`, `nombre`, `apellidos`, `email_uji`, `rol_principal`, `roles_adicionales`, `activo`.
  - Asociado internamente a cuentas UJI (SSO) o, en una fase inicial, a cuentas locales restringidas a `@uji.es`.

- **Estudiante**
  - Referencia a `Usuario`.
  - Datos académicos: `nif`, `nia`, `curso` (2–6), `grupo`, `plan_estudios`.

- **Tutor**
  - Referencia a `Usuario`.
  - Datos profesionales: `especialidad`, `servicio`, `hospital_id`.

- **Hospital / Centro de salud**
  - `id`, `nombre`, `tipo` (hospital, centro_salud, otro), `direccion`, `ciudad`, `coordenadas_geo` (para mapas), `contacto_coordinacion`.

- **Servicio / Unidad**
  - `id`, `hospital_id`, `nombre`, `descripcion`, `tipo` (urgencias, medicina_interna, pediatría, etc.).

- **Rotación de prácticas**
  - Define un periodo de prácticas clínico-asistenciales.
  - Campos: `id`, `estudiante_id`, `tutor_id`, `hospital_id`, `servicio_id`, `fecha_inicio`, `fecha_fin`, `horario`, `estado` (planificada, en_curso, finalizada, cancelada).

- **Sesión de prácticas / Asistencia**
  - Representa un día/turno concreto de prácticas.
  - Campos: `id`, `rotacion_id`, `fecha`, `turno` (mañana/tarde/noche), `qr_token`, `estado_asistencia` (pendiente, marcada_estudiante, validada_tutor, incidencia), `observaciones`.

- **Acta de prácticas / Firma digital**
  - Documento digital que resume una rotación (horas, objetivos, evaluación global).
  - Campos: `id`, `rotacion_id`, `horas_totales`, `resumen`, `estado_firma` (borrador, firmada_estudiante, firmada_tutor, completada), `timestamp_firma_estudiante`, `timestamp_firma_tutor`, `audit_log`.

- **Rúbrica**
  - Definición de un conjunto de criterios para evaluar a un estudiante en una rotación.
  - Campos: `id`, `nombre`, `descripcion`, `tipo` (eval_estudiante, eval_tutor_hospital), `activo`.

- **Criterio de rúbrica**
  - `id`, `rubrica_id`, `nombre`, `descripcion`, `peso`, `escala` (ej. 1–5).

- **Evaluación**
  - Instancia de una rúbrica aplicada a una persona/entidad en una rotación concreta.
  - Campos: `id`, `rubrica_id`, `rotacion_id`, `evaluador_id`, `evaluado_tipo` (estudiante, tutor, hospital), `evaluado_id`, `estado` (borrador, enviada), `comentarios_generales`, `created_at`.

- **Respuesta de evaluación**
  - `id`, `evaluacion_id`, `criterio_rubrica_id`, `valor` (numérico), `comentario_opcional`.

- **Incidencia**
  - Reporte de problema durante las prácticas (organizativo, docente, seguridad, etc.).
  - Campos: `id`, `reportante_id` (estudiante o tutor), `rotacion_id`, `tipo` (docente, organizativa, logística, seguridad_paciente, otro), `descripcion`, `estado` (abierta, en_revision, resuelta, cerrada), `responsable_seguimiento_id`, `created_at`, `updated_at`.

### Flujos clave (MVP)

1. **Asignación de rotaciones**
   - Coordinador crea periodos de prácticas y rotaciones asignando hospital, servicio, tutor y fechas a cada estudiante.
   - Estudiante ve en su dashboard las rotaciones activas y futuras.

2. **Check-in de asistencia con QR**
   - Para cada sesión de prácticas se genera un `qr_token` asociado a `sesion_practicas`.
   - El estudiante escanea el QR (o accede a un enlace seguro) y marca su asistencia.
   - El tutor revisa la lista de asistencias del día y valida o rechaza según corresponda.

3. **Firma digital de prácticas**
   - Al finalizar una rotación, el sistema genera un borrador de acta con horas totales y datos de servicio.
   - El estudiante revisa y firma (confirmación autenticada en la app).
   - El tutor revisa y firma; el estado pasa a `completada` y se registra en `audit_log`.

4. **Rúbricas y evaluaciones**
   - El coordinador define una o varias rúbricas estándar para cada tipo de rotación.
   - Al finalizar una rotación:
     - Se crea una evaluación `tutor → estudiante` basada en la rúbrica correspondiente.
     - Se crea una evaluación `estudiante → tutor/hospital` de satisfacción.
   - Ambas evaluaciones se reflejan como tareas pendientes en los dashboards.

5. **Dashboards por rol (visión de datos)**
   - Estudiante: lista de rotaciones, progreso (completadas vs totales), asistencias marcadas/validadas, evaluaciones y firmas pendientes.
   - Tutor: estudiantes asignados, sesiones recientes, evaluaciones y firmas pendientes.
   - Coordinador: agregados por curso, hospital, servicio y estado de firmas/evaluaciones.

### Consideraciones de cumplimiento y datos

- Trazabilidad completa de cambios en actas y evaluaciones (timestamps, usuario, acción).
- Datos personales mínimos necesarios, con separación clara entre identidad académica y datos clínicos (no se almacenan historiales clínicos, solo información docente).
- Preparación para integrar SSO UJI, siguiendo políticas de protección de datos (GDPR) y seguridad de la universidad.

