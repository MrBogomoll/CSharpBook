import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base=process.argv[2] || 'http://127.0.0.1:53825/';
const quick=process.argv.includes('--quick');
const profile=mkdtempSync(join(tmpdir(),'book-runner-smoke-'));
const exe=process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const child=spawn(exe,['--headless=new','--no-proxy-server','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-component-update','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try {
  const endpoint=join(profile,'DevToolsActivePort');
  for(let i=0;!existsSync(endpoint) && i<200;i++) await wait(50);
  const port=readFileSync(endpoint,'utf8').split(/\r?\n/)[0];
  const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  const pending=new Map(); let sequence=0;
  ws.onmessage=({data})=>{const m=JSON.parse(data); if(!m.id){if(process.env.BOOK_DEBUG && (m.method==='Log.entryAdded' || m.method==='Runtime.exceptionThrown'))console.log(m.method,JSON.stringify(m.params).slice(0,1300));return;}const [resolve,reject]=pending.get(m.id)||[];if(!resolve)return;pending.delete(m.id);if(m.error)reject(Error(m.error.message));else resolve(m.result);};
  const call=(method,params={})=>new Promise((r,j)=>{pending.set(++sequence,[r,j]);ws.send(JSON.stringify({id:sequence,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await call('Page.enable');await call('Runtime.enable');await call('Log.enable');await call('Page.navigate',{url:base});
  for(let i=0;i<200;i++){await wait(50);try{if(await evaluate('location.href==='+JSON.stringify(base)+' && document.readyState==="complete"'))break;}catch{}}
  console.log('Browser',await evaluate('JSON.stringify({origin:location.origin,secure:isSecureContext,isolated:crossOriginIsolated})'));
  if(process.argv.includes('--offline')) {
    await evaluate('(async()=>{await navigator.serviceWorker.register("./sw.js");await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(r=>navigator.serviceWorker.addEventListener("controllerchange",r,{once:true}));})()');
    await call('Network.enable');await call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await call('Page.reload');
    for(let i=0;i<200;i++){await wait(50);try{if(await evaluate('document.readyState==="complete" && navigator.serviceWorker.controller!=null'))break;}catch{}}
    assert.equal(await evaluate('navigator.onLine'),false);
    console.log('PWA reopened offline, clean editor runtime.');
  }
  if (process.argv.includes('--ui')) {
    const until=async expression=>{for(let i=0;i<240;i++){if(await evaluate(expression))return;await wait(100);}throw Error('UI condition timed out: '+expression+'; '+await evaluate('document.body.innerText.slice(-700)'));};
    await evaluate('location.hash="#lesson/modern-15-unions"');
    await until('!!document.querySelector("[data-action=open-example]")');
    const template=await evaluate('defaultEditor(findLesson(state.lesson)).source');
    await evaluate('store.set("editor/"+state.lesson+"/"+state.example,{source:"// сохранённый черновик",files:{}})');
    await evaluate('document.querySelector("[data-action=open-example]").click()');
    await until('!!document.querySelector(".cm-content")');
    assert.equal(await evaluate('document.querySelector(".cm-content").innerText'),'// сохранённый черновик');
    await evaluate('document.querySelector("[data-action=reset-console]").click()');
    assert.equal(await evaluate('store.get("console").source'),template);
    assert.equal(await evaluate('Array.from(document.querySelectorAll(".cm-content .cm-line"),line=>line.textContent).join("\\n")'),template);
    await evaluate('document.querySelector(".cm-content").focus()');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
    await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
    await until('document.querySelector(".cx-console .cm-content").hasAttribute("aria-placeholder")');
    assert.equal(await evaluate('store.get("console").source'),'');
    const source='Console.Write("Кому? ");\nMessage message=Console.ReadLine() ?? "";\nConsole.WriteLine(message switch {string name => "Привет, "+name, int number => number.ToString()});\npublic union Message(string,int);';
    await call('Input.insertText',{text:source});
    await until('document.querySelector(".cm-content").innerText.includes("union Message")');
    assert.equal(await evaluate('document.querySelector(".cx-console .cm-content").hasAttribute("aria-placeholder")'),false);
    await evaluate('document.querySelector(".cx-run").click()');
    await until('document.querySelector(".cx-stdin")?.hidden === false');
    await evaluate('document.querySelector(".cx-stdin input").focus()');
    await call('Input.insertText',{text:'Кира'});
    await evaluate('document.querySelector(".cx-send").click()');
    await until('document.querySelector(".cx-stop")?.hidden === true && document.querySelector(".cx-out").innerText.includes("Привет, Кира")');
    console.log('Edited C# 15 program through CodeMirror, Run button, real ReadLine and Send button',await evaluate('document.querySelector(".cx-out").innerText'));
    await evaluate('document.querySelector("[data-action=reset-console]").click()');
    assert.equal(await evaluate('document.querySelector(".cx-out").textContent'),'');
    assert.equal(await evaluate('document.querySelector(".cx-term-status").textContent'),'Готово к запуску');
    assert.equal(await evaluate('store.get("console").source'),template);
    await evaluate('go("lesson","read-line","challenge-2")');
    await until('!!document.querySelector(".practice-editor .cm-content")');
    const checkCode=async expression=>{
      const code=await evaluate(expression);
      await evaluate('document.querySelector(".practice-editor .cm-content").focus()');
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65});
      await call('Input.insertText',{text:code});
      await until('exerciseFiles(findLesson(state.lesson),activeTask())["Program.cs"] === '+JSON.stringify(code));
      await evaluate('document.querySelector("[data-action=run-draft]").click()');
      await until('!document.querySelector("[data-action=run-draft]").disabled');
    };
    await checkCode('"Console.Write(" + JSON.stringify(activeTask().output) + ");"');
    assert.equal(await evaluate('exerciseDone(findLesson("read-line"), activeTask())'),false);
    assert.ok(await evaluate('!!document.querySelector(".case-details")'));
    await checkCode('activeTask().solution');
    assert.equal(await evaluate('exerciseDone(findLesson("read-line"), activeTask())'),true);
    assert.equal(await evaluate('taskProgress("read-line").solved'),1);
    await evaluate('document.querySelector(".cs-content .solved-tasks").open=true');
    await until('!!document.querySelector(\'.cs-content a[href="#lesson/read-line/challenge-2"]\')');
    console.log('Only a solution that passed alternate inputs appeared in the chapter list.');
    await evaluate('document.querySelector("[data-action=reset-draft]").click()');
    assert.ok(await evaluate('Array.from(document.querySelectorAll(".practice-editor .cm-line"),line=>line.textContent).join("\\n") === activeTask().starter'));
    assert.ok(await evaluate('exerciseDone(findLesson("read-line"),activeTask())'));
    await evaluate('go("lesson","console","original")');
    const emptyEditor='document.querySelector(".practice-editor .cm-content")';
    await until(emptyEditor+'?.hasAttribute("aria-placeholder")');
    assert.match(await evaluate(emptyEditor+'.getAttribute("aria-placeholder")'),/^\/\/ /);
    assert.equal(await evaluate('exerciseFiles(findLesson("console"),activeTask())["Program.cs"]'),'');
    await evaluate(emptyEditor+'.focus()');
    await call('Input.insertText',{text:'// test'});
    await until('exerciseFiles(findLesson("console"),activeTask())["Program.cs"] === "// test"');
    assert.equal(await evaluate(emptyEditor+'.hasAttribute("aria-placeholder")'),false);
    await evaluate('document.querySelector("[data-action=undo-draft]").click()');
    await until(emptyEditor+'?.hasAttribute("aria-placeholder")');
  }
  const tests=[
    {name:'hello10',version:10,source:'Console.WriteLine("Привет!"); Console.WriteLine(Environment.Version.Major);',out:'Привет!\n10\n'},
    {name:'hello11',version:11,source:'string word="маяк"; Console.WriteLine(word=="Маяк"); Console.WriteLine(word=="маяк"); Console.WriteLine(Environment.Version.Major);',out:'False\nTrue\n11\n'},
    {name:'interactive',version:11,source:'Console.Write("Имя? "); var name=Console.ReadLine(); Console.WriteLine("Привет, "+name); var s = Console.ReadLine(); Console.WriteLine(s.Length);',input:['Лена',''],out:'Имя? Привет, Лена\n0\n'},
    {name:'prepared input and EOF',version:10,source:'while (Console.ReadLine() is string line) Console.WriteLine("[" + line + "]");',stdin:['один','','три'],out:'[один]\n[]\n[три]\n'},
    {name:'multiple files',version:10,source:'Console.WriteLine(Maths.Add(8, 6));',files:{'Maths.cs':'static class Maths { public static int Add(int a,int b)=>a+b; }'},out:'14\n'},
    {name:'runtime exception',version:11,source:'throw new InvalidOperationException("test-failure");',error:'InvalidOperationException'},
    {name:'diagnostic',version:10,source:'Console.WriteLine(1)',error:'CS1002',line:1,col:21},
    {name:'async',version:11,source:'await Task.Delay(40); Console.WriteLine("готово");',out:'готово\n'},
    {name:'stop',version:10,source:'Console.WriteLine("start"); while(true){}',stop:true,out:'start\n'},
    {name:'next run',version:11,source:'Console.WriteLine(42);',out:'42\n'},
    {name:'C# 15 union',version:11,source:'Message m = "готово"; Console.WriteLine(m switch { string s=>s, int i=>i.ToString() }); public union Message(string,int);',out:'готово\n'},
    {name:'C# 14 rejects union',version:10,source:'Console.WriteLine(1); public union Message(string,int);',error:'CS0246'},
    {name:'file diagnostic',version:11,source:'Console.WriteLine(Scores.Bonus);',files:{'Scores.cs':'public class Scores {\n    public static int Bonus => absent;\n}'},error:'CS0103',line:2,col:32,file:'Scores.cs'},
    {name:'private files and network',version:11,source:'using System.Net.Http; File.WriteAllText("my-test.txt","one run"); Console.WriteLine(File.ReadAllText("my-test.txt")); Console.WriteLine(File.Exists(@"C:\\Windows\\win.ini")); try {await new HttpClient().GetStringAsync('+JSON.stringify(base+'course.json')+'); Console.WriteLine("reachable");} catch(HttpRequestException) { Console.WriteLine("blocked"); }',out:'one run\nFalse\nblocked\n'},
    {name:'fresh filesystem',version:11,source:'Console.WriteLine(File.Exists("my-test.txt"));',out:'False\n'},
    {name:'linear memory limit',version:10,source:'try { Console.WriteLine(new byte[300*1024*1024].Length); } catch(OutOfMemoryException) { Console.WriteLine("memory limited"); }',out:'memory limited\n'},
    {name:'output limit',version:11,source:'Console.Write(new string(\'x\',160000));',cap:true},
    ...(process.argv.includes('--deadline')?[{name:'execution deadline',version:10,source:'while(true) {}',error:'30 секунд'}]:[]),
    ...(process.argv.includes('--wait-input')?[{name:'wait beyond deadline',version:11,source:'Console.WriteLine(Console.ReadLine());',input:['вовремя'],hold:31000,out:'вовремя\n'}]:[]),
  ];
  const only=process.argv.find(arg=>arg.startsWith('--only='))?.slice(7);
  const selected=only?tests.filter(t=>new RegExp(only).test(t.name)):quick?tests.slice(0,1):tests;
  assert.ok(selected.length);
  for(const t of selected) {
    const payload=JSON.stringify(t);
    const result=await evaluate('(async()=>{const t='+payload+';const {startRun}=await import("./runner.js");return new Promise(resolve=>{const events=[];let output="",count=0;const timer=setTimeout(()=>{control.stop();},45000);const control=startRun({...t,onEvent(e){events.push(e);if(e.type==="output"){output+=e.text;if(t.stop)setTimeout(()=>control.stop(),50);}if(e.type==="input" && t.input && count<t.input.length){setTimeout(()=>control.sendInput(t.input[count++]),t.hold||35);}if(e.type==="done"){clearTimeout(timer);resolve({events,output});}}});})})()');
    console.log(t.name,t.cap?'chars='+result.output.length:JSON.stringify(result).slice(0,1100));
    if(t.cap){assert.equal(result.output.match(/^x+/)[0].length,131072);assert.ok(result.output.includes('128 тысяч'));continue;}
    if(t.error) {const match=result.events.find(e=>e.type==='error' && (e.text.includes(t.error) || e.code===t.error));assert.ok(match);if(t.line){assert.equal(match.line,t.line);assert.equal(match.col,t.col);}if(t.file)assert.equal(match.file,t.file);}
    else {assert.equal(result.output,t.out);assert.ok(!result.events.some(e=>e.type==='error'));}
  }
} finally { if(ws)ws.close();child.kill(); }
