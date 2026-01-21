import { useState } from "react";
import { getSignedFileUrl } from "@/lib/storage";
import { FileText, Download, Loader2 } from "lucide-react";

interface SecureFileLinkProps {
  fileUrl: string;
  fileName: string;
  className?: string;
}

/**
 * A component that provides a secure download link for files in a private Supabase storage bucket.
 * It generates a signed URL when clicked for secure access.
 */
export const SecureFileLink = ({ fileUrl, fileName, className }: SecureFileLinkProps) => {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const signedUrl = await getSignedFileUrl(fileUrl, 3600); // 1 hour
      window.open(signedUrl, '_blank');
    } catch (err) {
      console.error("Failed to get signed URL:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className={`flex items-center gap-3 p-4 bg-primary/5 border-2 border-primary/20 rounded-xl hover:bg-primary/10 hover:border-primary/30 transition-all group w-full text-left ${className}`}
    >
      <div className="p-2 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
        <FileText className="w-6 h-6 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">
          {fileName}
        </p>
        <p className="text-xs text-muted-foreground">
          {loading ? "Preparing download..." : "Click to open or download"}
        </p>
      </div>
      {loading ? (
        <Loader2 className="w-5 h-5 text-primary animate-spin" />
      ) : (
        <Download className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
      )}
    </button>
  );
};
