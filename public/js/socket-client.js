(function () {
  if (typeof io === 'undefined') return;

  const socket = io();

  socket.on('notification', (payload) => {
    // Minimal live-notification hook. Extend this to push a toast or
    // prepend to the notifications list on the dashboard without a reload.
    console.log('New notification:', payload);
  });

  socket.on('connect_error', (err) => {
    console.warn('Socket connection failed:', err.message);
  });
})();
