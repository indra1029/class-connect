-- Fix 1: Restrict profiles to class members only (not public)
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Class members can view profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (
  id = auth.uid() OR
  EXISTS (
    SELECT 1 FROM class_members cm1
    JOIN class_members cm2 ON cm1.class_id = cm2.class_id
    WHERE cm1.user_id = auth.uid()
    AND cm2.user_id = profiles.id
  )
);

-- Fix 2: Create proper roles table with enum
CREATE TYPE public.app_role AS ENUM ('admin', 'member');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, class_id)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Migrate existing roles from class_members to user_roles
INSERT INTO public.user_roles (user_id, class_id, role)
SELECT user_id, class_id, 
  CASE 
    WHEN role = 'admin' THEN 'admin'::app_role
    ELSE 'member'::app_role
  END
FROM public.class_members;

-- Create security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_class_role(_user_id UUID, _class_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = _user_id
    AND class_id = _class_id
    AND role = _role
  )
$$;

-- RLS policies for user_roles table
CREATE POLICY "Users can view roles in their classes"
ON public.user_roles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM class_members
    WHERE class_members.class_id = user_roles.class_id
    AND class_members.user_id = auth.uid()
  )
);

-- Update RLS policies to use has_class_role function
DROP POLICY IF EXISTS "Class admins can create announcements" ON public.announcements;
CREATE POLICY "Class admins can create announcements"
ON public.announcements FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id 
  AND has_class_role(auth.uid(), class_id, 'admin')
);

DROP POLICY IF EXISTS "Class admins can delete announcements" ON public.announcements;
CREATE POLICY "Class admins can delete announcements"
ON public.announcements FOR DELETE
TO authenticated
USING (has_class_role(auth.uid(), class_id, 'admin'));

DROP POLICY IF EXISTS "Class admins can delete messages" ON public.messages;
CREATE POLICY "Class admins can delete messages"
ON public.messages FOR DELETE
TO authenticated
USING (has_class_role(auth.uid(), class_id, 'admin'));

DROP POLICY IF EXISTS "Class admins can update presentations" ON public.presentations;
CREATE POLICY "Class admins can update presentations"
ON public.presentations FOR UPDATE
TO authenticated
USING (has_class_role(auth.uid(), class_id, 'admin'));

DROP POLICY IF EXISTS "Class admins can upload presentations" ON public.presentations;
CREATE POLICY "Class admins can upload presentations"
ON public.presentations FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND has_class_role(auth.uid(), class_id, 'admin')
);

DROP POLICY IF EXISTS "Class admins can remove members" ON public.class_members;
CREATE POLICY "Class admins can remove members"
ON public.class_members FOR DELETE
TO authenticated
USING (
  has_class_role(auth.uid(), class_id, 'admin')
  AND auth.uid() <> user_id
);

-- Update add_creator_as_admin trigger to add to user_roles
CREATE OR REPLACE FUNCTION public.add_creator_as_admin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.class_members (class_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'admin');
  
  INSERT INTO public.user_roles (user_id, class_id, role)
  VALUES (NEW.created_by, NEW.id, 'admin');
  
  RETURN NEW;
END;
$$;