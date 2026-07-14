'use strict';

/* ========== IndexedDB 数据库 ========== */
const db = {
  _db: null,
  DB_NAME: 'CameraOpsDB',
  STORE: 'records',
  VERSION: 1,

  async init() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(this.STORE)) {
          const store = d.createObjectStore(this.STORE, { keyPath: 'id' });
          store.createIndex('cameraSN', 'cameraSN', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = (e) => { this._db = e.target.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },

  async getAll() {
    const d = await this.init();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).index('createdAt').openCursor(null, 'prev');
      const records = [];
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { records.push(cursor.value); cursor.continue(); }
        else resolve(records);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async get(id) {
    const d = await this.init();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async put(record) {
    const d = await this.init();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(this.STORE, 'readwrite');
      const req = tx.objectStore(this.STORE).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async delete(id) {
    const d = await this.init();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(this.STORE, 'readwrite');
      const req = tx.objectStore(this.STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },

  async search(query) {
    const all = await this.getAll();
    if (!query.trim()) return all;
    const q = query.trim().toLowerCase();
    return all.filter(r =>
      (r.cameraSN && r.cameraSN.toLowerCase().includes(q)) ||
      (r.ontSN && r.ontSN.toLowerCase().includes(q)) ||
      (r.broadbandAccount && r.broadbandAccount.toLowerCase().includes(q)) ||
      (r.cabinetCode && r.cabinetCode.toLowerCase().includes(q)) ||
      (r.remark && r.remark.toLowerCase().includes(q))
    );
  }
};

/* ========== 工具函数 ========== */
function uuid() {
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random()*16).toString(16));
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* ========== Toast 通知 ========== */
const toast = {
  show(msg, type, duration) {
    if (!type) type = '';
    if (!duration) duration = 2500;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    document.getElementById('toastContainer').appendChild(el);
    setTimeout(() => { if (el.parentNode) el.remove(); }, duration);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error'); },
  warning(msg) { this.show(msg, 'warning'); }
};

/* ========== 模态框 ========== */
const modal = {
  open(html, onConfirm) {
    document.getElementById('modalBody').innerHTML = html;
    document.getElementById('modalOverlay').classList.add('open');
    if (onConfirm) {
      const btn = document.querySelector('.modal-confirm');
      if (btn) btn.onclick = () => { onConfirm(); this.close(); };
    }
  },
  close() {
    document.getElementById('modalOverlay').classList.remove('open');
  }
};

/* ========== 路由 ========== */
const router = {
  _stack: [],
  _current: 'list',
  _params: {},

  async go(page, params) {
    this._stack.push({ page: this._current, params: this._params });
    this._current = page;
    this._params = params || {};
    await this._render();
  },

  async back() {
    if (this._stack.length === 0) return;
    const prev = this._stack.pop();
    this._current = prev.page;
    this._params = prev.params || {};
    await this._render();
  },

  async refresh() {
    await this._render();
  },

  async _render() {
    document.getElementById('headerActions').innerHTML = '';
    const backBtn = document.getElementById('navBack');
    backBtn.style.display = this._stack.length > 0 && this._current !== 'list' ? 'flex' : 'none';
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.page === this._current);
    });
    const container = document.getElementById('mainContent');
    try {
      switch (this._current) {
        case 'list': await renderList(container); break;
        case 'add': await renderAdd(container, this._params.id); break;
        case 'detail': await renderDetail(container, this._params.id); break;
        case 'export': await renderExport(container); break;
        default: container.innerHTML = '<p>页面未找到</p>';
      }
    } catch (e) {
      console.error('Render error:', e);
      container.innerHTML = '<div class="card"><p style="color:var(--danger)">加载失败，请重试</p></div>';
    }
  }
};


/* ========== 条码扫码 ========== */
const barcodeScanner = {
  _scanner: null,
  _targetInputId: null,

  async start(targetInputId) {
    if (!targetInputId) {
      toast.warning('\u8be5\u7167\u7247\u4e0d\u652f\u6301\u626b\u7801\u8bc6\u522b');
      return;
    }
    var self = this;
    this._targetInputId = targetInputId;
    if (typeof Html5Qrcode === 'undefined') {
      toast.error('扫码库未加载，请检查网络');
      return;
    }
    document.getElementById('scannerOverlay').classList.add('open');

    try {
      this._scanner = new Html5Qrcode('scannerContainer');
      await this._scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        function(decodedText) {
          // Success - fill the input and close
          var input = document.getElementById(self._targetInputId);
          if (input) {
            input.value = decodedText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          toast.success('扫码成功: ' + decodedText);
          self.close();
        },
        function() { /* ignore scan errors */ }
      );
    } catch (e) {
      console.error('Scanner error:', e);
      toast.error('无法启动摄像头，请检查权限');
      document.getElementById('scannerOverlay').classList.remove('open');
    }
  },

  async close() {
    if (this._scanner) {
      try { await this._scanner.stop(); } catch (e) {}
      this._scanner = null;
    }
    this._targetInputId = null;
    document.getElementById('scannerOverlay').classList.remove('open');
  }
};


/* ========== OCR 识别模块 ========== */
const ocr = {
  _worker: null,

  async _getWorker() {
    if (this._worker) return this._worker;
    if (typeof Tesseract === 'undefined') {
      toast.error('OCR引擎未加载，请检查网络');
      return null;
    }
    try {
      this._worker = await Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          const el = document.querySelector('.ocr-progress');
          if (el && m.status === 'recognizing text') {
            el.textContent = '识别中 ' + Math.round(m.progress*100) + '%';
          }
        }
      });
      return this._worker;
    } catch (e) {
      console.error('OCR worker error:', e);
      toast.error('OCR引擎初始化失败');
      return null;
    }
  },

  // 图片预处理：灰度化 + 增强对比度，提高识别率
  _preprocessImage(dataUrl) {
    return new Promise((resolve) => {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        var w = img.width, h = img.height;
        // 缩小到合理尺寸加速识别
        var maxDim = 1200;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = h * maxDim / w; w = maxDim; }
          else { w = w * maxDim / h; h = maxDim; }
        }
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);

        // 获取像素数据做增强
        var imageData = ctx.getImageData(0, 0, w, h);
        var data = imageData.data;
        // 统计像素亮度分布
        var minVal = 255, maxVal = 0;
        for (var i = 0; i < data.length; i += 4) {
          var gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
          data[i] = gray;
          data[i+1] = gray;
          data[i+2] = gray;
          if (gray < minVal) minVal = gray;
          if (gray > maxVal) maxVal = gray;
        }
        // 拉伸对比度
        var range = maxVal - minVal;
        if (range > 10) {
          for (var j = 0; j < data.length; j += 4) {
            var px = (data[j] - minVal) / range * 255;
            data[j] = px;
            data[j+1] = px;
            data[j+2] = px;
          }
        }
        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.src = dataUrl;
    });
  },

  // 从文本中提取可能的SN码
  _extractCodes(text) {
    if (!text) return [];
    var candidates = [];
    // 1. 尝试匹配连续字母数字组合（SN码常见格式）
    var matches = text.match(/[A-Za-z0-9]{6,}/g) || [];
    matches.forEach(function(m) { candidates.push(m); });
    // 2. 尝试匹配含连字符/下划线的编码
    var matches2 = text.match(/[A-Za-z0-9\-_/]{8,}/g) || [];
    matches2.forEach(function(m) { candidates.push(m); });
    // 去重，按长度排序（SN码通常较长）
    var unique = [];
    candidates.forEach(function(c) {
      if (unique.indexOf(c) === -1) unique.push(c);
    });
    unique.sort(function(a, b) { return b.length - a.length; });
    return unique;
  },

  async recognizeFromImage(dataUrl, targetInputId, previewId, fieldName) {
    var self = this;
    var loadingEl = document.getElementById('ocr-loading-' + targetInputId);
    var previewEl = document.getElementById(previewId);
    if (loadingEl) loadingEl.classList.add('show');
    if (previewEl) previewEl.classList.remove('show');
    try {
      // 预处理图片
      var processedUrl = await this._preprocessImage(dataUrl);
      var worker = await this._getWorker();
      if (!worker) return;
      var result = await worker.recognize(processedUrl);
      var text = result.data.text.trim();
      var codes = this._extractCodes(text);

      // 显示识别结果供用户确认
      if (previewEl) {
        var html = '';
        if (codes.length > 0) {
          html += '<div class="ocr-codes">';
          codes.forEach(function(code, idx) {
            var active = idx === 0 ? ' active' : '';
            html += '<button type="button" class="ocr-code-btn' + active + '" onclick="ocr.selectCode(\'' + code.replace(/'/g, "\\'") + '\', \'' + targetInputId + '\', this)">' + code + '</button>';
          });
          html += '</div>';
        }
        html += '<div class="ocr-raw"><div class="ocr-label">原始识别文本：</div><div class="ocr-text">' + escHtml(text.slice(0, 300)) + '</div></div>';
        html += '<div class="ocr-actions"><button type="button" class="btn btn-outline" style="font-size:12px;padding:6px;" onclick="ocr.retry(\'' + fieldName + '\', \'' + targetInputId + '\', \'' + previewId + '\')">重新识别</button></div>';
        previewEl.innerHTML = html;
        previewEl.classList.add('show');
        // 自动选中第一个候选码
        if (codes.length > 0) {
          document.getElementById(targetInputId).value = codes[0];
        }
      }
      toast.success('识别完成，请确认结果');
    } catch (e) {
      console.error('OCR error:', e);
      toast.error('识别失败，请重试或手动输入');
    } finally {
      if (loadingEl) loadingEl.classList.remove('show');
    }
  },

  selectCode(code, targetInputId, btn) {
    document.getElementById(targetInputId).value = code;
    // 高亮选中项
    var parent = btn.parentNode;
    if (parent) {
      var siblings = parent.querySelectorAll('.ocr-code-btn');
      siblings.forEach(function(s) { s.classList.remove('active'); });
    }
    btn.classList.add('active');
  },

  retry(fieldName, targetInputId, previewId) {
    var dataUrl = document.getElementById(fieldName + '-data').value;
    if (dataUrl) {
      this.recognizeFromImage(dataUrl, targetInputId, previewId, fieldName);
    } else {
      toast.warning('\u8bf7\u5148\u62cd\u6444\u6216\u9009\u62e9\u7167\u7247');
    }
  }
};

