const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

const ROUND_TIME = 60; 
const rooms = {};

// ลอจิกจำกัด Slot Tournament 5 รอบ (Index 0 = รอบ 1)
const TOURNAMENT_SLOTS = [16, 8, 4, 2, 1];

// --- ชุดคำถามแยกตามรอบ ---
const questionsRound1 = [
    { q: "1. ค่าความดันโลหิตปกติในผู้ใหญ่ควรน้อยกว่าเท่าใด?", choices: ["140/90 มม.ปรอท", "120/80 มม.ปรอท"], answer: 1 },
    { q: "2. ความดันโลหิตตัวบน (Systolic) หมายถึงค่าใด?", choices: ["แรงดันขณะหัวใจบีบตัว", "แรงดันขณะหัวใจคลายตัว"], answer: 0 },
    { q: "3. อาหารประเภทใดส่งผลให้ความดันโลหิตสูงขึ้นมากที่สุด?", choices: ["อาหารรสหวานจัด", "อาหารรสเค็มจัด (โซเดียมสูง)"], answer: 1 },
    { q: "4. ข้อใดเป็นข้อปฏิบัติที่ถูกต้องก่อนทำการวัดความดันโลหิต?", choices: ["นั่งพักสงบๆ 3-5 นาที", "ดื่มกาแฟหรือชาทันทีเพื่อให้ตื่นตัว"], answer: 0 },
    { q: "5. โรคความดันโลหิตสูงมักถูกเรียกว่าอะไร เนื่องจากระยะแรกมักไม่มีอาการเตือน?", choices: ["ภัยเงียบ", "โรคฉับพลัน"], answer: 0 },
    { q: "6. พฤติกรรมในข้อใดช่วยลดระดับความดันโลหิตได้?", choices: ["การสูบบุหรี่เป็นประจำ", "การออกกำลังกายสม่ำเสมอ"], answer: 1 },
    { q: "7. การรับประทานยาลดความดันโลหิตที่ถูกต้องคือข้อใด?", choices: ["ทานต่อเนื่องตามแพทย์สั่ง แม้ไม่มีอาการ", "หยุดทานทันทีเมื่อรู้สึกสบายดีขึ้น"], answer: 0 },
    { q: "8. ค่าความดันโลหิตตัวล่าง (Diastolic) คืออะไร?", choices: ["แรงดันเลือดขณะหัวใจบีบตัว", "แรงดันเลือดขณะหัวใจคลายตัว"], answer: 1 },
    { q: "9. ภาวะแทรกซ้อนอันตรายที่เกิดจากความดันโลหิตสูงเรื้อรังคือข้อใด?", choices: ["โรคหลอดเลือดสมองและหัวใจ", "โรคภูมิแพ้อากาศ"], answer: 0 },
    { q: "10. เครื่องปรุงรสในข้อใดมีโซเดียมสูง ซึ่งผู้ป่วยความดันสูงควรหลีกเลี่ยง?", choices: ["น้ำมันพืช", "ผงชูรสและซีอิ๊ว"], answer: 1 }
];
const questionsRound2 = [
    { q: "11. ท่าทางการนั่งวัดความดันโลหิตที่ถูกต้องคือข้อใด?", choices: ["นั่งไขว่ห้างและเกร็งตัว", "นั่งหลังตรงและวางแขนให้อยู่ระดับหัวใจ"], answer: 1 },
    { q: "12. ภาวะน้ำหนักเกินหรืออ้วนส่งผลอย่างไรต่อความดันโลหิต?", choices: ["ทำให้ความดันโลหิตมีแนวโน้มสูงขึ้น", "ช่วยให้ความดันโลหิตลดลงสู่เกณฑ์ปกติ"], answer: 0 },
    { q: "13. การนอนหลับพักผ่อนไม่เพียงพอส่งผลอย่างไรต่อร่างกาย?", choices: ["อาจทำให้ความดันโลหิตสูงขึ้นได้", "ทำให้ความดันโลหิตคงที่ตลอดวัน"], answer: 0 },
    { q: "14. ความเครียดสะสมส่งผลต่อระบบหลอดเลือดอย่างไร?", choices: ["ทำให้หลอดเลือดหดตัวและความดันสูงขึ้น", "ทำให้หลอดเลือดขยายตัวและความดันลดลง"], answer: 0 },
    { q: "15. หากวัดความดันโลหิตได้ค่า 155/95 มม.ปรอท แปลผลได้อย่างไร?", choices: ["ความดันโลหิตปกติ", "ความดันโลหิตสูง"], answer: 1 },
    { q: "16. สารอาหารชนิดใดในผักผลไม้ที่ช่วยขับโซเดียมและควบคุมความดัน?", choices: ["โพแทสเซียม", "คอเลสเตอรอล"], answer: 0 },
    { q: "17. คำภาษาอังกฤษที่ใช้เรียก 'โรคความดันโลหิตสูง' คือข้อใด?", choices: ["Diabetes", "Hypertension"], answer: 1 },
    { q: "18. การวัดความดันโลหิตเองที่บ้านมีประโยชน์อย่างไร?", choices: ["ช่วยติดตามค่าความดันจริงในชีวิตประจำวัน", "ใช้ทดแทนการกินยาตามที่แพทย์สั่งได้"], answer: 0 },
    { q: "19. เมื่ออายุมากขึ้น ความยืดหยุ่นของหลอดเลือดลดลง จะส่งผลอย่างไร?", choices: ["เพิ่มความเสี่ยงต่อการเกิดโรคความดันโลหิตสูง", "ทำให้ความดันโลหิตลดต่ำลงเรื่อยๆ"], answer: 0 },
    { q: "20. การดื่มเครื่องดื่มแอลกอฮอล์ปริมาณมากส่งผลอย่างไรต่อความดันโลหิต?", choices: ["ส่งผลให้ความดันโลหิตสูงขึ้น", "ช่วยให้หลอดเลือดแข็งแรงและดันโลหิตต่ำลง"], answer: 0 }
];
const questionsRound3 = [
    { q: "ข้อ 1. ค่าความดันโลหิต 'ตัวล่าง' (Diastolic) แสดงถึงแรงดันเลือดในภาวะใด?", choices: ["ขณะหัวใจบีบตัว", "ขณะหัวใจคลายตัว"], answer: 1 },
    { q: "ข้อ 2. ยาประหยัดโซเดียมหรือผงชูรสผงนัว มีส่วนประกอบของอะไรที่ทำให้ความดันสูงขึ้น?", choices: ["โซเดียม (Sodium)", "โพแทสเซียม (Potassium)"], answer: 0 },
    { q: "ข้อ 3. 'ภาวะความดันโลหิตสูงแอบแฝง' (White Coat Hypertension) คืออาการอย่างไร?", choices: ["ความดันสูงเฉพาะเวลาเจอหมอ/วัดที่โรงพยาบาล", "ความดันสูงเฉพาะช่วงเวลาตื่นนอนตอนเช้า"], answer: 0 },
    { q: "ข้อ 4. การสูบบุหรี่ส่งผลอย่างไรต่อหลอดเลือดในผู้ป่วยความดันโลหิตสูง?", choices: ["ทำให้หลอดเลือดหดตัวและตีบเกร็งทันที", "ทำให้หลอดเลือดขยายตัวมากเกินไปจนอักเสบ"], answer: 0 },
    { q: "ข้อ 5. อวัยวะใดที่มีหน้าที่กรองของเสียและมักได้รับความเสียหายอย่างหนักจากโรคความดันสูงเรื้อรัง?", choices: ["ตับ", "ไต"], answer: 1 },
    { q: "ข้อ 6. เครื่องดื่มแอลกอฮอล์ส่งผลต่อระดับความดันโลหิตอย่างไร?", choices: ["หากดื่มปริมาณมากเป็นประจำจะทำให้ความดันพุ่งสูงขึ้น", "ช่วยขยายหลอดเลือดและทำให้ความดันลดลงอย่างยั่งยืน"], answer: 0 },
    { q: "ข้อ 7. ผู้ที่มีภาวะหยุดหายใจขณะหลับจากการอุดกั้น (Snoring/Sleep Apnea) มีความเสี่ยงต่อความดันโลหิตสูงหรือไม่?", choices: ["มีความเสี่ยงสูง เพราะร่างกายขาดออกซิเจนเป็นช่วงๆ ทำให้ความดันพุ่งสูงตอนกลางคืน", "ไม่มีความเสี่ยง เพราะความดันจะลดลงเสมอขณะนอนหลับ"], answer: 0 },
    { q: "ข้อ 8. ปริมาณโซเดียมที่องค์การอนามัยโลก (WHO) แนะนำให้บริโภคไม่เกินต่อวันคือเท่าใด?", choices: ["ไม่เกิน 2,000 มิลลิกรัม (เกลือประมาณ 1 ช้อนชา)", "ไม่เกิน 5,000 มิลลิกรัม (เกลือประมาณ 1 ช้อนโต๊ะ)"], answer: 0 },
    { q: "ข้อ 9. แร่ธาตุชนิดใดในอาหาร ที่ช่วยขับโซเดียมและลดความดันโลหิตได้ดี?", choices: ["แคลเซียม", "โพแทสเซียม"], answer: 1 },
    { q: "ข้อ 10. ก่อนทำการวัดความดันโลหิต ไม่ควรกินกาแฟหรือดื่มชาล่วงหน้ากี่นาที?", choices: ["อย่างน้อย 30 นาที", "ไม่ต้องเว้นระยะ สามารถดื่มแล้ววัดได้ทันที"], answer: 0 }
];
const questionsRound4 = [
    { q: "ข้อ 11. ขณะทำการวัดความดันโลหิต ตำแหน่งของแขนและปลอกแขน (Cuff) ควรอยู่ที่ระดับใด?", choices: ["ระดับเดียวกับหัวใจ", "วางต่ำกว่าระดับหัวใจลงไปที่หน้าตัก"], answer: 0 },
    { q: "ข้อ 12. หากวัดความดันโลหิตได้ค่า 140/90 mmHg ถือว่าอยู่ในเกณฑ์ใด?", choices: ["ความดันโลหิตสูง (Stage 1)", "ความดันโลหิตปกติสมบูรณ์แบบ"], answer: 0 },
    { q: "ข้อ 13. อาหารรูปแบบ DASH Diet เน้นทานอะไรเป็นหลัก?", choices: ["ผัก ผลไม้ ธัญพืช ถั่ว และเนื้อสัตว์ไขมันต่ำ", "เน้นทานแป้งขัดขาว ผัดน้ำมันทอด และเนื้อสัตว์ติดมัน"], answer: 0 },
    { q: "ข้อ 14. โรคความดันโลหิตสูงส่วนใหญ่ (มากกว่า 90%) เป็นประเภทใด?", choices: ["ไม่ทราบสาเหตุแน่ชัด (Primary/Essential Hypertension)", "มีสาเหตุมาจากเนื้องอกในสมองโดยตรง"], answer: 0 },
    { q: "ข้อ 15. ภาวะน้ำหนักตัวเกินหรืออ้วน ส่งผลต่อความดันโลหิตอย่างไร?", choices: ["ทำให้หัวใจต้องสูบฉีดเลือดไปเลี้ยงร่างกายมากขึ้น ความดันจึงสูงขึ้น", "ช่วยให้หลอดเลือดขยายตัวได้กว้างขึ้น ทำให้ความดันลดลง"], answer: 0 },
    { q: "ข้อ 16. การนอนหลับพักผ่อนไม่เพียงพอ ส่งผลต่อความดันอย่างไร?", choices: ["กระตุ้นระบบประสาทซิมพาเทติก ทำให้ความดันและหัวใจทำงานหนักขึ้น", "ช่วยให้หลอดเลือดได้คลายตัว ความดันจึงต่ำลง"], answer: 0 },
    { q: "ข้อ 17. ผู้ป่วยความดันสูงที่ทานยา สามารถซื้อยาแก้ปวดกลุ่ม NSAIDs ทานเองได้หรือไม่?", choices: ["ควรระวังและปรึกษาเภสัชกร เพราะยาอาจทำให้ความดันสูงขึ้น", "ทานได้เสรี เพราะไม่มีผลต่อระบบหลอดเลือดและหัวใจ"], answer: 0 },
    { q: "ข้อ 18. เส้นประสาทตาและจอตา (Retina) สามารถได้รับความเสียหายจากความดันโลหิตสูงหรือไม่?", choices: ["ได้ อาจเกิดภาวะจอประสาทตาเสื่อมจากความดันสูง", "ไม่ได้ ดวงตาเป็นอวัยวะที่ไม่เกี่ยวกับแรงดันเลือด"], answer: 0 },
    { q: "ข้อ 19. ในผู้สูงอายุ มักพบภาวะความดันโลหิตสูงชนิดใดบ่อยที่สุด?", choices: ["ความดันตัวบนสูงอย่างเดียว (Isolated Systolic Hypertension)", "ความดันตัวล่างสูงอย่างเดียว"], answer: 0 },
    { q: "ข้อ 20. ข้อใดคือความเข้าใจผิดที่อันตรายที่สุดเกี่ยวกับโรคความดันโลหิตสูง?", choices: ["\"ถ้าไม่มีอาการปวดหัว แสดงว่าความดันปกติ ไม่จำเป็นต้องกินยา\"", "\"ต้องวัดความดันเป็นประจำแม้วันที่รู้สึกสบายดี\""], answer: 0 }
];
const questionsRound5Raw = [
    { q: "1. คนเป็นโรคความดันโลหิตสูง ถ้าอาการกำเริบต้องรีบไปที่ไหน?", correct: "โรงพยาบาล", wrong: "วัด" },
    { q: "2. ทำไมหมอถึงบอกว่าความดันโลหิตสูงเปรียบเหมือน 'ความรัก'?", correct: "เพราะไม่มีสัญญาณเตือนล่วงหน้า", wrong: "เพราะยิ่งใกล้ ยิ่งใจสั่น" },
    { q: "3. ยารักษาความดันโลหิต ยี่ห้อไหนกินแล้วความดันลดไวที่สุด?", correct: "ยาตามสั่งแพทย์", wrong: "ยา 3 ชั้น" },
    { q: "4. กิจกรรมใดอาจส่งผลให้เกิดความดันสูง", correct: "กินของเค็มเยอะ", wrong: "ดันพื้น" },
    { q: "5. พฤติกรรมแบบไหนที่ช่วยให้ความดัน 'ลดลง' ได้รวดเร็วที่สุด?", correct: "กินยาลดความดัน", wrong: "ผลักความดันออกไป" },
    { q: "6. ถ้าอยากรู้ว่าตัวเองความดันสูงไหม ต้องไปคุยกับใคร?", correct: "หมอ", wrong: "ช่างไฟ" },
    { q: "7. ค่าความดันโลหิตตัวไหนที่อันตรายที่สุด?", correct: "ตัวบนสูงเกินไป", wrong: "ตัวที่อยู่ข้างหลังเรา" },
    { q: "8. เครื่องมือชนิดไหนที่คนเป็นความดันกลัวมากที่สุด?", correct: "เครื่องวัดความดัน", wrong: "แม่แรงยกรถ" },
    { q: "9. ทำไมเวลาเครียด ความดันถึงพุ่งสูงขึ้น?", correct: "เส้นเลือดหดตัว", wrong: "เพราะความรักทำให้คนตาบอด" },
    { q: "10. ทำไมคนเป็นความดันโลหิตสูงไม่ควรออกกำลังกายหนัก ?", correct: "เพราะจะทำให้ความดันพุ่งสูง", wrong: "เพราะมันเหนื่อย" }
];

