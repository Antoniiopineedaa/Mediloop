## UX/UI Mediloop – MVP

### 1. Landing pública

- **Objetivo**: Explicar rápidamente qué es Mediloop y llevar al usuario a iniciar sesión.
- **Estructura**:
  - Hero superior:
    - Logo Mediloop.
    - Título: “La forma moderna de gestionar las prácticas clínicas”.
    - Subtítulo orientado a estudiantes de Medicina UJI.
    - Botón principal: “Entrar con cuenta UJI”.
  - Sección “Para quién es”:
    - Tres columnas: Estudiantes, Tutores, Coordinación.
  - Sección “Qué resuelve”:
    - Tarjetas con: gestión de prácticas, firmas digitales, evaluaciones, analítica.
  - Sección “Cómo funciona”:
    - Paso 1: Inicia sesión con UJI.
    - Paso 2: Sigue tus rotaciones y firmas.
    - Paso 3: Evalúa y mejora la experiencia clínica.
  - Pie de página:
    - Enlaces básicos (contacto facultad, soporte, política de privacidad).

### 2. Dashboard Estudiante – wireframe

- **Header**:
  - Logo pequeño Mediloop.
  - Nombre del estudiante.
  - Menú con: Dashboard, Rotaciones, Evaluaciones, Perfil.

- **Vista principal (Dashboard)**:
  - Bloque “Progreso de prácticas”:
    - Barra o donut con rotaciones completadas vs totales.
  - Bloque “Próxima rotación”:
    - Hospital, servicio, fechas, tutor.
  - Bloque “Pendientes”:
    - Lista de:
      - Evaluaciones por rellenar.
      - Firmas de actas pendientes.
  - Bloque “Hoy”:
    - Sesión actual (si hay), botón “Registrar asistencia (QR)”.

- **Pantalla Rotaciones**:
  - Tabla/listado con:
    - Hospital, servicio, fechas, estado (en curso, finalizada).
    - Enlace para ver detalle (incluye acta y evaluaciones asociadas).

### 3. Dashboard Tutor – wireframe

- **Header**:
  - Logo, nombre del tutor, menú: Dashboard, Estudiantes, Evaluaciones, Perfil.

- **Vista principal**:
  - Bloque “Estudiantes asignados hoy”:
    - Tarjetas con nombre estudiante, rotación, hospital.
  - Bloque “Firmas y evaluaciones pendientes”:
    - Contadores y enlaces rápidos:
      - Actas por firmar.
      - Evaluaciones del estudiante pendientes.

- **Pantalla Estudiantes**:
  - Lista de estudiantes con:
    - Curso, rotación actual, progreso.
    - Acción “Evaluar” y “Ver acta”.

### 4. Dashboard Coordinador – wireframe

- **Header**:
  - Logo, nombre del coordinador, menú: Visión general, Rotaciones, Rúbricas, Estadísticas.

- **Vista “Visión general”**:
  - KPIs:
    - Nº total de estudiantes en prácticas.
    - % actas firmadas completamente.
    - Nº evaluaciones completadas vs pendientes.
  - Gráfico simple:
    - Porcentaje de firmas completadas por hospital/servicio.

- **Pantalla Rotaciones**:
  - Tabla editable con:
    - Estudiante, hospital, servicio, tutor, fechas, estado.
  - Botón “Crear rotación” (abre formulario).

- **Pantalla Rúbricas**:
  - Lista de rúbricas:
    - Nombre, tipo (estudiante, tutor/hospital), estado (activa).
  - Acciones: crear nueva, editar, duplicar.

### 5. Sistema visual

- **Estética**:
  - Inspirada en entorno sanitario/universitario.
  - Mucho espacio en blanco, iconografía suave, esquinas levemente redondeadas.

- **Colores (ejemplo)**:
  - Primario: azul sanitario (`#2563EB`).
  - Secundario: verde suave (`#10B981`).
  - Fondo: gris muy claro (`#F3F4F6`).
  - Texto principal: gris oscuro (`#111827`).

- **Tipografía**:
  - Sans-serif limpia (ej. Inter, Roboto o similar).
  - Jerarquía:
    - Títulos: peso semibold/bold.
    - Texto de cuerpo: regular.

- **Componentes base**:
  - Botones:
    - Primario (relleno azul, texto blanco).
    - Secundario (borde gris, fondo blanco).
  - Tarjetas:
    - Fondo blanco, sombra suave, título + icono + texto corto.
  - Tabs:
    - Para navegación dentro de dashboards (por ejemplo, “Resumen / Rotaciones / Evaluaciones”).
  - Badges:
    - Para estados (en curso, completada, pendiente) con colores consistentes.

### 6. Navegación y responsividad

- Diseño responsive pensado primero para escritorio, pero usable en tablet y móvil.
- Menú lateral colapsable en pantallas pequeñas.
- Elementos críticos (botón de check-in, ver próximas rotaciones) siempre visibles sin mucho scroll.

