import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Send, Users, Copy, Check, Paperclip, Trash2, UserCircle, Video, Smile, MessageSquare, Megaphone, Presentation, BarChart3, Calendar as CalendarIcon, Pin } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ClassMembers } from "@/components/ClassMembers";
import VideoCall from "@/components/VideoCall";
import MultiUserVideoCall from "@/components/MultiUserVideoCall";
import EmojiPicker from "@/components/EmojiPicker";
import { Announcements } from "@/components/Announcements";
import { PresentationViewer } from "@/components/PresentationViewer";
import { Polls } from "@/components/Polls";
import { ClassCalendar } from "@/components/ClassCalendar";
import { ClassDocuments } from "@/components/ClassDocuments";
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
  const [searchParams, setSearchParams] = useSearchParams();
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

  // Handle join call from notification
  useEffect(() => {
    const joinCallId = searchParams.get('joinCall');
    if (joinCallId && user) {
      // Check if call is still active
      supabase
        .from("video_call_sessions")
        .select("is_active")
        .eq("id", joinCallId)
        .eq("class_id", classId)
        .single()
        .then(({ data }) => {
          if (data?.is_active) {
            setShowVideoCall(true);
            toast({
              title: "Joining call...",
              description: "Connecting to video call",
            });
          } else {
            toast({
              variant: "destructive",
              title: "Call ended",
              description: "This video call has already ended",
            });
          }
          // Clear the joinCall param
          searchParams.delete('joinCall');
          setSearchParams(searchParams);
        });
    }
  }, [searchParams, user, classId]);

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
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10 shadow-sm safe-area-top">
        <div className="container mx-auto px-2 sm:px-4 py-2">
          <div className="flex items-center justify-between gap-1.5">
            {/* Left: Back button and class info */}
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 flex-1">
              <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")} className="shrink-0 h-8 w-8 p-0 sm:w-auto sm:px-3">
                <ArrowLeft className="w-4 h-4" />
                <span className="hidden sm:inline ml-1">Back</span>
              </Button>
              <div className="min-w-0 flex-1">
                <h1 className="text-sm sm:text-lg font-bold text-foreground truncate">{classData?.name}</h1>
                {classData?.description && (
                  <p className="text-xs text-muted-foreground truncate hidden sm:block">{classData.description}</p>
                )}
              </div>
            </div>
            
            {/* Right: Action buttons - horizontal scroll on mobile */}
            <div className="flex items-center gap-1 shrink-0">
              <Button 
                variant={showVideoCall ? "default" : "outline"} 
                size="sm" 
                onClick={() => setShowVideoCall(true)} 
                className="h-8 px-2 text-xs"
              >
                <Video className="w-4 h-4" />
                <span className="ml-1">Call</span>
              </Button>
              <Button 
                variant={showMembers ? "default" : "outline"} 
                size="sm" 
                onClick={() => setShowMembers(!showMembers)} 
                className="h-8 px-2 text-xs"
              >
                <Users className="w-4 h-4" />
                <span className="ml-1 hidden sm:inline">Members</span>
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={copyInviteCode} 
                className="h-8 px-2 text-xs font-mono"
                title={classData?.invite_code}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span className="ml-1 hidden md:inline">{classData?.invite_code}</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-2 sm:px-4 py-2 sm:py-6 flex flex-col sm:flex-row gap-2 sm:gap-6 overflow-hidden">
        {showMembers && (
          <div className="w-full sm:w-72 md:w-80 shrink-0 order-first sm:order-none max-h-[40vh] sm:max-h-none overflow-auto">
            <ClassMembers classId={classId!} user={user!} isAdmin={isAdmin} />
          </div>
        )}
        
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <Tabs defaultValue="chat" className="flex-1 flex flex-col min-h-0">
            {/* Scrollable tabs container */}
            <div className="overflow-x-auto mb-2 sm:mb-4 pb-1 scrollbar-hide shrink-0 -mx-2 px-2">
              <TabsList className="inline-flex w-max gap-1 bg-muted/50 p-1 rounded-lg">
                <TabsTrigger value="chat" className="flex items-center gap-1 px-3 py-2 text-xs rounded-md whitespace-nowrap data-[state=active]:bg-background">
                  <MessageSquare className="w-4 h-4" />
                  <span>Chat</span>
                </TabsTrigger>
                <TabsTrigger value="announcements" className="flex items-center gap-1 px-3 py-2 text-xs rounded-md whitespace-nowrap data-[state=active]:bg-background">
                  <Megaphone className="w-4 h-4" />
                  <span>Announce</span>
                </TabsTrigger>
                <TabsTrigger value="presentations" className="flex items-center gap-1 px-3 py-2 text-xs rounded-md whitespace-nowrap data-[state=active]:bg-background">
                  <Presentation className="w-4 h-4" />
                  <span>Present</span>
                </TabsTrigger>
                <TabsTrigger value="polls" className="flex items-center gap-1 px-3 py-2 text-xs rounded-md whitespace-nowrap data-[state=active]:bg-background">
                  <BarChart3 className="w-4 h-4" />
                  <span>Polls</span>
                </TabsTrigger>
                <TabsTrigger value="calendar" className="flex items-center gap-1 px-3 py-2 text-xs rounded-md whitespace-nowrap data-[state=active]:bg-background">
                  <CalendarIcon className="w-4 h-4" />
                  <span>Calendar</span>
                </TabsTrigger>
                <TabsTrigger value="documents" className="flex items-center gap-1 px-3 py-2 text-xs rounded-md whitespace-nowrap data-[state=active]:bg-background">
                  <Paperclip className="w-4 h-4" />
                  <span>Docs</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="chat" className="flex-1 flex flex-col mt-0 min-h-0">
              <div className="flex-1 overflow-y-auto mb-3 sm:mb-4 space-y-3 sm:space-y-4">
                {messages.length === 0 ? (
                  <Card className="text-center py-8 sm:py-12">
                    <CardContent>
                      <Users className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-3 sm:mb-4 text-muted-foreground" />
                      <CardTitle className="mb-2 text-base sm:text-xl">No messages yet</CardTitle>
                      <CardDescription className="text-xs sm:text-sm">
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
                        className={`flex gap-2 sm:gap-3 ${isOwn ? "flex-row-reverse" : ""} group`}
                      >
                        <Avatar className="w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0">
                          <AvatarImage src={message.profiles.avatar_url || ""} />
                          <AvatarFallback className="bg-gradient-hero text-white text-[10px] sm:text-xs">
                            {message.profiles.full_name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className={`flex flex-col ${isOwn ? "items-end" : ""} max-w-[75%] sm:max-w-[70%]`}>
                          <span className="text-[10px] sm:text-xs text-muted-foreground mb-0.5 sm:mb-1">
                            {message.profiles.full_name}
                          </span>
                          <div className="relative">
                            <div
                              className={`rounded-xl sm:rounded-2xl px-3 sm:px-4 py-1.5 sm:py-2 ${
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
                                  className="underline flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm"
                                >
                                  <Paperclip className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                                  <span className="truncate max-w-[150px] sm:max-w-none">
                                    {message.file_name || message.content}
                                  </span>
                                </a>
                              ) : (
                                <p className="text-xs sm:text-sm break-words">{message.content}</p>
                              )}
                            </div>
                            {isAdmin && (
                              <Button
                                size="sm"
                                variant="destructive"
                                className="absolute -right-8 sm:-right-10 top-0 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 sm:h-8 sm:w-8 p-0"
                                onClick={() => handleDeleteMessage(message.id)}
                              >
                                <Trash2 className="w-3 h-3 sm:w-4 sm:h-4" />
                              </Button>
                            )}
                          </div>
                          <span className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 sm:mt-1">
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

              <form onSubmit={handleSendMessage} className="flex gap-1.5 sm:gap-2 shrink-0">
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
                  className="h-9 w-9 sm:h-10 sm:w-10 shrink-0"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                <EmojiPicker onEmojiSelect={(emoji) => setNewMessage((prev) => prev + emoji)}>
                  <Button type="button" size="icon" variant="outline" className="h-9 w-9 sm:h-10 sm:w-10 shrink-0">
                    <Smile className="w-4 h-4" />
                  </Button>
                </EmojiPicker>
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 h-9 sm:h-10 text-sm"
                />
                <Button type="submit" size="icon" className="h-9 w-9 sm:h-10 sm:w-10 shrink-0">
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

            <TabsContent value="documents" className="flex-1 overflow-y-auto">
              <ClassDocuments classId={classId!} isAdmin={isAdmin} />
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
