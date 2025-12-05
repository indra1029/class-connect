import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  Maximize,
  Minimize,
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  MonitorOff,
  PhoneOff,
  Users,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Detect if screen sharing is supported
const isScreenShareSupported = () => {
  return typeof navigator !== 'undefined' && 
         navigator.mediaDevices && 
         typeof navigator.mediaDevices.getDisplayMedia === 'function';
};

interface Participant {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  is_active: boolean;
}

interface CRVideoConferenceProps {
  sessionId: string;
  user: User;
  onClose: () => void;
}

const CRVideoConference = ({ sessionId, user, onClose }: CRVideoConferenceProps) => {
  const { toast } = useToast();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const canScreenShare = isScreenShareSupported();
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    initializeMedia();
    joinSession();
    subscribeToParticipants();

    return () => {
      cleanup();
    };
  }, [sessionId]);

  const initializeMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error("Error accessing media devices:", error);
      toast({
        variant: "destructive",
        title: "Media Error",
        description: "Failed to access camera/microphone. Please check permissions.",
      });
    }
  };

  const joinSession = async () => {
    try {
      const { error } = await supabase
        .from("cr_video_participants")
        .insert({
          session_id: sessionId,
          user_id: user.id,
        });

      if (error) throw error;
    } catch (error: any) {
      console.error("Error joining session:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to join video call",
      });
    }
  };

  const subscribeToParticipants = () => {
    fetchParticipants();

    const channel = supabase
      .channel(`cr-video-${sessionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "cr_video_participants",
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          fetchParticipants();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const fetchParticipants = async () => {
    try {
      const { data: participantsData, error: participantsError } = await supabase
        .from("cr_video_participants")
        .select("user_id, is_active")
        .eq("session_id", sessionId)
        .eq("is_active", true);

      if (participantsError) throw participantsError;

      const userIds = participantsData?.map((p) => p.user_id) || [];
      
      if (userIds.length === 0) {
        setParticipants([]);
        return;
      }

      const { data: profilesData, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", userIds);

      if (profilesError) throw profilesError;

      const participantsList: Participant[] = participantsData?.map((p) => {
        const profile = profilesData?.find((prof) => prof.id === p.user_id);
        return {
          user_id: p.user_id,
          full_name: profile?.full_name || "Unknown",
          avatar_url: profile?.avatar_url || null,
          is_active: p.is_active,
        };
      }) || [];

      setParticipants(participantsList);
    } catch (error: any) {
      console.error("Error fetching participants:", error);
    }
  };

  const toggleFullscreen = async () => {
    if (!videoContainerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await videoContainerRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error("Fullscreen error:", error);
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const toggleScreenShare = async () => {
    if (!canScreenShare) {
      toast({
        variant: "destructive",
        title: "Not Supported",
        description: "Screen sharing is not supported on this device",
      });
      return;
    }

    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });

        screenStreamRef.current = screenStream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }

        screenStream.getVideoTracks()[0].onended = () => {
          stopScreenShare();
        };

        setIsScreenSharing(true);
        toast({
          title: "Screen Sharing",
          description: "Your screen is now being shared",
        });
      } else {
        stopScreenShare();
      }
    } catch (error: any) {
      console.error("Screen share error:", error);
      if (error.name === 'NotAllowedError') {
        toast({
          variant: "destructive",
          title: "Cancelled",
          description: "Screen sharing was cancelled",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Screen Share Error",
          description: "Failed to start screen sharing",
        });
      }
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    setIsScreenSharing(false);
  };

  const leaveCall = async () => {
    try {
      await supabase
        .from("cr_video_participants")
        .update({ is_active: false, left_at: new Date().toISOString() })
        .eq("session_id", sessionId)
        .eq("user_id", user.id);

      cleanup();
      onClose();
    } catch (error: any) {
      console.error("Error leaving call:", error);
    }
  };

  const cleanup = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
    }
  };

  return (
    <div
      ref={videoContainerRef}
      className="fixed inset-0 bg-black z-50 flex flex-col"
    >
      {/* Video Grid */}
      <div className="flex-1 relative grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-4">
        {/* Local Video */}
        <div className="relative bg-gray-900 rounded-lg overflow-hidden">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          <div className="absolute bottom-2 left-2 bg-black/70 px-3 py-1 rounded-full text-white text-sm">
            You {isScreenSharing && "(Sharing Screen)"}
          </div>
        </div>

        {/* Other Participants */}
        {participants
          .filter((p) => p.user_id !== user.id)
          .map((participant) => (
            <div
              key={participant.user_id}
              className="relative bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center"
            >
              <Avatar className="w-24 h-24">
                <AvatarImage src={participant.avatar_url || ""} />
                <AvatarFallback className="bg-gradient-hero text-white text-3xl">
                  {participant.full_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="absolute bottom-2 left-2 bg-black/70 px-3 py-1 rounded-full text-white text-sm">
                {participant.full_name}
              </div>
            </div>
          ))}
      </div>

      {/* Controls */}
      <Card className="m-4 p-4 bg-card/95 backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          {/* Participant Count */}
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="w-5 h-5" />
            <span className="text-sm font-medium">
              {participants.length} {participants.length === 1 ? "Participant" : "Participants"}
            </span>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center gap-2">
            <Button
              variant={isMuted ? "destructive" : "secondary"}
              size="icon"
              onClick={toggleMute}
              className="rounded-full w-12 h-12"
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </Button>

            <Button
              variant={isVideoOff ? "destructive" : "secondary"}
              size="icon"
              onClick={toggleVideo}
              className="rounded-full w-12 h-12"
            >
              {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </Button>

            {canScreenShare && (
              <Button
                variant={isScreenSharing ? "default" : "secondary"}
                size="icon"
                onClick={toggleScreenShare}
                className="rounded-full w-12 h-12"
              >
                {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <MonitorUp className="w-5 h-5" />}
              </Button>
            )}

            <Button
              variant="secondary"
              size="icon"
              onClick={toggleFullscreen}
              className="rounded-full w-12 h-12"
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </Button>

            <Button
              variant="destructive"
              size="icon"
              onClick={leaveCall}
              className="rounded-full w-12 h-12 ml-4"
            >
              <PhoneOff className="w-5 h-5" />
            </Button>
          </div>

          <div className="w-24" /> {/* Spacer for balance */}
        </div>
      </Card>
    </div>
  );
};

export default CRVideoConference;
