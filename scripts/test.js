import {readdirSync} from 'node:fs';
for(const file of readdirSync('test').filter(name=>name.endsWith('.test.js')).sort()){
  const child=Bun.spawn(['bun','test','test/'+file],{stdout:'inherit',stderr:'inherit'});
  if(await child.exited)process.exitCode=1;
}
