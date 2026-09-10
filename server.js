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
    { q: "ดาวเคราะห์ดวงใดใหญ่ที่สุดในระบบสุริยะ?", choices: ["โลก", "ดาวพฤหัสบดี", "ดาวเสาร์", "ดาวอังคาร"], answer: 1 },
    { q: "สัตว์ชนิดใดมี 8 ขา?", choices: ["แมงมุม", "แมลงวัน", "ปู", "กุ้ง"], answer: 0 },
    { q: "ประเทศใดมีประชากรมากที่สุดในโลก?", choices: ["อเมริกา", "อินเดีย", "จีน", "รัสเซีย"], answer: 1 },
    { q: "ใครคือผู้ค้นพบแรงโน้มถ่วง?", choices: ["อัลเบิร์ต ไอน์สไตน์", "ไอแซก นิวตัน", "กาลิเลโอ", "โทมัส เอดิสัน"], answer: 1 },
    { q: "อวัยวะใดทำหน้าที่กรองของเสียออกจากเลือด?", choices: ["หัวใจ", "ตับ", "ไต", "ปอด"], answer: 2 }
];

function generateRoomCode() {
    let code;
    do { code = Math.floor(100000 + Math.random() * 900000).toString(); } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    socket.on('create_room', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = { hostId: socket.id, players: {}, state: 'waiting', ropePosition: 50, timeLeft: MATCH_DURATION, timerInterval: null };
        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
    });

    socket.on('join_room', ({ roomCode, name, team }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('join_error', 'ไม่พบห้องนี้!');
        if (room.state === 'playing') return socket.emit('join_error', 'การแข่งขันกำลังดำเนินอยู่!');

        const teamPlayers = Object.values(room.players).filter(p => p.team === team);
        if (teamPlayers.length >= 16) {
            return socket.emit('join_error', `ทีม ${team} เต็มโควต้า 16 คนแล้ว!`);
        }

        const takenSlots = teamPlayers.map(p => p.slot);
        let freeSlot = 0;
        while (takenSlots.includes(freeSlot)) freeSlot++;

        room.players[socket.id] = {
            id: socket.id,
            name: name.trim() || 'Player',
            team: team,
            slot: freeSlot,
            qIndex: 0,
            qStartTime: 0
        };

        socket.join(roomCode);
        socket.emit('join_success', { name: room.players[socket.id].name, team, roomCode });
        io.to(roomCode).emit('update_lobby', { players: Object.values(room.players) });
    });

    // ให้คนรอดชีวิตเลือกทีมใหม่ แบ่งครึ่งอัตโนมัติ
    socket.on('select_team_next_round', ({ roomCode, team }) => {
        const room = rooms[roomCode];
        if (!room || !room.players[socket.id]) return;

        const totalSurvivors = Object.keys(room.players).length;
        const maxPerTeam = Math.ceil(totalSurvivors / 2); // บังคับแบ่งครึ่ง
        const teamPlayers = Object.values(room.players).filter(p => p.team === team);

        if (teamPlayers.length >= maxPerTeam) {
            return socket.emit('join_error', `ทีม ${team} เต็มแล้วสำหรับรอบนี้! (รับได้ฝั่งละ ${maxPerTeam} คน) ให้เลือกอีกทีมครับ`);
        }

        const takenSlots = teamPlayers.map(p => p.slot);
        let freeSlot = 0;
        while (takenSlots.includes(freeSlot)) freeSlot++;

        room.players[socket.id].team = team;
        room.players[socket.id].slot = freeSlot;

        socket.emit('team_selected_success', { team, slot: freeSlot });
        io.to(roomCode).emit('update_lobby', { players: Object.values(room.players) });
    });

    socket.on('start_match', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        const unassigned = Object.values(room.players).filter(p => !p.team);
        if (unassigned.length > 0) return socket.emit('start_error', 'ผู้รอดชีวิตยังเลือกทีมไม่ครบ!');

        room.state = 'playing';
        room.ropePosition = 50;
        room.timeLeft = MATCH_DURATION;

        for (let id in room.players) {
            room.players[id].qIndex = 0;
            room.players[id].qStartTime = Date.now();
            io.to(id).emit('start_player_stream', { qIndex: 0, totalQuestions: questions.length, qData: questions[0] });
        }

        io.to(roomCode).emit('match_started', { duration: MATCH_DURATION, questions: questions });

        clearInterval(room.timerInterval);
        room.timerInterval = setInterval(() => {
            room.timeLeft--;
            io.to(roomCode).emit('timer_tick', room.timeLeft);
            if (room.timeLeft <= 0) {
                clearInterval(room.timerInterval);
                endMatch(roomCode);
            }
        }, 1000);
    });

    socket.on('submit_answer_fast', ({ roomCode, qIndex, answerIndex }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing') return;

        const player = room.players[socket.id];
        if (!player) return;

        const timeTaken = Math.min(15, (Date.now() - player.qStartTime) / 1000);
        const isCorrect = (answerIndex === questions[qIndex].answer);
        let power = 0;

        const myTeamCount = Object.values(room.players).filter(p => p.team === player.team).length;
        const divider = Math.max(1, myTeamCount);

        if (isCorrect) {
            const speedBonus = 50 * ((15 - timeTaken) / 15);
            power = Math.round((50 + speedBonus) * 10) / 10;
            const moveAmount = (power / 100) * (8 / divider);
            
            if (player.team === 'RED') room.ropePosition -= moveAmount;
            else room.ropePosition += moveAmount;

            room.ropePosition = Math.max(0, Math.min(100, room.ropePosition));
        }

        player.qIndex = (qIndex + 1) % questions.length;
        player.qStartTime = Date.now();

        socket.emit('answer_feedback', { isCorrect, power, nextQIndex: player.qIndex, nextQData: questions[player.qIndex] });
        io.to(roomCode).emit('update_rope', { ropePosition: room.ropePosition });

        if (room.ropePosition <= 0 || room.ropePosition >= 100) {
            clearInterval(room.timerInterval);
            endMatch(roomCode);
        }
    });

    function endMatch(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        room.state = 'ended';

        let winningTeam = 'RED';
        if (room.ropePosition > 50) winningTeam = 'BLUE';
        else if (room.ropePosition < 50) winningTeam = 'RED';
        else winningTeam = Math.random() < 0.5 ? 'RED' : 'BLUE';

        const losers = [];
        const winners = [];

        for (let id in room.players) {
            if (room.players[id].team === winningTeam) {
                room.players[id].team = null; // รีเซ็ตทีมให้คนชนะ
                room.players[id].slot = -1;
                winners.push(room.players[id]);
            } else {
                losers.push(id);
            }
        }

        // เตะคนแพ้ออก
        losers.forEach(id => {
            io.to(id).emit('eliminated', { msg: '💥 ทีมของคุณแพ้! คุณถูกคัดออกจากสนาม' });
            delete room.players[id];
        });

        const remainingCount = Object.keys(room.players).length;

        if (remainingCount === 1) {
            const champ = winners[0];
            io.to(champ.id).emit('you_are_champion');
            io.to(roomCode).emit('champion_declared', { champName: champ.name });
        } else if (remainingCount === 0) {
            io.to(roomCode).emit('no_winners');
        } else {
            // ให้คนชนะอยู่ในห้องต่อ และเด้งหน้าเลือกทีมใหม่
            winners.forEach(w => {
                io.to(w.id).emit('survived_round', { remainingCount });
            });
            io.to(roomCode).emit('round_ended_survivors', { winningTeam, remainingCount });
        }
    }

    socket.on('disconnect', () => {
        for (let code in rooms) {
            if (rooms[code].players[socket.id]) {
                delete rooms[code].players[socket.id];
                io.to(code).emit('update_lobby', { players: Object.values(rooms[code].players) });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
