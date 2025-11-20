-- Fix infinite recursion in class_members RLS by creating security definer function
CREATE OR REPLACE FUNCTION public.is_class_member(_user_id uuid, _class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.class_members
    WHERE user_id = _user_id
      AND class_id = _class_id
  )
$$;

-- Drop existing problematic policy
DROP POLICY IF EXISTS "Users can view members of their classes" ON public.class_members;

-- Recreate policy using security definer function
CREATE POLICY "Users can view members of their classes"
ON public.class_members
FOR SELECT
USING (public.is_class_member(auth.uid(), class_id));

-- Drop existing class viewing policy
DROP POLICY IF EXISTS "Users can view classes they are members of" ON public.classes;

-- Recreate class viewing policy using security definer function
CREATE POLICY "Users can view classes they are members of"
ON public.classes
FOR SELECT
USING (public.is_class_member(auth.uid(), id));

-- Drop existing messages viewing policy
DROP POLICY IF EXISTS "Users can view messages from their classes" ON public.messages;

-- Recreate messages viewing policy using security definer function
CREATE POLICY "Users can view messages from their classes"
ON public.messages
FOR SELECT
USING (public.is_class_member(auth.uid(), class_id));

-- Drop existing messages insert policy
DROP POLICY IF EXISTS "Users can send messages to their classes" ON public.messages;

-- Recreate messages insert policy using security definer function
CREATE POLICY "Users can send messages to their classes"
ON public.messages
FOR INSERT
WITH CHECK (
  auth.uid() = user_id 
  AND public.is_class_member(auth.uid(), class_id)
);

-- Create storage buckets for file sharing
INSERT INTO storage.buckets (id, name, public)
VALUES ('class-files', 'class-files', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('private-messages', 'private-messages', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for class files
CREATE POLICY "Class members can upload files"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'class-files'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Class members can view class files"
ON storage.objects
FOR SELECT
USING (bucket_id = 'class-files');

CREATE POLICY "Users can delete their own class files"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'class-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Storage policies for avatars
CREATE POLICY "Users can upload their own avatar"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Avatars are publicly viewable"
ON storage.objects
FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Users can update their own avatar"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Storage policies for private messages
CREATE POLICY "Users can upload files to private messages"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'private-messages'
  AND auth.role() = 'authenticated'
);

CREATE POLICY "Users can view their own private message files"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'private-messages'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Create table for private message requests
CREATE TABLE IF NOT EXISTS public.message_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(from_user_id, to_user_id)
);

ALTER TABLE public.message_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own requests"
ON public.message_requests
FOR SELECT
USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

CREATE POLICY "Users can create requests"
ON public.message_requests
FOR INSERT
WITH CHECK (auth.uid() = from_user_id);

CREATE POLICY "Users can update requests they received"
ON public.message_requests
FOR UPDATE
USING (auth.uid() = to_user_id);

-- Trigger for message_requests updated_at
CREATE TRIGGER update_message_requests_updated_at
BEFORE UPDATE ON public.message_requests
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Create table for private messages
CREATE TABLE IF NOT EXISTS public.private_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  file_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.private_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own private messages"
ON public.private_messages
FOR SELECT
USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

CREATE POLICY "Users can send private messages to accepted contacts"
ON public.private_messages
FOR INSERT
WITH CHECK (
  auth.uid() = from_user_id
  AND EXISTS (
    SELECT 1 FROM public.message_requests
    WHERE (
      (from_user_id = auth.uid() AND to_user_id = private_messages.to_user_id)
      OR (to_user_id = auth.uid() AND from_user_id = private_messages.to_user_id)
    )
    AND status = 'accepted'
  )
);

-- Add file_url column to messages table for class file sharing
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_type text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS file_name text;

-- Enable realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.private_messages;

-- Add policy for class admins to delete messages
CREATE POLICY "Class admins can delete messages"
ON public.messages
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.class_members
    WHERE class_id = messages.class_id
      AND user_id = auth.uid()
      AND role = 'admin'
  )
);

-- Add policy for class admins to remove members
CREATE POLICY "Class admins can remove members"
ON public.class_members
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.class_members cm
    WHERE cm.class_id = class_members.class_id
      AND cm.user_id = auth.uid()
      AND cm.role = 'admin'
  )
  AND auth.uid() != class_members.user_id
);