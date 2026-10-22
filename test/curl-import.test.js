import {test,expect} from 'bun:test';
import {importCurl} from '../public/curl-import.js';
import {validateConnection,executeConnection} from '../connections.js';

test('imports browser cURL with multiline quoting, auth and an exact JSON payload',()=>{
 const {connection}=importCurl(String.raw`curl 'https://api.example.com/tickets?state=open' \
 -H 'Authorization: Bearer secret-token' \
 -H 'Content-Type: application/json' --data-raw '{"title":"Owner'\''s ticket","active":true}'`);
 expect(connection.method).toBe('POST');expect(connection.headers.authorization).toBe('Bearer secret-token');
 expect(JSON.parse(connection.body)).toEqual({title:"Owner's ticket",active:true});expect(connection.bodyType).toBe('text');
 expect(validateConnection(connection).url).toBe('https://api.example.com/tickets?state=open');
});
test('supports attached flags, basic auth, JSON and URL-encoded query data',()=>{
 const basic=importCurl('curl --url=https://example.com -XPUT -u "user:pass:word" --json \'{"x":1}\'').connection;
 expect(basic.method).toBe('PUT');expect(basic.headers.authorization).toBe('Basic '+btoa('user:pass:word'));expect(basic.headers['content-type']).toBe('application/json');
 const query=importCurl("curl -G 'https://example.com?sort=new' --data-urlencode 'q=hello & world' -d 'page=2'").connection;
 expect(query.method).toBe('GET');expect(query.url).toBe('https://example.com/?sort=new&q=hello%20%26%20world&page=2');expect(query.body).toBeUndefined();
});
test('preserves repeated form data and imports multipart text fields',()=>{
 const data=importCurl("curl https://example.com -d 'a=1' --data 'a=2'").connection;
 expect(data.body).toBe('a=1&a=2');expect(data.headers['content-type']).toBe('application/x-www-form-urlencoded');
 expect(importCurl("curl https://example.com -F 'title=Hello world' --form-string 'literal=@text'").connection.body).toEqual({title:'Hello world',literal:'@text'});
 expect(importCurl('curl -I https://example.com').connection.method).toBe('HEAD');
 expect(importCurl('curl -sS --compressed -L https://example.com').warnings).toHaveLength(1);
});
test('rejects shell execution, files, ambiguous requests and unsupported flags without exposing values',()=>{
 for(const command of ["curl https://example.com; touch /tmp/nope",'curl "https://$HOST"',"curl https://example.com -d @private",'curl https://example.com --config secret','curl https://one.test https://two.test',"curl https://example.com -H 'broken",'curl https://example.com -k',"curl https://example.com -XGET -d data",'curl file:///etc/passwd',"curl https://example.com -F 'file=@private'","curl https://example.com -H 'X-Value: one' -H 'X-Value: two'"]){expect(()=>importCurl(command)).toThrow();}
 expect(()=>importCurl('curl https://example.com --unknown=private-token')).toThrow('Unsupported cURL option: --unknown');
});
test('imported request executes with the original body, method and headers',async()=>{
 const server=Bun.serve({port:0,fetch:async request=>Response.json({method:request.method,body:await request.text(),type:request.headers.get('content-type'),token:request.headers.get('authorization')})});
 try{
  const {connection}=importCurl(`curl http://localhost:${server.port}/ticket -X PATCH -H 'Authorization: Bearer fixture' -H 'Content-Type: application/vnd.example+json' --data-raw '{"x": 1}'`);
  expect((await executeConnection(validateConnection(connection))).data).toEqual({method:'PATCH',body:'{"x": 1}',type:'application/vnd.example+json',token:'Bearer fixture'});
 }finally{server.stop(true);}
});
