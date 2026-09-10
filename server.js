const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PER_TEAM = 16;
const ROUND_TIME = 60; // ความยาวต่อรอบ 60 วินาที
const rooms = {};

// คลังคำถามวิชาการ/ความรู้ทั่วไป (ระบบจะสุ่มส่งให้ผู้เล่นตอบได้เรื่อยๆ ไม่มีหมด)
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
    do {
        code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {

    // 1. Host สร้างห้อง
    socket.on('create_room', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostId: socket.id,
            players: {},
            state: 'waiting',
            ropePosition: 50,
            botCount: 0,
            roundNumber: 1
        };
        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
    });

    // 2. ผู้เล่นเข้าร่วมห้อง หรือ สลับทีม Real-time
    socket.on('join_room', ({ roomCode, name, team }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('join_error', 'ไม่พบรหัสห้องนี้!');
        if (room.state !== 'waiting') return socket.emit('join_error', 'การแข่งขันกำลังดำเนินอยู่!');

        const teamPlayers = Object.values(room.players).filter(p => p.team === team && p.status === 'active');
        if (teamPlayers.length >= MAX_PER_TEAM) {
            return socket.emit('join_error', `ทีม ${team === 'RED' ? 'แดง' : 'น้ำเงิน'} เต็มแล้ว!`);
        }

        // หา Slot สลับฟันปลาว่าง
        const takenSlots = teamPlayers.map(p => p.slot);
        let freeSlot = 0;
        while (takenSlots.includes(freeSlot)) freeSlot++;

        room.players[socket.id] = {
            id: socket.id,
            name: name.trim() || 'Player',
            team: team,
            slot: freeSlot,
            status: 'active',
            isBot: false
        };

        socket.join(roomCode);
        socket.emit('join_success', { name: room.players[socket.id].name, team, slot: freeSlot, roomCode });
        updateLobby(roomCode);
    });

    // 3. สลับทีมจากหน้าสนามยิงตรง
    socket.on('switch_team_direct', ({ roomCode, targetTeam }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'waiting') return;
        const player = room.players[socket.id];
        if (!player || player.team === targetTeam) return;

        const targetTeamPlayers = Object.values(room.players).filter(p => p.team === targetTeam && p.status === 'active');
        if (targetTeamPlayers.length >= MAX_PER_TEAM) {
            return socket.emit('join_error', `ทีมเต็มแล้ว ไม่สามารถย้ายได้!`);
        }

        const takenSlots = targetTeamPlayers.map(p => p.slot);
        let freeSlot = 0;
        while (takenSlots.includes(freeSlot)) freeSlot++;

        player.team = targetTeam;
        player.slot = freeSlot;

        socket.emit('team_switched', { team: targetTeam, slot: freeSlot });
        updateLobby(roomCode);
    });

    // 4. ผู้ผ่านเข้ารอบเลือกทีมใหม่
    socket.on('rejoin_team', ({ roomCode, team }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'waiting') return;
        const player = room.players[socket.id];
        if (!player || player.status !== 'survived') return;

        const teamPlayers = Object.values(room.players).filter(p => p.team === team && p.status === 'active');
        if (teamPlayers.length >= MAX_PER_TEAM) return socket.emit('join_error', `ทีมเต็มแล้ว!`);

        let freeSlot = 0;
        while (teamPlayers.map(p => p.slot).includes(freeSlot)) freeSlot++;

        player.team = team;
        player.slot = freeSlot;
        player.status = 'active';

        socket.emit('join_success', { name: player.name, team, slot: freeSlot, roomCode });
        updateLobby(roomCode);
    });

    // 5. เพิ่มบอทเติมเต็มทีม
    socket.on('add_bot', ({ roomCode, team }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id || room.state !== 'waiting') return;

        const teamPlayers = Object.values(room.players).filter(p => p.team === team && p.status === 'active');
        if (teamPlayers.length >= MAX_PER_TEAM) return;

        let freeSlot = 0;
        while (teamPlayers.map(p => p.slot).includes(freeSlot)) freeSlot++;

        room.botCount++;
        const botId = `bot_${Date.now()}_${room.botCount}`;
        room.players[botId] = {
            id: botId,
            name: `🤖 บอท ${room.botCount}`,
            team: team,
            slot: freeSlot,
            status: 'active',
            isBot: true
        };

        updateLobby(roomCode);
    });

    // 6. เริ่มการแข่งขันประจำรอบ (60 วิ)
    socket.on('start_match', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        room.state = 'playing';
        room.ropePosition = 50;

        io.to(roomCode).emit('match_started');

        // แจกโจทย์ข้อแรกให้ผู้เล่นทุกคนตอบส่วนตัว
        for (let pId in room.players) {
            const p = room.players[pId];
            if (!p.isBot && p.status === 'active') {
                io.to(pId).emit('new_question', getRandomQuestion());
            }
        }

        // ลูป AI บอทช่วยดึงเชือกตามสถิติความถูกต้อง
        room.botInterval = setInterval(() => {
            if (room.state !== 'playing') return;
            let redForce = 0;
            let blueForce = 0;

            Object.values(room.players).forEach(p => {
                if (p.isBot && p.status === 'active') {
                    if (Math.random() > 0.45) { // บอทมีอัตราตอบถูก/ดึงเชือก 55%
                        if (p.team === 'RED') redForce += 1.8;
                        else blueForce += 1.8;
                    }
                }
            });

            if (redForce > 0 || blueForce > 0) {
                room.ropePosition -= (redForce - blueForce);
                if (room.ropePosition < 5) room.ropePosition = 5;
                if (room.ropePosition > 95) room.ropePosition = 95;

                io.to(roomCode).emit('update_rope', { ropePosition: room.ropePosition });
            }
        }, 1500);

        // ตัวนับเวลาถอยหลัง 60 วินาที
        let timeLeft = ROUND_TIME;
        clearInterval(room.timerInterval);
        room.timerInterval = setInterval(() => {
            timeLeft--;
            io.to(roomCode).emit('timer_tick', timeLeft);

            if (timeLeft <= 0) {
                clearInterval(room.timerInterval);
                clearInterval(room.botInterval);
                endRound(roomCode);
            }
        }, 1000);
    });

    // 7. ผู้เล่นส่งคำตอบ (ไหลต่อเนื่องไม่หยุด)
    socket.on('submit_answer', ({ roomCode, answerIndex, qText }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing') return;

        const player = room.players[socket.id];
        if (!player || player.status !== 'active') return;

        const originalQ = questions.find(q => q.q === qText);
        const isCorrect = originalQ && (answerIndex === originalQ.answer);
        let power = isCorrect ? 3.5 : 0;

        if (isCorrect) {
            if (player.team === 'RED') room.ropePosition -= power;
            else room.ropePosition += power;

            if (room.ropePosition < 5) room.ropePosition = 5;
            if (room.ropePosition > 95) room.ropePosition = 95;
        }

        socket.emit('answer_result', { isCorrect, power });
        io.to(roomCode).emit('update_rope', {
            ropePosition: room.ropePosition,
            lastPuller: { id: player.id, name: player.name, team: player.team }
        });

        // ส่งคำถามใหม่ถัดไปทันทีหลังจากส่งคำตอบแล้ว 1 วินาที
        setTimeout(() => {
            if (room.state === 'playing' && player.status === 'active') {
                socket.emit('new_question', getRandomQuestion());
            }
        }, 1000);
    });

    // 8. ตัดสินผลเมื่อหมดเวลา 60 วินาที (Tournament Elimination)
    function endRound(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        // ฝั่งที่ดึงเชือกมาทางฝั่งตัวเองได้มากกว่าเป็นผู้ชนะ (หรือสุ่มกรณี 50/50 เท่ากัน)
        let winningTeam = 'RED';
        if (room.ropePosition > 50) winningTeam = 'BLUE';
        else if (room.ropePosition === 50) winningTeam = Math.random() > 0.5 ? 'RED' : 'BLUE';

        let realSurvivors = [];

        for (let pId in room.players) {
            let p = room.players[pId];

            if (p.isBot) {
                delete room.players[pId]; // เคลียร์บอทออกเมื่อจบแต่ละรอบ
                continue;
            }

            if (p.team === winningTeam) {
                p.status = 'survived';
                p.team = null; // คืนค่าทีมเพื่อให้เลือกใหม่ในรอบถัดไป
                realSurvivors.push(p);
            } else {
                p.status = 'eliminated';
                io.to(pId).emit('eliminated'); // ส่งไปยังหน้าตกรอบ ขอบคุณที่ร่วมสนุก
            }
        }

        if (realSurvivors.length === 1) {
            // ได้ผู้รอดชีวิตคนสุดท้าย = CHAMPION 🏆
            room.state = 'ended';
            io.to(roomCode).emit('champion', { name: realSurvivors[0].name });
        } else if (realSurvivors.length > 1) {
            // ยังเหลือผู้แข่งขันมากกว่า 1 คน ดำเนินการแข่งรอบถัดไป
            room.state = 'waiting';
            room.roundNumber++;
            realSurvivors.forEach(p => io.to(p.id).emit('pick_team_again'));
            io.to(roomCode).emit('round_end', { winningTeam, survivors: realSurvivors.length, roundNumber: room.roundNumber });
            updateLobby(roomCode);
        } else {
            // ตกรอบหมดทุกคน
            room.state = 'ended';
            io.to(roomCode).emit('game_over');
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
server.listen(PORT, '0.0.0.0', () => console.log(`Quiz Tug of War Server Live on Port ${PORT}`));
