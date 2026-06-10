const { PeerServer } = require('peer');

const PORT = process.env.PORT || 9000;

const peerServer = PeerServer({
  port: PORT,
  path: '/',
  corsOptions: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

peerServer.on('connection', (client) => {
  console.log(`[+] Client connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`[-] Client disconnected: ${client.getId()}`);
});

console.log(`[SyncDrop] PeerJS Signaling Server running on port ${PORT}`);
