-- Create function to find class by invite code (bypasses RLS)
CREATE OR REPLACE FUNCTION public.get_class_by_invite_code(_invite_code text)
RETURNS TABLE (class_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.classes WHERE invite_code = _invite_code LIMIT 1;
$$;

-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info',
  read boolean DEFAULT false,
  link text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- Create trigger to send notification when message request is received
CREATE OR REPLACE FUNCTION public.notify_message_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    NEW.to_user_id,
    'New Message Request',
    'Someone wants to chat with you',
    'message_request',
    '/messages'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_message_request_created
  AFTER INSERT ON public.message_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_message_request();

-- Create trigger to send notification when private message is received
CREATE OR REPLACE FUNCTION public.notify_private_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, message, type, link)
  VALUES (
    NEW.to_user_id,
    'New Private Message',
    'You have a new message',
    'private_message',
    '/chat/' || NEW.from_user_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_private_message_created
  AFTER INSERT ON public.private_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_private_message();

-- Create analytics view for class statistics
CREATE OR REPLACE VIEW public.class_analytics AS
SELECT 
  c.id as class_id,
  c.name as class_name,
  c.created_at,
  COUNT(DISTINCT cm.user_id) as member_count,
  COUNT(DISTINCT m.id) as message_count,
  MAX(m.created_at) as last_message_at
FROM public.classes c
LEFT JOIN public.class_members cm ON c.id = cm.class_id
LEFT JOIN public.messages m ON c.id = m.class_id
GROUP BY c.id, c.name, c.created_at;