-- 1) Track realtime presence to prevent 'ghost participants'
ALTER TABLE public.video_call_participants
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_video_call_participants_session_active_seen
ON public.video_call_participants (session_id, is_active, last_seen_at);

ALTER TABLE public.cr_video_participants
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_cr_video_participants_session_active_seen
ON public.cr_video_participants (session_id, is_active, last_seen_at);

-- 2) Ensure announcements can be deleted by class admins (and optionally by the author)
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Allow admins to delete announcements in their class
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'announcements'
      AND policyname = 'Admins can delete announcements'
  ) THEN
    CREATE POLICY "Admins can delete announcements"
    ON public.announcements
    FOR DELETE
    USING (public.has_class_role(auth.uid(), class_id, 'admin'));
  END IF;

  -- Allow authors to delete their own announcements
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'announcements'
      AND policyname = 'Users can delete their own announcements'
  ) THEN
    CREATE POLICY "Users can delete their own announcements"
    ON public.announcements
    FOR DELETE
    USING (auth.uid() = user_id);
  END IF;
END $$;

-- 3) Allow users to update their own last_seen_at (for heartbeat)
ALTER TABLE public.video_call_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cr_video_participants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'video_call_participants'
      AND policyname = 'Users can update their own video call participant row'
  ) THEN
    CREATE POLICY "Users can update their own video call participant row"
    ON public.video_call_participants
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cr_video_participants'
      AND policyname = 'Users can update their own CR video participant row'
  ) THEN
    CREATE POLICY "Users can update their own CR video participant row"
    ON public.cr_video_participants
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;