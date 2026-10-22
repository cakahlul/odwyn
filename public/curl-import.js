// Parse a supported cURL command as data; never invoke a shell or read files.
function words(source){
 const result=[];let word='',quote='',started=false;
 for(let i=0;i<source.length;i++){
  const char=source[i];
  if(quote==="'"){if(char===quote)quote='';else word+=char;continue;}
  if(char==='\\'){
   const next=source[++i];if(next===undefined)throw Error('Finish the trailing escape.');
   if(next==='\n')continue;
   if(quote==='"'&&!['"','\\','$','`'].includes(next))word+='\\';
   word+=next;started=true;continue;
  }
  if(char==='$'||char==='`')throw Error('Replace shell variables and substitutions with literal values before importing.');
  if(quote==='"'){if(char==='"')quote='';else word+=char;continue;}
  if(char==='"'||char==="'"){quote=char;started=true;continue;}
  if(/[;&|<>]/.test(char))throw Error('Quote URL/body values and import one cURL command without shell operators.');
  if(/\s/.test(char)){if(started){result.push(word);word='';started=false;}}
  else{word+=char;started=true;}
 }
 if(quote)throw Error('Close the quoted value before importing.');
 if(started)result.push(word);
 return result;
}
const encode=value=>encodeURIComponent(value).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
export function importCurl(source){
 if(typeof source!=='string'||!source.trim()||source.length>80000)throw Error('Paste a cURL command under 80 KB.');
 const tokens=words(source.replace(/\r\n/g,'\n'));
 if(!['curl','curl.exe'].includes(tokens.shift()))throw Error('Start with curl. Use the Bash/POSIX copy format.');
 const headers={},data=[],form={},warnings=[];let url,method,get=false,head=false,json=false,multipart=false,basic,cookie,timeoutMs=30000,globoff=false;
 const aliases={'-X':'--request','-H':'--header','-d':'--data','-u':'--user','-b':'--cookie','-A':'--user-agent','-e':'--referer','-F':'--form','-m':'--max-time'};
 function setHeader(name,value){
  const key=name.toLowerCase();
  if(!/^[!#$%&'*+.^_`|~\w-]+$/.test(key)||/[\r\n\0]/.test(value))throw Error('Use valid HTTP headers.');
  if(Object.hasOwn(headers,key))throw Error('Repeated headers are not supported; combine them before importing.');
  headers[key]=value;
 }
 function setUrl(value){if(url!==undefined)throw Error('Import one URL at a time.');url=value;}
 for(let i=0;i<tokens.length;i++){
  let flag=tokens[i],attached;
  if(flag==='--'){for(const value of tokens.slice(i+1))setUrl(value);break;}
  if(!flag.startsWith('-')){setUrl(flag);continue;}
  if(flag.startsWith('--')&&flag.includes('=')){const at=flag.indexOf('=');attached=flag.slice(at+1);flag=flag.slice(0,at);}
  else if(flag.length>2&&aliases[flag.slice(0,2)]){attached=flag.slice(2);flag=flag.slice(0,2);}
  flag=aliases[flag]||flag;
  if(['-L','--location'].includes(flag)){warnings.push('Redirect following is not supported. Test will use the saved URL and reject redirects.');continue;}
  if(['-G','--get'].includes(flag)){get=true;continue;}
  if(['-I','--head'].includes(flag)){head=true;continue;}
  if(['-g','--globoff'].includes(flag)){globoff=true;continue;}
  if(['--compressed','--silent','--show-error','--verbose','--include','--show-headers','--no-progress-meter','--basic'].includes(flag)||/^-[sSvi]+$/.test(flag))continue;
  if(!['--url','--request','--header','--data','--data-ascii','--data-raw','--data-binary','--data-urlencode','--json','--user','--cookie','--user-agent','--referer','--form','--form-string','--max-time','--oauth2-bearer'].includes(flag))throw Error('Unsupported cURL option: '+flag.split('=')[0]);
  const value=attached??tokens[++i];if(value===undefined)throw Error('Missing value for '+flag+'.');
  if(flag==='--url')setUrl(value);
  else if(flag==='--request')method=value;
  else if(flag==='--header'){
   const colon=value.indexOf(':');if(colon<1)throw Error('Use inline headers in Name: value format.');
   if(!value.slice(colon+1).trim())throw Error('Empty or suppressed headers are not supported.');
   setHeader(value.slice(0,colon),value.slice(colon+1).trim());
  }else if(flag==='--user'){if(basic!==undefined||!value.includes(':'))throw Error('Supply one username:password value.');basic=value;}
  else if(flag==='--cookie'){if(cookie!==undefined||!value.includes('='))throw Error('Supply inline cookies, not a cookie file.');cookie=value;}
  else if(flag==='--user-agent')setHeader('user-agent',value);
  else if(flag==='--referer')setHeader('referer',value);
  else if(flag==='--oauth2-bearer')setHeader('authorization','Bearer '+value);
  else if(flag==='--max-time'){timeoutMs=Number(value)*1000;if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)throw Error('Use --max-time between 1 and 120 seconds.');}
  else if(['--form','--form-string'].includes(flag)){
   const equal=value.indexOf('=');if(equal<1)throw Error('Use form fields in name=value format.');
   const name=value.slice(0,equal),content=value.slice(equal+1);
   if(flag==='--form'&&(/^[@<]/.test(content)||/[;"\\]/.test(content)))throw Error('Multipart files and field options are not supported. Use plain text fields.');
   if(Object.hasOwn(form,name)||['__proto__','constructor','prototype'].includes(name))throw Error('Use distinct, safe form field names.');
   form[name]=content;multipart=true;
  }else{
   if(flag!=='--data-raw'&&value.startsWith('@'))throw Error('File and stdin payloads are not supported. Paste inline data.');
   if(flag==='--json'){if(data.length&&!json)throw Error('Do not mix --json with other data flags.');json=true;}
   else if(json)throw Error('Do not mix --json with other data flags.');
   if(flag==='--data-urlencode'){
    const equal=value.indexOf('=');if(equal<0&&value.includes('@'))throw Error('File payloads are not supported.');
    data.push(equal>0?value.slice(0,equal+1)+encode(value.slice(equal+1)):encode(equal===0?value.slice(1):value));
   }else data.push(value);
  }
 }
 if(!url)throw Error('Add an HTTP(S) URL.');
 let parsed;try{parsed=new URL(url);}catch{throw Error('Use a complete HTTP(S) URL.');}
 if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.hash)throw Error('Use an HTTP(S) URL without embedded credentials or fragments.');
 if(!globoff&&/[{}\[\]]/.test(parsed.pathname+parsed.search))throw Error('URL globbing is not supported. Use one URL or --globoff for literal brackets.');
 if(multipart&&(data.length||get||head))throw Error('Do not combine multipart fields with data, --get or --head.');
 if(basic!==undefined)setHeader('authorization','Basic '+btoa(String.fromCharCode(...new TextEncoder().encode(basic))));
 if(cookie!==undefined)setHeader('cookie',cookie);
 let body=data.join(json?'':'&'),bodyType=multipart?'multipart':'text';
 if(get&&data.length){parsed.search+=(parsed.search?'&':'?')+body;body=undefined;}
 method=method||(head?'HEAD':get?'GET':data.length||multipart?'POST':'GET');
 if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method))throw Error('Choose a supported HTTP method.');
 if(['GET','HEAD'].includes(method)&&!get&&data.length)throw Error('GET/HEAD bodies are not supported. Use --get for query parameters.');
 if(['GET','HEAD'].includes(method)&&multipart)throw Error('GET/HEAD multipart bodies are not supported.');
 if(json){headers['content-type']??='application/json';headers.accept??='application/json';}
 else if(data.length&&!get)headers['content-type']??='application/x-www-form-urlencoded';
 if(multipart&&headers['content-type'])throw Error('Remove the multipart Content-Type header so its boundary can be generated.');
 // The runtime constructs framing for the imported body and URL.
 if(headers.host||headers['content-length']||headers['transfer-encoding'])throw Error('Remove Host, Content-Length and Transfer-Encoding headers before importing.');
 const connection={name:(method+' '+parsed.hostname+parsed.pathname).slice(0,80),type:'rest',url:parsed.href,method,headers,bodyType,timeoutMs,enabled:true};
 if(multipart)connection.body=form;else if(data.length&&!get)connection.body=body;
 return {connection,warnings:[...new Set(warnings)]};
}
