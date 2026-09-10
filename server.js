const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PER_TEAM = 16;
const ROUND_TIME = 60; 
const rooms = {};

const questions = [
    { q: "กระแสไฟฟ้ามีหน่วยวัดเป็นอะไร?", choices: ["Volt", "Ampere", "Ohm", "Watt"], answer: 1 },
    { q: "เมืองหลวงของประเทศไทยคือเมืองใด?", choices: ["เชียงใหม่", "ภูเก็ต", "กรุงเทพมหานคร", "พัทยา"], answer: 2 },
    { q: "โลกหมุนรอบตัวเองใช้เวลากี่ชั่วโมง?", choices: ["12 ชั่วโมง", "24 ชั่วโมง", "30 วัน", "365 วัน"], answer: 1 },
    { q: "ข้อใดต่อไปนี้จัดเป็นสัตว์เลี้ยงลูกด้วยนม?", choices: ["ฉลาม", "จระเข้", "วาฬ", "เต่าทะเล"], answer: 2 },
    { q: "น้ำบริสุทธิ์ (H2O) ประกอบด้วยธาตุใดบ้าง?", choices: ["H และ O", "C และ O", "N และ O", "H และ C"], answer: 0 },
    { q: "ดาวเคราะห์ดวงใดมีขนาดใหญ่ที่สุดในระบบสุริยะ?", choices: ["โลก", "ดาวอังคาร", "ดาวพฤหัสบดี", "ดาวเสาร์"], answer: 2 },
    { q: "สัตว์ชนิดใดมีแปดขา?", choices: ["มด", "แมลงวัน", "แมงมุม", "ผึ้ง"], answer: 2 },
    { q: "ธาตุที่มีสัญลักษณ์เคมีว่า 'Fe' คืออะไร?", choices: ["ทองแดง", "ทองคำ", "เหล็ก", "สังกะสี"], answer: 2 },
    { q: "แสงเดินทางด้วยความเร็วประมาณเท่าใด?", choices: ["300,000 กม./วิ", "150,000 กม./วิ", "1,000,000 กม./วิ", "30,000 กม./วิ"], answer: 0 },
    { q: "อวัยวะใดของมนุษย์ทำหน้าที่สูบฉีดเลือด?", choices: ["ปอด", "ตับ", "หัวใจ", "ไต"], answer: 2 }
];

function getRandomQuestion() {
    return questions[Math.floor(Math.random() * questions.length)];
}