/* ========== 图片压缩 ========== */
function readFileAsDataURL(file, maxWidth) {
  if (!maxWidth) maxWidth = 1920;
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;
        if (w > maxWidth) {
          h = h * maxWidth / w;
          w = maxWidth;
        }
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ========== GPS 定位 ========== */
function getCurrentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      toast.warning('当前设备不支持GPS定位');
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => {
        console.warn('GPS error:', err.message);
        toast.warning('定位失败：' + err.message);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });
}

/* ========== 列表页 ========== */
async function renderList(container) {
  const q = router._params.search || '';
  const records = await db.search(q);
  container.innerHTML =
    '<div class="page active">' +
    '<div class="list-toolbar">' +
    '<input type="text" class="form-control" id="searchInput" placeholder="搜索SN码/账号/备注..." value="' + escHtml(q) + '">' +
    '<button class="btn btn-primary" id="searchBtn" style="width:auto;padding:10px 16px;">' +
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
    '</button></div>' +
    '<div id="recordList">';

  if (records.length === 0) {
    container.innerHTML +=
      '<div class="list-empty">' +
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' +
      '<p>暂无记录</p><p style="font-size:12px;margin-top:4px;">点击底部"新增"开始采集</p></div>';
  } else {
    container.innerHTML += '<div class="card" style="padding:4px 14px;">';
    records.forEach(r => { container.innerHTML += renderRecordItem(r); });
    container.innerHTML += '</div>';
  }
  container.innerHTML += '</div></div>';

  document.getElementById('searchInput').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      router._params.search = document.getElementById('searchInput').value;
      renderList(container);
    }
  });
  document.getElementById('searchBtn').addEventListener('click', () => {
    router._params.search = document.getElementById('searchInput').value;
    renderList(container);
  });
}

