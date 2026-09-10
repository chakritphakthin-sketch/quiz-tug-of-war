const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PER_TEAM = 16;
const rooms = {};

const questions = [
    { q: "กระแสไฟฟ้ามีหน่วยเป็นอะไร?", choices: ["Volt", "Ampere", "Ohm", "Watt"], answer: 1 },
    { q: "เมืองหลวงของประเทศไทยคือ?", choices: ["เชียงใหม่", "ภูเก็ต", "กรุงเทพฯ", "พัทยา"], answer: 2 },
    { q: "โลกหมุนรอบตัวเองใช้เวลาเท่าไร?", choices: ["12 ชั่วโมง", "24 ชั่วโมง", "30 วัน", "365 วัน"], answer: 1 },
    { q: "ข้อใดคือสัตว์เลี้ยงลูกด้วยนม?", choices: ["ฉลาม", "จระเข้", "วาฬ", "เต่า"], answer: 2 },
    { q: "น้ำประกอบด้วยธาตุอะไรบ้าง?", choices: ["H และ O", "C และ O", "N และ O", "H และ C"], answer: 0 }
];

function generateRoomCode() {
    let code;
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    socket.on('create_room', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostId: socket.id,
            players: {},
            state: 'waiting',
            currentQ: 0,
            ropePosition: 50,
            redTotalPower: 0,
            blueTotalPower: 0
        };
        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
    });

    socket.on('join_room', ({ roomCode, name, team }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('join_error', 'ไม่พบห้องนี้!');
        if (room.state !== 'waiting') return socket.emit('join_error', 'การแข่งขันเริ่มไปแล้ว!');

        const teamPlayers = Object.values(room.players).filter(p => p.team === team);
        if (teamPlayers.length >= MAX_PER_TEAM) {
            return socket.emit('join_error', `ทีม ${team === 'RED' ? 'แดง' : 'น้ำเงิน'} เต็มแล้ว!`);
        }

        const takenSlots = teamPlayers.map(p => p.slot);
        let freeSlot = 0;
        while (takenSlots.includes(freeSlot)) freeSlot++;

        room.players[socket.id] = {
            id: socket.id,
            name: name.trim() || 'นักสู้ไร้นาม',
            team: team,
            slot: freeSlot,
            roomCode: roomCode,
            hasAnswered: false
        };

        socket.join(roomCode);
        socket.emit('join_success', { 
            id: socket.id,
            name: room.players[socket.id].name, 
            team, 
            roomCode, 
            slot: freeSlot 
        });

        io.to(roomCode).emit('update_lobby', {
            players: Object.values(room.players),
            maxPerTeam: MAX_PER_TEAM,
            ropePosition: room.ropePosition
        });
    });

    socket.on('switch_team', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'waiting') return;
        const player = room.players[socket.id];
        if (!player) return;

        const newTeam = player.team === 'RED' ? 'BLUE' : 'RED';
        const teamPlayers = Object.values(room.players).filter(p => p.team === newTeam);
        if (teamPlayers.length >= MAX_PER_TEAM) {
            return socket.emit('join_error', `ทีม ${newTeam === 'RED' ? 'แดง' : 'น้ำเงิน'} เต็มแล้ว!`);
        }

        const takenSlots = teamPlayers.map(p => p.slot);
        let freeSlot = 0;
        while (takenSlots.includes(freeSlot)) freeSlot++;

        player.team = newTeam;
        player.slot = freeSlot;

        socket.emit('team_switched', { team: newTeam, slot: freeSlot });

        io.to(roomCode).emit('update_lobby', {
            players: Object.values(room.players),
            maxPerTeam: MAX_PER_TEAM,
            ropePosition: room.ropePosition
        });
    });

    socket.on('start_match', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        room.state = 'playing';
        room.currentQ = 0;
        sendQuestion(roomCode);
    });

    function sendQuestion(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        room.ropePosition = 50;
        room.redTotalPower = 0;
        room.blueTotalPower = 0;
        room.questionStartTime = Date.now();

        for (let id in room.players) {
            room.players[id].hasAnswered = false;
        }

        io.to(roomCode).emit('new_question', {
            questionIndex: room.currentQ,
            questionData: questions[room.currentQ]
        });

        let timeLeft = 15;
        clearInterval(room.timerInterval);
        room.timerInterval = setInterval(() => {
            timeLeft--;
            io.to(roomCode).emit('timer_tick', timeLeft);

            if (timeLeft <= 0) {
                clearInterval(room.timerInterval);
                endQuestion(roomCode);
            }
        }, 1000);
    }

    socket.on('submit_answer', ({ roomCode, answerIndex }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing') return;

        const player = room.players[socket.id];
        if (!player || player.hasAnswered) return;

        player.hasAnswered = true;
        let timeTaken = (Date.now() - room.questionStartTime) / 1000;
        if (timeTaken > 15) timeTaken = 15;

        const isCorrect = (answerIndex === questions[room.currentQ].answer);
        let power = 0;

        if (isCorrect) {
            power = Math.round((100 * ((15 - timeTaken) / 15)) * 10) / 10;
        }

        if (player.team === 'RED') {
            room.redTotalPower += power;
            room.ropePosition -= (power * 0.12);
        } else {
            room.blueTotalPower += power;
            room.ropePosition += (power * 0.12);
        }

        if (room.ropePosition < 5) room.ropePosition = 5;
        if (room.ropePosition > 95) room.ropePosition = 95;

        socket.emit('answer_result', { isCorrect, power });

        io.to(roomCode).emit('update_rope', {
            ropePosition: room.ropePosition,
            lastPuller: { name: player.name, team: player.team, power }
        });
    });

    socket.on('next_question', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        room.currentQ++;
        if (room.currentQ < questions.length) {
            sendQuestion(roomCode);
        } else {
            io.to(roomCode).emit('game_over');
        }
    });

    socket.on('disconnect', () => {
        for (let code in rooms) {
            const room = rooms[code];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                io.to(code).emit('update_lobby', {
                    players: Object.values(room.players),
                    maxPerTeam: MAX_PER_TEAM,
                    ropePosition: room.ropePosition
                });
            }
        }
    });
});

function endQuestion(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    io.to(roomCode).emit('question_end', {
        redTotalPower: Math.round(room.redTotalPower),
        blueTotalPower: Math.round(room.blueTotalPower),
        winner: room.redTotalPower > room.blueTotalPower ? 'RED' : (room.blueTotalPower > room.redTotalPower ? 'BLUE' : 'DRAW')
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
