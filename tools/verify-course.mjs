import { spawn, execFileSync } from 'node:child_process';
import { promises as fs, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const coursePath = fileURLToPath(new URL('../wwwroot/course.json', import.meta.url));
const course = JSON.parse(readFileSync(coursePath, 'utf8'));
const ids = new Set();
const programs = [];
function checkTheory(owner) {
  if (!Array.isArray(owner.theory) || owner.theory.length < 2 ||
      owner.theory.some(block => !block.title?.trim() || !block.text?.trim())) {
    throw new Error('Incomplete theory: ' + owner.title);
  }
}
for (const chapter of course) {
  if (!chapter.title || chapter.topics.length < 2) throw new Error('Incomplete chapter: ' + chapter.title);
  checkTheory(chapter);
  for (const topic of chapter.topics) {
    checkTheory(topic);
    if (!topic.id || ids.has(topic.id)) throw new Error('Invalid topic ID: ' + topic.id);
    ids.add(topic.id);
    if (!topic.title || !topic.intro || !topic.section || !topic.description ||
        topic.learn.length < 2 || !topic.mistake?.why || !topic.practice?.hint ||
        !topic.practice.choices[topic.practice.correct] || !Array.isArray(topic.exercises) ||
        !topic.source?.label || !topic.source?.url || topic.examples.length < 2) {
      throw new Error('Incomplete topic: ' + topic.id);
    }
    for (const [i, example] of topic.examples.entries()) {
      if (!example.name || !example.steps?.length) throw new Error('No walkthrough: ' + topic.id);
      programs.push({ ...example, id: topic.id + '/' + (i + 1), version: example.version ?? topic.version ?? 10 });
    }
    const tasks=topic.exercises, keys=new Set();
    if(tasks.length<3||tasks.length>7||tasks[0].id!=='original')throw new Error('Invalid exercise count or legacy ID: '+topic.id);
    for(const task of tasks){
      if(!/^[a-z0-9-]+$/.test(task.id)||keys.has(task.id)||!task.title||!task.kind||!task.instruction||
          !task.solution||typeof task.output!=='string'||(task.answerMode==='output'&&(!task.starter||!task.explanation))){
        throw new Error('Incomplete exercise: '+topic.id+'/'+task.id);
      }
      keys.add(task.id);
      programs.push({...task, id:topic.id+'/'+(task.id==='original'?'task':task.id), code:task.solution, version:task.version??topic.version??10});
    }
  }
}

const extras = [
  ['while-loop/2', [], 'Готово'],
  ['while-loop/2', [''], 'Готово'],
  ['do-while-loop/2', [], 'Введи да\nВвод закончился'],
  ['do-while-loop/2', ['да'], 'Введи да\nПринято'],
  ['read-line/1', [''], 'Имя для бейджа?\n'],
  ['try-parse/2', ['1'], 'Шкафчик 1 найден.'],
  ['try-parse/2', ['20'], 'Шкафчик 20 найден.'],
  ['try-parse/2', ['21'], 'Нужен номер от 1 до 20.'],
  ['try-parse/2', ['2147483648'], 'Нужен номер от 1 до 20.'],
  ['try-parse/task', ['120'], 'Возраст записан.'],
  ['try-parse/task', ['-1'], 'Проверь возраст.'],
  ['expense-entry/1', [' ', '20'], 'Не удалось добавить расход.'],
  ['expense-entry/task', ['2'], 'Принято'],
  ['expense-capstone/1', ['загрузить', 'добавить 0 Спорт', 'добавить -5 Еда', 'итог'], [
    'Нет пригодных данных.', 'Нужны положительная сумма и категория.',
    'Нужны положительная сумма и категория.', 'Итого: 0 руб.'
  ]],
  ['expense-capstone/1', ['добавить 2147483647 Еда', 'добавить 10 Еда', 'итог'], [
    'Добавлено.', 'Добавлено.', 'Итого: 2147483657 руб.'
  ]]
];
for (const [id, stdin, output] of extras) {
  const original = programs.find(program => program.id === id);
  if (!original) throw new Error('Unknown extra case: ' + id);
  const expected = Array.isArray(output) ? [original.output.split('\n')[0], ...output].join('\n') : output;
  programs.push({ ...original, stdin, output: expected, id: id + '/input(' + stdin.join(', ') + ')' });
}

for (const [id, diagnostic] of [['first-error', 'CS1002'], ['types', 'CS0029'],
  ['variables', 'CS0128'], ['modern-12-13', 'CS9176']]) {
  const lesson = course.flatMap(chapter => chapter.topics).find(topic => topic.id === id);
  programs.push({ id: id + '/diagnostic', version: 10, code: lesson.mistake.wrong, diagnostic });
}

const versions = new Map();
const installedSdks = execFileSync('dotnet', ['--list-sdks'], { encoding: 'utf8' }).trim().split(/\r?\n/);
for (const version of [10, 11]) {
  const installed = installedSdks.findLast(line => line.startsWith(version + '.'));
  const match = installed?.match(/^(\d+\.\d+\.\d+) \[(.+)\]$/);
  if (!match) throw new Error('.NET SDK ' + version + ' is required.');
  const [, sdk, sdkRoot] = match;
  const pack = join(dirname(sdkRoot), 'packs', 'Microsoft.NETCore.App.Ref');
  const referenceVersion = readdirSync(pack).filter(item => item.startsWith(version + '.'))
    .sort((left, right) => left.localeCompare(right, 'en', {numeric: true})).at(-1);
  if (!referenceVersion) throw new Error('.NET reference pack ' + version + ' is required.');
  const refsFolder = join(pack, referenceVersion, 'ref', 'net' + version + '.0');
  versions.set(version, {
    version, sdk, langVersion: version === 10 ? '14.0' : '15.0',
    csc: join(sdkRoot, sdk, 'Roslyn', 'bincore', 'csc.dll'),
    refs: readdirSync(refsFolder).filter(name => name.endsWith('.dll')).map(name => join(refsFolder, name))
  });
}

function run(args, cwd, input = '') {
  return new Promise((resolveRun, reject) => {
    const child = spawn('dotnet', args, { cwd, windowsHide: true, stdio: 'pipe' });
    const chunks = { stdout: '', stderr: '' };
    for (const stream of Object.keys(chunks)) {
      child[stream].setEncoding('utf8');
      child[stream].on('data', value => chunks[stream] += value);
    }
    const timer = setTimeout(() => child.kill(), 25_000);
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      resolveRun({ code, ...chunks });
    });
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(input);
  });
}

