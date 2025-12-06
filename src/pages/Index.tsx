import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MessageSquare, Users, Lock, Video, Bell, FileText } from "lucide-react";
import classChatLogo from "@/assets/classchat-logo-new.png";

const Index = () => {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate("/dashboard");
      }
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/30 to-background">
      <header className="border-b bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <img src={classChatLogo} alt="ClassChat Logo" className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl object-cover" />
            <h1 className="text-xl sm:text-2xl font-bold bg-gradient-hero bg-clip-text text-transparent">
              ClassChat
            </h1>
          </div>
          <Button onClick={() => navigate("/auth")} size="sm">
            Get Started
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 sm:py-20">
        <div className="max-w-4xl mx-auto text-center mb-12 sm:mb-20">
          <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold mb-4 sm:mb-6 bg-gradient-hero bg-clip-text text-transparent leading-tight">
            Your Class, Connected
          </h1>
          <p className="text-base sm:text-xl text-muted-foreground mb-6 sm:mb-8 max-w-2xl mx-auto px-2">
            Chat, video call, and collaborate with your classmates - all in one secure space.
          </p>
          <Button size="lg" onClick={() => navigate("/auth")} className="text-base sm:text-lg px-6 sm:px-8 py-5 sm:py-6">
            Start Now
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-8 max-w-5xl mx-auto">
          <div className="bg-card rounded-2xl p-6 sm:p-8 shadow-soft border border-border/50 hover:shadow-hover transition-all">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-3 sm:mb-4">
              <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3">Real-time Chat</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Instant messaging with your classmates.
            </p>
          </div>

          <div className="bg-card rounded-2xl p-6 sm:p-8 shadow-soft border border-border/50 hover:shadow-hover transition-all">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-accent/10 rounded-xl flex items-center justify-center mb-3 sm:mb-4">
              <Video className="w-5 h-5 sm:w-6 sm:h-6 text-accent" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3">Group Video Calls</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Video meetings with the whole class.
            </p>
          </div>

          <div className="bg-card rounded-2xl p-6 sm:p-8 shadow-soft border border-border/50 hover:shadow-hover transition-all">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-destructive/10 rounded-xl flex items-center justify-center mb-3 sm:mb-4">
              <Lock className="w-5 h-5 sm:w-6 sm:h-6 text-destructive" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3">Secure & Private</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Only class members can access.
            </p>
          </div>

          <div className="bg-card rounded-2xl p-6 sm:p-8 shadow-soft border border-border/50 hover:shadow-hover transition-all">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-3 sm:mb-4">
              <FileText className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3">File Sharing</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Share documents and presentations.
            </p>
          </div>

          <div className="bg-card rounded-2xl p-6 sm:p-8 shadow-soft border border-border/50 hover:shadow-hover transition-all">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-accent/10 rounded-xl flex items-center justify-center mb-3 sm:mb-4">
              <Bell className="w-5 h-5 sm:w-6 sm:h-6 text-accent" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3">Notifications</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Stay updated with real-time alerts.
            </p>
          </div>

          <div className="bg-card rounded-2xl p-6 sm:p-8 shadow-soft border border-border/50 hover:shadow-hover transition-all">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-destructive/10 rounded-xl flex items-center justify-center mb-3 sm:mb-4">
              <Users className="w-5 h-5 sm:w-6 sm:h-6 text-destructive" />
            </div>
            <h3 className="text-lg sm:text-xl font-bold mb-2 sm:mb-3">Class Groups</h3>
            <p className="text-sm sm:text-base text-muted-foreground">
              Organized by class boundaries.
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t mt-10 sm:mt-20">
        <div className="container mx-auto px-4 py-4 sm:py-6 text-center text-xs sm:text-sm text-muted-foreground">
          © 2024 ClassChat. Built for students.
        </div>
      </footer>
    </div>
  );
};

export default Index;