function renderRecordItem(r) {
  const thumbSrc = r.cameraPhoto || r.pointPhoto || '';
  const sn = r.cameraSN || r.ontSN || '\u672a\u586b\u5199SN';
  const time = formatDate(r.createdAt);
  const loc = r.latitude ? r.latitude.toFixed(4) + ', ' + r.longitude.toFixed(4) : '';
  const addr = r.broadbandAccount || r.cabinetCode || '';
  const thumbHtml = thumbSrc
    ? '<img src="' + thumbSrc + '" alt="\u9884\u89c8">'
    : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-secondary);font-size:20px;">\uD83D\uDCF7</div>';
  return '<div class="record-item" onclick="router.go(\'detail\', {id:\'' + r.id + '\'})">' +
    '<div class="record-thumb">' + thumbHtml + '</div>' +
    '<div class="record-info">' +
    '<div class="sn">' + escHtml(sn) + '</div>' +
    '<div class="meta"><span>' + time + '</span>' + (loc ? '<span> \uD83D\uDCCD ' + loc + '</span>' : '') + '</div>' +
    (addr ? '<div class="address">' + escHtml(addr) + '</div>' : '') +
    '</div></div>';
}

/* ========== 新增/编辑页 ========== */
async function renderAdd(container, editId) {
  let record = null;
  if (editId) {
    record = await db.get(editId);
    if (!record) {
      container.innerHTML = '<div class="page active"><div class="card"><p>\u8bb0\u5f55\u672a\u627e\u5230</p></div></div>';
      return;
    }
  }
  const title = editId ? '\u7f16\u8f91\u8bb0\u5f55' : '\u65b0\u589e\u8bb0\u5f55';
  const r = record || {};
  container.innerHTML =
    '<div class="page active">' +
    '<form id="recordForm" onsubmit="return false;">' +
    /* 摄像头 */
    '<div class="card">' +
    '<div class="card-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>\u6444\u50cf\u5934\u4fe1\u606f</div>' +
    '<div class="form-group"><label>\u6444\u50cf\u5934\u7167\u7247</label>' + renderPhotoUpload('cameraPhoto', r.cameraPhoto, '\u6444\u50cf\u5934\u673a\u8eab/\u6807\u7b7e\u7167\u7247', 'cameraSN') + '</div>' +
    '<div class="form-group"><label>\u6444\u50cf\u5934SN\u7801</label><div class="hint">\u70b9\u51fb\u4e0b\u65b9\u300c\u8bc6\u522b\u300d\u6309\u94ae\u81ea\u52a8\u4ece\u7167\u7247\u63d0\u53d6</div>' +
    '<input type="text" class="form-control" id="cameraSN" placeholder="\u6444\u50cf\u5934SN\u7801" value="' + escHtml(r.cameraSN || '') + '"></div>' +
    '</div>' +
    /* 安装点位 */
    '<div class="card">' +
    '<div class="card-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>\u5b89\u88c5\u70b9\u4f4d\u4fe1\u606f</div>' +
    '<div class="form-group"><label>\u70b9\u4f4d\u7167\u7247</label>' + renderPhotoUpload('pointPhoto', r.pointPhoto, '\u5b89\u88c5\u4f4d\u7f6e\u73af\u5883\u7167\u7247') + '</div>' +
    '<div class="form-group"><label>\u7ecf\u7eac\u5ea6</label><div class="hint">\u70b9\u51fb\u300c\u83b7\u53d6\u5f53\u524d\u5b9a\u4f4d\u300d\u81ea\u52a8\u83b7\u53d6\u5f53\u524d\u4f4d\u7f6e</div>' +
    '<div style="display:flex;gap:8px;">' +
    '<input type="number" step="0.000001" class="form-control" id="latitude" placeholder="\u7eac\u5ea6" value="' + (r.latitude ?? '') + '" style="flex:1;">' +
    '<input type="number" step="0.000001" class="form-control" id="longitude" placeholder="\u7ecf\u5ea6" value="' + (r.longitude ?? '') + '" style="flex:1;">' +
    '</div>' +
    '<button type="button" class="btn btn-outline" style="margin-top:6px;font-size:12px;padding:8px;" onclick="getLocation()">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>\u83b7\u53d6\u5f53\u524d\u5b9a\u4f4d' +
    '</button></div></div>' +
    /* 光猫 */
    '<div class="card">' +
    '<div class="card-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>\u5149\u732b\u4fe1\u606f</div>' +
    '<div class="form-group"><label>\u5149\u732b\u6807\u7b7e\u7167\u7247</label>' + renderPhotoUpload('ontPhoto', r.ontPhoto, '\u5149\u732b\u673a\u8eab\u6807\u7b7e\u7167\u7247', 'ontSN') + '</div>' +
    '<div class="form-group"><label>\u5149\u732bSN\u7801</label><input type="text" class="form-control" id="ontSN" placeholder="\u5149\u732bSN\u7801" value="' + escHtml(r.ontSN || '') + '"></div>' +
    '<div class="form-group"><label>\u5bbd\u5e26\u8d26\u53f7</label><input type="text" class="form-control" id="broadbandAccount" placeholder="\u5bbd\u5e26\u8d26\u53f7" value="' + escHtml(r.broadbandAccount || '') + '"></div>' +
    '</div>' +
    /* 机箱 */
    '<div class="card">' +
    '<div class="card-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>\u673a\u7bb1\u4fe1\u606f</div>' +
    '<div class="form-group"><label>\u673a\u7bb1\u7167\u7247</label>' + renderPhotoUpload('cabinetPhoto', r.cabinetPhoto, '\u673a\u7bb1\u5916\u89c2/\u6807\u7b7e\u7167\u7247', 'cabinetCode') + '</div>' +
    '<div class="form-group"><label>\u673a\u7bb1\u7f16\u7801</label><input type="text" class="form-control" id="cabinetCode" placeholder="\u673a\u7bb1\u7f16\u7801" value="' + escHtml(r.cabinetCode || '') + '"></div>' +
    '</div>' +
    /* 备注 */
    '<div class="card">' +
    '<div class="card-title"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>\u5907\u6ce8</div>' +
    '<div class="form-group"><textarea class="form-control" id="remark" placeholder="\u5176\u4ed6\u9700\u8981\u5907\u6ce8\u7684\u4fe1\u606f...">' + escHtml(r.remark || '') + '</textarea></div>' +
    '</div>' +
    /* 提交 */
    '<div class="card" style="padding:12px 14px;">' +
    '<div class="btn-group"><button type="button" class="btn btn-outline" onclick="router.back()">\u53d6\u6d88</button>' +
    '<button type="submit" class="btn btn-primary" id="submitBtn">' + (editId ? '\u4fdd\u5b58\u4fee\u6539' : '\u63d0\u4ea4\u8bb0\u5f55') + '</button></div>' +
    '</div>' +
    '</form></div>';

  setupPhotoUpload('cameraPhoto', 'cameraSN');
  setupPhotoUpload('pointPhoto');
  setupPhotoUpload('ontPhoto', 'ontSN');
  setupPhotoUpload('cabinetPhoto', 'cabinetCode');

  document.getElementById('recordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm()) { return; }
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.textContent = '\u4fdd\u5b58\u4e2d...';
    try {
      const now = new Date().toISOString();
      const data = {
        id: editId || uuid(),
        cameraPhoto: document.getElementById('cameraPhoto-data').value,
        cameraSN: document.getElementById('cameraSN').value.trim(),
        pointPhoto: document.getElementById('pointPhoto-data').value,
        latitude: parseFloat(document.getElementById('latitude').value) || null,
        longitude: parseFloat(document.getElementById('longitude').value) || null,
        ontPhoto: document.getElementById('ontPhoto-data').value,
        ontSN: document.getElementById('ontSN').value.trim(),
        broadbandAccount: document.getElementById('broadbandAccount').value.trim(),
        cabinetPhoto: document.getElementById('cabinetPhoto-data').value,
        cabinetCode: document.getElementById('cabinetCode').value.trim(),
        remark: document.getElementById('remark').value.trim(),
        createdAt: r.createdAt || now,
        updatedAt: now
      };
      await db.put(data);
      toast.success(editId ? '\u8bb0\u5f55\u5df2\u66f4\u65b0' : '\u8bb0\u5f55\u5df2\u4fdd\u5b58');
      router.go('list');
    } catch (err) {
      console.error('Save error:', err);
      toast.error('\u4fdd\u5b58\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
      btn.disabled = false;
      btn.textContent = editId ? '\u4fdd\u5b58\u4fee\u6539' : '\u63d0\u4ea4\u8bb0\u5f55';
    }
  });
}

