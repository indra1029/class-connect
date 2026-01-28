import { supabase } from "@/integrations/supabase/client";

/**
 * Generate a signed URL for accessing a file from the class-files bucket.
 * Falls back to the original URL if it's not a storage path.
 * 
 * @param fileUrlOrPath - Either a full public URL (legacy) or a storage path
 * @param expiresInSeconds - How long the URL should be valid (default: 1 hour)
 * @returns Promise with signed URL or the original URL if not applicable
 */
export const getSignedFileUrl = async (
  fileUrlOrPath: string,
  expiresInSeconds: number = 3600
): Promise<string> => {
  // If it's empty, return as-is
  if (!fileUrlOrPath) return fileUrlOrPath;
  
  // Check if this is a Supabase storage URL
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  
  // Extract the file path from various URL formats
  let filePath = fileUrlOrPath;
  
  // Handle full Supabase public URLs (legacy format)
  if (fileUrlOrPath.includes('/storage/v1/object/public/class-files/')) {
    filePath = fileUrlOrPath.split('/storage/v1/object/public/class-files/')[1];
  }
  // Handle Supabase storage path format
  else if (fileUrlOrPath.startsWith('class-files/')) {
    filePath = fileUrlOrPath.replace('class-files/', '');
  }
  // If it's already a signed URL (contains token parameter), return as-is
  else if (fileUrlOrPath.includes('/storage/v1/object/sign/') || fileUrlOrPath.includes('token=')) {
    return fileUrlOrPath;
  }
  // Handle external URLs (http/https that are not from our Supabase)
  else if ((fileUrlOrPath.startsWith('http://') || fileUrlOrPath.startsWith('https://')) && !fileUrlOrPath.includes(supabaseUrl)) {
    return fileUrlOrPath;
  }
  // Handle data URLs
  else if (fileUrlOrPath.startsWith('data:')) {
    return fileUrlOrPath;
  }
  // Handle blob URLs
  else if (fileUrlOrPath.startsWith('blob:')) {
    return fileUrlOrPath;
  }
  // For relative paths that look like storage paths (e.g., "classId/filename.png"),
  // we assume they are storage paths and try to create a signed URL
  
  // Decode the path in case it was URL encoded
  filePath = decodeURIComponent(filePath);
  
  try {
    const { data, error } = await supabase.storage
      .from('class-files')
      .createSignedUrl(filePath, expiresInSeconds);
    
    if (error) {
      console.error('Error creating signed URL:', error);
      // Return original URL as fallback
      return fileUrlOrPath;
    }
    
    return data.signedUrl;
  } catch (err) {
    console.error('Error in getSignedFileUrl:', err);
    return fileUrlOrPath;
  }
};

/**
 * Upload a file to class-files bucket and return the storage path
 * @param file - File to upload
 * @param classId - Class ID for folder organization
 * @returns Storage path (not URL)
 */
export const uploadClassFile = async (
  file: File,
  classId: string
): Promise<{ path: string; error: Error | null }> => {
  const fileExt = file.name.split('.').pop();
  const fileName = `${Date.now()}.${fileExt}`;
  const filePath = `${classId}/${fileName}`;

  const { error } = await supabase.storage
    .from('class-files')
    .upload(filePath, file);

  if (error) {
    return { path: '', error: error as Error };
  }

  // Return just the path, not the full URL
  return { path: filePath, error: null };
};

/**
 * Check if a URL is an internal application path (for security validation)
 */
export const isInternalLink = (link: string): boolean => {
  if (!link) return false;
  
  // Allow relative paths starting with / or #
  if (link.startsWith('/') || link.startsWith('#')) {
    return true;
  }
  
  // Block all other URLs (including javascript:, data:, http:, https:, etc.)
  return false;
};
