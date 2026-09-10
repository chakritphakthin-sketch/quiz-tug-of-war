const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MATCH_DURATION = 100;
const rooms = {}; 

const questions = [
    { q: "กระแสไฟฟ้ามีหน่วยเป็นอะไร?", choices: ["Volt", "Ampere", "Ohm", "Watt"], answer: 1 },
    { q: "เมืองหลวงของประเทศไทยคือ?", choices: ["เชียงใหม่", "ภูเก็ต", "กรุงเทพฯ", "พัทยา"], answer: 2 },
    { q: "โลกหมุนรอบตัวเองใช้เวลาเท่าไร?", choices: ["12 ชั่วโมง", "24 ชั่วโมง", "30 วัน", "365 วัน"], answer: 1 },
    { q: "ข้อใดคือสัตว์เลี้ยงลูกด้วยนม?", choices: ["ฉลาม", "จระเข้", "วาฬ", "เต่า"], answer: 2 },
    { q: "น้ำประกอบด้วยธาตุอะไรบ้าง?", choices: ["H และ O", "C และ O", "N และ O", "H และ C"], answer: 0 },
    { q: "ดาวเคราะห์ดวงใดใหญ่ที่สุดในระบบสุริยะ?", choices: ["โลก", "ดาวพฤหัสบดี", "ดาวเสาร์", "ดาวอังคาร"], answer: 1 }
];

function generateRoomCode() {
    let code;
    do { code = Math.floor(100000 + Math.random() * 900000).toString(); } while (rooms[code]);
    return code;
}

// ฟังก์ชั่นจัดทีมให้บอทอัตโนมัติ
function autoAssignBots(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    Object.values(room.players).forEach(p => {
        if (p.isBot && !p.team) {
            const redCount = Object.values(room.players).filter(pl => pl.team === 'RED').length;
            const blueCount = Object.values(room.players).filter(pl => pl.team === 'BLUE').length;

            let chosenTeam = null;
            if (redCount < room.maxPerTeam && blueCount < room.maxPerTeam) {
                chosenTeam = redCount <= blueCount ? 'RED' : 'BLUE';
            } else if (redCount < room.maxPerTeam) {
                chosenTeam = 'RED';
            } else if (blueCount < room.maxPerTeam) {
                chosenTeam = 'BLUE';
            }

            if (chosenTeam) {
                const teamPlayers = Object.values(room.players).filter(pl => pl.team === chosenTeam);
                const takenSlots = teamPlayers.map(pl => pl.slot);
                let freeSlot = 0; while (takenSlots.includes(freeSlot)) freeSlot++;
                p.team = chosenTeam;
                p.slot = freeSlot;
            }
        }
    });
}

