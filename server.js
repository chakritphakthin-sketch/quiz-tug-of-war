const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ชุดคำถาม (ตัวอย่าง 5 ข้อ)
const questions = [
    { q: "กระแสไฟฟ้ามีหน่วยเป็นอะไร?", choices: ["Volt", "Ampere", "Ohm", "Watt"], answer: 1 }, // 0=A, 1=B, 2=C, 3=D
    { q: "เมืองหลวงของประเทศไทยคือ?", choices: ["เชียงใหม่", "ภูเก็ต", "กรุงเทพฯ", "พัทยา"], answer: 2 },
    { q: "โลกหมุนรอบตัวเองใช้เวลาเท่าไร?", choices: ["12 ชั่วโมง", "24 ชั่วโมง", "30 วัน", "365 วัน"], answer: 1 },
    { q: "ข้อใดคือสัตว์เลี้ยงลูกด้วยนม?", choices: ["ฉลาม", "จระเข้", "วาฬ", "เต่า"], answer: 2 },
    { q: "น้ำประกอบด้วยธาตุอะไรบ้าง?", choices: ["H และ O", "C และ O", "N และ O", "H และ C"], answer: 0 }
];

let gameState = {
    status: 'waiting', // waiting, playing, summary
    currentQ: 0,
    redTotalPower: 0,
    blueTotalPower: 0,
    ropePosition: 50, // 50 คือตรงกลาง (0=แดงชนะขาด, 100=น้ำเงินชนะขาด)
    redPlayers: 0,
    bluePlayers: 0,
    redAnswered: 0,
    blueAnswered: 0,
};

let questionStartTime = 0;
let timerInterval;

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // ผู้เล่นเข้าทีม
    socket.on('join_team', (team) => {
        socket.team = team;
        socket.hasAnswered = false;
        if (team === 'RED') gameState.redPlayers++;
        if (team === 'BLUE') gameState.bluePlayers++;
        io.emit('update_lobby', gameState);
    });

    // โฮสต์สั่งเริ่มเกม / เริ่มข้อต่อไป
    socket.on('start_question', () => {
        if (gameState.currentQ >= questions.length) return;
        
        gameState.status = 'playing';
        gameState.redAnswered = 0;
        gameState.blueAnswered = 0;
        
        // รีเซ็ตเชือกกลับมาตรงกลางทุกข้อ (หรือจะให้ดึงต่อเนื่องก็ได้ แต่แนะนำให้รีเซ็ตเพื่อความสูสีในแต่ละข้อ)
        gameState.ropePosition = 50; 
        
        // บอกให้ทุกคนรีเซ็ตสถานะการตอบ
        const sockets = io.sockets.sockets;
        for (const [id, s] of sockets) {
            s.hasAnswered = false;
        }

        io.emit('new_question', {
            questionIndex: gameState.currentQ,
            questionData: questions[gameState.currentQ],
            ropePosition: gameState.ropePosition
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

    // ผู้เล่นส่งคำตอบ
    socket.on('submit_answer', (answerIndex) => {
        if (gameState.status !== 'playing' || socket.hasAnswered || !socket.team) return;
        
        socket.hasAnswered = true;
        let timeTaken = (Date.now() - questionStartTime) / 1000;
        if (timeTaken > 15) timeTaken = 15;

        const currentQuestion = questions[gameState.currentQ];
        const isCorrect = (answerIndex === currentQuestion.answer);

        let power = 0;
        if (isCorrect) {
            // สูตร: 100 * (15 - เวลา) / 15
            power = 100 * ((15 - timeTaken) / 15);
            power = Math.round(power * 10) / 10;
        }

        // เพิ่มแรงให้ทีมและขยับเชือกแบบ Real-time
        if (socket.team === 'RED') {
            gameState.redTotalPower += power;
            gameState.redAnswered++;
            gameState.ropePosition -= (power * 0.15); // สเกลการขยับเชือก
        } else {
            gameState.blueTotalPower += power;
            gameState.blueAnswered++;
            gameState.ropePosition += (power * 0.15);
        }

        // จำกัดขอบเขตเชือก
        if(gameState.ropePosition < 0) gameState.ropePosition = 0;
        if(gameState.ropePosition > 100) gameState.ropePosition = 100;

        // ส่งผลลัพธ์กลับไปที่มือถือคนตอบ
        socket.emit('answer_result', { isCorrect, power, timeTaken: timeTaken.toFixed(2) });

        // บรอดแคสต์ตำแหน่งเชือกล่าสุดให้จอใหญ่
        io.emit('update_rope', {
            ropePosition: gameState.ropePosition,
            redAnswered: gameState.redAnswered,
            blueAnswered: gameState.blueAnswered,
            redTotalPower: Math.round(gameState.redTotalPower),
            blueTotalPower: Math.round(gameState.blueTotalPower)
        });
    });

    socket.on('disconnect', () => {
        if (socket.team === 'RED') gameState.redPlayers--;
        if (socket.team === 'BLUE') gameState.bluePlayers--;
        io.emit('update_lobby', gameState);
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

server.listen(3000, () => {
    console.log('Game Server is running at http://localhost:3000');
});
