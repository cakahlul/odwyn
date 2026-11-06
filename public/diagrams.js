let renderer,ready;
const pending=new Map(),cache=new Map();

function diagramImage(source){
  if(cache.has(source))return cache.get(source);
  if(!ready){
    renderer=document.createElement('iframe');renderer.className='diagram-renderer';renderer.setAttribute('aria-hidden','true');renderer.tabIndex=-1;
    renderer.sandbox='allow-scripts';renderer.src='/diagram.html';renderer.title='Diagram renderer';
    ready=new Promise((resolve,reject)=>{renderer.onload=resolve;renderer.onerror=()=>reject(Error('Renderer unavailable'));});
    addEventListener('message',event=>{
      if(event.source!==renderer.contentWindow)return;
      const request=pending.get(event.data?.id);if(!request)return;
      pending.delete(event.data.id);clearTimeout(request.timer);
      if(typeof event.data.svg==='string')request.resolve('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(event.data.svg));
      else request.reject(Error('Invalid diagram'));
    });
    document.body.append(renderer);
  }
  const result=new Promise((resolve,reject)=>{
    const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('Diagram timed out'));},15000);
    pending.set(id,{resolve,reject,timer});
    // Sandboxed origins require '*'; replies are accepted only from this frame.
    ready.then(()=>renderer.contentWindow.postMessage({id,source},'*')).catch(()=>{pending.delete(id);clearTimeout(timer);reject(Error('Renderer unavailable'));});
  });
  cache.set(source,result);if(cache.size>40)cache.delete(cache.keys().next().value);
  return result;
}

export function renderDiagram(wrapper,block,source){
  wrapper.classList.add('diagram-block');
  const status=document.createElement('p');status.className='diagram-status';status.role='status';status.textContent='Rendering diagram…';
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Diagram source';details.append(summary,block);
  wrapper.append(status,details);
  diagramImage(source).then(url=>{
    const image=document.createElement('img');image.className='diagram-image';image.alt='Diagram; text description available in Diagram source.';image.src=url;
    status.replaceWith(image);
    const expand=document.createElement('button');expand.type='button';expand.className='text-button';expand.textContent='Expand';expand.setAttribute('aria-label','Expand diagram');
    expand.onclick=()=>{
      const dialog=document.createElement('dialog');dialog.className='diagram-preview';dialog.setAttribute('aria-label','Expanded diagram');
      const close=document.createElement('button');close.type='button';close.className='secondary-button';close.textContent='Close diagram';close.onclick=()=>dialog.close();
      const toolbar=document.createElement('header');toolbar.className='diagram-preview-toolbar';toolbar.append(close);
      const preview=image.cloneNode();preview.className='diagram-preview-image';dialog.append(toolbar,preview);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
    };
    wrapper.querySelector('.block-toolbar').prepend(expand);
    const download=document.createElement('a');download.className='text-button';download.textContent='Download SVG';download.href=url;download.download='diagram.svg';wrapper.querySelector('.block-toolbar').prepend(download);
  }).catch(()=>{status.textContent='Could not render this diagram. Its source is available below.';details.open=true;});
}
