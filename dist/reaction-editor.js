'use strict';

const editorParams = new URLSearchParams(location.search);
let reactionId = editorParams.get('reaction');

async function loadReactionStructure() {
 const reaction = await ReactionStore.read(reactionId);
 const slot = editorParams.get('slot');
 if (!reaction || !['START','FINISH'].includes(slot) || !reaction[slot]) {
  throw Error('指定した反応構造は見つかりません。');
 }
 return {...reaction[slot],name:reaction.name+'_'+slot};
}

$('saveReaction').onclick = async () => {
 if (!atoms.length) return;
 try {
  const reactions = (await ReactionStore.read()).sort((a,b)=>b.createdAt-a.createdAt);
  const destination = $('reactionDestination');
  destination.replaceChildren(new Option('新しい反応',''),...reactions.map(r=>new Option(r.name+' · '+new Date(r.createdAt).toLocaleString('ja-JP'),r.id)));
  destination.value = reactions.some(r=>r.id===reactionId) ? reactionId : '';
  $('reactionSlot').value = destination.value ? 'FINISH' : 'START';
  $('reactionError').textContent = '';
  $('reactionSaveDialog').showModal();
 } catch (error) { notice(error.message); }
};
$('reactionCancel').onclick = () => $('reactionSaveDialog').close();
$('reactionSaveForm').onsubmit = async event => {
 event.preventDefault();
 const button = $('reactionCommit');
 if (button.disabled || !atoms.length) return;
 button.disabled = true;
 try {
  const id = $('reactionDestination').value, slot = $('reactionSlot').value;
  const structure = editedRecord(slot);
  const previous = id ? await ReactionStore.read(id) : null;
  if (previous?.[slot] && !confirm(previous.name+'_'+slot+' を上書きしますか？')) return;
  const saved = id ? await ReactionStore.update(id,{[slot]:structure}) : await ReactionStore.create(slot,structure);
  reactionId = saved.id;
  $('reactionSaveDialog').close();
  notice(saved.name+'_'+slot+' を反応ライブラリに保存しました。');
 } catch (error) { $('reactionError').textContent = error.message; }
 finally { button.disabled = false; }
};
