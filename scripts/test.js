#!/usr/bin/env bun
import {mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {runBaseline} from '../tests/security/run-baseline.js';

// Each test file gets its own process; native browser/SQLite handles stay local.
const report=resolve(process.env.ODWYN_SECURITY_REPORT_DIR || join('artifacts','tests',`${Date.now()}-${process.pid}`));
mkdirSync(report,{recursive:true});
const files=['test','tests/security'].flatMap(directory=>readdirSync(directory,{recursive:true}).filter(file=>/\.test\.[jt]sx?$/.test(file)).sort().map(file=>join(directory,file)));
console.log(`Full suite: ${files.length} files; evidence ${report}`);
const result=await runBaseline(report,files);
writeFileSync(join(report,'results.json'),JSON.stringify(result,null,2)+'\n');
if(result.exitCode || !result.junitComplete || result.failed || result.skipped || !result.tests || !result.browserSmoke || !result.dependencies){
  console.error(`FAIL: ${result.failed} failed, ${result.skipped} skipped; see ${join(report,'regression.log')}`);
  process.exit(1);
}
console.log(`PASS: ${result.tests} tests, no failures or skips.`);
