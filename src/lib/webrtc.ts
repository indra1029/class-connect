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

/**
 * Creates a peer connection with proper ICE candidate queuing.
 * Candidates that arrive before remote description is set are queued
 * and flushed once the description is applied.
 */
export class ManagedPeerConnection {
  public pc: RTCPeerConnection;
  private candidateQueue: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;

  constructor(config?: RTCConfiguration) {
    this.pc = new RTCPeerConnection(config || iceServers);
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
    this.remoteDescriptionSet = true;
    // Flush queued candidates
    for (const candidate of this.candidateQueue) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn("Failed to add queued ICE candidate:", e);
      }
    }
    this.candidateQueue = [];
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (this.remoteDescriptionSet) {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      this.candidateQueue.push(candidate);
    }
  }

  close() {
    this.candidateQueue = [];
    this.remoteDescriptionSet = false;
    this.pc.close();
  }
}
