'use strict';
const root = document.getElementById('app');
const store = new BookStore();
let chapters = [], lessons = [];
const state = {page:'home',lesson:'',example:0,read:[],saved:[],expanded:[0],started:false};
let feedback='', menuOpen=false, hideExampleOutput=false, selectedFile='Program.cs';
let consoleCleanup=null, renderGeneration=0, exercise=null;
let scrollTimer=null;
let positionSavedForRoute=false;
if ('scrollRestoration' in history) history.scrollRestoration='manual';
function keepReadingPosition() {
  clearTimeout(scrollTimer);
  if (state.page==='lesson') store.set('position/'+state.lesson,Math.round(window.scrollY));
}
window.addEventListener('scroll',()=>{
  if(state.page==='lesson'){clearTimeout(scrollTimer);scrollTimer=setTimeout(keepReadingPosition,400);}
},{passive:true});
window.addEventListener('pagehide',keepReadingPosition);
const findLesson = id => lessons.find(lesson=>lesson.id===id);
const chapterIndex = id => chapters.findIndex(chapter=>chapter.topics.some(topic=>topic.id===id));
const esc = value => String(value??'').replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icon = name => '<i data-lucide="'+esc(name)+'" aria-hidden="true"></i>';
const button = (action,label,css='',attrs='') => '<button type="button" data-action="'+esc(action)+'" class="'+esc(css)+'" '+attrs+'>'+label+'</button>';
const flip = (list,item) => list.includes(item)?list.filter(x=>x!==item):[...list,item];
const glyphs = () => window.lucide?.createIcons({attrs:{width:16,height:16}});
const copyable = code => '<div class="copyable"><div class="copy-line">'+button('copy-block',icon('copy')+'Копировать','copy-small')+'</div><pre class="cs-snippet">'+esc(code)+'</pre></div>';
function projectLink(lesson) {
  const tour=lesson.id==='split-project'?'<section class="project-tour"></section>':'';
  return tour+(lesson.projectUrl ? '<a class="project-download" download href="'+esc(lesson.projectUrl)+'">'+icon('download')+'Скачать учебный проект</a>' : '');
}
function fileTabs(example) {
  const names = Object.keys(example.files||{}).filter(x=>x!=='Program.cs');
  return names.length ? '<div class="file-tabs" aria-label="Файлы примера">'+['Program.cs',...names].map((name,i)=>button('file:'+i,esc(name),'file-tab'+(name===selectedFile?' current':''),'aria-pressed="'+(name===selectedFile)+'"')).join('')+'</div>' : '';
}
function exampleInput(example) {
  if(!example.stdin?.length) return '';
  const values=example.stdin.map(value=>'<kbd>'+esc(value || 'пустая строка')+'</kbd>').join(' → ');
  return '<p class="sample-input">При запуске введи '+values+' и нажми Enter после каждой строки.</p>';
}
function applyTheme() {
  document.documentElement.style.colorScheme = ({light:'light',dark:'dark'})[store.get('theme','auto')] || 'light dark';
}
function syncMarks() {
  state.saved=lessons.filter(t=>store.get('saved/'+t.id,false)).map(t=>t.id);
  state.read=lessons.filter(t=>store.get('read/'+t.id,false)).map(t=>t.id);
}
function settingsView() {
  const theme=store.get('theme','auto');
  return '<main class="settings-view"><h1>Настройки</h1><p>Учебник C# · Версия 0.1.0</p><fieldset><legend>Оформление учебника</legend>'+
    [['auto','Как в системе'],['light','Светлая тема'],['dark','Тёмная тема']].map(([key,label])=>'<label><input type="radio" name="theme" value="'+key+'" '+(theme===key?'checked':'')+'> '+label+'</label>').join('')+
    '</fieldset><h2>Мой прогресс</h2><p>Прочитано '+state.read.length+' из '+lessons.length+' тем. Закладки, место остановки и черновики сохраняются в этом браузере.</p>'+
    (store.warning?'<p role="alert">'+esc(store.warning)+'</p>':'')+
    button('exit',icon('log-out')+'Выйти из приложения','cs-tool')+'</main>';
}
function exercisePanel(lesson,source) {
  const task=lesson.task;
  const extraFiles=Object.entries(task.files||{});
  return '<section class="cp-widget" data-exercise="'+esc(lesson.id)+'"><h3>Напиши сам</h3><p>'+formatText(task.instruction)+'</p>'+
    (task.stdin?.length?'<p>Для проверки введи по очереди '+task.stdin.map(x=>'<code>'+esc(x)+'</code>').join(', ')+'.</p>':'')+
    (extraFiles.length?'<details><summary>Файлы, которые уже есть в задании</summary><p>Напиши свою часть в Program.cs. Эти файлы будут скомпилированы вместе с ней.</p>'+extraFiles.map(([name,code])=>'<strong>'+esc(name)+'</strong>'+copyable(code)).join('')+'</details>':'')+
    '<label class="cs-draft-label">Твой код<textarea class="cs-draft" rows="5" placeholder="Введи здесь свой код на C#" spellcheck="false" autocorrect="off" autocapitalize="off" aria-keyshortcuts="Control+Enter Meta+Enter">'+esc(source)+'</textarea></label>'+
    '<div class="cp-runbar">'+button('run-draft',icon('play')+'Запустить код','cp-run')+
    button('stop-draft',icon('square')+'Остановить','cs-tool','hidden')+'</div><div class="cp-console"><strong>Результат запуска</strong>'+
    '<div class="cp-response" role="status"><p class="cp-status">Здесь появится вывод твоей программы.</p></div><form class="cp-input" hidden><input aria-label="Ввод для программы" autocomplete="off" placeholder="Введи строку для программы"><button type="submit">Отправить</button></form></div>'+
    '<details><summary>Сверить ожидаемый вывод</summary>'+copyable(task.output)+'</details><details><summary>Посмотреть решение</summary>'+copyable(task.solution)+'</details></section>';
}
function exercisePaint() {
  if (!exercise || exercise.topic!==state.lesson) return;
  const output=root.querySelector('.cp-response');
  if (!output) return;
  output.innerHTML=(exercise.output?'<pre class="cp-output">'+esc(exercise.output)+'</pre>':'')+'<p class="cp-status'+(exercise.error?' cp-problem':'')+'">'+esc(exercise.status)+'</p>';
  root.querySelector('[data-action="run-draft"]').disabled=exercise.running;
  root.querySelector('[data-action="stop-draft"]').hidden=!exercise.running;
  root.querySelector('.cp-input').hidden=!exercise.awaiting;
}
function stopExercise() {
  const previous=exercise;
  exercise=null;
  previous?.handle?.stop();
}
async function runExercise() {
  if (exercise?.running) return;
  const lesson=findLesson(state.lesson), source=root.querySelector('.cs-draft').value;
  const run=exercise={topic:lesson.id,running:!!source.trim(),source,output:'',status:source.trim()?'Подготовка компилятора…':'Сначала введи команду в поле «Твой код».',error:false,awaiting:false};
  exercisePaint();
  if (!run.running) return;
  try {
    const {startRun}=await import('./runner.js');
    if (exercise!==run || !run.running) return;
    const handle=await startRun({source,version:lesson.task.version||lesson.version||10,files:lesson.task.files||{},onEvent(e) {
      if (exercise!==run||!run.running) return;
      if (e.type==='output') { run.output+=e.text||''; run.status='Программа выполняется…'; }
      if (e.type==='ready') run.status='Программа выполняется…';
      if (e.type==='input') {run.awaiting=true; run.status='Программа ждёт ввода.';}
      if (e.type==='warning') run.output+=(e.text||'')+'\n';
      if (e.type==='error') {run.error=true;run.status=[e.file,e.line?'строка '+e.line:'',e.code,e.text].filter(Boolean).join(' · ');}
      if (e.type==='done') {
        run.running=false;run.awaiting=false;
        if (!run.error) {
          const norm=s=>s.replace(/\r\n/g,'\n').replace(/\n$/,'');
          run.status=norm(run.output)===norm(lesson.task.output)?'Вывод совпал с ожидаемым.':run.output?'Выполнено. Сверь результат с ожидаемым выводом.':'Программа завершилась без вывода.';
        }
      }
      exercisePaint();
      if (e.type==='input') root.querySelector('.cp-input input')?.focus({preventScroll:true});
    }});
    if (exercise!==run || (!run.running && !run.error)) handle?.stop(); else run.handle=handle;
  } catch (e) { if (exercise===run) {run.running=false;run.error=true;run.status='Не удалось запустить код. '+e.message;exercisePaint();} }
}
function defaultEditor(lesson) {
  const example=lesson.examples[state.example];
  return {source:example.code,files:example.files||{},version:example.version||lesson.version||10,topicId:lesson.id,topicTitle:lesson.title,exampleTitle:example.name};
}
function useExample(restoreDraft=false) {
  const lesson=findLesson(state.lesson), seed=defaultEditor(lesson), key='editor/'+lesson.id+'/'+state.example;
  const draft=restoreDraft?store.get(key,null):null;
  store.set('console',{...seed,...draft,key});
  go('console');
}
function route() {
  if(!positionSavedForRoute) keepReadingPosition();
  positionSavedForRoute=false;
  const [page,arg]=location.hash.slice(1).split('/');
  const validLesson=page==='lesson' && findLesson(arg);
  const destination=validLesson?'lesson':['console','settings','saved','exit'].includes(page)?page:'home';
  if (destination==='lesson') {
    if (state.lesson!==arg) {state.example=0;selectedFile='Program.cs';}
    state.lesson=arg; state.started=true; store.set('last',arg);
    state.example=Math.min(findLesson(arg).examples.length-1,store.get('example/'+arg,0));
  }
  if (destination==='lesson' || destination==='home') {
    const index=chapterIndex(state.lesson);
    if (!state.expanded.includes(index)) state.expanded.push(index);
  }
  state.page=destination; feedback='';menuOpen=false;hideExampleOutput=false;
  const position=destination==='lesson'?store.get('position/'+state.lesson,0):0;
  stopExercise(); render(position);
  window.scrollTo(0,position);
}
function go(page,id) {
  keepReadingPosition();
  positionSavedForRoute=true;
  const hash='#'+page+(id?'/'+encodeURIComponent(id):'');
  if (location.hash===hash) {route();return;}
  location.hash=hash;
}
function render(restorePosition=null) {
  consoleCleanup?.();consoleCleanup=null;
  const generation=++renderGeneration;
  const lesson=findLesson(state.lesson);
  document.title=({home:'C# с нуля',lesson:lesson.title,saved:'Закладки',console:'Консоль',settings:'Настройки',exit:'До встречи'})[state.page]+' · Учебник C#';
  if(state.page==='exit') {
    root.innerHTML='<main class="settings-view"><h1>До встречи!</h1><p>'+esc(store.warning||'Прогресс сохранён. Можно закрыть приложение.')+'</p>'+button('go:home',icon('book-open')+'Вернуться в учебник','cs-tool')+'</main>';
    glyphs();return;
  }
  const header='<header class="cs-top">'+button('go:home','<span class="cs-logo" aria-hidden="true">C#</span>Учебник C#','cs-brand','aria-label="На главную"')+nav('cs-global')+
    '<div class="header-tools">'+(state.page==='lesson'?button('menu',icon(menuOpen?'x':'menu')+'Главы','cs-mobile-menu','aria-expanded="'+menuOpen+'"'):'')+
    button('go:settings',icon('settings'),'settings-icon'+(state.page==='settings'?' on':''),'aria-label="Настройки" title="Настройки"')+'</div></header>';
  let body='';
  if (state.page==='home') body='<main class="cs-home">'+homeView(lesson)+'</main>';
  if (state.page==='saved') body='<main class="cs-home">'+bookmarkedPage(lesson)+'</main>';
  if (state.page==='settings') body=settingsView();
  if (state.page==='console') body='<main class="cs-console-page" id="editor-host" aria-label="Учебная консоль"></main>';
  if (state.page==='lesson') {
    const side='<aside aria-label="Содержание" class="cs-side'+(menuOpen?' open':'')+'"><div class="cs-side-title">Содержание</div><div class="cs-sections">'+contents()+'</div><div class="cs-progress">Прочитано <strong>'+state.read.length+' из '+lessons.length+' тем</strong><div class="cs-progress-track"><i style="width:'+100*state.read.length/lessons.length+'%"></i></div></div></aside>';
    body='<div class="cs-grid">'+side+'<main class="cs-content">'+lessonView(lesson)+'</main></div>';
  }
  root.innerHTML=header+body+nav('cs-mobile-nav');
  glyphs();exercisePaint();
  const tour=root.querySelector('.project-tour');
  if(tour) import('./project.js').then(async m=>{
    if(!tour.isConnected)return;
    const before=window.scrollY;
    await m.showProject(tour,{esc,icon,copyable,glyphs});
    if(tour.isConnected && restorePosition!==null && Math.abs(window.scrollY-before)<3) window.scrollTo(0,restorePosition);
  });
  if (state.page==='console') {
    const host=root.querySelector('#editor-host');
    const entry=store.get('console',defaultEditor(lesson));
    import('./console.js').then(({mountConsole})=>{
      if (generation!==renderGeneration) return;
      consoleCleanup=mountConsole(host,{...entry,showHeader:false,onBack:()=>go('lesson',entry.topicId),onChange:(source,files)=>{
        const draft={source,files};store.set('console',{...entry,...draft});if(entry.key)store.set(entry.key,draft);
      }});
      glyphs();
    }).catch(e=>{if (generation===renderGeneration) host.textContent='Не удалось открыть редактор. '+e.message;});
  }
}
async function copyText(text,trigger) {
  let ok=false;
  try {await navigator.clipboard.writeText(text); ok=true;} catch {
    const input=document.createElement('textarea');input.style.cssText='position:fixed;opacity:0';input.value=text;trigger.after(input);input.select();
    try {ok=document.execCommand('copy');} finally {input.remove();trigger.focus({preventScroll:true});}
  }
  trigger.setAttribute('aria-live','polite');trigger.textContent=ok?'Скопировано':'Выдели и скопируй текст';
}
root.addEventListener('click',e=>{
  const trigger=e.target.closest('[data-action]');
  if(!trigger || trigger.closest('#editor-host')) return;
  const [action,arg]=trigger.dataset.action.split(':');
  const lesson=findLesson(state.lesson), example=lesson.examples[state.example];
  if(action==='lesson') return go('lesson',arg);
  if(action==='go') return go(arg);
  if(action==='back') return go('lesson',state.lesson);
  if(action==='open-example') return useExample();
  if(action==='open-editor-draft') return useExample(true);
  if(action==='run-draft') return runExercise();
  if(action==='stop-draft') {if(exercise){exercise.running=false;exercise.awaiting=false;exercise.status='Запуск остановлен.';exercise.handle?.stop();exercisePaint();}return;}
  if(action==='copy') return copyText(selectedFile==='Program.cs'?example.code:example.files[selectedFile],trigger);
  if(action==='copy-block') return copyText(trigger.closest('.copyable').querySelector('pre').textContent,trigger);
  if(action==='exit') {
    keepReadingPosition();
    stopExercise();
    history.replaceState(null,'','#exit');route();
    window.chrome?.webview?.postMessage('close');
    return;
  }
  if(action==='menu') menuOpen=!menuOpen;
  if(action==='expand') {state.expanded=flip(state.expanded,Number(arg));store.set('expanded',state.expanded);}
  if(action==='example') { state.example=Number(arg);selectedFile='Program.cs';store.set('example/'+lesson.id,state.example); }
  if(action==='file') selectedFile=['Program.cs',...Object.keys(example.files||{}).filter(x=>x!=='Program.cs')][Number(arg)]||'Program.cs';
  if(action==='toggle-output') hideExampleOutput=!hideExampleOutput;
  if(action==='answer') store.set('answer/'+lesson.id,Number(arg));
  if(action==='save'||action==='read'||action==='unsave') {
    const key=action==='read'?'read/':'saved/', id=arg||lesson.id;
    const marked=action==='unsave'?false:!store.get(key+id,false);
    store.set(key+id,marked);syncMarks();
    feedback=action==='read'?(marked?'Тема отмечена как прочитанная.':'Отметка снята.'):(marked?'Тема сохранена в закладки.':'Закладка снята.');
  }
  const opened=[...root.querySelectorAll('details')].map(d=>d.open);
  render();
  root.querySelectorAll('details').forEach((d,i)=>{d.open=Boolean(opened[i]);});
  if(e.detail===0) [...root.querySelectorAll('[data-action]')].find(x=>x.dataset.action===trigger.dataset.action&&x.offsetWidth)?.focus({preventScroll:true});
});
root.addEventListener('change',e=>{if(e.target.name==='theme'){store.set('theme',e.target.value);applyTheme();}});
root.addEventListener('input',e=>{if(e.target.matches('.cs-draft')){
  store.set('draft/'+state.lesson,e.target.value);
  if(exercise && !exercise.running && exercise.source!==e.target.value){exercise.status='Код изменён. Запусти его ещё раз.';exercisePaint();}
}});
root.addEventListener('keydown',e=>{if(e.target.matches('.cs-draft')&&(e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();runExercise();}});
root.addEventListener('submit',e=>{
  if(!e.target.matches('.cp-input'))return;
  e.preventDefault();if(!exercise?.awaiting)return;
  const input=e.target.querySelector('input');exercise.awaiting=false;exercise.status='Программа выполняется…';exercise.handle?.sendInput(input.value);input.value='';exercisePaint();
});
window.addEventListener('book-storage',e=>{if(e.detail==='theme')applyTheme();if(/^(read|saved)\//.test(e.detail)){syncMarks();if(['home','saved'].includes(state.page))render();}});
async function boot() {
  const response=await fetch('./course.json');
  if(!response.ok)throw Error('Не удалось загрузить главы.');
  chapters=await response.json();lessons=chapters.flatMap(c=>c.topics);
  await store.open();applyTheme();syncMarks();
  const last=store.get('last','');
  state.started=!!findLesson(last);state.lesson=state.started?last:lessons[0].id;
  state.expanded=store.get('expanded',[chapterIndex(state.lesson)]).slice();
  if(location.hash==='#exit')history.replaceState(null,'','#home');
  window.addEventListener('hashchange',route);route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
boot().catch(e=>{root.innerHTML='<main class="loading" role="alert"><h1>Учебник не открылся</h1><p>'+esc(e.message)+'</p><button onclick="location.reload()">Попробовать снова</button></main>';});



