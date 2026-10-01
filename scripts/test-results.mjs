import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
function compile(file,require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require});return exports;}
const dates=compile('../lib/date-time.ts'), csv=compile('../lib/results-export.ts',()=>dates);
const row={id:'row-1',employeeName:'Иван; Петров',testTitle:'Проверка "знаний"\nГИБДД',testId:'test',passMark:80,startedAt:'2026-09-30T20:00:00Z',finishedAt:'2026-09-30T21:30:00Z',score:0,total:10};
await test('Excel export includes UTF-8 BOM, semicolon escaping, zero scores and Moscow dates',()=>{
 const text=csv.resultsCsv([row,{...row,id:'pending',finishedAt:null,score:null}]);
 assert(text.startsWith('\uFEFF'));assert.match(text,/"Иван; Петров"/);assert.match(text,/Проверка ""знаний""\nГИБДД/);assert.match(text,/1 октября 2026.*00:30 МСК/);assert.match(text,/"0";"10";"0,0";"80";"Не зачтено"/);assert.doesNotMatch(text,/pending|questions|answers/);
});
await test('formula-like user strings are exported as spreadsheet text',()=>{for(const name of ['=1+1',' +SUM(A1)','-1+1','@SUM(A1)','\tformula','\nformula'])assert(csv.resultsCsv([{...row,employeeName:name}]).includes('"\''+name+'"'));});
await test('status uses the actual threshold and labels practice separately',()=>{assert.equal(csv.resultStatus({...row,score:8}),'Зачёт');assert.equal(csv.resultStatus({...row,mode:'practice',score:10}),'Без ошибок');assert.equal(csv.resultStatus({...row,mode:'practice',score:0}),'Есть ошибки');});
function fixture(pages){let calls=[],cancelled=false;const api=compile('../lib/results-api.ts',name=>name==='./account-session'?{accountRpc:async(name,payload,requireSession)=>{calls.push({name,payload,requireSession});return {data:pages.shift(),error:null};}}:name==='./workspace-api'?{WorkspaceError:Error}:csv);return {...api,calls,cancel:()=>cancelled=true,cancelled:()=>cancelled};}
await test('export continues past 500 rows with the same snapshot and explicit account guard',async()=>{
 const rows=Array.from({length:505},(_,i)=>({...row,id:'result-'+i}));const pages=[];
 for(let i=0;i<rows.length;i+=100)pages.push({rows:rows.slice(i,i+100),total:505,snapshot:'fixed-snapshot',nextCursor:i+100<rows.length?{id:'cursor-'+i,finishedAt:'fixed-date'}:null});
 const f=fixture(pages);let progress=[];const text=await f.exportResults('team',f.emptyResultsFilters,f.cancelled,(n,total)=>progress.push([n,total]));
 assert.equal(f.calls.length,6);assert.equal(progress.at(-1)[0],505);assert(text.includes('result-504'));
 assert(f.calls.every(c=>c.name==='knowledge_results'&&c.requireSession));assert(f.calls.slice(1).every(c=>c.payload.snapshot==='fixed-snapshot'));
});
await test('cancellation and an incomplete/changing export cannot produce a partial download',async()=>{
 const f=fixture([{rows:[row],total:2,snapshot:'s',nextCursor:null}]);await assert.rejects(f.exportResults('mine',f.emptyResultsFilters,()=>false,()=>{}),/весь отчёт/);
 const g=fixture([{rows:[row],total:2,snapshot:'s',nextCursor:{id:'r',finishedAt:'t'}},{rows:[{...row,id:'second'}],total:1,snapshot:'s',nextCursor:null}]);await assert.rejects(g.exportResults('mine',g.emptyResultsFilters,()=>false,()=>{}),/изменились/);
 const h=fixture([]);h.cancel();await assert.rejects(h.exportResults('mine',h.emptyResultsFilters,h.cancelled,()=>{}),/отменён/);assert.equal(h.calls.length,0);
});
