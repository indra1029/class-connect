import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, Users, Copy, Check, Paperclip, Trash2, UserCircle, Video, Smile, MessageSquare, Megaphone, Presentation, BarChart3, Calendar as CalendarIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ClassMembers } from "@/components/ClassMembers";
import VideoCall from "@/components/VideoCall";
import MultiUserVideoCall from "@/components/MultiUserVideoCall";
import EmojiPicker from "@/components/EmojiPicker";
import { Announcements } from "@/components/Announcements";
import { PresentationViewer } from "@/components/PresentationViewer";
import { Polls } from "@/components/Polls";
import { ClassCalendar } from "@/components/ClassCalendar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { z } from "zod";

interface Message {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  file_url: string | null;
  file_type: string | null;
  file_name: string | null;
  profiles: {
    full_name: string;
    avatar_url: string | null;
  };
}

interface ClassData {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
}

const ClassRoom = () => {
  const { classId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [classData, setClassData] = useState<ClassData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showVideoCall, setShowVideoCall] = useState(false);
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
    if (user && classId) {
      fetchClassData();
      fetchMessages();
      subscribeToMessages();
      checkAdminStatus();
    }
  }, [user, classId]);

  const checkAdminStatus = async () => {
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("class_id", classId)
        .eq("user_id", user!.id)
        .single();

      if (error) throw error;
      setIsAdmin(data.role === "admin");
    } catch (error: any) {
      console.error("Error checking admin status:", error);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const fetchClassData = async () => {
    try {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .eq("id", classId)
        .single();

      if (error) throw error;
      setClassData(data);
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

  const fetchMessages = async () => {
    try {
      const { data: messagesData, error: messagesError } = await supabase
        .from("messages")
        .select("*")
        .eq("class_id", classId)
        .order("created_at", { ascending: true });

      if (messagesError) throw messagesError;

      // Fetch profiles for all messages
      const userIds = [...new Set(messagesData?.map(m => m.user_id) || [])];
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);

      const profilesMap = new Map(profilesData?.map(p => [p.id, p]));

      const messagesWithProfiles = messagesData?.map(msg => ({
        ...msg,
        profiles: profilesMap.get(msg.user_id) || { full_name: "Unknown User", avatar_url: null }
      })) || [];

      setMessages(messagesWithProfiles);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const subscribeToMessages = () => {
    const channel = supabase
      .channel("messages")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `class_id=eq.${classId}`,
        },
        async (payload) => {
          const { data: profileData } = await supabase
            .from("profiles")
            .select("full_name, avatar_url")
            .eq("id", payload.new.user_id)
            .single();

          const newMsg = {
            ...payload.new,
            profiles: profileData || { full_name: "Unknown", avatar_url: null },
          } as Message;

          setMessages((prev) => [...prev, newMsg]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
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

      const { error } = await supabase
        .from("messages")
        .insert({
          class_id: classId,
          user_id: user!.id,
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
    try {
      if (!e.target.files || e.target.files.length === 0) return;

      const file = e.target.files[0];

      // Validate file
      fileSchema.parse({
        name: file.name,
        size: file.size,
        type: file.type
      });

      const fileExt = file.name.split(".").pop()?.toLowerCase();
      const fileName = `${classId}/${user!.id}/${Math.random()}.${fileExt}`;

      // Check if it's a presentation file
      const presentationTypes = ['pdf', 'ppt', 'pptx', 'doc', 'docx'];
      const isPresentationFile = presentationTypes.includes(fileExt || '');

      const { error: uploadError } = await supabase.storage
        .from("class-files")
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("class-files").getPublicUrl(fileName);

      if (isPresentationFile) {
        // Add to presentations table for admin
        const { error: presentationError } = await supabase
          .from("presentations")
          .insert({
            class_id: classId,
            user_id: user!.id,
            file_url: data.publicUrl,
            file_name: file.name,
            is_active: false,
          });

        if (presentationError) throw presentationError;

        toast({
          title: "Success",
          description: "Presentation uploaded to Presentations tab",
        });
      } else {
        // Regular file - add to messages
        const { error } = await supabase
          .from("messages")
          .insert({
            class_id: classId,
            user_id: user!.id,
            content: file.name,
            file_url: data.publicUrl,
            file_type: file.type,
            file_name: file.name,
          });

        if (error) throw error;

        toast({
          title: "Success",
          description: "File uploaded",
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("id", messageId);

      if (error) throw error;

      setMessages(messages.filter(m => m.id !== messageId));
      toast({
        title: "Success",
        description: "Message deleted",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const copyInviteCode = () => {
    if (classData) {
      navigator.clipboard.writeText(classData.invite_code);
      setCopied(true);
      toast({
        title: "Copied!",
        description: "Invite code copied to clipboard",
      });
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10 shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div>
                <h1 className="text-xl font-bold text-foreground">{classData?.name}</h1>
                {classData?.description && (
                  <p className="text-sm text-muted-foreground">{classData.description}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowVideoCall(true)}>
                <Video className="w-4 h-4 mr-2" />
                Call
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowMembers(!showMembers)}>
                <Users className="w-4 h-4 mr-2" />
                Members
              </Button>
              <Button variant="outline" size="sm" onClick={copyInviteCode}>
                {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {classData?.invite_code}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6 flex gap-6">
        {showMembers && (
          <div className="w-80 flex-shrink-0">
            <ClassMembers classId={classId!} user={user!} isAdmin={isAdmin} />
          </div>
        )}
        
        <div className="flex-1 flex flex-col max-w-6xl">
          <Tabs defaultValue="chat" className="flex-1 flex flex-col">
            <TabsList className="grid w-full grid-cols-5 mb-4">
              <TabsTrigger value="chat" className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="announcements" className="flex items-center gap-2">
                <Megaphone className="w-4 h-4" />
                Announcements
              </TabsTrigger>
              <TabsTrigger value="presentations" className="flex items-center gap-2">
                <Presentation className="w-4 h-4" />
                Presentations
              </TabsTrigger>
              <TabsTrigger value="polls" className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Polls
              </TabsTrigger>
              <TabsTrigger value="calendar" className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4" />
                Calendar
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chat" className="flex-1 flex flex-col mt-0">
              <div className="flex-1 overflow-y-auto mb-4 space-y-4">
          {messages.length === 0 ? (
            <Card className="text-center py-12">
              <CardContent>
                <Users className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                <CardTitle className="mb-2">No messages yet</CardTitle>
                <CardDescription>
                  Be the first to send a message in this class!
                </CardDescription>
              </CardContent>
            </Card>
          ) : (
            messages.map((message) => {
              const isOwn = message.user_id === user?.id;
              return (
                <div
                  key={message.id}
                  className={`flex gap-3 ${isOwn ? "flex-row-reverse" : ""} group`}
                >
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    <AvatarImage src={message.profiles.avatar_url || ""} />
                    <AvatarFallback className="bg-gradient-hero text-white text-xs">
                      {message.profiles.full_name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className={`flex flex-col ${isOwn ? "items-end" : ""} max-w-[70%]`}>
                    <span className="text-xs text-muted-foreground mb-1">
                      {message.profiles.full_name}
                    </span>
                    <div className="relative">
                      <div
                        className={`rounded-2xl px-4 py-2 ${
                          isOwn
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground"
                        }`}
                      >
                        {message.file_url ? (
                          <a
                            href={message.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline flex items-center gap-2"
                          >
                            <Paperclip className="w-4 h-4" />
                            {message.file_name || message.content}
                          </a>
                        ) : (
                          <p className="text-sm break-words">{message.content}</p>
                        )}
                      </div>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="absolute -right-10 top-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleDeleteMessage(message.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground mt-1">
                      {new Date(message.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
              );
            })
          )}
                <div ref={messagesEndRef} />
              </div>

              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                <EmojiPicker onEmojiSelect={(emoji) => setNewMessage((prev) => prev + emoji)}>
                  <Button type="button" size="icon" variant="outline">
                    <Smile className="w-4 h-4" />
                  </Button>
                </EmojiPicker>
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1"
                />
                <Button type="submit" size="icon">
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="announcements" className="flex-1 overflow-y-auto">
              <Announcements classId={classId!} isAdmin={isAdmin} />
            </TabsContent>

            <TabsContent value="presentations" className="flex-1 overflow-y-auto">
              <PresentationViewer classId={classId!} isAdmin={isAdmin} />
            </TabsContent>

            <TabsContent value="polls" className="flex-1 overflow-y-auto">
              <Polls classId={classId!} />
            </TabsContent>

            <TabsContent value="calendar" className="flex-1 overflow-y-auto">
              <ClassCalendar classId={classId!} />
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {showVideoCall && user && (
        <MultiUserVideoCall 
          classId={classId!} 
          userId={user.id} 
          onClose={() => setShowVideoCall(false)}
        />
      )}
    </div>
  );
};

export default ClassRoom;
