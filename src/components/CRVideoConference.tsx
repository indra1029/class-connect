import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { iceServers, isScreenShareSupported } from "@/lib/webrtc";
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
  const isMobile = useIsMobile();
  const canScreenShare = !isMobile && isScreenShareSupported();
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const channelRef = useRef<any>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteStreams = useRef<Map<string, MediaStream>>(new Map());
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  useEffect(() => {
    initializeMedia();
    joinSession();
    const unsub = subscribeToParticipants();
    setupSignaling();

    return () => {
      unsub?.();
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
      // Avoid duplicate row errors if the user re-joins.
      const { data: existing } = await supabase
        .from("cr_video_participants")
        .select("id")
        .eq("session_id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await supabase
          .from("cr_video_participants")
          .update({ is_active: true, joined_at: new Date().toISOString(), left_at: null })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("cr_video_participants")
          .insert({ session_id: sessionId, user_id: user.id, is_active: true });
        if (error) throw error;
      }
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
        () => fetchParticipants()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  // --- WebRTC signaling (CR room) ---
  const setupSignaling = () => {
    const channel = supabase.channel(`cr-webrtc-${sessionId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "offer" }, async ({ payload }) => {
        if (payload.to === user.id) await handleOffer(payload);
      })
      .on("broadcast", { event: "answer" }, async ({ payload }) => {
        if (payload.to === user.id) await handleAnswer(payload);
      })
      .on("broadcast", { event: "ice-candidate" }, async ({ payload }) => {
        if (payload.to === user.id) await handleIceCandidate(payload);
      })
      .on("broadcast", { event: "user-joined" }, async ({ payload }) => {
        if (!localStreamRef.current) return;
        if (payload.userId === user.id) return;
        // Polite peer: smaller ID initiates
        const shouldCreateOffer = user.id < payload.userId;
        if (shouldCreateOffer) {
          await createOffer(payload.userId);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.send({
            type: "broadcast",
            event: "user-joined",
            payload: { userId: user.id },
          });
        }
      });

    channelRef.current = channel;
  };

  const createPeerConnection = (peerId: string) => {
    const existing = peerConnections.current.get(peerId);
    if (existing) {
      existing.close();
      peerConnections.current.delete(peerId);
    }

    const pc = new RTCPeerConnection(iceServers);

    // Add tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      remoteStreams.current.set(peerId, stream);
      const el = remoteVideoRefs.current.get(peerId);
      if (el) el.srcObject = stream;
    };

    pc.onicecandidate = (event) => {
      if (!event.candidate || !channelRef.current) return;
      channelRef.current.send({
        type: "broadcast",
        event: "ice-candidate",
        payload: {
          candidate: event.candidate.toJSON(),
          to: peerId,
          from: user.id,
        },
      });
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "failed" || state === "disconnected") {
        remoteStreams.current.delete(peerId);
      }
    };

    peerConnections.current.set(peerId, pc);
    return pc;
  };

  const createOffer = async (peerId: string) => {
    try {
      const pc = createPeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      channelRef.current?.send({
        type: "broadcast",
        event: "offer",
        payload: {
          offer: pc.localDescription?.toJSON(),
          to: peerId,
          from: user.id,
        },
      });
    } catch (e) {
      console.error("CR createOffer error", e);
    }
  };

  const handleOffer = async (payload: { offer: RTCSessionDescriptionInit; from: string }) => {
    try {
      const pc = createPeerConnection(payload.from);
      await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      channelRef.current?.send({
        type: "broadcast",
        event: "answer",
        payload: {
          answer: pc.localDescription?.toJSON(),
          to: payload.from,
          from: user.id,
        },
      });
    } catch (e) {
      console.error("CR handleOffer error", e);
    }
  };

  const handleAnswer = async (payload: { answer: RTCSessionDescriptionInit; from: string }) => {
    try {
      const pc = peerConnections.current.get(payload.from);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
    } catch (e) {
      console.error("CR handleAnswer error", e);
    }
  };

  const handleIceCandidate = async (payload: { candidate: RTCIceCandidateInit; from: string }) => {
    try {
      const pc = peerConnections.current.get(payload.from);
      if (!pc) return;
      await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (e) {
      console.error("CR handleIceCandidate error", e);
    }
  };

  const setRemoteVideoRef = useCallback((peerId: string, el: HTMLVideoElement | null) => {
    if (el) {
      remoteVideoRefs.current.set(peerId, el);
      const stream = remoteStreams.current.get(peerId);
      if (stream) el.srcObject = stream;
    } else {
      remoteVideoRefs.current.delete(peerId);
    }
  }, []);

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

      // Connect to existing participants (multi-user)
      if (localStreamRef.current) {
        const others = participantsList.filter((p) => p.user_id !== user.id);
        for (const p of others) {
          if (!peerConnections.current.has(p.user_id)) {
            const shouldCreateOffer = user.id < p.user_id;
            if (shouldCreateOffer) {
              await createOffer(p.user_id);
            }
          }
        }
      }
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
    if (isMobile) {
      toast({
        variant: "destructive",
        title: "Not Supported",
        description: "Screen sharing is not supported on mobile devices",
      });
      return;
    }
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
    // Stop tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    // Close webrtc
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    remoteStreams.current.clear();

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
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
          .map((participant) => {
            const hasStream = remoteStreams.current.has(participant.user_id);
            return (
              <div
                key={participant.user_id}
                className="relative bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center"
              >
                {hasStream ? (
                  <video
                    ref={(el) => setRemoteVideoRef(participant.user_id, el)}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <>
                    <Avatar className="w-24 h-24">
                      <AvatarImage src={participant.avatar_url || ""} />
                      <AvatarFallback className="bg-gradient-hero text-white text-3xl">
                        {participant.full_name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="absolute top-2 right-2 bg-black/70 px-2 py-1 rounded-full text-white text-xs">
                      Connecting…
                    </div>
                  </>
                )}
                <div className="absolute bottom-2 left-2 bg-black/70 px-3 py-1 rounded-full text-white text-sm">
                  {participant.full_name}
                </div>
              </div>
            );
          })}
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
