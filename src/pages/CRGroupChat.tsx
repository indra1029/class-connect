import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, Paperclip, Download, Video } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import CRVideoConference from "@/components/CRVideoConference";
import { z } from "zod";

interface CRMessage {
  id: string;
  from_user_id: string;
  content: string;
  file_url: string | null;
  created_at: string;
  profiles: {
    full_name: string;
    avatar_url: string | null;
  };
}

const CRGroupChat = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<CRMessage[]>([]);
  const [crMembers, setCRMembers] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [activeVideoSession, setActiveVideoSession] = useState<string | null>(null);
  const [userCollege, setUserCollege] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
      }
    });
  }, [navigate]);

  useEffect(() => {
    if (user) {
      fetchUserCollege();
      fetchCRMembers();
      fetchMessages();
      subscribeToMessages();
      checkActiveVideoSession();
    }
  }, [user]);

  const fetchUserCollege = async () => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("verified_college")
        .eq("id", user!.id)
        .single();
      
      setUserCollege(data?.verified_college || null);
    } catch (error) {
      console.error("Error fetching user college:", error);
    }
  };

  const checkActiveVideoSession = async () => {
    try {
      const { data } = await supabase
        .from("cr_video_sessions")
        .select("id")
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (data) {
        setActiveVideoSession(data.id);
      }
    } catch (error) {
      console.error("Error checking video session:", error);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchCRMembers = async () => {
    try {
      const { data, error } = await supabase
        .rpc("get_college_admins", { _user_id: user!.id });

      if (error) throw error;
      setCRMembers(data || []);
    } catch (error: any) {
      console.error("Error fetching CR members:", error);
    }
  };

  const fetchMessages = async () => {
    try {
      // Get user's verified college
      const { data: profileData } = await supabase
        .from("profiles")
        .select("verified_college")
        .eq("id", user!.id)
        .single();

      if (!profileData?.verified_college) {
        setLoading(false);
        return;
      }

      // Fetch messages from all CRs in the same college
      const { data: messagesData, error: messagesError } = await supabase
        .from("admin_messages")
        .select("*")
        .order("created_at", { ascending: true });

      if (messagesError) throw messagesError;

      // Fetch all profiles for message senders
      const userIds = [...new Set(messagesData?.map(m => m.from_user_id) || [])];
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);

      // Create a map of profiles
      const profilesMap = new Map(
        profilesData?.map(p => [p.id, { full_name: p.full_name, avatar_url: p.avatar_url }]) || []
      );

      // Combine messages with profiles
      const messagesWithProfiles = messagesData?.map(msg => ({
        ...msg,
        profiles: profilesMap.get(msg.from_user_id) || { full_name: "Unknown User", avatar_url: null }
      })) || [];

      setMessages(messagesWithProfiles);
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

  const subscribeToMessages = () => {
    const messagesChannel = supabase
      .channel("cr-group-chat")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "admin_messages",
        },
        () => {
          fetchMessages();
        }
      )
      .subscribe();

    const videoChannel = supabase
      .channel("cr-video-sessions")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cr_video_sessions",
        },
        () => {
          checkActiveVideoSession();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(messagesChannel);
      supabase.removeChannel(videoChannel);
    };
  };

  const startVideoMeeting = async () => {
    try {
      if (!userCollege) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "College information not found",
        });
        return;
      }

      const { data, error } = await supabase
        .from("cr_video_sessions")
        .insert({
          college: userCollege,
          started_by: user!.id,
          session_name: "CR Network Meeting",
        })
        .select()
        .single();

      if (error) throw error;

      setActiveVideoSession(data.id);
      toast({
        title: "Video Meeting Started",
        description: "Other CRs have been notified",
      });
    } catch (error: any) {
      console.error("Error starting video meeting:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to start video meeting",
      });
    }
  };

  const joinVideoMeeting = () => {
    if (activeVideoSession) {
      // Video conference will handle joining
    }
  };

  const messageSchema = z.object({
    content: z.string()
      .trim()
      .min(1, "Message cannot be empty")
      .max(2000, "Message is too long (max 2000 characters)")
  });

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newMessage.trim()) return;

    try {
      const validated = messageSchema.parse({ content: newMessage });

      // Broadcast to all CRs by using a special group indicator
      const { error } = await supabase
        .from("admin_messages")
        .insert({
          from_user_id: user!.id,
          to_user_id: user!.id, // Group messages use same user ID
          content: validated.content,
        });

      if (error) throw error;

      setNewMessage("");
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

  const fileSchema = z.object({
    name: z.string().max(255, "Filename is too long"),
    size: z.number().max(50 * 1024 * 1024, "File size must be less than 50MB"),
    type: z.string().regex(/^[a-zA-Z0-9\/\-\+\.]+$/, "Invalid file type")
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // Validate file
      fileSchema.parse({
        name: file.name,
        size: file.size,
        type: file.type
      });

      const fileExt = file.name.split(".").pop();
      const fileName = `cr-files/${user!.id}-${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from("class-files")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("class-files")
        .getPublicUrl(fileName);

      const { error: insertError } = await supabase
        .from("admin_messages")
        .insert({
          from_user_id: user!.id,
          to_user_id: user!.id, // Group messages
          content: `Shared a file: ${file.name}`,
          file_url: publicUrl,
        });

      if (insertError) throw insertError;

      toast({
        title: "Success",
        description: "File uploaded successfully",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (activeVideoSession) {
    return (
      <CRVideoConference
        sessionId={activeVideoSession}
        user={user!}
        onClose={() => setActiveVideoSession(null)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate("/admin-directory")}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back
            </Button>
            <div>
              <p className="font-semibold text-lg">CR Collaboration Hub</p>
              <p className="text-xs text-muted-foreground">
                {crMembers.length + 1} Class Representatives
              </p>
            </div>
          </div>
          <Badge variant="default" className="hidden md:flex">Group Chat</Badge>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 flex flex-col max-w-5xl">
        <Card className="flex-1 flex flex-col">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between">
              <CardTitle>CR Network - Collaboration Space</CardTitle>
              {activeVideoSession ? (
                <Button variant="default" size="sm" onClick={joinVideoMeeting}>
                  <Video className="w-4 h-4 mr-2" />
                  Join Video Meeting
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={startVideoMeeting}>
                  <Video className="w-4 h-4 mr-2" />
                  Start Video Meeting
                </Button>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Connect, collaborate, and share resources with other Class Representatives from your college
            </p>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col p-0">
            <ScrollArea className="flex-1 px-4">
              <div className="space-y-4 py-4">
                {messages.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-muted-foreground mb-2">
                      Welcome to the CR Collaboration Hub! 🎓
                    </p>
                    <p className="text-sm text-muted-foreground">
                      This is a shared space for all Class Representatives in your college to collaborate.
                    </p>
                  </div>
                ) : (
                  messages.map((message) => (
                    <div key={message.id} className="flex gap-3">
                      <Avatar className="w-8 h-8 mt-1">
                        <AvatarImage src={message.profiles?.avatar_url || ""} />
                        <AvatarFallback className="bg-gradient-hero text-white text-xs">
                          {message.profiles?.full_name?.charAt(0).toUpperCase() || "U"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-sm">
                            {message.profiles?.full_name || "Unknown User"}
                          </p>
                          {message.from_user_id === user?.id && (
                            <Badge variant="secondary" className="text-xs">You</Badge>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {new Date(message.created_at).toLocaleTimeString([], { 
                              hour: '2-digit', 
                              minute: '2-digit' 
                            })}
                          </p>
                        </div>
                        <div className="bg-muted rounded-lg px-4 py-2">
                          <p className="text-sm">{message.content}</p>
                          {message.file_url && (
                            <a
                              href={message.file_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 mt-2 text-xs text-primary hover:underline"
                            >
                              <Download className="w-3 h-3" />
                              Download File
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="border-t p-4 bg-card/50">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileUpload}
                  className="hidden"
                  accept="*/*"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Attach file"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Share your thoughts with fellow CRs..."
                  disabled={uploading}
                  className="flex-1"
                />
                <Button type="submit" disabled={!newMessage.trim() || uploading}>
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default CRGroupChat;
