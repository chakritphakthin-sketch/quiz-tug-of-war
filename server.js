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
    { q: "ใครคือผู้คิดค้นหลอดไฟ?", choices: ["นิวตัน", "เอดิสัน", "ไอน์สไตน์", "เทสลา"], answer: 1 },
    { q: "ดาวเคราะห์ใดใหญ่ที่สุดในระบบสุริยะ?", choices: ["โลก", "ดาวพฤหัสบดี", "ดาวเสาร์", "ดาวอังคาร"], answer: 1 },
    { q: "ก๊าซใดมีมากที่สุดในชั้นบรรยากาศโลก?", choices: ["ออกซิเจน", "คาร์บอนไดออกไซด์", "ไนโตรเจน", "ไฮโดรเจน"], answer: 2 }
];

function generateRoomCode() {
    let code;
    do { code = Math.floor(100000 + Math.random() * 900000).toString(); } while (rooms[code]);
    return code;
}

const botNames = ["Bot Alpha", "Bot Beta", "Bot Gamma", "Bot Delta", "Bot Echo", "Bot Zeta", "Bot Thor", "Bot Loki", "Bot Iron", "Bot Hulk"];

io.on('connection', (socket) => {
    socket.on('create_room', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostId: socket.id,
            players: {},
            state: 'waiting',
            round: 1,
            ropePosition: 50,
            botCounter: 0
        };
        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
    });

    socket.on('join_room', ({ roomCode, name, team }) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('join_error', 'ไม่พบห้องนี้!');
        if (room.state !== 'waiting') return socket.emit('join_error', 'รอบการแข่งเริ่มไปแล้ว หรือคุณถูกคัดออก!');

        const teamPlayers = Object.values(room.players).filter(p => p.team === team);
        if (teamPlayers.length >= MAX_PER_TEAM) return socket.emit('join_error', `ทีมเต็มแล้ว!`);

        const takenSlots = teamPlayers.map(p => p.slot);
        let freeSlot = 0;
        while (takenSlots.includes(freeSlot)) freeSlot++;

        room.players[socket.id] = {
            id: socket.id,
            name: name.trim() || 'นักสู้',
            team: team,
            slot: freeSlot,
            isBot: false,
            eliminated: false,
            hasAnswered: false
        };

        socket.join(roomCode);
        socket.emit('join_success', { name: room.players[socket.id].name, team, slot: freeSlot });
        updateLobby(roomCode);
    });

    socket.on('add_bots', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'waiting') return;

        ['RED', 'BLUE'].forEach(team => {
            let teamPlayers = Object.values(room.players).filter(p => p.team === team);
            while (teamPlayers.length < MAX_PER_TEAM) {
                const takenSlots = teamPlayers.map(p => p.slot);
                let freeSlot = 0;
                while (takenSlots.includes(freeSlot)) freeSlot++;

                const botId = `bot_${Date.now()}_${room.botCounter++}`;
                room.players[botId] = {
                    id: botId,
                    name: botNames[room.botCounter % botNames.length] + ` [BOT]`,
                    team: team,
                    slot: freeSlot,
                    isBot: true,
                    eliminated: false,
                    hasAnswered: false
                };
                teamPlayers.push(room.players[botId]);
            }
        });
        updateLobby(roomCode);
    });

    function updateLobby(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;
        io.to(roomCode).emit('update_lobby', { players: Object.values(room.players).filter(p => !p.eliminated) });
    }

    socket.on('start_match', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id || room.state !== 'waiting') return;
        
        room.state = 'playing';
        room.ropePosition = 50;
        room.roundTimeLeft = 60; // 60 วินาทีต่อรอบ

        io.to(roomCode).emit('match_started', { round: room.round });
        
        sendAutoQuestion(roomCode);

        clearInterval(room.roundTimer);
        room.roundTimer = setInterval(() => {
            room.roundTimeLeft--;
            io.to(roomCode).emit('round_timer_tick', room.roundTimeLeft);

            // บอทสุ่มตอบคำถาม
            botAction(roomCode);

            if (room.roundTimeLeft <= 0) {
                endRound(roomCode);
            }
        }, 1000);
    });

    function sendAutoQuestion(roomCode) {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing') return;

        const q = questions[Math.floor(Math.random() * questions.length)];
        room.currentQ = q;
        room.questionStartTime = Date.now();

        Object.values(room.players).forEach(p => p.hasAnswered = false);
        io.to(roomCode).emit('new_question', { questionData: q });

        // คำถามเปลี่ยนทุกๆ 10 วินาที
        clearTimeout(room.questionTimer);
        room.questionTimer = setTimeout(() => {
            if (room.state === 'playing') sendAutoQuestion(roomCode);
        }, 10000);
    }

    function botAction(roomCode) {
        const room = rooms[roomCode];
        Object.values(room.players).forEach(p => {
            if (p.isBot && !p.hasAnswered && !p.eliminated) {
                if (Math.random() < 0.2) { // โอกาสตอบ 20% ต่อวินาที
                    p.hasAnswered = true;
                    const isCorrect = Math.random() < 0.6; // บอทเก่ง 60%
                    const power = isCorrect ? Math.round(Math.random() * 5 + 5) : 0;
                    applyPower(roomCode, p, isCorrect, power);
                }
            }
        });
    }

    socket.on('submit_answer', ({ roomCode, answerIndex }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing') return;
        const player = room.players[socket.id];
        if (!player || player.hasAnswered || player.eliminated) return;

        player.hasAnswered = true;
        let timeTaken = (Date.now() - room.questionStartTime) / 1000;
        let power = 0;
        const isCorrect = (answerIndex === room.currentQ.answer);

        if (isCorrect) {
            power = Math.round((100 * ((10 - timeTaken) / 10)) * 10) / 10;
            if (power < 1) power = 1;
        }

        applyPower(roomCode, player, isCorrect, power);
        socket.emit('answer_result', { isCorrect, power });
    });

    function applyPower(roomCode, player, isCorrect, power) {
        const room = rooms[roomCode];
        if (!isCorrect) return;

        if (player.team === 'RED') room.ropePosition -= (power * 0.1);
        else room.ropePosition += (power * 0.1);

        if (room.ropePosition < 5) room.ropePosition = 5;
        if (room.ropePosition > 95) room.ropePosition = 95;

        io.to(roomCode).emit('update_rope', {
            ropePosition: room.ropePosition,
            lastPuller: { name: player.name, team: player.team }
        });
    }

    function endRound(roomCode) {
        const room = rooms[roomCode];
        room.state = 'round_end';
        clearInterval(room.roundTimer);
        clearTimeout(room.questionTimer);

        // ตัดสินผล
        let winningTeam = room.ropePosition <= 50 ? 'RED' : 'BLUE';

        let realSurvivors = 0;
        let champion = null;

        Object.values(room.players).forEach(p => {
            if (p.eliminated) return;

            if (p.team !== winningTeam) {
                p.eliminated = true;
                if (!p.isBot) io.to(p.id).emit('eliminated'); // ส่งคนแพ้ไปหน้าขอบคุณ
            } else {
                p.team = null; // รีเซ็ตทีมให้คนชนะไปเลือกใหม่
                p.slot = null;
                if (!p.isBot) {
                    realSurvivors++;
                    champion = p;
                    io.to(p.id).emit('round_win'); // ให้คนชนะไปหน้าเลือกทีม
                }
            }
        });

        // ลบบอททิ้งทั้งหมดเมื่อจบรอบ เพื่อให้คนเลือกทีมกันเองใหม่
        for (let id in room.players) {
            if (room.players[id].isBot) delete room.players[id];
        }

        if (realSurvivors <= 1 && champion) {
            // เจอผู้ชนะคนสุดท้าย
            room.state = 'game_over';
            io.to(roomCode).emit('champion_found', { name: champion.name });
            io.to(champion.id).emit('you_are_champion');
        } else {
            // ไปรอบถัดไป
            room.state = 'waiting';
            room.round++;
            io.to(roomCode).emit('round_summary', { winner: winningTeam, round: room.round });
            updateLobby(roomCode);
        }
    }

    socket.on('disconnect', () => {
        for (let code in rooms) {
            const room = rooms[code];
            if (room.players[socket.id]) {
                delete room.players[socket.id]; // ปล่อยสล็อตว่างตามรีเควส
                updateLobby(code);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
