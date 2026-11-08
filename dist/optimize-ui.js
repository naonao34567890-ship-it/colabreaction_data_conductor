'use strict';

{
  const dialog = $('optDialog');
  const progress = $('optProgress');
  const status = $('optStatus');
  const inputs = [$('optCharge'), $('optMultiplicity'), $('optSteps')];
  const elements = Object.keys(Mol.elements);
  let worker = null;
  let before = null;
  let preview = null;
  let showingPreview = false;

  function showStructure(usePreview) {
    showingPreview = usePreview;
    atoms = usePreview ? preview : before.atoms;
    $('optCompare').textContent = usePreview ? '元の構造を表示' : '最適化後を表示';
    dirty = true;
  }

  function stopWorker() {
    worker?.terminate();
    worker = null;
    progress.hidden = true;
    $('optClose').textContent = '閉じる';
    for (const input of inputs) input.disabled = false;
    $('optRun').hidden = false;
  }

  function reset() {
    stopWorker();
    if (preview && showingPreview) showStructure(false);
    preview = null;
    $('optApply').hidden = $('optCompare').hidden = true;
  }

  $('optimize').onclick = () => {
    if (atoms.length < 2) return;
    finishKeys();
    finishRotation();
    status.textContent = '初回の計算開始時に約29 MBの計算エンジンを読み込みます。';
    $('optTarget').textContent = selected.size
      ? `選択した ${selected.size} 原子を独立した系として最適化します。`
      : `全 ${atoms.length} 原子を最適化します。`;
    dialog.showModal();
  };
  $('optClose').onclick = () => dialog.close();
  dialog.addEventListener('close', reset);
  $('optCompare').onclick = () => showStructure(!showingPreview);
  $('optApply').onclick = () => {
    if (!preview) return;
    const optimized = preview;
    reset();
    atoms = optimized;
    dirty = true;
    push(before);
    dialog.close();
    notice('最適化した座標を適用しました。Undoで戻せます。');
  };

  $('optForm').onsubmit = event => {
    event.preventDefault();
    if (worker || preview) return;
    const [charge, multiplicity, maxCycles] = inputs.map(input => input.valueAsNumber);
    const indices = selected.size ? [...selected].sort((a, b) => a - b) : atoms.map((_, i) => i);
    const target = indices.map(i => atoms[i]);
    if (target.length < 2) {
      status.textContent = '最適化する原子を2個以上選択してください。';
      return;
    }
    const unsupported = target.find(atom => elements.indexOf(atom.el) < 0 ||
      elements.indexOf(atom.el) >= 86);
    const electrons = target.reduce((total, atom) => total + elements.indexOf(atom.el) + 1, -charge);
    if (unsupported) {
      status.textContent = 'GFN2-xTBの対応範囲はH〜Rnです。対象外の元素：' + unsupported.el;
      return;
    }
    if (electrons < multiplicity || (electrons - multiplicity + 1) % 2 !== 0) {
      status.textContent = '電子数とスピン多重度が合いません。全電荷と多重度を確認してください。';
      return;
    }
    if (target.length > 200) {
      status.textContent = 'ブラウザでの計算上限は200原子です。';
      return;
    }

    before = snapshot();
    const geometry = {
      elements: target.map(atom => atom.el),
      coordinates: Float64Array.from(target.flatMap(({x, y, z}) => [x, y, z])),
    };
    try {
      worker = new Worker('optimize-worker.js', {type: 'module'});
      worker.onerror = event => {
        stopWorker();
        status.textContent = '計算エンジンを実行できませんでした。' + (event.message || '');
      };
      worker.onmessage = ({data}) => {
        if (data.type === 'ready') {
          status.textContent = '初期構造を評価中…';
        } else if (data.type === 'cycle') {
          progress.value = data.cycle;
          status.textContent = `ステップ ${data.cycle} / ${maxCycles} · ${data.energy.toFixed(6)} Eh`;
        } else if (data.type === 'error') {
          stopWorker();
          status.textContent = '計算失敗：' + data.message;
        } else if (data.type === 'result') {
          stopWorker();
          const {coordinates, energy, converged, cycles} = data.result;
          preview = before.atoms.slice();
          indices.forEach((index, i) => {
            preview[index] = {
              ...before.atoms[index],
              x: coordinates[3*i], y: coordinates[3*i+1], z: coordinates[3*i+2],
            };
          });
          showStructure(true);
          status.textContent = `${converged ? '収束' : '未収束の最終構造'} · ${cycles} ステップ · ${energy.total.toFixed(6)} Eh`
            + (multiplicity > 1 ? '。開殻はOCCのスピン分極モデルです。' : '');
          $('optRun').hidden = true;
          $('optCompare').hidden = $('optApply').hidden = false;
          $('optApply').textContent = converged ? '座標を適用' : '未収束の座標を適用';
          $('optClose').textContent = '結果を破棄';
        }
      };
      for (const input of inputs) input.disabled = true;
      $('optRun').hidden = true;
      $('optClose').textContent = '計算を中止';
      progress.hidden = false;
      progress.max = maxCycles;
      progress.value = 0;
      status.textContent = '計算エンジンを読み込み中…';
      worker.postMessage({geometry, anchor: indices.indexOf(before.point), settings: {charge, unpairedElectrons: multiplicity - 1, maxCycles}});
    } catch (error) {
      stopWorker();
      status.textContent = '計算を開始できませんでした：' + error.message;
    }
  };
}
