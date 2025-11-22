import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Users, MessageSquare, Building2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Admin {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  college: string;
  class_count: number;
}

interface CollegeClass {
  class_id: string;
  class_name: string;
  description: string | null;
  created_by: string;
  creator_name: string;
  member_count: number;
  created_at: string;
}

const AdminDirectory = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [classes, setClasses] = useState<CollegeClass[]>([]);
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
      fetchAdmins();
      fetchCollegeClasses();
    }
  }, [user]);

  const fetchAdmins = async () => {
    try {
      const { data, error } = await supabase
        .rpc("get_college_admins", { _user_id: user!.id });

      if (error) throw error;
      setAdmins(data || []);
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

  const fetchCollegeClasses = async () => {
    try {
      const { data, error } = await supabase
        .rpc("get_college_classes", { _user_id: user!.id });

      if (error) throw error;
      setClasses(data || []);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleSendMessageRequest = async (toUserId: string) => {
    try {
      const { error } = await supabase
        .from("admin_messages")
        .insert({
          from_user_id: user!.id,
          to_user_id: toUserId,
          content: "Hi! I'd like to connect with you as a class representative.",
        });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Message sent to CR",
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

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-foreground">CR Network</h2>
          <p className="text-muted-foreground mt-1">
            Connect with other class representatives in your college
          </p>
        </div>

        <Tabs defaultValue="admins" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="admins" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Class Representatives
            </TabsTrigger>
            <TabsTrigger value="classes" className="flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              All College Classes
            </TabsTrigger>
          </TabsList>

          <TabsContent value="admins">
            {admins.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Users className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <CardTitle className="mb-2">No other CRs found</CardTitle>
                  <CardDescription>
                    Make sure you and other CRs have set your college name in your profile
                  </CardDescription>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {admins.map((admin) => (
                  <Card key={admin.user_id} className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-12 h-12">
                            <AvatarImage src={admin.avatar_url || ""} />
                            <AvatarFallback className="bg-gradient-hero text-white">
                              {admin.full_name.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <CardTitle className="text-lg">{admin.full_name}</CardTitle>
                            <CardDescription>{admin.college}</CardDescription>
                          </div>
                        </div>
                        <Badge variant="secondary">
                          {admin.class_count} {admin.class_count === 1 ? "Class" : "Classes"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Button
                        className="w-full"
                        onClick={() => handleSendMessageRequest(admin.user_id)}
                      >
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Send Message
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="classes">
            {classes.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Building2 className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <CardTitle className="mb-2">No classes found</CardTitle>
                  <CardDescription>
                    Classes will appear here once CRs set their college name
                  </CardDescription>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {classes.map((cls) => (
                  <Card key={cls.class_id} className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle>{cls.class_name}</CardTitle>
                          <CardDescription className="mt-1">
                            {cls.description || "No description"}
                          </CardDescription>
                          <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Users className="w-4 h-4" />
                              {cls.member_count} members
                            </span>
                            <span>Created by {cls.creator_name}</span>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AdminDirectory;
