const fileInput = document.getElementById('fileInput');
const sendButton = document.getElementById('sendButton');
const statusT = document.getElementById('status');
const downloadLink = document.getElementById('downloadLink');

let peerConnection;
let dataChannel;
let fileReader;
let signalingWebSocket = new WebSocket('ws://ec2-65-0-45-67.ap-south-1.compute.amazonaws.com:8080');
let chunkSize = 16384; // Size of each data chunk for file transfer
let iceCandidateQueue = [];
let remoteDescriptionSet = false;

// Google STUN server for NAT traversal
const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.l.google.com:5349" },
    { urls: "stun:stun1.l.google.com:3478" },
    { urls: "stun:stun1.l.google.com:5349" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:5349" },
    { urls: "stun:stun3.l.google.com:3478" },
    { urls: "stun:stun3.l.google.com:5349" },
    { urls: "stun:stun4.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:5349" }
  ]
};

// Handle signaling messages
signalingWebSocket.onmessage = async (message) => {
  // Check if the received message is a Blob
  if (message.data instanceof Blob) {
    // Use a FileReader to convert Blob to a string (or ArrayBuffer depending on your use case)
    const reader = new FileReader();
    
    reader.onload =async function(event) {
      // Parse the message content once FileReader has read the Blob
      console.log("On Socket Message", event.target.result);
      const messageData = JSON.parse(event.target.result);
      
      // Handle signaling messages (offer, answer, candidates)
      if (messageData.offer) {
        console.log("Recieved Offer")
        await handleOffer(messageData.offer);
      } else if (messageData.answer) {
        console.log("Recieved Answer")
        await handleAnswer(messageData.answer);
      } else if (messageData.candidate) {
        console.log("Recieved Candidate")
        await handleNewICECandidate(messageData.candidate);
      }
    };
    // Read the Blob as a text (because it's supposed to be signaling data in JSON format)
    reader.readAsText(message.data);
  } else {
    // If message is not a Blob, proceed as usual
    const data = JSON.parse(message.data);
    if (data.offer) {
      await handleOffer(data.offer);
    } else if (data.answer) {
      await handleAnswer(data.answer);
    } else if (data.candidate) {
      await handleNewICECandidate(data.candidate);
    }
  }
};


// Enable file sending when a file is selected
fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    sendButton.disabled = false;
  }
});

// Send file when the button is clicked
sendButton.addEventListener('click', () => {
  const file = fileInput.files[0];
  if (file) {
    sendFile(file);
  }
});

// Create WebRTC PeerConnection and setup data channel for file transfer
async function createPeerConnection() {
  peerConnection = new RTCPeerConnection(configuration);

  // Setup ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("Sending Candidate", event.candidate)
      signalingWebSocket.send(JSON.stringify({ candidate: event.candidate }));
    }
  };

  // Create data channel for sending file
  dataChannel = peerConnection.createDataChannel('fileTransfer');
  dataChannel.binaryType = 'arraybuffer';
  dataChannel.onopen = () => statusT.innerText = 'Data channel open!';
  dataChannel.onclose = () => statusT.innerText = 'Data channel closed!';
  
console.log("Creating Peer");

  // Send offer
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  console.log("Creating Offer", offer)

  signalingWebSocket.onopen = async () => {
    console.log('WebSocket connected!');
    signalingWebSocket.send(JSON.stringify({ offer }));
    console.log("Sending Offer");
  };



  // Handle incoming data channel
  peerConnection.ondatachannel = (event) => {
    const receiveChannel = event.channel;
    receiveChannel.binaryType = 'arraybuffer';
    let receivedChunks = [];

    receiveChannel.onmessage = (e) => {
      if (e.data.byteLength > 0) {
        receivedChunks.push(e.data);
      } else {
        // End of file transfer, reconstruct the file
        const receivedFile = new Blob(receivedChunks);
        const downloadUrl = URL.createObjectURL(receivedFile);
        const anchor = document.createElement('a');
        anchor.href = downloadUrl;
        anchor.download = 'received_file';
        anchor.textContent = 'Download the received file';
        downloadLink.appendChild(anchor);
        statusT.innerText = 'File received!';
      }
    };
  };
}

// Handle incoming offer from the remote peer
async function handleOffer(offer) {
  peerConnection = new RTCPeerConnection(configuration);
  console.log('Received Offer:', offer); // Debug: Log the offer
  
  // Create answer for the offer
  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  signalingWebSocket.send(JSON.stringify({ answer }));

  console.log('Sent Answer:', answer); // Debug: Log the answer


  // Mark the remote description as set and process any queued ICE candidates
  remoteDescriptionSet = true;
  while (iceCandidateQueue.length) {
    await peerConnection.addIceCandidate(iceCandidateQueue.shift());
  }

  // Setup ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      signalingWebSocket.send(JSON.stringify({ candidate: event.candidate }));
    }
  };

  // Handle incoming data channel for receiving file
  peerConnection.ondatachannel = (event) => {
    const receiveChannel = event.channel;
    receiveChannel.binaryType = 'arraybuffer';
    let receivedChunks = [];

    receiveChannel.onmessage = (e) => {
      if (e.data.byteLength > 0) {
        receivedChunks.push(e.data);
      } else {
        // End of file transfer
        const receivedFile = new Blob(receivedChunks);
        const downloadUrl = URL.createObjectURL(receivedFile);
        const anchor = document.createElement('a');
        anchor.href = downloadUrl;
        anchor.download = 'received_file';
        anchor.textContent = 'Download the received file';
        downloadLink.appendChild(anchor);
        statusT.innerText = 'File received!';
      }
    };
  };
}

// Handle incoming answer from the remote peer
async function handleAnswer(answer) {
  await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

  // Mark the remote description as set and process any queued ICE candidates
  remoteDescriptionSet = true;
  while (iceCandidateQueue.length) {
    await peerConnection.addIceCandidate(iceCandidateQueue.shift());
  }
}

// Handle ICE candidates
async function handleNewICECandidate(candidate) {
  console.log("Add Candidate", candidate, peerConnection)
  const iceCandidate = new RTCIceCandidate(candidate);
  if (remoteDescriptionSet) {
    // Add the ICE candidate if the remote description is already set
    await peerConnection.addIceCandidate(iceCandidate);
  } else {
    // Queue the ICE candidate until the remote description is set
    iceCandidateQueue.push(iceCandidate);
  }
}

// Function to send file
function sendFile(file) {
  statusT.innerText = 'Sending file...';
  const fileReader = new FileReader();
  let offset = 0;

  fileReader.onload = (event) => {
    dataChannel.send(event.target.result); // Send file chunk
    offset += event.target.result.byteLength;

    if (offset < file.size) {
      readSlice(offset); // Read next chunk
    } else {
      dataChannel.send(new ArrayBuffer(0)); // End of file signal
      statusT.innerText = 'File sent!';
    }
  };

  const readSlice = (offset) => {
    const slice = file.slice(offset, offset + chunkSize);
    fileReader.readAsArrayBuffer(slice);
  };

  readSlice(0); // Start reading file
}

// Initialize the peer connection
createPeerConnection();
