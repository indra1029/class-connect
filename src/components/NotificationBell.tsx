import { useEffect, useState } from "react";
import { Bell, Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  link: string | null;
  created_at: string;
}

const NotificationBell = ({ userId }: { userId: string }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeCallSessions, setActiveCallSessions] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    fetchNotifications();
    
    const channel = supabase
      .channel("notifications")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev]);
          setUnreadCount((prev) => prev + 1);
          
          if (Notification.permission === "granted") {
            new Notification(newNotif.title, {
              body: newNotif.message,
              icon: "/favicon.ico",
            });
          }
          
          toast({
            title: newNotif.title,
            description: newNotif.message,
          });
        }
      )
      .subscribe();

    if (Notification.permission === "default") {
      Notification.requestPermission();
    }

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // Check which video call sessions are still active
  useEffect(() => {
    const checkActiveSessions = async () => {
      const videoNotifs = notifications.filter(n => n.type === "video_call" && n.link);
      const sessionIds = videoNotifs.map(n => {
        const url = new URL(n.link!, window.location.origin);
        return url.searchParams.get("joinCall");
      }).filter(Boolean) as string[];

      if (sessionIds.length === 0) {
        setActiveCallSessions(new Set());
        return;
      }

      const { data } = await supabase
        .from("video_call_sessions")
        .select("id")
        .in("id", sessionIds)
        .eq("is_active", true);

      setActiveCallSessions(new Set(data?.map(s => s.id) || []));
    };

    checkActiveSessions();
    // Re-check every 30 seconds
    const interval = setInterval(checkActiveSessions, 30000);
    return () => clearInterval(interval);
  }, [notifications]);

  const fetchNotifications = async () => {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!error && data) {
      setNotifications(data);
      setUnreadCount(data.filter((n) => !n.read).length);
    }
  };

  const markAsRead = async (notifId: string) => {
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("id", notifId);
    
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, read: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
  };

  const handleNotificationClick = (notif: Notification) => {
    markAsRead(notif.id);
    if (notif.link) {
      // Security: Only allow internal navigation (relative paths)
      if (notif.link.startsWith('/') || notif.link.startsWith('#')) {
        navigate(notif.link);
      } else {
        console.warn('External notification link blocked:', notif.link);
      }
    }
  };

  const handleJoinCall = (notif: Notification, e: React.MouseEvent) => {
    e.stopPropagation();
    markAsRead(notif.id);
    if (notif.link && (notif.link.startsWith('/') || notif.link.startsWith('#'))) {
      navigate(notif.link);
    }
  };

  const handleDeclineCall = (notif: Notification, e: React.MouseEvent) => {
    e.stopPropagation();
    markAsRead(notif.id);
    toast({
      title: "Call declined",
      description: "You can still join from the class page while the call is active.",
    });
  };

  const getSessionIdFromLink = (link: string | null): string | null => {
    if (!link) return null;
    try {
      const url = new URL(link, window.location.origin);
      return url.searchParams.get("joinCall");
    } catch {
      return null;
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-white text-xs rounded-full flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="p-4 border-b">
          <h3 className="font-semibold">Notifications</h3>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            notifications.map((notif) => {
              const sessionId = getSessionIdFromLink(notif.link);
              const isVideoCall = notif.type === "video_call";
              const isCallActive = sessionId ? activeCallSessions.has(sessionId) : false;

              return (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`p-4 border-b cursor-pointer hover:bg-secondary transition-colors ${
                    !notif.read ? "bg-primary/5" : ""
                  }`}
                >
                  <div className="font-medium">{notif.title}</div>
                  <div className="text-sm text-muted-foreground">{notif.message}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {new Date(notif.created_at).toLocaleString()}
                  </div>

                  {/* Video call action buttons */}
                  {isVideoCall && sessionId && (
                    <div className="flex gap-2 mt-2">
                      {isCallActive ? (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            className="flex-1 gap-1"
                            onClick={(e) => handleJoinCall(notif, e)}
                          >
                            <Phone className="w-3.5 h-3.5" />
                            Join
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 gap-1 text-destructive border-destructive hover:bg-destructive/10"
                            onClick={(e) => handleDeclineCall(notif, e)}
                          >
                            <PhoneOff className="w-3.5 h-3.5" />
                            Decline
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          Call has ended
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
