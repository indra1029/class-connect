import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { GraduationCap, LogOut, Plus, Users, MessageSquare, UserCircle, BarChart3, Network } from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
import { NoticeBoard } from "@/components/NoticeBoard";
import { z } from "zod";

interface Class {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  created_at: string;
}

const Dashboard = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [classes, setClasses] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [joinDialogOpen, setJoinDialogOpen] = useState(false);
  const [isClassCreator, setIsClassCreator] = useState(false);
  const [hasCreatedClass, setHasCreatedClass] = useState(false);
  const [isMemberOfAnyClass, setIsMemberOfAnyClass] = useState(false);
  const [userClassId, setUserClassId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (!session) {
        navigate("/auth");
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (user) {
      fetchClasses();
      checkIfClassCreator();
    }
  }, [user]);

  const checkIfClassCreator = async () => {
    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "admin")
        .limit(1);
      
      if (error) throw error;
      setIsClassCreator(data && data.length > 0);
    } catch (error) {
      console.error("Error checking creator status:", error);
    }
  };

  const fetchClasses = async () => {
    try {
      const { data, error } = await supabase
        .from("classes")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setClasses(data || []);

      // Check if current user has created a class
      if (user) {
        const { data: createdClasses } = await supabase
          .from("classes")
          .select("id")
          .eq("created_by", user.id);
        
        setHasCreatedClass(createdClasses && createdClasses.length > 0);

        // Check if user is a member of any class
        const { data: membershipData } = await supabase
          .from("class_members")
          .select("id, class_id, role")
          .eq("user_id", user.id)
          .limit(1);
        
        setIsMemberOfAnyClass(membershipData && membershipData.length > 0);
        
        if (membershipData && membershipData.length > 0) {
          setUserClassId(membershipData[0].class_id);
          setIsAdmin(membershipData[0].role === 'admin');
        }
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

  const createClassSchema = z.object({
    name: z.string()
      .trim()
      .min(1, "Class name required")
      .max(100, "Class name too long")
      .regex(/^[a-zA-Z0-9\s\-&.]+$/, "Only letters, numbers, spaces, hyphens, ampersands and periods allowed"),
    description: z.string()
      .trim()
      .max(500, "Description too long")
      .optional()
  });

  const handleCreateClass = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    try {
      // Check if user has already created a class
      const { data: existingClasses, error: checkError } = await supabase
        .from("classes")
        .select("id")
        .eq("created_by", user!.id);

      if (checkError) throw checkError;

      if (existingClasses && existingClasses.length > 0) {
        toast({
          variant: "destructive",
          title: "Limit Reached",
          description: "You can only create one class. You've already created a class.",
        });
        return;
      }

      const validated = createClassSchema.parse({
        name: formData.get("name"),
        description: formData.get("description") || ""
      });

      // Get user's college
      const { data: profileData } = await supabase
        .from("profiles")
        .select("college")
        .eq("id", user!.id)
        .single();

      const { error } = await supabase
        .from("classes")
        .insert({ 
          name: validated.name, 
          description: validated.description, 
          created_by: user!.id,
          college: profileData?.college 
        });

      if (error) throw error;

      toast({
        title: "Success!",
        description: "Class created successfully.",
      });
      
      setCreateDialogOpen(false);
      fetchClasses();
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

  const handleJoinClass = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const inviteCode = formData.get("inviteCode") as string;

    try {
      const { data: classData, error: classError } = await supabase
        .rpc("get_class_by_invite_code", { _invite_code: inviteCode });

      if (classError || !classData || classData.length === 0) {
        throw new Error("Invalid invite code");
      }

      const classId = classData[0].class_id;

      const { error: memberError } = await supabase
        .from("class_members")
        .insert({ class_id: classId, user_id: user!.id });

      if (memberError) {
        if (memberError.code === "23505") {
          throw new Error("You are already a member of this class");
        }
        throw memberError;
      }

      toast({
        title: "Success!",
        description: "Joined class successfully.",
      });
      
      setJoinDialogOpen(false);
      fetchClasses();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/auth");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/30 to-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-hero rounded-xl flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold bg-gradient-hero bg-clip-text text-transparent">
              ClassChat
            </h1>
          </div>
          <div className="flex gap-2 items-center">
            {user && <NotificationBell userId={user.id} />}
            <Button variant="outline" size="sm" onClick={() => navigate("/profile")}>
              <UserCircle className="w-4 h-4 mr-2" />
              Profile
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/messages")}>
              <MessageSquare className="w-4 h-4 mr-2" />
              Messages
            </Button>
            {isClassCreator && (
              <Button variant="outline" size="sm" onClick={() => navigate("/admin-directory")}>
                <Network className="w-4 h-4 mr-2" />
                CR Network
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => navigate("/analytics")}>
              <BarChart3 className="w-4 h-4 mr-2" />
              Analytics
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold text-foreground">My Classes</h2>
            <p className="text-muted-foreground mt-1">Manage and join your class communities</p>
          </div>
          <div className="flex gap-3">
            {!isMemberOfAnyClass && (
              <Dialog open={joinDialogOpen} onOpenChange={setJoinDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Users className="w-4 h-4 mr-2" />
                    Join Class
                  </Button>
                </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Join a Class</DialogTitle>
                  <DialogDescription>
                    Enter the invite code shared by your class admin
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleJoinClass} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="inviteCode">Invite Code</Label>
                    <Input
                      id="inviteCode"
                      name="inviteCode"
                      placeholder="Enter invite code"
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full">Join Class</Button>
                </form>
              </DialogContent>
            </Dialog>
            )}

            {!isMemberOfAnyClass && !hasCreatedClass && (
              <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Create Class
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create a New Class</DialogTitle>
                    <DialogDescription>
                      Set up a new class and invite your classmates
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleCreateClass} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Class Name</Label>
                      <Input
                        id="name"
                        name="name"
                        placeholder="e.g., Computer Science 101"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description (Optional)</Label>
                      <Textarea
                        id="description"
                        name="description"
                        placeholder="Describe your class..."
                        rows={3}
                      />
                    </div>
                    <Button type="submit" className="w-full">Create Class</Button>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={classes.length === 0 ? "lg:col-span-3" : "lg:col-span-1"}>
            {classes.length === 0 ? (
              <Card className="text-center py-12">
                <CardContent>
                  <GraduationCap className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <CardTitle className="mb-2">No classes yet</CardTitle>
                  <CardDescription className="mb-6">
                    Create your first class or join one using an invite code
                  </CardDescription>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {classes.map((cls) => (
                  <Card
                    key={cls.id}
                    className="hover:shadow-hover transition-all cursor-pointer group border-l-4 border-l-primary"
                    onClick={() => navigate(`/class/${cls.id}`)}
                  >
                    <CardHeader>
                      <CardTitle className="group-hover:text-primary transition-colors">
                        {cls.name}
                      </CardTitle>
                      {cls.description && (
                        <CardDescription>{cls.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Users className="w-4 h-4" />
                        <span>Invite code: {cls.invite_code}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {userClassId && (
            <div className="lg:col-span-2">
              <Card className="shadow-lg border-2">
                <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5">
                  <CardTitle className="text-2xl">📌 Notice Board</CardTitle>
                  <CardDescription>
                    Important announcements and updates for your class
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                  <NoticeBoard classId={userClassId} isAdmin={isAdmin} />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
