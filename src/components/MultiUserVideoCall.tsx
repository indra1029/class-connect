import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Video, VideoOff, Mic, MicOff, PhoneOff, Monitor, Users, MonitorOff, X } from "lucide-react";
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
  avatar_url?: string | null;
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
  const [callDuration, setCallDuration] = useState<string>("00:00");
  const [showParticipants, setShowParticipants] = useState(false);
  const canScreenShare = isScreenShareSupported();
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const callStartTime = useRef<number>(Date.now());
  const durationInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    initializeCall();
    
    // Start duration timer
    callStartTime.current = Date.now();
    durationInterval.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTime.current) / 1000);
      const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const secs = (elapsed % 60).toString().padStart(2, '0');
      setCallDuration(`${mins}:${secs}`);
    }, 1000);
    
    return () => {
      cleanup();
      if (durationInterval.current) {
        clearInterval(durationInterval.current);
      }
    };
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

      // Fetch user names and avatars
      const userIds = data?.map(p => p.user_id) || [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]));
      
      const participantsWithNames = data?.map(p => ({
        ...p,
        full_name: profileMap.get(p.user_id)?.full_name,
        avatar_url: profileMap.get(p.user_id)?.avatar_url,
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

  // Calculate grid layout based on participant count
  const getGridClass = () => {
    const count = participants.length;
    if (count <= 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-2";
    if (count <= 4) return "grid-cols-2";
    if (count <= 6) return "grid-cols-2 sm:grid-cols-3";
    return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";
  };

  // Get current user from participants
  const currentUser = participants.find(p => p.user_id === userId);
  const otherParticipants = participants.filter(p => p.user_id !== userId);

  return (
    <div className="video-call-container fixed inset-0 z-50 bg-[hsl(220,25%,8%)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-[hsl(220,25%,12%)] px-3 py-2 flex items-center justify-between shrink-0">
        <button 
          onClick={() => setShowParticipants(false)}
          className="p-2 text-muted-foreground hover:text-foreground"
        >
          <X className="w-5 h-5" />
        </button>
        
        <div className="text-center">
          <h2 className="text-sm sm:text-base font-medium text-foreground">{className || "Video Call"}</h2>
          <span className="text-xs text-muted-foreground">{callDuration}</span>
        </div>
        
        <button 
          onClick={() => setShowParticipants(!showParticipants)}
          className="p-2 text-muted-foreground hover:text-foreground"
        >
          <Users className="w-5 h-5" />
        </button>
      </div>

      {/* Video Grid - WhatsApp style */}
      <div className="flex-1 overflow-hidden p-2 sm:p-4">
        <div className={`grid ${getGridClass()} gap-2 sm:gap-3 h-full auto-rows-fr`}>
          {/* Current user's video */}
          <div className="relative rounded-xl overflow-hidden bg-[hsl(220,25%,15%)] border-2 border-primary/60">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${isVideoOff ? 'hidden' : ''}`}
            />
            {isVideoOff && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Avatar className="w-16 h-16 sm:w-20 sm:h-20">
                  <AvatarImage src={currentUser?.avatar_url || ""} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
                    {currentUser?.full_name?.charAt(0).toUpperCase() || "Y"}
                  </AvatarFallback>
                </Avatar>
              </div>
            )}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
              <span className="text-xs sm:text-sm font-medium text-primary bg-black/50 px-2 py-0.5 rounded-full">
                You
              </span>
              {isMuted && (
                <span className="text-xs bg-destructive/80 text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                  <MicOff className="w-3 h-3" />
                </span>
              )}
            </div>
            {isScreenSharing && (
              <div className="absolute top-2 left-2 bg-primary text-primary-foreground text-xs px-2 py-1 rounded-full">
                📺 Sharing
              </div>
            )}
          </div>

          {/* Other participants */}
          {otherParticipants.map((participant) => (
            <div 
              key={participant.user_id}
              className="relative rounded-xl overflow-hidden bg-[hsl(220,25%,15%)] border-2 border-accent/40"
            >
              {/* Placeholder for remote video - show avatar for now */}
              <div className="absolute inset-0 flex items-center justify-center">
                <Avatar className="w-16 h-16 sm:w-20 sm:h-20">
                  <AvatarImage src={participant.avatar_url || ""} />
                  <AvatarFallback className="bg-accent text-accent-foreground text-2xl">
                    {participant.full_name?.charAt(0).toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className="absolute bottom-2 left-2 right-2">
                <span className="text-xs sm:text-sm font-medium text-accent bg-black/50 px-2 py-0.5 rounded-full">
                  {participant.full_name || "Participant"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Participants panel (slide up on mobile) */}
      {showParticipants && (
        <div className="absolute bottom-20 left-0 right-0 bg-[hsl(220,25%,12%)] rounded-t-2xl p-4 max-h-[50vh] overflow-y-auto animate-in slide-in-from-bottom">
          <div className="text-center mb-3">
            <span className="text-sm text-muted-foreground">{participants.length} connected</span>
          </div>
          <div className="space-y-2">
            {participants.map((participant) => (
              <div 
                key={participant.user_id}
                className="flex items-center gap-3 p-2 rounded-lg bg-[hsl(220,25%,18%)]"
              >
                <Avatar className="w-10 h-10">
                  <AvatarImage src={participant.avatar_url || ""} />
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {participant.full_name?.charAt(0).toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-foreground">
                  {participant.full_name || "Participant"}
                  {participant.user_id === userId && " (You)"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom control bar - WhatsApp style */}
      <div className="bg-[hsl(220,25%,12%)] px-4 py-3 sm:py-4 flex items-center justify-center gap-4 sm:gap-6 shrink-0">
        <button
          onClick={toggleMute}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all ${
            isMuted 
              ? 'bg-destructive/20 text-destructive' 
              : 'bg-[hsl(220,25%,20%)] text-foreground hover:bg-[hsl(220,25%,25%)]'
          }`}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Mic className="w-5 h-5 sm:w-6 sm:h-6" />}
        </button>

        <button
          onClick={toggleVideo}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all ${
            isVideoOff 
              ? 'bg-destructive/20 text-destructive' 
              : 'bg-[hsl(220,25%,20%)] text-foreground hover:bg-[hsl(220,25%,25%)]'
          }`}
          title={isVideoOff ? "Turn on camera" : "Turn off camera"}
        >
          {isVideoOff ? <VideoOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Video className="w-5 h-5 sm:w-6 sm:h-6" />}
        </button>

        {canScreenShare && (
          <button
            onClick={toggleScreenShare}
            className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all ${
              isScreenSharing 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-[hsl(220,25%,20%)] text-foreground hover:bg-[hsl(220,25%,25%)]'
            }`}
            title={isScreenSharing ? "Stop sharing" : "Share screen"}
          >
            {isScreenSharing ? <MonitorOff className="w-5 h-5 sm:w-6 sm:h-6" /> : <Monitor className="w-5 h-5 sm:w-6 sm:h-6" />}
          </button>
        )}

        <button
          onClick={endCall}
          className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/90 transition-all"
          title="End call"
        >
          <PhoneOff className="w-6 h-6 sm:w-7 sm:h-7" />
        </button>
      </div>
    </div>
  );
};

export default MultiUserVideoCall;
