// ─── Modeller ─────────────────────────────────────────────────
const TTS_MODEL    = "gemini-2.5-flash-preview-tts";
const VISION_MODEL = "gemini-2.5-flash";

// ─── Ses Seçenekleri ──────────────────────────────────────────
const VOICE_OPTIONS = [
  { value: "Kore",   label: "Kore (Kadın, Dengeli)" },
  { value: "Zephyr", label: "Zephyr (Kadın, Sıcak)"  },
  { value: "Leda",   label: "Leda (Kadın, Yumuşak)"  },
  { value: "Charon", label: "Charon (Erkek, Derin)"  },
  { value: "Puck",   label: "Puck (Erkek, Neşeli)"   },
  { value: "Fenrir", label: "Fenrir (Erkek, Güçlü)"  },
  { value: "Orus",   label: "Orus (Erkek, Dengeli)"  },
];

// ─── Durum ────────────────────────────────────────────────────
let lines       = [];
let currentMode = "single";

// ─── UI Referansları ──────────────────────────────────────────
const ui = {
  generateBtn:    document.getElementById("generateBtn"),
  textInput:      document.getElementById("textInput"),
  playerControls: document.getElementById("playerControls"),
  audioPlayer:    document.getElementById("audioPlayer"),
  subtitle:       document.getElementById("videoSubtitle"),
  dlLink:         document.getElementById("downloadLink"),
  fileInput:      document.getElementById("fileInput"),
  voiceSelect:    document.getElementById("voiceSelect"),
  speedSelect:    document.getElementById("speedSelect"),
  btnText:        document.getElementById("btnText"),
  debugPanel:     document.getElementById("debugPanel"),
  debugContent:   document.getElementById("debugContent"),
  charCount:      document.getElementById("charCount"),
  errorBox:       document.getElementById("errorBox"),
  modeSingle:     document.getElementById("modeSingle"),
  modeMulti:      document.getElementById("modeMulti"),
  lineEditor:     document.getElementById("lineEditor"),
  lineList:       document.getElementById("lineList"),
  singleControls: document.getElementById("singleControls"),
};

// ─── Log & Hata ───────────────────────────────────────────────
function addLog(message, type = "info") {
  ui.debugPanel.classList.remove("hidden");
  const div = document.createElement("div");
  div.className = "log-entry";
  const color = type === "error" ? "#f87171" : type === "success" ? "#4ade80" : "#60a5fa";
  div.innerHTML = `<span style="color:${color}">[${new Date().toLocaleTimeString("tr-TR", { hour12: false })}]</span> ${message}`;
  ui.debugContent.appendChild(div);
  ui.debugContent.scrollTop = ui.debugContent.scrollHeight;
}

function showError(msg) { ui.errorBox.textContent = msg; ui.errorBox.classList.remove("hidden"); }
function clearError()   { ui.errorBox.textContent = ""; ui.errorBox.classList.add("hidden"); }
function setBusy(text)  { ui.generateBtn.disabled = true; ui.btnText.textContent = text; }
function setIdle()      { ui.generateBtn.disabled = false; ui.btnText.textContent = currentMode === "multi" ? "DİYALOGU SESLENDİR" : "SESE DÖNÜŞTÜR"; }

// ─── Mod ──────────────────────────────────────────────────────
ui.modeSingle.addEventListener("click", () => setMode("single"));
ui.modeMulti.addEventListener("click",  () => setMode("multi"));

function setMode(mode) {
  currentMode = mode;
  if (mode === "single") {
    ui.modeSingle.classList.add("active-mode");
    ui.modeMulti.classList.remove("active-mode");
    ui.singleControls.classList.remove("hidden");
    ui.lineEditor.classList.add("hidden");
    ui.textInput.classList.remove("hidden");
    ui.btnText.textContent = "SESE DÖNÜŞTÜR";
  } else {
    ui.modeMulti.classList.add("active-mode");
    ui.modeSingle.classList.remove("active-mode");
    ui.singleControls.classList.add("hidden");
    ui.textInput.classList.add("hidden");
    ui.btnText.textContent = "DİYALOGU SESLENDİR";
    const text = ui.textInput.value.trim();
    if (text) buildLineEditor(text);
  }
}

ui.textInput.addEventListener("input", () => {
  ui.charCount.textContent = `${ui.textInput.value.length} karakter`;
});

