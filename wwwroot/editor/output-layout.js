let nextLayoutId = 0;

export function arrangeConsoleOutput(page, {initial, onChange, signal}) {
  const grid = page.querySelector('.cx-grid');
  const editor = grid.querySelector('.cx-editor');
  const terminal = grid.querySelector('.cx-terminal');
  const divider = grid.querySelector('.cx-output-divider');
  const toggle = grid.querySelector('[data-action="toggle-result"]');
  const limit = (value, min = 15, max = 85) => Math.max(min, Math.min(max, Math.round(value)));
  let layout, stacked, minimum = 15, maximum = 85, grabOffset = 0;

  const id = ++nextLayoutId;
  editor.id = 'cx-editor-panel-' + id;
  terminal.id = 'cx-result-panel-' + id;
  divider.setAttribute('aria-controls', editor.id);
  toggle.setAttribute('aria-controls', terminal.id);

  function drawDivider() {
    const style = getComputedStyle(grid);
    stacked = style.getPropertyValue('--stacked').trim() === '1';
    const available = grid.clientWidth - parseFloat(style.getPropertyValue('--grip'));
    // Keep both toolbars usable when sharing a narrow window side by side.
    minimum = !stacked && available >= 400 ? Math.max(15, Math.ceil(250 / available * 100)) : 15;
    maximum = !stacked && available >= 400 ? Math.min(85, Math.floor((1 - 150 / available) * 100)) : 85;
    const size = limit(stacked ? layout.height : layout.width, minimum, maximum);
    grid.style.setProperty('--editor-share', size + 'fr');
    grid.style.setProperty('--output-share', (100 - size) + 'fr');
    divider.setAttribute('aria-orientation', stacked ? 'horizontal' : 'vertical');
    divider.setAttribute('aria-valuemin', String(minimum));
    divider.setAttribute('aria-valuemax', String(maximum));
    divider.setAttribute('aria-valuenow', String(size));
    divider.setAttribute('aria-valuetext', 'Редактор занимает ' + size + '%');
  }
  function show(visible) {
    layout.hidden = !visible;
    if (!visible && terminal.contains(document.activeElement)) toggle.focus({preventScroll:true});
    grid.classList.toggle('output-hidden', !visible);
    terminal.hidden = divider.hidden = !visible;
    toggle.setAttribute('aria-expanded', String(visible));
    toggle.title = visible ? 'Скрыть вывод' : 'Показать вывод';
    toggle.setAttribute('aria-label', toggle.title);
  }
  function restore(value) {
    layout = {
      width: Number.isFinite(value?.width) ? limit(value.width) : 60,
      height: Number.isFinite(value?.height) ? limit(value.height) : 67,
      hidden: value?.hidden === true
    };
    drawDivider();
    show(!layout.hidden);
  }
  function resize(value) {
    layout[stacked ? 'height' : 'width'] = limit(value, minimum, maximum);
    drawDivider();
  }
  divider.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    const rect = divider.getBoundingClientRect();
    grabOffset = stacked ? event.clientY - rect.top : event.clientX - rect.left;
    divider.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, {signal});
  divider.addEventListener('pointermove', event => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    const rect = grid.getBoundingClientRect();
    const position = stacked ? event.clientY - rect.top : event.clientX - rect.left;
    const available = stacked ? grid.clientHeight - divider.offsetHeight : grid.clientWidth - divider.offsetWidth;
    if (available > 0) resize((position - grabOffset) * 100 / available);
  }, {signal});
  divider.addEventListener('lostpointercapture', () => onChange?.({...layout}), {signal});
  divider.addEventListener('keydown', event => {
    const current = Number(divider.getAttribute('aria-valuenow'));
    const keys = {Home:minimum, End:maximum, [stacked ? 'ArrowUp' : 'ArrowLeft']:current - 5,
      [stacked ? 'ArrowDown' : 'ArrowRight']:current + 5};
    if (!(event.key in keys)) return;
    event.preventDefault();
    resize(keys[event.key]);
    onChange?.({...layout});
  }, {signal});
  toggle.addEventListener('click', event => {
    event.stopPropagation();
    show(layout.hidden);
    onChange?.({...layout});
  }, {signal});
  restore(initial);
  const observer = new ResizeObserver(drawDivider);
  observer.observe(grid);
  signal.addEventListener('abort', () => observer.disconnect(), {once:true});
  return {restore, revealForInput:() => show(true)};
}
