#!/usr/bin/env bun
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {runBaseline} from '../tests/security/run-baseline.js';
if(!process.env.ODWYN_SECURITY_REPORT_DIR)throw new Error('BLOCKED: report directory required');
const report=join(process.env.ODWYN_SECURITY_REPORT_DIR,'release-regression');mkdirSync(report,{recursive:true});
const result=await runBaseline(report);writeFileSync(join(report,'results.json'),JSON.stringify(result,null,2));
if(!result.junitComplete||!result.tests)throw new Error('BLOCKED: complete regression JUnit unavailable');
if(result.exitCode||result.failed||result.skipped||!result.browserSmoke||!result.dependencies)throw new Error('FAIL: existing repository regression');
console.log('PASS: '+result.tests+' existing regression tests; no failures or skips');
