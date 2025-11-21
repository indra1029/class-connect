-- Create announcements table
CREATE TABLE public.announcements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create presentations table
CREATE TABLE public.presentations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create polls table
CREATE TABLE public.polls (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  question TEXT NOT NULL,
  options JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE
);

-- Create poll_responses table
CREATE TABLE public.poll_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  poll_id UUID NOT NULL REFERENCES public.polls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  option_index INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(poll_id, user_id)
);

-- Create calendar_events table
CREATE TABLE public.calendar_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  event_date TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies for announcements
CREATE POLICY "Users can view announcements in their classes"
  ON public.announcements FOR SELECT
  USING (is_class_member(auth.uid(), class_id));

CREATE POLICY "Class admins can create announcements"
  ON public.announcements FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.class_members
      WHERE class_id = announcements.class_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
  );

CREATE POLICY "Class admins can delete announcements"
  ON public.announcements FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.class_members
      WHERE class_id = announcements.class_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
  );

-- RLS Policies for presentations
CREATE POLICY "Users can view presentations in their classes"
  ON public.presentations FOR SELECT
  USING (is_class_member(auth.uid(), class_id));

CREATE POLICY "Class admins can upload presentations"
  ON public.presentations FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.class_members
      WHERE class_id = presentations.class_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
  );

CREATE POLICY "Class admins can update presentations"
  ON public.presentations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.class_members
      WHERE class_id = presentations.class_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
  );

-- RLS Policies for polls
CREATE POLICY "Users can view polls in their classes"
  ON public.polls FOR SELECT
  USING (is_class_member(auth.uid(), class_id));

CREATE POLICY "Class members can create polls"
  ON public.polls FOR INSERT
  WITH CHECK (auth.uid() = user_id AND is_class_member(auth.uid(), class_id));

-- RLS Policies for poll_responses
CREATE POLICY "Users can view poll responses in their classes"
  ON public.poll_responses FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.polls
      WHERE polls.id = poll_responses.poll_id
        AND is_class_member(auth.uid(), polls.class_id)
    )
  );

CREATE POLICY "Users can submit poll responses"
  ON public.poll_responses FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.polls
      WHERE polls.id = poll_responses.poll_id
        AND is_class_member(auth.uid(), polls.class_id)
    )
  );

-- RLS Policies for calendar_events
CREATE POLICY "Users can view calendar events in their classes"
  ON public.calendar_events FOR SELECT
  USING (is_class_member(auth.uid(), class_id));

CREATE POLICY "Class members can create calendar events"
  ON public.calendar_events FOR INSERT
  WITH CHECK (auth.uid() = user_id AND is_class_member(auth.uid(), class_id));

CREATE POLICY "Event creators can update their events"
  ON public.calendar_events FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Event creators can delete their events"
  ON public.calendar_events FOR DELETE
  USING (auth.uid() = user_id);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
ALTER PUBLICATION supabase_realtime ADD TABLE public.presentations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.polls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poll_responses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events;

-- Function to notify about calendar events
CREATE OR REPLACE FUNCTION public.notify_calendar_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_record RECORD;
BEGIN
  FOR member_record IN 
    SELECT user_id FROM public.class_members 
    WHERE class_id = NEW.class_id AND user_id != NEW.user_id
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      member_record.user_id,
      'New Calendar Event',
      NEW.title || ' - ' || to_char(NEW.event_date, 'Mon DD, YYYY at HH24:MI'),
      'calendar_event',
      '/class/' || NEW.class_id
    );
  END LOOP;
  RETURN NEW;
END;
$$;

-- Trigger for calendar event notifications
CREATE TRIGGER notify_calendar_event_trigger
  AFTER INSERT ON public.calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_calendar_event();

-- Function to notify about announcements
CREATE OR REPLACE FUNCTION public.notify_announcement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member_record RECORD;
BEGIN
  FOR member_record IN 
    SELECT user_id FROM public.class_members 
    WHERE class_id = NEW.class_id AND user_id != NEW.user_id
  LOOP
    INSERT INTO public.notifications (user_id, title, message, type, link)
    VALUES (
      member_record.user_id,
      'New Announcement',
      NEW.title,
      'announcement',
      '/class/' || NEW.class_id
    );
  END LOOP;
  RETURN NEW;
END;
$$;

-- Trigger for announcement notifications
CREATE TRIGGER notify_announcement_trigger
  AFTER INSERT ON public.announcements
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_announcement();