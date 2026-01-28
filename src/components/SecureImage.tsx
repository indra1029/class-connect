import { useMemo, useState, useEffect } from "react";
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
  const [retryCount, setRetryCount] = useState(0);

  const normalizedSrc = useMemo(() => (src || "").trim(), [src]);

  useEffect(() => {
    const loadUrl = async () => {
      if (!normalizedSrc) {
        setSignedUrl(null);
        return;
      }
      
      try {
        const url = await getSignedFileUrl(normalizedSrc, 3600); // 1 hour
        setSignedUrl(url);
        setError(false);
      } catch (err) {
        console.error("Failed to load secure image:", err);
        setError(true);
      }
    };

    loadUrl();
  }, [normalizedSrc, retryCount]);

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
      onError={() => {
        // If the signed URL expired or was blocked transiently, try re-sign once.
        if (retryCount < 1) {
          setRetryCount((c) => c + 1);
          setSignedUrl(null);
          return;
        }
        setError(true);
      }}
    />
  );
};
