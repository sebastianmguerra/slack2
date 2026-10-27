-- ============================================================================
-- SLACK 1-ON-1 CHAT CLONE - ESQUEMA DE BASE DE DATOS PARA SUPABASE
-- ============================================================================
-- Instrucciones:
-- 1. Entra a tu proyecto en https://supabase.com/dashboard
-- 2. Ve a "SQL Editor" en el menú lateral izquierdo y haz clic en "New query".
-- 3. Pega todo este contenido y haz clic en "Run" (Ejecutar).
-- ============================================================================

-- 1. Tabla de usuarios (autenticación simple con usuario + contraseña, nombre y foto)
CREATE TABLE IF NOT EXISTS public.slack_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índice para búsqueda rápida por username (en minúsculas)
CREATE UNIQUE INDEX IF NOT EXISTS idx_slack_users_username_lower
    ON public.slack_users (LOWER(username));

-- 2. Tabla de mensajes del chat
CREATE TABLE IF NOT EXISTS public.slack_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES public.slack_users(id) ON DELETE CASCADE,
    receiver_id UUID REFERENCES public.slack_users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    image_url TEXT DEFAULT NULL,
    reactions JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slack_messages_created_at
    ON public.slack_messages (created_at ASC);

-- 3. Habilitar Row Level Security (RLS) con políticas abiertas para el chat personal
ALTER TABLE public.slack_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir lectura de usuarios" ON public.slack_users;
CREATE POLICY "Permitir lectura de usuarios"
    ON public.slack_users FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Permitir registro de usuarios" ON public.slack_users;
CREATE POLICY "Permitir registro de usuarios"
    ON public.slack_users FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir actualizar perfil propio" ON public.slack_users;
CREATE POLICY "Permitir actualizar perfil propio"
    ON public.slack_users FOR UPDATE
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir leer mensajes" ON public.slack_messages;
CREATE POLICY "Permitir leer mensajes"
    ON public.slack_messages FOR SELECT
    USING (true);

DROP POLICY IF EXISTS "Permitir enviar mensajes" ON public.slack_messages;
CREATE POLICY "Permitir enviar mensajes"
    ON public.slack_messages FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir actualizar mensajes (reacciones)" ON public.slack_messages;
CREATE POLICY "Permitir actualizar mensajes (reacciones)"
    ON public.slack_messages FOR UPDATE
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir eliminar mensajes" ON public.slack_messages;
CREATE POLICY "Permitir eliminar mensajes"
    ON public.slack_messages FOR DELETE
    USING (true);

-- 4. Habilitar Realtime para mensajes y perfiles en vivo
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'slack_users'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.slack_users;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'slack_messages'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.slack_messages;
    END IF;
END $$;
