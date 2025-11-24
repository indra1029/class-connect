import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Users, MessageSquare, Building2, ShieldCheck, AlertCircle } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  const [isVerified, setIsVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [userCollege, setUserCollege] = useState<string | null>(null);

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
      checkVerification();
      fetchAdmins();
      fetchCollegeClasses();
    }
  }, [user]);

  const checkVerification = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("college_verified, college")
        .eq("id", user!.id)
        .single();

      if (error) throw error;
      setIsVerified(data.college_verified || false);
      setUserCollege(data.college);
    } catch (error: any) {
      console.error("Error checking verification:", error);
    }
  };

  const handleRequestVerification = async () => {
    setVerifying(true);
    try {
      const { data, error } = await supabase
        .rpc("request_college_verification", { _user_id: user!.id });

      if (error) throw error;

      if (data) {
        toast({
          title: "Verification Successful!",
          description: "Your college affiliation has been verified based on your email domain.",
        });
        setIsVerified(true);
        fetchAdmins();
        fetchCollegeClasses();
      } else {
        toast({
          variant: "destructive",
          title: "Verification Failed",
          description: "Your email domain does not match your college. Please ensure your email is from your college domain (e.g., @college.edu) and that your college name is correctly set in your profile.",
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    } finally {
      setVerifying(false);
    }
  };

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

  const handleOpenCollaborationHub = () => {
    navigate("/cr-group-chat");
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
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-3xl font-bold text-foreground">CR Network</h2>
              <p className="text-muted-foreground mt-1">
                Connect with other class representatives in your college
              </p>
            </div>
            <div className="flex items-center gap-3">
              {isVerified && (
                <>
                  <Button onClick={handleOpenCollaborationHub}>
                    <MessageSquare className="w-4 h-4 mr-2" />
                    CR Collaboration Hub
                  </Button>
                  <Badge variant="default" className="flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" />
                    Verified
                  </Badge>
                </>
              )}
            </div>
          </div>

          {!isVerified && (
            <Alert className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>College Verification Required</AlertTitle>
              <AlertDescription className="mt-2">
                <p className="mb-3">
                  To access the CR Network and protect the privacy of your college community, you need to verify your college affiliation. 
                  Verification is done automatically by matching your email domain with your college.
                </p>
                <div className="space-y-2 text-sm mb-4">
                  <p><strong>Requirements:</strong></p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Your college name must be set in your profile</li>
                    <li>Your email must be from your college domain (e.g., @{userCollege ? userCollege.toLowerCase().replace(/\s+/g, '') + '.edu' : 'college.edu'})</li>
                    <li>You must be a class creator (have created at least one class)</li>
                  </ul>
                </div>
                <Button onClick={handleRequestVerification} disabled={verifying}>
                  {verifying ? "Verifying..." : "Verify College Affiliation"}
                </Button>
              </AlertDescription>
            </Alert>
          )}
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
            {!isVerified ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <ShieldCheck className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <CardTitle className="mb-2">Verification Required</CardTitle>
                  <CardDescription>
                    Verify your college affiliation to access the CR directory
                  </CardDescription>
                </CardContent>
              </Card>
            ) : admins.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Users className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <CardTitle className="mb-2">No other CRs found</CardTitle>
                  <CardDescription>
                    No other verified class representatives from your college yet
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
                      <p className="text-sm text-muted-foreground text-center py-2">
                        Connect via CR Collaboration Hub
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="classes">
            {!isVerified ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <ShieldCheck className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <CardTitle className="mb-2">Verification Required</CardTitle>
                  <CardDescription>
                    Verify your college affiliation to view all college classes
                  </CardDescription>
                </CardContent>
              </Card>
            ) : classes.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Building2 className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <CardTitle className="mb-2">No classes found</CardTitle>
                  <CardDescription>
                    No classes from your college yet
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
