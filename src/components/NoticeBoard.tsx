import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Pin, PinOff, Image as ImageIcon, FileText, Trash2, Upload } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { z } from "zod";

interface NoticeBoardItem {
  id: string;
  class_id: string;
  user_id: string;
  content: string;
  content_type: string;
  image_url: string | null;
  file_url: string | null;
  file_name: string | null;
  is_pinned: boolean;
  created_at: string;
  profiles?: {
    full_name: string;
    avatar_url: string | null;
  };
}

interface NoticeBoardProps {
  classId: string;
  isAdmin: boolean;
}

const noticeBoardSchema = z.object({
  content: z.string()
    .trim()
    .min(1, "Content required")
    .max(1000, "Content too long"),
  contentType: z.enum(["text", "image", "file"])
});

export const NoticeBoard = ({ classId, isAdmin }: NoticeBoardProps) => {
  const { toast } = useToast();
  const [items, setItems] = useState<NoticeBoardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ url: string; name: string; type: string } | null>(null);

  useEffect(() => {
    fetchNoticeBoard();
    subscribeToNoticeBoard();
  }, [classId]);

  const fetchNoticeBoard = async () => {
    try {
      const { data, error } = await supabase
        .from("notice_board")
        .select("*")
        .eq("class_id", classId)
        .eq("is_pinned", true)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Fetch profile data separately
      if (data && data.length > 0) {
        const userIds = [...new Set(data.map(item => item.user_id))];
        const { data: profiles, error: profileError } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", userIds);

        if (profileError) throw profileError;

        const profileMap = new Map(profiles?.map(p => [p.id, p]));
        const itemsWithProfiles = data.map(item => ({
          ...item,
          profiles: profileMap.get(item.user_id) || { full_name: "Unknown", avatar_url: null }
        }));

        setItems(itemsWithProfiles as NoticeBoardItem[]);
      } else {
        setItems([]);
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

  const subscribeToNoticeBoard = () => {
    const channel = supabase
      .channel(`notice_board_${classId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notice_board",
          filter: `class_id=eq.${classId}`,
        },
        () => {
          fetchNoticeBoard();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // File size validation (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        variant: "destructive",
        title: "File Too Large",
        description: "File size must be less than 5MB",
      });
      return;
    }

    setUploading(true);
    try {
      const fileExt = file.name.split(".").pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${classId}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("class-files")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("class-files")
        .getPublicUrl(filePath);

      const isImage = file.type.startsWith("image/");
      setUploadedFile({
        url: publicUrl,
        name: file.name,
        type: isImage ? "image" : "file",
      });

      toast({
        title: "Success",
        description: "File uploaded successfully",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: error.message,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleCreateNotice = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    try {
      const validated = noticeBoardSchema.parse({
        content: formData.get("content"),
        contentType: uploadedFile ? uploadedFile.type : "text",
      });

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;

      const insertData: any = {
        class_id: classId,
        user_id: userData.user.id,
        content: validated.content,
        content_type: validated.contentType,
        is_pinned: true,
      };

      if (uploadedFile) {
        if (uploadedFile.type === "image") {
          insertData.image_url = uploadedFile.url;
        } else {
          insertData.file_url = uploadedFile.url;
          insertData.file_name = uploadedFile.name;
        }
      }

      const { error } = await supabase
        .from("notice_board")
        .insert(insertData);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Notice pinned to board",
      });

      setDialogOpen(false);
      setUploadedFile(null);
      e.currentTarget.reset();
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        toast({
          variant: "destructive",
          title: "Validation Error",
          description: error.errors[0].message,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Error",
          description: error.message,
        });
      }
    }
  };

  const handleUnpin = async (itemId: string) => {
    try {
      const { error } = await supabase
        .from("notice_board")
        .update({ is_pinned: false })
        .eq("id", itemId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Notice unpinned",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleDelete = async (itemId: string) => {
    try {
      const { error } = await supabase
        .from("notice_board")
        .delete()
        .eq("id", itemId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Notice deleted",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Pin className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">Notice Board</h3>
        </div>
        {isAdmin && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Pin className="w-4 h-4 mr-2" />
                Pin Notice
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Pin Notice to Board</DialogTitle>
                <DialogDescription>
                  Add text, images, or files to the notice board
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateNotice} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="content">Content</Label>
                  <Textarea
                    id="content"
                    name="content"
                    placeholder="Enter notice content..."
                    rows={4}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="file">Attach Image or File (Optional)</Label>
                  <div className="flex gap-2">
                    <Input
                      id="file"
                      type="file"
                      onChange={handleFileUpload}
                      accept="image/*,.pdf,.doc,.docx,.ppt,.pptx"
                      disabled={uploading}
                    />
                    {uploading && <span className="text-sm text-muted-foreground">Uploading...</span>}
                  </div>
                  {uploadedFile && (
                    <p className="text-sm text-success">
                      ✓ {uploadedFile.name} uploaded
                    </p>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={uploading}>
                  Pin to Board
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Pin className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No pinned notices</p>
            {isAdmin && (
              <p className="text-sm text-muted-foreground mt-2">
                Pin important information for your class members
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="border-l-4 border-l-primary">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <Avatar className="w-8 h-8">
                      <AvatarImage src={item.profiles?.avatar_url || ""} />
                      <AvatarFallback>
                        {item.profiles?.full_name?.charAt(0).toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">
                        {item.profiles?.full_name || "Unknown"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(item.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {isAdmin && (
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleUnpin(item.id)}
                        title="Unpin"
                      >
                        <PinOff className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDelete(item.id)}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm whitespace-pre-wrap">{item.content}</p>
                
                {item.image_url && (
                  <div className="rounded-lg overflow-hidden border">
                    <img
                      src={item.image_url}
                      alt="Notice attachment"
                      className="w-full max-h-96 object-contain"
                    />
                  </div>
                )}
                
                {item.file_url && item.file_name && (
                  <a
                    href={item.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-3 bg-secondary rounded-lg hover:bg-secondary/80 transition-colors"
                  >
                    <FileText className="w-5 h-5 text-primary" />
                    <span className="text-sm font-medium">{item.file_name}</span>
                  </a>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};