function getBaseQuestions(roundNumber) {
    if (roundNumber === 1) return [...questionsRound1];
    if (roundNumber === 2) return [...questionsRound2];
    if (roundNumber === 3) return [...questionsRound3];
    if (roundNumber === 4) return [...questionsRound4];
    return [...questionsRound5Raw];
}

function shuffleArray(array) {
    let curId = array.length;
    while (0 !== curId) {
        let randId = Math.floor(Math.random() * curId);
        curId -= 1;
        let tmp = array[curId];
        array[curId] = array[randId];
        array[randId] = tmp;
    }
    return array;
}

function getNextQuestionForPlayer(player, roundNumber) {
    if (!player.questionBag || player.questionBag.length === 0) {
        player.questionBag = shuffleArray(getBaseQuestions(roundNumber));
    }
    const qRaw = player.questionBag.pop();

    if (roundNumber >= 5) {
        const isCorrectFirst = Math.random() < 0.5;
        return {
            q: qRaw.q,
            choices: isCorrectFirst ? [qRaw.correct, qRaw.wrong] : [qRaw.wrong, qRaw.correct],
            answer: isCorrectFirst ? 0 : 1
        };
    }
    return qRaw;
}

function generateRoomCode() {
    let code;
    do { code = Math.floor(100000 + Math.random() * 900000).toString(); } while (rooms[code]);
    return code;
}