function generateRoomCode() {
    let code;
    do { code = Math.floor(100000 + Math.random() * 900000).toString(); } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    socket.on('create_room', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = { hostId: socket.id, players: {}, state: 'waiting', ropePosition: 50, botCount: 0, roundNumber: 1 };
        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
    });

    socket.on('join_room', ({ roomCode, name, team }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'waiting') return socket.emit('join_error', 'ไม่สามารถเข้าร่วมได้ในขณะนี้!');

        const teamPlayers = Object.values(room.players).filter(p => p.team === team && p.status === 'active');
        if (teamPlayers.length >= MAX_PER_TEAM) return socket.emit('join_error', `ทีมเต็มแล้ว!`);

        let freeSlot = 0;
        while (teamPlayers.map(p => p.slot).includes(freeSlot)) freeSlot++;

        room.players[socket.id] = { id: socket.id, name: name.trim() || 'Player', team, slot: freeSlot, status: 'active', isBot: false };
        socket.join(roomCode);
        socket.emit('join_success', { name: room.players[socket.id].name, team, slot: freeSlot, roomCode });
        updateLobby(roomCode);
    });

    socket.on('switch_team_direct', ({ roomCode, targetTeam }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'waiting') return;
        const player = room.players[socket.id];
        if (!player || player.team === targetTeam) return;

        const targetTeamPlayers = Object.values(room.players).filter(p => p.team === targetTeam && p.status === 'active');
        if (targetTeamPlayers.length >= MAX_PER_TEAM) return socket.emit('join_error', `ทีมเต็ม!`);

        let freeSlot = 0;
        while (targetTeamPlayers.map(p => p.slot).includes(freeSlot)) freeSlot++;

        player.team = targetTeam;
        player.slot = freeSlot;
        socket.emit('team_switched', { team: targetTeam, slot: freeSlot });
        updateLobby(roomCode);
    });

    socket.on('rejoin_team', ({ roomCode, team }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'waiting') return;
        const player = room.players[socket.id];
        if (!player || player.status !== 'survived') return;

        let freeSlot = 0;
        while (Object.values(room.players).filter(p => p.team === team && p.status === 'active').map(p => p.slot).includes(freeSlot)) freeSlot++;

        player.team = team; player.slot = freeSlot; player.status = 'active';
        socket.emit('join_success', { name: player.name, team, slot: freeSlot, roomCode });
        updateLobby(roomCode);
    });

    socket.on('add_bot', ({ roomCode, team }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id || room.state !== 'waiting') return;
        const teamPlayers = Object.values(room.players).filter(p => p.team === team && p.status === 'active');
        if (teamPlayers.length >= MAX_PER_TEAM) return;

        let freeSlot = 0;
        while (teamPlayers.map(p => p.slot).includes(freeSlot)) freeSlot++;

        room.botCount++;
        const botId = `bot_${Date.now()}_${room.botCount}`;
        room.players[botId] = { id: botId, name: `🤖 บอท ${room.botCount}`, team, slot: freeSlot, status: 'active', isBot: true };
        updateLobby(roomCode);
    });

    socket.on('start_match', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        room.state = 'playing'; room.ropePosition = 50;
        io.to(roomCode).emit('match_started');

        for (let pId in room.players) {
            if (!room.players[pId].isBot && room.players[pId].status === 'active') {
                io.to(pId).emit('new_question', getRandomQuestion());
            }
        }

        room.botInterval = setInterval(() => {
            if (room.state !== 'playing') return;
            let redForce = 0, blueForce = 0;

            Object.values(room.players).forEach(p => {
                if (p.isBot && p.status === 'active' && Math.random() > 0.45) {
                    p.team === 'RED' ? redForce += 1.8 : blueForce += 1.8;
                }
            });

            if (redForce > 0 || blueForce > 0) {
                room.ropePosition -= (redForce - blueForce);
                if (room.ropePosition < 5) room.ropePosition = 5;
                if (room.ropePosition > 95) room.ropePosition = 95;
                io.to(roomCode).emit('update_rope', { ropePosition: room.ropePosition });
            }
        }, 1500);

        let timeLeft = ROUND_TIME;
        clearInterval(room.timerInterval);
        room.timerInterval = setInterval(() => {
            timeLeft--;
            io.to(roomCode).emit('timer_tick', timeLeft);
            if (timeLeft <= 0) {
                clearInterval(room.timerInterval); clearInterval(room.botInterval);
                endRound(roomCode);
            }
        }, 1000);
    });

    socket.on('submit_answer', ({ roomCode, answerIndex, qText }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing') return;

        const player = room.players[socket.id];
        if (!player || player.status !== 'active') return;

        const originalQ = questions.find(q => q.q === qText);
        const isCorrect = originalQ && (answerIndex === originalQ.answer);
        let power = isCorrect ? 3.5 : 0;

        if (isCorrect) {
            player.team === 'RED' ? room.ropePosition -= power : room.ropePosition += power;
            if (room.ropePosition < 5) room.ropePosition = 5;
            if (room.ropePosition > 95) room.ropePosition = 95;
        }

        socket.emit('answer_result', { isCorrect, power });
        io.to(roomCode).emit('update_rope', { ropePosition: room.ropePosition, lastPuller: { id: player.id, name: player.name, team: player.team } });

        setTimeout(() => {
            if (room.state === 'playing' && player.status === 'active') socket.emit('new_question', getRandomQuestion());
        }, 1000);
    });

    function endRound(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        let winningTeam = room.ropePosition > 50 ? 'BLUE' : (room.ropePosition < 50 ? 'RED' : (Math.random() > 0.5 ? 'RED' : 'BLUE'));
        let realSurvivors = [];

        for (let pId in room.players) {
            let p = room.players[pId];
            if (p.isBot) { delete room.players[pId]; continue; }
            if (p.team === winningTeam) {
                p.status = 'survived'; p.team = null; realSurvivors.push(p);
            } else {
                p.status = 'eliminated'; io.to(pId).emit('eliminated');
            }
        }

        if (realSurvivors.length === 1) {
            room.state = 'ended'; io.to(roomCode).emit('champion', { name: realSurvivors[0].name });
        } else if (realSurvivors.length > 1) {
            room.state = 'waiting'; room.roundNumber++;
            realSurvivors.forEach(p => io.to(p.id).emit('pick_team_again'));
            io.to(roomCode).emit('round_end', { winningTeam, survivors: realSurvivors.length, roundNumber: room.roundNumber });
            updateLobby(roomCode);
        } else {
            room.state = 'ended'; io.to(roomCode).emit('game_over');
        }
    }

    function updateLobby(roomCode) {
        if (!rooms[roomCode]) return;
        const activePlayers = Object.values(rooms[roomCode].players).filter(p => p.team !== null && p.status === 'active');
        io.to(roomCode).emit('update_lobby', { players: activePlayers });
    }

    socket.on('disconnect', () => {
        for (let code in rooms) {
            if (rooms[code].players[socket.id]) {
                delete rooms[code].players[socket.id];
                updateLobby(code);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server Live on Port ${PORT}`));
