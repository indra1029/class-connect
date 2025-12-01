-- Create document categories table
CREATE TABLE IF NOT EXISTS public.document_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(class_id, name)
);

-- Enable RLS
ALTER TABLE public.document_categories ENABLE ROW LEVEL SECURITY;

-- RLS Policies for document_categories
CREATE POLICY "Class members can view categories"
  ON public.document_categories
  FOR SELECT
  USING (is_class_member(auth.uid(), class_id));

CREATE POLICY "Class admins can create categories"
  ON public.document_categories
  FOR INSERT
  WITH CHECK (
    auth.uid() = created_by 
    AND has_class_role(auth.uid(), class_id, 'admin'::app_role)
  );

CREATE POLICY "Class admins can update categories"
  ON public.document_categories
  FOR UPDATE
  USING (has_class_role(auth.uid(), class_id, 'admin'::app_role));

CREATE POLICY "Class admins can delete categories"
  ON public.document_categories
  FOR DELETE
  USING (has_class_role(auth.uid(), class_id, 'admin'::app_role));

-- Add category_id to messages table
ALTER TABLE public.messages 
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.document_categories(id) ON DELETE SET NULL;

-- Add category_id to notice_board table
ALTER TABLE public.notice_board
ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.document_categories(id) ON DELETE SET NULL;