const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PER_TEAM = 16;
const MATCH_DURATION = 100; // เวลาแข่ง 100 วินาที
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
    { q: "ข้อใดคือสีผสมหลัก (Primary Colors)?", choices: ["แดง เหลือง น้ำเงิน", "เขียว ส้ม ม่วง", "ขาว ดำ เทา", "แดง เขียว น้ำเงิน"], answer: 0 },
    { q: "ใครคือผู้ค้นพบแรงโน้มถ่วง?", choices: ["อัลเบิร์ต ไอน์สไตน์", "ไอแซก นิวตัน", "กาลิเลโอ", "โทมัส เอดิสัน"], answer: 1 },
    { q: "สุริยุปราคาเกิดขึ้นเมื่อใด?", choices: ["ดวงจันทร์บังดวงอาทิตย์", "โลกบังดวงอาทิตย์", "ดาวอังคารบังดวงอาทิตย์", "ดาวพฤหัสบดีบังดวงจันทร์"], answer: 0 },
    { q: "สูตรเคมีของเกลือแกงคืออะไร?", choices: ["NaCl", "H2O", "CO2", "NaOH"], answer: 0 },
    { q: "อวัยวะใดทำหน้าที่กรองเสียออกจากเลือด?", choices: ["หัวใจ", "ตับ", "ไต", "ปอด"], answer: 2 },
    { q: "ก๊าซใดมีปริมาณมากที่สุดในบรรยากาศโลก?", choices: ["ออกซิเจน", "ไนโตรเจน", "คาร์บอนไดออกไซด์", "ไฮโดรเจน"], answer: 1 },
    { q: "แสงเดินทางด้วยความเร็วประมาณเท่าใด?", choices: ["300,000 กม./วิ", "150,000 กม./วิ", "1,000,000 กม./วิ", "30,000 กม./วิ"], answer: 0 }
];

function generateRoomCode() {
    let code;
    do { code = Math.floor(100000 + Math.random() * 900000).toString(); } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    socket.on('create_room', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostId: socket.id,
            players: {},
            state: 'waiting',
            ropePosition: 50,
            timeLeft: MATCH_DURATION,
            timerInterval: null
        };
        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
    });

    socket.on('join_room', ({ roomCode, name, team }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('join_error', 'ไม่พบห้องนี้!');
        if (room.state === 'playing') return socket.emit('join_error', 'รอบแข่งขันกำลังดำเนินอยู่!');

        const teamPlayers = Object.values(room.players).filter(p => p.team === team);
        if (teamPlayers.length >= MAX_PER_TEAM) return socket.emit('join_error', 'ทีมเต็มแล้ว!');

        const takenSlots = teamPlayers.map(p => p.slot);
        let freeSlot = 0;
        while (takenSlots.includes(freeSlot)) freeSlot++;

        room.players[socket.id] = {
            id: socket.id,
            name: name.trim() || 'นักสู้',
            team: team,
            slot: freeSlot,
            qIndex: 0,
            qStartTime: 0
        };

        socket.join(roomCode);
        socket.emit('join_success', { name: room.players[socket.id].name, team, roomCode, slot: freeSlot });
        io.to(roomCode).emit('update_lobby', { players: Object.values(room.players) });
    });

    socket.on('start_match', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        room.state = 'playing';
        room.ropePosition = 50;
        room.timeLeft = MATCH_DURATION;

        // ส่งคำถามข้อแรกให้ผู้เล่นแต่ละคนแยกกันรันเอง
        for (let id in room.players) {
            room.players[id].qIndex = 0;
            room.players[id].qStartTime = Date.now();
            io.to(id).emit('start_player_stream', {
                qIndex: 0,
                totalQuestions: questions.length,
                qData: questions[0]
            });
        }

        io.to(roomCode).emit('match_started', {
            duration: MATCH_DURATION,
            ropePosition: 50,
            questions: questions
        });

        clearInterval(room.timerInterval);
        room.timerInterval = setInterval(() => {
            room.timeLeft--;
            io.to(roomCode).emit('timer_tick', room.timeLeft);

            if (room.timeLeft <= 0) {
                clearInterval(room.timerInterval);
                endMatch(roomCode, 'time_up');
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

            // ปรับสมดุลชักเย่อ: แรงดึงเรียลไทม์แบบยื้อยุด ไม่เด้งพรวดเดียวตก
            const moveAmount = (power / 100) * (6 / divider);
            if (player.team === 'RED') room.ropePosition -= moveAmount;
            else room.ropePosition += moveAmount;

            room.ropePosition = Math.max(0, Math.min(100, room.ropePosition));
        }

        // วนข้อถัดไปทันที
        player.qIndex = (qIndex + 1) % questions.length;
        player.qStartTime = Date.now();

        socket.emit('answer_feedback', {
            isCorrect,
            power,
            nextQIndex: player.qIndex,
            nextQData: questions[player.qIndex]
        });

        io.to(roomCode).emit('update_rope', { ropePosition: room.ropePosition });

        // ชนะน็อกถ้ากระชากตกเหวทันที
        if (room.ropePosition <= 0 || room.ropePosition >= 100) {
            clearInterval(room.timerInterval);
            endMatch(roomCode, 'knockout');
        }
    });

    function endMatch(roomCode, reason) {
        const room = rooms[roomCode];
        if (!room) return;

        room.state = 'ended';
        let winner = 'DRAW';
        let detail = 'ดึงกันไม่ลง เสมอกันทั้งสองทีม!';

        if (room.ropePosition < 50) {
            winner = 'RED';
            room.ropePosition = 0;
            detail = reason === 'knockout' ? '🔴 ทีมแดงกระชากดึงทีมน้ำเงินตกเหว!' : '⏱️ หมดเวลา 100 วิ! ทีมแดงดึงเชือกเอียงมาทางฝั่งตัวเอง ชนะเข้ารอบ!';
        } else if (room.ropePosition > 50) {
            winner = 'BLUE';
            room.ropePosition = 100;
            detail = reason === 'knockout' ? '🔵 ทีมน้ำเงินกระชากดึงทีมแดงตกเหว!' : '⏱️ หมดเวลา 100 วิ! ทีมน้ำเงินดึงเชือกเอียงมาทางฝั่งตัวเอง ชนะเข้ารอบ!';
        }

        io.to(roomCode).emit('update_rope', { ropePosition: room.ropePosition });
        io.to(roomCode).emit('match_ended', { winner, detail });
    }

    socket.on('reset_to_lobby', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        room.state = 'waiting';
        room.ropePosition = 50;
        io.to(roomCode).emit('return_to_lobby');
        io.to(roomCode).emit('update_lobby', { players: Object.values(room.players) });
    });

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
