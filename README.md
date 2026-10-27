# Slack Chat Personal (1 a 1) — Listo para Vercel + Supabase

Clon exacto de la interfaz de chat de **Slack** enfocado exclusivamente en **chat personal 1 a 1**, **foto de perfil**, **nombre visible** y **@usuario**, con autenticación únicamente mediante **usuario y contraseña**.

---

## ✨ Características

- **UI idéntica a Slack**: Barra superior `#350d36`, sidebar Aubergine `#3F0E40`, cabecera de conversación, agrupación compacta de mensajes consecutivos con hora en el margen al pasar el cursor, barra de formato (`*negrita*`, `_cursiva_`, `~tachado~`, `` `código` ``, `> cita`), reacciones rápidas y panel derecho de **Perfil**.
- **Autenticación solo con `@usuario` y `contraseña`**: Sin correos ni confirmaciones por email.
- **Perfil personalizable**: Sube tu foto de perfil desde tu dispositivo (se recorta y comprime automáticamente para guardarse directo en la base de datos), pega una URL o elige un avatar, y edita tu **Nombre** y **`@usuario`** en cualquier momento.
- **Tiempo real con Supabase Realtime**: Mensajes instantáneos, actualización de fotos/nombres en vivo, estado en línea y aviso de *"está escribiendo..."*.
- **Modo Local incluido**: Puedes probarlo inmediatamente abriendo `index.html` en dos pestañas del navegador incluso antes de configurar Supabase.

---

## 🚀 Cómo desplegar en Vercel con Supabase (3 pasos)

### Paso 1: Crear las tablas en Supabase
1. Crea un proyecto gratis en [supabase.com](https://supabase.com).
2. En el menú lateral izquierdo, entra a **SQL Editor** → **New query**.
3. Copia y pega todo el contenido de [`supabase/schema.sql`](./supabase/schema.sql) y haz clic en **Run**.

### Paso 2: Obtener tus claves de Supabase
En tu panel de Supabase ve a **Project Settings** → **API** y copia:
- **Project URL** (`SUPABASE_URL`)
- **anon public key** (`SUPABASE_ANON_KEY`)

### Paso 3: Subir a Vercel
1. Sube esta carpeta a un repositorio de GitHub e impórtalo en [vercel.com/new](https://vercel.com/new).
2. En la sección **Environment Variables** de Vercel, agrega:
   - `SUPABASE_URL` = `https://tu-proyecto.supabase.co`
   - `SUPABASE_ANON_KEY` = `tu-anon-public-key`
3. Haz clic en **Deploy**. Durante el despliegue, [`build-config.js`](./build-config.js) inyectará automáticamente tus variables en [`js/config.js`](./js/config.js).
   *(También puedes pegar tus claves directamente en [`js/config.js`](./js/config.js) o desde el botón **"Conectar Supabase"** dentro de la aplicación).*