function renderPhotoUpload(fieldName, existingDataUrl, hint, scanTarget) {
  const hasPhoto = !!existingDataUrl;
  function iconSvg() {
    return '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
  }
  return '<div class="photo-upload" id="' + fieldName + '-upload">' +
    '<input type="file" accept="image/*" capture="environment" id="' + fieldName + '-input">' +
    '<input type="hidden" id="' + fieldName + '-data" value="' + escHtml(existingDataUrl || '') + '">' +
    (hasPhoto
      ? '<img src="' + existingDataUrl + '" alt="\u7167\u7247">'
      : '<div class="placeholder">' + iconSvg() + '<span>' + (hint || '\u70b9\u51fb\u62cd\u7167/\u9009\u62e9\u7167\u7247') + '</span></div>') +
    '</div>' +
    '<div class="photo-actions">' +
    '<button type="button" onclick="handleClearPhoto(\'' + fieldName + '\')">\u6e05\u9664</button>' +
    (scanTarget ? '<button type="button" class="scan-btn" onclick="barcodeScanner.start(\'" + scanTarget + "\')">\u626b\u7801</button>' : '') +
    '<button type="button" class="ocr-btn" onclick="handleOCR(\'' + fieldName + '\')" id="ocr-' + fieldName + '">\u8bc6\u522b\u6587\u5b57</button>' +
    '</div>' +
    '<div class="ocr-loading" id="ocr-loading-' + fieldName + '">' +
    '<div class="spinner"></div><span class="ocr-progress">\u8bc6\u522b\u4e2d...</span></div>' +
    '<div class="ocr-preview" id="ocr-preview-' + fieldName + '">' +
    '<div class="ocr-label">OCR\u8bc6\u522b\u7ed3\u679c</div>' +
    '<div class="ocr-text"></div></div>';
}

