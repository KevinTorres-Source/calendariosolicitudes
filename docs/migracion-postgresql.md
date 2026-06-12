# Migracion a PostgreSQL

Este proyecto actualmente guarda datos compartidos en archivos JSON dentro de `backend/`:

- `reservas.json`
- `bloqueos.json`
- `feedback.json`
- `limites-solicitudes.json`
- `limites-dispositivos.json`
- `admin-config.json`

Antes de migrar, confirma que el frontend ya este usando el backend real del servidor. Si el navegador intenta usar `localhost:3000`, cada usuario terminara trabajando con datos locales del dispositivo.

## 1. Elegir proveedor

Opciones recomendadas:

- Supabase
- Neon
- Railway PostgreSQL
- Render PostgreSQL
- PostgreSQL instalado en el VPS

Guardar en `backend/.env`:

```env
DATABASE_URL=postgres://usuario:password@host:5432/base
```

## 2. Instalar dependencia

```bash
cd backend
npm install pg
```

## 3. Crear tablas

```sql
create table reservas (
  id bigint primary key,
  creado_en timestamptz not null default now(),
  client_request_id text,
  fecha date not null,
  hour text not null,
  equipo text not null,
  usuario text not null,
  curso text,
  cantidad integer not null,
  correo text not null,
  nota text,
  estado text not null default 'aprobado'
);

create table bloqueos (
  id bigint primary key,
  fecha date not null,
  hour text
);

create table feedback (
  id bigint primary key,
  creado_en timestamptz not null default now(),
  wifi text,
  colaboradores text,
  dispositivos text,
  comentario text
);

create table limites_solicitudes (
  fecha date primary key,
  limite integer not null
);

create table limites_dispositivos (
  fecha date primary key,
  limite integer not null
);
```

## 4. Migrar datos actuales

Crear un script `backend/scripts/migrar-json-postgres.js` que:

- Lea los JSON actuales.
- Inserte cada registro con `on conflict do update` o `on conflict do nothing`.
- Convierta `creadoEn` a `creado_en`.

Ejecutarlo una sola vez en produccion:

```bash
node scripts/migrar-json-postgres.js
```

## 5. Reemplazar acceso a JSON

Cambiar las rutas del backend para usar PostgreSQL:

- `GET /reservas`
- `POST /reservas`
- `PUT /reservas/:id`
- `DELETE /reservas/:id`
- `GET/POST/DELETE /bloqueos`
- limites diarios
- feedback

Mantener las mismas respuestas JSON para no tocar el frontend.

## 6. Pruebas antes de activar

Probar en el servidor:

```bash
curl https://tu-dominio.com/reservas
```

Crear una solicitud desde un dispositivo y confirmar que aparece en otro.

## 7. Desactivar fallback local

Cuando PostgreSQL este funcionando, conviene dejar de crear reservas en `localStorage` si el backend no responde. En ese caso el usuario deberia ver un error claro:

```txt
Server unavailable. Please try again later.
```

Esto evita que vuelvan a aparecer solicitudes guardadas solo en un dispositivo.
