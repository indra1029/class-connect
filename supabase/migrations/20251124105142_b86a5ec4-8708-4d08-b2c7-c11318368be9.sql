-- Create CR video call sessions table
CREATE TABLE IF NOT EXISTS public.cr_video_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  college TEXT NOT NULL,
  started_by UUID NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ended_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  session_name TEXT NOT NULL DEFAULT 'CR Meeting'
);

-- Enable RLS
ALTER TABLE public.cr_video_sessions ENABLE ROW LEVEL SECURITY;

-- CR video participants table
CREATE TABLE IF NOT EXISTS public.cr_video_participants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.cr_video_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  left_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE public.cr_video_participants ENABLE ROW LEVEL SECURITY;

-- RLS policies for cr_video_sessions
CREATE POLICY "Verified CRs can view sessions in their college"
  ON public.cr_video_sessions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND college_verified = true
      AND verified_college = cr_video_sessions.college
    )
  );

CREATE POLICY "Verified CRs can create sessions"
  ON public.cr_video_sessions
  FOR INSERT
  WITH CHECK (
    auth.uid() = started_by
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
      AND college_verified = true
    )
  );

CREATE POLICY "Session creators can update their sessions"
  ON public.cr_video_sessions
  FOR UPDATE
  USING (auth.uid() = started_by);

-- RLS policies for cr_video_participants
CREATE POLICY "Participants can view session participants"
  ON public.cr_video_participants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.cr_video_sessions vcs
      WHERE vcs.id = cr_video_participants.session_id
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
        AND college_verified = true
      )
    )
  );

CREATE POLICY "Users can join CR video calls"
  ON public.cr_video_participants
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.cr_video_sessions vcs
      WHERE vcs.id = cr_video_participants.session_id
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
        AND college_verified = true
      )
    )
  );

CREATE POLICY "Users can update their participation"
  ON public.cr_video_participants
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Function to notify CRs about new messages
CREATE OR REPLACE FUNCTION public.notify_cr_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_profile RECORD;
  cr_record RECORD;
BEGIN
  -- Get sender profile
  SELECT full_name, verified_college INTO sender_profile
  FROM profiles
  WHERE id = NEW.from_user_id;

  -- Notify all verified CRs in the same college except sender
  FOR cr_record IN 
    SELECT p.id, p.full_name
    FROM profiles p
    WHERE p.college_verified = true
    AND p.verified_college = sender_profile.verified_college
    AND p.id != NEW.from_user_id
    AND EXISTS (
      SELECT 1 FROM classes WHERE created_by = p.id
    )
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      cr_record.id,
      'New CR Network Message',
      sender_profile.full_name || ' shared a message in CR Collaboration Hub',
      'cr_message',
      '/cr-group-chat'
    );
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- Trigger for CR message notifications
DROP TRIGGER IF EXISTS trigger_notify_cr_message ON public.admin_messages;
CREATE TRIGGER trigger_notify_cr_message
  AFTER INSERT ON public.admin_messages
  FOR EACH ROW
  WHEN (NEW.from_user_id = NEW.to_user_id)
  EXECUTE FUNCTION public.notify_cr_message();

-- Function to notify CRs about video call started
CREATE OR REPLACE FUNCTION public.notify_cr_video_call()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  starter_profile RECORD;
  cr_record RECORD;
BEGIN
  -- Get starter profile
  SELECT full_name, verified_college INTO starter_profile
  FROM profiles
  WHERE id = NEW.started_by;

  -- Notify all verified CRs in the same college except starter
  FOR cr_record IN 
    SELECT p.id
    FROM profiles p
    WHERE p.college_verified = true
    AND p.verified_college = starter_profile.verified_college
    AND p.id != NEW.started_by
    AND EXISTS (
      SELECT 1 FROM classes WHERE created_by = p.id
    )
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      cr_record.id,
      'CR Video Meeting Started',
      starter_profile.full_name || ' started a video meeting in CR Network',
      'cr_video_call',
      '/cr-group-chat'
    );
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- Trigger for CR video call notifications
DROP TRIGGER IF EXISTS trigger_notify_cr_video_call ON public.cr_video_sessions;
CREATE TRIGGER trigger_notify_cr_video_call
  AFTER INSERT ON public.cr_video_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_cr_video_call();

-- Enable realtime for CR video tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.cr_video_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cr_video_participants;