// ─── WAV Dönüşümü ─────────────────────────────────────────────
function pcmToWav(pcmData, sampleRate) {
  const buffer = new ArrayBuffer(44 + pcmData.length);
  const view   = new DataView(buffer);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); view.setUint32(4, 36 + pcmData.length, true);
  ws(8, "WAVE"); ws(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ws(36, "data"); view.setUint32(40, pcmData.length, true);
  new Uint8Array(buffer, 44).set(pcmData);
  return new Blob([buffer], { type: "audio/wav" });
}

function base64ToUint8Array(base64) {
  const bin   = atob(base64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function mergeChunks(all) {
  const total = all.reduce((s, a) => s + a.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const a of all) { out.set(a, off); off += a.length; }
  return out;
}

function splitText(text, max = 500) {
  const norm = text.replace(/\s+/g, " ").trim();
  if (norm.length <= max) return [norm];
  const sents  = norm.match(/[^.!?]+[.!?]*/g) || [norm];
  const chunks = []; let cur = "";
  for (const s of sents) {
    if ((cur + " " + s).trim().length > max && cur.trim()) { chunks.push(cur.trim()); cur = s; }
    else cur += " " + s;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

function speedInstruction(speed) {
  if (speed === "slow") return "Please read this very slowly and clearly:\n\n";
  if (speed === "fast") return "Please read this quickly but clearly:\n\n";
  return "Please read this naturally and clearly:\n\n";
}

// ─── Gemini API (Vercel proxy üzerinden) ──────────────────────
async function callGemini(model, payload) {
  const res = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, payload })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Gemini API hatası (${res.status}): ${raw}`);
  let data;
  try { data = JSON.parse(raw); } catch { throw new Error("Gemini yanıtı çözülemedi."); }
  return data;
}

// ─── TTS ──────────────────────────────────────────────────────
async function callGeminiTTS(text, voice, speed) {
  const data = await callGemini(TTS_MODEL, {
    contents: [{ parts: [{ text: speedInstruction(speed) + text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    }
  });
  const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part?.inlineData?.data)
    throw new Error(`Ses verisi alınamadı. finishReason: ${data?.candidates?.[0]?.finishReason || "?"}`);
  const bytes      = base64ToUint8Array(part.inlineData.data);
  const sampleRate = parseInt((part.inlineData.mimeType || "").match(/rate=(\d+)/)?.[1] || "24000", 10);
  return { bytes, sampleRate };
}

async function fetchAudioMerged(text, voice, speed) {
  const chunks = splitText(text, 500);
  addLog(`Metin ${chunks.length} parçaya bölündü.`);
  const all = []; let sampleRate = 24000;
  for (let i = 0; i < chunks.length; i++) {
    addLog(`TTS parça ${i + 1}/${chunks.length}...`);
    const r = await callGeminiTTS(chunks[i], voice, speed);
    all.push(r.bytes); sampleRate = r.sampleRate;
  }
  return { bytes: mergeChunks(all), sampleRate };
}

// ─── Görsel → Diyalog ─────────────────────────────────────────
async function extractDialogueFromImage(file, base64Data) {
  const prompt = `Bu bir çizgi roman görseli. Sayfada konuşma balonları var.
Görevin: Her konuşma balonundaki metni tek tek çıkar.
Kurallar:
- Bir balonun içindeki tüm satırları birleştir, tek metin yap.
- Balonları diyaloğun doğal sırasına göre sırala (soru → cevap → soru → cevap).
- Başlık, karakter ismi etiketi, hashtag, efekt yazısı (HIMMM, VAY, TAMAM gibi) dahil etme.
- Her balonu sadece "---" ile ayır.
- Başka hiçbir şey yazma, açıklama yapma.`;

  const data = await callGemini(VISION_MODEL, {
    contents: [{
      parts: [
        { text: prompt },
        { inlineData: { mimeType: file.type, data: base64Data } }
      ]
    }]
  });
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Görselden metin çıkarılamadı.");
  return text;
}

// ─── Düz Metin → Diyalog ──────────────────────────────────────
async function parseDialogueFromText(rawText) {
  const prompt = `Aşağıdaki metinde konuşma balonları veya diyalog satırları var.
Her konuşmayı "---" ile ayırarak döndür.
Başlık, etiket, hashtag gibi şeyleri dahil etme.
Başka hiçbir şey yazma.

Metin:
${rawText}`;

  const data = await callGemini(VISION_MODEL, {
    contents: [{ parts: [{ text: prompt }] }]
  });
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Metin ayrıştırılamadı.");
  return text;
}

// ─── Satır Editörü ────────────────────────────────────────────
function buildLineEditorFromSeparated(separatedText) {
  const parts = separatedText
    .split("---")
    .map(p => p.replace(/\n/g, " ").trim())
    .filter(p => p.length > 0);

  lines = parts.map((text, i) => ({
    text,
    voice: VOICE_OPTIONS[i % VOICE_OPTIONS.length].value
  }));

  renderLineEditor();
  ui.lineEditor.classList.remove("hidden");
  ui.charCount.textContent = `${lines.length} satır`;
  addLog(`${lines.length} konuşma satırı oluşturuldu.`, "success");
}

function buildLineEditor(rawText) {
  const parts = rawText.split("---").map(p => p.replace(/\n/g, " ").trim()).filter(p => p.length > 0);
  if (parts.length > 1) {
    buildLineEditorFromSeparated(rawText);
  } else {
    lines = rawText.split("\n")
      .map(l => l.trim()).filter(l => l.length > 0)
      .map((text, i) => ({ text, voice: VOICE_OPTIONS[i % VOICE_OPTIONS.length].value }));
    renderLineEditor();
    ui.lineEditor.classList.remove("hidden");
    ui.charCount.textContent = `${lines.length} satır`;
  }
}

function makeBtn(text, title, bgClass, clickFn) {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.title = title;
  btn.style.cssText = `
    padding: 4px 8px; border-radius: 8px; font-size: 11px; font-weight: 700;
    cursor: pointer; text-align: center; width: 100%;
    background: ${bgClass === "red" ? "#fff1f2" : "#f1f5f9"};
    border: 1px solid ${bgClass === "red" ? "#fecdd3" : "#e2e8f0"};
    color: ${bgClass === "red" ? "#e11d48" : "#475569"};
  `;
  btn.addEventListener("mouseover", () => btn.style.opacity = "0.8");
  btn.addEventListener("mouseout",  () => btn.style.opacity = "1");
  btn.addEventListener("click", clickFn);
  return btn;
}

function renderLineEditor() {
  ui.lineList.innerHTML = "";

  lines.forEach((line, idx) => {
    const row = document.createElement("div");
    row.className = "line-row";

    const num = document.createElement("span");
    num.className = "line-num";
    num.textContent = idx + 1;

    const textarea = document.createElement("textarea");
    textarea.className = "line-text";
    textarea.rows = 2;
    textarea.value = line.text;
    textarea.addEventListener("input", () => { lines[idx].text = textarea.value; });

    const select = document.createElement("select");
    select.className = "line-voice";
    VOICE_OPTIONS.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v.value; opt.textContent = v.label;
      if (v.value === line.voice) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => { lines[idx].voice = select.value; });

    const upBtn = makeBtn("▲ Yukarı", "Yukarı taşı", "gray", () => {
      if (idx === 0) return;
      [lines[idx - 1], lines[idx]] = [lines[idx], lines[idx - 1]];
      renderLineEditor();
    });

    const downBtn = makeBtn("▼ Aşağı", "Aşağı taşı", "gray", () => {
      if (idx === lines.length - 1) return;
      [lines[idx + 1], lines[idx]] = [lines[idx], lines[idx + 1]];
      renderLineEditor();
    });

    const applyAll = makeBtn("↓ Hepsine", "Bu sesi tüm satırlara uygula", "gray", () => {
      lines.forEach(l => l.voice = select.value);
      renderLineEditor();
    });

    const delBtn = makeBtn("✕ Sil", "Bu satırı sil", "red", () => {
      lines.splice(idx, 1);
      renderLineEditor();
    });

    const right = document.createElement("div");
    right.className = "line-controls";
    right.appendChild(select);
    right.appendChild(upBtn);
    right.appendChild(downBtn);
    right.appendChild(applyAll);
    right.appendChild(delBtn);

    row.appendChild(num);
    row.appendChild(textarea);
    row.appendChild(right);
    ui.lineList.appendChild(row);
  });

  const addBtn = document.createElement("button");
  addBtn.className = "btn-add-line";
  addBtn.textContent = "+ Satır Ekle";
  addBtn.addEventListener("click", () => {
    lines.push({ text: "", voice: VOICE_OPTIONS[0].value });
    renderLineEditor();
    ui.lineList.querySelectorAll(".line-row textarea")[lines.length - 1]?.focus();
  });
  ui.lineList.appendChild(addBtn);
}

// ─── Dosya Seçimi ─────────────────────────────────────────────
ui.fileInput.onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  clearError();
  addLog(`Görsel seçildi: ${file.name}`);

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const base64Data = String(reader.result).split(",")[1];

      if (currentMode === "single") {
        setBusy("RESİM OKUNUYOR...");
        const data = await callGemini(VISION_MODEL, {
          contents: [{
            parts: [
              { text: "Bu görseldeki tüm yazıyı eksiksiz çıkar. Sadece düz metni döndür." },
              { inlineData: { mimeType: file.type, data: base64Data } }
            ]
          }]
        });
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!text) throw new Error("Görselden metin çıkarılamadı.");
        ui.textInput.value = text;
        ui.charCount.textContent = `${text.length} karakter`;
        addLog("Metin çıkarıldı.", "success");
      } else {
        setBusy("BALONLAR OKUNUYOR...");
        const separated = await extractDialogueFromImage(file, base64Data);
        buildLineEditorFromSeparated(separated);
      }

    } catch (err) {
      addLog(`Hata: ${err.message}`, "error");
      showError(err.message);
    } finally { setIdle(); }
  };
  reader.onerror = () => { setIdle(); showError("Dosya okunurken hata oluştu."); };
  reader.readAsDataURL(file);
};

// ─── Sese Dönüştür ────────────────────────────────────────────
ui.generateBtn.onclick = async () => {
  clearError();

  if (currentMode === "multi") {
    if (lines.length === 0) {
      const text = ui.textInput.value.trim();
      if (!text) { showError("Lütfen metin yazın veya resim yükleyin."); return; }
      setBusy("AYRIŞTIRILIYYOR...");
      addLog("Diyalog satırları ayrıştırılıyor...");
      try {
        const separated = await parseDialogueFromText(text);
        buildLineEditorFromSeparated(separated);
      } catch (err) {
        addLog(`Hata: ${err.message}`, "error");
        showError(err.message);
      } finally { setIdle(); }
      return;
    }

    const active = lines.filter(l => l.text.trim().length > 0);
    if (active.length === 0) { showError("Seslendirilecek satır yok."); return; }

    setBusy("SESLENDİRİLİYOR...");
    ui.playerControls.classList.add("hidden");
    addLog(`${active.length} satır seslendiriliyor...`);

    try {
      const all = []; let sampleRate = 24000;
      for (let i = 0; i < active.length; i++) {
        const { text, voice } = active[i];
        const label = VOICE_OPTIONS.find(v => v.value === voice)?.label || voice;
        addLog(`[${i + 1}/${active.length}] ${label}: "${text.substring(0, 50)}${text.length > 50 ? "..." : ""}"`);
        const r = await callGeminiTTS(text.trim(), voice, ui.speedSelect.value);
        all.push(r.bytes); sampleRate = r.sampleRate;
      }
      const wavBlob = pcmToWav(mergeChunks(all), sampleRate);
      const blobUrl = URL.createObjectURL(wavBlob);
      ui.audioPlayer.src = blobUrl;
      ui.dlLink.href     = blobUrl;
      ui.dlLink.download = `diyalog-${Date.now()}.wav`;
      ui.playerControls.classList.remove("hidden");
      ui.subtitle.textContent = `${active.length} satır seslendirme tamamlandı.`;
      addLog("Diyalog başarıyla oluşturuldu.", "success");
      try { await ui.audioPlayer.play(); } catch { addLog("Otomatik oynatma engellendi."); }
    } catch (err) {
      addLog(`TTS hatası: ${err.message}`, "error");
      showError(`Ses oluşturulamadı.\n${err.message}`);
    } finally { setIdle(); }
    return;
  }

  // Tek ses
  const text = ui.textInput.value.trim();
  if (!text) { showError("Lütfen önce bir metin yazın."); return; }

  setBusy("İŞLENİYOR...");
  ui.playerControls.classList.add("hidden");
  addLog("Ses üretimi başlatıldı.");

  try {
    const { bytes, sampleRate } = await fetchAudioMerged(text, ui.voiceSelect.value, ui.speedSelect.value);
    const wavBlob = pcmToWav(bytes, sampleRate);
    const blobUrl = URL.createObjectURL(wavBlob);
    ui.audioPlayer.src = blobUrl;
    ui.dlLink.href     = blobUrl;
    ui.dlLink.download = `ai-ses-${Date.now()}.wav`;
    ui.playerControls.classList.remove("hidden");
    ui.subtitle.textContent = text.substring(0, 100) + (text.length > 100 ? "..." : "");
    addLog("Ses başarıyla oluşturuldu.", "success");
    try { await ui.audioPlayer.play(); } catch { addLog("Otomatik oynatma engellendi."); }
  } catch (err) {
    addLog(`TTS hatası: ${err.message}`, "error");
    showError(`Ses oluşturulamadı.\n${err.message}`);
  } finally { setIdle(); }
};

addLog("Sistem hazır.", "success");