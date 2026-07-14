// Global Event Delegation Ripple Engine
(function() {
  function handleRippleTrigger(e) {
    // 1. Automatically find the button, even if it was just dynamically created/changed
    const el = e.target.closest('button, .btn, a, select, input[type="submit"], input[type="button"], .ripple');
    if (!el) return;

    // 2. Ensure it has the ripple class for styling
    if (!el.classList.contains('ripple')) {
      el.classList.add('ripple');
    }

    // 3. Remove any stuck ripples
    const oldRipple = el.querySelector('.ripple-effect');
    if (oldRipple) oldRipple.remove();

    // 4. Calculate size and position
    const circle = document.createElement('div');
    const d = Math.max(el.clientWidth, el.clientHeight);
    const rect = el.getBoundingClientRect();

    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    circle.style.width = circle.style.height = d + 'px';
    circle.style.left = clientX - rect.left - d / 2 + 'px';
    circle.style.top = clientY - rect.top - d / 2 + 'px';
    circle.classList.add('ripple-effect');

    // 5. Inject ripple into the button
    el.appendChild(circle);
    setTimeout(() => circle.remove(), 650);
  }

  // Bind globally so re-rendered buttons are caught instantly
  document.removeEventListener('click', handleRippleTrigger); 
  document.addEventListener('click', handleRippleTrigger, { passive: false });
  
  document.removeEventListener('touchstart', handleRippleTrigger);
  document.addEventListener('touchstart', handleRippleTrigger, { passive: true });
})();