function setupPhotoUpload(fieldName, targetInputId) {
  const input = document.getElementById(fieldName + '-input');
  const upload = document.getElementById(fieldName + '-upload');
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataURL(file);
      document.getElementById(fieldName + '-data').value = dataUrl;
      const existingImg = upload.querySelector('img');
      if (existingImg) {
        existingImg.src = dataUrl;
      } else {
        const ph = upload.querySelector('.placeholder');
        if (ph) ph.remove();
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = '\u7167\u7247';
        upload.insertBefore(img, upload.firstChild);
      }
      if (targetInputId) {
        const targetInput = document.getElementById(targetInputId);
        if (targetInput && !targetInput.value.trim()) {
          await ocr.recognizeFromImage(dataUrl, targetInputId, 'ocr-preview-' + fieldName, fieldName);
        }
      }
    } catch (err) {
      console.error('File read error:', err);
      toast.error('\u7167\u7247\u8bfb\u53d6\u5931\u8d25');
    }
  });
}

function handleOCR(fieldName) {
  const dataUrl = document.getElementById(fieldName + '-data').value;
  if (!dataUrl) { toast.warning('\u8bf7\u5148\u62cd\u6444\u6216\u9009\u62e9\u7167\u7247'); return; }
  let targetInputId;
  if (fieldName === 'cameraPhoto') targetInputId = 'cameraSN';
  else if (fieldName === 'ontPhoto') targetInputId = 'ontSN';
  else if (fieldName === 'cabinetPhoto') targetInputId = 'cabinetCode';
  else { toast.warning('\u8be5\u7167\u7247\u6682\u4e0d\u652f\u6301\u81ea\u52a8\u8bc6\u522b'); return; }
  ocr.recognizeFromImage(dataUrl, targetInputId, 'ocr-preview-' + fieldName, fieldName);
}

function handleClearPhoto(fieldName) {
  document.getElementById(fieldName + '-data').value = '';
  const upload = document.getElementById(fieldName + '-upload');
  const img = upload.querySelector('img');
  if (img) img.remove();
  const ph = document.createElement('div');
  ph.className = 'placeholder';
  ph.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg><span>\u70b9\u51fb\u62cd\u7167/\u9009\u62e9\u7167\u7247</span>';
  upload.appendChild(ph);
  document.getElementById(fieldName + '-input').value = '';
  const preview = document.getElementById('ocr-preview-' + fieldName);
  if (preview) preview.classList.remove('show');
}

async function getLocation() {
  const pos = await getCurrentPosition();
  if (pos) {
    document.getElementById('latitude').value = pos.lat.toFixed(6);
    document.getElementById('longitude').value = pos.lng.toFixed(6);
    toast.success('\u5b9a\u4f4d\u83b7\u53d6\u6210\u529f');
  }
}

