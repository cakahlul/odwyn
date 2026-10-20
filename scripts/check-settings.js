for(const file of ['test/knowledge-ui.test.js','test/workspace-homes-ui.test.js']){
 const child=Bun.spawn(['bun','test',file],{stdout:'inherit',stderr:'inherit'});
 if(await child.exited)process.exitCode=1;
}
