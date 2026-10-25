// Public connection settings only. Never put long-lived TURN secrets in a static site.
// PeerServer introduces browsers; no game state is sent to it.
export const PEER_OPTIONS = {
  host: '0.peerjs.com', port: 443, path: '/', secure: true,
  config: {iceServers: [{urls: 'stun:stun.l.google.com:19302'}, {urls:'stun:stun1.l.google.com:19302'}]}
};
