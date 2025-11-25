-- First, update existing classes to have college value from creator's profile
UPDATE classes c
SET college = p.college
FROM profiles p
WHERE c.created_by = p.id AND c.college IS NULL AND p.college IS NOT NULL;

-- Create notice_board table for pinned content
CREATE TABLE IF NOT EXISTS public.notice_board (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  image_url TEXT,
  file_url TEXT,
  file_name TEXT,
  is_pinned BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notice_board ENABLE ROW LEVEL SECURITY;

-- RLS policies for notice_board
CREATE POLICY "Class members can view notice board items"
  ON public.notice_board
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM class_members
      WHERE class_members.class_id = notice_board.class_id
      AND class_members.user_id = auth.uid()
    )
  );

CREATE POLICY "Class admins can create notice board items"
  ON public.notice_board
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id 
    AND EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.class_id = notice_board.class_id
      AND user_roles.role = 'admin'
    )
  );

CREATE POLICY "Class admins can update notice board items"
  ON public.notice_board
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.class_id = notice_board.class_id
      AND user_roles.role = 'admin'
    )
  );

CREATE POLICY "Class admins can delete notice board items"
  ON public.notice_board
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_roles
      WHERE user_roles.user_id = auth.uid()
      AND user_roles.class_id = notice_board.class_id
      AND user_roles.role = 'admin'
    )
  );

-- Enable realtime for notice_board
ALTER PUBLICATION supabase_realtime ADD TABLE public.notice_board;

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_notice_board_updated_at
  BEFORE UPDATE ON public.notice_board
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Create index for faster queries
CREATE INDEX idx_notice_board_class_id ON notice_board(class_id);
CREATE INDEX idx_notice_board_is_pinned ON notice_board(is_pinned, class_id);