io.on('connection', (socket) => {
    socket.on('create_room', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = { hostId: socket.id, players: {}, state: 'waiting', ropePosition: 50, timeLeft: MATCH_DURATION, timerInterval: null, botInterval: null, maxPerTeam: 16 };
        socket.join(roomCode);
        socket.emit('room_created', { roomCode, maxPerTeam: 16 });
    });

    socket.on('join_room', ({ roomCode, name, team }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('join_error', 'ไม่พบห้องนี้!');
        if (room.state === 'playing') return socket.emit('join_error', 'กำลังแข่งขันอยู่ ไม่สามารถเข้าได้!');

        const teamPlayers = Object.values(room.players).filter(p => p.team === team);
        if (teamPlayers.length >= room.maxPerTeam) return socket.emit('join_error', `ทีม ${team} เต็มโควต้าแล้ว!`);

        const takenSlots = teamPlayers.map(p => p.slot);
        let freeSlot = 0; while (takenSlots.includes(freeSlot)) freeSlot++;

        room.players[socket.id] = { id: socket.id, name: name.trim() || 'Player', team: team, slot: freeSlot, qIndex: 0, qStartTime: 0, isBot: false };

        socket.join(roomCode);
        socket.emit('join_success', { name: room.players[socket.id].name, team, roomCode });
        io.to(roomCode).emit('update_lobby', { players: Object.values(room.players), maxPerTeam: room.maxPerTeam });
    });

    socket.on('kick_player', ({ roomCode, playerId }) => {
        const room = rooms[roomCode];
        if (room && room.players[playerId] && room.hostId === socket.id) {
            if (!room.players[playerId].isBot) io.to(playerId).emit('kicked');
            delete room.players[playerId];
            io.to(roomCode).emit('update_lobby', { players: Object.values(room.players), maxPerTeam: room.maxPerTeam });
        }
    });

    socket.on('leave_room', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (room && room.players[socket.id]) {
            delete room.players[socket.id];
            io.to(roomCode).emit('update_lobby', { players: Object.values(room.players), maxPerTeam: room.maxPerTeam });
        }
    });

    socket.on('add_bot', ({ roomCode, team }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        
        const teamPlayers = Object.values(room.players).filter(p => p.team === team);
        if (teamPlayers.length >= room.maxPerTeam) return;

        const takenSlots = teamPlayers.map(p => p.slot);
        let freeSlot = 0; while (takenSlots.includes(freeSlot)) freeSlot++;

        const botId = 'bot_' + Math.random().toString(36).substring(2, 9);
        room.players[botId] = { id: botId, name: '🤖 Bot_' + Math.floor(Math.random()*999), team: team, slot: freeSlot, isBot: true };
        io.to(roomCode).emit('update_lobby', { players: Object.values(room.players), maxPerTeam: room.maxPerTeam });
    });

    socket.on('select_team_next_round', ({ roomCode, team }) => {
        const room = rooms[roomCode];
        if (!room || !room.players[socket.id]) return;

        const teamPlayers = Object.values(room.players).filter(p => p.team === team);
        if (teamPlayers.length >= room.maxPerTeam) return socket.emit('join_error', `ทีม ${team} เต็มแล้ว! (รับได้ฝั่งละ ${room.maxPerTeam} คน)`);

        let freeSlot = 0; while (teamPlayers.map(p => p.slot).includes(freeSlot)) freeSlot++;
        room.players[socket.id].team = team; room.players[socket.id].slot = freeSlot;

        socket.emit('team_selected_success', { team });
        io.to(roomCode).emit('update_lobby', { players: Object.values(room.players), maxPerTeam: room.maxPerTeam });
    });

    socket.on('start_match', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        // จัดการบอทที่ยังตกค้างไม่มีทีมให้อยู่อัตโนมัติก่อนเริ่ม
        autoAssignBots(roomCode);

        if (Object.values(room.players).some(p => !p.team)) {
            return socket.emit('start_error', 'ยังมีผู้เล่น (คนจริง) ที่ยังไม่ได้เลือกทีม!');
        }

        room.state = 'playing'; room.ropePosition = 50; room.timeLeft = MATCH_DURATION;

        for (let id in room.players) {
            if(!room.players[id].isBot) {
                room.players[id].qIndex = 0; room.players[id].qStartTime = Date.now();
                io.to(id).emit('start_player_stream', { qIndex: 0, totalQuestions: questions.length, qData: questions[0] });
            }
        }
        io.to(roomCode).emit('match_started', { duration: MATCH_DURATION });

        clearInterval(room.botInterval);
        room.botInterval = setInterval(() => {
            if(room.state !== 'playing') return clearInterval(room.botInterval);
            Object.values(room.players).forEach(p => {
                if (p.isBot && Math.random() < 0.3) {
                    let power = Math.random() < 0.6 ? 45 : 0;
                    if(power > 0) {
                        const divider = Math.max(1, Object.values(room.players).filter(pl => pl.team === p.team).length);
                        const move = (power / 100) * (8 / divider);
                        room.ropePosition += (p.team === 'RED' ? -move : move);
                        room.ropePosition = Math.max(0, Math.min(100, room.ropePosition));
                        io.to(roomCode).emit('update_rope', { ropePosition: room.ropePosition });
                        checkWinCon(roomCode);
                    }
                }
            });
        }, 1000);

        clearInterval(room.timerInterval);
        room.timerInterval = setInterval(() => {
            room.timeLeft--; io.to(roomCode).emit('timer_tick', room.timeLeft);
            if (room.timeLeft <= 0) endMatch(roomCode);
        }, 1000);
    });

    socket.on('submit_answer_fast', ({ roomCode, qIndex, answerIndex }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing' || !room.players[socket.id]) return;
        const player = room.players[socket.id];
        
        const isCorrect = (answerIndex === questions[qIndex].answer);
        
        // คำนวณแรงตั้งต้นที่ควรได้จากความเร็วในการตอบ (50 - 100)
        const timeTaken = Math.min(15, (Date.now() - player.qStartTime) / 1000);
        const fullPower = Math.round((50 + (50 * ((15 - timeTaken) / 15))) * 10) / 10;
        
        const divider = Math.max(1, Object.values(room.players).filter(p => p.team === player.team).length);
        let power = 0;

        if (isCorrect) {
            // ตอบถูก: ใช้แรงเต็มดึงเข้าหาฝั่งตัวเอง
            power = fullPower;
            const move = (power / 100) * (8 / divider);
            room.ropePosition += (player.team === 'RED' ? -move : move);
        } else {
            // ตอบผิด: เสียแรง 25% ให้ฝั่งตรงข้าม (ดึงไปทิศตรงข้าม)
            power = Math.round((fullPower * 0.25) * 10) / 10;
            const move = (power / 100) * (8 / divider);
            room.ropePosition += (player.team === 'RED' ? move : -move);
        }

        room.ropePosition = Math.max(0, Math.min(100, room.ropePosition));

        player.qIndex = (qIndex + 1) % questions.length; 
        player.qStartTime = Date.now();

        socket.emit('answer_feedback', { isCorrect, power, nextQIndex: player.qIndex, nextQData: questions[player.qIndex] });
        io.to(roomCode).emit('update_rope', { ropePosition: room.ropePosition });
        checkWinCon(roomCode);
    });

    function checkWinCon(roomCode) {
        const room = rooms[roomCode];
        if (room && (room.ropePosition <= 0 || room.ropePosition >= 100)) endMatch(roomCode);
    }

    function endMatch(roomCode) {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing') return;
        room.state = 'ended';
        clearInterval(room.timerInterval);
        clearInterval(room.botInterval);

        let winningTeam = room.ropePosition > 50 ? 'BLUE' : (room.ropePosition < 50 ? 'RED' : (Math.random() < 0.5 ? 'RED' : 'BLUE'));
        
        // เตะคนแพ้และบอทแพ้ออก
        for (let id in room.players) {
            if (room.players[id].team !== winningTeam) {
                if(!room.players[id].isBot) io.to(id).emit('eliminated', { msg: '💥 ทีมคุณแพ้! ถูกคัดออก' });
                delete room.players[id];
            }
        }

        const remainingPlayers = Object.values(room.players);
        const remainingCount = remainingPlayers.length;

        if (remainingCount <= 1) {
            if (remainingCount === 1) {
                const winner = remainingPlayers[0];
                if (!winner.isBot) io.to(winner.id).emit('you_are_champion');
                io.to(roomCode).emit('champion_declared', { champName: winner.name });
            } else {
                io.to(roomCode).emit('champion_declared', { champName: 'ไม่มีผู้รอดชีวิต' });
            }
        } else {
            const newRoomCode = generateRoomCode();
            room.maxPerTeam = Math.max(1, Math.ceil(remainingCount / 2));
            rooms[newRoomCode] = room;
            delete rooms[roomCode];

            // เคลียร์ทีมให้ทุกคนที่รอด
            remainingPlayers.forEach(p => {
                p.team = null;
                p.slot = -1;
                if (!p.isBot) {
                    const s = io.sockets.sockets.get(p.id);
                    if (s) { s.leave(roomCode); s.join(newRoomCode); }
                    io.to(p.id).emit('survived_round', { remainingCount, newRoomCode, maxPerTeam: room.maxPerTeam });
                }
            });

            // บอทที่รอดชีวิตจะโดนสุ่มลงทีมอัตโนมัติทันที
            autoAssignBots(newRoomCode);

            const hostSocket = io.sockets.sockets.get(room.hostId);
            if (hostSocket) { hostSocket.leave(roomCode); hostSocket.join(newRoomCode); }

            io.to(newRoomCode).emit('round_ended_survivors', { winningTeam, remainingCount, newRoomCode, maxPerTeam: room.maxPerTeam });
            io.to(newRoomCode).emit('update_lobby', { players: Object.values(room.players), maxPerTeam: room.maxPerTeam });
        }
    }

    socket.on('disconnect', () => {
        for (let code in rooms) {
            if (rooms[code].players[socket.id]) {
                delete rooms[code].players[socket.id];
                io.to(code).emit('update_lobby', { players: Object.values(rooms[code].players), maxPerTeam: rooms[code].maxPerTeam });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
