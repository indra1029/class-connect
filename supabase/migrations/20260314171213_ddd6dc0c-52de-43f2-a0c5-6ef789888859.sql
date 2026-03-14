-- Allow any class member to update video_call_sessions (needed for marking stale sessions inactive)
DROP POLICY IF EXISTS "Call starters can update sessions" ON public.video_call_sessions;

CREATE POLICY "Class members can update call sessions"
ON public.video_call_sessions
FOR UPDATE
TO authenticated
USING (is_class_member(auth.uid(), class_id))
WITH CHECK (is_class_member(auth.uid(), class_id));

-- Similarly for CR video sessions - allow any verified CR to update sessions in their college
DROP POLICY IF EXISTS "Session creators can update their sessions" ON public.cr_video_sessions;

CREATE POLICY "Verified CRs can update sessions in their college"
ON public.cr_video_sessions
FOR UPDATE
TO public
USING (EXISTS (
  SELECT 1 FROM profiles
  WHERE profiles.id = auth.uid()
  AND profiles.college_verified = true
  AND profiles.verified_college = cr_video_sessions.college
));