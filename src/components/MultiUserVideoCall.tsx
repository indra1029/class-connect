import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Video, VideoOff, Mic, MicOff, PhoneOff, Monitor, Users, MonitorOff, X, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { iceServers, isScreenShareSupported } from "@/lib/webrtc";

interface MultiUserVideoCallProps {
  classId: string;
  userId: string;
  /** If provided, join this exact session (used when user clicks "Join" from notification). */
  sessionIdOverride?: string;
  onClose: () => void;
}

interface Participant {
  user_id: string;
  is_active: boolean;
  full_name?: string;
  avatar_url?: string | null;
}

interface PeerData {
  connection: RTCPeerConnection;
  stream: MediaStream | null;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: Date;
}


const MultiUserVideoCall = ({ classId, userId, sessionIdOverride, onClose }: MultiUserVideoCallProps) => {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [className, setClassName] = useState<string>("");
  const [callDuration, setCallDuration] = useState<string>("00:00");
  const [showParticipants, setShowParticipants] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const isMobile = useIsMobile();
  const canScreenShare = !isMobile && isScreenShareSupported();
  
  // Chat state
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Map<string, PeerData>>(new Map());
  const callStartTime = useRef<number>(Date.now());
  const durationInterval = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<any>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const participantUnsubRef = useRef<null | (() => void)>(null);
  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);

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
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
      }
    };
  }, []);

  useEffect(() => {
    if (sessionId) {
      participantUnsubRef.current?.();
      participantUnsubRef.current = subscribeToParticipants();
      setupSignaling();
      startHeartbeat();
    }
    return () => {
      participantUnsubRef.current?.();
      participantUnsubRef.current = null;
    };
  }, [sessionId]);

  // Start heartbeat to mark this user as alive (prevents ghost participants)
  const startHeartbeat = () => {
    if (heartbeatInterval.current) clearInterval(heartbeatInterval.current);
    heartbeatInterval.current = setInterval(async () => {
      if (sessionId) {
        await supabase
          .from("video_call_participants")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("session_id", sessionId)
          .eq("user_id", userId);
      }
    }, 5000); // every 5 seconds
  };

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatEndRef.current && showChat) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, showChat]);

  // Reset unread count when chat is opened
  useEffect(() => {
    if (showChat) {
      setUnreadCount(0);
    }
  }, [showChat]);

  // Set up WebRTC signaling via Supabase Realtime
  const setupSignaling = () => {
    const channel = supabase.channel(`webrtc-${classId}-${sessionId}`, {
      config: { broadcast: { self: false } }
    });
    
    channel
      .on("broadcast", { event: "offer" }, async ({ payload }) => {
        if (payload.to === userId) {
          await handleOffer(payload);
        }
      })
      .on("broadcast", { event: "answer" }, async ({ payload }) => {
        if (payload.to === userId) {
          await handleAnswer(payload);
        }
      })
      .on("broadcast", { event: "ice-candidate" }, async ({ payload }) => {
        if (payload.to === userId) {
          await handleIceCandidate(payload);
        }
      })
      .on("broadcast", { event: "user-joined" }, async ({ payload }) => {
        if (payload.userId !== userId && localStream.current) {
          // Use "polite" peer pattern - only the user with smaller ID creates the offer
          // This prevents both sides from creating offers simultaneously
          const shouldCreateOffer = userId < payload.userId;
          if (shouldCreateOffer) {
            console.log("I am polite peer, creating offer to:", payload.userId);
            await createOffer(payload.userId);
          } else {
            console.log("I am impolite peer, waiting for offer from:", payload.userId);
          }
        }
      })
      .on("broadcast", { event: "chat-message" }, ({ payload }) => {
        // Add incoming message
        const msg: ChatMessage = {
          id: payload.id,
          senderId: payload.senderId,
          senderName: payload.senderName,
          text: payload.text,
          timestamp: new Date(payload.timestamp)
        };
        setMessages(prev => [...prev, msg]);
        
        // Increment unread count if chat is closed
        if (!showChat) {
          setUnreadCount(prev => prev + 1);
        }
      })
      .subscribe((status) => {
        console.log("Signaling channel status:", status);
        if (status === 'SUBSCRIBED') {
          // Broadcast that we've joined so other participants know to connect
          channel.send({
            type: "broadcast",
            event: "user-joined",
            payload: { userId }
          });
        }
      });

    channelRef.current = channel;
  };

  // Send chat message
  const sendChatMessage = () => {
    if (!newMessage.trim() || !channelRef.current) return;
    
    const currentUser = participants.find(p => p.user_id === userId);
    
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      senderId: userId,
      senderName: currentUser?.full_name || "You",
      text: newMessage.trim(),
      timestamp: new Date()
    };
    
    // Add to local messages immediately
    setMessages(prev => [...prev, message]);
    
    // Broadcast to others
    channelRef.current.send({
      type: "broadcast",
      event: "chat-message",
      payload: {
        id: message.id,
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
        timestamp: message.timestamp.toISOString()
      }
    });
    
    setNewMessage("");
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  };

  const formatMessageTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const createPeerConnection = (peerId: string): RTCPeerConnection => {
    // Close existing connection if any
    const existing = peerConnections.current.get(peerId);
    if (existing) {
      existing.connection.close();
    }

    const pc = new RTCPeerConnection(iceServers);
    
    // Add local tracks
    if (localStream.current) {
      localStream.current.getTracks().forEach(track => {
        pc.addTrack(track, localStream.current!);
      });
    }

    // Handle remote stream
    pc.ontrack = (event) => {
      console.log("Received remote track from:", peerId);
      const [stream] = event.streams;
      if (stream) {
        setRemoteStreams(prev => {
          const updated = new Map(prev);
          updated.set(peerId, stream);
          return updated;
        });
        
        // Set video srcObject if ref exists
        const videoEl = remoteVideoRefs.current.get(peerId);
        if (videoEl) {
          videoEl.srcObject = stream;
        }
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "ice-candidate",
          payload: {
            candidate: event.candidate.toJSON(),
            to: peerId,
            from: userId
          }
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`Connection state with ${peerId}:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // Clean up failed connection
        setRemoteStreams(prev => {
          const updated = new Map(prev);
          updated.delete(peerId);
          return updated;
        });
      }
    };

    peerConnections.current.set(peerId, { connection: pc, stream: null });
    return pc;
  };

  const createOffer = async (peerId: string) => {
    try {
      const pc = createPeerConnection(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "offer",
          payload: {
            offer: pc.localDescription?.toJSON(),
            to: peerId,
            from: userId
          }
        });
      }
    } catch (error) {
      console.error("Error creating offer:", error);
    }
  };

  const handleOffer = async (payload: { offer: RTCSessionDescriptionInit; from: string }) => {
    try {
      console.log("Received offer from:", payload.from);
      const pc = createPeerConnection(payload.from);
      await pc.setRemoteDescription(new RTCSessionDescription(payload.offer));
      
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "answer",
          payload: {
            answer: pc.localDescription?.toJSON(),
            to: payload.from,
            from: userId
          }
        });
      }
    } catch (error) {
      console.error("Error handling offer:", error);
    }
  };

  const handleAnswer = async (payload: { answer: RTCSessionDescriptionInit; from: string }) => {
    try {
      console.log("Received answer from:", payload.from);
      const peerData = peerConnections.current.get(payload.from);
      if (peerData) {
        await peerData.connection.setRemoteDescription(new RTCSessionDescription(payload.answer));
      }
    } catch (error) {
      console.error("Error handling answer:", error);
    }
  };

  const handleIceCandidate = async (payload: { candidate: RTCIceCandidateInit; from: string }) => {
    try {
      const peerData = peerConnections.current.get(payload.from);
      if (peerData && payload.candidate) {
        await peerData.connection.addIceCandidate(new RTCIceCandidate(payload.candidate));
      }
    } catch (error) {
      console.error("Error handling ICE candidate:", error);
    }
  };

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

      // If user is joining from notification, join that exact session
      if (sessionIdOverride) {
        setSessionId(sessionIdOverride);
        await joinSession(sessionIdOverride);
        return;
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
        
        // Notification is now handled automatically by database trigger
        // which includes the correct joinCall session ID in the link
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
        async (payload) => {
          await fetchParticipants();
          
          // When a new participant joins via database, also trigger connection
          if (payload.eventType === 'INSERT' && payload.new.user_id !== userId && localStream.current) {
            // Use polite peer pattern here too
            const shouldCreateOffer = userId < payload.new.user_id;
            if (shouldCreateOffer) {
              console.log("New participant detected via DB, creating offer to:", payload.new.user_id);
              setTimeout(() => createOffer(payload.new.user_id), 1000);
            }
          }
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
      // Compute 15-second threshold to filter stale participants
      const staleThreshold = new Date(Date.now() - 15000).toISOString();

      const { data, error } = await supabase
        .from("video_call_participants")
        .select("user_id, is_active, last_seen_at")
        .eq("session_id", sessionId)
        .eq("is_active", true)
        .gte("last_seen_at", staleThreshold);

      if (error) throw error;

      // Fetch user names and avatars
      const userIds = data?.map(p => p.user_id) || [];
      if (userIds.length === 0) {
        setParticipants([]);
        return;
      }

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
      
      // Create offers for existing participants we don't have connections with
      // Use polite peer pattern - only create offer if our ID is smaller
      const otherParticipants = participantsWithNames.filter(p => p.user_id !== userId);
      for (const participant of otherParticipants) {
        if (!peerConnections.current.has(participant.user_id) && localStream.current) {
          const shouldCreateOffer = userId < participant.user_id;
          if (shouldCreateOffer) {
            console.log("Creating offer to existing participant:", participant.user_id);
            await createOffer(participant.user_id);
          }
        }
      }
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
    if (isMobile) {
      toast.error("Screen sharing is not supported on mobile devices");
      return;
    }
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
        
        // Resume camera and replace track in peer connections
        if (localStream.current) {
          const videoTrack = localStream.current.getVideoTracks()[0];
          peerConnections.current.forEach(({ connection }) => {
            const sender = connection.getSenders().find(s => s.track?.kind === 'video');
            if (sender && videoTrack) {
              sender.replaceTrack(videoTrack);
            }
          });
          
          if (localVideoRef.current) {
            localVideoRef.current.srcObject = localStream.current;
          }
        }
        
        setIsScreenSharing(false);
        toast.success("Screen sharing stopped");
      } else {
        // Start screen sharing
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        
        screenStream.current = stream;
        const screenTrack = stream.getVideoTracks()[0];
        
        // Replace video track in all peer connections
        peerConnections.current.forEach(({ connection }) => {
          const sender = connection.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenTrack);
          }
        });
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        
        // Handle when user stops sharing via browser UI
        screenTrack.onended = () => {
          setIsScreenSharing(false);
          if (localStream.current) {
            const videoTrack = localStream.current.getVideoTracks()[0];
            peerConnections.current.forEach(({ connection }) => {
              const sender = connection.getSenders().find(s => s.track?.kind === 'video');
              if (sender && videoTrack) {
                sender.replaceTrack(videoTrack);
              }
            });
            if (localVideoRef.current) {
              localVideoRef.current.srcObject = localStream.current;
            }
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
    peerConnections.current.forEach(({ connection }) => connection.close());
    peerConnections.current.clear();

    // Unsubscribe from signaling channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    setRemoteStreams(new Map());
  };

  // Set ref for remote video element
  const setRemoteVideoRef = useCallback((userId: string, el: HTMLVideoElement | null) => {
    if (el) {
      remoteVideoRefs.current.set(userId, el);
      const stream = remoteStreams.get(userId);
      if (stream) {
        el.srcObject = stream;
      }
    } else {
      remoteVideoRefs.current.delete(userId);
    }
  }, [remoteStreams]);

  // Calculate grid layout based on participant count
  const getGridClass = () => {
    const count = participants.length;
    if (count <= 1) return "grid-cols-1";
    if (count === 2) return "grid-cols-1 sm:grid-cols-2";
    if (count <= 4) return "grid-cols-2";
    if (count <= 6) return "grid-cols-2 sm:grid-cols-3";
    return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";
  };

  // Get current user from participants
  const currentUser = participants.find(p => p.user_id === userId);
  const otherParticipants = participants.filter(p => p.user_id !== userId);

  return (
    <div className="video-call-container fixed inset-0 z-50 bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-card px-3 py-2 flex items-center justify-between shrink-0 safe-area-top border-b border-border">
        <button 
          onClick={endCall}
          className="p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted"
        >
          <X className="w-5 h-5" />
        </button>
        
        <div className="text-center flex-1">
          <h2 className="text-sm font-medium text-foreground truncate">{className || "Video Call"}</h2>
          <span className="text-xs text-muted-foreground">{callDuration}</span>
        </div>
        
        <button 
          onClick={() => setShowParticipants(!showParticipants)}
          className="p-2 text-muted-foreground hover:text-foreground rounded-full hover:bg-muted flex items-center gap-1"
        >
          <Users className="w-5 h-5" />
          <span className="text-xs">{participants.length}</span>
        </button>
      </div>

      {/* Video Grid - WhatsApp style */}
      <div className="flex-1 overflow-hidden p-2 bg-muted/30">
        <div className={`grid ${getGridClass()} gap-2 h-full auto-rows-fr`}>
          {/* Current user's video */}
          <div className="relative rounded-xl overflow-hidden bg-muted border-2 border-primary/60 min-h-[120px]">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover ${isVideoOff ? 'hidden' : ''}`}
            />
            {isVideoOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted">
                <Avatar className="w-14 h-14 sm:w-20 sm:h-20">
                  <AvatarImage src={currentUser?.avatar_url || ""} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-xl sm:text-2xl">
                    {currentUser?.full_name?.charAt(0).toUpperCase() || "Y"}
                  </AvatarFallback>
                </Avatar>
              </div>
            )}
            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
              <span className="text-xs font-medium text-primary-foreground bg-primary/80 px-2 py-0.5 rounded-full">
                You
              </span>
              {isMuted && (
                <span className="text-xs bg-destructive text-destructive-foreground px-1.5 py-0.5 rounded-full flex items-center">
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
          {otherParticipants.map((participant) => {
            const hasStream = remoteStreams.has(participant.user_id);
            return (
              <div 
                key={participant.user_id}
                className="relative rounded-xl overflow-hidden bg-muted border-2 border-accent/40 min-h-[120px]"
              >
                {hasStream ? (
                  <video
                    ref={(el) => setRemoteVideoRef(participant.user_id, el)}
                    autoPlay
                    playsInline
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-muted">
                    <div className="text-center">
                      <Avatar className="w-14 h-14 sm:w-20 sm:h-20 mx-auto">
                        <AvatarImage src={participant.avatar_url || ""} />
                        <AvatarFallback className="bg-accent text-accent-foreground text-xl sm:text-2xl">
                          {participant.full_name?.charAt(0).toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <p className="text-xs text-muted-foreground mt-2">Connecting...</p>
                    </div>
                  </div>
                )}
                <div className="absolute bottom-2 left-2 right-2">
                  <span className="text-xs font-medium text-accent-foreground bg-accent/80 px-2 py-0.5 rounded-full">
                    {participant.full_name || "Participant"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Participants panel (slide up on mobile) */}
      {showParticipants && (
        <div className="absolute bottom-20 left-0 right-0 bg-card rounded-t-2xl p-4 max-h-[40vh] overflow-y-auto animate-in slide-in-from-bottom z-10 shadow-lg border-t border-border">
          <div className="text-center mb-3">
            <span className="text-sm text-muted-foreground">{participants.length} in call</span>
          </div>
          <div className="space-y-2">
            {participants.map((participant) => (
              <div 
                key={participant.user_id}
                className="flex items-center gap-3 p-2 rounded-lg bg-muted"
              >
                <Avatar className="w-9 h-9">
                  <AvatarImage src={participant.avatar_url || ""} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                    {participant.full_name?.charAt(0).toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-foreground flex-1 truncate">
                  {participant.full_name || "Participant"}
                  {participant.user_id === userId && " (You)"}
                </span>
                {remoteStreams.has(participant.user_id) && participant.user_id !== userId && (
                  <span className="text-xs text-primary font-medium">Connected</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chat panel (slide up on mobile) - improved styling */}
      {showChat && (
        <div className="absolute bottom-20 left-0 right-0 bg-card rounded-t-2xl max-h-[50vh] flex flex-col animate-in slide-in-from-bottom z-10 shadow-lg border-t border-border">
          {/* Chat header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50 rounded-t-2xl">
            <span className="text-sm font-medium text-foreground">In-call Chat</span>
            <button 
              onClick={() => setShowChat(false)}
              className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          {/* Messages list */}
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3 min-h-[150px] max-h-[250px] bg-background/95">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-4">
                No messages yet. Say hi!
              </div>
            ) : (
              messages.map((msg) => (
                <div 
                  key={msg.id} 
                  className={`flex flex-col ${msg.senderId === userId ? 'items-end' : 'items-start'}`}
                >
                  {msg.senderId !== userId && (
                    <span className="text-xs text-muted-foreground mb-1">{msg.senderName}</span>
                  )}
                  <div 
                    className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm shadow-sm ${
                      msg.senderId === userId 
                        ? 'bg-primary text-primary-foreground rounded-br-md' 
                        : 'bg-muted text-foreground rounded-bl-md'
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className="text-xs text-muted-foreground mt-1">
                    {formatMessageTime(msg.timestamp)}
                  </span>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>
          
          {/* Message input */}
          <div className="p-3 border-t border-border bg-card flex items-center gap-2">
            <Input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              className="flex-1 bg-muted border-border text-foreground placeholder:text-muted-foreground text-sm"
            />
            <button
              onClick={sendChatMessage}
              disabled={!newMessage.trim()}
              className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Bottom control bar - WhatsApp style */}
      <div className="bg-card px-4 py-3 flex items-center justify-center gap-3 sm:gap-5 shrink-0 safe-area-bottom border-t border-border">
        <button
          onClick={toggleMute}
          className={`w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all ${
            isMuted 
              ? 'bg-destructive/20 text-destructive' 
              : 'bg-muted text-foreground hover:bg-muted/80'
          }`}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        <button
          onClick={toggleVideo}
          className={`w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all ${
            isVideoOff 
              ? 'bg-destructive/20 text-destructive' 
              : 'bg-muted text-foreground hover:bg-muted/80'
          }`}
          title={isVideoOff ? "Turn on camera" : "Turn off camera"}
        >
          {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
        </button>

        {/* Chat button with unread badge */}
        <button
          onClick={() => {
            setShowChat(!showChat);
            setShowParticipants(false);
          }}
          className={`relative w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all ${
            showChat 
              ? 'bg-primary text-primary-foreground' 
              : 'bg-muted text-foreground hover:bg-muted/80'
          }`}
          title="Chat"
        >
          <MessageCircle className="w-5 h-5" />
          {unreadCount > 0 && !showChat && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground text-xs rounded-full flex items-center justify-center font-medium">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        {canScreenShare && (
          <button
            onClick={toggleScreenShare}
            className={`w-11 h-11 sm:w-14 sm:h-14 rounded-full flex items-center justify-center transition-all ${
              isScreenSharing 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-muted text-foreground hover:bg-muted/80'
            }`}
            title={isScreenSharing ? "Stop sharing" : "Share screen"}
          >
            {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
          </button>
        )}

        <button
          onClick={endCall}
          className="w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center hover:bg-destructive/90 transition-all"
          title="End call"
        >
          <PhoneOff className="w-5 h-5 sm:w-6 sm:h-6" />
        </button>
      </div>
    </div>
  );
};

export default MultiUserVideoCall;
