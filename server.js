const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PER_TEAM = 16;
let players = {}; // เก็บข้อมูลผู้เล่นทั้งหมด { socketId: { name, team, power } }

const questions = [
    { q: "กระแสไฟฟ้ามีหน่วยเป็นอะไร?", choices: ["Volt", "Ampere", "Ohm", "Watt"], answer: 1 },
    { q: "เมืองหลวงของประเทศไทยคือ?", choices: ["เชียงใหม่", "ภูเก็ต", "กรุงเทพฯ", "พัทยา"], answer: 2 },
    { q: "โลกหมุนรอบตัวเองใช้เวลาเท่าไร?", choices: ["12 ชั่วโมง", "24 ชั่วโมง", "30 วัน", "365 วัน"], answer: 1 },
    { q: "ข้อใดคือสัตว์เลี้ยงลูกด้วยนม?", choices: ["ฉลาม", "จระเข้", "วาฬ", "เต่า"], answer: 2 },
    { q: "น้ำประกอบด้วยธาตุอะไรบ้าง?", choices: ["H และ O", "C และ O", "N และ O", "H และ C"], answer: 0 }
];

let gameState = {
    status: 'waiting',
    currentQ: 0,
    ropePosition: 50,
    redTotalPower: 0,
    blueTotalPower: 0,
    redAnswered: 0,
    blueAnswered: 0
};

let questionStartTime = 0;
let timerInterval;

function getPlayersByTeam() {
    const red = [];
    const blue = [];
    for (let id in players) {
        if (players[id].team === 'RED') red.push(players[id]);
        if (players[id].team === 'BLUE') blue.push(players[id]);
    }
    return { red, blue };
}

io.on('connection', (socket) => {
    // ส่งข้อมูลห้องปัจจุบันให้ผู้เล่นใหม่
    const teams = getPlayersByTeam();
    socket.emit('update_lobby', { red: teams.red, blue: teams.blue, max: MAX_PER_TEAM });

    // ผู้เล่นลงทะเบียนชื่อและเลือกทีม
    socket.on('join_game', ({ name, team }) => {
        const teams = getPlayersByTeam();
        
        if (team === 'RED' && teams.red.length >= MAX_PER_TEAM) {
            return socket.emit('join_error', 'ทีมแดงเต็มแล้ว!');
        }
        if (team === 'BLUE' && teams.blue.length >= MAX_PER_TEAM) {
            return socket.emit('join_error', 'ทีมน้ำเงินเต็มแล้ว!');
        }

        players[socket.id] = {
            id: socket.id,
            name: name.trim() || 'ผู้เล่นไร้นาม',
            team: team,
            hasAnswered: false
        };

        socket.emit('join_success', { name: players[socket.id].name, team });
        
        // ส่งรายชื่อผู้เล่นพร้อมชื่อไปอัปเดตหน้าจอใหญ่
        const updatedTeams = getPlayersByTeam();
        io.emit('update_lobby', { red: updatedTeams.red, blue: updatedTeams.blue, max: MAX_PER_TEAM });
    });

    // โฮสต์สั่งเริ่มคำถาม
    socket.on('start_question', () => {
        if (gameState.currentQ >= questions.length) return;

        gameState.status = 'playing';
        gameState.redAnswered = 0;
        gameState.blueAnswered = 0;
        gameState.ropePosition = 50;

        for (let id in players) {
            players[id].hasAnswered = false;
        }

        io.emit('new_question', {
            questionIndex: gameState.currentQ,
            questionData: questions[gameState.currentQ]
        });

        questionStartTime = Date.now();
        let timeLeft = 15;

        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            timeLeft--;
            io.emit('timer_tick', timeLeft);

            if (timeLeft <= 0) {
                clearInterval(timerInterval);
                endQuestion();
            }
        }, 1000);
    });

    // ส่งคำตอบ
    socket.on('submit_answer', (answerIndex) => {
        const player = players[socket.id];
        if (!player || gameState.status !== 'playing' || player.hasAnswered) return;

        player.hasAnswered = true;
        let timeTaken = (Date.now() - questionStartTime) / 1000;
        if (timeTaken > 15) timeTaken = 15;

        const isCorrect = (answerIndex === questions[gameState.currentQ].answer);
        let power = 0;

        if (isCorrect) {
            power = Math.round((100 * ((15 - timeTaken) / 15)) * 10) / 10;
        }

        if (player.team === 'RED') {
            gameState.redTotalPower += power;
            gameState.redAnswered++;
            gameState.ropePosition -= (power * 0.12);
        } else {
            gameState.blueTotalPower += power;
            gameState.blueAnswered++;
            gameState.ropePosition += (power * 0.12);
        }

        if (gameState.ropePosition < 5) gameState.ropePosition = 5;
        if (gameState.ropePosition > 95) gameState.ropePosition = 95;

        socket.emit('answer_result', { isCorrect, power, timeTaken: timeTaken.toFixed(2) });

        io.emit('update_rope', {
            ropePosition: gameState.ropePosition,
            redAnswered: gameState.redAnswered,
            blueAnswered: gameState.blueAnswered,
            redTotalPower: Math.round(gameState.redTotalPower),
            blueTotalPower: Math.round(gameState.blueTotalPower),
            lastPuller: { name: player.name, team: player.team, power }
        });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        const updatedTeams = getPlayersByTeam();
        io.emit('update_lobby', { red: updatedTeams.red, blue: updatedTeams.blue, max: MAX_PER_TEAM });
    });
});

function endQuestion() {
    gameState.status = 'summary';
    io.emit('question_end', {
        redTotalPower: Math.round(gameState.redTotalPower),
        blueTotalPower: Math.round(gameState.blueTotalPower),
        winner: gameState.redTotalPower > gameState.blueTotalPower ? 'RED' : 'BLUE'
    });
    gameState.currentQ++;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
