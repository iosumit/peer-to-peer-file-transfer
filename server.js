const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', ws => {
  ws.on('message', message => {
    // Broadcast the message to all connected clients for signaling
    // console.log(message)
    wss.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        console.log('received: %s', message);
        client.send(message);
      }
    });
  });
});

console.log('WebSocket signaling server running on ws://localhost:8080');
