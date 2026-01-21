import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Eye, EyeOff, X } from "lucide-react";
import { toast } from "sonner";
import { getSignedFileUrl } from "@/lib/storage";

interface Presentation {
  id: string;
  file_url: string;
  file_name: string;
  is_active: boolean;
  user_id: string;
}

interface PresentationViewerProps {
  classId: string;
  isAdmin: boolean;
}

export const PresentationViewer = ({ classId, isAdmin }: PresentationViewerProps) => {
  const [presentations, setPresentations] = useState<Presentation[]>([]);
  const [activePresentation, setActivePresentation] = useState<Presentation | null>(null);
  const [activePresentationUrl, setActivePresentationUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Generate signed URL for active presentation
  const loadSignedUrl = useCallback(async (presentation: Presentation | null) => {
    if (!presentation) {
      setActivePresentationUrl(null);
      return;
    }
    
    try {
      const signedUrl = await getSignedFileUrl(presentation.file_url, 7200); // 2 hour expiry
      setActivePresentationUrl(signedUrl);
    } catch (error) {
      console.error('Failed to get signed URL:', error);
      setActivePresentationUrl(null);
    }
  }, []);

  useEffect(() => {
    loadPresentations();

    const channel = supabase
      .channel(`presentations-${classId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "presentations",
          filter: `class_id=eq.${classId}`,
        },
        () => loadPresentations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [classId]);

  // Load signed URL when active presentation changes
  useEffect(() => {
    loadSignedUrl(activePresentation);
  }, [activePresentation, loadSignedUrl]);

  const loadPresentations = async () => {
    const { data, error } = await supabase
      .from("presentations")
      .select("*")
      .eq("class_id", classId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load presentations");
      return;
    }
    setPresentations(data || []);
    const active = data?.find((p) => p.is_active);
    setActivePresentation(active || null);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = [
      "application/pdf",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ];

    if (!allowedTypes.includes(file.type)) {
      toast.error("Please upload PDF or PPT files only");
      return;
    }

    setUploading(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const fileExt = file.name.split(".").pop();
    const fileName = `${Math.random()}.${fileExt}`;
    const filePath = `${classId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("class-files")
      .upload(filePath, file);

    if (uploadError) {
      toast.error("Failed to upload file");
      setUploading(false);
      return;
    }

    // Store the file path (not public URL) for later signed URL generation
    const { error: dbError } = await supabase.from("presentations").insert({
      class_id: classId,
      user_id: user.id,
      file_url: filePath, // Store path, not URL
      file_name: file.name,
      is_active: false,
    });

    if (dbError) {
      toast.error("Failed to save presentation");
      setUploading(false);
      return;
    }

    toast.success("Presentation uploaded");
    setUploading(false);
    e.target.value = "";
  };

  const handleDownload = async (fileUrl: string) => {
    try {
      const signedUrl = await getSignedFileUrl(fileUrl);
      window.open(signedUrl, '_blank');
    } catch (error) {
      toast.error("Failed to download file");
    }
  };

  const togglePresentation = async (presentation: Presentation) => {
    if (!isAdmin) return;

    const newActiveState = !presentation.is_active;

    if (newActiveState) {
      await supabase
        .from("presentations")
        .update({ is_active: false })
        .eq("class_id", classId);
    }

    const { error } = await supabase
      .from("presentations")
      .update({ is_active: newActiveState })
      .eq("id", presentation.id);

    if (error) {
      toast.error("Failed to update presentation");
      return;
    }

    toast.success(newActiveState ? "Presentation is now visible to all" : "Presentation hidden");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Presentations</h3>
        {isAdmin && (
          <Button
            onClick={() => document.getElementById("presentation-upload")?.click()}
            disabled={uploading}
            size="sm"
          >
            <Upload className="w-4 h-4 mr-2" />
            Upload PPT/PDF
          </Button>
        )}
        <input
          id="presentation-upload"
          type="file"
          className="hidden"
          accept=".pdf,.ppt,.pptx"
          onChange={handleUpload}
        />
      </div>

      {activePresentation && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>📽️ Currently Presenting</span>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => togglePresentation(activePresentation)}
                >
                  <EyeOff className="w-4 h-4" />
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative w-full h-[600px] bg-muted rounded-lg overflow-hidden">
              {activePresentationUrl ? (
                activePresentation.file_name.toLowerCase().endsWith('.pdf') ? (
                  <object
                    data={activePresentationUrl}
                    type="application/pdf"
                    className="w-full h-full"
                  >
                    <embed
                      src={`${activePresentationUrl}#toolbar=1&navpanes=1&scrollbar=1`}
                      type="application/pdf"
                      className="w-full h-full"
                    />
                  </object>
                ) : (
                  // Note: PPT files with signed URLs won't work with Office Online viewer
                  // because the signed URL is too long and expires
                  <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <p className="text-muted-foreground mb-4">
                      PowerPoint preview not available for secured files.
                    </p>
                    <Button onClick={() => handleDownload(activePresentation.file_url)}>
                      Download to View
                    </Button>
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-between mt-2">
              <p className="text-sm text-muted-foreground">
                {activePresentation.file_name}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownload(activePresentation.file_url)}
              >
                Download
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isAdmin && presentations.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Uploaded Presentations</h4>
          {presentations.map((presentation) => (
            <Card key={presentation.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <span className="text-sm">{presentation.file_name}</span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => togglePresentation(presentation)}
                  >
                    {presentation.is_active ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
