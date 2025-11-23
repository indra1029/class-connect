import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Video, VideoOff, Mic, MicOff, PhoneOff, Monitor, Users, Maximize } from "lucide-react";
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

const MultiUserVideoCall = ({ classId, userId, onClose }: MultiUserVideoCallProps) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
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
      }
    } catch (error: any) {
      toast.error("Failed to initialize call: " + error.message);
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

      // Add user as participant
      await supabase
        .from("video_call_participants")
        .insert({
          session_id: sessionId,
          user_id: userId,
          is_active: true,
        });

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
      toast.error("Failed to share screen: " + error.message);
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

  const toggleFullscreen = () => {
    const elem = document.documentElement;
    if (!document.fullscreenElement) {
      elem.requestFullscreen().catch(err => {
        toast.error("Could not enable fullscreen");
      });
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Header with controls */}
      <div className="bg-gradient-to-r from-primary/90 to-secondary/90 backdrop-blur-sm px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-white">
            <Users className="w-5 h-5" />
            <span className="font-semibold text-lg">{participants.length}</span>
            <span className="text-sm opacity-90">participant{participants.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className="text-white hover:bg-white/20"
          >
            Fullscreen
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={endCall}
            className="text-white hover:bg-white/20"
          >
            Leave Call
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
        <div className="absolute top-4 left-4 flex flex-col gap-2">
          <div className="bg-black/70 text-white px-4 py-2 rounded-full text-sm font-medium backdrop-blur-sm">
            You {isVideoOff && "• Camera Off"}
          </div>
          {isScreenSharing && (
            <div className="bg-primary/80 text-white px-4 py-2 rounded-full text-sm font-medium backdrop-blur-sm">
              📺 Sharing Screen
            </div>
          )}
        </div>

        {/* Participants grid */}
        {participants.length > 1 && (
          <div className="absolute top-4 right-4 flex flex-col gap-2 max-h-[calc(100%-120px)] overflow-y-auto">
            {participants
              .filter(p => p.user_id !== userId)
              .map((participant) => (
                <Card
                  key={participant.user_id}
                  className="w-40 h-28 bg-muted/90 backdrop-blur-sm border-2 border-primary/50"
                >
                  <CardContent className="p-2 h-full flex flex-col items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-gradient-hero flex items-center justify-center text-white font-bold text-lg mb-1">
                      {participant.full_name?.charAt(0).toUpperCase() || "?"}
                    </div>
                    <p className="text-xs font-medium text-center truncate w-full">
                      {participant.full_name || "Participant"}
                    </p>
                  </CardContent>
                </Card>
              ))}
          </div>
        )}
      </div>

      {/* Bottom control bar */}
      <div className="bg-gradient-to-r from-primary/90 to-secondary/90 backdrop-blur-sm px-4 py-4 flex items-center justify-center gap-3 shadow-lg">
        <Button
          variant={isMuted ? "destructive" : "secondary"}
          size="lg"
          onClick={toggleMute}
          className="rounded-full w-14 h-14 shadow-lg hover:scale-110 transition-transform"
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </Button>

        <Button
          variant={isVideoOff ? "destructive" : "secondary"}
          size="lg"
          onClick={toggleVideo}
          className="rounded-full w-14 h-14 shadow-lg hover:scale-110 transition-transform"
          title={isVideoOff ? "Turn on camera" : "Turn off camera"}
        >
          {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
        </Button>

        <Button
          variant={isScreenSharing ? "default" : "secondary"}
          size="lg"
          onClick={toggleScreenShare}
          className="rounded-full w-14 h-14 shadow-lg hover:scale-110 transition-transform"
          title={isScreenSharing ? "Stop sharing" : "Share screen"}
        >
          <Monitor className="w-6 h-6" />
        </Button>

        <Button
          variant="destructive"
          size="lg"
          onClick={endCall}
          className="rounded-full w-14 h-14 shadow-lg hover:scale-110 transition-transform ml-4"
          title="End call"
        >
          <PhoneOff className="w-6 h-6" />
        </Button>
      </div>
    </div>
  );
};

export default MultiUserVideoCall;
