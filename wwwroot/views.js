function nav(where) {
  const links=[['home','book-open','Оглавление'],['reader','book-marked','К уроку'],['console','square-terminal','Консоль'],['saved','bookmark','Закладки']];
  return '<nav class="'+where+'" aria-label="Разделы приложения">' + links.map(([id,glyph,label])=>{
    const active=id===state.page || (id==='reader' && ['lesson','chapter'].includes(state.page));
    return button(id==='reader'?'back':'go:'+id,icon(glyph)+'<span>'+label+'</span>','cs-nav-item'+(active?' active':''),active?'aria-current="page"':'');
  }).join('')+'</nav>';
}
function contents(asList=false) {
  return chapters.map((chapter,i)=>{
    const open = state.expanded.includes(i);
    const number = '<span class="cs-ordinal">'+String(i+1).padStart(2,'0')+'</span>';
    const heading = button('expand:'+i,number+esc(chapter.title)+icon(open?'chevron-down':'chevron-right'),'cs-chapter','aria-expanded="'+open+'"');
    const inner = open ? '<div class="cs-topics">'+chapterIntroLink(i,false)+chapter.topics.map(topic=>{
      const current=lastReading.split('/')[0]==='lesson' && lastReading.split('/')[1]===topic.id;
      return button('lesson:'+topic.id,icon(state.read.includes(topic.id)?'circle-check':(current?'circle-dot':'circle'))+esc(topic.title),asList?'cs-list-link':'cs-topic'+(current?' selected':''),current?'aria-current="page"':'');
    }).join('')+'</div>' : '';
    return '<div>'+heading+inner+'</div>';
  }).join('');
}
const keywords = new Set('abstract as async await base bool break byte case catch char checked class closed const continue decimal default delegate do double else enum event explicit extension false field finally float for foreach from get global group if implicit in init int interface internal into is join let lock long namespace new not null object operator orderby out override params partial private protected public readonly record ref required return sealed select set short static string struct switch this throw true try typeof uint ulong union unmanaged ushort using var virtual void when where while with yield'.split(' '));
function syntax(source) {
  const tokens = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|(?:\$?@|@\$)"(?:""|[^"])*"|\$?"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\b\d[\d_.]*[dDfFmMuUlL]*\b|[\p{L}_][\p{L}\p{N}_]*/gu;
  let result='',start=0;
  for (const match of source.matchAll(tokens)) {
    const word=match[0],offset=match.index;
    result+=esc(source.slice(start,offset));
    const type=word.startsWith('/')?'comment':/^[\x22'$@]/.test(word)?'str':/^\d/.test(word)?'num':
      keywords.has(word)?'key':/^\s*\(/.test(source.slice(offset+word.length))?'fn':/^\p{Lu}/u.test(word)?'type':'';
    result+=type?'<span class="cs-s-'+type+'">'+esc(word)+'</span>':esc(word);
    start=offset+word.length;
  }
  return result+esc(source.slice(start));
}
function diagram() {
  const sample = state.example === 1 ? ['tickets','20'] : ['score','10'];
  return '<div class="cs-diagram" aria-label="Объявление переменной"><span><b>int</b><small>тип</small></span><span><b>'+sample[0]+'</b><small>имя</small></span><b>=</b><span><b>'+sample[1]+'</b><small>значение</small></span></div>';
}
function banner(kicker,title,lead,annotate=false) {
  return '<header class="cs-hero"'+(annotate?'':' style="grid-template-columns:1fr"')+'><div><div class="cs-kicker">'+esc(kicker)+'</div><h1>'+esc(title)+'</h1><p class="cs-lead">'+formatText(lead)+'</p></div>'+(annotate?diagram():'')+'</header>';
}
function tabs(lesson) {
  return '<div class="cs-examples" role="group" aria-label="Варианты примера">'+lesson.examples.map((example,i)=>button('example:'+i,esc(example.name),'cs-tab'+(i===state.example?' current':''),'aria-pressed="'+(i===state.example)+'"')).join('')+'</div>';
}
function editor(lesson) {
  const example=lesson.examples[state.example];
  const activeCode=selectedFile==='Program.cs'?example.code:(example.files?.[selectedFile]??example.code);
  const numbers=activeCode.split('\n').map((_,i)=>i+1).join('\n');
  const output = !hideExampleOutput;
  const major=example.version || lesson.version || 10;
  const changed=store.get('editor/'+lesson.id+'/'+state.example,null);
  const hasDraft=changed && (changed.source!==example.code || JSON.stringify(changed.files)!==JSON.stringify(example.files||{}));
  const action = (hasDraft?button('open-editor-draft',icon('pencil')+'Мой черновик','cs-code-action'):'')+button('open-example',icon('square-terminal')+'В консоль','cs-code-action')+button('open-beside',icon('columns-2')+'Открыть рядом','cs-code-action');
  const toggle = button('toggle-output',icon(output?'eye-off':'eye')+(output?'Вывод':'Показать вывод'),'cs-code-action','aria-expanded="'+output+'"');
  return '<section class="cs-editor" aria-label="Пример кода C#"><div class="cs-editor-top"><div class="cs-filename"><i>C#</i>'+esc(selectedFile)+'<small class="version-label">.NET '+major+'</small></div>'+button('copy',icon('copy')+'Копировать','cs-code-action')+'</div>'+fileTabs(example)+'<div class="cs-code-area"><pre class="cs-lines" aria-hidden="true">'+numbers+'</pre><pre><code>'+syntax(activeCode)+'</code></pre></div><div class="cs-editor-foot"><div class="cs-print">'+toggle+'<code class="cs-output" aria-live="polite">'+(output?esc(example.output):'—')+'</code></div>'+action+'</div></section>';
}
const topicLabels = {
  'what-is-code':'Как компьютер выполняет команды','first-program':'Пишем первую команду и получаем ответ',
  'console':'Выводим текст и числа на экран','first-error':'Находим ошибку по сообщению компилятора',
  variables:'Сохраняем и меняем значения',types:'Выбираем тип для числа, текста и ответа да или нет',
  arithmetic:'Рассчитываем цену и делим с остатком',comparisons:'Проверяем значения', 'if-else':'Выбираем действие по условию'
};
function summaryOf(topic) {
  const text=topicLabels[topic.id] || topic.goal || topic.intro;
  const lead=text.split(/(?<=[.!?])\s+/u)[0];
  return lead.length>120?lead.slice(0,118).replace(/\s+\S*$/u,'')+'…':lead;
}
const words = (count,one,few,many) => count%10===1 && count%100!==11 ? one : count%10>=2 && count%10<=4 && !(count%100>=12 && count%100<=14) ? few : many;
const formatText = s => esc(s).replace(/\x60([^\x60]+)\x60/g,'<code>$1</code>');
function homeView(lesson){
  const intro=readingChapter();
  const resumeTask=lesson.exercises.find(t=>t.id===lastReading.split('/')[2]);
  const resume='<aside class="cs-progress-column" aria-label="Продолжение обучения"><div class="cs-resume"><span class="cs-kicker">'+icon('book-open')+(intro?'Введение в тему':resumeTask?'Текущее упражнение':'Текущая глава')+'</span><h2>'+esc(intro?.title||resumeTask?.title||lesson.title)+'</h2><p>'+esc(intro?'Сначала разберём основные понятия темы.':resumeTask?lesson.title:summaryOf(lesson))+'</p>'+(intro||resumeTask?'':'<code class="cs-resume-code">'+syntax(lesson.examples[state.example].code.split('\n')[0])+'</code>')+button('back',(state.started?'Продолжить':'Начать обучение')+icon('arrow-right'),'cs-continue')+'</div><div class="cs-resume-progress"><div><span>Прочитано глав</span><strong>'+state.read.length+' из '+lessons.length+'</strong></div><div class="cs-progress-track"><i style="width:'+100*state.read.length/lessons.length+'%"></i></div></div></aside>';
  const rows=chapters.map((chapter,i)=>{
    const open=state.expanded.includes(i), total=chapter.topics.length;
    const head=button('expand:'+i,'<span class="cs-ch-num">'+String(i+1).padStart(2,'0')+'</span><span>'+esc(chapter.title)+'</span><span class="cs-ch-count">'+total+' '+words(total,'глава','главы','глав')+'</span>'+icon(open?'chevron-up':'chevron-down'),'cs-chapter-row','aria-expanded="'+open+'"');
    const topics=open?chapterIntroLink(i,true)+chapter.topics.map(topic=>{
      const current=Boolean(state.started)&&!readingChapter()&&topic.id===state.lesson, read=state.read.includes(topic.id);
      const saved=state.saved.includes(topic.id);
      const marks='<span class="bm-marks">'+(current?'<span class="bm-here">'+icon('map-pin')+'Вы здесь</span>':'')+(read?'<span class="bm-read">'+icon('circle-check')+'Прочитано</span>':'')+(saved?'<span class="bm-book" aria-label="В закладках">'+icon('bookmark')+'</span>':'')+'</span>';
      return button('lesson:'+topic.id,'<span class="bm-topic-text"><span class="cs-topic-name">'+esc(topic.title)+'</span><span class="cs-topic-desc">'+esc(summaryOf(topic))+'</span><small class="chapter-task-count">'+topic.exercises.length+' '+words(topic.exercises.length,'упражнение','упражнения','упражнений')+'</small></span>'+marks+icon('chevron-right'),'cs-course-topic bm-topic'+(current?' here':''),'aria-label="'+esc([topic.title,current?'Вы здесь':'',read?'Прочитано':'Ещё не прочитано',saved?'В закладках':''].filter(Boolean).join('. '))+'"');
    }).join(''):'';
    return '<div class="cs-chapter-card">'+head+topics+'</div>';
  }).join('');
  return '<div class="cs-home-intro"><h1><span>C#</span> с нуля</h1><p>Начни с первой программы, затем научись хранить данные и выбирать, что программа сделает дальше.</p></div><div class="cs-home-grid">'+resume+'<section class="cs-toc"><div class="cs-heading-row"><h2>Содержание</h2><small>'+chapters.length+' '+words(chapters.length,'тема','темы','тем')+' · '+lessons.length+' '+words(lessons.length,'глава','главы','глав')+'</small></div>'+rows+'</section></div>';
}
function teach(lesson) {
  const steps=lesson.examples[state.example].steps, q=lesson.practice, a=store.get('answer/'+lesson.id,null);
  const answered=Number.isInteger(a);
  const feedback=answered?(a===q.correct?'Верно. '+q.explanation:'Попробуй ещё раз. '+q.hint):'';
  const snippet=copyable;
  const runHelp=lesson.id==='first-program'?'<details><summary class="cursor-interaction">Как запустить свой код на ПК</summary><p>Установи .NET SDK 10 или 11. Создай пустую папку и открой в ней терминал — окно для ввода команд. Введи <code>dotnet new console</code>. В папке появится файл <code>Program.cs</code>.</p><p>Открой его в текстовом редакторе, замени содержимое своим кодом и сохрани. Вернись в терминал и введи <code>dotnet run</code>. В этом же окне появится результат.</p><a class="cs-source" href="https://learn.microsoft.com/ru-ru/dotnet/core/tools/" target="_blank" rel="noopener noreferrer">Команды .NET в Microsoft Learn</a></details>':'';
  return '<section class="cs-reading"><h3>Разбор по строкам</h3><ol class="cs-walk">'+steps.map(step=>'<li>'+formatText(step)+'</li>').join('')+'</ol>'+
    lesson.learn.map(block=>'<h3>'+esc(block.title)+'</h3><p>'+formatText(block.text)+'</p>').join('')+runHelp+
    '<details><summary class="cursor-interaction">Частая ошибка</summary><p>Запись с ошибкой</p>'+snippet(lesson.mistake.wrong)+'<p>'+formatText(lesson.mistake.why)+'</p><p>Исправление</p>'+snippet(lesson.mistake.fix)+'</details>'+
    '<h3>Проверь себя</h3><p>'+formatText(q.question)+'</p><div class="cs-answers" role="group" aria-label="Варианты ответа">'+q.choices.map((choice,i)=>button('answer:'+i,esc(choice),'cs-tool'+(i===a?' on':''),'aria-pressed="'+(i===a)+'"')).join('')+'</div><p class="cs-feedback" aria-live="polite">'+formatText(feedback)+'</p>'+
    '<details><summary class="cursor-interaction">Подсказка</summary><p>'+formatText(q.hint)+'</p></details>'+
    '<a class="cs-source" href="'+esc(lesson.source.url)+'" target="_blank" rel="noopener noreferrer">'+(lesson.source.url.includes('learn.microsoft.com')?'Microsoft Learn':'Visual Studio Code')+' · '+esc(lesson.source.label.replace(/^Microsoft Learn · /,''))+'</a></section>';
}
function lessonView(lesson) {
  const i=chapterIndex(lesson.id), read=state.read.includes(lesson.id), saved=state.saved.includes(lesson.id);

  const controls='<div class="bm-lesson-controls">'+button('save',icon(saved?'bookmark-check':'bookmark-plus')+(saved?'В закладках':'В закладки'),'cs-tool'+(saved?' on':''),'aria-pressed="'+saved+'"')+'</div>';
  const readButton=button('read',icon(read?'circle-check':'circle')+(read?'Прочитано':'Отметить прочитанным'),'cs-tool'+(read?' on':''),'aria-pressed="'+read+'"');
  const links='<div class="bm-links"><span role="status" aria-live="polite">'+esc(feedback)+'</span>'+button('go:saved','Открыть закладки'+icon('arrow-right'),'cs-flat cs-next')+button('go:home','К оглавлению'+icon('chevron-right'),'cs-flat')+'</div>';
  return banner('Тема '+(i+1)+' · '+chapters[i].title+' · Глава '+(chapters[i].topics.indexOf(lesson)+1),lesson.title,lesson.intro,lesson.id==='variables')+controls+links+
    '<div class="cs-body">'+theoryView(lesson.theory)+'<h2>'+esc(lesson.section)+'</h2><p class="cs-description">'+formatText(lesson.description)+'</p>'+
    tabs(lesson)+exampleInput(lesson.examples[state.example])+editor(lesson)+(lesson.note?'<p class="lesson-note">'+formatText(lesson.note)+'</p>':'')+teach(lesson)+projectLink(lesson)+
    '<div class="cs-actions">'+button('go:home',icon('book-open')+'К оглавлению','cs-tool')+readButton+button('step:'+lesson.exercises[0].id,'К упражнениям'+icon('arrow-right'),'cs-flat cs-next')+'</div></div>';
}
function bookmarkedPage(lesson) {
  function savedRow(topic) {
    const read = state.read.includes(topic.id);
    const status = read ? 'Прочитано' : 'Не прочитано';
    const title = esc(topic.title);
    const text = '<span class="cs-bm-topic-text"><strong>' + title + '</strong>' +
      '<span class="cs-bm-topic-desc">' + esc(summaryOf(topic)) + '</span></span>';
    const marker = '<span class="cs-bm-status' + (read ? ' is-read' : '') + '">' +
      icon(read ? 'circle-check' : 'circle') + status + '</span>';
    const open = button('lesson:' + topic.id, text + marker + icon('chevron-right'),
      'cs-bm-open', 'aria-label="Открыть главу «' + title + '». ' + status + '"');
    const removeLabel = 'Убрать «' + title + '» из закладок';
    const remove = button('unsave:' + topic.id, icon('bookmark-minus'), 'cs-bm-remove',
      'aria-label="' + removeLabel + '" title="' + removeLabel + '"');
    return '<li class="cs-bm-row">' + open + remove + '</li>';
  }

  const groups = chapters.map((chapter, index) => {
    const topics = chapter.topics.filter(topic => state.saved.includes(topic.id));
    if (!topics.length) return '';
    return '<section class="cs-bm-chapter"><h2><span>Тема ' + (index + 1) + '</span>' +
      esc(chapter.title) + '</h2><ul>' + topics.map(savedRow).join('') + '</ul></section>';
  }).join('');
  const count = state.saved.length;
  const countLabel = count + ' ' + words(count, 'сохранённая глава', 'сохранённые главы', 'сохранённых глав');
  const contents = button('go:home', icon('list') + 'Оглавление', 'cs-bm-contents');
  const empty = '<section class="cs-bm-empty"><div class="cs-bm-empty-icon">' + icon('bookmark') +
    '</div><h2>Пока нет закладок</h2><p>Открой главу и нажми «В закладки», чтобы сохранить её здесь.</p>' +
    contents + '</section>';
  const resume = '<aside class="cs-bm-resume" aria-label="Место остановки"><div class="cs-kicker">' +
    icon('book-open') + 'Место остановки</div><h2>' + esc(readingChapter()?.title||lesson.title) + '</h2><p>' +
    esc(readingChapter()?'Введение в тему':summaryOf(lesson)) + '</p>' + button('back', 'Продолжить' + icon('arrow-right'), 'cs-bm-continue') + '</aside>';

  return '<header class="cs-bm-header"><div><h1>Закладки</h1><p>' + countLabel + '</p></div>' +
    (count ? contents : '') + '</header><div class="cs-bm-layout"><div class="cs-bm-list">' +
    (groups || empty) + notesList() + '</div>' + (state.started?resume:'') + '</div>';
}



function chapterIntroLink(index,large) {
  return button('chapter:'+index,icon('book-open')+'Введение в тему',large?'chapter-intro-link':'cs-topic');
}
function theoryView(blocks) {
  return '<section class="chapter-theory">'+(blocks||[]).map((block,i)=>
    '<h2>'+esc(block.title)+'</h2><p data-note-anchor="theory-'+i+'">'+formatText(block.text)+'</p>').join('')+'</section>';
}
function chapterView(index) {
  const chapter=chapters[index], first=chapter.topics[0];
  return banner('Тема '+(index+1)+' · Введение',chapter.title,'')+theoryView(chapter.theory)+
    '<section class="chapter-sequence"><h2>Главы темы</h2>'+chapter.topics.map(topic=>
      button('lesson:'+topic.id,icon(state.read.includes(topic.id)?'circle-check':'circle')+esc(topic.title),'cs-list-link')).join('')+
    '</section><div class="cs-actions">'+button('go:home','К оглавлению','cs-tool')+button('lesson:'+first.id,'Перейти к первой главе'+icon('arrow-right'),'cs-next')+'</div>';
}
