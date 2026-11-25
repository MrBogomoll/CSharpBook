'use strict';

let courseSearchQuery = '';
let courseSearchEntries, courseSearchTerms;
const searchPageSize = 20;
let courseSearchLimit = searchPageSize;
const foldSearchText = text => text.normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е');

function courseSearchButton(css='settings-icon') {
  return button('find-course',icon('search'),css,'aria-label="Поиск по учебнику" title="Поиск по учебнику"');
}

function openCourseSearch() {
  if (state.page !== 'home') go('home');
  const input = auxiliary.querySelector('#course-query');
  input.focus({preventScroll:true});
  revealCourseSearch();
}

function revealCourseSearch() {
  const input = document.activeElement;
  if (input?.id !== 'course-query' || primary.hidden) return;
  const field = input.getBoundingClientRect(), pane = primary.getBoundingClientRect();
  if (field.top < pane.top + 4) primary.scrollTop += field.top - pane.top - 4;
  else if (field.bottom > pane.bottom - 4) primary.scrollTop += field.bottom - pane.bottom + 4;
}

function courseSearchForm() {
  return '<section class="course-search" role="search" aria-label="Поиск по учебнику">' +
    '<label for="course-query">Поиск по учебнику</label><div class="course-search-field">' + icon('search') +
    '<input id="course-query" type="search" placeholder="Например, вложенные циклы или Console.ReadLine" autocomplete="off"></div>' +
    '<p role="status"></p><ul></ul><button type="button" class="cs-tool" hidden>Показать ещё</button></section>';
}

function makeSearchEntries() {
  const entries = [];
  function add(route, title, context, parts) {
    const sources = parts.flat(Infinity).filter(text => typeof text === 'string' && text.trim());
    const lines = sources.map(text => text.replace(/\s+/gu, ' ').trim());
    const folded = lines.map(foldSearchText);
    const name = foldSearchText(title);
    entries.push({ route, title, name, context, lines, folded, text:[name, ...folded].join('\n') });
  }
  const blocks = sections => sections.map(({title, text}) => [title, text]);
  for (const [i, chapter] of chapters.entries()) {
    add('chapter/' + i, chapter.title, 'Введение в тему', blocks(chapter.theory));
    for (const lesson of chapter.topics) {
      const guide = lesson.syntaxGuide;
      const labText = (lesson.desktopLabs || []).map(lab => [lab.title, lab.description, lab.commands,
        lab.code, Object.entries(lab.files || {}), lab.steps]);
      const samples = lesson.examples.map(example => [example.name, example.code, Object.entries(example.files || {}), example.steps, example.output]);
      const {question, choices, hint} = lesson.practice;
      add('lesson/' + lesson.id, lesson.title, chapter.title + ' · Глава', [
        lesson.intro, lesson.section, lesson.description, lesson.note, lesson.goal,
        blocks(lesson.theory), blocks(lesson.learn), guide?.parts, guide?.sample, guide?.try, samples, labText,
        Object.values(lesson.mistake), question, choices, hint,
        lesson.id === 'types' ? typeFamilies.map(group => [group.title, group.entries]) : []
      ]);
      for (const task of lesson.exercises)
        add(exercisePath(lesson, task), task.title, lesson.title + ' · Задача', [
          task.instruction, task.kind, task.starter, Object.entries(task.files || {})
        ]);
    }
  }
  return entries;
}

function addSearchTerms(entries, groups) {
  const byRoute = new Map(entries.map(entry => [entry.route, entry]));
  for (const group of groups) {
    for (const [title, id, , description] of group.topics) {
      const entry = byRoute.get('lesson/' + id);
      if (!entry) continue;
      const line = title + ' — ' + description;
      const folded = foldSearchText(line);
      entry.lines.push(line);
      entry.folded.push(folded);
      entry.text += '\n' + folded;
    }
  }
}

function findCourseResults(query, entries) {
  const phrase = foldSearchText(query.trim()).replace(/\s+/gu, ' ');
  if (!phrase) return [];
  const terms = [...new Set(phrase.split(' '))];
  const matches = [];
  for (const entry of entries) {
    if (!terms.every(term => entry.text.includes(term))) continue;
    const titleHits = terms.filter(term => entry.name.includes(term)).length;
    let score = titleHits * 3;
    if (entry.name === phrase) score += 30;
    else if (entry.name.includes(phrase)) score += 12;
    else if (entry.text.includes(phrase)) score++;
    matches.push({entry, score});
  }
  return matches.sort((a, b) => b.score - a.score).map(match => match.entry);
}

function searchSnippet(entry, terms) {
  let bestHits = 0, bestLine = 0;
  for (const [index, text] of entry.folded.entries()) {
    const hits = terms.filter(term => text.includes(term)).length;
    if (hits > bestHits) { bestHits = hits; bestLine = index; }
    if (hits === terms.length) break;
  }
  const text = entry.lines[bestLine] || '';
  const folded = entry.folded[bestLine] || '';
  const offset = Math.min(...terms.map(term => folded.indexOf(term)).filter(at => at >= 0));
  const start = Number.isFinite(offset) ? Math.max(0, offset - 40) : 0;
  return (start ? '…' : '') + text.slice(start, start + 156) + (start + 156 < text.length ? '…' : '');
}

function mountCourseSearch(host) {
  const input = host.querySelector('input'), status = host.querySelector('[role=status]');
  const list = host.querySelector('ul'), more = host.querySelector('button');
  const catalogue = host.parentElement.querySelector('.cs-home-grid');
  let awaitingTerms = false;
  input.value = courseSearchQuery;
  function show() {
    const terms = foldSearchText(input.value.trim()).split(/\s+/u).filter(Boolean);
    catalogue.hidden = Boolean(terms.length);
    list.replaceChildren();
    more.hidden = true;
    status.textContent = '';
    if (!terms.length) return;
    courseSearchEntries ??= makeSearchEntries();
    if (!awaitingTerms) {
      awaitingTerms = true;
      courseSearchTerms ??= loadTopicIndex().then(groups => addSearchTerms(courseSearchEntries, groups))
        .catch(() => { courseSearchTerms = undefined; }); // The course text is already available offline.
      courseSearchTerms.then(() => { if (host.isConnected) show(); });
    }
    const matches = findCourseResults(input.value, courseSearchEntries);
    status.textContent = matches.length ? matches.length + ' ' + words(matches.length, 'результат', 'результата', 'результатов') :
      'Совпадений нет. Попробуй другое слово.';
    for (const entry of matches.slice(0, courseSearchLimit)) {
      const item = document.createElement('li');
      item.innerHTML = '<a href="#' + esc(entry.route) + '"><small>' + esc(entry.context) + '</small><strong>' +
        esc(entry.title) + '</strong><span>' + esc(searchSnippet(entry, terms)) + '</span></a>';
      list.append(item);
    }
    more.hidden = matches.length <= courseSearchLimit;
  }
  more.addEventListener('click', () => { courseSearchLimit += searchPageSize; show(); });
  input.addEventListener('input', () => { courseSearchQuery = input.value; courseSearchLimit = searchPageSize; show(); });
  show();
}
