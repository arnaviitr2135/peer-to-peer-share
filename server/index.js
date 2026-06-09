const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = require("socket.io")(server, {
  cors: {
    origin: "*", // Allows your Vercel frontend to connect
    methods: ["GET", "POST"]
  }
});

// We will store active rooms in memory (No database needed as per requirements)
const rooms = new Map();

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // When the sender creates a new share room
    socket.on('create-room', (roomId) => {
        rooms.set(roomId, { sender: socket.id, receiver: null });
        socket.join(roomId);
        console.log(`Room created: ${roomId} by ${socket.id}`);
    });

    // When the receiver joins the room via the link
    socket.on('join-room', (roomId) => {
        const room = rooms.get(roomId);
        if (room && !room.receiver) {
            room.receiver = socket.id;
            socket.join(roomId);
            // Notify the sender that the receiver is here
            socket.to(room.sender).emit('receiver-joined', socket.id);
            console.log(`Receiver ${socket.id} joined room: ${roomId}`);
        } else {
            socket.emit('error', 'Room is invalid or already full.');
        }
    });

    // WebRTC Signaling Events (Passing the connection data between peers)
    socket.on('offer', (payload) => {
        io.to(payload.target).emit('offer', payload);
    });

    socket.on('answer', (payload) => {
        io.to(payload.target).emit('answer', payload);
    });

    socket.on('ice-candidate', (payload) => {
        io.to(payload.target).emit('ice-candidate', payload);
    });

    // Handle user disconnecting (closing tab, losing internet)
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        socket.broadcast.emit('peer-disconnected');
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Signaling Server running on port ${PORT}`);
});