const setup = `global using System;
global using System.Collections.Generic;
global using System.IO;
global using System.Linq;
global using System.Net.Http;
global using System.Threading;
global using System.Threading.Tasks;

internal static class VerificationSetup
{
    [System.Runtime.CompilerServices.ModuleInitializer]
    internal static void Initialize()
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Console.InputEncoding = System.Text.Encoding.UTF8;
        System.Globalization.CultureInfo.CurrentCulture = System.Globalization.CultureInfo.InvariantCulture;
    }
}`;

async function verify(program, index, base) {
  const { version, refs, csc, langVersion } = versions.get(program.version);
  const directory = join(base, String(index));
  await fs.mkdir(directory);
  const sources = [];
  for (const [name, code] of Object.entries({
    'Program.cs': program.code, 'VerificationSetup.g.cs': setup, ...program.files
  })) {
    const path = resolve(directory, name);
    const rel = relative(directory, path);
    if (rel.startsWith('..') || isAbsolute(rel) || !rel.endsWith('.cs')) throw new Error('Invalid source path: ' + name);
    await fs.mkdir(dirname(path), { recursive: true });
    await fs.writeFile(path, code, 'utf8');
    sources.push(path);
  }
  const asm = 'Lesson.dll';
  const quoted = value => '"' + value + '"';
  await fs.writeFile(join(directory, 'check.rsp'), [
    '/nologo', '/target:exe', '/nullable:enable', '/langversion:' + langVersion,
    '/out:' + asm, ...refs.map(ref => '/reference:' + quoted(ref)), ...sources.map(quoted)
  ].join('\n'), 'utf8');
  const build = await run([csc, '/noconfig', '@check.rsp'], directory);
  if (program.diagnostic) {
    if (build.code !== 0 && (build.stdout + build.stderr).includes(program.diagnostic)) return;
    throw new Error('Expected ' + program.diagnostic + ': ' + build.stdout + build.stderr);
  }
  if (build.code !== 0) throw new Error(build.stdout + build.stderr);
  await fs.writeFile(join(directory, 'Lesson.runtimeconfig.json'), JSON.stringify({
    runtimeOptions: { tfm: 'net' + version + '.0', framework: { name: 'Microsoft.NETCore.App', version: version + '.0.0' } }
  }));
  const execution = await run([asm], directory, program.stdin?.length ? program.stdin.join('\n') + '\n' : '');
  const stdout = execution.stdout.replaceAll('\r\n', '\n').replace(/\n$/, '');
  if (execution.code !== 0 || stdout !== program.output) {
    throw new Error('Expected ' + JSON.stringify(program.output) + ', got ' + JSON.stringify(stdout) +
      ' (' + execution.code + ')\n' + execution.stderr);
  }
}

const tempRoot = resolve(tmpdir());
const base = await fs.mkdtemp(join(tempRoot, 'CSharpBook-verify-'));
let next = 0;
let passed = 0;
const failures = [];
try {
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < programs.length) {
      const index = next++;
      const program = programs[index];
      try {
        await verify(program, index, base);
        passed++;
      } catch (error) {
        failures.push(program.id + ' (.NET ' + program.version + '): ' + error.message);
      }
    }
  }));
} finally {
  if (dirname(base) === tempRoot && basename(base).startsWith('CSharpBook-verify-')) {
    await fs.rm(base, { recursive: true, force: true });
  }
}
for (const problem of failures) process.stderr.write(problem + '\n');
console.log(`${course.length} themes, ${ids.size} chapters. ${passed}/${programs.length} verified: ` +
  [...versions.values()].map(({sdk}) => sdk).join(', ') + '.');
if (failures.length) process.exitCode = 1;
