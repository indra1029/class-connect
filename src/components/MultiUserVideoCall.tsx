import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Video, VideoOff, Mic, MicOff, PhoneOff, Monitor, Users, Maximize, MonitorOff } from "lucide-react";
import { toast } from "sonner";

interface MultiUserVideoCallProps {
  classId: string;
  userId: string;
  onClose: () => void;
}

interface Participant {
  user_id: string;
  is_active: boolean;
  full_name?: string;
}

// Detect if screen sharing is supported
const isScreenShareSupported = () => {
  return typeof navigator !== 'undefined' && 
         navigator.mediaDevices && 
         typeof navigator.mediaDevices.getDisplayMedia === 'function';
};

const MultiUserVideoCall = ({ classId, userId, onClose }: MultiUserVideoCallProps) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [className, setClassName] = useState<string>("");
  const canScreenShare = isScreenShareSupported();
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());

  useEffect(() => {
    initializeCall();
    return () => cleanup();
  }, []);

  useEffect(() => {
    if (sessionId) {
      subscribeToParticipants();
    }
  }, [sessionId]);

  const initializeCall = async () => {
    try {
      // Get class name for notifications
      const { data: classData } = await supabase
        .from("classes")
        .select("name")
        .eq("id", classId)
        .single();
      
      if (classData) {
        setClassName(classData.name);
      }

      // Check if there's an active session
      const { data: activeSession } = await supabase
        .from("video_call_sessions")
        .select("id")
        .eq("class_id", classId)
        .eq("is_active", true)
        .single();

      if (activeSession) {
        // Join existing session
        setSessionId(activeSession.id);
        await joinSession(activeSession.id);
      } else {
        // Create new session
        const { data: newSession, error } = await supabase
          .from("video_call_sessions")
          .insert({
            class_id: classId,
            started_by: userId,
            is_active: true,
          })
          .select()
          .single();

        if (error) throw error;
        setSessionId(newSession.id);
        await joinSession(newSession.id);
        
        // Notify all class members about the new call
        await notifyClassMembers(newSession.id);
      }
    } catch (error: any) {
      toast.error("Failed to initialize call: " + error.message);
    }
  };

  const notifyClassMembers = async (sessionId: string) => {
    try {
      // Get current user's name
      const { data: userProfile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .single();

      // Get all class members except current user
      const { data: members } = await supabase
        .from("class_members")
        .select("user_id")
        .eq("class_id", classId)
        .neq("user_id", userId);

      if (members && members.length > 0) {
        const notifications = members.map((member) => ({
          user_id: member.user_id,
          title: "📹 Video Call Started",
          message: `${userProfile?.full_name || "Someone"} started a video call in ${className || "your class"}`,
          type: "video_call",
          link: `/classroom/${classId}?joinCall=${sessionId}`,
          read: false,
        }));

        await supabase.from("notifications").insert(notifications);
      }
    } catch (error) {
      console.error("Error notifying class members:", error);
    }
  };

  const joinSession = async (sessionId: string) => {
    try {
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      
      localStream.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Check if participant already exists
      const { data: existingParticipant } = await supabase
        .from("video_call_participants")
        .select("id")
        .eq("session_id", sessionId)
        .eq("user_id", userId)
        .single();

      if (existingParticipant) {
        // Update existing participant to active
        await supabase
          .from("video_call_participants")
          .update({ is_active: true, joined_at: new Date().toISOString(), left_at: null })
          .eq("id", existingParticipant.id);
      } else {
        // Add user as new participant
        await supabase
          .from("video_call_participants")
          .insert({
            session_id: sessionId,
            user_id: userId,
            is_active: true,
          });
      }

      toast.success("Joined video call");
    } catch (error: any) {
      toast.error("Failed to join call: " + error.message);
    }
  };

  const subscribeToParticipants = () => {
    const channel = supabase
      .channel(`call-participants-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "video_call_participants",
          filter: `session_id=eq.${sessionId}`,
        },
        async () => {
          await fetchParticipants();
        }
      )
      .subscribe();

    fetchParticipants();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const fetchParticipants = async () => {
    try {
      const { data, error } = await supabase
        .from("video_call_participants")
        .select("user_id, is_active")
        .eq("session_id", sessionId)
        .eq("is_active", true);

      if (error) throw error;

      // Fetch user names
      const userIds = data?.map(p => p.user_id) || [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p.full_name]));
      
      const participantsWithNames = data?.map(p => ({
        ...p,
        full_name: profileMap.get(p.user_id),
      })) || [];

      setParticipants(participantsWithNames);
    } catch (error: any) {
      console.error("Error fetching participants:", error);
    }
  };

  const toggleMute = () => {
    if (localStream.current) {
      const audioTrack = localStream.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream.current) {
      const videoTrack = localStream.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  const toggleScreenShare = async () => {
    if (!canScreenShare) {
      toast.error("Screen sharing is not supported on this device");
      return;
    }

    try {
      if (isScreenSharing) {
        // Stop screen sharing
        if (screenStream.current) {
          screenStream.current.getTracks().forEach(track => track.stop());
          screenStream.current = null;
        }
        
        // Resume camera
        if (localStream.current && localVideoRef.current) {
          localVideoRef.current.srcObject = localStream.current;
        }
        
        setIsScreenSharing(false);
        toast.success("Screen sharing stopped");
      } else {
        // Start screen sharing
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        
        screenStream.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        // Handle when user stops sharing via browser UI
        stream.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          if (localStream.current && localVideoRef.current) {
            localVideoRef.current.srcObject = localStream.current;
          }
        };
        
        setIsScreenSharing(true);
        toast.success("Screen sharing started");
      }
    } catch (error: any) {
      if (error.name === 'NotAllowedError') {
        toast.error("Screen sharing was cancelled");
      } else {
        toast.error("Failed to share screen: " + error.message);
      }
    }
  };

  const endCall = async () => {
    try {
      if (sessionId) {
        // Mark participant as inactive
        await supabase
          .from("video_call_participants")
          .update({ is_active: false, left_at: new Date().toISOString() })
          .eq("session_id", sessionId)
          .eq("user_id", userId);

        // Check if this was the last participant
        const { data: activeParticipants } = await supabase
          .from("video_call_participants")
          .select("user_id")
          .eq("session_id", sessionId)
          .eq("is_active", true);

        if (!activeParticipants || activeParticipants.length === 0) {
          // End the session
          await supabase
            .from("video_call_sessions")
            .update({ is_active: false, ended_at: new Date().toISOString() })
            .eq("id", sessionId);
        }
      }

      cleanup();
      onClose();
      toast.success("Left video call");
    } catch (error: any) {
      toast.error("Error ending call: " + error.message);
    }
  };

  const cleanup = () => {
    // Stop all tracks
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => track.stop());
      localStream.current = null;
    }
    
    if (screenStream.current) {
      screenStream.current.getTracks().forEach(track => track.stop());
      screenStream.current = null;
    }

    // Close all peer connections
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear();
  };

  const toggleFullscreen = async () => {
    try {
      const elem = document.querySelector('.video-call-container') as HTMLElement;
      if (!elem) return;
      
      if (!document.fullscreenElement) {
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        } else if ((elem as any).webkitRequestFullscreen) {
          await (elem as any).webkitRequestFullscreen();
        } else if ((elem as any).msRequestFullscreen) {
          await (elem as any).msRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
      }
    } catch (err) {
      toast.error("Could not toggle fullscreen");
    }
  };

  return (
    <div className="video-call-container fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header with controls */}
      <div className="bg-gradient-to-r from-primary/90 to-secondary/90 backdrop-blur-sm px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1 sm:gap-2 text-white">
            <Users className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="font-semibold text-base sm:text-lg">{participants.length}</span>
            <span className="text-xs sm:text-sm opacity-90">participant{participants.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="text-white hover:bg-white/20 text-xs sm:text-sm px-2 sm:px-3"
          >
            <Maximize className="w-4 h-4 sm:mr-1" />
            <span className="hidden sm:inline">Fullscreen</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={endCall}
            className="text-white hover:bg-white/20 text-xs sm:text-sm px-2 sm:px-3"
          >
            Leave
          </Button>
        </div>
      </div>

      {/* Main video area */}
      <div className="flex-1 relative overflow-hidden">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
        
        {/* Status overlay */}
        <div className="absolute top-2 sm:top-4 left-2 sm:left-4 flex flex-col gap-2">
          <div className="bg-black/70 text-white px-3 sm:px-4 py-1 sm:py-2 rounded-full text-xs sm:text-sm font-medium backdrop-blur-sm">
            You {isVideoOff && "• Camera Off"}
          </div>
          {isScreenSharing && (
            <div className="bg-primary/80 text-white px-3 sm:px-4 py-1 sm:py-2 rounded-full text-xs sm:text-sm font-medium backdrop-blur-sm">
              📺 Sharing Screen
            </div>
          )}
        </div>

        {/* Participants grid */}
        {participants.length > 1 && (
          <div className="absolute top-2 sm:top-4 right-2 sm:right-4 flex flex-col gap-2 max-h-[calc(100%-120px)] overflow-y-auto">
            {participants
              .filter(p => p.user_id !== userId)
              .map((participant) => (
                <Card
                  key={participant.user_id}
                  className="w-28 sm:w-40 h-20 sm:h-28 bg-muted/90 backdrop-blur-sm border-2 border-primary/50"
                >
                  <CardContent className="p-1 sm:p-2 h-full flex flex-col items-center justify-center">
                    <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full bg-gradient-hero flex items-center justify-center text-white font-bold text-sm sm:text-lg mb-1">
                      {participant.full_name?.charAt(0).toUpperCase() || "?"}
                    </div>
                    <p className="text-[10px] sm:text-xs font-medium text-center truncate w-full">
                      {participant.full_name || "Participant"}
                    </p>
                  </CardContent>
                </Card>
              ))}
          </div>
        )}
      </div>

      {/* Bottom control bar */}
      <div className="bg-gradient-to-r from-primary/90 to-secondary/90 backdrop-blur-sm px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-center gap-2 sm:gap-3 shadow-lg">
        <Button
          variant={isMuted ? "destructive" : "secondary"}
          size="lg"
          onClick={toggleMute}
          className="rounded-full w-12 h-12 sm:w-14 sm:h-14 shadow-lg hover:scale-110 transition-transform"
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Mic className="w-5 h-5 sm:w-6 sm:h-6" />}
        </Button>

        <Button
          variant={isVideoOff ? "destructive" : "secondary"}
          size="lg"
          onClick={toggleVideo}
          className="rounded-full w-12 h-12 sm:w-14 sm:h-14 shadow-lg hover:scale-110 transition-transform"
          title={isVideoOff ? "Turn on camera" : "Turn off camera"}
        >
          {isVideoOff ? <VideoOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Video className="w-5 h-5 sm:w-6 sm:h-6" />}
        </Button>

        {canScreenShare && (
          <Button
            variant={isScreenSharing ? "default" : "secondary"}
            size="lg"
            onClick={toggleScreenShare}
            className="rounded-full w-12 h-12 sm:w-14 sm:h-14 shadow-lg hover:scale-110 transition-transform"
            title={isScreenSharing ? "Stop sharing" : "Share screen"}
          >
            {isScreenSharing ? <MonitorOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Monitor className="w-5 h-5 sm:w-6 sm:h-6" />}
          </Button>
        )}

        <Button
          variant="destructive"
          size="lg"
          onClick={endCall}
          className="rounded-full w-12 h-12 sm:w-14 sm:h-14 shadow-lg hover:scale-110 transition-transform ml-2 sm:ml-4"
          title="End call"
        >
          <PhoneOff className="w-5 h-5 sm:w-6 sm:h-6" />
        </Button>
      </div>
    </div>
  );
};

export default MultiUserVideoCall;
