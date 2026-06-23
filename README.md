# Godot Dedicated Backend

Backend dedicado oficial para correr `Cursed Domain` sin depender del puente legacy de `idle-ascendancy-main`.

## Objetivo

- Mantener contratos HTTP compatibles con Godot desde el primer cutover.
- Separar auth, errores, idempotencia y dominio jugable del frontend legado.
- Extraer la logica por modulos en este orden:
  1. bootstrap
  2. summons
  3. AFK
  4. missions
  5. battle resolve

## Rutas iniciales

- `POST /api/godot/bootstrap`
- `POST /api/godot/purchase-pack-v1`
- `GET /api/godot/afk/status`
- `POST /api/godot/claim-afk`
- `GET /api/godot/missions`
- `POST /api/godot/claim-mission`
- `POST /api/godot/complete-battle`

## Estado actual

- Auth Supabase server-side activa.
- Envelope de error homogeneo activo.
- Idempotencia activa para mutaciones criticas.
- Dominios activos:
  - bootstrap
  - summons
  - AFK
  - missions
  - battle resolve

## Arranque

Desde esta carpeta:

```powershell
node .\node_modules\.pnpm\tsx@4.22.4\node_modules\tsx\dist\cli.mjs src/index.ts
```

El cliente Godot oficial debe apuntar a `http://127.0.0.1:8090`.
