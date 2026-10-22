import {$,esc,icon,api,toast,handleError} from './ui.js';
import {libraryList} from './workflows-ui.js';

export function renderConnections(state){
 return `<section class="collection workflows library-page"><div class="collection-heading"><h1>Connections</h1><p>Connect APIs and MCP servers. Your agents can use them in chat, rooms, skills and enabled workflow steps.</p></div><div class="collection-toolbar"><button class="primary-button" id="connection-new">New connection +</button></div>${libraryList('connections','Saved connections',state.connections||[],connection=>`<article class="workflow-row"><div><h3>${esc(connection.name)}</h3><p>${esc({rest:'HTTP / REST',graphql:'GraphQL',grpc:'gRPC',mcp:'MCP'}[connection.type])} · ${connection.enabled?'Enabled':'Disabled'}${connection.oauth?connection.authenticated?' · Signed in':' · Sign-in required':''}</p><small>${esc(connection.transport==='stdio'?connection.command:connection.url)}</small></div><div class="workflow-actions">${connection.oauth?`<button class="secondary-button" data-connection-authorize="${esc(connection.id)}" ${connection.enabled?'':'disabled'}>Sign in</button>`:''}<button class="secondary-button" data-connection-test="${esc(connection.id)}" ${connection.enabled?'':'disabled'}>${connection.type==='mcp'?'Explore tools':'Test'}</button><button class="secondary-button" data-connection-edit="${esc(connection.id)}">Edit</button><button class="icon-button" data-connection-delete="${esc(connection.id)}" aria-label="Delete ${esc(connection.name)}">${icon('trash')}</button></div></article>`,'No connections yet. Add an API request or connect an MCP server such as Atlassian.')}</section>`;
}
const field=(name,label,extra='')=>`<label>${label}<input name="${name}" ${extra}></label>`;
const area=(name,label,rows=4)=>`<label>${label}<textarea name="${name}" rows="${rows}" spellcheck="false"></textarea></label>`;
export function setupConnections(getState,refresh){
 let editing=null,testing=null,busy=false;
 document.body.insertAdjacentHTML('beforeend',`<dialog id="connection-editor" class="modal" aria-labelledby="connection-heading"><div class="modal-top"><span class="eyebrow">CONNECTION</span><button type="button" class="icon-button" data-connection-close aria-label="Close connection editor">${icon('close')}</button></div><h2 id="connection-heading">New connection</h2><form id="connection-form"><div class="modal-fields">${field('name','Name','required maxlength="80" placeholder="Atlassian"')}<label>Type<select name="type"><option value="rest">HTTP / REST</option><option value="graphql">GraphQL</option><option value="grpc">gRPC</option><option value="mcp">MCP server</option></select></label><div data-connection-types="mcp"><label>Transport<select name="transport"><option value="http">Streamable HTTP</option><option value="sse">SSE (legacy)</option><option value="stdio">Local process (stdio)</option></select></label></div><div data-connection-remote>${field('url','Endpoint','maxlength="4000" placeholder="https://api.example.com"')}<p class="field-hint">REST URL inputs: {{inputs.id}}. gRPC endpoint: host:port. Atlassian MCP: https://mcp.atlassian.com/v2/mcp</p></div><div data-connection-local>${field('command','Executable','placeholder="npx"')}${area('args','Arguments (JSON array)',2)}${area('env','Environment variables (secret JSON object)',2)}<p class="field-hint">Local MCP servers run on the Odwyn host. Only configure trusted executables. Blank environment keeps saved values.</p></div><div data-connection-types="rest"><label>HTTP method<select name="httpMethod">${['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(method=>`<option>${method}</option>`).join('')}</select></label><label>Body format<select name="bodyType"><option value="json">JSON</option><option value="text">Raw text</option><option value="form">Form URL encoded</option><option value="multipart">Multipart form fields</option></select></label></div><div data-connection-types="rest grpc">${area('body','Request body',5)}<p class="field-hint">Use {{inputs.name}} for runtime values. JSON is required except for raw text bodies.</p></div><div data-connection-types="graphql">${area('query','GraphQL query or mutation',6)}${area('variables','Variables (JSON object)',3)}${field('operationName','Operation name (optional)')}</div><div data-connection-types="grpc">${area('proto','Protobuf definition (self-contained, no imports)',8)}${field('service','Fully qualified service','placeholder="example.Tickets"')}${field('rpcMethod','Method','placeholder="GetTicket"')}<label class="workflow-check"><input type="checkbox" name="tls" checked>Use TLS</label><p class="field-hint">Unary methods only.</p></div><label>Authentication<select name="auth"><option value="headers">None / custom headers</option><option value="bearer">Bearer token</option><option value="basic">Basic authentication</option><option value="oauth">MCP OAuth sign-in</option></select></label><div data-connection-auth="bearer">${field('token','Bearer token','type="password" autocomplete="new-password" placeholder="Blank keeps saved token"')}</div><div data-connection-auth="basic">${field('username','Username','autocomplete="off"')}${field('password','Password / API token','type="password" autocomplete="new-password" placeholder="Blank keeps saved credentials"')}</div>${area('headers','Headers / gRPC metadata (secret JSON object)',3)}<p class="field-hint">Credentials are encrypted. Changing endpoint, type or local command clears saved credentials. Blank headers keep saved values; {} clears them. OAuth: save, then choose Sign in.</p>${field('timeoutMs','Timeout (milliseconds)','type="number" min="1000" max="120000" value="30000" required')}<label class="workflow-check"><input type="checkbox" name="enabled" checked>Enabled for this workspace</label></div><div class="form-footer"><small id="connection-error" role="status"></small><button class="primary-button">Save connection</button></div></form></dialog><dialog id="connection-test-dialog" class="modal" aria-labelledby="connection-test-heading"><div class="modal-top"><span class="eyebrow">TEST CONNECTION</span><button type="button" class="icon-button" data-connection-test-close aria-label="Close connection test">${icon('close')}</button></div><h2 id="connection-test-heading"></h2><form id="connection-test-form"><div class="modal-fields"><div id="connection-inputs">${area('inputs','Runtime inputs (JSON object)',4)}</div><div id="connection-mcp-operation">${field('operation','MCP tool name (blank discovers tools)')}${area('arguments','Tool arguments (JSON object)',4)}</div><p class="field-hint">Run executes immediately using this connection’s credentials. Tool calls and mutations can change external data.</p></div><div class="form-footer"><button class="primary-button">Run</button></div></form><pre id="connection-result" class="connection-result" role="status" tabindex="0"></pre></dialog>`);
 const form=$('#connection-form'),testForm=$('#connection-test-form'),dialog=$('#connection-editor'),testDialog=$('#connection-test-dialog');
 const value=name=>form.elements[name].value;
 function visibility(){
  const type=value('type'),local=type==='mcp'&&value('transport')==='stdio';
  dialog.querySelectorAll('[data-connection-types]').forEach(node=>node.hidden=!node.dataset.connectionTypes.split(' ').includes(type));
  dialog.querySelector('[data-connection-local]').hidden=!local;dialog.querySelector('[data-connection-remote]').hidden=local;
  form.elements.auth.querySelector('[value="oauth"]').disabled=type!=='mcp'||local;
  if((type!=='mcp'||local)&&value('auth')==='oauth')form.elements.auth.value='headers';
  dialog.querySelectorAll('[data-connection-auth]').forEach(node=>node.hidden=node.dataset.connectionAuth!==value('auth'));
 }
 form.onchange=visibility;
 function open(connection){
  editing=connection||null;form.reset();$('#connection-error').textContent='';$('#connection-heading').textContent=connection?'Edit connection':'New connection';
  const defaults={...connection,httpMethod:connection?.type==='rest'?connection.method:'GET',rpcMethod:connection?.type==='grpc'?connection.method:'',body:connection?.body===undefined?'':typeof connection.body==='string'?connection.body:JSON.stringify(connection.body,null,2),variables:JSON.stringify(connection?.variables||{},null,2),args:JSON.stringify(connection?.args||[],null,2),auth:connection?.oauth?'oauth':'headers'};
  for(const [name,item]of Object.entries(defaults)){const node=form.elements[name];if(node&&item!==undefined){if(node.type==='checkbox')node.checked=item;else node.value=item;}}
  visibility();dialog.showModal();form.elements.name.focus();
 }
 const json=(text,fallback)=>text.trim()?JSON.parse(text):fallback;
 form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;busy=true;const button=form.querySelector('button');button.disabled=true;
  try{
   const type=value('type'),input={name:value('name'),type,url:value('url'),timeoutMs:Number(value('timeoutMs')),enabled:form.elements.enabled.checked};
   if(value('headers').trim())input.headers=json(value('headers'),{});
   if(value('auth')==='bearer'&&value('token'))input.token=value('token');
   if(value('auth')==='basic'&&value('password'))input.headers={...(input.headers||{}),Authorization:'Basic '+btoa(String.fromCharCode(...new TextEncoder().encode(value('username')+':'+value('password'))))};
   if(type==='rest'){input.method=value('httpMethod');input.bodyType=value('bodyType');if(value('body').trim())input.body=input.bodyType==='text'?value('body'):json(value('body'),{});}
   if(type==='graphql')Object.assign(input,{query:value('query'),variables:json(value('variables'),{}),operationName:value('operationName')});
   if(type==='grpc')Object.assign(input,{proto:value('proto'),service:value('service'),method:value('rpcMethod'),body:json(value('body'),{}),tls:form.elements.tls.checked});
   if(type==='mcp'){Object.assign(input,{transport:value('transport'),oauth:value('auth')==='oauth'});if(input.transport==='stdio'){input.url='';input.command=value('command');input.args=json(value('args'),[]);if(value('env').trim())input.env=json(value('env'),{});}}
   await api('/api/connections'+(editing?'/'+editing.id:''),input,editing?'PUT':'POST');dialog.close();await refresh();toast('Connection saved.');
  }catch(error){$('#connection-error').textContent=error.message;}finally{busy=false;button.disabled=false;}
 };
 for(const [node,close]of [[dialog,'[data-connection-close]'],[testDialog,'[data-connection-test-close]']]){
  node.querySelector(close).onclick=()=>{if(!busy)node.close();};node.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 }
 testForm.onsubmit=async event=>{
  event.preventDefault();if(busy)return;busy=true;const button=testForm.querySelector('button');button.disabled=true;$('#connection-result').textContent='Running…';
  try{const result=await api('/api/connections/'+testing.id+'/test',{inputs:json(testForm.elements.inputs.value,{}),operation:testForm.elements.operation.value.trim()||undefined,arguments:json(testForm.elements.arguments.value,{})});$('#connection-result').textContent=JSON.stringify(result,null,2);}
  catch(error){$('#connection-result').textContent=error.message;}finally{busy=false;button.disabled=false;}
 };
 document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button||busy)return;
  if(button.id==='connection-new'){open();return;}
  const id=button.dataset.connectionEdit||button.dataset.connectionDelete||button.dataset.connectionTest||button.dataset.connectionAuthorize;
  const connection=getState()?.connections?.find(row=>row.id===id);if(!connection)return;
  if(button.dataset.connectionEdit){open(connection);return;}
  if(button.dataset.connectionTest){testing=connection;testForm.reset();testForm.elements.inputs.value=testForm.elements.arguments.value='{}';$('#connection-inputs').hidden=connection.type==='mcp';$('#connection-mcp-operation').hidden=connection.type!=='mcp';$('#connection-test-heading').textContent=connection.name;$('#connection-result').textContent='';testDialog.showModal();return;}
  try{
   if(button.dataset.connectionAuthorize){busy=true;button.disabled=true;const result=await api('/api/connections/'+id+'/authorize',{});if(result.authorizationUrl)location.assign(result.authorizationUrl);else{await refresh();toast('MCP connected.');}}
   if(button.dataset.connectionDelete&&confirm(`Delete “${connection.name}”? Skills and workflows using it will need another connection.`)){busy=true;await api('/api/connections/'+id,{},'DELETE');await refresh();toast('Connection deleted.');}
  }catch(error){handleError(error);}finally{busy=false;button.disabled=false;}
 });
}