/* ========== 详情页 ========== */
async function renderDetail(container, id) {
  const r = await db.get(id);
  if (!r) {
    container.innerHTML = '<div class="page active"><div class="card"><p>\u8bb0\u5f55\u672a\u627e\u5230</p></div></div>';
    return;
  }
  document.getElementById('headerActions').innerHTML =
    '<button onclick="handleDelete(\'' + r.id + '\')">\u5220\u9664</button>' +
    '<button onclick="router.go(\'add\', {id:\'' + r.id + '\'})">\u7f16\u8f91</button>';
  const hasLocation = r.latitude && r.longitude;
  let html = '<div class="page active">';
  /* 摄像头 */
  html += '<div class="card">';
  if (r.cameraPhoto) html += '<img src="' + r.cameraPhoto + '" class="detail-img viewable-img" alt="\u6444\u50cf\u5934\u7167\u7247" onclick="openImageViewerFromRecord("' + r.id + '", 0)">';
  html += '<div class="detail-section"><h3>\uD83D\uDCF9 \u6444\u50cf\u5934\u4fe1\u606f</h3>' +
    '<div class="detail-row"><span class="label">SN\u7801</span><span class="value">' + escHtml(r.cameraSN || '\u672a\u586b\u5199') + '</span></div></div></div>';
  /* 点位 */
  html += '<div class="card">';
  if (r.pointPhoto) html += '<img src="' + r.pointPhoto + '" class="detail-img viewable-img" alt="\u70b9\u4f4d\u7167\u7247" onclick="openImageViewerFromRecord("' + r.id + '", 1)">';
  html += '<div class="detail-section"><h3>\uD83D\uDCCD \u5b89\u88c5\u70b9\u4f4d</h3>' +
    '<div class="detail-row"><span class="label">\u7eac\u5ea6</span><span class="value">' + (r.latitude ?? '\u672a\u586b\u5199') + '</span></div>' +
    '<div class="detail-row"><span class="label">\u7ecf\u5ea6</span><span class="value">' + (r.longitude ?? '\u672a\u586b\u5199') + '</span></div></div>';
  if (hasLocation) html += '<div id="detailMap"></div>';
  html += '</div>';
  /* 光猫 */
  html += '<div class="card">';
  if (r.ontPhoto) html += '<img src="' + r.ontPhoto + '" class="detail-img viewable-img" alt="\u5149\u732b\u7167\u7247" onclick="openImageViewerFromRecord("' + r.id + '", 2)">';
  html += '<div class="detail-section"><h3>\uD83D\uDD0C \u5149\u732b\u4fe1\u606f</h3>' +
    '<div class="detail-row"><span class="label">SN\u7801</span><span class="value">' + escHtml(r.ontSN || '\u672a\u586b\u5199') + '</span></div>' +
    '<div class="detail-row"><span class="label">\u5bbd\u5e26\u8d26\u53f7</span><span class="value">' + escHtml(r.broadbandAccount || '\u672a\u586b\u5199') + '</span></div></div></div>';
  /* 机箱 */
  html += '<div class="card">';
  if (r.cabinetPhoto) html += '<img src="' + r.cabinetPhoto + '" class="detail-img viewable-img" alt="\u673a\u7bb1\u7167\u7247" onclick="openImageViewerFromRecord("' + r.id + '", 3)">';
  html += '<div class="detail-section"><h3>\uD83D\uDDC4\uFE0F \u673a\u7bb1\u4fe1\u606f</h3>' +
    '<div class="detail-row"><span class="label">\u673a\u7bb1\u7f16\u7801</span><span class="value">' + escHtml(r.cabinetCode || '\u672a\u586b\u5199') + '</span></div></div></div>';
  /* 备注 */
  if (r.remark) {
    html += '<div class="card"><div class="detail-section"><h3>\uD83D\uDCDD \u5907\u6ce8</h3>' +
      '<p style="font-size:14px;white-space:pre-wrap;">' + escHtml(r.remark) + '</p></div></div>';
  }
  html += '<div class="card" style="text-align:center;color:var(--text-secondary);font-size:12px;">' +
    '\u521b\u5efa\u65f6\u95f4: ' + formatDate(r.createdAt) +
    (r.updatedAt !== r.createdAt ? '<br>\u66f4\u65b0\u65f6\u95f4: ' + formatDate(r.updatedAt) : '') + '</div>';
  html += '<div class="btn-group" style="padding-bottom:12px;"><button class="btn btn-outline" onclick="router.back()">\u8fd4\u56de</button></div>';
  html += '</div>';
  container.innerHTML = html;

  if (hasLocation) {
    try {
      const map = L.map('detailMap').setView([r.latitude, r.longitude], 16);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '\u00a9 OpenStreetMap',
        maxZoom: 19
      }).addTo(map);
      L.marker([r.latitude, r.longitude]).addTo(map)
        .bindPopup('\u70b9\u4f4d: ' + r.latitude.toFixed(4) + ', ' + r.longitude.toFixed(4));
    } catch (e) {
      console.error('Map error:', e);
    }
  }
}

/* ========== 导出页 ========== */
async function renderExport(container) {
  const records = await db.getAll();
  container.innerHTML =
    '<div class="page active">' +
    '<div class="card"><div class="export-stat">' +
    '<div><div class="num">' + records.length + '</div><div class="label">\u603b\u8bb0\u5f55\u6570</div></div>' +
    '<div><div class="num">' + records.filter(r => r.cameraPhoto).length + '</div><div class="label">\u6709\u7167\u7247\u8bb0\u5f55</div></div>' +
    '<div><div class="num">' + records.filter(r => r.latitude).length + '</div><div class="label">\u6709\u5b9a\u4f4d\u8bb0\u5f55</div></div>' +
    '</div></div>' +
    '<div class="card">' +
    '<div class="card-title">\u5bfc\u51fa\u9009\u9879</div>' +
    '<div class="export-options">' +
    '<label><input type="checkbox" id="exp-camera" checked> \u6444\u50cf\u5934\u4fe1\u606f\uff08\u7167\u7247\u3001SN\u7801\uff09</label>' +
    '<label><input type="checkbox" id="exp-point" checked> \u5b89\u88c5\u70b9\u4f4d\uff08\u7167\u7247\u3001\u7ecf\u7eac\u5ea6\uff09</label>' +
    '<label><input type="checkbox" id="exp-ont" checked> \u5149\u732b\u4fe1\u606f\uff08\u7167\u7247\u3001SN\u7801\u3001\u5bbd\u5e26\u8d26\u53f7\uff09</label>' +
    '<label><input type="checkbox" id="exp-cabinet" checked> \u673a\u7bb1\u4fe1\u606f\uff08\u7167\u7247\u3001\u7f16\u7801\uff09</label>' +
    '<label><input type="checkbox" id="exp-remark" checked> \u5907\u6ce8</label>' +
    '</div></div>' +
    '<div class="btn-group" style="flex-direction:column;gap:8px;">' +
    '<button class="btn btn-primary" onclick="doExport(\'xlsx\')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> \u5bfc\u51fa Excel \u62a5\u8868</button>' +
    '<button class="btn btn-success" onclick="doExport(\'csv\')"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> \u5bfc\u51fa CSV</button>' +
    '<button class="btn btn-outline" onclick="doExportJson()">\u5bfc\u51fa JSON\uff08\u539f\u59cb\u6570\u636e\uff09</button>' +
    '</div></div>';
}

