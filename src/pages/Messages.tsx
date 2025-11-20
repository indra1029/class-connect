import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, MessageSquare, UserPlus, Check, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

interface MessageRequest {
  id: string;
  from_user_id: string;
  to_user_id: string;
  status: string;
  created_at: string;
  from_profile?: {
    full_name: string;
    avatar_url: string | null;
  };
  to_profile?: {
    full_name: string;
    avatar_url: string | null;
  };
}

interface Contact {
  id: string;
  full_name: string;
  avatar_url: string | null;
}

const Messages = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [requests, setRequests] = useState<MessageRequest[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

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
      fetchRequests();
      fetchContacts();
      subscribeToRequests();
    }
  }, [user]);

  const fetchRequests = async () => {
    try {
      const { data, error } = await supabase
        .from("message_requests")
        .select("*")
        .or(`from_user_id.eq.${user!.id},to_user_id.eq.${user!.id}`)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const userIds = [...new Set(data?.flatMap(r => [r.from_user_id, r.to_user_id]) || [])];
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);

      const profilesMap = new Map(profilesData?.map(p => [p.id, p]));

      const requestsWithProfiles = data?.map(req => ({
        ...req,
        from_profile: profilesMap.get(req.from_user_id),
        to_profile: profilesMap.get(req.to_user_id)
      })) || [];

      setRequests(requestsWithProfiles);
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

  const fetchContacts = async () => {
    try {
      const { data, error } = await supabase
        .from("message_requests")
        .select("*")
        .or(`from_user_id.eq.${user!.id},to_user_id.eq.${user!.id}`)
        .eq("status", "accepted");

      if (error) throw error;

      const contactIds = data?.map(r => 
        r.from_user_id === user!.id ? r.to_user_id : r.from_user_id
      ) || [];

      if (contactIds.length === 0) {
        setContacts([]);
        return;
      }

      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", contactIds);

      setContacts(profilesData || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const subscribeToRequests = () => {
    const channel = supabase
      .channel("message_requests")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "message_requests",
        },
        () => {
          fetchRequests();
          fetchContacts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleAcceptRequest = async (requestId: string) => {
    try {
      const { error } = await supabase
        .from("message_requests")
        .update({ status: "accepted" })
        .eq("id", requestId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Request accepted",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      const { error } = await supabase
        .from("message_requests")
        .update({ status: "rejected" })
        .eq("id", requestId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Request rejected",
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const pendingRequests = requests.filter(r => r.to_user_id === user?.id && r.status === "pending");

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-6">
        {pendingRequests.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="w-5 h-5" />
                Pending Requests
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {pendingRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={request.from_profile?.avatar_url || ""} />
                      <AvatarFallback className="bg-gradient-hero text-white">
                        {request.from_profile?.full_name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{request.from_profile?.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        Wants to connect with you
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleAcceptRequest(request.id)}
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRejectRequest(request.id)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              Your Contacts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {contacts.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No contacts yet. Send a request from a class member!
              </p>
            ) : (
              <div className="space-y-2">
                {contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/chat/${contact.id}`)}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={contact.avatar_url || ""} />
                        <AvatarFallback className="bg-gradient-hero text-white">
                          {contact.full_name.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <p className="font-medium">{contact.full_name}</p>
                    </div>
                    <Badge variant="outline">Chat</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Messages;