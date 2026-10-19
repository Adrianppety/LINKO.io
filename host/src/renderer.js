import { electronAPI } from './preload.js';

// DOM Elements
const roomIdInput = document.getElementById('roomId');
const userIdInput = document.getElementById('userId');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const inputBtn = document.getElementById('inputBtn');
const statusEl = document.getElementById('status');
const localVideo = document.getElementById('localVideo');

// State variables
let socket = null;
let peerConnections = new Map();
let localStream = null;
let remoteStreams = new Map();
let dataChannels = new Map();
let isHost = false;
let roomId = '';
let userId = '';
let inputEnabled = false;

// Initialize Electron API
const { startScreenShare, stopScreenShare, captureScreen, injectInput, onInputError } = electronAPI;

// Update status display
function updateStatus(message, type = 'info') {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;

    switch(type) {
        case 'connected':
            statusEl.classList.add('connected');
            break;
        case 'disconnected':
            statusEl.classList.add('disconnected');
            break;
        case 'connecting':
            statusEl.classList.add('connecting');
            break;
        default:
            statusEl.classList.remove('connected', 'disconnected', 'connecting');
    }
}

// Handle input injection from renderer
async function handleInputEvent(eventData) {
    try {
        await injectInput(eventData);
    } catch (error) {
        console.error('Input injection error:', error);
        updateStatus(`Input error: ${error.message}`, 'error');
    }
}

// Setup socket connection
function setupSocket(roomId, userId) {
    socket = io('http://localhost:3000', {
        transports: ['websocket']
    });

    socket.on('connect', () => {
        console.log('Connected to signaling server');
        socket.emit('join-room', roomId, userId);
        updateStatus('Joining room...', 'connecting');
    });

    socket.on('user-connected', (userId, socketId) => {
        console.log('User connected:', userId, socketId);
        createPeerConnection(socketId, true); // We're the initiator for new users
    });

    socket.on('user-disconnected', (socketId) => {
        console.log('User disconnected:', socketId);
        cleanupPeerConnection(socketId);
    });

    socket.on('offer', async (offer, senderId) => {
        console.log('Received offer from:', senderId);
        const peerConnection = peerConnections.get(senderId) ||
                              createPeerConnection(senderId, false);

        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            socket.emit('answer', roomId, answer, userId, senderId);
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    });

    socket.on('answer', async (answer, senderId) => {
        console.log('Received answer from:', senderId);
        const peerConnection = peerConnections.get(senderId);
        if (peerConnection) {
            try {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            } catch (error) {
                console.error('Error setting remote description:', error);
            }
        }
    });

    socket.on('ice-candidate', async (candidate, senderId) => {
        try {
            const peerConnection = peerConnections.get(senderId);
            if (peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    });

    socket.on('input-event', (eventData, senderId) => {
        // Forward input events to local injection (for host)
        handleInputEvent(eventData);
    });

    socket.on('chat-message', (message, senderId) => {
        // Handle chat messages (could display in UI)
        console.log('Chat from', senderId, ':', message);
    });
}

// Create a new peer connection
function createPeerConnection(peerId, isInitiator = false) {
    console.log('Creating peer connection for:', peerId, 'isInitiator:', isInitiator);

    const peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    });

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', roomId, event.candidate, userId, peerId);
        }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = (event) => {
        console.log('Connection state changed:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'failed') {
            // Attempt restart or notify user
            console.log('Connection failed for peer:', peerId);
        }
    };

    // Handle incoming streams
    peerConnection.ontrack = (event) => {
        console.log('Received track from:', peerId);
        const stream = event.streams[0];
        remoteStreams.set(peerId, stream);
        // In host, we might want to display a preview of what others see
        // For now, we just store it
    };

    // Create data channel for input events if we're the initiator
    if (isInitiator) {
        const dataChannel = peerConnection.createDataChannel('input');
        setupDataChannel(dataChannel, peerId);
        dataChannels.set(peerId, dataChannel);
    } else {
        // Listen for incoming data channels
        peerConnection.ondatachannel = (event) => {
            const dataChannel = event.channel;
            setupDataChannel(dataChannel, peerId);
            dataChannels.set(peerId, dataChannel);
        };
    }

    peerConnections.set(peerId, peerConnection);
    return peerConnection;
}

