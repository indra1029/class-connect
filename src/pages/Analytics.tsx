import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, MessageSquare, TrendingUp, Clock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface ClassStat {
  class_id: string;
  class_name: string;
  member_count: number;
  message_count: number;
  last_message_at: string | null;
}

const Analytics = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<ClassStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalMembers, setTotalMembers] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Use the optimized RPC function instead of N+1 queries
      const { data, error } = await supabase.rpc("get_class_analytics_for_member", {
        _user_id: user.id,
      });

      if (error) throw error;

      const results: ClassStat[] = (data || []).map((row: any) => ({
        class_id: row.class_id,
        class_name: row.class_name,
        member_count: row.member_count,
        message_count: row.message_count,
        last_message_at: row.last_message_at,
      }));

      setStats(results);
      setTotalMembers(results.reduce((sum, s) => sum + s.member_count, 0));
      setTotalMessages(results.reduce((sum, s) => sum + s.message_count, 0));
    } catch (error) {
      console.error("Error fetching analytics:", error);
    } finally {
      setLoading(false);
    }
  };

  const chartData = stats.map((s) => ({
    name: s.class_name.substring(0, 15) + (s.class_name.length > 15 ? "..." : ""),
    messages: s.message_count,
    members: s.member_count,
  }));

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
        <div className="container mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-bold">Analytics Dashboard</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Classes</CardTitle>
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.length}</div>
              <p className="text-xs text-muted-foreground mt-1">Active classes</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Members</CardTitle>
              <Users className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalMembers}</div>
              <p className="text-xs text-muted-foreground mt-1">Across all classes</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Messages</CardTitle>
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{totalMessages}</div>
              <p className="text-xs text-muted-foreground mt-1">Conversations happening</p>
            </CardContent>
          </Card>
        </div>

        {chartData.length > 0 && (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Class Activity Overview</CardTitle>
              <CardDescription>Messages and members per class</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="messages" fill="hsl(var(--primary))" name="Messages" />
                  <Bar dataKey="members" fill="hsl(var(--accent))" name="Members" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Class Details</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No class data available yet.</p>
            ) : (
              <div className="space-y-4">
                {stats.map((stat) => (
                  <div
                    key={stat.class_id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-secondary/50 transition-colors cursor-pointer"
                    onClick={() => navigate(`/class/${stat.class_id}`)}
                  >
                    <div>
                      <div className="font-semibold">{stat.class_name}</div>
                      <div className="text-sm text-muted-foreground flex items-center gap-4 mt-1 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {stat.member_count} members
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          {stat.message_count} messages
                        </span>
                        {stat.last_message_at && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(stat.last_message_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
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

export default Analytics;