/* ========== 导出功能 ========== */
function doExport(format) {
  const incCam = document.getElementById('exp-camera').checked;
  const incPt = document.getElementById('exp-point').checked;
  const incOnt = document.getElementById('exp-ont').checked;
  const incCab = document.getElementById('exp-cabinet').checked;
  const incRem = document.getElementById('exp-remark').checked;
  if (!incCam && !incPt && !incOnt && !incCab) {
    toast.warning('\u8bf7\u81f3\u5c11\u9009\u62e9\u4e00\u9879\u5bfc\u51fa\u5185\u5bb9');
    return;
  }
  db.getAll().then(records => {
    if (records.length === 0) { toast.warning('\u6ca1\u6709\u6570\u636e\u53ef\u5bfc\u51fa'); return; }
    const header = ['\u5e8f\u53f7', '\u91c7\u96c6\u65f6\u95f4', '\u66f4\u65b0\u65f6\u95f4'];
    if (incCam) header.push('\u6444\u50cf\u5934\u7167\u7247', '\u6444\u50cf\u5934SN\u7801');
    if (incPt) header.push('\u70b9\u4f4d\u7167\u7247', '\u7eac\u5ea6', '\u7ecf\u5ea6');
    if (incOnt) header.push('\u5149\u732b\u7167\u7247', '\u5149\u732bSN\u7801', '\u5bbd\u5e26\u8d26\u53f7');
    if (incCab) header.push('\u673a\u7bb1\u7167\u7247', '\u673a\u7bb1\u7f16\u7801');
    if (incRem) header.push('\u5907\u6ce8');

    const wsData = [header];
    records.forEach((r, i) => {
      const row = [i + 1, formatDate(r.createdAt), formatDate(r.updatedAt)];
      if (incCam) row.push(r.cameraPhoto || '', r.cameraSN || '');
      if (incPt) row.push(r.pointPhoto || '', r.latitude ?? '', r.longitude ?? '');
      if (incOnt) row.push(r.ontPhoto || '', r.ontSN || '', r.broadbandAccount || '');
      if (incCab) row.push(r.cabinetPhoto || '', r.cabinetCode || '');
      if (incRem) row.push(r.remark || '');
      wsData.push(row);
    });

    if (format === 'csv') {
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const csv = XLSX.utils.sheet_to_csv(ws);
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      downloadBlob(blob, '\u6444\u50cf\u5934\u8fd0\u7ef4\u6570\u636e_' + formatDate(new Date().toISOString()).replace(/[:\s]/g,'_') + '.csv');
      toast.success('CSV\u5bfc\u51fa\u6210\u529f');
    } else {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!cols'] = [{wch:6},{wch:18},{wch:18}];
      if (incCam) ws['!cols'].push({wch:15},{wch:20});
      if (incPt) ws['!cols'].push({wch:15},{wch:12},{wch:12});
      if (incOnt) ws['!cols'].push({wch:15},{wch:20},{wch:25});
      if (incCab) ws['!cols'].push({wch:15},{wch:20});
      if (incRem) ws['!cols'].push({wch:30});
      XLSX.utils.book_append_sheet(wb, ws, '\u6444\u50cf\u5934\u8fd0\u7ef4\u6570\u636e');
      const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbOut], { type: 'application/octet-stream' });
      downloadBlob(blob, '\u6444\u50cf\u5934\u8fd0\u7ef4\u6570\u636e_' + formatDate(new Date().toISOString()).replace(/[:\s]/g,'_') + '.xlsx');
      toast.success('Excel\u5bfc\u51fa\u6210\u529f');
    }
  }).catch(err => {
    console.error('Export error:', err);
    toast.error('\u5bfc\u51fa\u5931\u8d25');
  });
}

