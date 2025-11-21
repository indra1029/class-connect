import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Megaphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface Announcement {
  id: string;
  title: string;
  content: string;
  created_at: string;
  user_id: string;
  profiles?: { full_name: string };
}

interface AnnouncementsProps {
  classId: string;
  isAdmin: boolean;
}

export const Announcements = ({ classId, isAdmin }: AnnouncementsProps) => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadAnnouncements();

    const channel = supabase
      .channel(`announcements-${classId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "announcements",
          filter: `class_id=eq.${classId}`,
        },
        () => loadAnnouncements()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [classId]);

  const loadAnnouncements = async () => {
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .eq("class_id", classId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load announcements");
      return;
    }

    const userIds = [...new Set(data?.map(a => a.user_id) || [])];
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds);

    const profilesMap = new Map(profilesData?.map(p => [p.id, p]));

    const announcementsWithProfiles = data?.map(announcement => ({
      ...announcement,
      profiles: profilesMap.get(announcement.user_id) || { full_name: "Unknown" }
    })) || [];

    setAnnouncements(announcementsWithProfiles);
  };

  const handleCreate = async () => {
    if (!title.trim() || !content.trim()) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("announcements").insert({
      class_id: classId,
      user_id: user.id,
      title: title.trim(),
      content: content.trim(),
    });

    if (error) {
      toast.error("Failed to create announcement");
      return;
    }

    toast.success("Announcement created");
    setTitle("");
    setContent("");
    setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from("announcements")
      .delete()
      .eq("id", id);

    if (error) {
      toast.error("Failed to delete announcement");
      return;
    }
    toast.success("Announcement deleted");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Megaphone className="w-5 h-5" />
          Announcements
        </h3>
        {isAdmin && (
          <Button onClick={() => setShowForm(!showForm)} size="sm">
            {showForm ? "Cancel" : "New Announcement"}
          </Button>
        )}
      </div>

      {showForm && isAdmin && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Input
              placeholder="Announcement Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              placeholder="Announcement Content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
            />
            <Button onClick={handleCreate} className="w-full">
              Post Announcement
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {announcements.map((announcement) => (
          <Card key={announcement.id}>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{announcement.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    By {announcement.profiles?.full_name} •{" "}
                    {format(new Date(announcement.created_at), "MMM dd, yyyy")}
                  </p>
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(announcement.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{announcement.content}</p>
            </CardContent>
          </Card>
        ))}
        {announcements.length === 0 && (
          <p className="text-center text-muted-foreground py-8">
            No announcements yet
          </p>
        )}
      </div>
    </div>
  );
};
