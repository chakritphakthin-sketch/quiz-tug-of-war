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
    { q: "น้ำประกอบด้วยธาตุอะไรบ้าง?", choices: ["H และ O", "C และ O", "N และ O", "H และ C"], answer: 0 },
    { q: "ดาวเคราะห์ที่อยู่ใกล้ดวงอาทิตย์ที่สุด?", choices: ["ดาวพุธ", "ดาวศุกร์", "โลก", "ดาวอังคาร"], answer: 0 },
    { q: "ข้อใดคือวิตามินที่ได้จากแสงแดด?", choices: ["Vitamin A", "Vitamin C", "Vitamin D", "Vitamin K"], answer: 2 }
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
            state: 'waiting', // waiting, playing, round_end, finished
            round: 1,
            matchTimeLeft: 60,
            ropePosition: 50,
            redTotalPower: 0,
            blueTotalPower: 0,
            currentQIndex: 0
        };
        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
    });

    socket.on('join_room', ({ roomCode, name, team }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('join_error', 'ไม่พบห้องนี้!');
        if (room.state !== 'waiting') return socket.emit('join_error', 'เกมกำลังแข่งขันอยู่!');

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
            isBot: false,
            status: 'ALIVE', // ALIVE, ELIMINATED
            hasAnswered: false
        };

        socket.join(roomCode);
        socket.emit('join_success', { name: room.players[socket.id].name, team, roomCode, slot: freeSlot });
        broadcastLobby(roomCode);
    });

    socket.on('switch_team', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'waiting') return;
        const player = room.players[socket.id];
        if (!player || player.status === 'ELIMINATED') return;

        const newTeam = player.team === 'RED' ? 'BLUE' : 'RED';
        const teamPlayers = Object.values(room.players).filter(p => p.team === newTeam);
        if (teamPlayers.length >= MAX_PER_TEAM) return socket.emit('join_error', 'ทีมฝั่งนั้นเต็มแล้ว!');

        const takenSlots = teamPlayers.map(p => p.slot);
        let freeSlot = 0;
        while (takenSlots.includes(freeSlot)) freeSlot++;

        player.team = newTeam;
        player.slot = freeSlot;

        socket.emit('team_switched', { team: newTeam, slot: freeSlot });
        broadcastLobby(roomCode);
    });

    // เติมบอทให้ทั้งสองฝั่งเท่ากัน
    socket.on('fill_bots', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        let redPlayers = Object.values(room.players).filter(p => p.team === 'RED' && p.status === 'ALIVE');
        let bluePlayers = Object.values(room.players).filter(p => p.team === 'BLUE' && p.status === 'ALIVE');

        const targetCount = Math.max(redPlayers.length, bluePlayers.length, 2);

        // เติมทีมแดง
        while (redPlayers.length < targetCount && redPlayers.length < MAX_PER_TEAM) {
            const botId = 'bot_red_' + Math.random().toString(36).substr(2, 5);
            const takenSlots = redPlayers.map(p => p.slot);
            let freeSlot = 0;
            while (takenSlots.includes(freeSlot)) freeSlot++;

            room.players[botId] = {
                id: botId,
                name: `🤖 BOT-RED-${freeSlot + 1}`,
                team: 'RED',
                slot: freeSlot,
                isBot: true,
                status: 'ALIVE',
                hasAnswered: false
            };
            redPlayers = Object.values(room.players).filter(p => p.team === 'RED' && p.status === 'ALIVE');
        }

        // เติมทีมน้ำเงิน
        while (bluePlayers.length < targetCount && bluePlayers.length < MAX_PER_TEAM) {
            const botId = 'bot_blue_' + Math.random().toString(36).substr(2, 5);
            const takenSlots = bluePlayers.map(p => p.slot);
            let freeSlot = 0;
            while (takenSlots.includes(freeSlot)) freeSlot++;

            room.players[botId] = {
                id: botId,
                name: `🤖 BOT-BLUE-${freeSlot + 1}`,
                team: 'BLUE',
                slot: freeSlot,
                isBot: true,
                status: 'ALIVE',
                hasAnswered: false
            };
            bluePlayers = Object.values(room.players).filter(p => p.team === 'BLUE' && p.status === 'ALIVE');
        }

        broadcastLobby(roomCode);
    });

    socket.on('start_match', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        startRound(roomCode);
    });

    function startRound(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        room.state = 'playing';
        room.matchTimeLeft = 60;
        room.ropePosition = 50;
        room.redTotalPower = 0;
        room.blueTotalPower = 0;
        room.currentQIndex = Math.floor(Math.random() * questions.length);

        io.to(roomCode).emit('match_started', {
            round: room.round,
            questionData: questions[room.currentQIndex]
        });

        // Loop นับเวลาแข่ง 60 วินาที
        clearInterval(room.matchInterval);
        room.matchInterval = setInterval(() => {
            room.matchTimeLeft--;
            io.to(roomCode).emit('match_timer_tick', room.matchTimeLeft);

            // สุ่มเปลี่ยนโจทย์ทุกๆ 7 วินาที
            if (room.matchTimeLeft % 7 === 0 && room.matchTimeLeft > 0) {
                room.currentQIndex = (room.currentQIndex + 1) % questions.length;
                for (let id in room.players) room.players[id].hasAnswered = false;
                
                io.to(roomCode).emit('new_question', {
                    questionData: questions[room.currentQIndex]
                });
            }

            // จำลองบอทช่วยตอบโจทย์
            triggerBotAnswers(roomCode);

            if (room.matchTimeLeft <= 0) {
                clearInterval(room.matchInterval);
                endRound(roomCode);
            }
        }, 1000);
    }

    function triggerBotAnswers(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        Object.values(room.players).forEach(p => {
            if (p.isBot && p.status === 'ALIVE' && !p.hasAnswered && Math.random() < 0.4) {
                p.hasAnswered = true;
                const isCorrect = Math.random() < 0.65; // ความแม่นยำบอท 65%
                const power = isCorrect ? Math.floor(Math.random() * 50) + 30 : 0;

                if (p.team === 'RED') {
                    room.redTotalPower += power;
                    room.ropePosition -= (power * 0.08);
                } else {
                    room.blueTotalPower += power;
                    room.ropePosition += (power * 0.08);
                }

                clampRope(room);
                io.to(roomCode).emit('update_rope', {
                    ropePosition: room.ropePosition,
                    lastPuller: { name: p.name, team: p.team, power }
                });
            }
        });
    }

    socket.on('submit_answer', ({ roomCode, answerIndex }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing') return;

        const player = room.players[socket.id];
        if (!player || player.hasAnswered || player.status === 'ELIMINATED') return;

        player.hasAnswered = true;
        const isCorrect = (answerIndex === questions[room.currentQIndex].answer);
        const power = isCorrect ? Math.floor(Math.random() * 40) + 60 : 0;

        if (player.team === 'RED') {
            room.redTotalPower += power;
            room.ropePosition -= (power * 0.08);
        } else {
            room.blueTotalPower += power;
            room.ropePosition += (power * 0.08);
        }

        clampRope(room);
        socket.emit('answer_result', { isCorrect, power });

        io.to(roomCode).emit('update_rope', {
            ropePosition: room.ropePosition,
            lastPuller: { name: player.name, team: player.team, power }
        });
    });

    function clampRope(room) {
        if (room.ropePosition < 5) room.ropePosition = 5;
        if (room.ropePosition > 95) room.ropePosition = 95;
    }

    function endRound(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        // หาผู้ชนะรอบ 60 วิ
        let winningTeam = 'DRAW';
        if (room.ropePosition < 50) winningTeam = 'RED';
        else if (room.ropePosition > 50) winningTeam = 'BLUE';
        else winningTeam = room.redTotalPower >= room.blueTotalPower ? 'RED' : 'BLUE';

        // คัดคนตกรอบ (ทีมแพ้ทั้งหมดตกรอบ)
        Object.values(room.players).forEach(p => {
            if (p.status === 'ALIVE' && p.team !== winningTeam) {
                p.status = 'ELIMINATED';
                if (!p.isBot && io.sockets.sockets.get(p.id)) {
                    io.sockets.sockets.get(p.id).emit('eliminated');
                }
            }
        });

        // นับจำนวนมนุษย์ผู้รอดชีวิต
        const aliveHumans = Object.values(room.players).filter(p => !p.isBot && p.status === 'ALIVE');

        if (aliveHumans.length === 1) {
            // ประกาศแชมเปียน 1 เดียว!
            const champion = aliveHumans[0];
            room.state = 'finished';
            io.to(roomCode).emit('grand_champion', { name: champion.name });
        } else if (aliveHumans.length === 0) {
            // กรณีไม่มีคนเหลือเลย ให้สุ่มผู้ชนะจากคนที่รอดในบอท/ผู้เล่นเดิม
            const lastAlive = Object.values(room.players).filter(p => p.status === 'ALIVE')[0];
            room.state = 'finished';
            io.to(roomCode).emit('grand_champion', { name: lastAlive ? lastAlive.name : 'ไม่มีผู้ชนะ' });
        } else {
            // ไปรอบถัดไป
            room.round++;
            room.state = 'waiting';
            
            // ลบบอทเก่าออกเพื่อรีเซ็ตจับทีมใหม่
            Object.keys(room.players).forEach(id => {
                if (room.players[id].isBot) delete room.players[id];
            });

            io.to(roomCode).emit('round_ended', {
                winningTeam,
                nextRound: room.round,
                aliveCount: aliveHumans.length
            });
            broadcastLobby(roomCode);
        }
    }

    function broadcastLobby(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        io.to(roomCode).emit('update_lobby', {
            players: Object.values(room.players),
            maxPerTeam: MAX_PER_TEAM,
            state: room.state,
            round: room.round
        });
    }

    socket.on('disconnect', () => {
        for (let code in rooms) {
            const room = rooms[code];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                broadcastLobby(code);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