function doExportJson() {
  db.getAll().then(records => {
    if (records.length === 0) { toast.warning('\u6ca1\u6709\u6570\u636e'); return; }
    const clean = records.map(r => ({
      id: r.id,
      cameraSN: r.cameraSN,
      latitude: r.latitude,
      longitude: r.longitude,
      ontSN: r.ontSN,
      broadbandAccount: r.broadbandAccount,
      cabinetCode: r.cabinetCode,
      hasCameraPhoto: !!r.cameraPhoto,
      hasPointPhoto: !!r.pointPhoto,
      hasOntPhoto: !!r.ontPhoto,
      hasCabinetPhoto: !!r.cabinetPhoto,
      remark: r.remark,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));
    const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
    downloadBlob(blob, '\u6444\u50cf\u5934\u8fd0\u7ef4\u6570\u636e_' + formatDate(new Date().toISOString()).replace(/[:\s]/g,'_') + '.json');
    toast.success('JSON\u5bfc\u51fa\u6210\u529f');
  });
}


/* ========== 备份与恢复 ========== */
async function doBackup() {
  const records = await db.getAll();
  if (records.length === 0) { toast.warning('没有数据可备份'); return; }
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    total: records.length,
    records: records
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  downloadBlob(blob, '摄像头运维备份_' + formatDate(new Date().toISOString()).replace(/[:\s]/g,'_') + '.backup.json');
  toast.success('备份导出成功，共 ' + records.length + ' 条记录');
}

async function doRestore() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const backup = JSON.parse(text);
      if (!backup.records || !Array.isArray(backup.records)) {
        toast.error('无效的备份文件');
        return;
      }
      const existing = await db.getAll();
      const existingIds = new Set(existing.map(r => r.id));
      let imported = 0, skipped = 0;
      for (const record of backup.records) {
        if (existingIds.has(record.id)) {
          skipped++;
          continue;
        }
        await db.put(record);
        imported++;
      }
      toast.success('恢复完成：新增 ' + imported + ' 条' + (skipped ? '，跳过 ' + skipped + ' 条重复' : ''));
      router.refresh();
    } catch (err) {
      console.error('Restore error:', err);
      toast.error('恢复失败，备份文件格式不正确');
    }
  };
  input.click();
}

/* ========== 全屏图片查看 ========== */
let currentViewerIndex = 0;
let viewerImages = [];

function openImageViewer(images, index) {
  if (!images || images.length === 0) return;
  viewerImages = images;
  currentViewerIndex = index || 0;
  updateViewerImage();
  document.getElementById('imageViewerOverlay').classList.add('open');
}

function closeImageViewer() {
  document.getElementById('imageViewerOverlay').classList.remove('open');
  viewerImages = [];
}

function prevImage() {
  if (currentViewerIndex > 0) { currentViewerIndex--; updateViewerImage(); }
}

function nextImage() {
  if (currentViewerIndex < viewerImages.length - 1) { currentViewerIndex++; updateViewerImage(); }
}



function openImageViewerFromRecord(recordId, index) {
  db.get(recordId).then(function(r) {
    if (!r) return;
    var images = [];
    if (r.cameraPhoto) images.push(r.cameraPhoto);
    if (r.pointPhoto) images.push(r.pointPhoto);
    if (r.ontPhoto) images.push(r.ontPhoto);
    if (r.cabinetPhoto) images.push(r.cabinetPhoto);
    if (images.length > 0) openImageViewer(images, index);
  });
}


function updateViewerImage() {
  const img = viewerImages[currentViewerIndex];
  document.getElementById('viewerImage').src = img;
  document.getElementById('viewerCounter').textContent = (currentViewerIndex + 1) + ' / ' + viewerImages.length;
  document.getElementById('viewerPrevBtn').style.display = currentViewerIndex > 0 ? 'flex' : 'none';
  document.getElementById('viewerNextBtn').style.display = currentViewerIndex < viewerImages.length - 1 ? 'flex' : 'none';
}


function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ========== 删除 ========== */
async function handleDelete(id) {
  modal.open(
    '<h2>\u786e\u8ba4\u5220\u9664</h2>' +
    '<p style="color:var(--text-secondary);font-size:14px;">\u5220\u9664\u540e\u6570\u636e\u4e0d\u53ef\u6062\u590d\uff0c\u786e\u5b9a\u8981\u5220\u9664\u8fd9\u6761\u8bb0\u5f55\u5417\uff1f</p>' +
    '<div class="modal-actions">' +
    '<button class="btn btn-outline" onclick="modal.close()">\u53d6\u6d88</button>' +
    '<button class="btn btn-danger modal-confirm">\u786e\u8ba4\u5220\u9664</button></div>',
    async () => {
      try {
        await db.delete(id);
        document.getElementById('headerActions').innerHTML = '';
        toast.success('\u5df2\u5220\u9664');
        router.go('list');
      } catch (e) {
        toast.error('\u5220\u9664\u5931\u8d25');
      }
    }
  );
}


/* ========== 表单验证 ========== */
function validateForm() {
  var fields = [
    { id: 'cameraSN' },
    { id: 'ontSN' },
    { id: 'broadbandAccount' },
    { id: 'cabinetCode' }
  ];
  var filled = fields.filter(function(f) { return document.getElementById(f.id).value.trim(); }).length;
  if (filled === 0) {
    var hasPhoto = ['cameraPhoto', 'pointPhoto', 'ontPhoto', 'cabinetPhoto']
      .some(function(id) { return document.getElementById(id + '-data').value; });
    if (!hasPhoto) {
      toast.warning('请至少填写一个字段或拍摄一张照片');
      return false;
    }
  }
  return true;
}

/* ========== HTML转义 ========== */
function escHtml(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ========== 启动 ========== */
document.addEventListener('DOMContentLoaded', () => {
  router.go('list');
});
