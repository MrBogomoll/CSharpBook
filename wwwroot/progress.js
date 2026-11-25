'use strict';

const difficultyLabels = {advanced:'Повышенная сложность', expert:'Высокая сложность'};
function progressTopics(scope) {
  if (scope === 'course') return lessons;
  if (scope.startsWith('theme/')) return chapters[Number(scope.slice(6))].topics;
  return [findLesson(scope)];
}
function taskProgress(scope) {
  let solved = 0, total = 0;
  for (const lesson of progressTopics(scope)) {
    total += lesson.exercises.length;
    solved += lesson.exercises.filter(task => exerciseDone(lesson, task)).length;
  }
  return {solved, total, complete:total > 0 && solved === total};
}
function progressLabel({solved, total, complete}) {
  return (complete ? 'Все задачи решены. ' : 'Решено задач: ') + solved + ' из ' + total;
}
function taskCount(scope, progress = taskProgress(scope)) {
  const label = esc(progressLabel(progress));
  return '<span class="task-count" data-task-count="' + esc(scope) + '" title="' + label +
    '" role="img" aria-label="' + label + '">' + progress.solved + '/' + progress.total + '</span>';
}
function themeOrdinal(index, className, progress) {
  return '<span class="' + className + ' theme-number' + (progress.complete ? ' tasks-complete' : '') +
    '" data-theme-ring="theme/' + index + '" aria-hidden="true">' + String(index + 1).padStart(2, '0') + '</span>';
}
function lessonMark(lesson, progress = taskProgress(lesson.id)) {
  const read = state.read.includes(lesson.id);
  const label = progress.complete ? 'Все задачи решены' : read ? 'Глава прочитана' : 'Глава не прочитана';
  const glyph = progress.complete ? 'circle-check' : read ? 'book-open-check' : 'circle';
  return '<span class="lesson-mark' + (progress.complete ? ' tasks-complete' : '') + '" data-lesson-mark="' +
    esc(lesson.id) + '" title="' + label + '" role="img" aria-label="' + label + '">' + icon(glyph) + '</span>';
}
function solvedList(scope) {
  return '<details class="solved-tasks" data-solved-list="' + esc(scope) + '"><summary>' +
    (scope === 'course' ? 'Решённые задачи курса' : scope.startsWith('theme/') ? 'Решённые задачи темы' : 'Решённые задачи главы') +
    ' ' + taskCount(scope) + '</summary><div class="solved-items"></div></details>';
}
function fillSolvedList(details) {
  const scope = details.dataset.solvedList, body = details.querySelector('.solved-items');
  const focused = body.contains(document.activeElement) ? document.activeElement.getAttribute('href') : null;
  const sections = [];
  for (const lesson of progressTopics(scope)) {
    const items = [];
    for (const [i, task] of lesson.exercises.entries()) {
      if (!exerciseDone(lesson, task)) continue;
      const label = difficultyLabels[task.difficulty];
      items.push('<li><a href="#' + esc(exercisePath(lesson, task)) + '"><span>' + (i + 1) +
        '.</span> ' + esc(task.title) + '</a>' + (label ? '<small>' + esc(label) + '</small>' : '') + '</li>');
    }
    if (items.length) sections.push((scope === lesson.id ? '' : '<strong>' + esc(lesson.title) + '</strong>') +
      '<ul>' + items.join('') + '</ul>');
  }
  body.innerHTML = sections.join('') || '<p>Здесь появится первая задача, которая пройдёт проверку.</p>';
  if (focused) body.querySelector('a[href="' + CSS.escape(focused) + '"]')?.focus({preventScroll:true});
}
// Update visible counters and open lists without remounting the editor, a running program or the topic search.
function refreshExerciseProgress() {
  const cache = new Map();
  function progress(scope) {
    if (!cache.has(scope)) cache.set(scope, taskProgress(scope));
    return cache.get(scope);
  }
  for (const count of root.querySelectorAll('[data-task-count]')) {
    const value = progress(count.dataset.taskCount), label = progressLabel(value);
    count.textContent = value.solved + '/' + value.total;
    count.title = label;
    count.setAttribute('aria-label', label);
  }
  for (const ring of root.querySelectorAll('[data-theme-ring]'))
    ring.classList.toggle('tasks-complete', progress(ring.dataset.themeRing).complete);
  for (const mark of root.querySelectorAll('[data-lesson-mark]')) {
    const lesson = findLesson(mark.dataset.lessonMark);
    mark.outerHTML = lessonMark(lesson, progress(lesson.id));
  }
  for (const details of root.querySelectorAll('.solved-tasks[open]')) fillSolvedList(details);
  refreshStepMarks();
  glyphs();
}