// Setup data channel handlers
function setupDataChannel(dataChannel, peerId) {
    dataChannel.onopen = () => {
        console.log('Data channel opened for:', peerId);
    };

    dataChannel.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            // For host, we receive input from clients and inject locally
            handleInputEvent(data);
        } catch (err) {
            console.error('Error parsing data channel message:', err);
        }
    };

    dataChannel.onclose = () => {
        console.log('Data channel closed for:', peerId);
        dataChannels.delete(peerId);
    };

    dataChannel.onerror = (err) => {
        console.error('Data channel error:', err);
    };
}

// Start local screen sharing
async function startLocalStream() {
    try {
        // Get screen share with audio
        const displayMediaOptions = {
            video: {
                cursor: "always"
            },
            audio: true
        };

        localStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

        // Also get microphone input for voice chat
        try {
            const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

            // Combine video from screen and audio from mic
            if (localStream && audioStream) {
                const combinedStream = new MediaStream([
                    ...localStream.getVideoTracks(),
                    ...audioStream.getAudioTracks()
                ]);
                localStream = combinedStream;
            }
        } catch (audioError) {
            console.warn('Could not get audio stream:', audioError);
            // Continue with just video
        }

        // Add local stream to all peer connections
        peerConnections.forEach((pc, peerId) => {
            localStream.getTracks().forEach(track => {
                pc.addTrack(track, localStream);
            });
        });

        // Display local video preview
        if (localVideo) {
            localVideo.srcObject = localStream;
        }

        console.log('Local stream started');
        return localStream;
    } catch (err) {
        console.error('Error accessing media devices:', err);
        throw err;
    }
}

// Stop local stream
function stopLocalStream() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    // Remove tracks from peer connections
    peerConnections.forEach(pc => {
        pc.getSenders().forEach(sender => {
            if (sender.track) {
                pc.removeTrack(sender);
            }
        });
    });

    if (localVideo) {
        localVideo.srcObject = null;
    }
}

// Send input event via data channel
function sendInputEvent(eventData, peerId) {
    const dataChannel = dataChannels.get(peerId);
    if (dataChannel && dataChannel.readyState === 'open') {
        try {
            dataChannel.send(JSON.stringify(eventData));
        } catch (err) {
            console.error('Error sending data channel message:', err);
        }
    }
}

// Broadcast input event to all peers
function broadcastInputEvent(eventData) {
    peerConnections.forEach((_, peerId) => {
        sendInputEvent(eventData, peerId);
    });
}

// Clean up peer connection
function cleanupPeerConnection(peerId) {
    const peerConnection = peerConnections.get(peerId);
    if (peerConnection) {
        peerConnection.close();
        peerConnections.delete(peerId);
    }
    remoteStreams.delete(peerId);
    dataChannels.delete(peerId);
}

// Leave room and clean up
async function leaveRoom() {
    if (socket) {
        socket.emit('leave-room', roomId, userId);
        socket.disconnect();
        socket = null;
    }

    // Close all peer connections
    peerConnections.forEach((_, peerId) => {
        cleanupPeerConnection(peerId);
    });

    stopLocalStream();
    updateStatus('Disconnected', 'disconnected');

    // Reset UI
    startBtn.disabled = false;
    stopBtn.disabled = true;
    inputBtn.disabled = true;
}

// Event Listeners
startBtn.addEventListener('click', async () => {
    roomId = roomIdInput.value.trim();
    userId = userIdInput.value.trim() || `user-${Math.random().toString(36).substring(2, 9)}`;

    if (!roomId) {
        updateStatus('Please enter a room ID', 'error');
        return;
    }

    try {
        updateStatus('Connecting...', 'connecting');
        startBtn.disabled = true;

        // Setup socket connection
        setupSocket(roomId, userId);

        // Start local stream
        await startLocalStream();

        updateStatus('Connected', 'connected');
        stopBtn.disabled = false;
        inputBtn.disabled = false;

        // We're the host if we created the room (simplified)
        isHost = true;
    } catch (error) {
        console.error('Error starting screen share:', error);
        updateStatus(`Error: ${error.message}`, 'error');
        startBtn.disabled = false;
    }
});

stopBtn.addEventListener('click', async () => {
    await leaveRoom();
});

inputBtn.addEventListener('click', () => {
    inputEnabled = !inputEnabled;
    inputBtn.textContent = inputEnabled ? 'Disable Input' : 'Enable Input';
    updateStatus(inputEnabled ? 'Input ENABLED' : 'Input DISABLED',
                inputEnabled ? 'connected' : 'connected');
});

// Handle input errors from main process
onInputError((event, errorMessage) => {
    console.error('Input error from main:', errorMessage);
    updateStatus(`Input error: ${errorMessage}`, 'error');
});

// Handle window close
window.addEventListener('beforeunload', () => {
    leaveRoom();
});