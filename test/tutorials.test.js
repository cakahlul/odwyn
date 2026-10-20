import {test,expect,mock} from 'bun:test';

test('tutorial navigation, dismissal, replay, reset, storage failures and workspace persistence',async()=>{
 const nodes=new Map(),events={},frames=[],storage=new Map(),dialogs=[];let writesBlocked=false;
 class Node {
  constructor(id=''){this.id=id;this.dataset={};this.style={};this.children=[];this.hidden=false;this.disabled=false;this.isConnected=true;this.textContent='';}
  setAttribute(key,value){this[key]=value;}
  set innerHTML(markup){for(const [,id] of markup.matchAll(/id="([^"]+)"/g))nodes.set('#'+id,new Node(id));if(this.id==='tutorial-overlay')this.shades=Array.from({length:4},()=>new Node());}
  append(node){this.children.push(node);node.parent=this;node.isConnected=true;}
  insertBefore(node,before){const index=this.children.indexOf(before);if(index<0)this.append(node);else{this.children.splice(index,0,node);node.parent=this;node.isConnected=true;}}
  prepend(node){this.append(node);if(node.id)nodes.set('#'+node.id,node);}
  remove(){this.isConnected=false;if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  contains(node){return node===this||this.children.includes(node)||(this.id==='tutorial-overlay'&&[...nodes.values()].some(value=>value===node&&node.id.startsWith('tutorial-')));}
  querySelector(selector){return nodes.get(selector)||null;}
  querySelectorAll(selector){return selector==='.tutorial-shade'?this.shades:selector==='button:not(:disabled)'?['skip','back','next'].map(name=>nodes.get('#tutorial-'+name)).filter(node=>!node.disabled):[];}
  getClientRects(){return this.hidden?[]:[this.getBoundingClientRect()];}
  getBoundingClientRect(){return {left:20,top:40,right:280,bottom:80,width:260,height:this.id==='tutorial-card'?220:40};}
  closest(){return null;}
  matches(selector){return selector===':popover-open'?this.open===true:false;}
  showPopover(){this.open=true;}
  hidePopover(){this.open=false;}
  scrollIntoView(){}
  focus(){document.activeElement=this;}
 }
 for(const selector of ['.settings-steps','.settings-scroll','#view','#agent-workspace','#view h1','#workspace-navigation'])nodes.set(selector,new Node(selector.slice(1)));
 const original=Object.fromEntries(['document','window','localStorage','MutationObserver','requestAnimationFrame','innerWidth','innerHeight'].map(key=>[key,globalThis[key]]));
 globalThis.document={body:new Node('body'),activeElement:new Node('launch'),createElement:()=>new Node(),querySelector:selector=>nodes.get(selector)||null,querySelectorAll:selector=>selector==='dialog[open]'?dialogs:selector==='.tutorial-replay'?[...nodes.get('#agent-workspace').children].filter(node=>node.className?.includes('tutorial-replay')):[],addEventListener:(type,callback)=>events[type]=callback};
 globalThis.window={addEventListener(){}};globalThis.innerWidth=320;globalThis.innerHeight=600;
 globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(writesBlocked)throw Error('Blocked');storage.set(key,value);}};
 globalThis.MutationObserver=class{observe(){}};globalThis.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
 mock.module('../public/ui.js',()=>({$:selector=>document.querySelector(selector),storageKey:key=>key+':test-workspace'}));
 const flush=()=>{while(frames.length)frames.shift()();},click=id=>nodes.get('#'+id).onclick();
 try{
  const {setupTutorials}=await import('../public/tutorials.js');
  let visit=setupTutorials();visit('home');flush();
  expect(nodes.get('#main-tutorial').textContent).toBe('?');
  expect(nodes.get('#tutorial-progress').textContent).toBe('Home · 1 / 2');expect(nodes.get('#tutorial-back').disabled).toBe(true);
  click('tutorial-next');expect(nodes.get('#tutorial-progress').textContent).toBe('Home · 2 / 2');expect(nodes.get('#tutorial-next').textContent).toBe('Finish');
  click('tutorial-back');expect(nodes.get('#tutorial-progress').textContent).toBe('Home · 1 / 2');
  events.keydown({key:'Escape',preventDefault(){},stopImmediatePropagation(){}});
  expect(JSON.parse(storage.get('odwyn-tutorials:test-workspace')).seen).toEqual(['home']);
  visit=setupTutorials();visit('home');flush();expect(nodes.get('#tutorial-progress').textContent).toBe('');
  click('main-tutorial');expect(nodes.get('#tutorial-progress').textContent).toBe('Home · 1 / 2');click('tutorial-skip');
  nodes.get('#tutorial-hide').onchange({target:{checked:true}});click('tutorial-reset');
  expect(JSON.parse(storage.get('odwyn-tutorials:test-workspace'))).toEqual({hidden:true,seen:[]});
  visit=setupTutorials();visit('home');flush();expect(nodes.get('#tutorial-hide').checked).toBe(true);expect(nodes.get('#tutorial-progress').textContent).toBe('');
  click('main-tutorial');expect(nodes.get('#tutorial-progress').textContent).toBe('Home · 1 / 2');click('tutorial-skip');
  nodes.get('#tutorial-hide').onchange({target:{checked:false}});click('tutorial-reset');
  writesBlocked=true;click('tutorial-reset');expect(nodes.get('#tutorial-settings-status').textContent).toContain('could not be saved');
 }finally{for(const [key,value] of Object.entries(original))if(value===undefined)delete globalThis[key];else globalThis[key]=value;mock.restore();}
});
