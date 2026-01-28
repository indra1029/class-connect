// Shared WebRTC utilities for the app (Class calls + CR calls)

export const isScreenShareSupported = () => {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function"
  );
};

// ICE servers configuration for WebRTC with TURN servers for NAT traversal
export const iceServers: RTCConfiguration = {
  iceServers: [
    // STUN servers
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },

    // Free public TURN servers (Metered.ca free tier)
    {
      urls: "turn:a.relay.metered.ca:80",
      username: "e8dd65a92d3b6b9f8c4e2b1a",
      credential: "kNxV+5Yd/hK3HmPq",
    },
    {
      urls: "turn:a.relay.metered.ca:80?transport=tcp",
      username: "e8dd65a92d3b6b9f8c4e2b1a",
      credential: "kNxV+5Yd/hK3HmPq",
    },
    {
      urls: "turn:a.relay.metered.ca:443",
      username: "e8dd65a92d3b6b9f8c4e2b1a",
      credential: "kNxV+5Yd/hK3HmPq",
    },
    {
      urls: "turn:a.relay.metered.ca:443?transport=tcp",
      username: "e8dd65a92d3b6b9f8c4e2b1a",
      credential: "kNxV+5Yd/hK3HmPq",
    },

    // Backup TURN servers (Open Relay Project)
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
    {
      urls: "turn:openrelay.metered.ca:443?transport=tcp",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
  iceCandidatePoolSize: 10,
};
