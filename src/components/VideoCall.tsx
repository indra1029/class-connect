import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Video, VideoOff, Mic, MicOff, Phone, Monitor, MonitorOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface VideoCallProps {
  classId: string;
  userId: string;
}

const VideoCall = ({ classId, userId }: VideoCallProps) => {
  const { toast } = useToast();
  const [isCallActive, setIsCallActive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideosRef = useRef<{ [key: string]: HTMLVideoElement }>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<{ [key: string]: RTCPeerConnection }>({});
  const channelRef = useRef<any>(null);

  useEffect(() => {
    if (isCallActive) {
      setupCall();
    }
    return () => {
      cleanup();
    };
  }, [isCallActive]);

  const setupCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const channel = supabase.channel(`video-call:${classId}`);
      channelRef.current = channel;

      channel
        .on("broadcast", { event: "offer" }, async ({ payload }) => {
          await handleOffer(payload);
        })
        .on("broadcast", { event: "answer" }, async ({ payload }) => {
          await handleAnswer(payload);
        })
        .on("broadcast", { event: "ice-candidate" }, async ({ payload }) => {
          await handleIceCandidate(payload);
        })
        .subscribe();

      await channel.track({ user_id: userId, online: true });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to access camera/microphone",
      });
      setIsCallActive(false);
    }
  };

  const createPeerConnection = (peerId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    pc.ontrack = (event) => {
      const remoteVideo = document.getElementById(`remote-${peerId}`) as HTMLVideoElement;
      if (remoteVideo) {
        remoteVideo.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        channelRef.current?.send({
          type: "broadcast",
          event: "ice-candidate",
          payload: { candidate: event.candidate, to: peerId, from: userId },
        });
      }
    };

    peerConnectionsRef.current[peerId] = pc;
    return pc;
  };

  const handleOffer = async (payload: any) => {
    if (payload.to !== userId) return;
    
    const pc = createPeerConnection(payload.from);
    await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    channelRef.current?.send({
      type: "broadcast",
      event: "answer",
      payload: { answer, to: payload.from, from: userId },
    });
  };

  const handleAnswer = async (payload: any) => {
    if (payload.to !== userId) return;
    
    const pc = peerConnectionsRef.current[payload.from];
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.answer));
    }
  };

  const handleIceCandidate = async (payload: any) => {
    if (payload.to !== userId) return;
    
    const pc = peerConnectionsRef.current[payload.from];
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      
      const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const videoTrack = videoStream.getVideoTracks()[0];
      
      Object.values(peerConnectionsRef.current).forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (sender) sender.replaceTrack(videoTrack);
      });
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        
        screenStreamRef.current = screenStream;
        const screenTrack = screenStream.getVideoTracks()[0];
        
        Object.values(peerConnectionsRef.current).forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "video");
          if (sender) sender.replaceTrack(screenTrack);
        });
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        
        screenTrack.onended = () => {
          toggleScreenShare();
        };
        
        setIsScreenSharing(true);
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to share screen",
        });
      }
    }
  };

  const cleanup = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    Object.values(peerConnectionsRef.current).forEach((pc) => pc.close());
    channelRef.current?.unsubscribe();
    
    localStreamRef.current = null;
    screenStreamRef.current = null;
    peerConnectionsRef.current = {};
    channelRef.current = null;
  };

  const endCall = () => {
    cleanup();
    setIsCallActive(false);
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
  };

  if (!isCallActive) {
    return (
      <Button onClick={() => setIsCallActive(true)} className="gap-2">
        <Video className="w-4 h-4" />
        Start Video Call
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/95 z-50 flex flex-col">
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
        <div className="relative aspect-video bg-secondary rounded-lg overflow-hidden">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
          <div className="absolute bottom-2 left-2 text-white bg-black/50 px-2 py-1 rounded text-sm">
            You {isScreenSharing && "(Screen)"}
          </div>
        </div>
      </div>

      <div className="p-4 bg-card/50 backdrop-blur-sm flex justify-center gap-4">
        <Button
          variant={isMuted ? "destructive" : "secondary"}
          size="icon"
          onClick={toggleMute}
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </Button>
        
        <Button
          variant={isVideoOff ? "destructive" : "secondary"}
          size="icon"
          onClick={toggleVideo}
        >
          {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
        </Button>
        
        <Button
          variant={isScreenSharing ? "default" : "secondary"}
          size="icon"
          onClick={toggleScreenShare}
        >
          {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
        </Button>
        
        <Button variant="destructive" size="icon" onClick={endCall}>
          <Phone className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
};

export default VideoCall;
