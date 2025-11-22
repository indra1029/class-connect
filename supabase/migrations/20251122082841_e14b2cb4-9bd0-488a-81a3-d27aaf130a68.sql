-- Add college information to support college-wide features
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS college TEXT;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS college TEXT;

-- Create admin_messages table for CR-to-CR communication
CREATE TABLE IF NOT EXISTS public.admin_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL,
  to_user_id UUID NOT NULL,
  content TEXT NOT NULL,
  file_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  read BOOLEAN DEFAULT FALSE
);

ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;

-- Policies for admin messages (only class creators can access)
CREATE POLICY "Class creators can send admin messages"
ON admin_messages FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = from_user_id AND
  EXISTS (
    SELECT 1 FROM classes WHERE created_by = auth.uid()
  )
);

CREATE POLICY "Users can view their admin messages"
ON admin_messages FOR SELECT
TO authenticated
USING (
  auth.uid() = from_user_id OR auth.uid() = to_user_id
);

CREATE POLICY "Users can update their received messages"
ON admin_messages FOR UPDATE
TO authenticated
USING (auth.uid() = to_user_id);

-- Create video_call_sessions table for multi-user calls
CREATE TABLE IF NOT EXISTS public.video_call_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  started_by UUID NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE
);

ALTER TABLE public.video_call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Class members can view call sessions"
ON video_call_sessions FOR SELECT
TO authenticated
USING (is_class_member(auth.uid(), class_id));

CREATE POLICY "Class members can create call sessions"
ON video_call_sessions FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = started_by AND
  is_class_member(auth.uid(), class_id)
);

CREATE POLICY "Call starters can update sessions"
ON video_call_sessions FOR UPDATE
TO authenticated
USING (auth.uid() = started_by);

-- Create video_call_participants table
CREATE TABLE IF NOT EXISTS public.video_call_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES video_call_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  left_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(session_id, user_id)
);

ALTER TABLE public.video_call_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view call participants"
ON video_call_participants FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM video_call_sessions vcs
    WHERE vcs.id = video_call_participants.session_id
    AND is_class_member(auth.uid(), vcs.class_id)
  )
);

CREATE POLICY "Users can join calls"
ON video_call_participants FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id AND
  EXISTS (
    SELECT 1 FROM video_call_sessions vcs
    WHERE vcs.id = video_call_participants.session_id
    AND is_class_member(auth.uid(), vcs.class_id)
  )
);

CREATE POLICY "Users can update their participation"
ON video_call_participants FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Enable realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE video_call_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE video_call_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE admin_messages;

-- Function to notify class members when a video call starts
CREATE OR REPLACE FUNCTION public.notify_video_call_started()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_record RECORD;
  starter_name TEXT;
BEGIN
  -- Get the name of the person who started the call
  SELECT full_name INTO starter_name
  FROM profiles
  WHERE id = NEW.started_by;

  -- Notify all class members except the starter
  FOR member_record IN 
    SELECT user_id FROM class_members 
    WHERE class_id = NEW.class_id AND user_id != NEW.started_by
  LOOP
    INSERT INTO notifications (user_id, title, message, type, link)
    VALUES (
      member_record.user_id,
      'Video Call Started',
      starter_name || ' started a video call',
      'video_call',
      '/class/' || NEW.class_id
    );
  END LOOP;
  
  RETURN NEW;
END;
$$;

-- Trigger for video call notifications
DROP TRIGGER IF EXISTS notify_video_call_trigger ON video_call_sessions;
CREATE TRIGGER notify_video_call_trigger
AFTER INSERT ON video_call_sessions
FOR EACH ROW
EXECUTE FUNCTION notify_video_call_started();

-- Function to get all class creators (admins) in the same college
CREATE OR REPLACE FUNCTION public.get_college_admins(_user_id UUID)
RETURNS TABLE(
  user_id UUID,
  full_name TEXT,
  avatar_url TEXT,
  college TEXT,
  class_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT
    p.id,
    p.full_name,
    p.avatar_url,
    p.college,
    COUNT(DISTINCT c.id) as class_count
  FROM profiles p
  JOIN classes c ON c.created_by = p.id
  WHERE p.college = (SELECT college FROM profiles WHERE id = _user_id)
  AND p.college IS NOT NULL
  AND p.id != _user_id
  GROUP BY p.id, p.full_name, p.avatar_url, p.college;
$$;

-- Function to get all classes in a college
CREATE OR REPLACE FUNCTION public.get_college_classes(_user_id UUID)
RETURNS TABLE(
  class_id UUID,
  class_name TEXT,
  description TEXT,
  created_by UUID,
  creator_name TEXT,
  member_count BIGINT,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    c.id,
    c.name,
    c.description,
    c.created_by,
    p.full_name,
    COUNT(DISTINCT cm.user_id) as member_count,
    c.created_at
  FROM classes c
  JOIN profiles p ON p.id = c.created_by
  LEFT JOIN class_members cm ON cm.class_id = c.id
  WHERE c.college = (SELECT college FROM profiles WHERE id = _user_id)
  AND c.college IS NOT NULL
  -- Only show to class creators
  AND EXISTS (
    SELECT 1 FROM classes WHERE created_by = _user_id
  )
  GROUP BY c.id, c.name, c.description, c.created_by, p.full_name, c.created_at
  ORDER BY c.created_at DESC;
$$;