import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserPlus, Trash2, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

interface ClassMember {
  id: string;
  user_id: string;
  role: string;
  profiles: {
    full_name: string;
    avatar_url: string | null;
  };
}

interface ClassMembersProps {
  classId: string;
  user: User;
  isAdmin: boolean;
}

export const ClassMembers = ({ classId, user, isAdmin }: ClassMembersProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMembers();
    subscribeToMembers();
  }, [classId]);

  const fetchMembers = async () => {
    try {
      const { data: membersData, error } = await supabase
        .from("class_members")
        .select("*")
        .eq("class_id", classId);

      if (error) throw error;

      const userIds = [...new Set(membersData?.map(m => m.user_id) || [])];
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);

      const profilesMap = new Map(profilesData?.map(p => [p.id, p]));

      const membersWithProfiles = membersData?.map(member => ({
        ...member,
        profiles: profilesMap.get(member.user_id) || { full_name: "Unknown", avatar_url: null }
      })) || [];

      setMembers(membersWithProfiles);
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

  const subscribeToMembers = () => {
    const channel = supabase
      .channel("class_members_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "class_members",
          filter: `class_id=eq.${classId}`,
        },
        () => {
          fetchMembers();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleRemoveMember = async (memberId: string, memberUserId: string) => {
    if (memberUserId === user.id) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You cannot remove yourself",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("class_members")
        .delete()
        .eq("id", memberId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Member removed from class",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleSendRequest = async (toUserId: string) => {
    if (toUserId === user.id) return;

    try {
      // First check if a request already exists (in either direction)
      const { data: existingRequest } = await supabase
        .from("message_requests")
        .select("id, status, from_user_id, to_user_id")
        .or(`and(from_user_id.eq.${user.id},to_user_id.eq.${toUserId}),and(from_user_id.eq.${toUserId},to_user_id.eq.${user.id})`)
        .maybeSingle();

      if (existingRequest) {
        if (existingRequest.status === "accepted") {
          // Already connected - navigate directly to chat
          toast({
            title: "Already Connected",
            description: "Opening chat...",
          });
          navigate(`/chat/${toUserId}`);
          return;
        } else if (existingRequest.status === "pending") {
          toast({
            title: "Request Pending",
            description: existingRequest.to_user_id === user.id 
              ? "Check your Messages to accept this request" 
              : "Waiting for them to accept your request",
          });
          return;
        } else {
          // Rejected - allow new request
        }
      }

      const { error } = await supabase
        .from("message_requests")
        .insert({
          from_user_id: user.id,
          to_user_id: toUserId,
        });

      if (error) {
        if (error.code === "23505") {
          // Duplicate key - check status and navigate if accepted
          const { data: checkRequest } = await supabase
            .from("message_requests")
            .select("status")
            .or(`and(from_user_id.eq.${user.id},to_user_id.eq.${toUserId}),and(from_user_id.eq.${toUserId},to_user_id.eq.${user.id})`)
            .eq("status", "accepted")
            .maybeSingle();

          if (checkRequest) {
            navigate(`/chat/${toUserId}`);
          } else {
            toast({
              title: "Info",
              description: "Request already sent. Check your Messages.",
            });
          }
        } else {
          throw error;
        }
      } else {
        toast({
          title: "Success",
          description: "Request sent!",
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

  if (loading) {
    return <div className="text-center py-4">Loading members...</div>;
  }

  return (
    <Card className="h-fit max-h-[60vh] sm:max-h-none overflow-hidden flex flex-col">
      <CardHeader className="py-3 sm:py-4 px-3 sm:px-4 shrink-0">
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <UserPlus className="w-4 h-4 sm:w-5 sm:h-5" />
          Class Members ({members.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 sm:space-y-2 overflow-y-auto px-3 sm:px-4 pb-3 sm:pb-4">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between p-2 sm:p-3 rounded-lg bg-muted/50 gap-2"
          >
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <Avatar className="w-8 h-8 sm:w-10 sm:h-10 shrink-0">
                <AvatarImage src={member.profiles.avatar_url || ""} />
                <AvatarFallback className="bg-gradient-hero text-white text-xs sm:text-sm">
                  {member.profiles.full_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-medium text-sm sm:text-base truncate">{member.profiles.full_name}</p>
                {member.role === "admin" && (
                  <Badge variant="secondary" className="text-[10px] sm:text-xs px-1.5 py-0">Admin</Badge>
                )}
              </div>
            </div>
            <div className="flex gap-1 sm:gap-2 shrink-0">
              {member.user_id !== user.id && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSendRequest(member.user_id)}
                  className="h-7 w-7 sm:h-8 sm:w-8 p-0"
                >
                  <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Button>
              )}
              {isAdmin && member.user_id !== user.id && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleRemoveMember(member.id, member.user_id)}
                  className="h-7 w-7 sm:h-8 sm:w-8 p-0"
                >
                  <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};