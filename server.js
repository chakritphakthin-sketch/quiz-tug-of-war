const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PER_TEAM = 16;
const MAX_ROUNDS = 15;
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
    { q: "ใครคือผู้ค้นพบแรงโน้มถ่วง?", choices: ["อัลเบิร์ต ไอน์สไตน์", "ไอแซก นิวตัน", "กาลิเลโอ", "โทมัส เอดิสัน"], answer: 1 }
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
            currentRound: 0,
            redWins: 0,
            blueWins: 0,
            ropePosition: 50
        };
        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
    });

    socket.on('join_room', ({ roomCode, name, team }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('join_error', 'ไม่พบห้องนี้!');
        if (room.state !== 'waiting') return socket.emit('join_error', 'การแข่งขันเริ่มไปแล้ว!');

        const teamPlayers = Object.values(room.players).filter(p => p.team === team);
        if (teamPlayers.length >= MAX_PER_TEAM) return socket.emit('join_error', `ทีมเต็มแล้ว!`);

        const takenSlots = teamPlayers.map(p => p.slot);
        let freeSlot = 0;
        while (takenSlots.includes(freeSlot)) freeSlot++;

        room.players[socket.id] = {
            id: socket.id, name: name.trim() || 'นักสู้', team: team, slot: freeSlot, roomCode: roomCode, hasAnswered: false
        };

        socket.join(roomCode);
        socket.emit('join_success', { name: room.players[socket.id].name, team, roomCode, slot: freeSlot });
        io.to(roomCode).emit('update_lobby', { players: Object.values(room.players) });
    });

    socket.on('start_match', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        room.currentRound = 0;
        room.redWins = 0;
        room.blueWins = 0;
        sendQuestion(roomCode);
    });

    function sendQuestion(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;
        
        room.state = 'playing';
        room.ropePosition = 50;
        room.questionStartTime = Date.now();

        for (let id in room.players) { room.players[id].hasAnswered = false; }

        const qIndex = room.currentRound % questions.length;
        
        io.to(roomCode).emit('new_question', {
            round: room.currentRound + 1,
            maxRounds: MAX_ROUNDS,
            questionData: questions[qIndex],
            redWins: room.redWins,
            blueWins: room.blueWins
        });

        let timeLeft = 15;
        clearInterval(room.timerInterval);
        room.timerInterval = setInterval(() => {
            timeLeft--;
            io.to(roomCode).emit('timer_tick', timeLeft);

            if (timeLeft <= 0) {
                clearInterval(room.timerInterval);
                endQuestion(roomCode, 'time_up');
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

        const qIndex = room.currentRound % questions.length;
        const isCorrect = (answerIndex === questions[qIndex].answer);
        let power = 0;

        if (isCorrect) {
            power = Math.round((100 * ((15 - timeTaken) / 15)) * 10) / 10;
            if (player.team === 'RED') room.ropePosition -= (power * 0.4);
            else room.ropePosition += (power * 0.4);
        }

        socket.emit('answer_result_mini', { isCorrect, power });
        io.to(roomCode).emit('update_rope', { ropePosition: room.ropePosition });

        if (room.ropePosition <= 10 || room.ropePosition >= 90) {
            clearInterval(room.timerInterval);
            endQuestion(roomCode, 'fall');
        }
    });

    socket.on('next_question', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        room.currentRound++;
        if (room.currentRound < MAX_ROUNDS) {
            sendQuestion(roomCode);
        } else {
            io.to(roomCode).emit('game_over', { redWins: room.redWins, blueWins: room.blueWins });
        }
    });

    function endQuestion(roomCode, reason) {
        const room = rooms[roomCode];
        if (!room) return;
        room.state = 'summary';

        let winner = 'DRAW';
        let detail = 'หมดเวลา! เสมอกัน รอดทั้งคู่!';

        if (room.ropePosition < 50) {
            winner = 'RED';
            room.ropePosition = 0; 
            detail = reason === 'fall' ? 'ทีมน้ำเงินร่วงหลุม! ทีมแดงชนะตา!' : 'หมดเวลา! ทีมแดงกระชากทีมน้ำเงินตกเหว!';
            room.redWins++;
        } else if (room.ropePosition > 50) {
            winner = 'BLUE';
            room.ropePosition = 100;
            detail = reason === 'fall' ? 'ทีมแดงร่วงหลุม! ทีมน้ำเงินชนะตา!' : 'หมดเวลา! ทีมน้ำเงินกระชากทีมแดงตกเหว!';
            room.blueWins++;
        }

        io.to(roomCode).emit('update_rope', { ropePosition: room.ropePosition });
        io.to(roomCode).emit('question_end', { winner, detail, redWins: room.redWins, blueWins: room.blueWins });
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