io.on('connection', (socket) => {
    socket.on('create_room', () => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = { hostId: socket.id, players: {}, state: 'waiting', ropePosition: 50, botCount: 0, roundNumber: 1, allowedPerTeam: TOURNAMENT_SLOTS[0] };
        socket.join(roomCode);
        socket.emit('room_created', { roomCode });
    });

    socket.on('join_room', ({ roomCode, name, team }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'waiting') return socket.emit('join_error', 'เกมเริ่มไปแล้ว หรือห้องไม่มีอยู่จริง!');
        if (room.roundNumber > 1) return socket.emit('join_error', 'ไม่สามารถเข้าร่วมได้ เนื่องจากเกมผ่านรอบแรกไปแล้ว!');

        const teamPlayers = Object.values(room.players).filter(p => p.team === team && p.status === 'active');
        if (teamPlayers.length >= room.allowedPerTeam) return socket.emit('join_error', `ทีมเต็มแล้ว! (รับสูงสุด ${room.allowedPerTeam} คนต่อทีม)`);

        let freeSlot = 0;
        const usedSlots = new Set(teamPlayers.map(p => p.slot));
        while (usedSlots.has(freeSlot)) freeSlot++;

        room.players[socket.id] = { id: socket.id, name: name.trim() || 'Player', team, slot: freeSlot, status: 'active', isBot: false, questionBag: [] };
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
        if (targetTeamPlayers.length >= room.allowedPerTeam) return socket.emit('join_error', `ทีมเต็มแล้ว!`);

        let freeSlot = 0;
        const usedSlots = new Set(targetTeamPlayers.map(p => p.slot));
        while (usedSlots.has(freeSlot)) freeSlot++;

        player.team = targetTeam; player.slot = freeSlot;
        socket.emit('team_switched', { team: targetTeam, slot: freeSlot });
        updateLobby(roomCode);
    });

    socket.on('rejoin_team', ({ roomCode, team }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'waiting') return;
        const player = room.players[socket.id];
        if (!player || player.status !== 'survived') return;

        const teamPlayers = Object.values(room.players).filter(p => p.team === team && p.status === 'active');
        if (teamPlayers.length >= room.allowedPerTeam) return socket.emit('join_error', `ทีมเต็มแล้ว! (รับสูงสุด ${room.allowedPerTeam} คนต่อทีม)`);

        let freeSlot = 0;
        const usedSlots = new Set(teamPlayers.map(p => p.slot));
        while (usedSlots.has(freeSlot)) freeSlot++;

        player.team = team; player.slot = freeSlot; player.status = 'active'; player.questionBag = []; 
        socket.emit('join_success', { name: player.name, team, slot: freeSlot, roomCode });
        updateLobby(roomCode);
    });

    socket.on('add_bot', ({ roomCode, team }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id || room.state !== 'waiting') return;
        
        const teamPlayers = Object.values(room.players).filter(p => p.team === team && p.status === 'active');
        if (teamPlayers.length >= room.allowedPerTeam) return;

        let freeSlot = 0;
        const usedSlots = new Set(teamPlayers.map(p => p.slot));
        while (usedSlots.has(freeSlot)) freeSlot++;

        room.botCount++;
        const botId = `bot_${Date.now()}_${room.botCount}`;
        room.players[botId] = { id: botId, name: `🤖 บอท ${room.botCount}`, team, slot: freeSlot, status: 'active', isBot: true };
        updateLobby(roomCode);
    });

    socket.on('kick_player', ({ roomCode, targetId }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;
        if (room.players[targetId]) {
            if (!room.players[targetId].isBot) io.to(targetId).emit('kicked');
            delete room.players[targetId];
            updateLobby(roomCode);
        }
    });

    socket.on('start_match', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        // Auto-assign คน/บอท ที่ยังค้างสถานะ survived ให้ลงทีมอัตโนมัติ
        for (let pId in room.players) {
            let p = room.players[pId];
            if (p.status === 'survived') {
                let redCount = Object.values(room.players).filter(pl => pl.team === 'RED' && pl.status === 'active').length;
                let blueCount = Object.values(room.players).filter(pl => pl.team === 'BLUE' && pl.status === 'active').length;
                
                let targetTeam = (redCount <= blueCount) ? 'RED' : 'BLUE';
                if (redCount >= room.allowedPerTeam && blueCount < room.allowedPerTeam) targetTeam = 'BLUE';
                if (blueCount >= room.allowedPerTeam && redCount < room.allowedPerTeam) targetTeam = 'RED';

                p.team = targetTeam; p.status = 'active'; p.questionBag = [];
                let freeSlot = 0;
                const usedSlots = new Set(Object.values(room.players).filter(pl => pl.team === targetTeam && pl.status === 'active').map(pl => pl.slot));
                while (usedSlots.has(freeSlot)) freeSlot++;
                p.slot = freeSlot;
                
                if (!p.isBot) {
                    io.to(p.id).emit('join_success', { name: p.name, team: p.team, slot: p.slot, roomCode });
                }
            }
        }

        room.state = 'playing'; room.ropePosition = 50;
        io.to(roomCode).emit('match_started');
        updateLobby(roomCode);

        for (let pId in room.players) {
            if (!room.players[pId].isBot && room.players[pId].status === 'active') {
                const nextQ = getNextQuestionForPlayer(room.players[pId], room.roundNumber);
                room.players[pId].currentQuestion = nextQ;
                io.to(pId).emit('new_question', nextQ);
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

    socket.on('submit_answer', ({ roomCode, answerIndex }) => {
        const room = rooms[roomCode];
        if (!room || room.state !== 'playing') return;

        const player = room.players[socket.id];
        if (!player || player.status !== 'active' || !player.currentQuestion) return;

        const isCorrect = (answerIndex === player.currentQuestion.answer);
        let power = isCorrect ? 3.5 : 0;

        if (isCorrect) {
            player.team === 'RED' ? room.ropePosition -= power : room.ropePosition += power;
            if (room.ropePosition < 5) room.ropePosition = 5;
            if (room.ropePosition > 95) room.ropePosition = 95;
        }

        socket.emit('answer_result', { isCorrect, power });
        io.to(roomCode).emit('update_rope', { ropePosition: room.ropePosition, lastPuller: { id: player.id, name: player.name, team: player.team } });

        setTimeout(() => {
            if (room.state === 'playing' && player.status === 'active') {
                const nextQ = getNextQuestionForPlayer(player, room.roundNumber);
                player.currentQuestion = nextQ;
                socket.emit('new_question', nextQ);
            }
        }, 1000);
    });

    function endRound(roomCode) {
        const room = rooms[roomCode];
        if (!room) return;

        let winningTeam = room.ropePosition > 50 ? 'BLUE' : (room.ropePosition < 50 ? 'RED' : (Math.random() > 0.5 ? 'RED' : 'BLUE'));
        let realSurvivors = [];
        let botSurvivors = [];

        // 1. แยกผู้รอดชีวิตและคัดผู้ตกรอบ
        for (let pId in room.players) {
            let p = room.players[pId];
            if (p.status === 'active') {
                if (p.team === winningTeam) {
                    p.status = 'survived'; 
                    p.team = null; 
                    if (p.isBot) {
                        botSurvivors.push(p);
                    } else {
                        realSurvivors.push(p);
                    }
                } else {
                    // ผู้แพ้ (ตกรอบ)
                    if (p.isBot) { 
                        delete room.players[pId]; 
                    } else {
                        p.status = 'eliminated';
                        io.to(pId).emit('eliminated');
                        // แก้ปัญหาที่ 2: ตัด Socket ของคนที่แพ้ออกจากห้อง เพื่อไม่ให้ได้รับ Broadcast รอบถัดไป
                        const elimSocket = io.sockets.sockets.get(pId);
                        if (elimSocket && pId !== room.hostId) {
                            elimSocket.leave(roomCode);
                        }
                        delete room.players[pId]; // ลบข้อมูลจากผู้เล่นแอคทีฟ
                    }
                }
            }
        }

        const totalSurvivors = realSurvivors.length + botSurvivors.length;

        // 2. เช็คเงื่อนไขจบทัวร์นาเมนต์
        if (totalSurvivors === 0) {
            room.state = 'ended'; 
            io.to(roomCode).emit('game_over');
        } else if (room.roundNumber >= 5) {
            room.state = 'ended'; 
            let allWinners = realSurvivors.concat(botSurvivors);
            let champName = allWinners.map(p => p.name).join(', ');
            io.to(roomCode).emit('champion', { name: champName, survivorIds: realSurvivors.map(p => p.id) });
        } else {
            // เดินหน้าสู่รอบถัดไป
            room.state = 'waiting'; 
            room.roundNumber++;
            
            room.ropePosition = 50;
            io.to(roomCode).emit('update_rope', { ropePosition: 50 });

            let slotIndex = room.roundNumber - 1;
            if (slotIndex > 4) slotIndex = 4;
            room.allowedPerTeam = TOURNAMENT_SLOTS[slotIndex];

            // แก้ปัญหาที่ 1: จัดการกระจาย บอท ที่รอดชีวิตเข้าทีมอัตโนมัติในรอบใหม่ทันที
            botSurvivors.forEach(bot => {
                let redCount = Object.values(room.players).filter(pl => pl.team === 'RED' && pl.status === 'active').length;
                let blueCount = Object.values(room.players).filter(pl => pl.team === 'BLUE' && pl.status === 'active').length;

                let targetTeam = (redCount <= blueCount) ? 'RED' : 'BLUE';
                if (redCount >= room.allowedPerTeam && blueCount < room.allowedPerTeam) targetTeam = 'BLUE';
                if (blueCount >= room.allowedPerTeam && redCount < room.allowedPerTeam) targetTeam = 'RED';

                let currentTeamCount = Object.values(room.players).filter(pl => pl.team === targetTeam && pl.status === 'active').length;
                if (currentTeamCount < room.allowedPerTeam) {
                    bot.team = targetTeam;
                    bot.status = 'active';
                    let freeSlot = 0;
                    const usedSlots = new Set(Object.values(room.players).filter(pl => pl.team === targetTeam && pl.status === 'active').map(pl => pl.slot));
                    while (usedSlots.has(freeSlot)) freeSlot++;
                    bot.slot = freeSlot;
                } else {
                    delete room.players[bot.id]; // โควต้ารอบใหม่เต็มตัดบอทส่วนเกินออก
                }
            });

            // แจ้งเตือนผู้เล่นจริงที่รอดชีวิตเลือกทีมใหม่
            realSurvivors.forEach(p => io.to(p.id).emit('pick_team_again'));

            const activeBotsCount = Object.values(room.players).filter(p => p.isBot && p.status === 'active').length;
            io.to(roomCode).emit('round_end', { 
                winningTeam, 
                survivors: realSurvivors.length + activeBotsCount, 
                roundNumber: room.roundNumber,
                allowedPerTeam: room.allowedPerTeam
            });
            updateLobby(roomCode);
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
