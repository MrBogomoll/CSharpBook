'use strict';

function addPageScrollbar(scroller, label) {
  const frame = document.createElement('div');
  frame.className = 'page-scroll-frame';
  const bar = document.createElement('div');
  bar.className = 'page-scrollbar';
  bar.setAttribute('role', 'scrollbar');
  bar.setAttribute('aria-orientation', 'vertical');
  bar.setAttribute('aria-controls', scroller.id);
  bar.setAttribute('aria-label', label);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', '0');
  bar.tabIndex = 0;
  bar.hidden = true;
  const thumb = document.createElement('span');
  thumb.className = 'page-scroll-thumb';
  bar.append(thumb);
  scroller.before(frame);
  frame.append(scroller, bar);

  let range = 0, size = 0, travel = 0, top = 0;
  let capture = null, grab = 0, queued = false;
  function update() {
    queued = false;
    const height = scroller.clientHeight;
    range = scroller.scrollHeight - height;
    bar.hidden = height === 0 || range < 1;
    if (bar.hidden) return;
    const track = bar.clientHeight;
    // In a short pane above the keyboard, leave enough travel for a precise drag.
    const minimum = Math.min(44, track * 0.6);
    const maximum = track - Math.min(16, track * 0.4);
    size = Math.min(maximum, Math.max(minimum, track * height / scroller.scrollHeight));
    travel = track - size;
    const position = Math.min(1, Math.max(0, scroller.scrollTop / range));
    top = travel * position;
    thumb.style.height = size + 'px';
    thumb.style.transform = 'translateY(' + top + 'px)';
    bar.setAttribute('aria-valuenow', String(Math.round(position * 100)));
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  }
  const observer = new ResizeObserver(schedule);
  observer.observe(scroller);
  for (const child of scroller.children) observer.observe(child);
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.removedNodes) if (node.nodeType === 1) observer.unobserve(node);
      for (const node of record.addedNodes) if (node.nodeType === 1) observer.observe(node);
    }
    schedule();
  }).observe(scroller, {childList:true});
  scroller.addEventListener('scroll', schedule, {passive:true});

  function drag(y) {
    if (travel > 0) scroller.scrollTop = range * (y - grab * size) / travel;
  }
  bar.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    update();
    const y = event.clientY - bar.getBoundingClientRect().top;
    grab = y >= top && y <= top + size ? (y - top) / size : 0.5;
    capture = event.pointerId;
    bar.setPointerCapture(capture);
    bar.classList.add('dragging');
    event.preventDefault();
    drag(y);
  });
  bar.addEventListener('pointermove', event => {
    if (event.pointerId === capture) drag(event.clientY - bar.getBoundingClientRect().top);
  });
  bar.addEventListener('lostpointercapture', () => {
    capture = null;
    bar.classList.remove('dragging');
  });
  bar.addEventListener('keydown', event => {
    const page = scroller.clientHeight * 0.9;
    let delta;
    switch (event.key) {
      case 'ArrowDown': delta = 40; break;
      case 'ArrowUp': delta = -40; break;
      case 'PageDown': delta = page; break;
      case 'PageUp': delta = -page; break;
      case ' ': delta = event.shiftKey ? -page : page; break;
      case 'Home': delta = -scroller.scrollHeight; break;
      case 'End': delta = scroller.scrollHeight; break;
      default: return;
    }
    event.preventDefault();
    scroller.scrollTop += delta;
  });
  bar.addEventListener('wheel', event => {
    if (event.ctrlKey || !event.deltaY) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
    event.preventDefault();
    scroller.scrollTop += event.deltaY * unit;
  }, {passive:false});
  schedule();
  return update;
}
