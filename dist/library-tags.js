'use strict';

{
 const dialog=$('tagDialog'), list=$('tagList'), form=$('tagForm'), input=$('tagName');
 const status=$('tagStatus');
 let targets=[], deletingTags=false, busy=false, tags=[];

 async function transact(mode, run) {
  const db=await Mol.db();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(['tags','meta'],mode);
   const catalog=tx.objectStore('tags'), meta=tx.objectStore('meta');
   let result, failure;
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(failure||tx.error||Error('タグの処理を完了できませんでした。'));
   run(catalog,meta,value=>{result=value;},message=>{failure=Error(message);tx.abort();});
  });
 }

 async function readTags() {
  return transact('readonly',(catalog,meta,done)=>{
   const request=catalog.getAllKeys();
   request.onsuccess=()=>{
    const entries=request.result.sort(Mol.compareTagNames).map(name=>({name,count:0}));
    for(const tag of entries){
     const usage=meta.index('tags').count(tag.name);
     usage.onsuccess=()=>{tag.count=usage.result;};
    }
    done(entries);
   };
  });
 }

 function renderTags() {
  list.replaceChildren();
  if(!tags.length)list.textContent='タグはまだありません。';
  for(const {name,count} of tags){
   const entry=document.createElement('div');
   entry.className='tag-entry';
   if(deletingTags){
    const remove=document.createElement('button');
    remove.type='button';
    remove.textContent='×';
    remove.className='danger';
    remove.setAttribute('aria-label',name+'を削除');
    remove.title=count?count+' 件で使用中':'タグを削除';
    remove.disabled=busy||count>0;
    remove.onclick=()=>mutate(async()=>{
     await transact('readwrite',(catalog,meta,done,abort)=>{
      const usage=meta.index('tags').count(name);
      usage.onsuccess=()=>{
       if(usage.result)abort('使用中のタグは削除できません。');
       else catalog.delete(name);
      };
     });
     Mol.notify({type:'tag-catalog'});
     await refreshTags();
    });
    entry.append(remove);
   }
   const button=document.createElement('button');
   button.type='button';
   button.className='tag-choice';
   button.textContent=name;
   button.title=name;
   button.disabled=busy;
   button.onclick=()=>mutate(async()=>{
    const updated=await transact('readwrite',(catalog,meta,done,abort)=>{
     const exists=catalog.getKey(name);
     exists.onsuccess=()=>{
      if(exists.result===undefined){abort('このタグは削除されています。');return;}
      const items=[];
      done(items);
      for(const id of targets){
       const request=meta.get(id);
       request.onsuccess=()=>{
        const item=request.result;
        if(!item)return;
        item.tags=[...new Set([...(item.tags||[]),name])].sort(Mol.compareTagNames);
        meta.put(item);
        items.push(item);
       };
      }
     };
    });
    const change={type:'tags-updated',items:updated};
    applyChange(change);
    Mol.notify(change);
    dialog.close();
    notice(updated.length+' 件に「'+name+'」を付けました。');
   });
   entry.append(button);
   list.append(entry);
  }
  $('tagCreate').disabled=busy||!input.value.trim();
  $('tagNew').disabled=$('tagDelete').disabled=$('tagCancel').disabled=busy;
 }

 async function refreshTags() {
  tags=await readTags();
  renderTags();
 }

 async function mutate(action) {
  if(busy)return;
  busy=true;
  renderTags();
  try{await action();}
  catch(error){
   try{await refreshTags();}catch{}
   status.textContent=error.message;
  }finally{busy=false;renderTags();}
 }

 $('tagSelected').onclick=()=>{
  targets=[...selected].filter(id=>metaMap.has(id)&&!metaMap.get(id).builtin);
  if(!targets.length)return;
  deletingTags=false;
  $('tagDelete').setAttribute('aria-pressed','false');
  $('tagDelete').textContent='タグの削除';
  form.hidden=true;
  input.value='';
  tags=[];
  status.textContent=targets.length+' 件の分子に付けるタグを選んでください。';
  dialog.showModal();
  void mutate(refreshTags);
 };
 $('tagNew').onclick=()=>{form.hidden=false;input.focus();};
 $('tagDelete').onclick=()=>{
  deletingTags=!deletingTags;
  $('tagDelete').setAttribute('aria-pressed',String(deletingTags));
  $('tagDelete').textContent=deletingTags?'削除モードを終了':'タグの削除';
  void mutate(refreshTags);
 };
 $('tagCancel').onclick=()=>dialog.close();
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 input.oninput=()=>{$('tagCreate').disabled=busy||!input.value.trim();};
 form.onsubmit=event=>{
  event.preventDefault();
  const name=input.value.trim();
  if(!name)return;
  void mutate(async()=>{
   if(tags.some(tag=>tag.name===name))throw Error('同じ名前のタグがあります。');
   await transact('readwrite',catalog=>catalog.add({name}));
   input.value='';
   form.hidden=true;
   status.textContent='「'+name+'」を作成しました。タグを選ぶと付与できます。';
   Mol.notify({type:'tag-catalog'});
   await refreshTags();
  });
 };
 channel.addEventListener('message',({data})=>{
  if(dialog.open&&!busy&&['tags-updated','tag-catalog','deleted'].includes(data.type))void mutate(refreshTags);
 });
}
