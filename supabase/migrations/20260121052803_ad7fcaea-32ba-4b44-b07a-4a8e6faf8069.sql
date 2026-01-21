-- Fix video call notification links to include joinCall session id
-- This ensures tapping a notification can join the exact active session.

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
      '/class/' || NEW.class_id || '?joinCall=' || NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- Ensure trigger exists (idempotent)
DROP TRIGGER IF EXISTS notify_video_call_trigger ON public.video_call_sessions;
CREATE TRIGGER notify_video_call_trigger
AFTER INSERT ON public.video_call_sessions
FOR EACH ROW
EXECUTE FUNCTION public.notify_video_call_started();
