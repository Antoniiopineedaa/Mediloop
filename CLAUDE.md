# Mediloop

App web gestión prácticas clínicas UJI (producción real, cientos de alumnos/tutores).

## Stack
- **Backend**: Node.js + Express, SQLite via `node:sqlite` (DatabaseSync), sin ORM — `backend/src/`
- **Frontend**: HTML/CSS/JS estático — `frontend/public/`
- **Deploy**: Railway, auto-deploy en push a `main`

## Arrancar local
```
node --experimental-sqlite backend/src/server.js   # puerto 4000
```

## Railway (lecciones críticas)
- Node 20 por defecto → `node:sqlite` no existe → usa `nixpacks.toml` con `nodejs_22`
- Deps de producción deben estar en el `package.json` raíz (bcryptjs, jsonwebtoken, qrcode, express, cors)

## Auth
- JWT HS256, 7d, secret en `JWT_SECRET` env (fallback `"mediloop-secret-dev-2026"`)
- Solo emails `@uji.es`. Roles: `student` / `tutor`

## Cuentas demo (password: 123456)
- `alumno@uji.es` — Ana Martínez (student)
- `tutor@uji.es` — Dra. María González (tutor)

## Flujo QR
1. Tutor crea rotación → backend genera `qr_token` → tutor ve imagen QR en su dashboard
2. Alumno abre `qr-scan.html` → apunta cámara al QR del tutor → POST `/attendance/qr-checkin`
3. Crea registro pendiente → tutor confirma/rechaza desde su panel

## Archivos clave
- `backend/src/server.js` — entrada Express
- `backend/src/routes.js` — todas las rutas API
- `backend/src/db.js` — init SQLite + seed
- `frontend/public/tutores.html` — dashboard tutor
- `frontend/public/alumnos.html` — dashboard alumno
- `frontend/public/qr-scan.html` — escáner QR alumno
