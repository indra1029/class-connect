-- Make the class-files bucket private
UPDATE storage.buckets 
SET public = false 
WHERE id = 'class-files';

-- Drop any existing permissive policies on class-files bucket
DROP POLICY IF EXISTS "Class members can upload class files" ON storage.objects;
DROP POLICY IF EXISTS "Class members can view class files" ON storage.objects;
DROP POLICY IF EXISTS "Class members can update class files" ON storage.objects;
DROP POLICY IF EXISTS "Class members can delete class files" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to class-files" ON storage.objects;

-- Create secure storage policies for class-files bucket
-- Policy for viewing files (only class members can access their class files)
CREATE POLICY "Class members can view class files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'class-files'
  AND EXISTS (
    SELECT 1 FROM class_members
    WHERE class_members.user_id = auth.uid()
    AND (storage.foldername(name))[1] = class_members.class_id::text
  )
);

-- Policy for uploading files (only class members can upload to their class folder)
CREATE POLICY "Class members can upload class files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'class-files'
  AND EXISTS (
    SELECT 1 FROM class_members
    WHERE class_members.user_id = auth.uid()
    AND (storage.foldername(name))[1] = class_members.class_id::text
  )
);

-- Policy for updating files (only class admins can update files)
CREATE POLICY "Class admins can update class files"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'class-files'
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND (storage.foldername(name))[1] = user_roles.class_id::text
    AND user_roles.role = 'admin'
  )
);

-- Policy for deleting files (only class admins can delete files)
CREATE POLICY "Class admins can delete class files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'class-files'
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND (storage.foldername(name))[1] = user_roles.class_id::text
    AND user_roles.role = 'admin'
  )
);