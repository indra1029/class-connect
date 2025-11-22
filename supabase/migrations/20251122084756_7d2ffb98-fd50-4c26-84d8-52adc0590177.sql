-- Add college verification fields to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS verified_college TEXT,
ADD COLUMN IF NOT EXISTS college_verified BOOLEAN DEFAULT FALSE;

-- Create function to extract email domain
CREATE OR REPLACE FUNCTION public.get_user_email_domain(_user_id uuid)
RETURNS TEXT
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT LOWER(SPLIT_PART(email, '@', 2))
  FROM auth.users
  WHERE id = _user_id;
$$;

-- Create function to verify college affiliation based on email domain
CREATE OR REPLACE FUNCTION public.verify_college_affiliation(_user_id uuid)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_email_domain TEXT;
  user_college TEXT;
  expected_domain TEXT;
BEGIN
  -- Get user's email domain
  SELECT get_user_email_domain(_user_id) INTO user_email_domain;
  
  -- Get user's claimed college
  SELECT college INTO user_college FROM profiles WHERE id = _user_id;
  
  IF user_college IS NULL OR user_email_domain IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Extract expected domain from college name
  -- Convert "Harvard University" to "harvard.edu"
  -- Convert "MIT" to "mit.edu"
  expected_domain := LOWER(
    REGEXP_REPLACE(
      REGEXP_REPLACE(user_college, '\s+(University|College|Institute)$', '', 'i'),
      '\s+', '', 'g'
    )
  ) || '.edu';
  
  -- Check if email domain matches expected college domain
  -- Also accept common variations like college.ac.in, college.edu.in
  RETURN (
    user_email_domain = expected_domain OR
    user_email_domain LIKE '%.' || expected_domain OR
    user_email_domain LIKE expected_domain || '%'
  );
END;
$$;

-- Update get_college_admins to require verification
CREATE OR REPLACE FUNCTION public.get_college_admins(_user_id uuid)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  avatar_url text,
  college text,
  class_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
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
  WHERE 
    -- Only show if requesting user is verified
    (SELECT college_verified FROM profiles WHERE id = _user_id) = TRUE
    -- And matches requester's verified college
    AND p.college = (SELECT verified_college FROM profiles WHERE id = _user_id)
    AND p.college IS NOT NULL
    AND p.id != _user_id
    -- And target user is also verified (optional but recommended)
    AND p.college_verified = TRUE
  GROUP BY p.id, p.full_name, p.avatar_url, p.college;
$$;

-- Update get_college_classes to require verification
CREATE OR REPLACE FUNCTION public.get_college_classes(_user_id uuid)
RETURNS TABLE(
  class_id uuid,
  class_name text,
  description text,
  created_by uuid,
  creator_name text,
  member_count bigint,
  created_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
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
  WHERE 
    -- Only show if requesting user is verified
    (SELECT college_verified FROM profiles WHERE id = _user_id) = TRUE
    -- And matches requester's verified college
    AND c.college = (SELECT verified_college FROM profiles WHERE id = _user_id)
    AND c.college IS NOT NULL
    -- Only show to class creators
    AND EXISTS (
      SELECT 1 FROM classes WHERE created_by = _user_id
    )
  GROUP BY c.id, c.name, c.description, c.created_by, p.full_name, c.created_at
  ORDER BY c.created_at DESC;
$$;

-- Create function for users to request verification
CREATE OR REPLACE FUNCTION public.request_college_verification(_user_id uuid)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_verified BOOLEAN;
  user_college TEXT;
BEGIN
  -- Check if email domain matches college
  is_verified := verify_college_affiliation(_user_id);
  
  IF is_verified THEN
    -- Get the college from profile
    SELECT college INTO user_college FROM profiles WHERE id = _user_id;
    
    -- Update verification status
    UPDATE profiles
    SET 
      college_verified = TRUE,
      verified_college = user_college
    WHERE id = _user_id;
    
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$;