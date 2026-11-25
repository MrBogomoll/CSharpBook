'use strict';

const exerciseRuns=new Map();
function exercisePath(lesson,task) { return 'lesson/'+lesson.id+'/'+task.id; }
function exerciseDone(lesson,task) { return store.get('solved/'+exercisePath(lesson,task),false); }
// First-edition drafts already live under draft/<lesson id>.
function draftKey(lesson,task,file='Program.cs') {
  if(task.id==='original'&&file==='Program.cs')return 'draft/'+lesson.id;
  return 'draft/'+lesson.id+'/'+task.id+'/'+file;
}
function exerciseFiles(lesson,task) {
  const files={'Program.cs':task.starter||'',...task.files};
  for(const name of Object.keys(files)) files[name]=store.get(draftKey(lesson,task,name),files[name]);
  return files;
}
function stepStrip(lesson,selected) {
  const theory=button('lesson:'+lesson.id,icon('book-open')+'Теория','study-step theory-step',selected?'':'aria-current="step"');
  const steps=lesson.exercises.map((task,i)=>{
    const done=exerciseDone(lesson,task), active=task.id===selected;
    const label='Упражнение '+(i+1)+'. '+task.title+(done?' · Решено':'');
    return button('step:'+task.id,'<span>'+(i+1)+'</span>'+(done?icon('check'):''),
      'study-step'+(done?' solved':''),'aria-label="'+esc(label)+'" title="'+esc(label)+'"'+(active?' aria-current="step"':''));
  }).join('');
  return '<nav class="study-steps" aria-label="Шаги главы">'+theory+'<span class="step-divider" aria-hidden="true"></span><span class="step-label">Упражнения</span>'+steps+'</nav>';
}
function exerciseNavigation(lesson,task) {
  const index=lesson.exercises.indexOf(task), prev=lesson.exercises[index-1], next=lesson.exercises[index+1];
  const chapter=lessons[lessons.indexOf(lesson)+1], group=chapterIndex(lesson.id);
  const forward=next?button('step:'+next.id,'Следующее упражнение'+icon('arrow-right'),'cs-next'):
    chapter?button(chapterIndex(chapter.id)===group?'lesson:'+chapter.id:'chapter:'+(group+1),
      (chapterIndex(chapter.id)===group?'Следующая глава':'Следующая тема')+icon('arrow-right'),'cs-next'):button('go:home','К оглавлению'+icon('arrow-right'),'cs-next');
  return '<div class="cs-actions">'+button(prev?'step:'+prev.id:'lesson:'+lesson.id,icon('arrow-left')+(prev?'Предыдущее упражнение':'К теории'),'cs-tool')+forward+'</div>';
}
function activeTask() { return findLesson(state.lesson)?.exercises.find(task=>task.id===state.step); }
function exerciseView(lesson,task) {
  const predict=task.answerMode==='output', index=lesson.exercises.indexOf(task);
  const files=predict?{'Program.cs':task.starter,...task.files}:exerciseFiles(lesson,task);
  const names=Object.keys(files), file=names.includes(state.taskFile)?state.taskFile:'Program.cs';
  const fileTabs=names.length>1?'<div class="practice-files" role="group" aria-label="Файлы упражнения">'+names.map((name,i)=>
    button('task-file:'+i,esc(name),'cs-tool','aria-pressed="'+(file===name)+'"')).join('')+'</div>':'';
  const codeArea='<label class="cs-draft-label">'+(names.length>1?esc(file):'Твой код')+'<textarea class="cs-draft" rows="8" placeholder="Введи здесь свой код на C#" spellcheck="false" autocorrect="off" autocapitalize="off" aria-keyshortcuts="Control+Enter Meta+Enter">'+esc(files[file])+'</textarea></label>';
  const prediction= predict?('<pre class="practice-source"><code>'+syntax(files[file])+'</code></pre><label class="cs-draft-label">Твой ответ<textarea class="prediction-answer" rows="3" placeholder="Введи строки в том порядке, в котором они появятся на экране" spellcheck="false" autocapitalize="off">'+esc(store.get(draftKey(lesson,task),''))+'</textarea></label>'):'';
  const reference=Object.entries({'Program.cs':task.solution,...task.files}).map(([name,code])=>(names.length>1?'<strong>'+esc(name)+'</strong>':'')+copyable(code)).join('');
  return banner(lesson.title+' · Упражнение '+(index+1)+' из '+lesson.exercises.length,task.title,task.kind)+
    '<section class="cs-reading cp-widget" data-exercise="'+esc(task.id)+'"><p class="practice-instruction" data-note-anchor="instruction">'+formatText(task.instruction)+'</p>'+
    (task.stdin?.length?'<p>Данные для проверки по порядку: '+task.stdin.map(x=>'<code>'+esc(x||'пустая строка')+'</code>').join(', ')+'.</p>':'')+
    fileTabs+(predict?prediction:codeArea)+'<div class="cp-runbar">'+button('run-draft',icon(predict?'check':'play')+(predict?'Проверить ответ':'Запустить код'),'cp-run')+
    (predict?'':button('stop-draft',icon('square')+'Остановить','cs-tool','hidden'))+'</div><div class="cp-console"><strong>'+(predict?'Проверка ответа':'Результат запуска')+'</strong>'+
    '<div class="cp-response" role="status" aria-live="polite"><p class="cp-status">'+(exerciseDone(lesson,task)?'Упражнение решено.':predict?'Здесь появится результат проверки.':'Здесь появится вывод твоей программы.')+'</p></div>'+
    (predict?'':'<form class="cp-input" hidden><input aria-label="Ввод для программы" autocomplete="off" placeholder="Введи строку для программы"><button type="submit">Отправить</button></form>')+'</div>'+
    (predict?'<details><summary>Разбор ответа</summary>'+copyable(task.output)+(task.explanation?'<p>'+formatText(task.explanation)+'</p>':'')+'</details>':'<details><summary>Сверить ожидаемый вывод</summary>'+copyable(task.output)+'</details><details><summary>Посмотреть решение</summary>'+reference+'</details>')+
    '</section>'+exerciseNavigation(lesson,task);
}
function showExerciseResult() {
  const run=exerciseRuns.get(readerKey);
  const widget=reader.querySelector('.cp-widget');
  if(!run||!widget)return;
  widget.querySelector('.cp-response').innerHTML=(run.output?'<pre class="cp-output">'+esc(run.output)+'</pre>':'')+
    '<p class="cp-status'+(run.error?' cp-problem':'')+'">'+esc(run.status)+'</p>';
  widget.querySelector('[data-action="run-draft"]').disabled=run.running;
  const stop=widget.querySelector('[data-action="stop-draft"]'), form=widget.querySelector('.cp-input');
  if(stop)stop.hidden=!run.running;
  if(form){form.hidden=!run.awaiting;if(form.elements[0].value!==run.input)form.elements[0].value=run.input;}
}
function refreshStepMarks() {
  const nav=reader.querySelector('.study-steps');
  if(nav){nav.outerHTML=stepStrip(findLesson(state.lesson),state.step);glyphs();}
}
function checkExercise(lesson,task,run,actual) {
  const normalize=s=>s.replace(/\r\n?/g,'\n').replace(/\n$/,'');
  const matched=normalize(actual)===normalize(task.output);
  if(matched){
    store.set('solved/'+exercisePath(lesson,task),true);
    if(state.lesson===lesson.id)refreshStepMarks();
    run.status=task.answerMode==='output'?'Верно. Упражнение решено.':'Вывод совпал с ожидаемым. Упражнение решено.';
  }else{
    run.status=task.answerMode==='output'?'Пока не совпало. Проверь значения и порядок строк.':'Вывод отличается от ожидаемого. Сверь строки и попробуй ещё раз.';
  }
  showExerciseResult();
}
async function runExercise() {
  const lesson=findLesson(state.lesson),task=activeTask();
  if(!task)return;
  const key=exercisePath(lesson,task);
  if(exerciseRuns.get(key)?.running)return;
  const run={running:false,awaiting:false,output:'',status:'',input:'',error:false,handle:null};
  exerciseRuns.set(key,run);
  if(task.answerMode==='output')return checkExercise(lesson,task,run,reader.querySelector('.prediction-answer').value);
  const {'Program.cs':source,...files}=exerciseFiles(lesson,task);
  if(!source.trim()){run.status='Сначала введи код в Program.cs.';showExerciseResult();return;}
  run.running=true;run.status='Подготовка компилятора…';showExerciseResult();
  try{
    const {startRun}=await import('./runner.js');
    if(!run.running)return;
    run.handle=startRun({source,files,version:task.version||lesson.version||10,onEvent(e){
      if(!run.running)return;
      if(e.type==='ready')run.status='Программа выполняется…';
      if(e.type==='output')run.output+=e.text||'';
      if(e.type==='input'){run.awaiting=true;run.status='Программа ждёт ввода.';}
      if(e.type==='error'){run.error=true;run.status=[e.file,e.line?'строка '+e.line:'',e.code,e.text].filter(Boolean).join(' · ');}
      if(e.type==='done'){
        run.running=false;run.awaiting=false;run.handle=null;
        if(!run.error)checkExercise(lesson,task,run,run.output);
      }
      if(readerKey!==key)return;
      showExerciseResult();
      if(e.type==='input'&&document.hasFocus()&&!primary.hidden&&!reader.hidden&&reader.contains(document.activeElement))
        reader.querySelector('.cp-input input')?.focus({preventScroll:true});
    }});
  }catch(error){run.running=false;run.error=true;run.status=error.message;if(readerKey===key)showExerciseResult();}
}
function stopExercise(run) {
  if(!run?.running)return;
  run.running=false;run.awaiting=false;run.status='Запуск остановлен.';run.handle?.stop();run.handle=null;
  showExerciseResult();
}
