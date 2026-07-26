const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const upload = multer({ 
  storage: multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
  })
});

let images = [];
let currentGame = null;
let players = {};

app.post('/upload', upload.array('images'), (req, res) => {
  const newImgs = req.files.map(f => ({
    id: 'img_' + Date.now() + Math.random().toString(36).slice(2),
    url: `/uploads/${f.filename}`
  }));
  images.push(...newImgs);
  io.emit('imagesUpdated', images);
  res.json({ok: true});
});

io.on('connection', (socket) => {

  socket.on('setNickname', (nick) => {
    if (!players[socket.id]) players[socket.id] = { score: 0 };
    players[socket.id].nick = nick || `Игрок${Math.floor(Math.random()*999)}`;
    io.emit('playerList', Object.values(players).map(p => p.nick));
  });

  socket.on('setAvatar', (avatar) => {
    if (!players[socket.id]) players[socket.id] = { score: 0 };
    players[socket.id].avatar = avatar;
  });

  // Чат
  socket.on('chat', (data) => {
    io.emit('chat', data);
  });

  socket.on('startGame', () => {
    if (images.length < 2) return socket.emit('error', 'Мало картинок!');

    Object.keys(players).forEach(id => {
      players[id].score = 0;
    });

    currentGame = {
      rounds: [],
      currentRoundIndex: 0
    };

    const shuffled = [...images].sort(() => 0.5 - Math.random());
    for (let i = 0; i < 7 && i < shuffled.length - 1; i += 2) {
      currentGame.rounds.push({
        left: shuffled[i],
        right: shuffled[i + 1],
        votes: {}
      });
    }

    io.emit('gameStarted');
    startNextMiniRound();
  });

  function startNextMiniRound() {
    if (!currentGame || currentGame.currentRoundIndex >= currentGame.rounds.length) {
      const leaderboard = Object.values(players)
        .map(p => ({ nick: p.nick, score: p.score || 0, avatar: p.avatar }))
        .sort((a, b) => b.score - a.score);

      io.emit('gameEnded', { leaderboard });
      return;
    }

    const round = currentGame.rounds[currentGame.currentRoundIndex];
    round.votes = {};
    const duration = 10000;
    round.timerEnd = Date.now() + duration;

    io.emit('newMiniRound', {
      roundIndex: currentGame.currentRoundIndex + 1,
      pair: [round.left, round.right],
      timeLeft: 10
    });

    const timer = setInterval(() => {
      const timeLeft = Math.ceil((round.timerEnd - Date.now()) / 1000);
      if (timeLeft <= 0) {
        clearInterval(timer);
        showResults(round);
      } else {
        io.emit('timerUpdate', timeLeft);
      }
    }, 300);
  }

  function showResults(round) {
    const leftCount = Object.values(round.votes).filter(v => v === 'left').length;
    const rightCount = Object.values(round.votes).filter(v => v === 'right').length;
    const winnerSide = leftCount > rightCount ? 'left' : (rightCount > leftCount ? 'right' : null);

    if (winnerSide) {
      Object.keys(round.votes).forEach(id => {
        if (round.votes[id] === winnerSide && players[id]) {
          players[id].score = (players[id].score || 0) + 1;
        }
      });
    }

    const voters = Object.keys(round.votes).map(id => ({
      name: players[id]?.nick || 'Аноним',
      choice: round.votes[id],
      avatar: players[id]?.avatar || { color: '#9B59B6', hat: 'none' }
    }));

    io.emit('roundResults', {
      leftVotes: leftCount,
      rightVotes: rightCount,
      voters,
      winnerSide
    });

    setTimeout(() => {
      currentGame.currentRoundIndex++;
      startNextMiniRound();
    }, 6000);
  }

  socket.on('vote', (side) => {
    if (!currentGame) return;
    const round = currentGame.rounds[currentGame.currentRoundIndex];
    if (!round || round.votes[socket.id]) return;

    round.votes[socket.id] = side;

    const leftVoters = [];
    const rightVoters = [];
    Object.keys(round.votes).forEach(id => {
      const info = {
        name: players[id]?.nick || 'Аноним',
        avatar: players[id]?.avatar || { color: '#9B59B6', hat: 'none' }
      };
      if (round.votes[id] === 'left') leftVoters.push(info);
      else rightVoters.push(info);
    });

    io.emit('liveVotes', { left: leftVoters, right: rightVoters });
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerList', Object.values(players).map(p => p.nick));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Shotlanka Battle на порту ${PORT}`));