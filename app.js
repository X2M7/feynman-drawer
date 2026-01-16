class FeynmanDrawer {
  constructor() {
    this.canvas = null;

    // localization
    this.lang = 'zh';
    this.i18n = {};

    // tool state
    this.uiTool = 'select';
    this.tool = 'select';
    this.spaceHandActive = false;

    // draw state
    this.isDrawing = false;
    this.drawStart = null;
    this.lastPointer = null;
    this.tempObj = null;
    this.tempCurveCtrl = null;
    this.drawPrevSelection = null;
    this.drawPrevTargetFind = null;

    // view state
    this.zoomLevel = 1;

    // panning state
    this.isPanning = false;
    this.panLastClient = null;

    // touch/pinch state
    this.recentTouch = false;
    this.recentTouchTimer = null;

    this.isPinching = false;
    this.pinchStartDist = 0;
    this.pinchStartZoom = 1;
    this.pinchLastCenterClient = null;

    // labels (KaTeX DOM overlay)
    this.labels = []; // {id,x,y,tex,el}
    this.labelId = 0;
    this.labelLayer = null;
    this.selectedLabelId = null;
    this.lastLineSelectionId = null;
    this.objectId = 0;
    this.curveHandles = { start: null, end: null, ctrl: null };

    // TikZ editor
    this.tikzEditor = null;
    this.isSyncingEditor = false;
    this.editorDirty = false;
    this.lastGeneratedTikZ = '';

    // history
    this.history = [];
    this.historyIndex = -1;
    this.historyTimer = null;

    this.initLocalization();
    this.init();
  }

  // -------------------- Localization --------------------
  initLocalization() {
    const raw = (document.documentElement.lang || 'zh').toLowerCase();
    this.lang = raw.startsWith('en') ? 'en' : 'zh';
    this.i18n = {
      zh: {
        toolPrefix: '工具:',
        zoomPrefix: '缩放:',
        helpText:
`基本操作：
- 点/直线/曲线/椭圆/标签工具绘制元素
- 选中曲线后可拖动控制点调整形状
- 选中标签可绑定到线的起点/中点/终点并调偏移

平移缩放：
- Hand 工具拖拽平移；Space 临时 Hand
- 滚轮默认平移；Ctrl/⌘滚轮缩放
- 触控：双指平移/缩放`,
        katexNotReady: 'KaTeX 未加载完成，请稍等刷新后再试。',
        labelPrompt: '请输入标签（KaTeX/LaTeX）：例如 e^- 或 \\gamma 或 \\frac{1}{2}',
        labelDefault: '\\gamma',
        editLabelPrompt: '修改标签内容：',
        tikzParseFail: 'TikZ 解析失败：请保持在支持的子集语法内。',
        saveLoadNotImplemented: '保存/打开：当前版本未实现（可继续扩展）。',
        applyTitle: 'Apply：应用右侧 TikZ 到预览（Ctrl/⌘+Enter）',
        clearCanvasTitle: '清空画布（并重置右侧代码为默认）',
        clearConfirm: '确定要清空画布吗？',
        toolNames: {
          select: '选择',
          hand: '拖动',
          delete: '删除',
          point: '点',
          line: '直线',
          curve: '曲线',
          ellipse: '椭圆',
          label: '标签'
        }
      },
      en: {
        toolPrefix: 'Tool:',
        zoomPrefix: 'Zoom:',
        helpText:
`Basics:
- Use Point/Line/Curve/Ellipse/Label to draw
- Select a curve to drag control points
- Select a label to bind to line start/mid/end and adjust offsets

Pan & zoom:
- Hand tool to pan; hold Space for temporary hand
- Wheel pans; Ctrl/⌘ + wheel zooms
- Touch: two-finger pan/zoom`,
        katexNotReady: 'KaTeX is not ready yet. Please refresh and try again.',
        labelPrompt: 'Enter a label (KaTeX/LaTeX), e.g. e^- or \\gamma or \\frac{1}{2}',
        labelDefault: '\\gamma',
        editLabelPrompt: 'Edit label:',
        tikzParseFail: 'TikZ parse failed. Please keep to the supported subset.',
        saveLoadNotImplemented: 'Save/Load: not implemented in this version (can be extended).',
        applyTitle: 'Apply: apply TikZ to preview (Ctrl/⌘+Enter)',
        clearCanvasTitle: 'Clear canvas (and reset editor to default)',
        clearConfirm: 'Clear the canvas?',
        toolNames: {
          select: 'Select',
          hand: 'Pan',
          delete: 'Delete',
          point: 'Point',
          line: 'Line',
          curve: 'Curve',
          ellipse: 'Ellipse',
          label: 'Label'
        }
      }
    };
  }

  t(key) {
    const langPack = this.i18n[this.lang] || this.i18n.zh || {};
    if (key in langPack) return langPack[key];
    const fallback = this.i18n.zh || {};
    return key in fallback ? fallback[key] : '';
  }

  init() {
    this.initCanvas();
    this.labelLayer = document.getElementById('labelLayer');
    this.tikzEditor = document.getElementById('tikzEditor');

    this.bindEvents();
    this.handleResize();

    // initial editor content
    this.generateTikZCode({ forceWriteEditor: true });

    this.applyToolMode();
    this.pushHistoryDebounced('init');
    this.updateZoomLabel();
  }

  // -------------------- Canvas init --------------------
  initCanvas() {
    this.canvas = new fabric.Canvas('feynmanCanvas', {
      backgroundColor: '#ffffff',
      selection: true,
      preserveObjectStacking: true
    });

    // Use Ctrl as multi-select modifier key
    this.canvas.selectionKey = 'ctrlKey';

    fabric.Object.prototype.set({
      borderColor: '#3f51b5',
      cornerColor: '#3f51b5',
      cornerSize: 8,
      transparentCorners: false,
      cornerStyle: 'circle'
    });

    this.canvas.enableRetinaScaling = true;

    // Keep DOM labels synced with viewport
    this.canvas.on('after:render', () => this.renderAllLabels());
  }

  // -------------------- Event binding --------------------
  bindEvents() {
    // tools
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');

        this.uiTool = e.currentTarget.dataset.tool;

        if (!this.spaceHandActive) {
          this.tool = this.uiTool;
          this.applyToolMode();
        }
        this.updateStatusTool();

        // If user clicked delete tool and there is a selection -> delete immediately
        if (this.tool === 'delete') {
          this.deleteSelected();
        }
      });
    });

    // fabric pointer
    this.canvas.on('mouse:down', (opt) => this.onMouseDown(opt));
    this.canvas.on('mouse:move', (opt) => this.onMouseMove(opt));
    this.canvas.on('mouse:up', () => this.onMouseUp());
    this.canvas.on('mouse:wheel', (opt) => this.onMouseWheel(opt));

    // object changes -> tikz + history
    const onCanvasChanged = (opt) => {
      if (opt && opt.target && opt.target.data && opt.target.data.kind === 'control') return;
      this.generateTikZCode({ forceWriteEditor: false });
      this.pushHistoryDebounced('canvas');
    };
    this.canvas.on('object:added', onCanvasChanged);
    this.canvas.on('object:modified', (opt) => {
      this.onObjectModified(opt.target);
      onCanvasChanged();
    });
    this.canvas.on('object:removed', onCanvasChanged);
    this.canvas.on('object:moving', (opt) => this.onObjectMoving(opt.target));
    this.canvas.on('selection:created', (opt) => this.onSelectionChanged(opt.selected));
    this.canvas.on('selection:updated', (opt) => this.onSelectionChanged(opt.selected));
    this.canvas.on('selection:cleared', () => this.onSelectionCleared());

    // canvas controls
    this.safeBind('zoomInBtn', 'click', () => this.zoomAtCanvasCenter(1.2));
    this.safeBind('zoomOutBtn', 'click', () => this.zoomAtCanvasCenter(0.8));
    this.safeBind('resetViewBtn', 'click', () => this.resetView());
    this.safeBind('gridToggleBtn', 'click', () => this.toggleGrid());

    // code panel actions
    // clearCodeBtn: clear canvas (same as header clearBtn) and reset editor to default
    this.safeBind('clearCodeBtn', 'click', () => this.clearCanvas());
    this.safeBind('refreshCodeBtn', 'click', () => this.applyEditorToPreview()); // Apply
    this.safeBind('copyTikzBtn', 'click', () => this.copyTikZCode());

    // header actions
    this.safeBind('exportBtn', 'click', () => this.exportTikZ());
    this.safeBind('clearBtn', 'click', () => this.clearCanvas());
    this.safeBind('helpBtn', 'click', () => this.showHelp());
    this.safeBind('saveBtn', 'click', () => alert(this.t('saveLoadNotImplemented')));
    this.safeBind('loadBtn', 'click', () => alert(this.t('saveLoadNotImplemented')));

    // export png
    this.safeBind('exportPngBtn', 'click', () => this.exportPNG());

    // modal
    const closeBtn = document.querySelector('.close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
    this.safeBind('copyModalBtn', 'click', () => this.copyModalCode());
    this.safeBind('downloadBtn', 'click', () => this.downloadTikZ());

    // properties
    this.safeBind('lineStyle', 'change', (e) => this.updateSelectedLineStyle(e.target.value));
    this.safeBind('lineWidth', 'input', (e) => this.updateSelectedLineWidth(parseInt(e.target.value)));
    this.safeBind('lineColor', 'change', (e) => this.updateSelectedLineColor(e.target.value));
    this.safeBind('arrowStyle', 'change', (e) => this.updateSelectedArrowStyle(e.target.value));
    this.safeBind('labelBindMode', 'change', (e) => this.updateSelectedLabelBinding(e.target.value));
    this.safeBind('labelOffsetX', 'input', () => this.updateSelectedLabelOffset());
    this.safeBind('labelOffsetY', 'input', () => this.updateSelectedLabelOffset());
    this.safeBind('bindLabelBtn', 'click', () => this.bindSelectedLabelToLastLine());
    this.safeBind('unbindLabelBtn', 'click', () => this.unbindSelectedLabel());

    // editor: editable, but do not auto-apply
    if (this.tikzEditor) {
      this.tikzEditor.addEventListener('input', () => {
        if (this.isSyncingEditor) return;
        this.editorDirty = true;
      });

      // Ctrl/Cmd + Enter -> Apply
      this.tikzEditor.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          this.applyEditorToPreview();
        }
      });
    }

    // keyboard: Space hand, Delete, ESC
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    document.addEventListener('keyup', (e) => this.onKeyUp(e));

    // resize
    window.addEventListener('resize', () => this.handleResize());

    // touch events
    const el = this.canvas.upperCanvasEl;
    el.addEventListener('touchstart', (ev) => this.onTouchStart(ev), { passive: false });
    el.addEventListener('touchmove', (ev) => this.onTouchMove(ev), { passive: false });
    el.addEventListener('touchend', (ev) => this.onTouchEnd(ev), { passive: false });
    el.addEventListener('touchcancel', (ev) => this.onTouchEnd(ev), { passive: false });

    // init history panel + status
    this.updateHistoryPanel();
    this.updateStatusTool();

    // language toggle
    const langBtn = document.getElementById('langToggleBtn');
    if (langBtn) {
      langBtn.addEventListener('click', () => {
        const target = langBtn.dataset.target;
        if (target) window.location.href = target;
      });
    }

    // tooltips
    const applyBtn = document.getElementById('refreshCodeBtn');
    if (applyBtn) applyBtn.title = this.t('applyTitle');

    const clearCanvasBtn = document.getElementById('clearCodeBtn');
    if (clearCanvasBtn) clearCanvasBtn.title = this.t('clearCanvasTitle');
  }

  safeBind(id, evt, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(evt, handler);
  }

  // -------------------- Tool mode --------------------
  applyToolMode() {
    if (this.tool === 'hand') {
      this.canvas.selection = false;
      this.canvas.skipTargetFind = true;
      this.canvas.discardActiveObject();
      this.clearLabelSelection();
      this.setLabelInteractivity(false);
      this.canvas.defaultCursor = 'grab';
    } else if (['point', 'line', 'curve', 'ellipse', 'label'].includes(this.tool)) {
      this.canvas.selection = false;
      this.canvas.skipTargetFind = false;
      this.canvas.discardActiveObject();
      this.setLabelInteractivity(true);
      this.canvas.defaultCursor = this.getCursorForTool(this.tool);
    } else {
      this.canvas.selection = true;
      this.canvas.skipTargetFind = false;
      this.setLabelInteractivity(true);
      this.canvas.defaultCursor = this.getCursorForTool(this.tool);
    }
    this.updateCanvasObjectInteractivity();
    this.canvas.requestRenderAll();
  }

  setLabelInteractivity(enabled) {
    if (!this.labelLayer) return;
    this.labelLayer.classList.toggle('labels-disabled', !enabled);
  }

  updateCanvasObjectInteractivity() {
    const isDrawTool = ['point', 'line', 'curve', 'ellipse', 'label'].includes(this.tool);
    this.canvas.getObjects().forEach(obj => {
      const isControl = !!(obj && obj.data && obj.data.kind === 'control');
      if (isControl) {
        obj.set({ selectable: true, evented: true });
        return;
      }
      if (isDrawTool || this.tool === 'hand') {
        obj.set({ selectable: false, evented: false });
      } else {
        obj.set({ selectable: true, evented: true });
      }
    });
  }

  // -------------------- Keyboard --------------------
  isTypingTarget(target) {
    return !!(target && target.matches && target.matches('input, textarea, [contenteditable="true"]'));
  }

  onKeyDown(e) {
    if (e.key === 'Delete') {
      this.deleteSelected();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !this.isTypingTarget(e.target)) {
      e.preventDefault();
      this.undoHistory();
      return;
    }

    // Space temporary hand, not inside textarea/input
    if (e.code === 'Space' && !this.isTypingTarget(e.target)) {
      e.preventDefault();
      if (!this.spaceHandActive) {
        this.spaceHandActive = true;
        this.tool = 'hand';
        this.applyToolMode();
        this.updateStatusTool();
      }
    }

    if (e.key === 'Escape') {
      if (this.isPanning) this.stopPan();
      if (this.isPinching) this.stopPinch();
    }
  }

  onKeyUp(e) {
    if (e.code === 'Space' && this.spaceHandActive) {
      e.preventDefault();
      this.spaceHandActive = false;
      this.tool = this.uiTool;
      this.applyToolMode();
      this.updateStatusTool();
    }
  }

  updateStatusTool() {
    const st = document.getElementById('selectedTool');
    if (!st) return;
    st.textContent = `${this.t('toolPrefix')} ${this.getToolName(this.tool)}`;
  }

  updateZoomLabel() {
    const zl = document.getElementById('zoomLevel');
    if (!zl) return;
    const zoom = this.zoomLevel || this.canvas.getZoom() || 1;
    zl.textContent = `${this.t('zoomPrefix')} ${Math.round(zoom * 100)}%`;
  }

  // -------------------- Names/Cursors --------------------
  getToolName(tool) {
    const names = (this.i18n[this.lang] && this.i18n[this.lang].toolNames) || (this.i18n.zh && this.i18n.zh.toolNames) || {};
    return names[tool] || tool;
  }


  getCursorForTool(tool) {
    if (tool === 'label') return 'text';
    if (tool === 'delete') return 'not-allowed';
    if (tool === 'hand') return 'grab';
    if (tool === 'select') return 'default';
    return 'crosshair';
  }

  // -------------------- Ctrl/?click toggle multi-select --------------------
  ctrlToggleSelection(target) {
    if (!target) return;

    const active = this.canvas.getActiveObject();

    if (!active) {
      this.canvas.setActiveObject(target);
      this.canvas.requestRenderAll();
      return;
    }

    if (active.type === 'activeSelection') {
      const objects = active.getObjects();
      const exists = objects.includes(target);

      if (exists) {
        active.removeWithUpdate(target);
        if (active.size() === 1) this.canvas.setActiveObject(active.item(0));
        else this.canvas.setActiveObject(active);
      } else {
        active.addWithUpdate(target);
        this.canvas.setActiveObject(active);
      }

      this.canvas.requestRenderAll();
      return;
    }

    if (active !== target) {
      const sel = new fabric.ActiveSelection([active, target], { canvas: this.canvas });
      this.canvas.setActiveObject(sel);
      this.canvas.requestRenderAll();
    }
  }

  // -------------------- Selection helpers --------------------
  onSelectionChanged(selected) {
    const obj = (selected && selected[0]) || this.canvas.getActiveObject();
    if (obj && obj.data && obj.data.kind === 'control') {
      const target = this.getLineById(obj.data.targetId);
      if (target) {
        this.lastLineSelectionId = target.data.id;
        this.syncLineStyleUI(target);
      }
      return;
    }
    if (!obj || !obj.data || obj.data.kind !== 'line') {
      this.hideCurveHandle();
      return;
    }

    this.lastLineSelectionId = obj.data.id;
    this.showLineHandleFor(obj);
    this.syncLineStyleUI(obj);
  }

  onSelectionCleared() {
    this.hideCurveHandle();
  }

  onObjectMoving(obj) {
    if (!obj || !obj.data) return;
    if (obj.data.kind === 'line') {
      this.updateLineDataOnMove(obj);
      this.renderAllLabels();
      this.updateCurveHandlePosition(obj);
    }
  }

  onObjectModified(obj) {
    if (!obj || !obj.data) return;
    if (obj.data.kind === 'line') {
      this.updateLineDataOnMove(obj);
      this.updateCurveHandlePosition(obj);
    } else if (obj.data.kind === 'ellipse') {
      const rx = this.valOr(obj.rx, 0) * this.valOr(obj.scaleX, 1);
      const ry = this.valOr(obj.ry, 0) * this.valOr(obj.scaleY, 1);
      obj.set({ rx, ry, scaleX: 1, scaleY: 1 });
      obj.data.rx = rx;
      obj.data.ry = ry;
      obj.setCoords();
    }
  }

  updateLineDataOnMove(obj) {
    const lastLeft = this.valOr(obj.data.lastLeft, this.valOr(obj.left, 0));
    const lastTop = this.valOr(obj.data.lastTop, this.valOr(obj.top, 0));
    const dx = this.valOr(obj.left, 0) - lastLeft;
    const dy = this.valOr(obj.top, 0) - lastTop;
    if (dx === 0 && dy === 0) return;

    obj.data.start.x += dx;
    obj.data.start.y += dy;
    obj.data.end.x += dx;
    obj.data.end.y += dy;
    if (obj.data.ctrl) {
      obj.data.ctrl.x += dx;
      obj.data.ctrl.y += dy;
    }
    obj.data.lastLeft = this.valOr(obj.left, 0);
    obj.data.lastTop = this.valOr(obj.top, 0);
  }

  showLineHandleFor(obj) {
    if (!obj || !obj.data || obj.data.kind !== 'line') return;
    this.hideCurveHandle();

    const isCurve = obj.data.lineType === 'curve';
    const ctrl = isCurve ? (obj.data.ctrl ? obj.data.ctrl : this.getDefaultCurveCtrl(obj.data.start, obj.data.end)) : null;
    if (isCurve) obj.data.ctrl = { ...ctrl };
    const makeHandle = (x, y, role, fill) => {
      const handle = new fabric.Circle({
        left: x,
        top: y,
        radius: 6,
        fill,
        stroke: '#333333',
        strokeWidth: 1,
        originX: 'center',
        originY: 'center',
        hasBorders: false,
        hasControls: false,
        selectable: true,
        evented: true
      });
      handle.data = { kind: 'control', targetId: obj.data.id, role };
      handle.excludeFromExport = true;
      handle.on('moving', () => {
        const hx = this.valOr(handle.left, 0);
        const hy = this.valOr(handle.top, 0);
        if (role === 'start') obj.data.start = { x: hx, y: hy };
        if (role === 'end') obj.data.end = { x: hx, y: hy };
        if (role === 'ctrl') obj.data.ctrl = { x: hx, y: hy };
        this.updateLineObject(obj, { keepPosition: false });
        this.renderAllLabels();
      });
        handle.on('modified', () => {
          const hx = this.valOr(handle.left, 0);
          const hy = this.valOr(handle.top, 0);
          if (role === 'start') obj.data.start = { x: hx, y: hy };
          if (role === 'end') obj.data.end = { x: hx, y: hy };
          if (role === 'ctrl') obj.data.ctrl = { x: hx, y: hy };
          this.updateLineObject(obj, { keepPosition: false });
          this.renderAllLabels();
          const target = this.getLineById(handle.data.targetId);
          if (target) {
            this.canvas.setActiveObject(target);
            this.onSelectionChanged([target]);
            this.canvas.requestRenderAll();
          }
        });
      return handle;
    };

    this.curveHandles.start = makeHandle(obj.data.start.x, obj.data.start.y, 'start', '#e3f2fd');
    this.curveHandles.end = makeHandle(obj.data.end.x, obj.data.end.y, 'end', '#e3f2fd');
    this.curveHandles.ctrl = isCurve && ctrl ? makeHandle(ctrl.x, ctrl.y, 'ctrl', '#ffffff') : null;

    this.canvas.add(this.curveHandles.start);
    this.canvas.add(this.curveHandles.end);
    if (this.curveHandles.ctrl) this.canvas.add(this.curveHandles.ctrl);
    this.canvas.bringToFront(this.curveHandles.start);
    this.canvas.bringToFront(this.curveHandles.end);
    if (this.curveHandles.ctrl) this.canvas.bringToFront(this.curveHandles.ctrl);
    this.updateCanvasObjectInteractivity();
  }

  hideCurveHandle() {
    const handles = this.curveHandles;
    if (!handles) return;
    ['start', 'end', 'ctrl'].forEach(role => {
      if (handles[role]) this.canvas.remove(handles[role]);
      handles[role] = null;
    });
    this.updateCanvasObjectInteractivity();
  }

  updateCurveHandlePosition(obj) {
    const handles = this.curveHandles;
    if (!handles || !obj || !obj.data) return;
    if (handles.ctrl && handles.ctrl.data && handles.ctrl.data.targetId === obj.data.id) {
      const ctrl = obj.data.ctrl ? obj.data.ctrl : this.getDefaultCurveCtrl(obj.data.start, obj.data.end);
      handles.ctrl.set({ left: ctrl.x, top: ctrl.y });
      handles.ctrl.setCoords();
    }
    if (handles.start) {
      handles.start.set({ left: obj.data.start.x, top: obj.data.start.y });
      handles.start.setCoords();
    }
    if (handles.end) {
      handles.end.set({ left: obj.data.end.x, top: obj.data.end.y });
      handles.end.setCoords();
    }
    this.canvas.requestRenderAll();
  }

  // -------------------- Coordinate helpers --------------------
  clientDeltaToCanvasDelta(dxClient, dyClient) {
    const rect = this.canvas.upperCanvasEl.getBoundingClientRect();
    return {
      dx: dxClient * (this.canvas.getWidth() / rect.width),
      dy: dyClient * (this.canvas.getHeight() / rect.height)
    };
  }

  canvasPointFromClient(clientX, clientY) {
    const rect = this.canvas.upperCanvasEl.getBoundingClientRect();
    const x = (clientX - rect.left) * (this.canvas.getWidth() / rect.width);
    const y = (clientY - rect.top) * (this.canvas.getHeight() / rect.height);
    return new fabric.Point(x, y);
  }

  // -------------------- Panning --------------------
  startPan(clientX, clientY) {
    this.isPanning = true;
    this.panLastClient = { x: clientX, y: clientY };
    this.canvas.defaultCursor = 'grabbing';
  }

  movePan(clientX, clientY) {
    if (!this.isPanning) return;

    const dxClient = clientX - this.panLastClient.x;
    const dyClient = clientY - this.panLastClient.y;
    this.panLastClient = { x: clientX, y: clientY };

    const { dx, dy } = this.clientDeltaToCanvasDelta(dxClient, dyClient);
    const vt = this.canvas.viewportTransform;
    vt[4] += dx;
    vt[5] += dy;
    this.canvas.setViewportTransform(vt);
    this.canvas.requestRenderAll();
  }

  stopPan() {
    this.isPanning = false;
    this.panLastClient = null;
    this.canvas.defaultCursor = (this.tool === 'hand') ? 'grab' : this.getCursorForTool(this.tool);
    this.canvas.requestRenderAll();
    this.pushHistoryDebounced('pan');
  }

  // -------------------- Mouse handlers --------------------
  startDrawAtPoint(p) {
    this.drawPrevSelection = this.canvas.selection;
    this.drawPrevTargetFind = this.canvas.skipTargetFind;
    this.canvas.selection = false;
    this.canvas.skipTargetFind = true;
    this.canvas.discardActiveObject();

    this.isDrawing = true;
    this.drawStart = { x: p.x, y: p.y };

    if (this.tool === 'ellipse') {
      const paint = this.getLinePaintFromUI();
      this.tempObj = new fabric.Ellipse({
        left: p.x,
        top: p.y,
        rx: 1,
        ry: 1,
        originX: 'center',
        originY: 'center',
        fill: '#e5e5e5',
        stroke: paint.stroke,
        strokeWidth: paint.strokeWidth,
        selectable: false,
        evented: false
      });
      this.canvas.add(this.tempObj);
      this.canvas.requestRenderAll();
      return;
    }

    const paint = this.getLinePaintFromUI();
    const ctrl = (this.tool === 'curve') ? this.getDefaultCurveCtrl(this.drawStart, this.drawStart) : null;
    this.tempCurveCtrl = ctrl;

    const pathStr = this.buildLinePath({
      lineType: this.tool,
      start: this.drawStart,
      end: this.drawStart,
      ctrl,
      lineStyle: paint.lineStyle
    });

    this.tempObj = new fabric.Path(pathStr, {
      stroke: paint.stroke,
      strokeWidth: paint.strokeWidth,
      strokeDashArray: this.getDashArray(paint.lineStyle),
      fill: null,
      selectable: false,
      evented: false,
      objectCaching: false
    });

    this.canvas.add(this.tempObj);
    this.canvas.requestRenderAll();
  }

  updateDrawToPoint(p) {
    if (!this.isDrawing || !this.tempObj) return;

    if (this.tool === 'ellipse') {
      const start = this.drawStart;
      const rx = Math.max(1, Math.abs(p.x - start.x) / 2);
      const ry = Math.max(1, Math.abs(p.y - start.y) / 2);
      const cx = (p.x + start.x) / 2;
      const cy = (p.y + start.y) / 2;
      this.tempObj.set({ left: cx, top: cy, rx, ry });
      this.tempObj.setCoords();
      this.canvas.requestRenderAll();
      return;
    }

    const paint = this.getLinePaintFromUI();
    const ctrl = (this.tool === 'curve') ? this.getDefaultCurveCtrl(this.drawStart, p) : null;
    this.tempCurveCtrl = ctrl;

    const pathStr = this.buildLinePath({
      lineType: this.tool,
      start: this.drawStart,
      end: p,
      ctrl,
      lineStyle: paint.lineStyle
    });
    const parsedPath = new fabric.Path(pathStr, { fill: null }).path;
    this.tempObj.set({ path: parsedPath, strokeDashArray: this.getDashArray(paint.lineStyle) });
    this.tempObj.setCoords();
    this.canvas.requestRenderAll();
  }

  finishDrawing() {
    if (!this.isDrawing) return;
    this.isDrawing = false;

    const start = this.drawStart;
    const end = this.lastPointer;

    const finalCtrl = this.tempCurveCtrl;

    if (this.tempObj) {
      this.canvas.remove(this.tempObj);
      this.tempObj = null;
    }
    this.tempCurveCtrl = null;
    if (this.drawPrevSelection !== null) {
      this.canvas.selection = this.drawPrevSelection;
      this.canvas.skipTargetFind = this.drawPrevTargetFind;
      this.drawPrevSelection = null;
      this.drawPrevTargetFind = null;
    }

    if (!start || !end) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 2) return;

    if (this.tool === 'ellipse') {
      const ellipse = this.createEllipseObject(start, end);
      this.canvas.add(ellipse);
      this.canvas.setActiveObject(ellipse);
      this.canvas.requestRenderAll();
      this.pushHistoryDebounced('ellipse');
      this.uiTool = 'select';
      if (!this.spaceHandActive) this.tool = 'select';
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === 'select'));
      this.applyToolMode();
      this.updateStatusTool();
      return;
    }

    if (this.tool === 'line' || this.tool === 'curve') {
      const g = this.createLineObject(this.tool, start, end, finalCtrl);
      this.canvas.add(g);
      this.canvas.setActiveObject(g);
      this.canvas.requestRenderAll();
      this.pushHistoryDebounced('draw');
      this.uiTool = 'select';
      if (!this.spaceHandActive) this.tool = 'select';
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === 'select'));
      this.applyToolMode();
      this.updateStatusTool();
    }
  }

  onMouseDown(opt) {
    if (this.recentTouch) return;

    // Hand tool: pan
    if (this.tool === 'hand') {
      opt.e.preventDefault();
      if (opt.e.button !== 0) return;
      this.startPan(opt.e.clientX, opt.e.clientY);
      return;
    }

    if (opt.target && opt.target.data && opt.target.data.kind === 'control') {
      return;
    }

    // Ctrl/?click toggle multi-select (select tool only)
    if (this.tool === 'select' && opt.target && (opt.e.ctrlKey || opt.e.metaKey)) {
      opt.e.preventDefault();
      opt.e.stopPropagation();
      this.ctrlToggleSelection(opt.target);
      return;
    }

    const p = this.canvas.getPointer(opt.e);
    this.lastPointer = p;

    const cp = document.getElementById('cursorPos');
    if (cp) cp.textContent = `X: ${Math.round(p.x)}, Y: ${Math.round(p.y)}`;

    // clear DOM label selection when interacting canvas
    this.clearLabelSelection();

    // Delete tool: click target delete directly
    if (this.tool === 'delete') {
      if (opt.target) this.canvas.setActiveObject(opt.target);
      this.deleteSelected();
      return;
    }

    if (this.tool === 'point') {
      const prevSelection = this.canvas.selection;
      const prevTargetFind = this.canvas.skipTargetFind;
      this.canvas.selection = false;
      this.canvas.skipTargetFind = true;
      this.canvas.discardActiveObject();
      this.addPoint(p.x, p.y);
      this.canvas.selection = prevSelection;
      this.canvas.skipTargetFind = prevTargetFind;
      this.pushHistoryDebounced('point');
      this.uiTool = 'select';
      if (!this.spaceHandActive) this.tool = 'select';
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === 'select'));
      this.applyToolMode();
      this.updateStatusTool();
      return;
    }

    if (this.tool === 'label') {
      const prevSelection = this.canvas.selection;
      const prevTargetFind = this.canvas.skipTargetFind;
      this.canvas.selection = false;
      this.canvas.skipTargetFind = true;
      this.canvas.discardActiveObject();
      this.addLabel(p.x, p.y);
      this.canvas.selection = prevSelection;
      this.canvas.skipTargetFind = prevTargetFind;

      // after creating label -> go back to select in UI
      this.uiTool = 'select';
      if (!this.spaceHandActive) this.tool = 'select';
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === 'select'));
      this.applyToolMode();
      this.updateStatusTool();

      this.pushHistoryDebounced('label');
      return;
    }

    if (['line', 'curve', 'ellipse'].includes(this.tool)) {
      this.startDrawAtPoint(p);
    }
  }

    onMouseMove(opt) {
    if (this.recentTouch) return;

    if (this.tool === 'hand') {
      opt.e.preventDefault();
      this.movePan(opt.e.clientX, opt.e.clientY);
      return;
    }

    const p = this.canvas.getPointer(opt.e);
    this.lastPointer = p;

    const cp = document.getElementById('cursorPos');
    if (cp) cp.textContent = `X: ${Math.round(p.x)}, Y: ${Math.round(p.y)}`;

    this.updateDrawToPoint(p);
  }

    onMouseUp() {
    if (this.recentTouch) return;

    if (this.tool === 'hand') {
      this.stopPan();
      return;
    }

    this.finishDrawing();
  }

  undoHistory() {
    if (this.historyIndex <= 0) return;
    this.historyIndex = Math.max(0, this.historyIndex - 1);
    const entry = this.history[this.historyIndex];
    if (entry && entry.snap) this.restoreState(entry.snap);
  }


  // -------------------- Wheel: default pan; Ctrl/⌘ wheel zoom --------------------
  onMouseWheel(opt) {
    if (this.isTypingTarget(opt.e.target)) return;

    opt.e.preventDefault();
    opt.e.stopPropagation();

    const deltaX = opt.e.deltaX || 0;
    const deltaY = opt.e.deltaY || 0;

    // ctrl/meta => zoom
    if (opt.e.ctrlKey || opt.e.metaKey) {
      let zoom = this.canvas.getZoom();
      zoom *= Math.pow(0.999, deltaY);
      zoom = Math.max(0.2, Math.min(zoom, 5));

      const pt = this.canvasPointFromClient(opt.e.clientX, opt.e.clientY);
      this.canvas.zoomToPoint(pt, zoom);

      this.zoomLevel = zoom;
      this.updateZoomLabel();

      this.canvas.requestRenderAll();
      this.pushHistoryDebounced('zoom');
      return;
    }

    // default pan
    const { dx, dy } = this.clientDeltaToCanvasDelta(-deltaX, -deltaY);
    const vt = this.canvas.viewportTransform;
    vt[4] += dx;
    vt[5] += dy;
    this.canvas.setViewportTransform(vt);

    this.canvas.requestRenderAll();
    this.pushHistoryDebounced('wheel-pan');
  }

  zoomAtCanvasCenter(factor) {
    let zoom = this.canvas.getZoom() * factor;
    zoom = Math.max(0.2, Math.min(zoom, 5));

    const pt = new fabric.Point(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2);
    this.canvas.zoomToPoint(pt, zoom);

    this.zoomLevel = zoom;
    this.updateZoomLabel();

    this.canvas.requestRenderAll();
    this.pushHistoryDebounced('zoom');
  }

  // ---------- touch/pinch support ----------
  markRecentTouch() {
    this.recentTouch = true;
    clearTimeout(this.recentTouchTimer);
    this.recentTouchTimer = setTimeout(() => (this.recentTouch = false), 500);
  }

  touchCenter(t1, t2) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }

  touchDistance(t1, t2) {
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  }

  onTouchStart(ev) {
    this.markRecentTouch();

    if (ev.touches.length === 2) {
      ev.preventDefault();
      const [t1, t2] = ev.touches;

      this.isPinching = true;
      this.pinchStartDist = this.touchDistance(t1, t2) || 1;
      this.pinchStartZoom = this.canvas.getZoom();
      this.pinchLastCenterClient = this.touchCenter(t1, t2);

      this.canvas.discardActiveObject();
      this.clearLabelSelection();
      return;
    }

    if (ev.touches.length === 1) {
      const t = ev.touches[0];
      const p = this.canvasPointFromClient(t.clientX, t.clientY);
      this.lastPointer = { x: p.x, y: p.y };

      if (this.tool === 'hand') {
        ev.preventDefault();
        this.startPan(t.clientX, t.clientY);
        return;
      }

      if (this.tool === 'point') {
        ev.preventDefault();
        const prevSelection = this.canvas.selection;
        const prevTargetFind = this.canvas.skipTargetFind;
        this.canvas.selection = false;
        this.canvas.skipTargetFind = true;
        this.canvas.discardActiveObject();
        this.addPoint(p.x, p.y);
        this.canvas.selection = prevSelection;
        this.canvas.skipTargetFind = prevTargetFind;
        this.pushHistoryDebounced('point');
        this.uiTool = 'select';
        if (!this.spaceHandActive) this.tool = 'select';
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === 'select'));
        this.applyToolMode();
        this.updateStatusTool();
        return;
      }

      if (this.tool === 'label') {
        ev.preventDefault();
        const prevSelection = this.canvas.selection;
        const prevTargetFind = this.canvas.skipTargetFind;
        this.canvas.selection = false;
        this.canvas.skipTargetFind = true;
        this.canvas.discardActiveObject();
        this.addLabel(p.x, p.y);
        this.canvas.selection = prevSelection;
        this.canvas.skipTargetFind = prevTargetFind;

        this.uiTool = 'select';
        if (!this.spaceHandActive) this.tool = 'select';
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === 'select'));
        this.applyToolMode();
        this.updateStatusTool();

        this.pushHistoryDebounced('label');
        return;
      }

      if (['line', 'curve', 'ellipse'].includes(this.tool)) {
        ev.preventDefault();
        this.startDrawAtPoint(p);
      }
    }
  }

  onTouchMove(ev) {
    this.markRecentTouch();

    if (this.isPinching && ev.touches.length === 2) {
      ev.preventDefault();

      const [t1, t2] = ev.touches;
      const center = this.touchCenter(t1, t2);
      const dist = this.touchDistance(t1, t2) || 1;

      // pan by center movement
      const dxClient = center.x - this.pinchLastCenterClient.x;
      const dyClient = center.y - this.pinchLastCenterClient.y;
      this.pinchLastCenterClient = center;

      const { dx, dy } = this.clientDeltaToCanvasDelta(dxClient, dyClient);
      const vt = this.canvas.viewportTransform;
      vt[4] += dx;
      vt[5] += dy;
      this.canvas.setViewportTransform(vt);

      // zoom by pinch distance
      let zoom = this.pinchStartZoom * (dist / this.pinchStartDist);
      zoom = Math.max(0.2, Math.min(zoom, 5));

      const pt = this.canvasPointFromClient(center.x, center.y);
      this.canvas.zoomToPoint(pt, zoom);

      this.zoomLevel = zoom;
      this.updateZoomLabel();

      this.canvas.requestRenderAll();
      return;
    }

    if (ev.touches.length === 1) {
      const t = ev.touches[0];
      const p = this.canvasPointFromClient(t.clientX, t.clientY);
      this.lastPointer = { x: p.x, y: p.y };

      if (this.tool === 'hand' && this.isPanning) {
        ev.preventDefault();
        this.movePan(t.clientX, t.clientY);
        return;
      }

      if (['line', 'curve', 'ellipse'].includes(this.tool) && this.isDrawing) {
        ev.preventDefault();
        this.updateDrawToPoint(p);
      }
    }
  }

  onTouchEnd(ev) {
    this.markRecentTouch();

    if (this.isPinching && ev.touches.length < 2) {
      this.stopPinch();
    }
    if (this.isPanning && ev.touches.length === 0) {
      this.stopPan();
    }
    if (this.isDrawing && ev.touches.length === 0) {
      this.finishDrawing();
    }
  }

  stopPinch() {
    this.isPinching = false;
    this.pinchStartDist = 0;
    this.pinchStartZoom = this.canvas.getZoom();
    this.pinchLastCenterClient = null;
    this.canvas.requestRenderAll();
    this.pushHistoryDebounced('pinch');
  }

    // -------------------- Lines & Shapes --------------------
  getLinePaintFromUI() {
    const lineStyleEl = document.getElementById('lineStyle');
    const lineWidthEl = document.getElementById('lineWidth');
    const lineColorEl = document.getElementById('lineColor');
    const lineStyle = (lineStyleEl && lineStyleEl.value) ? lineStyleEl.value : 'solid';
    const strokeWidth = parseInt((lineWidthEl && lineWidthEl.value) ? lineWidthEl.value : '2', 10);
    const stroke = (lineColorEl && lineColorEl.value) ? lineColorEl.value : '#000000';

    return { lineStyle, stroke, strokeWidth };
  }

  getDashArray(style) {
    if (style === 'dashed') return [8, 6];
    if (style === 'dotted') return [2, 6];
    return null;
  }

  getDefaultCurveCtrl(start, end) {
    const mx = (start.x + end.x) / 2;
    const my = (start.y + end.y) / 2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L;
    const ny = dx / L;
    const offset = Math.min(60, Math.max(20, L * 0.2));
    return { x: mx + nx * offset, y: my + ny * offset };
  }

  buildLinePath({ lineType, start, end, ctrl, lineStyle }) {
    if (lineType === 'curve') {
      const c = ctrl ? ctrl : this.getDefaultCurveCtrl(start, end);
      if (lineStyle === 'wavy') return this.pathWavyOnCurve(start, c, end, { amplitude: 2.6, wavelength: 15 });
      if (lineStyle === 'spring') return this.pathSpringOnCurve(start, c, end, { amplitude: 5, wavelength: 7 });
      return `M ${start.x} ${start.y} C ${c.x} ${c.y} ${c.x} ${c.y} ${end.x} ${end.y}`;
    }

    if (lineStyle === 'wavy') return this.pathWavy(start, end, { amplitude: 2.6, wavelength: 15 });
    if (lineStyle === 'spring') return this.pathSpring(start, end, { amplitude: 5, wavelength: 7 });
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  pathWavy(p1, p2, { amplitude = 2.6, wavelength = 15 } = {}) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;

    const steps = Math.max(26, Math.floor(L / 1.5));
    const k = (2 * Math.PI) / wavelength;

    let d = `M ${p1.x} ${p1.y}`;
    for (let i = 1; i <= steps; i++) {
      const s = (L * i) / steps;
      const off = amplitude * Math.sin(k * s);
      d += ` L ${p1.x + ux * s + nx * off} ${p1.y + uy * s + ny * off}`;
    }
    return d;
  }

  pathSpring(p1, p2, { amplitude = 5, wavelength = 7 } = {}) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const nx = -uy, ny = ux;

    const steps = Math.max(42, Math.floor(L / 0.9));
    const k = (2 * Math.PI) / wavelength;

    let d = `M ${p1.x} ${p1.y}`;
    for (let i = 1; i <= steps; i++) {
      const s = (L * i) / steps;
      const nOff = amplitude * Math.cos(k * s);
      const tOff = amplitude * 0.25 * Math.sin(k * s);
      d += ` L ${p1.x + ux * (s + tOff) + nx * nOff} ${p1.y + uy * (s + tOff) + ny * nOff}`;
    }
    return d;
  }

  pathWavyOnCurve(p0, p1, p2, { amplitude = 2.6, wavelength = 15 } = {}) {
    const steps = 96;
    const k = (2 * Math.PI) / wavelength;

    let d = `M ${p0.x} ${p0.y}`;
    let last = { x: p0.x, y: p0.y };
    let s = 0;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const pt = this.sampleCubic(p0, p1, p1, p2, t);
      const tang = this.cubicTangent(p0, p1, p1, p2, t);
      const L = Math.hypot(tang.x, tang.y) || 1;
      const nx = -tang.y / L;
      const ny = tang.x / L;
      s += Math.hypot(pt.x - last.x, pt.y - last.y);
      const off = amplitude * Math.sin(k * s);
      d += ` L ${pt.x + nx * off} ${pt.y + ny * off}`;
      last = pt;
    }
    return d;
  }

  pathSpringOnCurve(p0, p1, p2, { amplitude = 5, wavelength = 7 } = {}) {
    const steps = 140;
    const k = (2 * Math.PI) / wavelength;

    let d = `M ${p0.x} ${p0.y}`;
    let last = { x: p0.x, y: p0.y };
    let s = 0;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const pt = this.sampleCubic(p0, p1, p1, p2, t);
      const tang = this.cubicTangent(p0, p1, p1, p2, t);
      const L = Math.hypot(tang.x, tang.y) || 1;
      const ux = tang.x / L;
      const uy = tang.y / L;
      const nx = -uy;
      const ny = ux;
      s += Math.hypot(pt.x - last.x, pt.y - last.y);
      const nOff = amplitude * Math.cos(k * s);
      const tOff = amplitude * 0.25 * Math.sin(k * s);
      d += ` L ${pt.x + nx * nOff + ux * tOff} ${pt.y + ny * nOff + uy * tOff}`;
      last = pt;
    }
    return d;
  }

  sampleCubic(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
      x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
      y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y
    };
  }

  cubicTangent(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
      x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
      y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
    };
  }

  createLineObject(lineType, start, end, ctrl = null, paintOverride = null, arrowOverride = null) {
    const paint = paintOverride ? paintOverride : this.getLinePaintFromUI();
    const arrowStyleEl = document.getElementById('arrowStyle');
    const arrowStyle = arrowOverride ? arrowOverride : ((arrowStyleEl && arrowStyleEl.value) ? arrowStyleEl.value : 'none');
    const lineStyle = paint.lineStyle;
    const resolvedCtrl = (lineType === 'curve' && !ctrl) ? this.getDefaultCurveCtrl(start, end) : ctrl;

    const data = {
      kind: 'line',
      id: ++this.objectId,
      lineType,
      start: { ...start },
      end: { ...end },
      ctrl: resolvedCtrl ? { ...resolvedCtrl } : null,
      style: { lineStyle, stroke: paint.stroke, strokeWidth: paint.strokeWidth, arrow: arrowStyle }
    };

    const center = this.getLineCenter(data);
    const localData = this.shiftLineData(data, -center.x, -center.y);
    const parts = this.buildLineParts(localData);
    const group = new fabric.Group(parts, {
      selectable: true,
      evented: true,
      objectCaching: false,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      hasControls: false,
      originX: 'center',
      originY: 'center',
      left: center.x,
      top: center.y
    });

    group.data = data;
    group.data.lastLeft = this.valOr(group.left, 0);
    group.data.lastTop = this.valOr(group.top, 0);

    return group;
  }

  updateLineObject(obj, opts = {}) {
    if (!obj || !obj.data || obj.data.kind !== 'line') return;

    const keepPosition = opts && opts.keepPosition;
    const targetCenter = keepPosition ? obj.getCenterPoint() : this.getLineCenter(obj.data);
    const localData = this.shiftLineData(obj.data, -targetCenter.x, -targetCenter.y);
    const parts = this.buildLineParts(localData);

    obj.set({ originX: 'center', originY: 'center' });
    obj._objects = parts;
    obj._objects.forEach(part => {
      part.group = obj;
      part.canvas = obj.canvas;
    });
    obj._calcBounds();
    obj._updateObjectsCoords();
    obj.setPositionByOrigin(targetCenter, 'center', 'center');
    obj.setCoords();
    obj.dirty = true;
    obj.data.lastLeft = this.valOr(obj.left, 0);
    obj.data.lastTop = this.valOr(obj.top, 0);
    this.canvas.requestRenderAll();

    if (this.curveHandles && (this.curveHandles.start || this.curveHandles.end || this.curveHandles.ctrl)) {
      const targetId = (this.curveHandles.start && this.curveHandles.start.data && this.curveHandles.start.data.targetId)
        || (this.curveHandles.end && this.curveHandles.end.data && this.curveHandles.end.data.targetId)
        || (this.curveHandles.ctrl && this.curveHandles.ctrl.data && this.curveHandles.ctrl.data.targetId);
      if (targetId === obj.data.id) this.updateCurveHandlePosition(obj);
    }
  }

  getLineCenter(data) {
    const sx = this.valOr(data.start && data.start.x, 0);
    const sy = this.valOr(data.start && data.start.y, 0);
    const ex = this.valOr(data.end && data.end.x, 0);
    const ey = this.valOr(data.end && data.end.y, 0);
    return { x: (sx + ex) / 2, y: (sy + ey) / 2 };
  }

  shiftLineData(data, dx, dy) {
    const shiftPoint = (p) => (p ? { x: p.x + dx, y: p.y + dy } : null);
    return {
      kind: data.kind,
      id: data.id,
      lineType: data.lineType,
      start: shiftPoint(data.start),
      end: shiftPoint(data.end),
      ctrl: shiftPoint(data.ctrl),
      style: data.style
    };
  }

  buildLineParts(data) {
    const linePath = this.buildLinePath({
      lineType: data.lineType,
      start: data.start,
      end: data.end,
      ctrl: data.ctrl || this.getDefaultCurveCtrl(data.start, data.end),
      lineStyle: data.style.lineStyle
    });
    const lineObj = new fabric.Path(linePath, {
      stroke: data.style.stroke,
      strokeWidth: data.style.strokeWidth,
      strokeDashArray: this.getDashArray(data.style.lineStyle),
      fill: null,
      selectable: false,
      evented: false,
      objectCaching: false
    });
    lineObj.set({ originX: 'center', originY: 'center', left: 0, top: 0 });
    lineObj.setCoords();

    const parts = [lineObj];
    const arrowPath = this.buildArrowPath(data, data.style.arrow);
    if (arrowPath) {
      const arrowObj = new fabric.Path(arrowPath, {
        stroke: data.style.stroke,
        strokeWidth: data.style.strokeWidth,
        fill: data.style.stroke,
        selectable: false,
        evented: false,
        objectCaching: false
      });
      arrowObj.setCoords();
      parts.push(arrowObj);
    }

    return parts;
  }

  buildArrowPath(data, arrowStyle) {
    if (!arrowStyle || arrowStyle === 'none') return '';

    const arrowSize = 10;
    const crossSize = 6;
    const segments = [];

    const addArrow = (pt, angle) => {
      const tip = pt;
      const baseX = tip.x - Math.cos(angle) * arrowSize * 1.1;
      const baseY = tip.y - Math.sin(angle) * arrowSize * 1.1;
      const left = {
        x: baseX + Math.cos(angle + Math.PI / 2) * (arrowSize * 0.45),
        y: baseY + Math.sin(angle + Math.PI / 2) * (arrowSize * 0.45)
      };
      const right = {
        x: baseX + Math.cos(angle - Math.PI / 2) * (arrowSize * 0.45),
        y: baseY + Math.sin(angle - Math.PI / 2) * (arrowSize * 0.45)
      };
      segments.push(`M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`);
    };

    const addCross = (pt, angle) => {
      const ang1 = angle + Math.PI / 4;
      const ang2 = angle - Math.PI / 4;
      const p1 = { x: pt.x - Math.cos(ang1) * crossSize, y: pt.y - Math.sin(ang1) * crossSize };
      const p2 = { x: pt.x + Math.cos(ang1) * crossSize, y: pt.y + Math.sin(ang1) * crossSize };
      const p3 = { x: pt.x - Math.cos(ang2) * crossSize, y: pt.y - Math.sin(ang2) * crossSize };
      const p4 = { x: pt.x + Math.cos(ang2) * crossSize, y: pt.y + Math.sin(ang2) * crossSize };
      segments.push(`M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`);
      segments.push(`M ${p3.x} ${p3.y} L ${p4.x} ${p4.y}`);
    };

    const start = this.getLinePointAt(data, 0);
    const end = this.getLinePointAt(data, 1);
    const mid = this.getLinePointAt(data, 0.5);
    const angleStart = this.getLineAngleAt(data, 0);
    const angleEnd = this.getLineAngleAt(data, 1);
    const angleMid = this.getLineAngleAt(data, 0.5);

    if (arrowStyle === 'forward' || arrowStyle === 'both') addArrow(end, angleEnd);
    if (arrowStyle === 'backward' || arrowStyle === 'both') addArrow(start, angleStart + Math.PI);
    if (arrowStyle === 'mid-forward') addArrow(mid, angleMid);
    if (arrowStyle === 'mid-backward') addArrow(mid, angleMid + Math.PI);
    if (arrowStyle === 'mid-cross') addCross(mid, angleMid);

    return segments.join(' ');
  }

  getLinePointAt(data, t) {
    if (data.lineType === 'curve' && data.ctrl) {
      return this.sampleCubic(data.start, data.ctrl, data.ctrl, data.end, t);
    }
    return {
      x: data.start.x + (data.end.x - data.start.x) * t,
      y: data.start.y + (data.end.y - data.start.y) * t
    };
  }

  getLineAngleAt(data, t) {
    if (data.lineType === 'curve' && data.ctrl) {
      const tang = this.cubicTangent(data.start, data.ctrl, data.ctrl, data.end, t);
      return Math.atan2(tang.y, tang.x);
    }
    return Math.atan2(data.end.y - data.start.y, data.end.x - data.start.x);
  }

  addPoint(x, y) {
    const point = new fabric.Circle({
      left: x,
      top: y,
      radius: 3,
      fill: '#000',
      stroke: '#000',
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      padding: 8
    });
    point.data = { kind: 'point', id: ++this.objectId };
    this.canvas.add(point);
    this.canvas.setActiveObject(point);
    this.canvas.requestRenderAll();
  }

  createEllipseObject(start, end) {
    const paint = this.getLinePaintFromUI();
    const rx = Math.max(4, Math.abs(end.x - start.x) / 2);
    const ry = Math.max(4, Math.abs(end.y - start.y) / 2);
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    const ellipse = new fabric.Ellipse({
      left: cx,
      top: cy,
      rx,
      ry,
      originX: 'center',
      originY: 'center',
      fill: '#e5e5e5',
      stroke: paint.stroke,
      strokeWidth: paint.strokeWidth
    });
    ellipse.data = { kind: 'ellipse', id: ++this.objectId, rx, ry };
    return ellipse;
  }

  // -------------------- Labels (KaTeX DOM overlay) --------------------
  addLabel(x, y) {
    if (!window.katex || !window.katex.renderToString) {
      alert(this.t('katexNotReady'));
      return;
    }
    const raw = prompt(this.t('labelPrompt'), this.t('labelDefault'));
    if (!raw) return;
    this.addLabelDirect(x, y, raw);
  }

  addLabelDirect(x, y, rawTex, bind = null) {
    const id = ++this.labelId;
    const label = {
      id,
      x,
      y,
      tex: rawTex,
      el: null,
      bind: bind ? bind : { targetId: null, anchor: 'none', dx: 0, dy: 0 }
    };
    this.labels.push(label);

    this.mountLabel(label);
    this.renderAllLabels();
    this.selectLabelById(id);

    this.generateTikZCode({ forceWriteEditor: false });
    this.pushHistoryDebounced('label');
  }

  mountLabel(label) {
    const el = document.createElement('div');
    el.className = 'latex-label';
    el.dataset.labelId = String(label.id);

    this.renderLabelTexToElement(el, label.tex);

    let dragging = false;
    let startClient = null;
    let startWorld = null;

    const onPointerDown = (ev) => {
      if (this.tool === 'hand') return;
      ev.preventDefault();
      ev.stopPropagation();

      this.selectLabelById(label.id);

      if (this.tool === 'delete') {
        this.removeLabelById(label.id);
        return;
      }

      dragging = true;
      el.classList.add('dragging');
      if (el.setPointerCapture) el.setPointerCapture(ev.pointerId);

      startClient = { x: ev.clientX, y: ev.clientY };
      startWorld = { x: label.x, y: label.y };
    };

    const onPointerMove = (ev) => {
      if (!dragging) return;
      ev.preventDefault();
      ev.stopPropagation();

      const dxClient = ev.clientX - startClient.x;
      const dyClient = ev.clientY - startClient.y;

      const rect = this.canvas.upperCanvasEl.getBoundingClientRect();
      const dxCanvasPx = dxClient * (this.canvas.getWidth() / rect.width);
      const dyCanvasPx = dyClient * (this.canvas.getHeight() / rect.height);

      const vt = this.canvas.viewportTransform;
      const inv = fabric.util.invertTransform(vt);
      const p0 = fabric.util.transformPoint(new fabric.Point(0, 0), inv);
      const p1 = fabric.util.transformPoint(new fabric.Point(dxCanvasPx, dyCanvasPx), inv);

      label.x = startWorld.x + (p1.x - p0.x);
      label.y = startWorld.y + (p1.y - p0.y);
      if (label.bind && label.bind.targetId && label.bind.anchor && label.bind.anchor !== 'none') {
        const target = this.getLineById(label.bind.targetId);
        if (target) {
          const anchorPt = this.getLineAnchorPoint(target, label.bind.anchor);
          label.bind.dx = label.x - anchorPt.x;
          label.bind.dy = label.y - anchorPt.y;
        }
      }

      this.renderAllLabels();
      this.generateTikZCode({ forceWriteEditor: false });
      this.pushHistoryDebounced('label-move');
    };

    const onPointerUp = (ev) => {
      if (!dragging) return;
      ev.preventDefault();
      ev.stopPropagation();
      dragging = false;
      el.classList.remove('dragging');
      if (el.releasePointerCapture) el.releasePointerCapture(ev.pointerId);
    };

    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    el.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      this.selectLabelById(label.id);

      const newTex = prompt(this.t('editLabelPrompt'), label.tex);
      if (!newTex) return;

      label.tex = newTex;
      this.renderLabelTexToElement(el, label.tex);

      this.generateTikZCode({ forceWriteEditor: false });
      this.pushHistoryDebounced('label-edit');
    });

    this.labelLayer.appendChild(el);
    label.el = el;
  }

  renderLabelTexToElement(el, tex) {
    try {
      el.innerHTML = katex.renderToString(tex, { throwOnError: false, displayMode: false });
    } catch (e) {
      el.textContent = tex;
    }
  }

  renderAllLabels() {
    if (!this.labelLayer) return;
    const vt = this.canvas.viewportTransform;
    for (const label of this.labels) {
      if (!label.el) continue;
      this.syncLabelToBinding(label);
      const p = fabric.util.transformPoint(new fabric.Point(label.x, label.y), vt);
      label.el.style.left = `${p.x}px`;
      label.el.style.top = `${p.y}px`;
    }
  }

  selectLabelById(id) {
    this.selectedLabelId = id;
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
    for (const l of this.labels) if (l.el) l.el.classList.toggle('selected', l.id === id);
    const label = this.labels.find(l => l.id === id);
    if (label) this.updateLabelBindingUI(label);
  }

  clearLabelSelection() {
    this.selectedLabelId = null;
    for (const l of this.labels) if (l.el) l.el.classList.remove('selected');
    this.updateLabelBindingUI(null);
  }

  updateLabelBindingUI(label) {
    const bindMode = document.getElementById('labelBindMode');
    const offsetX = document.getElementById('labelOffsetX');
    const offsetY = document.getElementById('labelOffsetY');
    if (!bindMode || !offsetX || !offsetY) return;

    if (!label || !label.bind) {
      bindMode.value = 'none';
      offsetX.value = '0';
      offsetY.value = '0';
      return;
    }

    bindMode.value = this.valOr(label.bind.anchor, 'none');
    offsetX.value = String(this.valOr(label.bind.dx, 0));
    offsetY.value = String(this.valOr(label.bind.dy, 0));
  }

  updateSelectedLabelBinding(mode) {
    const label = this.labels.find(l => l.id === this.selectedLabelId);
    if (!label) return;

    if (mode === 'none') {
      label.bind = { targetId: null, anchor: 'none', dx: 0, dy: 0 };
      this.renderAllLabels();
      return;
    }

    label.bind.anchor = mode;
    if (label.bind.targetId) {
      const target = this.getLineById(label.bind.targetId);
      if (target) {
        const anchorPt = this.getLineAnchorPoint(target, mode);
        label.bind.dx = label.x - anchorPt.x;
        label.bind.dy = label.y - anchorPt.y;
      }
    }
    this.renderAllLabels();
  }

  updateSelectedLabelOffset() {
    const label = this.labels.find(l => l.id === this.selectedLabelId);
    if (!label || !label.bind || !label.bind.targetId) return;

    const offsetXEl = document.getElementById('labelOffsetX');
    const offsetYEl = document.getElementById('labelOffsetY');
    const offsetX = parseFloat((offsetXEl && offsetXEl.value) ? offsetXEl.value : '0');
    const offsetY = parseFloat((offsetYEl && offsetYEl.value) ? offsetYEl.value : '0');
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;

    label.bind.dx = offsetX;
    label.bind.dy = offsetY;
    this.renderAllLabels();
  }

  bindSelectedLabelToLastLine() {
    const label = this.labels.find(l => l.id === this.selectedLabelId);
    if (!label || !this.lastLineSelectionId) return;

    const target = this.getLineById(this.lastLineSelectionId);
    if (!target) return;

    const modeEl = document.getElementById('labelBindMode');
    const mode = (modeEl && modeEl.value) ? modeEl.value : 'mid';
    const anchor = (mode === 'none') ? 'mid' : mode;
    const anchorPt = this.getLineAnchorPoint(target, anchor);

    label.bind = {
      targetId: target.data.id,
      anchor,
      dx: label.x - anchorPt.x,
      dy: label.y - anchorPt.y
    };

    this.updateLabelBindingUI(label);
    this.renderAllLabels();
  }

  unbindSelectedLabel() {
    const label = this.labels.find(l => l.id === this.selectedLabelId);
    if (!label) return;
    label.bind = { targetId: null, anchor: 'none', dx: 0, dy: 0 };
    this.updateLabelBindingUI(label);
    this.renderAllLabels();
  }

  syncLabelToBinding(label) {
    if (!label.bind || !label.bind.targetId || !label.bind.anchor || label.bind.anchor === 'none') return;
    const target = this.getLineById(label.bind.targetId);
    if (!target) {
      label.bind = { targetId: null, anchor: 'none', dx: 0, dy: 0 };
      return;
    }
    const anchorPt = this.getLineAnchorPoint(target, label.bind.anchor);
    label.x = anchorPt.x + this.valOr(label.bind.dx, 0);
    label.y = anchorPt.y + this.valOr(label.bind.dy, 0);
  }

  getLineById(id) {
    return this.canvas.getObjects().find(o => o && o.data && o.data.kind === 'line' && o.data.id === id) || null;
  }

  getLineAnchorPoint(lineObj, anchor) {
    if (!lineObj || !lineObj.data) return { x: 0, y: 0 };
    const t = anchor === 'start' ? 0 : (anchor === 'end' ? 1 : 0.5);
    return this.getLinePointAt(lineObj.data, t);
  }

  removeLabelById(id) {
    const idx = this.labels.findIndex(l => l.id === id);
    if (idx < 0) return;
    const l = this.labels[idx];
    if (l.el) l.el.remove();
    this.labels.splice(idx, 1);
    if (this.selectedLabelId === id) this.selectedLabelId = null;

    this.generateTikZCode({ forceWriteEditor: false });
    this.pushHistoryDebounced('label-del');
  }

    // -------------------- Properties --------------------
  updateSelectedLineStyle(style) {
    const obj = this.canvas.getActiveObject();
    if (!obj || !obj.data || obj.data.kind !== 'line') return;

    obj.data.style.lineStyle = style;
    this.updateLineObject(obj, { keepPosition: true });

    this.canvas.requestRenderAll();
    this.generateTikZCode({ forceWriteEditor: false });
    this.pushHistoryDebounced('style');
  }

  syncLineStyleUI(obj) {
    let target = obj;
    if (!target) return;
    if (target.type === 'activeSelection' && target.getObjects) {
      const firstLine = target.getObjects().find(o => o && o.data && o.data.kind === 'line');
      if (!firstLine) return;
      target = firstLine;
    }
    if (!target.data || target.data.kind !== 'line') return;

    const style = target.data.style || {};
    const lineStyleEl = document.getElementById('lineStyle');
    const lineWidthEl = document.getElementById('lineWidth');
    const lineColorEl = document.getElementById('lineColor');
    const arrowStyleEl = document.getElementById('arrowStyle');

    if (lineStyleEl) lineStyleEl.value = this.valOr(style.lineStyle, 'solid');
    if (lineColorEl) lineColorEl.value = this.valOr(style.stroke, '#000000');
    if (arrowStyleEl) arrowStyleEl.value = this.valOr(style.arrow, 'none');
    if (lineWidthEl) {
      let width = parseFloat(this.valOr(style.strokeWidth, 2));
      if (!Number.isFinite(width)) width = 2;
      width = Math.max(1, Math.min(5, width));
      lineWidthEl.value = String(width);
    }
  }

  updateSelectedLineWidth(w) {
    const obj = this.canvas.getActiveObject();
    if (!obj || !obj.data) return;

    if (obj.data.kind === 'line') {
      obj.data.style.strokeWidth = w;
      this.updateLineObject(obj, { keepPosition: true });
    } else if (obj.data.kind === 'ellipse') {
      obj.set({ strokeWidth: w });
    } else if (obj.data.kind === 'point') {
      obj.set({ strokeWidth: w, radius: Math.max(2, w + 1), padding: 8 });
    } else {
      return;
    }

    this.canvas.requestRenderAll();
    this.generateTikZCode({ forceWriteEditor: false });
    this.pushHistoryDebounced('style');
  }

  updateSelectedLineColor(color) {
    const obj = this.canvas.getActiveObject();
    if (!obj || !obj.data) return;

    if (obj.data.kind === 'line') {
      obj.data.style.stroke = color;
      this.updateLineObject(obj, { keepPosition: true });
    } else if (obj.data.kind === 'ellipse') {
      obj.set({ stroke: color });
    } else if (obj.data.kind === 'point') {
      obj.set({ fill: color, stroke: color });
    } else {
      return;
    }

    this.canvas.requestRenderAll();
    this.generateTikZCode({ forceWriteEditor: false });
    this.pushHistoryDebounced('style');
  }

  updateSelectedArrowStyle(arrowStyle) {
    const obj = this.canvas.getActiveObject();
    if (!obj || !obj.data || obj.data.kind !== 'line') return;

    obj.data.style.arrow = arrowStyle;
    this.updateLineObject(obj, { keepPosition: true });

    this.canvas.requestRenderAll();
    this.generateTikZCode({ forceWriteEditor: false });
    this.pushHistoryDebounced('style');
  }

  // -------------------- TikZ: Copy / Apply / Export --------------------
  copyTikZCode() {
    const code = this.tikzEditor ? this.tikzEditor.value : this.lastGeneratedTikZ;
    navigator.clipboard.writeText(code).catch(() => {});
  }

  exportTikZ() {
    const code = this.tikzEditor ? this.tikzEditor.value : this.lastGeneratedTikZ;
    const modal = document.getElementById('exportModal');
    const ta = document.getElementById('exportedCode');
    if (ta) ta.value = code;
    if (modal) modal.classList.add('active');
  }

  copyModalCode() {
    const textarea = document.getElementById('exportedCode');
    if (!textarea) return;
    textarea.select();
    document.execCommand('copy');
  }

  downloadTikZ() {
    const exported = document.getElementById('exportedCode');
    const code = (exported && exported.value) ? exported.value : '';
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'feynman-diagram.tex';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  closeModal() {
    const modal = document.getElementById('exportModal');
    if (modal) modal.classList.remove('active');
  }

  applyEditorToPreview() {
    if (!this.tikzEditor) return;
    const text = this.tikzEditor.value;

    const parsed = this.parseTikZSubset(text);
    if (!parsed) {
      alert(this.t('tikzParseFail'));
      return;
    }

    this.applyParsedToCanvas(parsed);

    // Apply success: reset dirty and normalize editor to generated tikz
    this.editorDirty = false;
    this.generateTikZCode({ forceWriteEditor: true });
    this.pushHistoryDebounced('apply');
  }

  exportPNG() {
    const dataURL = this.canvas.toDataURL({ format: 'png', quality: 1 });
    const a = document.createElement('a');
    a.href = dataURL;
    a.download = 'feynman-diagram.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

    // -------------------- TikZ: Canvas -> Editor --------------------
  generateTikZCode({ forceWriteEditor = false } = {}) {
    const objects = this.canvas.getObjects().filter(o => o && o.data && o.data.kind && o.data.kind !== 'control');

    let tikz = `% Auto-generated by FeynmanDrawer\n`;
    tikz += `% Editable subset: \\draw / \\node\n`;
    tikz += `% Requires \\usetikzlibrary{decorations.pathmorphing,decorations.markings,arrows.meta}\n`;
    tikz += `\\begin{tikzpicture}\n`;

    // points
    const points = objects.filter(o => o.data.kind === 'point');
    points.forEach(p => {
      const r = Math.max(0.04, this.valOr(p.radius, 3) / 20).toFixed(2);
      tikz += `  \\fill (${this.toTikzCoordX(this.valOr(p.left, 0))}, ${this.toTikzCoordY(this.valOr(p.top, 0))}) circle (${r});\n`;
    });

    // lines
    const lines = objects.filter(o => o.data.kind === 'line');
    lines.forEach(l => {
      const style = this.mapToTikzLineStyle(l.data);
      const s = `(${this.toTikzCoordX(l.data.start.x)}, ${this.toTikzCoordY(l.data.start.y)})`;
      const e = `(${this.toTikzCoordX(l.data.end.x)}, ${this.toTikzCoordY(l.data.end.y)})`;
      let path = `${s} -- ${e}`;
      if (l.data.lineType === 'curve' && l.data.ctrl) {
        const c = `(${this.toTikzCoordX(l.data.ctrl.x)}, ${this.toTikzCoordY(l.data.ctrl.y)})`;
        path = `${s} .. controls ${c} .. ${e}`;
      }
      const comment = (l.data.style.arrow && l.data.style.arrow !== 'none') ? ` % fd-arrow: ${l.data.style.arrow}` : '';
      tikz += `  \\draw[${style}] ${path};${comment}\n`;
    });

    // ellipses
    const ellipses = objects.filter(o => o.data.kind === 'ellipse');
    ellipses.forEach(el => {
      const cx = this.valOr(el.left, 0);
      const cy = this.valOr(el.top, 0);
      const rx = this.valOr(el.rx, 10);
      const ry = this.valOr(el.ry, 8);
      const color = this.tikzColor(this.valOr(el.stroke, '#000000'));
      const width = Math.max(0.4, this.valOr(el.strokeWidth, 1) / 2).toFixed(2);
      tikz += `  \\draw[fill=gray!20, draw=${color}, line width=${width}pt] (${this.toTikzCoordX(cx)}, ${this.toTikzCoordY(cy)}) ellipse (${this.toTikzLength(rx)} and ${this.toTikzLength(ry)});\n`;
    });

    // labels
    for (const l of this.labels) {
      const clean = this.stripDollar(l.tex);
      tikz += `  \\node at (${this.toTikzCoordX(l.x)}, ${this.toTikzCoordY(l.y)}) {$${clean}$};\n`;
    }

    tikz += `\\end{tikzpicture}\n`;

    this.lastGeneratedTikZ = tikz;

    // Write editor only if forced or editor not dirty
    if (this.tikzEditor) {
      const shouldWrite = forceWriteEditor || !this.editorDirty;
      if (shouldWrite) {
        this.isSyncingEditor = true;
        this.tikzEditor.value = tikz;
        this.isSyncingEditor = false;
      }
    }

    return tikz;
  }

  mapToTikzLineStyle(data) {
    const parts = [];
    const color = this.tikzColor(this.valOr(data.style.stroke, '#000000'));
    const width = Math.max(0.4, this.valOr(data.style.strokeWidth, 2) / 2).toFixed(2);
    parts.push(`draw=${color}`);
    parts.push(`line width=${width}pt`);

    if (data.style.lineStyle === 'dashed') parts.push('dashed');
    if (data.style.lineStyle === 'dotted') parts.push('dotted');
    if (data.style.lineStyle === 'wavy') parts.push('decorate, decoration={snake, segment length=10pt, amplitude=2pt}');
    if (data.style.lineStyle === 'spring') parts.push('decorate, decoration={coil, segment length=5pt, amplitude=3pt}');

    const arrow = data.style.arrow;
    if (arrow === 'forward') parts.push('-{Stealth}');
    if (arrow === 'backward') parts.push('{Stealth}-');
    if (arrow === 'both') parts.push('{Stealth}-{Stealth}');
    if (arrow === 'mid-forward') {
      parts.push('postaction={decorate, decoration={markings, mark=at position 0.5 with {\\arrow{Stealth}}}}');
    }
    if (arrow === 'mid-backward') {
      parts.push('postaction={decorate, decoration={markings, mark=at position 0.5 with {\\arrow{Stealth}[reversed]}}}}');
    }
    if (arrow === 'mid-cross') {
      parts.push('postaction={decorate, decoration={markings, mark=at position 0.5 with {\\pgfpathmoveto{\\pgfpoint{-2pt}{-2pt}}\\pgfpathlineto{\\pgfpoint{2pt}{2pt}}\\pgfpathmoveto{\\pgfpoint{-2pt}{2pt}}\\pgfpathlineto{\\pgfpoint{2pt}{-2pt}}\\pgfusepath{stroke}}}}');
    }

    return parts.join(', ');
  }

  tikzColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(this.valOr(hex, ''));
    if (!m) return 'black';
    const v = m[1];
    const r = parseInt(v.slice(0, 2), 16);
    const g = parseInt(v.slice(2, 4), 16);
    const b = parseInt(v.slice(4, 6), 16);
    return `{rgb,255:red,${r};green,${g};blue,${b}}`;
  }

  // -------------------- TikZ parsing & apply --------------------
  parseTikZSubset(text) {
    try {
      const scale = 20; // tikz unit -> px
      const lines = text.split('\n');

      const points = [];
      const draws = [];
      const ellipses = [];
      const nodes = [];

      for (let raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('%')) continue;

        // \fill (x,y) circle (r);
        let m = line.match(/\\fill\s*\(([^,]+),\s*([^\)]+)\)\s*circle\s*\(([^\)]+)\)\s*;/);
        if (m) {
          const x = parseFloat(m[1]) * scale;
          const y = -parseFloat(m[2]) * scale;
          const r = parseFloat(m[3]) * scale;
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(r)) points.push({ x, y, r });
          continue;
        }

        // \draw[...] (x,y) ellipse (a and b);
        m = line.match(/\\draw\s*\[([^\]]*)\]\s*\(([^,]+),\s*([^\)]+)\)\s*ellipse\s*\(([^\s]+)\s+and\s+([^\)]+)\)\s*;/);
        if (m) {
          const styleRaw = m[1] || '';
          const x = parseFloat(m[2]) * scale;
          const y = -parseFloat(m[3]) * scale;
          const rx = parseFloat(m[4]) * scale;
          const ry = parseFloat(m[5]) * scale;
          const style = this.parseDrawStyle(styleRaw, line);
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(rx) && Number.isFinite(ry)) {
            ellipses.push({ x, y, rx, ry, style });
          }
          continue;
        }

        // \draw[STYLE] (a) -- (b);
        m = line.match(/\\draw\s*\[([^\]]*)\]\s*(.+?)\s*--\s*(.+?)\s*;/);
        if (m) {
          const styleRaw = m[1] || '';
          const aRaw = m[2].trim();
          const bRaw = m[3].trim();
          const style = this.parseDrawStyle(styleRaw, line);
          const a = this.parseCoord(aRaw, scale);
          const b = this.parseCoord(bRaw, scale);
          if (a && b) draws.push({ lineType: 'line', style, a, b, ctrl: null });
          continue;
        }

        // \draw[STYLE] (a) .. controls (c) .. (b);
        m = line.match(/\\draw\s*\[([^\]]*)\]\s*(.+?)\s*\.\.\s*controls\s*(.+?)\s*\.\.\s*(.+?)\s*;/);
        if (m) {
          const styleRaw = m[1] || '';
          const aRaw = m[2].trim();
          const cRaw = m[3].trim();
          const bRaw = m[4].trim();
          const style = this.parseDrawStyle(styleRaw, line);
          const a = this.parseCoord(aRaw, scale);
          const b = this.parseCoord(bRaw, scale);
          const c = this.parseCoord(cRaw, scale);
          if (a && b && c) draws.push({ lineType: 'curve', style, a, b, ctrl: c });
          continue;
        }

        // \node at (x,y) {...};
        m = line.match(/\\node\s+at\s*\(([^,]+),\s*([^\)]+)\)\s*\{(.+)\}\s*;/);
        if (m) {
          const x = parseFloat(m[1]) * scale;
          const y = -parseFloat(m[2]) * scale;
          const content = m[3].trim();
          const tex = this.stripDollar(content.replace(/^\{|\}$/g, '').trim());
          if (Number.isFinite(x) && Number.isFinite(y)) nodes.push({ x, y, tex });
          continue;
        }
      }

      return { points, draws, ellipses, nodes };
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  parseDrawStyle(styleRaw, line) {
    const s = styleRaw.replace(/\s+/g, ' ').trim().toLowerCase();
    let lineStyle = 'solid';
    if (s.includes('dashed')) lineStyle = 'dashed';
    else if (s.includes('dotted')) lineStyle = 'dotted';
    else if (s.includes('snake')) lineStyle = 'wavy';
    else if (s.includes('coil')) lineStyle = 'spring';

    let arrow = 'none';
    if (s.includes('<->')) arrow = 'both';
    else if (s.includes('->')) arrow = 'forward';
    else if (s.includes('<-')) arrow = 'backward';

    const commentArrow = this.parseArrowFromComment(line);
    if (commentArrow) arrow = commentArrow;

    let stroke = '#000000';
    const colorMatch = s.match(/draw=\{?rgb,255:red,(\d+);green,(\d+);blue,(\d+)\}?/);
    if (colorMatch) {
      const r = parseInt(colorMatch[1], 10).toString(16).padStart(2, '0');
      const g = parseInt(colorMatch[2], 10).toString(16).padStart(2, '0');
      const b = parseInt(colorMatch[3], 10).toString(16).padStart(2, '0');
      stroke = `#${r}${g}${b}`;
    }

    let strokeWidth = 2;
    const widthMatch = s.match(/line width=([0-9.]+)pt/);
    if (widthMatch) strokeWidth = Math.max(1, parseFloat(widthMatch[1]) * 2);

    return { lineStyle, arrow, stroke, strokeWidth };
  }

  parseArrowFromComment(line) {
    const m = line.match(/%\s*fd-arrow:\s*([a-z-]+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  parseCoord(token, scale) {
    let m = token.match(/^\(([^)]+)\)$/);
    if (m) {
      const inside = m[1].trim();
      if (inside.includes(',')) {
        const parts = inside.split(',');
        const x = parseFloat(parts[0]) * scale;
        const y = -parseFloat(parts[1]) * scale;
        if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
        return null;
      }
    }
    return null;
  }

  applyParsedToCanvas(parsed) {
    // clear fabric
    this.canvas.getObjects().slice().forEach(o => this.canvas.remove(o));
    this.canvas.discardActiveObject();
    this.hideCurveHandle();

    // clear labels
    for (const l of this.labels) if (l.el) l.el.remove();
    this.labels = [];
    this.clearLabelSelection();

    // points
    parsed.points.forEach(p => {
      const point = new fabric.Circle({
        left: p.x,
        top: p.y,
        radius: p.r,
        fill: '#000',
        stroke: '#000',
        strokeWidth: 1,
        originX: 'center',
        originY: 'center',
        padding: 8
      });
      point.data = { kind: 'point', id: ++this.objectId };
      this.canvas.add(point);
    });

    // lines
    parsed.draws.forEach(d => {
      const g = this.createLineObject(
        d.lineType,
        { x: d.a.x, y: d.a.y },
        { x: d.b.x, y: d.b.y },
        d.ctrl,
        { lineStyle: d.style.lineStyle, stroke: d.style.stroke, strokeWidth: d.style.strokeWidth },
        d.style.arrow
      );
      this.canvas.add(g);
    });

    // ellipses
    parsed.ellipses.forEach(el => {
      const ellipse = new fabric.Ellipse({
        left: el.x,
        top: el.y,
        rx: el.rx,
        ry: el.ry,
        originX: 'center',
        originY: 'center',
        fill: '#e5e5e5',
        stroke: el.style.stroke,
        strokeWidth: el.style.strokeWidth
      });
      ellipse.data = { kind: 'ellipse', id: ++this.objectId, rx: el.rx, ry: el.ry };
      this.canvas.add(ellipse);
    });

    // build nodes as labels
    parsed.nodes.forEach(n => this.addLabelDirect(n.x, n.y, n.tex));

    const objMax = this.canvas.getObjects().reduce((max, o) => {
      const id = (o && o.data && o.data.id) ? o.data.id : 0;
      return Math.max(max, id);
    }, 0);
    const labelMax = this.labels.reduce((max, l) => Math.max(max, this.valOr(l.id, 0)), 0);
    this.objectId = Math.max(this.objectId, objMax, labelMax);

    this.canvas.requestRenderAll();
  }

  // -------------------- History --------------------
  snapshotState() {
    return {
      vt: [...this.canvas.viewportTransform],
      zoom: this.canvas.getZoom(),
      canvas: this.canvas.toJSON(['data']),
      labels: this.labels.map(l => ({ x: l.x, y: l.y, tex: l.tex, bind: l.bind }))
    };
  }

  restoreState(state) {
    if (!state) return;

    for (const l of this.labels) if (l.el) l.el.remove();
    this.labels = [];
    this.clearLabelSelection();

    this.canvas.loadFromJSON(state.canvas, () => {
      this.canvas.setViewportTransform(state.vt);
      this.canvas.setZoom(state.zoom || 1);
      this.zoomLevel = this.canvas.getZoom();

      this.updateZoomLabel();

      (state.labels || []).forEach(item => this.addLabelDirect(item.x, item.y, item.tex, item.bind ? item.bind : null));

      const objMax = this.canvas.getObjects().reduce((max, o) => {
        const id = (o && o.data && o.data.id) ? o.data.id : 0;
        return Math.max(max, id);
      }, 0);
      const labelMax = this.labels.reduce((max, l) => Math.max(max, this.valOr(l.id, 0)), 0);
      this.objectId = Math.max(this.objectId, objMax, labelMax);

      this.editorDirty = false;
      this.generateTikZCode({ forceWriteEditor: true });

      this.canvas.requestRenderAll();
    });
  }

  pushHistoryDebounced(reason) {
    clearTimeout(this.historyTimer);
    this.historyTimer = setTimeout(() => this.pushHistory(reason), 250);
  }

  pushHistory(reason) {
    const snap = this.snapshotState();

    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    this.history.push({ t: Date.now(), reason, snap });

    if (this.history.length > 20) this.history.shift();
    this.historyIndex = this.history.length - 1;

    this.updateHistoryPanel();
  }

  updateHistoryPanel() {
    const list = document.getElementById('historyList');
    if (!list) return;

    list.innerHTML = '';
    const last = this.history.slice(-8);

    last.forEach((h, idx) => {
      const div = document.createElement('div');
      div.className = 'history-item';
      const time = new Date(h.t).toLocaleTimeString();
      div.textContent = `${time} · ${h.reason}`;
      div.addEventListener('click', () => {
        const realIndex = this.history.length - last.length + idx;
        this.historyIndex = realIndex;
        this.restoreState(this.history[realIndex].snap);
      });
      list.appendChild(div);
    });
  }

  // -------------------- Delete / Clear --------------------
  deleteSelected() {
    // delete fabric multi-selection
    const activeObjects = this.canvas.getActiveObjects();
    if (activeObjects && activeObjects.length > 0) {
      activeObjects.forEach(obj => {
        if (obj && obj.data && obj.data.kind === 'control') return;
        this.canvas.remove(obj);
      });
      this.canvas.discardActiveObject();
      this.hideCurveHandle();
      this.canvas.requestRenderAll();
      this.pushHistoryDebounced('delete');
      return;
    }

    // delete selected DOM label
    if (this.selectedLabelId != null) {
      this.removeLabelById(this.selectedLabelId);
      this.clearLabelSelection();
      this.pushHistoryDebounced('delete-label');
    }
  }

  clearCanvas() {
    if (!confirm(this.t('clearConfirm'))) return;

    // clear fabric objects
    this.canvas.getObjects().slice().forEach(o => this.canvas.remove(o));
    this.canvas.discardActiveObject();
    this.hideCurveHandle();

    // clear labels
    for (const l of this.labels) if (l.el) l.el.remove();
    this.labels = [];
    this.clearLabelSelection();

    this.canvas.requestRenderAll();

    // reset editor to default
    this.editorDirty = false;
    this.generateTikZCode({ forceWriteEditor: true });

    this.pushHistoryDebounced('clear');
  }

  // -------------------- View --------------------
  resetView() {
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    this.canvas.setZoom(1);
    this.zoomLevel = 1;

    this.updateZoomLabel();

    this.canvas.requestRenderAll();
    this.pushHistoryDebounced('reset-view');
  }

  toggleGrid() {
    const grid = document.querySelector('.canvas-grid');
    const btn = document.getElementById('gridToggleBtn');
    if (!grid) return;
    const hidden = grid.style.display === 'none';
    grid.style.display = hidden ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', hidden);
  }

  handleResize() {
    const container = document.querySelector('.canvas-container');
    if (!container) return;

    const w = Math.max(300, container.clientWidth || 800);
    const h = Math.max(200, container.clientHeight || 600);

    this.canvas.setWidth(w);
    this.canvas.setHeight(h);
    this.canvas.requestRenderAll();
  }

  // -------------------- Helpers --------------------
  stripDollar(s) {
    const t = (s === undefined || s === null) ? '' : String(s).trim();
    return t.replace(/^\$/, '').replace(/\$$/, '');
  }

  toTikzCoordX(px) {
    return (px / 20).toFixed(2);
  }

  toTikzCoordY(px) {
    return (-px / 20).toFixed(2);
  }

  toTikzLength(px) {
    return (Math.abs(px) / 20).toFixed(2);
  }

  valOr(value, fallback) {
    return (value === undefined || value === null) ? fallback : value;
  }

  // -------------------- Help --------------------
  showHelp() {
    alert(this.t('helpText'));
  }
}

// bootstrap
document.addEventListener('DOMContentLoaded', () => {
  window.feynmanApp = new FeynmanDrawer();
});
