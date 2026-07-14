const cookie = require('cookie');
const { verifyAccessToken } = require('../utils/tokens');
const { getUserById } = require('../db');

function parseCookies(header) {
  return header ? cookie.parse(header) : {};
}

function initSockets(io) {
  io.use((socket, next) => {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const raw = cookies.access_token;
    const { payload } = raw ? verifyAccessToken(raw) : { payload: null };
    if (!payload) return next(new Error('Unauthorized'));

    const user = getUserById(payload.sub);
    if (!user) return next(new Error('Unauthorized'));

    socket.user = user;
    next();
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.user.id}`);

    socket.on('disconnect', () => {
      // no-op for now; hook for presence tracking if needed later
    });
  });

  return io;
}

// Helper other parts of the app can use to push a live notification,
// e.g. require('../sockets').notifyUser(io, userId, {...})
function notifyUser(io, userId, payload) {
  io.to(`user:${userId}`).emit('notification', payload);
}

module.exports = { initSockets, notifyUser };
