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
    const level=difficultyLabels[task.difficulty];
    const label=['Упражнение '+(i+1)+'. '+task.title,level,done?'Решено':''].filter(Boolean).join(' · ');
    const difficultyIcon=level?icon(task.difficulty==='expert'?'chevrons-up':'chevron-up'):'';
    return button('step:'+task.id,'<span>'+(i+1)+'</span>'+difficultyIcon+(done?icon('check'):''),
      'study-step'+(level?' challenge-step':'')+(done?' solved':''),'aria-label="'+esc(label)+'" title="'+esc(label)+'"'+(active?' aria-current="step"':''));
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
  const gapHint = task.starter?.includes('___') && !predict
    ? '<p>Три подчёркивания <code>___</code> отмечают пропуск в заготовке. Замени их кодом.</p>' : '';
  const reference=Object.entries({'Program.cs':task.solution,...task.files}).map(([name,code])=>(names.length>1?'<strong>'+esc(name)+'</strong>':'')+copyable(code)).join('');
  const level=difficultyLabels[task.difficulty];
  const checked=Boolean(task.checks?.length);
  return banner(lesson.title+' · Упражнение '+(index+1)+' из '+lesson.exercises.length,task.title,[task.kind,level].filter(Boolean).join(' · '))+
    '<section class="cs-reading cp-widget" data-exercise="'+esc(task.id)+'"><p class="practice-instruction" data-note-anchor="instruction">'+formatText(task.instruction)+'</p>'+
    (task.stdin?.length?'<p>'+(checked?'Пример ввода':'Данные для проверки по порядку')+': '+task.stdin.map(x=>'<code>'+esc(x||'пустая строка')+'</code>').join(', ')+'.</p>':'')+
    syntaxGuide(lesson,true)+gapHint+fileTabs+(predict?prediction:codeArea)+'<div class="cp-runbar">'+button('run-draft',icon(predict||checked?'check':'play')+(predict?'Проверить ответ':checked?'Проверить решение':'Запустить код'),'cp-run')+
    (checked?button('run-custom',icon('play')+'Со своим вводом','cs-tool'):'')+
    (predict?'':button('stop-draft',icon('square')+'Остановить','cs-tool','hidden'))+'</div><div class="cp-console"><div class="cp-result-head"><strong>'+(predict?'Проверка ответа':'Результат запуска')+'</strong>'+
    (predict?'':button('clear-draft-output',icon('eraser')+'Очистить вывод','cp-clear','disabled'))+'</div>'+
    '<div class="cp-response" role="status" aria-live="polite"><p class="cp-status">'+(exerciseDone(lesson,task)?'Упражнение решено.':predict?'Здесь появится результат проверки.':'Здесь появится вывод твоей программы.')+'</p></div>'+
    (predict?'':'<form class="cp-input" hidden><input aria-label="Ввод для программы" autocomplete="off" placeholder="Введи строку для программы"><button type="submit">Отправить</button></form>')+'</div>'+
    (predict?'<details><summary>Разбор ответа</summary>'+copyable(task.output)+(task.explanation?'<p>'+formatText(task.explanation)+'</p>':'')+'</details>':'<details><summary>Сверить ожидаемый вывод</summary>'+copyable(task.output)+'</details><details><summary>Посмотреть решение</summary>'+reference+'</details>')+
    '</section>'+solvedList(lesson.id)+exerciseNavigation(lesson,task);
}
function showExerciseResult() {
  const run=exerciseRuns.get(readerKey);
  const widget=reader.querySelector('.cp-widget');
  if(!run||!widget)return;
  const visibleOutput=run.output.slice(run.visibleFrom);
  const clear=widget.querySelector('.cp-clear'), failed=run.failedCase;
  if(clear)clear.disabled=!visibleOutput && !failed && !(run.error && !run.running);
  widget.querySelector('.cp-response').innerHTML=(visibleOutput?'<pre class="cp-output">'+esc(visibleOutput)+'</pre>':'')+
    '<p class="cp-status'+(run.error?' cp-problem':'')+'">'+esc(run.status)+'</p>'+
    (failed?'<dl class="case-details"><dt>Входные данные</dt><dd><pre>'+esc(failed.stdin.map(s=>s || '(пустая строка)').join('\n') || '(нет строк)')+
      '</pre></dd><dt>Ожидаемый вывод</dt><dd><pre>'+esc(failed.output || '(пусто)')+'</pre></dd></dl>':'');
  widget.querySelector('[data-action="run-draft"]').disabled=run.running;
  const custom=widget.querySelector('[data-action="run-custom"]');if(custom)custom.disabled=run.running;
  const stop=widget.querySelector('[data-action="stop-draft"]'), form=widget.querySelector('.cp-input');
  if(stop)stop.hidden=!run.running;
  if(form){form.hidden=!run.awaiting;if(form.elements[0].value!==run.input)form.elements[0].value=run.input;}
}
function clearExerciseOutput() {
  const run=exerciseRuns.get(readerKey);
  if(!run)return;
  // Grading uses the complete transcript, including text cleared while waiting for input.
  run.visibleFrom=run.output.length;
  run.failedCase=null;
  if(!run.running && run.error){run.error=false;run.status='Вывод очищен.';}
  showExerciseResult();
  if(run.awaiting)reader.querySelector('.cp-input input')?.focus({preventScroll:true});
}
function refreshStepMarks() {
  const nav=reader.querySelector('.study-steps');
  if(nav && readerKey.startsWith('lesson/')){
    const [,id,step]=readerKey.split('/');
    nav.outerHTML=stepStrip(findLesson(id),step);
    const status=reader.querySelector('.cp-status'), lesson=findLesson(id), task=lesson.exercises.find(t=>t.id===step);
    if(status && task && !exerciseRuns.has(readerKey) && exerciseDone(lesson,task))status.textContent='Упражнение решено.';
  }
}
function outputMatches(actual,expected) {
  const text=actual.replace(/\r\n?/g,'\n'), target=expected.replace(/\r\n?/g,'\n');
  return text===target || text===target+'\n';
}
function finishExercise(lesson,task,run,message) {
  if(!exerciseDone(lesson,task)){
    store.set('solved/'+exercisePath(lesson,task),true);
    refreshExerciseProgress();
  }
  run.status=message;
  showExerciseResult();
}
function executeCase(startRun,program,stdin,run,key,label) {
  run.output='';run.visibleFrom=0;run.status=label;
  const paint=()=>{if(readerKey===key)showExerciseResult();};
  paint();
  return new Promise(resolve=>{
    run.handle=startRun({...program,stdin,onEvent(e){
      if(e.type==='done'){run.handle=null;run.awaiting=false;resolve();return;}
      if(!run.running)return;
      if(e.type==='ready' && !stdin)run.status='Программа выполняется…';
      if(e.type==='output')run.output+=e.text||'';
      if(e.type==='input'){run.awaiting=true;run.status='Программа ждёт ввода.';}
      if(e.type==='error'){run.error=true;run.status=[e.file,e.line?'строка '+e.line:'',e.code,e.text].filter(Boolean).join(' · ');}
      paint();
      if(e.type==='input' && readerKey===key && document.hasFocus() && !primary.hidden && !reader.hidden && reader.contains(document.activeElement))
        reader.querySelector('.cp-input input')?.focus({preventScroll:true});
    }});
  });
}
async function runExercise(custom=false) {
  const lesson=findLesson(state.lesson),task=activeTask();
  if(!task)return;
  const key=exercisePath(lesson,task);
  if(exerciseRuns.get(key)?.running)return;
  const run={running:false,awaiting:false,output:'',visibleFrom:0,status:'',input:'',error:false,handle:null};
  exerciseRuns.set(key,run);
  if(task.answerMode==='output'){
    if(outputMatches(reader.querySelector('.prediction-answer').value,task.output))
      finishExercise(lesson,task,run,'Верно. Упражнение решено.');
    else{run.status='Пока не совпало. Проверь значения и порядок строк.';showExerciseResult();}
    return;
  }
  const {'Program.cs':source,...files}=exerciseFiles(lesson,task);
  if(!source.trim()){run.status='Сначала введи код в Program.cs.';showExerciseResult();return;}
  run.running=true;run.status='Подготовка компилятора…';showExerciseResult();
  try{
    const {startRun}=await import('./runner.js');
    if(!run.running)return;
    const program={source,files,version:task.version||lesson.version||10};
    const cases=task.checks?.length && !custom?[task,...task.checks]:null;
    if(cases){
      let sampleOutput='';
      for(const [i,test] of cases.entries()){
        const label='Проверка '+(i+1)+' из '+cases.length;
        await executeCase(startRun,program,test.stdin || [],run,key,label+'…');
        if(!run.running)return;
        if(run.error){run.status=label+'. '+run.status;return;}
        if(!outputMatches(run.output,test.output)){
          run.status=label+'. Вывод отличается от ожидаемого.';run.failedCase=test;return;
        }
        if(i===0)sampleOutput=run.output;
      }
      run.output=sampleOutput;run.visibleFrom=0;
      finishExercise(lesson,task,run,'Все проверки пройдены. Упражнение решено.');
    }else{
      await executeCase(startRun,program,undefined,run,key,'Подготовка компилятора…');
      if(!run.running)return;
      if(run.error)return;
      if(custom)run.status='Запуск завершён. Нажми «Проверить решение», чтобы зачесть задачу.';
      else if(outputMatches(run.output,task.output))finishExercise(lesson,task,run,'Вывод совпал с ожидаемым. Упражнение решено.');
      else run.status='Вывод отличается от ожидаемого. Сверь строки и попробуй ещё раз.';
    }
  }catch(error){run.error=true;run.status=error.message;}
  finally{run.running=false;run.awaiting=false;if(readerKey===key)showExerciseResult();}
}
function stopExercise(run) {
  if(!run?.running)return;
  run.running=false;run.awaiting=false;run.status='Запуск остановлен.';run.handle?.stop();run.handle=null;
  showExerciseResult();
}
