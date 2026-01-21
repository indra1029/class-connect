import { useState, useEffect } from "react";
import { getSignedFileUrl } from "@/lib/storage";

interface SecureImageProps {
  src: string;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
}

/**
 * A component that displays an image from a private Supabase storage bucket.
 * It automatically generates a signed URL for secure access.
 */
export const SecureImage = ({ src, alt, className, loading = "lazy" }: SecureImageProps) => {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const loadUrl = async () => {
      if (!src) {
        setSignedUrl(null);
        return;
      }
      
      try {
        const url = await getSignedFileUrl(src, 3600); // 1 hour
        setSignedUrl(url);
        setError(false);
      } catch (err) {
        console.error("Failed to load secure image:", err);
        setError(true);
      }
    };

    loadUrl();
  }, [src]);

  if (error) {
    return (
      <div className={`flex items-center justify-center bg-muted ${className}`}>
        <span className="text-muted-foreground text-sm">Image unavailable</span>
      </div>
    );
  }

  if (!signedUrl) {
    return (
      <div className={`flex items-center justify-center bg-muted animate-pulse ${className}`}>
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <img
      src={signedUrl}
      alt={alt}
      className={className}
      loading={loading}
    />
  );
};
