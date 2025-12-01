import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { FileText, Download, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ClassDocument {
  id: string;
  file_name: string;
  file_url: string;
  created_at: string;
  user_id: string;
  profiles?: {
    full_name: string;
  };
}

interface ClassDocumentsProps {
  classId: string;
}

export const ClassDocuments = ({ classId }: ClassDocumentsProps) => {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<ClassDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDocuments();
    subscribeToDocuments();
  }, [classId]);

  const fetchDocuments = async () => {
    try {
      const { data: messagesData, error: messagesError } = await supabase
        .from("messages")
        .select("id, file_url, file_name, created_at, user_id")
        .eq("class_id", classId)
        .not("file_url", "is", null)
        .order("created_at", { ascending: false });

      if (messagesError) throw messagesError;

      const { data: noticeData, error: noticeError } = await supabase
        .from("notice_board")
        .select("id, file_url, file_name, created_at, user_id")
        .eq("class_id", classId)
        .not("file_url", "is", null)
        .order("created_at", { ascending: false });

      if (noticeError) throw noticeError;

      const allDocs = [...(messagesData || []), ...(noticeData || [])];
      
      if (allDocs.length > 0) {
        const userIds = [...new Set(allDocs.map(doc => doc.user_id))];
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", userIds);

        if (profileError) throw profileError;

        const profileMap = new Map(profiles?.map(p => [p.id, p]));
        const docsWithProfiles = allDocs.map(doc => ({
          ...doc,
          profiles: profileMap.get(doc.user_id) || { full_name: "Unknown" }
        }));

        setDocuments(docsWithProfiles as ClassDocument[]);
      } else {
        setDocuments([]);
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const subscribeToDocuments = () => {
    const messagesChannel = supabase
      .channel(`messages_docs_${classId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `class_id=eq.${classId}`,
        },
        () => {
          fetchDocuments();
        }
      )
      .subscribe();

    const noticeChannel = supabase
      .channel(`notice_docs_${classId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notice_board",
          filter: `class_id=eq.${classId}`,
        },
        () => {
          fetchDocuments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(noticeChannel);
    };
  };

  const handleDownload = async (fileUrl: string, fileName: string) => {
    try {
      const response = await fetch(fileUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: "Document downloaded successfully",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Download Failed",
        description: error.message,
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FolderOpen className="w-5 h-5 text-primary" />
        <h3 className="text-lg font-semibold">Class Documents</h3>
      </div>

      {documents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <FolderOpen className="w-20 h-20 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No Documents</h3>
            <p className="text-muted-foreground max-w-sm mx-auto">
              Documents shared in messages and notices will appear here for easy access.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {documents.map((doc) => (
            <Card key={doc.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{doc.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      Shared by {doc.profiles?.full_name} • {new Date(doc.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownload(doc.file_url, doc.file_name!)}
                  >
                    <Download className="w-4 h-4 mr-1" />
                    Download
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
