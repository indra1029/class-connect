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
      const { error } = await supabase
        .from("message_requests")
        .insert({
          from_user_id: user.id,
          to_user_id: toUserId,
        });

      if (error) {
        if (error.code === "23505") {
          toast({
            title: "Info",
            description: "Request already exists",
          });
        } else {
          throw error;
        }
      } else {
        toast({
          title: "Success",
          description: "Request sent",
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="w-5 h-5" />
          Class Members ({members.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
          >
            <div className="flex items-center gap-3">
              <Avatar>
                <AvatarImage src={member.profiles.avatar_url || ""} />
                <AvatarFallback className="bg-gradient-hero text-white">
                  {member.profiles.full_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{member.profiles.full_name}</p>
                {member.role === "admin" && (
                  <Badge variant="secondary" className="text-xs">Admin</Badge>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {member.user_id !== user.id && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleSendRequest(member.user_id)}
                >
                  <MessageSquare className="w-4 h-4" />
                </Button>
              )}
              {isAdmin && member.user_id !== user.id && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleRemoveMember(member.id, member.user_id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};