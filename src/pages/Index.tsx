import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MessageSquare, Users, Lock } from "lucide-react";
import classChatLogo from "@/assets/classchat-logo.png";

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
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={classChatLogo} alt="ClassChat Logo" className="w-10 h-10 rounded-xl object-cover" />
            <h1 className="text-2xl font-bold bg-gradient-hero bg-clip-text text-transparent">
              ClassChat
            </h1>
          </div>
          <Button onClick={() => navigate("/auth")} size="sm">
            Get Started
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-20">
        <div className="max-w-4xl mx-auto text-center mb-20">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-hero bg-clip-text text-transparent">
            Connect Your Classroom Like Never Before
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            A modern communication platform designed for students. Chat, share, and collaborate
            with your classmates in a secure, organized space.
          </p>
          <Button size="lg" onClick={() => navigate("/auth")} className="text-lg px-8 py-6">
            Start Chatting Now
          </Button>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="bg-card rounded-2xl p-8 shadow-soft border border-border/50 hover:shadow-hover transition-all">
            <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-4">
              <MessageSquare className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-xl font-bold mb-3">Real-time Chat</h3>
            <p className="text-muted-foreground">
              Instant messaging with your classmates. Stay connected and never miss important updates.
            </p>
          </div>

          <div className="bg-card rounded-2xl p-8 shadow-soft border border-border/50 hover:shadow-hover transition-all">
            <div className="w-12 h-12 bg-accent/10 rounded-xl flex items-center justify-center mb-4">
              <Users className="w-6 h-6 text-accent" />
            </div>
            <h3 className="text-xl font-bold mb-3">Class Boundaries</h3>
            <p className="text-muted-foreground">
              Organized by class. Keep conversations relevant and focused within your specific groups.
            </p>
          </div>

          <div className="bg-card rounded-2xl p-8 shadow-soft border border-border/50 hover:shadow-hover transition-all">
            <div className="w-12 h-12 bg-destructive/10 rounded-xl flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-destructive" />
            </div>
            <h3 className="text-xl font-bold mb-3">Secure & Private</h3>
            <p className="text-muted-foreground">
              Your conversations are protected. Only class members can access your discussions.
            </p>
          </div>
        </div>
      </main>

      <footer className="border-t mt-20">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          © 2024 ClassChat. Built for students, by students.
        </div>
      </footer>
    </div>
  );
};

export default Index;
